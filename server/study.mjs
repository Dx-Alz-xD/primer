// =====================================================================
// Study tools: how a learner studies a course, and how long.
//
// - A study method per course (active recall, Feynman, Cornell notes,
//   mind map, SQ3R, interleaving, spaced repetition, Pomodoro). The
//   lesson page changes how it teaches to match (assets/js/study-methods.js).
//   A Feynman explanation of one part of a lesson is marked by the same
//   AI marking as a written answer (marking.mjs, question "f<part>").
// - What the methods keep per lesson: guesses made before reading
//   (active recall), SQ3R questions and recitations, mind maps.
// - Study time: the browser counts the time a lesson is open and in use,
//   and the time the study timer runs a focus block (assets/js/timer.js),
//   and sends it here a minute at a time, per course, lesson and day.
//   Finished focus blocks are kept as sessions.
// - The numbers behind a course's knowledge map: per lesson, the
//   mistakes still coming back in Review and fixed, written answers
//   marked "not yet", and time studied.
//
//   GET  /api/study/course/:id                  method, time, sessions, per-lesson numbers
//   PUT  /api/study/course/:id                  { method }  ('' for none)
//   GET  /api/study/methods                     { methods: { courseId: method } }
//   GET  /api/study/pages/:id/:n                what the methods kept for one lesson
//   PUT  /api/study/pages/:id/:n/:kind          { data }  kind: recall | sq3r | mindmap | feynman (drafts)
//   POST /api/study/time                        { entries: [{ c, n, d, ms, tms }] }
//   POST /api/study/session                     { key, courseId, kind, ms }
//   GET  /api/study/today?day=YYYY-MM-DD&since= today's time and sessions
// =====================================================================
import { q, schema, now, parseJSON } from './db.mjs';
import { HttpError, sendJSON, readBody, text, overLimit } from './http.mjs';
import { requireUser } from './auth.mjs';
import { ownCourse } from './data.mjs';
import { markHooks } from './marking.mjs';
import { swParts } from './offline.mjs';

schema('study-1', `
  CREATE TABLE study_methods (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    method      TEXT NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, course_id)
  );
  CREATE TABLE study_time (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT NOT NULL DEFAULT '',    -- '' for time on the timer with no course open
    lesson_n    INTEGER NOT NULL DEFAULT 0,  -- 0 when not in a lesson
    day         TEXT NOT NULL,               -- the learner's own date, YYYY-MM-DD
    ms          INTEGER NOT NULL DEFAULT 0,
    timer_ms    INTEGER NOT NULL DEFAULT 0,  -- of which the study timer was running
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, course_id, lesson_n, day)
  );
  CREATE INDEX study_time_course ON study_time(course_id);
  CREATE TABLE study_sessions (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT REFERENCES courses(id) ON DELETE SET NULL,
    kind        TEXT NOT NULL,               -- pomodoro | deep | custom
    ms          INTEGER NOT NULL,
    ended_at    INTEGER NOT NULL,
    key         TEXT NOT NULL,               -- from the browser, so a block is counted once
    UNIQUE (user_id, key)
  );
  CREATE INDEX study_sessions_user ON study_sessions(user_id, ended_at);
  CREATE TABLE study_pages (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    lesson_n    INTEGER NOT NULL,
    kind        TEXT NOT NULL,               -- recall | sq3r | mindmap | feynman (drafts)
    data        TEXT NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, course_id, lesson_n, kind)
  );
`);

// study_time has no foreign key on the course (time with no course is kept too), so a deleted
// course's time is cleared here.
q("DELETE FROM study_time WHERE course_id <> '' AND course_id NOT IN (SELECT id FROM courses)").run();

export const METHODS = ['recall', 'feynman', 'cornell', 'mindmap', 'sq3r', 'interleave', 'spaced', 'pomodoro'];
const KINDS = { recall: 40_000, sq3r: 60_000, mindmap: 120_000, feynman: 40_000 }; // feynman: drafts of explanations
const SESSION_KINDS = new Set(['pomodoro', 'deep', 'custom']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ENTRY = 12 * 3600_000; // one entry can't claim more than this (a long stretch saved offline)
const lessonN = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 2000 ? n : null; };

/* ---------------- the numbers ---------------- */

