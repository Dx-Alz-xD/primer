// =====================================================================
// The shared topic library: one general course per subject, kept on the
// server and shared by every learner.
//
// A course request with NO teaching instructions (instructions change how
// lessons are written, so those courses stay personal) goes like this:
//   1. a cheap exact or normalised match against each subject and its
//      aliases ("Derivatives", "derivative", "the derivatives");
//   2. otherwise ONE small AI call with the library's subjects (and their
//      lesson titles when a range was asked for) that returns
//      { match, start, end, alias }; a match records the new alias, so
//      the same wording is matched for free next time;
//   3. otherwise a general outline of the whole subject becomes a new
//      library entry.
// The learner's course is then the slice of that outline covering their
// range (one more small AI call picks the cut when it isn't known yet).
// Lesson n of the course is library lesson offset + n. Library lessons
// are written once, in the context of the whole subject, and every later
// learner gets them instantly.
// =====================================================================
import { q, tx, now, schema, parseJSON } from './db.mjs';
import { HttpError, sendJSON, text } from './http.mjs';
import { requireUser } from './auth.mjs';
import { hooks, cleanMeta, flatten } from './data.mjs';
import { generateOutline, generateLesson, matchLibrary, pickLibraryCut } from './ai.mjs';

schema('library-1', `
  CREATE TABLE library (
    id          INTEGER PRIMARY KEY,
    subject     TEXT NOT NULL,
    aliases     TEXT NOT NULL DEFAULT '[]',  -- JSON: other names learners have used for it
    outline     TEXT NOT NULL,               -- JSON: { title, units } covering the whole subject
    model       TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE library_lessons (
    library_id  INTEGER NOT NULL REFERENCES library(id) ON DELETE CASCADE,
    n           INTEGER NOT NULL,
    data        TEXT NOT NULL,
    model       TEXT,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (library_id, n)
  );
`);

const MAX_CANDIDATES = 80;    // subjects shown to the AI when matching
const LESSON_BUDGET = 14_000; // characters of lesson titles shown alongside them
const MIN_SLICE = 4;          // a cut shorter than this gets an outline of its own instead
const MAX_ALIASES = 50;

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ---------------- names ---------------- */

// "The Derivatives", "derivative" and "intro to derivatives" all become "derivative".
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'with', 'about', 'intro', 'introduction',
  'basic', 'basics', 'beginner', 'beginners', 'fundamental', 'fundamentals', 'course', 'learn', 'learning']);
export function subjectKey(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w))
    .sort()
    .join(' ');
}

/* ---------------- entries ---------------- */

const entryOut = (r) => ({
  id: r.id, subject: r.subject, aliases: parseJSON(r.aliases, []), outline: parseJSON(r.outline, { title: '', units: [] }),
  model: r.model, createdAt: r.created_at
});
const getEntry = (id) => { const r = q('SELECT * FROM library WHERE id = ?').get(id); return r ? entryOut(r) : null; };

function findExact(name) {
  const key = subjectKey(name);
  if (!key) return null;
  for (const r of q('SELECT id, subject, aliases FROM library ORDER BY id').all()) {
    if (subjectKey(r.subject) === key || parseJSON(r.aliases, []).some((a) => subjectKey(a) === key)) return getEntry(r.id);
  }
  return null;
}

function addAlias(entry, alias) {
  const a = text(alias, 120).toLowerCase();
  const key = subjectKey(a);
  if (!key || subjectKey(entry.subject) === key) return;
  const owner = findExact(a);
  if (owner) return; // already known, here or as another subject
  tx(() => {
    const row = q('SELECT aliases FROM library WHERE id = ?').get(entry.id);
    const list = parseJSON(row && row.aliases, []);
    if (list.length >= MAX_ALIASES) return;
    list.push(a);
    q('UPDATE library SET aliases = ? WHERE id = ?').run(JSON.stringify(list), entry.id);
  });
}

