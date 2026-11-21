// =====================================================================
// Everything a learner saves, kept per account in SQLite so it follows
// them across sessions, browsers and devices:
//   courses (outline + settings), written lessons, progress per lesson,
//   doubts, notebook notes and sketches, and wrong answers (for the tutor).
// Also the AI endpoints that create courses and write lessons, since
// both now save straight into the learner's library.
// =====================================================================
import crypto from 'node:crypto';
import { q, tx, now, parseJSON } from './db.mjs';
import { HttpError, sendJSON, readBody, text, longText } from './http.mjs';
import { requireUser } from './auth.mjs';
import { generateOutline, generateLesson } from './ai.mjs';
import { screen, cleanSafety, courseSafety, softenSample, REFUSED } from './safety.mjs';

export const newId = () => Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
const TAGS = new Set(['maths', 'diagram', 'practice', 'written']);
const SOURCES = new Set(['ai', 'sample', 'library']);
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const idOk = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(id);

/* ---------------- course shape ---------------- */

export function cleanUnits(units, maxLessons = 400) {
  const out = [];
  let total = 0;
  for (const u of Array.isArray(units) ? units.slice(0, 80) : []) {
    const lessons = [];
    for (const l of Array.isArray(u && u.lessons) ? u.lessons : []) {
      if (total >= maxLessons) break;
      const title = text(l && l.title, 140);
      if (!title) continue;
      lessons.push({
        title,
        desc: text(l.desc, 300),
        tags: (Array.isArray(l.tags) ? l.tags : []).filter((t) => TAGS.has(t)).slice(0, 4),
        minutes: clampInt(l.minutes, 5, 60, 15),
        contentId: typeof l.contentId === 'string' ? text(l.contentId, 40) : null
      });
      total++;
    }
    if (lessons.length) out.push({ title: text(u.title, 100) || 'Unit', lessons });
  }
  return out;
}

export function cleanMeta(c) {
  const units = cleanUnits(c && c.units);
  if (!units.length) throw new HttpError('That course has no lessons.', 400);
  const meta = {
    topic: text(c.topic, 120) || 'Untitled',
    title: text(c.title, 120) || text(c.topic, 120) || 'Untitled course',
    from: text(c.from, 80),
    to: text(c.to, 80),
    instructions: text(c.instructions, 600),
    style: (Array.isArray(c.style) ? c.style : []).slice(0, 8)
      .map((s) => ({ key: text(s && s.key, 20), label: text(s && s.label, 40) })).filter((s) => s.key),
    source: SOURCES.has(c.source) ? c.source : 'sample',
    lang: ['en', 'hi', 'ru'].includes(c.lang) ? c.lang : 'en',
    model: text(c.model, 120) || null,
    units
  };
  const aiError = text(c.aiError, 300);
  if (aiError) meta.aiError = aiError;
  if (c.library && typeof c.library === 'object') meta.library = c.library;
  const safety = cleanSafety(c.safety);
  if (safety) meta.safety = safety;
  return meta;
}

export function flatten(units) {
  const out = [];
  units.forEach((u, ui) => u.lessons.forEach((l) => out.push({ ...l, n: out.length + 1, unit: u.title, unitIndex: ui + 1 })));
  return out;
}

function courseOut(row, written = [], progress = {}) {
  const meta = parseJSON(row.data, {});
  if (!meta.safety) { // courses made before the safety check get their framing worked out here
    const s = courseSafety(meta);
    if (s && s.kind !== 'refuse') meta.safety = s;
  }
  return {
    ...meta,
    id: row.id,
    folderId: row.folder_id ?? null,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    lastLesson: row.last_lesson ?? null,
    written,
    progress
  };
}