function courseNumbers(user, courseId) {
  const lessons = {};
  const at = (n) => (lessons[n] ||= { ms: 0, open: 0, fixed: 0, misses: 0, notYet: 0 });
  let ms = 0, timerMs = 0;
  for (const r of q('SELECT lesson_n, SUM(ms) AS ms, SUM(timer_ms) AS tms FROM study_time WHERE user_id = ? AND course_id = ? GROUP BY lesson_n').all(user.id, courseId)) {
    ms += r.ms; timerMs += r.tms;
    if (r.lesson_n > 0) at(r.lesson_n).ms = r.ms;
  }
  try {
    for (const r of q(`SELECT lesson_n, SUM(mastered_at IS NULL) AS open, SUM(mastered_at IS NOT NULL) AS fixed, SUM(misses) AS misses
        FROM review_items WHERE user_id = ? AND course_id = ? GROUP BY lesson_n`).all(user.id, courseId)) {
      Object.assign(at(r.lesson_n), { open: r.open, fixed: r.fixed, misses: r.misses });
    }
  } catch { /* no Review module */ }
  try {
    for (const r of q(`SELECT lesson_n, COUNT(*) AS n FROM answer_marks WHERE user_id = ? AND course_id = ? AND verdict = 'not yet' AND qid LIKE 'q%'
        GROUP BY lesson_n`).all(user.id, courseId)) at(r.lesson_n).notYet = r.n;
  } catch { /* no marking module */ }
  const s = q('SELECT COUNT(*) AS n FROM study_sessions WHERE user_id = ? AND course_id = ?').get(user.id, courseId);
  return { ms, timerMs, sessions: s.n, lessons };
}

const methodOf = (user, courseId) => {
  const r = q('SELECT method FROM study_methods WHERE user_id = ? AND course_id = ?').get(user.id, courseId);
  return r && METHODS.includes(r.method) ? r.method : '';
};
const methodsOf = (user) => {
  const out = {};
  q('SELECT course_id, method FROM study_methods WHERE user_id = ?').all(user.id).forEach((r) => { if (METHODS.includes(r.method)) out[r.course_id] = r.method; });
  return out;
};