// The subjects the AI may choose from. With a range, their lesson titles go too (within a
// budget), so the same call can say where to cut.
function candidates(withLessons) {
  let budget = LESSON_BUDGET;
  return q('SELECT * FROM library ORDER BY id DESC LIMIT ?').all(MAX_CANDIDATES).map((r) => {
    const e = entryOut(r);
    let lessons = null;
    if (withLessons) {
      const titles = flatten(e.outline.units).map((l) => l.title);
      const size = titles.reduce((n, t) => n + t.length + 6, 0);
      if (size <= budget) { lessons = titles; budget -= size; }
    }
    return { id: e.id, subject: e.subject, aliases: e.aliases, lessons };
  });
}

// A general outline of the whole subject becomes a new entry. Two learners asking for the
// same new subject at once share one outline and one entry.
const creating = new Map();
function createEntry(subject, topic) {
  const key = subjectKey(subject) || subject.toLowerCase();
  if (creating.has(key)) return creating.get(key);
  const job = (async () => {
    const known = findExact(subject);
    if (known) { addAlias(known, topic); return known; }
    const out = await generateOutline({ topic: subject, from: '', to: '', instructions: '' });
    const again = findExact(subject);
    if (again) { addAlias(again, topic); return again; }
    const id = Number(q('INSERT INTO library (subject, aliases, outline, model, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(subject, '[]', JSON.stringify(out.outline), out.model || null, now()).lastInsertRowid);
    const entry = getEntry(id);
    addAlias(entry, topic);
    console.log(`[library] new subject #${id} "${subject}" (${flatten(entry.outline.units).length} lessons)`);
    return entry;
  })().finally(() => creating.delete(key));
  creating.set(key, job);
  return job;
}

/* ---------------- where to cut ---------------- */

// Used only when the AI can't pick the cut: find the lessons whose titles share most words
// with the range's ends.
function guessCut(flat, from, to) {
  const words = flat.map((l) => new Set(subjectKey(`${l.title} ${l.desc}`).split(' ')));
  const find = (phrase, last) => {
    const want = subjectKey(phrase).split(' ').filter(Boolean);
    if (!want.length) return -1;
    let best = -1, bestScore = 0;
    words.forEach((have, i) => {
      const score = want.filter((w) => have.has(w)).length / want.length;
      if (score > bestScore || (last && score === bestScore && score > 0)) { best = i; bestScore = score; }
    });
    return bestScore >= 0.5 ? best : -1;
  };
  const s = from ? find(from, false) : 0;
  const e = to ? find(to, true) : flat.length - 1;
  return s >= 0 && e >= s ? { start: s + 1, end: e + 1 } : null;
}

async function chooseCut(entry, flat, input) {
  try {
    return (await pickLibraryCut({
      subject: entry.subject, from: input.from, to: input.to,
      outline: flat.map((l) => ({ n: l.n, unit: l.unit, title: l.title, desc: l.desc }))
    })).cut;
  } catch (err) {
    console.log(`[library] cut for "${input.topic}" fell back to matching titles: ${err.message}`);
    return guessCut(flat, input.from, input.to);
  }
}

function sliceUnits(outline, start, end) {
  const units = [];
  let n = 0;
  for (const u of outline.units) {
    const lessons = u.lessons.filter(() => { n++; return n >= start && n <= end; });
    if (lessons.length) units.push({ title: u.title, lessons });
  }
  return units;
}

/* ---------------- hooks into course planning and lesson writing ---------------- */

async function planCourse(user, input, style) {
  if (input.instructions) return null;
  if (input.lang && input.lang !== 'en') return null; // shared lessons are written in English
  const hasRange = Boolean(input.from || input.to);
  let entry = findExact(input.topic);
  let cut = null;
  let how = 'exact match';

  if (!entry) {
    let subject = '';
    const list = candidates(hasRange);
    if (list.length) {
      let m;
      try {
        m = (await matchLibrary({ topic: input.topic, from: input.from, to: input.to, entries: list })).result;
      } catch (err) {
        console.log(`[library] matching "${input.topic}" failed, so it gets its own outline: ${err.message}`);
        return null;
      }
      if (m.match) {
        entry = getEntry(m.match);
        how = 'AI match';
        addAlias(entry, input.topic);
        if (m.alias) addAlias(entry, m.alias);
        const shown = list.find((c) => c.id === entry.id);
        const total = flatten(entry.outline.units).length;
        if (hasRange && shown && shown.lessons && m.start && m.end && m.start <= m.end && m.end <= total) cut = { start: m.start, end: m.end };
      } else {
        subject = m.subject;
      }
    }
    if (!entry) {
      entry = await createEntry(cap(text(subject, 120)) || cap(input.topic), input.topic);
      how = 'new subject';
    }
  }

  const flat = flatten(entry.outline.units);
  if (!flat.length) return null;
  if (!cut) cut = hasRange ? await chooseCut(entry, flat, input) : { start: 1, end: flat.length };
  if (!cut || cut.end - cut.start + 1 < Math.min(MIN_SLICE, flat.length)) {
    console.log(`[library] "${input.topic}": no usable cut of "${entry.subject}", so it gets its own outline`);
    return null;
  }
  const whole = cut.start === 1 && cut.end === flat.length;
  const meta = cleanMeta({
    ...input,
    title: whole ? entry.outline.title || entry.subject : cap(input.topic),
    style, source: 'library', model: entry.model,
    units: sliceUnits(entry.outline, cut.start, cut.end),
    library: { id: entry.id, offset: cut.start - 1, subject: entry.subject, total: flat.length }
  });
  console.log(`[library] "${input.topic}" -> #${entry.id} "${entry.subject}", lessons ${cut.start}-${cut.end} of ${flat.length} (${how})`);
  return meta;
}

async function writeLesson(user, row, meta, n) {
  const lib = meta.library;
  if (meta.source !== 'library' || !lib || !Number.isInteger(lib.id) || !Number.isInteger(lib.offset) || lib.offset < 0) return null;
  const entry = getEntry(lib.id);
  if (!entry) return null;
  const flat = flatten(entry.outline.units);
  const libN = lib.offset + n;
  const theirs = flat[libN - 1];
  const mine = flatten(meta.units || [])[n - 1];
  if (!theirs || !mine || text(theirs.title, 140) !== mine.title) return null; // no longer lines up: write it the usual way
  const have = q('SELECT data, model FROM library_lessons WHERE library_id = ? AND n = ?').get(entry.id, libN);
  if (have) return { lesson: parseJSON(have.data), model: have.model };
  const out = await generateLesson({
    topic: entry.subject, from: '', to: '', instructions: '',
    courseTitle: entry.outline.title || entry.subject, n: libN,
    outline: flat.map((l) => ({ n: l.n, unit: l.unit, title: l.title, desc: l.desc }))
  });
  q('INSERT OR IGNORE INTO library_lessons (library_id, n, data, model, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(entry.id, libN, JSON.stringify(out.lesson), out.model || null, now());
  return { lesson: out.lesson, model: out.model };
}

hooks.planCourse = planCourse;
hooks.writeLesson = writeLesson;

/* ---------------- routes ---------------- */

function summary(e) {
  const total = flatten(e.outline.units).length;
  return {
    id: e.id, subject: e.subject, title: e.outline.title || e.subject, aliases: e.aliases, lessons: total,
    written: q('SELECT COUNT(*) AS n FROM library_lessons WHERE library_id = ?').get(e.id).n,
    learners: q("SELECT COUNT(DISTINCT user_id) AS n FROM courses WHERE json_extract(data, '$.source') = 'library' AND json_extract(data, '$.library.id') = ?").get(e.id).n,
    createdAt: e.createdAt
  };
}

async function listLibrary({ req, res }) {
  requireUser(req);
  const rows = q('SELECT * FROM library ORDER BY lower(subject) LIMIT 500').all();
  sendJSON(res, 200, { ok: true, subjects: rows.map((r) => summary(entryOut(r))) });
}

async function getSubject({ req, res, params }) {
  requireUser(req);
  const e = getEntry(Number(params.id));
  if (!e) throw new HttpError('That subject isn’t in the shared library.', 404);
  sendJSON(res, 200, { ok: true, subject: summary(e) });
}

export const routes = [
  ['GET', /^\/api\/library$/, listLibrary],
  ['GET', /^\/api\/library\/(?<id>\d+)$/, getSubject]
];
