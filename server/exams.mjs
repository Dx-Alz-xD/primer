// =====================================================================
// Exams, tests and the skill passport.
//
// Unit exams. Every unit has an exam of 10 questions: 7 multiple choice
// and 3 answered in the learner's own words, with 25 minutes on the
// clock. A unit's lessons open once the exam of every unit before it is
// passed (60%), so a learner moves on, or skips ahead, by passing exams.
// The AI writes each exam from the unit's written lessons (a lesson not
// written yet is described by its outline line), and its questions go
// through the same checks as a lesson's (ai.mjs normQuestion). Every
// attempt gets fresh questions: the ones already asked are listed in the
// request as questions not to repeat. A failed exam can be taken again
// after a short pause (PRIMER_EXAM_PAUSE_MINUTES, default 10).
//
// Final exam. 2 multiple-choice and 1 written question from every unit,
// timed by the number of units. Passing it marks the course completed
// and issues a certificate for the skill passport.
//
// Custom tests. Any lessons, any number of each kind of question, with
// or without a timer; kept so they can be taken again or printed.
//
// Marking. Multiple choice is checked here (the browser never sees an
// answer before the exam is handed in); a written answer is marked by
// the same AI marking as a lesson's (marking.mjs): good 1, partly 0.5,
// not yet 0. The timer is kept here too: an exam still open after its
// time is handed in with the answers saved so far. Missed questions join
// the learner's wrong answers (the tutor's memory) and come back in
// Review (review.mjs finds them through reviewHooks).
//
// Printing. Every test, a paper copy of any exam (fresh questions, so a
// class without devices can sit it) and a finished attempt print as a
// clean paper with a separate answer key (paper.html). A teacher can
// print a worksheet of the questions their class gets wrong most.
//
// Skill passport. A certificate per completed course: name, course,
// language, date, final exam score, units passed, lessons completed and
// mistakes fixed, with a short code. verify.html?code=… shows the same
// facts to anyone, signed in or not; its holder can hide it.
//
//   GET    /api/courses/:id/exams                 units, final exam, tests, passport: what is open and passed
//   POST   /api/courses/:id/exams/unit/:u         start (or carry on with) a unit exam
//   POST   /api/courses/:id/exams/final           start (or carry on with) the final exam
//   POST   /api/courses/:id/exams/unit/:u/paper   a paper copy of a unit exam, to print
//   POST   /api/courses/:id/exams/final/paper     a paper copy of the final exam
//   POST   /api/courses/:id/tests                 { lessons, choice, written, minutes, title } make a test
//   GET    /api/tests/:tid                        a test, with its answers (to print it)
//   DELETE /api/tests/:tid
//   POST   /api/tests/:tid/start                  take a test
//   GET    /api/exams/:aid                        an attempt (answers only once it's handed in)
//   GET    /api/exams/:aid/paper                  a handed-in attempt, to print
//   PUT    /api/exams/:aid/answers                { answers } saved as the learner goes
//   POST   /api/exams/:aid/submit                 { answers } hand it in and mark it
//   POST   /api/exams/:aid/remark                 mark written answers that couldn't be marked
//   GET    /api/classes/:cid/worksheet            the class's most-missed questions, to print
//   GET    /api/passports                         the learner's certificates
//   GET    /api/passports/:code                   one of them
//   PATCH  /api/passports/:code                   { hidden } hide it from the public, or show it again
//   GET    /api/verify/:code                      public: check a certificate
// =====================================================================
import crypto from 'node:crypto';
import { q, schema, now, parseJSON } from './db.mjs';
import { HttpError, sendJSON, readBody, text, longText, overLimit, clientIp } from './http.mjs';
import { requireUser } from './auth.mjs';
import { askJSON, config, normQuestion, LANG_NAMES } from './ai.mjs';
import { ownCourse, flatten, mistakeHooks } from './data.mjs';
import { reviewHooks } from './review.mjs';
import { SYSTEM as MARK_SYSTEM, validateMark, markUser } from './marking.mjs';
import { lessonText, support } from './tutor.mjs';
import { screen, courseSafety, promptNote } from './safety.mjs';

schema('exams-1', `
  CREATE TABLE exam_tests (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,              -- test (made by the learner) | paper (a paper copy of an exam)
    unit        INTEGER,                    -- a paper copy's unit; 0 for the final exam
    title       TEXT NOT NULL DEFAULT '',
    lessons     TEXT NOT NULL,              -- JSON: the lesson numbers it covers
    choice      INTEGER NOT NULL,
    written     INTEGER NOT NULL,
    minutes     INTEGER,                    -- NULL: no timer
    questions   TEXT NOT NULL,              -- JSON, with their answers
    model       TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX exam_tests_course ON exam_tests(user_id, course_id, created_at DESC);

  CREATE TABLE exam_attempts (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,             -- unit | final | test
    unit         INTEGER,                   -- a unit exam's unit (1, 2, ...)
    test_id      INTEGER REFERENCES exam_tests(id) ON DELETE SET NULL,
    questions    TEXT NOT NULL,             -- JSON: [{ type, prompt, choices, answer, explain, model, lesson }]
    answers      TEXT NOT NULL DEFAULT '{}',-- JSON: { "1": 2, "8": "my answer" }, saved as the learner goes
    marks        TEXT,                      -- JSON: { "1": { right }, "8": { verdict, feedback, missing } }
    status       TEXT NOT NULL DEFAULT 'open', -- open | marking | done
    score        REAL,
    total        INTEGER,
    passed       INTEGER,
    duration     INTEGER,                   -- seconds allowed; NULL: no timer
    model        TEXT,
    started_at   INTEGER NOT NULL,
    submitted_at INTEGER,
    marked_at    INTEGER
  );
  CREATE INDEX exam_attempts_course ON exam_attempts(user_id, course_id, kind, unit);

  CREATE TABLE passports (
    code        TEXT PRIMARY KEY,           -- XXXX-XXXX, no 0/O/1/I
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT REFERENCES courses(id) ON DELETE SET NULL,
    attempt_id  INTEGER,
    data        TEXT NOT NULL,              -- JSON: the facts on the certificate, as they were when it was earned
    hidden      INTEGER NOT NULL DEFAULT 0, -- 1: its holder took it off the public page
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX passports_user ON passports(user_id, created_at DESC);
`);

/* ---------------- settings ---------------- */

export const PASS_MARK = 0.6;
const UNIT_EXAM = { choice: 7, written: 3, minutes: 25 };
const FINAL_EACH = { choice: 2, written: 1 }; // from every unit
const finalMinutes = (units) => Math.min(150, Math.max(15, 10 + 7 * units));
const pauseMs = () => {
  const v = Number(process.env.PRIMER_EXAM_PAUSE_MINUTES);
  return (process.env.PRIMER_EXAM_PAUSE_MINUTES && Number.isFinite(v) && v >= 0 ? v : 10) * 60_000;
};
const GRACE = 45_000; // an exam handed in as the clock runs out still counts
const TEST = { choice: 20, written: 5, total: 25, lessons: 80, minMinutes: 5, maxMinutes: 180 };
const SCORE = { good: 1, partly: 0.5, 'not yet': 0 };
const UNITS_PER_CALL = 4; // a final exam of a long course is written in parts, side by side

// For other features (the knowledge map, say): told when an attempt has its result.
// afterResult(user, courseId, summary) where summary is examSummary's shape for that course.
export const examHooks = { afterResult: null };

/* ---------------- small helpers ---------------- */