async function getCourse({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  sendJSON(res, 200, { ok: true, method: methodOf(u, row.id), ...courseNumbers(u, row.id) });
}

async function putCourse({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const body = await readBody(req, 2_000);
  const method = typeof body.method === 'string' ? body.method : '';
  if (method && !METHODS.includes(method)) throw new HttpError('That study method isn’t one Primer knows.', 400);
  if (method) {
    q(`INSERT INTO study_methods (user_id, course_id, method, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, course_id) DO UPDATE SET method = excluded.method, updated_at = excluded.updated_at`).run(u.id, row.id, method, now());
  } else {
    q('DELETE FROM study_methods WHERE user_id = ? AND course_id = ?').run(u.id, row.id);
  }
  sendJSON(res, 200, { ok: true, method });
}

async function getMethods({ req, res }) {
  sendJSON(res, 200, { ok: true, methods: methodsOf(requireUser(req)) });
}

/* ---------------- what the methods keep per lesson ---------------- */

async function getPages({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const n = lessonN(params.n);
  if (!n) throw new HttpError('That lesson is not in the course.', 400);
  const out = { recall: {}, sq3r: {}, mindmap: {}, feynman: {}, feynmanMarks: {} };
  q('SELECT kind, data FROM study_pages WHERE user_id = ? AND course_id = ? AND lesson_n = ?').all(u.id, row.id, n)
    .forEach((r) => { if (KINDS[r.kind]) out[r.kind] = parseJSON(r.data, {}) || {}; });
  try {
    q("SELECT * FROM answer_marks WHERE user_id = ? AND course_id = ? AND lesson_n = ? AND qid LIKE 'f%'").all(u.id, row.id, n).forEach((m) => {
      out.feynmanMarks[m.qid.slice(1)] = {
        answer: m.answer, status: m.status, verdict: m.verdict || null, feedback: m.feedback || '',
        missing: parseJSON(m.missing, []), model: m.model || null, error: m.error || null, at: m.updated_at
      };
    });
  } catch { /* no marking module */ }
  sendJSON(res, 200, { ok: true, ...out });
}

async function putPage({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const n = lessonN(params.n);
  const kind = params.kind;
  if (!n) throw new HttpError('That lesson is not in the course.', 400);
  if (!KINDS[kind]) throw new HttpError('Unknown kind of study page.', 404);
  const body = await readBody(req, KINDS[kind] + 2_000);
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new HttpError('Nothing to save.', 400);
  const data = JSON.stringify(body.data);
  if (data.length > KINDS[kind]) throw new HttpError('That is too much to save for one lesson.', 413);
  const t = now();
  q(`INSERT INTO study_pages (user_id, course_id, lesson_n, kind, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, course_id, lesson_n, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .run(u.id, row.id, n, kind, data, t);
  sendJSON(res, 200, { ok: true, updatedAt: t });
}

/* ---------------- Feynman: an explanation of one part, marked like a written answer ---------------- */

const plain = (html) => String(html || '').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

markHooks.question = (row, n, qid) => {
  const m = /^f(\d{1,2})$/.exec(qid);
  if (!m) return null;
  const stored = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(row.id, n);
  const section = stored && (parseJSON(stored.data, {}).sections || [])[Number(m[1])];
  if (!section || typeof section.title !== 'string') return null;
  const points = (Array.isArray(section.recap) ? section.recap : []).map(plain).filter(Boolean);
  return {
    section,
    question: {
      id: qid,
      type: 'subjective',
      prompt: `Explain “${section.title}” in your own words, simply enough for a friend who has never studied it (the Feynman technique): what it is, why it matters, and an example. Judge whether the explanation is correct and clear, and whether it covers the part’s key ideas.`,
      model: points.length ? 'The key ideas of this part: ' + points.join(' ') : null
    }
  };
};

/* ---------------- study time ---------------- */

async function addTime({ req, res }) {
  const u = requireUser(req);
  if (overLimit('study-time:' + u.id, 600, 3600_000)) throw new HttpError('Too many saves. Try again in a few minutes.', 429);
  const body = await readBody(req, 40_000);
  const entries = Array.isArray(body.entries) ? body.entries.slice(0, 200) : [];
  const owned = new Map();
  const ownsCourse = (id) => {
    if (!owned.has(id)) owned.set(id, Boolean(q('SELECT 1 FROM courses WHERE id = ? AND user_id = ?').get(id, u.id)));
    return owned.get(id);
  };
  const t = now();
  let saved = 0;
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const course = typeof e.c === 'string' ? e.c : '';
    if (course && (!/^[A-Za-z0-9_-]{4,64}$/.test(course) || !ownsCourse(course))) continue;
    const n = course ? (lessonN(e.n) || 0) : 0;
    const day = typeof e.d === 'string' && DAY_RE.test(e.d) ? e.d : null;
    const ms = Math.round(Number(e.ms));
    const tms = Math.round(Number(e.tms) || 0);
    if (!day || !Number.isFinite(ms) || ms <= 0) continue;
    const add = Math.min(ms, MAX_ENTRY), addTimer = Math.max(0, Math.min(tms, add));
    q(`INSERT INTO study_time (user_id, course_id, lesson_n, day, ms, timer_ms, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, course_id, lesson_n, day) DO UPDATE SET
         ms = MIN(ms + excluded.ms, 86400000), timer_ms = MIN(timer_ms + excluded.timer_ms, 86400000), updated_at = excluded.updated_at`)
      .run(u.id, course, n, day, add, addTimer, t);
    saved++;
  }
  sendJSON(res, 200, { ok: true, saved });
}

async function addSession({ req, res }) {
  const u = requireUser(req);
  if (overLimit('study-session:' + u.id, 120, 3600_000)) throw new HttpError('Too many saves. Try again in a few minutes.', 429);
  const body = await readBody(req, 2_000);
  const key = text(body.key, 64);
  const kind = SESSION_KINDS.has(body.kind) ? body.kind : null;
  const ms = Math.round(Number(body.ms));
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(key) || !kind || !Number.isFinite(ms) || ms < 1000 || ms > 4 * 3600_000) {
    throw new HttpError('That session can’t be saved.', 400);
  }
  let courseId = null;
  if (body.courseId) {
    const r = q('SELECT id FROM courses WHERE id = ? AND user_id = ?').get(text(body.courseId, 64), u.id);
    courseId = r ? r.id : null;
  }
  q('INSERT OR IGNORE INTO study_sessions (user_id, course_id, kind, ms, ended_at, key) VALUES (?, ?, ?, ?, ?, ?)')
    .run(u.id, courseId, kind, ms, now(), key);
  sendJSON(res, 200, { ok: true });
}

async function today({ req, res, url }) {
  const u = requireUser(req);
  const day = url.searchParams.get('day');
  const since = Number(url.searchParams.get('since'));
  if (!DAY_RE.test(day || '') || !Number.isFinite(since)) throw new HttpError('Say which day.', 400);
  const t = q('SELECT COALESCE(SUM(ms), 0) AS ms FROM study_time WHERE user_id = ? AND day = ?').get(u.id, day);
  const s = q('SELECT COUNT(*) AS n FROM study_sessions WHERE user_id = ? AND ended_at >= ?').get(u.id, since);
  sendJSON(res, 200, { ok: true, ms: t.ms, sessions: s.n });
}

export const routes = [
  ['GET', /^\/api\/study\/course\/(?<id>[^/]+)$/, getCourse],
  ['PUT', /^\/api\/study\/course\/(?<id>[^/]+)$/, putCourse],
  ['GET', /^\/api\/study\/methods$/, getMethods],
  ['GET', /^\/api\/study\/pages\/(?<id>[^/]+)\/(?<n>\d+)$/, getPages],
  ['PUT', /^\/api\/study\/pages\/(?<id>[^/]+)\/(?<n>\d+)\/(?<kind>[a-z0-9]+)$/, putPage],
  ['POST', /^\/api\/study\/time$/, addTime],
  ['POST', /^\/api\/study\/session$/, addSession],
  ['GET', /^\/api\/study\/today$/, today]
];

// The methods are on every page, so a lesson can teach its way from the first moment.
export const boot = (user) => (user ? { studyMethods: methodsOf(user) } : {});

// The service worker's part: notifications for the timer and reminders (assets/js/sw-study.js).
swParts.push('sw-study.js');