export function ownCourse(user, id) {
  if (!idOk(id)) throw new HttpError('That course doesn’t exist.', 404);
  const row = q('SELECT * FROM courses WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!row) throw new HttpError('That course doesn’t exist.', 404);
  return row;
}

export function insertCourse(user, meta, extra = {}) {
  const id = newId();
  const t = now();
  q('INSERT INTO courses (id, user_id, data, folder_id, created_at, opened_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, user.id, JSON.stringify(meta), extra.folderId ?? null, t, t);
  return q('SELECT * FROM courses WHERE id = ?').get(id);
}

export function loadCourse(user, id) {
  const row = ownCourse(user, id);
  const written = q('SELECT n FROM lessons WHERE course_id = ? ORDER BY n').all(id).map((r) => r.n);
  const progress = {};
  q('SELECT n, data FROM progress WHERE course_id = ?').all(id).forEach((r) => { progress[r.n] = parseJSON(r.data, {}); });
  return courseOut(row, written, progress);
}

/* ---------------- courses ---------------- */

async function listCourses({ req, res }) {
  const u = requireUser(req);
  const rows = q('SELECT * FROM courses WHERE user_id = ? ORDER BY opened_at DESC').all(u.id);
  const written = {}, progress = {};
  q('SELECT l.course_id, l.n FROM lessons l JOIN courses c ON c.id = l.course_id WHERE c.user_id = ? ORDER BY l.n').all(u.id)
    .forEach((r) => { (written[r.course_id] ||= []).push(r.n); });
  q('SELECT p.course_id, p.n, p.data FROM progress p JOIN courses c ON c.id = p.course_id WHERE c.user_id = ?').all(u.id)
    .forEach((r) => { (progress[r.course_id] ||= {})[r.n] = parseJSON(r.data, {}); });
  sendJSON(res, 200, { ok: true, courses: rows.map((r) => courseOut(r, written[r.id] || [], progress[r.id] || {})) });
}

async function getCourse({ req, res, params }) {
  sendJSON(res, 200, { ok: true, course: loadCourse(requireUser(req), params.id) });
}

async function createCourse({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 400_000);
  const meta = cleanMeta(body.course);
  if (meta.source === 'ai' || meta.source === 'library') meta.source = 'sample'; // AI courses are only made by /api/outline
  delete meta.library;
  // a sample course on a risky topic is renamed to its safe framing, like an AI one
  const s = screen(meta.topic, meta.title, meta.from, meta.to, meta.instructions);
  if (s && s.kind === 'refuse') throw new HttpError(REFUSED, 400);
  if (s) softenSample(meta, s);
  const row = insertCourse(u, meta, { folderId: folderFor(u, body) });
  sendJSON(res, 201, { ok: true, course: courseOut(row) });
}

async function patchCourse({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const body = await readBody(req, 4_000);
  if (body.opened) q('UPDATE courses SET opened_at = ? WHERE id = ?').run(now(), row.id);
  if (body.title != null) {
    const title = text(body.title, 120);
    if (!title) throw new HttpError('Give the course a title.', 400);
    const meta = parseJSON(row.data, {});
    meta.title = title;
    q('UPDATE courses SET data = ? WHERE id = ?').run(JSON.stringify(meta), row.id);
  }
  sendJSON(res, 200, { ok: true });
}

async function deleteCourse({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  q('DELETE FROM courses WHERE id = ?').run(row.id);
  sendJSON(res, 200, { ok: true });
}

/* ---------------- AI: plan a course, write a lesson ---------------- */

export function courseInput(body) {
  const topic = text(body.topic, 120);
  if (!topic) throw new HttpError('Name a topic first.', 400);
  return { topic, from: text(body.from, 80), to: text(body.to, 80), instructions: text(body.instructions, 600) };
}

// Hooks other modules can set (the shared library plans courses its own way;
// the folders module checks a folder belongs to the user: ownFolder(user, id) -> row).
export const hooks = { planCourse: null, writeLesson: null, ownFolder: null };

// The folder a new course should be filed in, if the request names one.
function folderFor(user, body) {
  if (body.folderId == null || body.folderId === '' || !hooks.ownFolder) return null;
  return hooks.ownFolder(user, body.folderId).id;
}

async function outline({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 8_000);
  const input = { ...courseInput(body), lang: u.lang || 'en' }; // courses are written in the learner's language
  // risky topics aren't turned away: the AI is told to teach their safe, public side
  const s = screen(input.topic, input.from, input.to, input.instructions);
  if (s && s.kind === 'refuse') throw new HttpError(REFUSED, 400);
  if (s) input.safety = s;
  const style = Array.isArray(body.style) ? body.style : [];
  const folderId = folderFor(u, body);
  let meta;
  if (hooks.planCourse) meta = await hooks.planCourse(u, input, style);
  if (!meta) {
    const out = await generateOutline(input);
    meta = cleanMeta({ ...input, title: out.outline.title, style, source: 'ai', model: out.model, units: out.outline.units });
  }
  const row = insertCourse(u, meta, { folderId });
  sendJSON(res, 201, { ok: true, course: courseOut(row) });
}

export function saveLesson(courseId, n, lesson, model) {
  q('INSERT OR REPLACE INTO lessons (course_id, n, data, model, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(courseId, n, JSON.stringify(lesson), model || null, now());
}

async function lesson({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 4_000);
  const row = ownCourse(u, text(body.courseId, 64));
  const n = Number(body.n);
  const meta = parseJSON(row.data, {});
  const flat = flatten(meta.units || []);
  if (!Number.isInteger(n) || n < 1 || n > flat.length) throw new HttpError('That lesson is not in the course.', 400);
  const have = q('SELECT data, model FROM lessons WHERE course_id = ? AND n = ?').get(row.id, n);
  if (have) return sendJSON(res, 200, { ok: true, lesson: parseJSON(have.data), model: have.model, cached: true });
  if (meta.source !== 'ai' && meta.source !== 'library') throw new HttpError('This sample course uses its built-in lessons.', 400);
  // older courses on risky topics (made before this check) are framed safely from here on
  const safety = courseSafety(meta);
  if (safety && safety.kind === 'refuse') throw new HttpError(REFUSED, 400);
  let out = null;
  if (hooks.writeLesson && !safety) out = await hooks.writeLesson(u, row, meta, n);
  if (!out) {
    out = await generateLesson({
      topic: meta.topic, from: meta.from, to: meta.to, instructions: meta.instructions, safety,
      courseTitle: meta.title || meta.topic, n, lang: meta.lang || 'en',
      outline: flat.map((l) => ({ n: l.n, unit: l.unit, title: l.title, desc: l.desc }))
    });
  }
  saveLesson(row.id, n, out.lesson, out.model);
  sendJSON(res, 200, { ok: true, lesson: out.lesson, model: out.model });
}

async function getLesson({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const have = q('SELECT data, model FROM lessons WHERE course_id = ? AND n = ?').get(row.id, Number(params.n));
  if (!have) throw new HttpError('That lesson hasn’t been written yet.', 404);
  sendJSON(res, 200, { ok: true, lesson: parseJSON(have.data), model: have.model });
}

async function putProgress({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const n = Number(params.n);
  const body = await readBody(req, 60_000);
  const data = body.progress && typeof body.progress === 'object' ? body.progress : null;
  if (!data || !Number.isInteger(n) || n < 1 || n > 2000) throw new HttpError('That progress update isn’t valid.', 400);
  const t = now();
  q(`INSERT INTO progress (course_id, n, data, done, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (course_id, n) DO UPDATE SET data = excluded.data, done = excluded.done, updated_at = excluded.updated_at`)
    .run(row.id, n, JSON.stringify(data), data.done ? 1 : 0, t);
  q('UPDATE courses SET last_lesson = ?, opened_at = ? WHERE id = ?').run(n, t, row.id);
  sendJSON(res, 200, { ok: true });
}

/* ---------------- doubts ---------------- */

const doubtOut = (d) => ({
  id: d.id, courseId: d.course_id, lesson: d.lesson_n, lessonTitle: d.lesson_title, kind: d.kind, section: d.section,
  quote: d.quote, context: d.context, question: d.question, image: d.image,
  answer: d.answer, answerModel: d.answer_model, answeredAt: d.answered_at, at: d.created_at,
  status: d.answer ? 'answered' : 'waiting'
});

async function listDoubts({ req, res, url }) {
  const u = requireUser(req);
  const course = url.searchParams.get('course');
  const lessonN = url.searchParams.get('lesson');
  let rows;
  if (course && lessonN) rows = q('SELECT * FROM doubts WHERE user_id = ? AND course_id = ? AND lesson_n = ? ORDER BY created_at DESC').all(u.id, course, Number(lessonN));
  else if (course) rows = q('SELECT * FROM doubts WHERE user_id = ? AND course_id = ? ORDER BY created_at DESC').all(u.id, course);
  else rows = q('SELECT * FROM doubts WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(u.id);
  sendJSON(res, 200, { ok: true, doubts: rows.map(doubtOut) });
}

export const doubtHooks = { afterAsk: null };

async function askDoubt({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 700_000);
  const question = longText(body.question, 1000);
  if (!question) throw new HttpError('Type your question first.', 400);
  let courseId = null, n = null;
  if (body.courseId) { courseId = ownCourse(u, text(body.courseId, 64)).id; n = clampInt(body.lesson, 1, 2000, null); }
  const kind = ['selection', 'drawing', 'general'].includes(body.kind) ? body.kind : 'general';
  let image = null;
  if (kind === 'drawing' && typeof body.image === 'string') {
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.image) || body.image.length > 600_000) throw new HttpError('That sketch couldn’t be saved.', 400);
    image = body.image;
  }
  const id = Number(q(`INSERT INTO doubts (user_id, course_id, lesson_n, lesson_title, kind, section, quote, context, question, image, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    u.id, courseId, n, text(body.lessonTitle, 140) || null, kind, text(body.section, 140) || null,
    longText(body.quote, 1500) || null, longText(body.context, 1500) || null, question, image, now()
  ).lastInsertRowid);
  const row = q('SELECT * FROM doubts WHERE id = ?').get(id);
  sendJSON(res, 201, { ok: true, doubt: doubtOut(row) });
  if (doubtHooks.afterAsk) doubtHooks.afterAsk(u, row);
}

/* ---------------- notebook ---------------- */

async function getNotes({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const n = Number(params.n);
  const note = q('SELECT text, sketch, updated_at FROM notes WHERE user_id = ? AND course_id = ? AND lesson_n = ?').get(u.id, row.id, n);
  sendJSON(res, 200, { ok: true, text: note ? note.text : '', sketch: note ? parseJSON(note.sketch, null) : null, updatedAt: note ? note.updated_at : null });
}

async function putNotes({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const n = Number(params.n);
  if (!Number.isInteger(n) || n < 1 || n > 2000) throw new HttpError('That lesson is not in the course.', 400);
  const body = await readBody(req, 900_000);
  const cur = q('SELECT text, sketch FROM notes WHERE user_id = ? AND course_id = ? AND lesson_n = ?').get(u.id, row.id, n) || { text: '', sketch: null };
  const textVal = body.text != null ? (typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n').slice(0, 40_000) : '') : cur.text;
  let sketchVal = cur.sketch;
  if (body.sketch !== undefined) {
    sketchVal = body.sketch == null ? null : JSON.stringify(body.sketch);
    if (sketchVal && sketchVal.length > 800_000) throw new HttpError('That drawing is too large to save. Clear some of it and try again.', 413);
  }
  const t = now();
  q(`INSERT INTO notes (user_id, course_id, lesson_n, text, sketch, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, course_id, lesson_n) DO UPDATE SET text = excluded.text, sketch = excluded.sketch, updated_at = excluded.updated_at`)
    .run(u.id, row.id, n, textVal, sketchVal, t);
  sendJSON(res, 200, { ok: true, updatedAt: t });
}

async function allNotes({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const rows = q('SELECT lesson_n, text, updated_at FROM notes WHERE user_id = ? AND course_id = ? AND text <> \'\' ORDER BY lesson_n').all(u.id, row.id);
  sendJSON(res, 200, { ok: true, notes: rows.map((r) => ({ lesson: r.lesson_n, text: r.text, updatedAt: r.updated_at })) });
}

/* ---------------- wrong answers (the tutor's memory) ---------------- */

// Set by review.mjs: a wrong answer schedules that question to come back for review.
export const mistakeHooks = { afterRecord: null };

async function addMistake({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 8_000);
  const prompt = longText(body.prompt, 600);
  if (!prompt) throw new HttpError('Nothing to record.', 400);
  let courseId = null;
  if (body.courseId) courseId = ownCourse(u, text(body.courseId, 64)).id;
  q('INSERT INTO mistakes (user_id, course_id, lesson_n, lesson_title, prompt, given, correct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(u.id, courseId, clampInt(body.lesson, 1, 2000, null), text(body.lessonTitle, 140) || null, prompt, text(body.given, 300) || null, text(body.correct, 300) || null, now());
  q('DELETE FROM mistakes WHERE user_id = ? AND id NOT IN (SELECT id FROM mistakes WHERE user_id = ? ORDER BY created_at DESC LIMIT 500)').run(u.id, u.id);
  if (mistakeHooks.afterRecord) mistakeHooks.afterRecord(u, courseId, body);
  sendJSON(res, 201, { ok: true });
}

/* ---------------- one-time import from the old browser-only storage ---------------- */

async function importLocal({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 8_000_000);
  const list = Array.isArray(body.courses) ? body.courses.slice(0, 200) : [];
  let imported = 0;
  tx(() => {
    for (const c of list) {
      let meta;
      try { meta = cleanMeta(c); } catch { continue; }
      const s = screen(meta.topic, meta.title, meta.instructions);
      if (s && s.kind === 'refuse') continue;
      if (s) meta.safety = { kind: s.kind, area: s.area || '' }; // its lessons stay as they were; new ones are framed safely
      const row = insertCourse(u, meta);
      if (c.lessons && typeof c.lessons === 'object') {
        for (const [k, l] of Object.entries(c.lessons)) {
          const n = Number(k);
          const s = JSON.stringify(l);
          if (Number.isInteger(n) && n > 0 && l && Array.isArray(l.sections) && s.length < 300_000) saveLesson(row.id, n, l, text(l.model, 120));
        }
      }
      if (c.progress && typeof c.progress === 'object') {
        for (const [k, p] of Object.entries(c.progress)) {
          const n = Number(k);
          const s = JSON.stringify(p);
          if (Number.isInteger(n) && n > 0 && p && typeof p === 'object' && s.length < 60_000) {
            q('INSERT OR REPLACE INTO progress (course_id, n, data, done, updated_at) VALUES (?, ?, ?, ?, ?)').run(row.id, n, s, p.done ? 1 : 0, now());
          }
        }
      }
      imported++;
    }
  });
  sendJSON(res, 200, { ok: true, imported });
}

export const routes = [
  ['GET', /^\/api\/courses$/, listCourses],
  ['POST', /^\/api\/courses$/, createCourse],
  ['GET', /^\/api\/courses\/(?<id>[^/]+)$/, getCourse],
  ['PATCH', /^\/api\/courses\/(?<id>[^/]+)$/, patchCourse],
  ['DELETE', /^\/api\/courses\/(?<id>[^/]+)$/, deleteCourse],
  ['GET', /^\/api\/courses\/(?<id>[^/]+)\/lessons\/(?<n>\d+)$/, getLesson],
  ['PUT', /^\/api\/courses\/(?<id>[^/]+)\/progress\/(?<n>\d+)$/, putProgress],
  ['GET', /^\/api\/courses\/(?<id>[^/]+)\/notes$/, allNotes],
  ['GET', /^\/api\/notes\/(?<id>[^/]+)\/(?<n>\d+)$/, getNotes],
  ['PUT', /^\/api\/notes\/(?<id>[^/]+)\/(?<n>\d+)$/, putNotes],
  ['POST', /^\/api\/outline$/, outline],
  ['POST', /^\/api\/lesson$/, lesson],
  ['GET', /^\/api\/doubts$/, listDoubts],
  ['POST', /^\/api\/doubts$/, askDoubt],
  ['POST', /^\/api\/mistakes$/, addMistake],
  ['POST', /^\/api\/import$/, importLocal]
];