const arr = (v) => (Array.isArray(v) ? v : []);
const plain = (html) => String(html || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const keyOf = (s) => plain(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const roman = (n) => ROMAN[n - 1] || String(n);
const langLine = (lang) => (lang && lang !== 'en' && LANG_NAMES[lang] ? `Language: write everything in ${LANG_NAMES[lang]} (keep LaTeX as LaTeX).` : '');
const langName = (lang) => String(LANG_NAMES[lang] || 'English').replace(/\s*\(.*\)\s*$/, '');

function courseParts(row) {
  const meta = parseJSON(row.data, {});
  const flat = flatten(meta.units || []);
  const units = (meta.units || []).map((u, i) => ({ unit: i + 1, title: u.title, lessons: flat.filter((l) => l.unitIndex === i + 1) }));
  return { meta, flat, units };
}

// A teacher previewing the course they teach as a class isn't held back by its exams.
function teaches(user, courseId) {
  try { return Boolean(q('SELECT 1 FROM classes WHERE course_id = ? AND owner_id = ? LIMIT 1').get(courseId, user.id)); } catch { return false; }
}
const gatingOn = (user, row) => config().ai && !teaches(user, row.id);

const passedUnits = (userId, courseId) => new Set(q(`SELECT DISTINCT unit FROM exam_attempts
  WHERE user_id = ? AND course_id = ? AND kind = 'unit' AND status = 'done' AND passed = 1`).all(userId, courseId).map((r) => r.unit));

const deadlineOf = (a) => (a.duration ? a.started_at + a.duration * 1000 : null);
const pastTime = (a, t = now()) => { const d = deadlineOf(a); return d != null && t > d + GRACE; };

function examName(a, units) {
  if (a.kind === 'unit') return `Unit ${roman(a.unit)} exam${units && units[a.unit - 1] ? `: ${units[a.unit - 1].title}` : ''}`;
  if (a.kind === 'final') return 'Final exam';
  return 'Test';
}

/* ---------------- writing questions ---------------- */

const EXAM_SYSTEM = String.raw`You write exam questions for an online course, as JSON. You get the lessons the exam covers (each lesson's text, or, for a lesson not written yet, its title and what it teaches) and how many questions of each kind to write.
Return ONLY a JSON object (no prose, no code fences) shaped like this:
{"questions": [
  {"type": "choice", "lesson": 3, "prompt": "...", "choices": ["...", "...", "...", "..."], "answer": 2, "explain": "..."},
  {"type": "subjective", "lesson": 4, "prompt": "Explain in your own words ...", "model": "a model answer in 2 to 4 sentences"}
]}
Rules:
- Write exactly the questions asked for: the "choice" (multiple-choice) ones first, then the "subjective" (written) ones.
- "lesson" is the number of the lesson the question tests. Spread the questions across all the lessons listed, covering their most important ideas.
- Multiple choice: 4 choices with exactly one right answer; "answer" is the index (0 to 3) of the right one, in varied positions. Wrong choices are believable mistakes a learner might make, never jokes, and never "all of the above" or "none of the above". "explain" says in one or two sentences why the right answer is right.
- Test understanding and use of the ideas (apply, compare, predict, spot the error), not memory of the lesson's wording. Every question stands on its own: never write "in the lesson", "in the example above" or "as we saw".
- Written questions ask the learner to explain, compare or apply an idea in 2 to 5 sentences, and can be answered from the lessons alone. "model" is a good answer in 2 to 4 sentences.
- Questions must be new: never repeat or reword a question listed under "Already asked".
- Be factually correct. Numeric answers must be exactly computable from the question.
- Every piece of maths, everywhere (prompts, choices, explanations, model answers), goes inside \\( and \\). Never use $ for maths.
- Safety: keep dangerous subjects at the level of a school textbook, and never ask for instructions, recipes, ingredients or quantities for causing harm.
- Write in the language the request names (English unless it names another); maths stays LaTeX. This is JSON: every backslash in LaTeX must be written twice, for example "\\frac{1}{2}" and "\\(x\\)".`;

// groups: [{ label, lessons: [flat lesson], choice, written }]
function examUser({ meta, row, groups, avoid, what, safety }) {
  const lessons = groups.flatMap((g) => g.lessons);
  const per = Math.max(350, Math.min(2200, Math.floor(18000 / Math.max(1, lessons.length))));
  return [
    `Course: "${meta.title || meta.topic}", on ${meta.topic}, from ${meta.from || 'the very beginning'} to ${meta.to || 'the end of the subject'}.`,
    meta.instructions ? `Teaching instructions from the learner: ${meta.instructions}` : '',
    what,
    '',
    'The lessons it covers:',
    ...lessons.map((l) => {
      const body = lessonText(row.id, l.n, null, per);
      return `### Lesson ${l.n}: "${l.title}" (Unit ${l.unitIndex}: ${l.unit})\n${body || `Not written yet. What it teaches: ${l.desc || l.title}`}`;
    }),
    '',
    'Write these questions:',
    ...groups.map((g) => `- ${g.label}: ${g.choice} multiple-choice and ${g.written} written question${g.written === 1 ? '' : 's'}.`),
    avoid.length ? `\nAlready asked (write different questions):\n${avoid.map((s) => `- ${s}`).join('\n')}` : '',
    langLine(meta.lang),
    promptNote(safety)
  ].filter(Boolean).join('\n');
}

// The questions the AI wrote, checked like a lesson's, shared out to the groups that asked for them.
function pickQuestions(raw, groups, avoidKeys) {
  const where = new Map();
  groups.forEach((g, gi) => g.lessons.forEach((l) => where.set(l.n, gi)));
  const seen = new Set(avoidKeys);
  const pool = [];
  for (const x of arr(raw && (raw.questions || raw.exam || raw.items))) {
    const nq = normQuestion(x);
    if (!nq || (nq.type !== 'choice' && nq.type !== 'subjective')) continue;
    if (nq.type === 'choice' && nq.choices.length < 3) continue;
    const key = keyOf(nq.prompt);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const n = Math.round(Number(String(x.lesson ?? x.lesson_n ?? x.n ?? '').replace(/[^\d]+/g, '')));
    pool.push({ q: nq, n: where.has(n) ? n : null, g: where.has(n) ? where.get(n) : null, used: false });
  }
  const picked = groups.map(() => []);
  const take = (gi, type, count, from) => {
    for (const p of pool) {
      if (picked[gi].filter((x) => x.q.type === type).length >= count) break;
      if (!p.used && p.q.type === type && from(p)) { p.used = true; picked[gi].push(p); }
    }
  };
  groups.forEach((g, gi) => ['choice', 'subjective'].forEach((type) => take(gi, type, type === 'choice' ? g.choice : g.written, (p) => p.g === gi)));
  // a group the AI wrote too few for takes questions it didn't place, then the others' spares
  groups.forEach((g, gi) => ['choice', 'subjective'].forEach((type) => {
    const want = type === 'choice' ? g.choice : g.written;
    take(gi, type, want, (p) => p.g == null);
    take(gi, type, want, () => true);
    if (picked[gi].filter((x) => x.q.type === type).length < want) throw new Error(`too few ${type} questions`);
  }));
  const out = [];
  ['choice', 'subjective'].forEach((type) => groups.forEach((g, gi) => {
    let r = 0;
    picked[gi].filter((p) => p.q.type === type).forEach((p) => {
      const n = p.g === gi && p.n ? p.n : g.lessons[r++ % g.lessons.length].n;
      const base = { type, prompt: p.q.prompt, lesson: n };
      out.push(type === 'choice'
        ? { ...base, choices: p.q.choices, answer: p.q.answer, explain: p.q.explain || '' }
        : { ...base, model: p.q.model || null });
    });
  }));
  return out;
}

// What was asked before in these lessons' exams and tests, so new ones are different.
function askedBefore(userId, courseId, kind, unit) {
  const rows = kind === 'test'
    ? []
    : q(`SELECT questions FROM exam_attempts WHERE user_id = ? AND course_id = ? AND kind = ? AND (unit IS ? OR unit = ?) ORDER BY id DESC LIMIT 6`)
      .all(userId, courseId, kind, unit ?? null, unit ?? -1)
      .concat(q('SELECT questions FROM exam_tests WHERE user_id = ? AND course_id = ? AND kind = \'paper\' AND unit IS ? ORDER BY id DESC LIMIT 4')
        .all(userId, courseId, kind === 'final' ? 0 : unit ?? null));
  const prompts = rows.flatMap((r) => arr(parseJSON(r.questions, [])).map((x) => x && x.prompt)).filter(Boolean);
  return [...new Set(prompts)].slice(0, 40);
}

async function writeQuestions({ user, row, meta, groups, avoid, what, label }) {
  if (!config().ai) throw new HttpError('Exams are written by the AI, and there is no AI key yet. Add one to .env and restart the server.', 503);
  const safety = courseSafety(meta);
  if (safety && safety.kind === 'refuse') throw new HttpError('Primer can’t make a test on that.', 400);
  const avoidKeys = avoid.map(keyOf);
  const avoidLines = avoid.slice(0, 30).map((p) => plain(p).slice(0, 160));
  const batches = [];
  for (let i = 0; i < groups.length; i += UNITS_PER_CALL) batches.push(groups.slice(i, i + UNITS_PER_CALL));
  const parts = await Promise.all(batches.map((part, bi) => {
    const count = part.reduce((s, g) => s + g.choice + g.written, 0);
    return askJSON({
      system: EXAM_SYSTEM,
      user: examUser({ meta, row, groups: part, avoid: avoidLines, what, safety }),
      maxTokens: Math.min(14000, 1800 + 420 * count),
      timeoutMs: 100000,
      deadlineMs: 240000,
      validate: (raw) => pickQuestions(raw, part, avoidKeys),
      label: `${label}${batches.length > 1 ? ` (part ${bi + 1} of ${batches.length})` : ''}`
    });
  }));
  const qs = parts.flatMap((p) => p.value);
  // multiple choice first, then the written answers, as on a paper
  qs.sort((a, b) => (a.type === b.type ? 0 : a.type === 'choice' ? -1 : 1));
  return { questions: qs, model: parts[0].model };
}

const unitGroup = (u, counts) => ({
  label: `Unit ${u.unit} (lesson${u.lessons.length > 1 ? `s ${u.lessons[0].n} to ${u.lessons[u.lessons.length - 1].n}` : ` ${u.lessons[0].n}`})`,
  lessons: u.lessons, choice: counts.choice, written: counts.written
});

function examPlan(kind, units, unit) {
  if (kind === 'unit') {
    const u = units[unit - 1];
    return {
      groups: [unitGroup(u, UNIT_EXAM)], minutes: UNIT_EXAM.minutes,
      what: `This is the end-of-unit exam for Unit ${u.unit}, "${u.title}": it decides whether the learner moves on to the next unit.`
    };
  }
  return {
    groups: units.map((u) => unitGroup(u, FINAL_EACH)), minutes: finalMinutes(units.length),
    what: 'This is the final exam of the whole course: passing it completes the course. Ask about each unit\'s most important ideas.'
  };
}

// One request at a time per exam: a second click waits for the first.
const making = new Map();
function once(key, job) {
  if (making.has(key)) return making.get(key);
  const p = job().finally(() => making.delete(key));
  making.set(key, p);
  return p;
}

function limitMaking(user) {
  if (overLimit('exam-make:' + user.id, 24, 3600_000)) throw new HttpError('You’ve made a lot of exams and tests this hour. Try again a little later.', 429);
}

/* ---------------- attempts ---------------- */

function cleanAnswers(qs, raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  qs.forEach((x, i) => {
    const k = String(i + 1);
    const v = raw[k];
    if (v == null || v === '') return;
    if (x.type === 'choice') {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n < x.choices.length) out[k] = n;
    } else {
      const s = longText(v, 3000);
      if (s) out[k] = s;
    }
  });
  return out;
}

const getAttempt = (user, id) => {
  const n = Number(id);
  const a = Number.isSafeInteger(n) ? q('SELECT * FROM exam_attempts WHERE id = ? AND user_id = ?').get(n, user.id) : null;
  if (!a) throw new HttpError('That exam doesn’t exist.', 404);
  return a;
};

// Hands an open attempt in: from now on its answers can't change.
function handIn(a, answers) {
  const t = now();
  const d = deadlineOf(a);
  const late = pastTime(a, t);
  const saved = parseJSON(a.answers, {}) || {};
  const final = answers && !late ? { ...saved, ...answers } : saved;
  q("UPDATE exam_attempts SET status = 'marking', answers = ?, submitted_at = ? WHERE id = ? AND status = 'open'")
    .run(JSON.stringify(final), d != null ? Math.min(t, d) : t, a.id);
}

// Exams left open past their time are handed in with what was saved, and marked in the background.
function closeExpired(userId, courseId) {
  const open = q("SELECT * FROM exam_attempts WHERE user_id = ? AND course_id = ? AND status = 'open' AND duration IS NOT NULL").all(userId, courseId);
  for (const a of open) {
    if (!pastTime(a)) continue;
    handIn(a, null);
    markAttempt(a.id).catch((err) => console.error('[exams]', err));
  }
}

const inflight = new Map();
function markAttempt(id) {
  if (inflight.has(id)) return inflight.get(id);
  const job = doMark(id).finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

async function markOne(user, row, meta, flat, a, units, { x, answer }) {
  const own = screen(answer);
  const s = own || courseSafety(meta);
  if (s && s.kind === 'refuse') return { verdict: 'not yet', feedback: '', missing: [], refused: true };
  const l = flat[(x.lesson || 1) - 1] || flat[0] || { n: 1, title: meta.title || 'this course', desc: '' };
  if (overLimit('exam-mark:' + user.id, 90, 3600_000)) return { error: 'You’ve had a lot of answers marked this hour. Try again a little later.' };
  try {
    const out = await askJSON({
      system: MARK_SYSTEM(user.lang),
      user: markUser({
        meta, n: l.n, lessonTitle: l.title, section: { title: examName(a, units) },
        lesson: lessonText(row.id, l.n, null, 2500) || l.desc || '', question: x, answer, safety: s
      }),
      maxTokens: 900,
      timeoutMs: 45000,
      deadlineMs: 90000,
      validate: validateMark,
      label: `mark exam ${a.id}`
    });
    return { ...out.value, model: out.model };
  } catch (err) {
    return { error: text(err.message, 300), ...(own && own.kind === 'selfharm' ? { support: support(user.lang) } : {}) };
  }
}

async function doMark(id) {
  const a = q('SELECT * FROM exam_attempts WHERE id = ?').get(id);
  if (!a || a.status !== 'marking') return a;
  const user = q('SELECT id, name, email, lang FROM users WHERE id = ?').get(a.user_id);
  const row = q('SELECT * FROM courses WHERE id = ?').get(a.course_id);
  if (!user || !row) return a;
  const { meta, flat, units } = courseParts(row);
  const qs = arr(parseJSON(a.questions, []));
  const answers = parseJSON(a.answers, {}) || {};
  const marks = parseJSON(a.marks, {}) || {};
  const todo = [];
  qs.forEach((x, i) => {
    const k = String(i + 1);
    const given = answers[k];
    if (x.type === 'choice') { marks[k] = { right: Number.isInteger(given) && given === x.answer }; return; }
    if (marks[k] && marks[k].verdict) return;
    const written = typeof given === 'string' ? given.trim() : '';
    if (written.length < 2) { marks[k] = { verdict: 'not yet', blank: true, feedback: '', missing: [] }; return; }
    todo.push({ k, x, answer: written });
  });
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const job = todo[next++];
      marks[job.k] = await markOne(user, row, meta, flat, a, units, job);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const waiting = qs.some((x, i) => x.type === 'subjective' && !(marks[String(i + 1)] && marks[String(i + 1)].verdict));
  if (waiting) {
    q('UPDATE exam_attempts SET marks = ? WHERE id = ?').run(JSON.stringify(marks), id);
    return q('SELECT * FROM exam_attempts WHERE id = ?').get(id);
  }
  let score = 0;
  qs.forEach((x, i) => {
    const m = marks[String(i + 1)] || {};
    score += x.type === 'choice' ? (m.right ? 1 : 0) : SCORE[m.verdict] || 0;
  });
  const total = qs.length;
  const passed = total > 0 && score >= PASS_MARK * total - 1e-9 ? 1 : 0;
  const changed = Number(q(`UPDATE exam_attempts SET marks = ?, score = ?, total = ?, passed = ?, status = 'done', marked_at = ?
    WHERE id = ? AND status = 'marking'`).run(JSON.stringify(marks), score, total, passed, now(), id).changes);
  const done = q('SELECT * FROM exam_attempts WHERE id = ?').get(id);
  if (changed) {
    try { afterResult(user, row, meta, flat, done, qs, answers, marks); } catch (err) { console.error('[exams]', err); }
  }
  return done;
}

// Missed questions join the wrong answers (the tutor's memory) and come back in Review;
// passing the final exam completes the course and issues its certificate.
function afterResult(user, row, meta, flat, a, qs, answers, marks) {
  qs.forEach((x, i) => {
    const k = String(i + 1);
    const m = marks[k] || {};
    const l = flat[(x.lesson || 1) - 1] || {};
    if (x.type === 'choice' && !m.right) {
      const given = answers[k];
      remember(user, row.id, l.n || null, l.title, `ex${a.id}-${k}`, x.prompt,
        Number.isInteger(given) ? plain(x.choices[given]) : '', plain(x.choices[x.answer]));
    } else if (x.type === 'subjective' && m.verdict === 'not yet') {
      remember(user, row.id, l.n || null, l.title, `ex${a.id}-${k}`, x.prompt,
        typeof answers[k] === 'string' ? answers[k] : '', x.model ? plain(x.model) : arr(m.missing).join('; '));
    }
  });
  q('DELETE FROM mistakes WHERE user_id = ? AND id NOT IN (SELECT id FROM mistakes WHERE user_id = ? ORDER BY created_at DESC LIMIT 500)').run(user.id, user.id);
  if (a.kind === 'final' && a.passed) issuePassport(user, row, meta, flat, a);
  if (examHooks.afterResult) examHooks.afterResult(user, row.id, examSummary(user.id, row.id));
}

function remember(user, courseId, n, lessonTitle, qid, prompt, given, correct) {
  q('INSERT INTO mistakes (user_id, course_id, lesson_n, lesson_title, prompt, given, correct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, courseId, n, text(lessonTitle, 140) || null, plain(prompt).slice(0, 600) || 'An exam question', text(given, 300) || null, text(correct, 300) || null, now());
  // the same hook a lesson's wrong answer goes through: Review schedules the question (multiple choice only)
  if (mistakeHooks.afterRecord && n) mistakeHooks.afterRecord(user, courseId, { qid, lesson: n, lessonTitle, prompt: plain(prompt), given, correct });
}

// Exam questions come back in Review like a lesson's (review.mjs asks for them by their id, ex<attempt>-<k>).
const reviewBefore = reviewHooks.extraQuestion;
reviewHooks.extraQuestion = (courseId, n, qid) => {
  const m = /^ex(\d{1,12})-(\d{1,3})$/.exec(String(qid));
  if (!m) return reviewBefore ? reviewBefore(courseId, n, qid) : null;
  const a = q('SELECT course_id, kind, unit, questions FROM exam_attempts WHERE id = ?').get(Number(m[1]));
  if (!a || a.course_id !== courseId) return null;
  const x = arr(parseJSON(a.questions, []))[Number(m[2]) - 1];
  if (!x || x.type !== 'choice') return null;
  return { q: { id: qid, type: 'choice', prompt: x.prompt, choices: x.choices, answer: x.answer, explain: x.explain || '' }, section: { title: examName(a) } };
};

/* ---------------- what the browser sees ---------------- */

function attemptOut(a, row) {
  const { meta, flat, units } = courseParts(row);
  const qs = arr(parseJSON(a.questions, []));
  const handedIn = a.status !== 'open';
  const marks = handedIn ? parseJSON(a.marks, {}) || {} : {};
  const test = a.test_id ? q('SELECT id, kind, unit, title, lessons FROM exam_tests WHERE id = ?').get(a.test_id) : null;
  const passedLater = a.kind !== 'test' && a.status === 'done' && !a.passed
    ? q(`SELECT 1 FROM exam_attempts WHERE user_id = ? AND course_id = ? AND kind = ? AND unit IS ? AND status = 'done' AND passed = 1 LIMIT 1`)
      .get(a.user_id, a.course_id, a.kind, a.unit ?? null)
    : null;
  const nextUnit = a.kind === 'unit' ? units[a.unit] : null;
  return {
    id: a.id, kind: a.kind, unit: a.unit, status: a.status,
    test: test ? { id: test.id, kind: test.kind, title: test.title, lessons: parseJSON(test.lessons, []) } : null,
    course: { id: row.id, title: meta.title || meta.topic || 'Untitled course', lang: meta.lang || 'en', units: units.length, source: meta.source || 'sample' },
    unitTitle: a.unit && units[a.unit - 1] ? units[a.unit - 1].title : null,
    lessons: a.kind === 'unit' && units[a.unit - 1] ? units[a.unit - 1].lessons.map((l) => l.n) : null,
    next: nextUnit ? { unit: nextUnit.unit, title: nextUnit.title, lesson: nextUnit.lessons[0].n } : null,
    startedAt: a.started_at, duration: a.duration, deadline: deadlineOf(a), now: now(), submittedAt: a.submitted_at,
    score: a.score, total: a.total || qs.length, passed: a.passed == null ? null : Boolean(a.passed), passMark: PASS_MARK,
    retakeAt: (a.kind === 'unit' || a.kind === 'final') && a.status === 'done' && !a.passed && !passedLater ? a.submitted_at + pauseMs() : null,
    questions: qs.map((x, i) => {
      const k = i + 1;
      const l = flat[(x.lesson || 1) - 1];
      const o = { k, type: x.type, prompt: x.prompt, lesson: x.lesson || null, lessonTitle: l ? l.title : null };
      if (x.type === 'choice') o.choices = x.choices;
      if (handedIn) {
        if (x.type === 'choice') { o.answer = x.answer; o.explain = x.explain || ''; } else o.model = x.model || null;
        const m = marks[String(k)];
        if (m) o.mark = m;
      }
      return o;
    }),
    answers: parseJSON(a.answers, {}) || {}
  };
}

function testOut(t, full) {
  const out = {
    id: t.id, kind: t.kind, unit: t.unit, title: t.title, lessons: parseJSON(t.lessons, []),
    choice: t.choice, written: t.written, minutes: t.minutes, createdAt: t.created_at
  };
  if (full) out.questions = arr(parseJSON(t.questions, []));
  return out;
}

const scoreOut = (a) => ({ id: a.id, score: a.score, total: a.total, pct: a.total ? Math.round((100 * a.score) / a.total) : 0, passed: Boolean(a.passed), at: a.submitted_at });

function summarize(list, pause) {
  const done = list.filter((a) => a.status === 'done');
  const passedA = done.find((a) => a.passed) || null;
  const best = done.reduce((b, a) => (!b || a.score / a.total > b.score / b.total ? a : b), null);
  const last = done[done.length - 1] || null;
  const open = list.find((a) => a.status === 'open') || null;
  const marking = list.find((a) => a.status === 'marking') || null;
  const retakeAt = !passedA && last && !last.passed ? last.submitted_at + pause : null;
  return {
    attempts: done.length, passed: Boolean(passedA), passedAt: passedA ? passedA.submitted_at : null,
    best: best ? scoreOut(best) : null, last: last ? scoreOut(last) : null,
    current: open ? { id: open.id, deadline: deadlineOf(open) } : null,
    marking: marking ? { id: marking.id } : null,
    retakeAt: retakeAt && retakeAt > now() ? retakeAt : null
  };
}

// How each lesson did in exams and tests: questions asked and points scored (a written answer can score half).
function lessonStats(userId, courseId) {
  const out = {};
  for (const a of q("SELECT questions, marks FROM exam_attempts WHERE user_id = ? AND course_id = ? AND status = 'done'").all(userId, courseId)) {
    const marks = parseJSON(a.marks, {}) || {};
    arr(parseJSON(a.questions, [])).forEach((x, i) => {
      if (!x || !x.lesson) return;
      const m = marks[String(i + 1)] || {};
      const s = (out[x.lesson] ||= { asked: 0, right: 0 });
      s.asked++;
      s.right += x.type === 'choice' ? (m.right ? 1 : 0) : SCORE[m.verdict] || 0;
    });
  }
  return out;
}

// Exam results for one course, for other features (the knowledge map shows mastery per lesson):
// { units: [{ unit, title, passed, bestPct, attempts }], final: { passed, bestPct }, completed, lessons: { n: { asked, right } } }
export function examSummary(userId, courseId) {
  const row = q('SELECT * FROM courses WHERE id = ? AND user_id = ?').get(courseId, userId);
  if (!row) return null;
  const { units } = courseParts(row);
  const pause = pauseMs();
  const all = q('SELECT * FROM exam_attempts WHERE user_id = ? AND course_id = ? ORDER BY id').all(userId, courseId);
  const fin = summarize(all.filter((a) => a.kind === 'final'), pause);
  return {
    units: units.map((u) => {
      const s = summarize(all.filter((a) => a.kind === 'unit' && a.unit === u.unit), pause);
      return { unit: u.unit, title: u.title, passed: s.passed, bestPct: s.best ? s.best.pct : null, attempts: s.attempts };
    }),
    final: { passed: fin.passed, bestPct: fin.best ? fin.best.pct : null },
    completed: fin.passed,
    lessons: lessonStats(userId, courseId)
  };
}

function statusOut(user, row) {
  closeExpired(user.id, row.id);
  const { units } = courseParts(row);
  const pause = pauseMs();
  const gating = gatingOn(user, row);
  const all = q('SELECT * FROM exam_attempts WHERE user_id = ? AND course_id = ? ORDER BY id').all(user.id, row.id);
  const passed = passedUnits(user.id, row.id);
  const fin = summarize(all.filter((a) => a.kind === 'final'), pause);
  const passport = q('SELECT code, hidden FROM passports WHERE user_id = ? AND course_id = ?').get(user.id, row.id);
  return {
    ai: config().ai, gating, passMark: PASS_MARK, pauseMinutes: pause / 60_000,
    units: units.map((u) => {
      const needs = gating ? units.filter((v) => v.unit < u.unit && !passed.has(v.unit)).map((v) => v.unit) : [];
      return {
        unit: u.unit, title: u.title, lessons: u.lessons.map((l) => l.n),
        questions: UNIT_EXAM.choice + UNIT_EXAM.written, choice: UNIT_EXAM.choice, written: UNIT_EXAM.written, minutes: UNIT_EXAM.minutes,
        ...summarize(all.filter((a) => a.kind === 'unit' && a.unit === u.unit), pause),
        open: needs.length === 0, needs
      };
    }),
    final: {
      ...fin, questions: units.length * (FINAL_EACH.choice + FINAL_EACH.written),
      choice: units.length * FINAL_EACH.choice, written: units.length * FINAL_EACH.written, minutes: finalMinutes(units.length)
    },
    completed: fin.passed, completedAt: fin.passedAt,
    passport: passport ? { code: passport.code, hidden: Boolean(passport.hidden) } : null,
    tests: q('SELECT * FROM exam_tests WHERE user_id = ? AND course_id = ? ORDER BY id DESC LIMIT 50').all(user.id, row.id).map((t) => testOut(t)),
    lessons: lessonStats(user.id, row.id)
  };
}

/* ---------------- routes: exams ---------------- */

async function getStatus({ req, res, params }) {
  const u = requireUser(req);
  sendJSON(res, 200, { ok: true, ...statusOut(u, ownCourse(u, params.id)) });
}

async function startExam(u, row, kind, unit) {
  const { meta, units } = courseParts(row);
  if (kind === 'unit' && !units[unit - 1]) throw new HttpError('That unit isn’t in the course.', 404);
  closeExpired(u.id, row.id);
  const mine = q(`SELECT * FROM exam_attempts WHERE user_id = ? AND course_id = ? AND kind = ? AND unit IS ? AND status <> 'done' ORDER BY id DESC LIMIT 1`)
    .get(u.id, row.id, kind, kind === 'unit' ? unit : null);
  if (mine) return mine; // carry on where they were (or see it being marked)
  const s = summarize(q('SELECT * FROM exam_attempts WHERE user_id = ? AND course_id = ? AND kind = ? AND unit IS ?').all(u.id, row.id, kind, kind === 'unit' ? unit : null), pauseMs());
  if (s.retakeAt) {
    const mins = Math.max(1, Math.ceil((s.retakeAt - now()) / 60_000));
    throw new HttpError(`You can take this exam again in ${mins} minute${mins === 1 ? '' : 's'}, with fresh questions.`, 409);
  }
  return once(`${u.id}|${row.id}|${kind}|${unit || 0}`, async () => {
    limitMaking(u);
    const plan = examPlan(kind, units, unit);
    const label = kind === 'unit' ? `unit ${unit} exam "${meta.title}"` : `final exam "${meta.title}"`;
    const out = await writeQuestions({ user: u, row, meta, groups: plan.groups, avoid: askedBefore(u.id, row.id, kind, kind === 'unit' ? unit : null), what: plan.what, label });
    const id = Number(q(`INSERT INTO exam_attempts (user_id, course_id, kind, unit, questions, status, duration, model, started_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`).run(u.id, row.id, kind, kind === 'unit' ? unit : null, JSON.stringify(out.questions), plan.minutes * 60, out.model || null, now()).lastInsertRowid);
    return q('SELECT * FROM exam_attempts WHERE id = ?').get(id);
  });
}

async function startUnit({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const a = await startExam(u, row, 'unit', Number(params.u));
  sendJSON(res, 200, { ok: true, attempt: attemptOut(a, row) });
}

async function startFinal({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const a = await startExam(u, row, 'final', null);
  sendJSON(res, 200, { ok: true, attempt: attemptOut(a, row) });
}

// A paper copy: an exam's questions, fresh, kept to print (it doesn't count as taking the exam).
async function makePaper(u, row, kind, unit) {
  const { meta, units } = courseParts(row);
  if (kind === 'unit' && !units[unit - 1]) throw new HttpError('That unit isn’t in the course.', 404);
  return once(`${u.id}|${row.id}|paper|${kind}|${unit || 0}`, async () => {
    limitMaking(u);
    const plan = examPlan(kind, units, unit);
    const out = await writeQuestions({
      user: u, row, meta, groups: plan.groups, avoid: askedBefore(u.id, row.id, kind, kind === 'unit' ? unit : null),
      what: plan.what + ' It will be printed and sat on paper.', label: `paper copy of the ${kind === 'unit' ? `unit ${unit}` : 'final'} exam "${meta.title}"`
    });
    const lessons = plan.groups.flatMap((g) => g.lessons.map((l) => l.n));
    const choice = out.questions.filter((x) => x.type === 'choice').length;
    const id = Number(q(`INSERT INTO exam_tests (user_id, course_id, kind, unit, title, lessons, choice, written, minutes, questions, model, created_at)
      VALUES (?, ?, 'paper', ?, '', ?, ?, ?, ?, ?, ?, ?)`).run(u.id, row.id, kind === 'unit' ? unit : 0, JSON.stringify(lessons), choice, out.questions.length - choice, plan.minutes, JSON.stringify(out.questions), out.model || null, now()).lastInsertRowid);
    return q('SELECT * FROM exam_tests WHERE id = ?').get(id);
  });
}

async function paperUnit({ req, res, params }) {
  const u = requireUser(req);
  const t = await makePaper(u, ownCourse(u, params.id), 'unit', Number(params.u));
  sendJSON(res, 201, { ok: true, test: testOut(t) });
}

async function paperFinal({ req, res, params }) {
  const u = requireUser(req);
  const t = await makePaper(u, ownCourse(u, params.id), 'final', null);
  sendJSON(res, 201, { ok: true, test: testOut(t) });
}

async function getExam({ req, res, params }) {
  const u = requireUser(req);
  let a = getAttempt(u, params.aid);
  if (a.status === 'open' && pastTime(a)) {
    handIn(a, null);
    markAttempt(a.id).catch((err) => console.error('[exams]', err));
    a = getAttempt(u, a.id);
  }
  sendJSON(res, 200, { ok: true, attempt: attemptOut(a, ownCourse(u, a.course_id)), marking: inflight.has(a.id) });
}

async function saveAnswers({ req, res, params }) {
  const u = requireUser(req);
  const a = getAttempt(u, params.aid);
  const body = await readBody(req, 400_000);
  if (a.status !== 'open' || pastTime(a)) throw new HttpError('This exam has been handed in, so its answers can’t change.', 409);
  const answers = { ...(parseJSON(a.answers, {}) || {}) };
  const qs = arr(parseJSON(a.questions, []));
  const fresh = cleanAnswers(qs, body.answers);
  // an answer cleared in the page is cleared here too
  qs.forEach((x, i) => { const k = String(i + 1); if (body.answers && k in body.answers) { if (k in fresh) answers[k] = fresh[k]; else delete answers[k]; } });
  q("UPDATE exam_attempts SET answers = ? WHERE id = ? AND status = 'open'").run(JSON.stringify(answers), a.id);
  sendJSON(res, 200, { ok: true, savedAt: now(), deadline: deadlineOf(a), now: now() });
}

async function submit({ req, res, params }) {
  const u = requireUser(req);
  let a = getAttempt(u, params.aid);
  const body = await readBody(req, 400_000);
  if (a.status === 'open') {
    const qs = arr(parseJSON(a.questions, []));
    const given = cleanAnswers(qs, body.answers);
    // what the page sends replaces what was saved, including answers it cleared
    const all = body.answers && typeof body.answers === 'object' ? given : null;
    if (all && !pastTime(a)) q("UPDATE exam_attempts SET answers = ? WHERE id = ? AND status = 'open'").run(JSON.stringify(all), a.id);
    handIn(getAttempt(u, a.id), null);
  }
  a = getAttempt(u, a.id);
  if (a.status === 'marking') a = (await markAttempt(a.id)) || getAttempt(u, a.id);
  sendJSON(res, 200, { ok: true, attempt: attemptOut(a, ownCourse(u, a.course_id)) });
}

async function remark({ req, res, params }) {
  const u = requireUser(req);
  let a = getAttempt(u, params.aid);
  if (a.status === 'marking') {
    // drop the failures so they're tried again
    const marks = parseJSON(a.marks, {}) || {};
    for (const k of Object.keys(marks)) if (marks[k] && marks[k].error) delete marks[k];
    q('UPDATE exam_attempts SET marks = ? WHERE id = ?').run(JSON.stringify(marks), a.id);
    a = (await markAttempt(a.id)) || getAttempt(u, a.id);
  }
  sendJSON(res, 200, { ok: true, attempt: attemptOut(a, ownCourse(u, a.course_id)) });
}

async function attemptPaper({ req, res, params }) {
  const u = requireUser(req);
  const a = getAttempt(u, params.aid);
  if (a.status === 'open') throw new HttpError('Hand the exam in first: its answers are printed with it.', 409);
  const row = ownCourse(u, a.course_id);
  const { meta, units } = courseParts(row);
  const test = a.test_id ? q('SELECT title FROM exam_tests WHERE id = ?').get(a.test_id) : null;
  sendJSON(res, 200, {
    ok: true,
    paper: {
      kind: a.kind, unit: a.unit, unitTitle: a.unit && units[a.unit - 1] ? units[a.unit - 1].title : null, title: test ? test.title : '',
      course: { id: row.id, title: meta.title || meta.topic, lang: meta.lang || 'en' },
      minutes: a.duration ? Math.round(a.duration / 60) : null, questions: arr(parseJSON(a.questions, [])), lessons: lessonTitles(row, arr(parseJSON(a.questions, [])).map((x) => x.lesson))
    }
  });
}

/* ---------------- routes: custom tests ---------------- */

const getTest = (user, id) => {
  const n = Number(id);
  const t = Number.isSafeInteger(n) ? q('SELECT * FROM exam_tests WHERE id = ? AND user_id = ?').get(n, user.id) : null;
  if (!t) throw new HttpError('That test doesn’t exist.', 404);
  return t;
};

function lessonTitles(row, ns) {
  const { flat } = courseParts(row);
  const out = {};
  for (const n of new Set(ns.filter(Boolean))) if (flat[n - 1]) out[n] = { title: flat[n - 1].title, unit: flat[n - 1].unitIndex };
  return out;
}

async function createTest({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const body = await readBody(req, 8_000);
  const { meta, flat } = courseParts(row);
  const ns = [...new Set(arr(body.lessons).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= flat.length))].sort((a, b) => a - b);
  if (!ns.length) throw new HttpError('Pick at least one lesson for the test.', 400);
  if (ns.length > TEST.lessons) throw new HttpError(`A test can cover up to ${TEST.lessons} lessons.`, 400);
  const choice = Math.round(Number(body.choice) || 0), written = Math.round(Number(body.written) || 0);
  if (choice < 0 || choice > TEST.choice || written < 0 || written > TEST.written) {
    throw new HttpError(`A test can have up to ${TEST.choice} multiple-choice and ${TEST.written} written questions.`, 400);
  }
  if (choice + written < 1) throw new HttpError('Ask for at least one question.', 400);
  let minutes = null;
  if (body.minutes != null && body.minutes !== '' && Number(body.minutes) !== 0) {
    minutes = Math.round(Number(body.minutes));
    if (!Number.isFinite(minutes) || minutes < TEST.minMinutes || minutes > TEST.maxMinutes) {
      throw new HttpError(`Set the timer between ${TEST.minMinutes} and ${TEST.maxMinutes} minutes, or have no timer.`, 400);
    }
  }
  const title = text(body.title, 80);
  const lessons = ns.map((n) => flat[n - 1]);
  limitMaking(u);
  const out = await writeQuestions({
    user: u, row, meta, avoid: [],
    groups: [{ label: `The ${lessons.length === 1 ? 'lesson' : `${lessons.length} lessons`} above`, lessons, choice, written }],
    what: 'This is a practice test the learner made for themselves on the lessons below.',
    label: `test on ${ns.length} lesson${ns.length === 1 ? '' : 's'} of "${meta.title}"`
  });
  const id = Number(q(`INSERT INTO exam_tests (user_id, course_id, kind, unit, title, lessons, choice, written, minutes, questions, model, created_at)
    VALUES (?, ?, 'test', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`).run(u.id, row.id, title, JSON.stringify(ns), choice, written, minutes, JSON.stringify(out.questions), out.model || null, now()).lastInsertRowid);
  sendJSON(res, 201, { ok: true, test: testOut(q('SELECT * FROM exam_tests WHERE id = ?').get(id)) });
}

async function getTestRoute({ req, res, params }) {
  const u = requireUser(req);
  const t = getTest(u, params.tid);
  const row = ownCourse(u, t.course_id);
  const { meta, units } = courseParts(row);
  const attempts = q('SELECT * FROM exam_attempts WHERE user_id = ? AND test_id = ? ORDER BY id DESC LIMIT 20').all(u.id, t.id);
  sendJSON(res, 200, {
    ok: true,
    test: {
      ...testOut(t, true),
      unitTitle: t.kind === 'paper' && t.unit && units[t.unit - 1] ? units[t.unit - 1].title : null,
      course: { id: row.id, title: meta.title || meta.topic, lang: meta.lang || 'en' },
      lessonInfo: lessonTitles(row, parseJSON(t.lessons, [])),
      attempts: attempts.map((a) => ({ id: a.id, status: a.status, ...(a.status === 'done' ? scoreOut(a) : {}), startedAt: a.started_at, deadline: deadlineOf(a) }))
    }
  });
}

async function deleteTest({ req, res, params }) {
  const u = requireUser(req);
  const t = getTest(u, params.tid);
  q('DELETE FROM exam_tests WHERE id = ?').run(t.id);
  sendJSON(res, 200, { ok: true });
}

async function startTest({ req, res, params }) {
  const u = requireUser(req);
  const t = getTest(u, params.tid);
  if (t.kind !== 'test') throw new HttpError('A paper copy is for printing. Take the exam itself from the course page.', 400);
  const row = ownCourse(u, t.course_id);
  closeExpired(u.id, row.id);
  let a = q("SELECT * FROM exam_attempts WHERE user_id = ? AND test_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(u.id, t.id);
  if (!a) {
    const id = Number(q(`INSERT INTO exam_attempts (user_id, course_id, kind, unit, test_id, questions, status, duration, model, started_at)
      VALUES (?, ?, 'test', NULL, ?, ?, 'open', ?, ?, ?)`).run(u.id, row.id, t.id, t.questions, t.minutes ? t.minutes * 60 : null, t.model, now()).lastInsertRowid);
    a = q('SELECT * FROM exam_attempts WHERE id = ?').get(id);
  }
  sendJSON(res, 200, { ok: true, attempt: attemptOut(a, row) });
}

/* ---------------- routes: the class worksheet ---------------- */

// The questions a class gets wrong most, whole (choices and answers) where the lesson or exam still has them.
async function worksheet({ req, res, params }) {
  const u = requireUser(req);
  const n = Number(params.cid);
  const c = Number.isSafeInteger(n) ? q('SELECT * FROM classes WHERE id = ? AND owner_id = ?').get(n, u.id) : null;
  if (!c) throw new HttpError('That class doesn’t exist, or you don’t teach it.', 404);
  const row = q('SELECT * FROM courses WHERE id = ?').get(c.course_id);
  if (!row) throw new HttpError('That class’s course is gone.', 404);
  const { meta, flat } = courseParts(row);
  const members = q('SELECT COUNT(*) AS n FROM class_members WHERE class_id = ?').get(c.id).n;
  const rows = q(`SELECT x.user_id, x.course_id, x.lesson_n, x.prompt, x.correct FROM mistakes x
      JOIN class_members m ON m.course_id = x.course_id AND m.user_id = x.user_id AND m.class_id = ?
      ORDER BY x.created_at DESC LIMIT 5000`).all(c.id);
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.lesson_n || 0}|${keyOf(r.prompt)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { lesson: r.lesson_n || null, prompt: r.prompt, students: new Set(), times: 0, correct: new Map(), courses: new Set() }));
    g.students.add(r.user_id);
    g.times++;
    g.courses.add(r.course_id);
    if (r.correct) g.correct.set(r.correct, (g.correct.get(r.correct) || 0) + 1);
  }
  const top = [...groups.values()].sort((a, b) => b.students.size - a.students.size || b.times - a.times || (a.lesson || 0) - (b.lesson || 0)).slice(0, 15);
  // the whole question: from the class's lesson (written once for everyone), else from a student's exam
  const lessonQs = new Map();
  const fromLessons = (courseIds, ln) => {
    for (const cid of courseIds) {
      const k = `${cid}|${ln}`;
      if (!lessonQs.has(k)) {
        const l = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(cid, ln);
        lessonQs.set(k, l ? arr(parseJSON(l.data, {}).sections).flatMap((s) => arr(s.checkpoint)) : []);
      }
      if (lessonQs.get(k).length) return lessonQs.get(k);
    }
    return [];
  };
  let examQs = null;
  const fromExams = () => {
    if (!examQs) {
      examQs = q(`SELECT a.questions FROM exam_attempts a JOIN class_members m ON m.course_id = a.course_id AND m.user_id = a.user_id AND m.class_id = ?
        WHERE a.status = 'done' ORDER BY a.id DESC LIMIT 300`).all(c.id).flatMap((r) => arr(parseJSON(r.questions, [])));
    }
    return examQs;
  };
  const questions = top.map((g) => {
    const want = keyOf(g.prompt);
    const found = (g.lesson ? fromLessons([row.id, ...g.courses], g.lesson) : []).find((x) => x && keyOf(x.prompt) === want)
      || fromExams().find((x) => x && keyOf(x.prompt) === want) || null;
    const correct = [...g.correct.entries()].sort((a, b) => b[1] - a[1])[0];
    const l = g.lesson ? flat[g.lesson - 1] : null;
    const base = { lesson: g.lesson, lessonTitle: l ? l.title : null, students: g.students.size, times: g.times, correct: correct ? correct[0] : null };
    if (!found) return { ...base, type: 'written', prompt: g.prompt };
    const keep = ['type', 'prompt', 'choices', 'answer', 'tolerance', 'unit', 'accept', 'explain', 'model'];
    return { ...base, ...Object.fromEntries(keep.filter((k) => found[k] != null).map((k) => [k, found[k]])) };
  });
  sendJSON(res, 200, {
    ok: true,
    worksheet: { class: { id: c.id, name: c.name }, course: { id: row.id, title: meta.title || meta.topic, lang: meta.lang || 'en' }, members, questions }
  });
}

/* ---------------- the skill passport ---------------- */

const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0, O, 1 or I
const newCode = () => {
  const s = Array.from({ length: 8 }, () => CODE_ABC[crypto.randomInt(CODE_ABC.length)]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};
// "k7pq-x4ab", "K7PQ X4AB" and "k7pqx4ab" are the same code.
const normCode = (raw) => {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 && [...s].every((ch) => CODE_ABC.includes(ch)) ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
};

function passportFacts(user, row, meta, flat, a) {
  const passed = passedUnits(user.id, row.id);
  const lessonsDone = q('SELECT COUNT(*) AS n FROM progress WHERE course_id = ? AND done = 1 AND n <= ?').get(row.id, flat.length).n;
  let made = 0, fixed = 0;
  try {
    const r = q('SELECT COUNT(*) AS made, COALESCE(SUM(mastered_at IS NOT NULL), 0) AS fixed FROM review_items WHERE user_id = ? AND course_id = ?').get(user.id, row.id);
    made = r.made; fixed = r.fixed;
  } catch { /* review isn't on */ }
  const lang = meta.lang || 'en';
  return {
    name: user.name, course: meta.title || meta.topic || 'Untitled course', topic: meta.topic || '',
    lang, langName: langName(lang), completedAt: a.submitted_at || now(),
    score: a.score, total: a.total, pct: a.total ? Math.round((100 * a.score) / a.total) : 0,
    units: (meta.units || []).map((u, i) => ({ title: u.title, passed: passed.has(i + 1) })),
    unitsPassed: passed.size, unitsTotal: (meta.units || []).length,
    lessonsDone, lessonsTotal: flat.length, mistakesFixed: fixed, mistakesMade: made
  };
}

function issuePassport(user, row, meta, flat, a) {
  const facts = passportFacts(user, row, meta, flat, a);
  const have = q('SELECT * FROM passports WHERE user_id = ? AND course_id = ?').get(user.id, row.id);
  if (have) {
    // passing again keeps the code; the certificate shows the best final exam
    if ((parseJSON(have.data, {}).pct || 0) <= facts.pct) {
      q('UPDATE passports SET data = ?, attempt_id = ?, updated_at = ? WHERE code = ?').run(JSON.stringify(facts), a.id, now(), have.code);
    }
    return have.code;
  }
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    try {
      q('INSERT INTO passports (code, user_id, course_id, attempt_id, data, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
        .run(code, user.id, row.id, a.id, JSON.stringify(facts), now(), now());
      return code;
    } catch (err) {
      if (!/UNIQUE|PRIMARY/i.test(String(err && err.message))) throw err; // a code already in use: draw another
    }
  }
  return null;
}

const passportOut = (p, owner) => ({
  code: p.code, issuedAt: p.created_at, updatedAt: p.updated_at, ...(owner ? { hidden: Boolean(p.hidden), courseId: p.course_id } : {}),
  facts: parseJSON(p.data, {})
});

async function listPassports({ req, res }) {
  const u = requireUser(req);
  sendJSON(res, 200, { ok: true, passports: q('SELECT * FROM passports WHERE user_id = ? ORDER BY created_at DESC').all(u.id).map((p) => passportOut(p, true)) });
}

function ownPassport(user, raw) {
  const code = normCode(raw);
  const p = code ? q('SELECT * FROM passports WHERE code = ? AND user_id = ?').get(code, user.id) : null;
  if (!p) throw new HttpError('That certificate isn’t one of yours.', 404);
  return p;
}

async function getPassport({ req, res, params }) {
  const u = requireUser(req);
  sendJSON(res, 200, { ok: true, passport: passportOut(ownPassport(u, params.code), true) });
}

async function patchPassport({ req, res, params }) {
  const u = requireUser(req);
  const p = ownPassport(u, params.code);
  const body = await readBody(req, 1_000);
  if (typeof body.hidden !== 'boolean') throw new HttpError('Say whether to hide the certificate.', 400);
  q('UPDATE passports SET hidden = ?, updated_at = ? WHERE code = ?').run(body.hidden ? 1 : 0, now(), p.code);
  sendJSON(res, 200, { ok: true, passport: passportOut(q('SELECT * FROM passports WHERE code = ?').get(p.code), true) });
}

// Anyone can check a code; guessing many is slowed down.
async function verify({ req, res, params }) {
  if (overLimit('verify-ip:' + clientIp(req), 120, 15 * 60_000)) throw new HttpError('Too many checks from here. Wait a few minutes and try again.', 429);
  const code = normCode(params.code);
  const p = code ? q('SELECT * FROM passports WHERE code = ?').get(code) : null;
  // "no such certificate" is an answer, not an error (the public page shows it as one)
  if (!p) return sendJSON(res, 200, { ok: true, found: false, code: code || null });
  if (p.hidden) return sendJSON(res, 200, { ok: true, found: true, code: p.code, hidden: true });
  sendJSON(res, 200, { ok: true, found: true, code: p.code, hidden: false, passport: passportOut(p, false) });
}

/* ---------------- wiring ---------------- */

const C = '(?<id>[^/]+)';
export const routes = [
  ['GET', new RegExp(`^/api/courses/${C}/exams$`), getStatus],
  ['POST', new RegExp(`^/api/courses/${C}/exams/unit/(?<u>\\d{1,3})$`), startUnit],
  ['POST', new RegExp(`^/api/courses/${C}/exams/final$`), startFinal],
  ['POST', new RegExp(`^/api/courses/${C}/exams/unit/(?<u>\\d{1,3})/paper$`), paperUnit],
  ['POST', new RegExp(`^/api/courses/${C}/exams/final/paper$`), paperFinal],
  ['POST', new RegExp(`^/api/courses/${C}/tests$`), createTest],
  ['GET', /^\/api\/tests\/(?<tid>\d{1,12})$/, getTestRoute],
  ['DELETE', /^\/api\/tests\/(?<tid>\d{1,12})$/, deleteTest],
  ['POST', /^\/api\/tests\/(?<tid>\d{1,12})\/start$/, startTest],
  ['GET', /^\/api\/exams\/(?<aid>\d{1,12})$/, getExam],
  ['GET', /^\/api\/exams\/(?<aid>\d{1,12})\/paper$/, attemptPaper],
  ['PUT', /^\/api\/exams\/(?<aid>\d{1,12})\/answers$/, saveAnswers],
  ['POST', /^\/api\/exams\/(?<aid>\d{1,12})\/submit$/, submit],
  ['POST', /^\/api\/exams\/(?<aid>\d{1,12})\/remark$/, remark],
  ['GET', /^\/api\/classes\/(?<cid>\d{1,12})\/worksheet$/, worksheet],
  ['GET', /^\/api\/passports$/, listPassports],
  ['GET', /^\/api\/passports\/(?<code>[A-Za-z0-9-]{4,20})$/, getPassport],
  ['PATCH', /^\/api\/passports\/(?<code>[A-Za-z0-9-]{4,20})$/, patchPassport],
  ['GET', /^\/api\/verify\/(?<code>[A-Za-z0-9 -]{4,20})$/, verify]
];

export const pages = [
  { file: 'exam.html', protected: true },
  { file: 'paper.html', protected: true },
  { file: 'certificate.html', protected: true },
  { file: 'verify.html', protected: false }
];
