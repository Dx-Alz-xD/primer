// =====================================================================
// Class mode: one teacher, many students (UN SDG 4, target 4.c).
//
// - A teacher turns one of their own courses into a class and shares its
//   join code: six characters, easy to read aloud, with no 0/O/1/I.
// - A student types the code, sees the class, the teacher and what the
//   teacher will see, and joins. They get their own copy of the course,
//   linked to the class. Leaving (or being removed) unlinks the copy; it
//   stays theirs.
// - Shared lessons: a lesson the teacher's course already has is reused
//   for every student; one nobody has yet is written once, the usual way,
//   and kept on the teacher's course too, so the next student gets it at
//   once (hooks.classLesson in data.mjs). Everyone answers the same
//   checkpoints, which is what lets the dashboard add up wrong answers.
// - The teacher's dashboard (class.html?id=) shows the roster, progress
//   per lesson, the questions the class gets wrong and recent doubts,
//   using only the students' copies of this class's course.
// - Deleting the teacher's course deletes its classes; deleting a copy
//   ends that student's membership (foreign keys, ON DELETE CASCADE).
// =====================================================================
import crypto from 'node:crypto';
import { q, tx, now, schema, parseJSON } from './db.mjs';
import { HttpError, sendJSON, readBody, text, overLimit, clientIp } from './http.mjs';
import { requireUser } from './auth.mjs';
import { hooks, ownCourse, insertCourse, loadCourse, cleanMeta, flatten } from './data.mjs';

schema('classes-1', `
  CREATE TABLE classes (
    id          INTEGER PRIMARY KEY,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,  -- the teacher's course
    name        TEXT NOT NULL,
    code        TEXT NOT NULL UNIQUE,                                     -- join code, 6 characters
    open        INTEGER NOT NULL DEFAULT 1,                               -- 0: nobody new can join
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX classes_owner ON classes(owner_id, created_at DESC);
  CREATE INDEX classes_course ON classes(course_id);
  CREATE TABLE class_members (
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,  -- the student's own copy
    joined_at   INTEGER NOT NULL,
    PRIMARY KEY (class_id, user_id)
  );
  CREATE INDEX class_members_user ON class_members(user_id);
`);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0, O, 1 or I
const CODE_LEN = 6;
const MAX_CLASSES = 50;   // per teacher
const MAX_MEMBERS = 300;  // per class
const WINDOW = 15 * 60_000;

const newCode = () => Array.from({ length: CODE_LEN }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
// "k7p-qx4", "K7P QX4" and "k7pqx4" are the same code.
const normCode = (raw) => (typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : '');
const validCode = (c) => c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch));

const courseMeta = (courseId) => {
  const row = q('SELECT data FROM courses WHERE id = ?').get(courseId);
  return row ? parseJSON(row.data, {}) : null;
};

function ownClass(user, id) {
  const n = Number(id);
  const row = Number.isInteger(n) && n > 0 ? q('SELECT * FROM classes WHERE id = ? AND owner_id = ?').get(n, user.id) : null;
  if (!row) throw new HttpError('That class doesn’t exist, or you don’t teach it.', 404);
  return row;
}

const classOut = (c) => {
  const meta = courseMeta(c.course_id) || {};
  return {
    id: c.id, name: c.name, code: c.code, open: Boolean(c.open), createdAt: c.created_at,
    courseId: c.course_id, courseTitle: meta.title || 'Untitled course', lessons: flatten(meta.units || []).length,
    students: q('SELECT COUNT(*) AS n FROM class_members WHERE class_id = ?').get(c.id).n
  };
};

/* ---------------- joining: guessing a code is rate limited ---------------- */

// Every lookup or join counts for the account; a whole classroom behind one address is fine,
// but many wrong codes from one address are not.
function limitTries(req, user) {
  if (overLimit('class-code:' + user.id, 30, WINDOW) || overLimit('class-code-ip:' + clientIp(req), 600, WINDOW)) {
    throw new HttpError('Too many tries with class codes. Wait a few minutes and try again.', 429);
  }
}

function findByCode(req, raw) {
  const code = normCode(raw);
  if (!code) throw new HttpError('Type the class code your teacher gave you.', 400);
  const row = validCode(code) ? q('SELECT * FROM classes WHERE code = ?').get(code) : null;
  if (!row) {
    if (overLimit('class-miss-ip:' + clientIp(req), 60, WINDOW)) throw new HttpError('Too many tries with class codes. Wait a few minutes and try again.', 429);
    throw new HttpError('No class has that code. Check it with your teacher.', 404);
  }
  return row;
}

const membership = (classId, userId) => q('SELECT * FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, userId);

function preview(c, user) {
  const meta = courseMeta(c.course_id) || {};
  const flat = flatten(meta.units || []);
  const mine = membership(c.id, user.id);
  return {
    id: c.id, name: c.name, open: Boolean(c.open),
    teacher: (q('SELECT name FROM users WHERE id = ?').get(c.owner_id) || {}).name || 'Your teacher',
    course: { title: meta.title || 'Untitled course', topic: meta.topic || '', lessons: flat.length, units: (meta.units || []).length },
    teaching: c.owner_id === user.id,
    memberCourseId: mine ? mine.course_id : null
  };
}

async function lookup({ req, res }) {
  const u = requireUser(req);
  limitTries(req, u);
  const body = await readBody(req, 1_000);
  sendJSON(res, 200, { ok: true, class: preview(findByCode(req, body.code), u) });
}

async function join({ req, res }) {
  const u = requireUser(req);
  limitTries(req, u);
  const body = await readBody(req, 1_000);
  const c = findByCode(req, body.code);
  if (c.owner_id === u.id) throw new HttpError('You teach this class, so you can’t join it as a student.', 400);
  const had = membership(c.id, u.id);
  if (had) return sendJSON(res, 200, { ok: true, already: true, course: loadCourse(u, had.course_id), class: preview(c, u) });
  if (!c.open) throw new HttpError('This class isn’t taking new students. Ask your teacher to reopen it.', 403);
  const courseId = tx(() => {
    if (q('SELECT COUNT(*) AS n FROM class_members WHERE class_id = ?').get(c.id).n >= MAX_MEMBERS) {
      throw new HttpError(`This class is full: it has ${MAX_MEMBERS} students.`, 400);
    }
    const tm = courseMeta(c.course_id) || {};
    const meta = cleanMeta(tm);
    // a course the teacher started from their own material keeps its label; its lessons are still written from
    // that material (sources-in.mjs finds it through the class), but the copy can't share it or show the cover photo
    if (tm.startedFrom && typeof tm.startedFrom === 'object') {
      const { sid, photo, from, ...label } = tm.startedFrom;
      meta.startedFrom = { ...label, copy: true };
    }
    const row = insertCourse(u, meta);
    q('INSERT INTO class_members (class_id, user_id, course_id, joined_at) VALUES (?, ?, ?, ?)').run(c.id, u.id, row.id, now());
    return row.id;
  });
  sendJSON(res, 201, { ok: true, course: loadCourse(u, courseId), class: preview(c, u) });
}

async function leave({ req, res, params }) {
  const u = requireUser(req);
  const n = Number(params.id);
  const changed = Number(q('DELETE FROM class_members WHERE class_id = ? AND user_id = ?').run(Number.isInteger(n) ? n : 0, u.id).changes);
  if (!changed) throw new HttpError('You’re not in that class.', 404);
  sendJSON(res, 200, { ok: true });
}

/* ---------------- the teacher's side ---------------- */

async function createClass({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 2_000);
  const course = ownCourse(u, text(body.courseId, 64));
  if (q('SELECT 1 FROM class_members WHERE course_id = ?').get(course.id)) {
    throw new HttpError('This course is your copy from a class. Teach a course of your own instead.', 400);
  }
  if (q('SELECT COUNT(*) AS n FROM classes WHERE owner_id = ?').get(u.id).n >= MAX_CLASSES) {
    throw new HttpError(`You can teach up to ${MAX_CLASSES} classes. Delete one you no longer use first.`, 400);
  }
  const meta = parseJSON(course.data, {});
  const name = text(body.name, 80) || text(meta.title, 80) || 'My class';
  let id = 0;
  for (let i = 0; i < 8 && !id; i++) {
    try {
      id = Number(q('INSERT INTO classes (owner_id, course_id, name, code, open, created_at) VALUES (?, ?, ?, ?, 1, ?)')
        .run(u.id, course.id, name, newCode(), now()).lastInsertRowid);
    } catch (err) {
      if (!/UNIQUE/i.test(String(err && err.message))) throw err; // a code already in use: draw another
    }
  }
  if (!id) throw new HttpError('Couldn’t make a class code. Try again.', 500);
  sendJSON(res, 201, { ok: true, class: classOut(ownClass(u, id)) });
}

// Classes I teach and classes I'm in.
async function listClasses({ req, res }) {
  const u = requireUser(req);
  const teaching = q('SELECT * FROM classes WHERE owner_id = ? ORDER BY created_at DESC').all(u.id).map(classOut);
  const joined = q(`SELECT m.class_id, m.course_id, m.joined_at, c.name, c.open, t.name AS teacher
      FROM class_members m JOIN classes c ON c.id = m.class_id JOIN users t ON t.id = c.owner_id
      WHERE m.user_id = ? ORDER BY m.joined_at DESC`).all(u.id)
    .map((r) => ({ id: r.class_id, name: r.name, teacher: r.teacher, open: Boolean(r.open), courseId: r.course_id, joinedAt: r.joined_at }));
  sendJSON(res, 200, { ok: true, teaching, joined });
}

// What the course page needs: the classes this course is taught as, or the class this copy belongs to.
async function courseClass({ req, res, params }) {
  const u = requireUser(req);
  const course = ownCourse(u, params.id);
  const m = q(`SELECT m.class_id, m.joined_at, c.name, c.open, t.name AS teacher
      FROM class_members m JOIN classes c ON c.id = m.class_id JOIN users t ON t.id = c.owner_id
      WHERE m.course_id = ? AND m.user_id = ?`).get(course.id, u.id);
  const member = m ? { id: m.class_id, name: m.name, teacher: m.teacher, open: Boolean(m.open), joinedAt: m.joined_at } : null;
  const teaching = member ? [] : q('SELECT * FROM classes WHERE course_id = ? AND owner_id = ? ORDER BY created_at').all(course.id, u.id).map(classOut);
  sendJSON(res, 200, { ok: true, member, teaching });
}

async function patchClass({ req, res, params }) {
  const u = requireUser(req);
  const c = ownClass(u, params.id);
  const body = await readBody(req, 2_000);
  if (body.name != null) {
    const name = text(body.name, 80);
    if (!name) throw new HttpError('Give the class a name.', 400);
    q('UPDATE classes SET name = ? WHERE id = ?').run(name, c.id);
  }
  if (body.open != null) q('UPDATE classes SET open = ? WHERE id = ?').run(body.open ? 1 : 0, c.id);
  sendJSON(res, 200, { ok: true, class: classOut(ownClass(u, c.id)) });
}

// The class and its roster go; every student keeps their copy of the course.
async function deleteClass({ req, res, params }) {
  const u = requireUser(req);
  const c = ownClass(u, params.id);
  q('DELETE FROM classes WHERE id = ?').run(c.id);
  sendJSON(res, 200, { ok: true });
}

async function removeMember({ req, res, params }) {
  const u = requireUser(req);
  const c = ownClass(u, params.id);
  const changed = Number(q('DELETE FROM class_members WHERE class_id = ? AND user_id = ?').run(c.id, Number(params.uid)).changes);
  if (!changed) throw new HttpError('That student isn’t in this class.', 404);
  sendJSON(res, 200, { ok: true });
}

/* ---------------- the dashboard ---------------- */

// Only rows from the members' copies of this class's course, and only their own rows in them.
const MEMBER_JOIN = (alias) => `JOIN class_members m ON m.course_id = ${alias}.course_id AND m.user_id = ${alias}.user_id AND m.class_id = ?`;

function wrongQuestions(classId, flat, members) {
  const rows = q(`SELECT x.user_id, x.lesson_n, x.prompt, x.given, x.correct, x.created_at FROM mistakes x ${MEMBER_JOIN('x')}
      ORDER BY x.created_at DESC LIMIT 5000`).all(classId);
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.lesson_n || 0}|${r.prompt}`;
    let g = groups.get(key);
    if (!g) {
      g = { lesson: r.lesson_n || null, prompt: r.prompt, students: new Set(), times: 0, given: new Map(), correct: new Map(), last: r.created_at };
      groups.set(key, g);
    }
    g.students.add(r.user_id);
    g.times++;
    if (r.given) {
      const k = r.given.trim();
      const e = g.given.get(k.toLowerCase()) || { text: k, who: new Set(), times: 0 };
      e.who.add(r.user_id); e.times++;
      g.given.set(k.toLowerCase(), e);
    }
    if (r.correct) g.correct.set(r.correct, (g.correct.get(r.correct) || 0) + 1);
  }
  return [...groups.values()].map((g) => {
    const top = [...g.given.values()].sort((a, b) => b.who.size - a.who.size || b.times - a.times)[0] || null;
    const correct = [...g.correct.entries()].sort((a, b) => b[1] - a[1])[0];
    const l = g.lesson ? flat[g.lesson - 1] : null;
    return {
      lesson: g.lesson, lessonTitle: l ? l.title : null, prompt: g.prompt, students: g.students.size, of: members, times: g.times,
      commonWrong: top ? { text: top.text, students: top.who.size, times: top.times } : null,
      correct: correct ? correct[0] : null, lastAt: g.last
    };
  }).sort((a, b) => b.students - a.students || b.times - a.times || (a.lesson || 0) - (b.lesson || 0)).slice(0, 30);
}

async function dashboard({ req, res, params }) {
  const u = requireUser(req);
  const c = ownClass(u, params.id);
  const meta = courseMeta(c.course_id) || {};
  const flat = flatten(meta.units || []);
  const total = flat.length;

  const roster = q(`SELECT m.user_id, m.joined_at, u.name, co.opened_at,
        (SELECT COUNT(*) FROM progress p WHERE p.course_id = m.course_id AND p.done = 1 AND p.n <= ?) AS done,
        (SELECT MAX(p.updated_at) FROM progress p WHERE p.course_id = m.course_id) AS p_at,
        (SELECT MAX(d.created_at) FROM doubts d WHERE d.course_id = m.course_id AND d.user_id = m.user_id) AS d_at,
        (SELECT MAX(x.created_at) FROM mistakes x WHERE x.course_id = m.course_id AND x.user_id = m.user_id) AS x_at,
        (SELECT COUNT(*) FROM doubts d WHERE d.course_id = m.course_id AND d.user_id = m.user_id) AS doubts,
        (SELECT COUNT(*) FROM mistakes x WHERE x.course_id = m.course_id AND x.user_id = m.user_id) AS mistakes
      FROM class_members m JOIN users u ON u.id = m.user_id JOIN courses co ON co.id = m.course_id
      WHERE m.class_id = ? ORDER BY lower(u.name), m.joined_at`).all(total, c.id)
    .map((r) => ({
      id: r.user_id, name: r.name, joinedAt: r.joined_at, done: r.done, total,
      lastActive: Math.max(r.joined_at, r.opened_at || 0, r.p_at || 0, r.d_at || 0, r.x_at || 0),
      doubts: r.doubts, mistakes: r.mistakes
    }));

  const per = new Map(q(`SELECT p.n, SUM(p.done) AS done, COUNT(*) AS started FROM progress p
      JOIN class_members m ON m.course_id = p.course_id AND m.class_id = ? GROUP BY p.n`).all(c.id).map((r) => [r.n, r]));
  const doubtsPer = new Map(q(`SELECT d.lesson_n AS n, COUNT(*) AS k FROM doubts d ${MEMBER_JOIN('d')} GROUP BY d.lesson_n`).all(c.id).map((r) => [r.n, r.k]));
  const wrongPer = new Map(q(`SELECT x.lesson_n AS n, COUNT(*) AS k FROM mistakes x ${MEMBER_JOIN('x')} GROUP BY x.lesson_n`).all(c.id).map((r) => [r.n, r.k]));
  const written = new Set(q('SELECT n FROM lessons WHERE course_id = ?').all(c.course_id).map((r) => r.n));
  const lessons = flat.map((l) => {
    const p = per.get(l.n) || { done: 0, started: 0 };
    return {
      n: l.n, title: l.title, unit: l.unit, unitIndex: l.unitIndex, written: written.has(l.n),
      done: p.done || 0, started: Math.max(0, (p.started || 0) - (p.done || 0)), doubts: doubtsPer.get(l.n) || 0, mistakes: wrongPer.get(l.n) || 0
    };
  });

  const doubts = q(`SELECT d.id, d.lesson_n, d.kind, d.quote, d.question, d.created_at, d.answer IS NOT NULL AS answered, u.name
      FROM doubts d ${MEMBER_JOIN('d')} JOIN users u ON u.id = d.user_id
      ORDER BY d.created_at DESC LIMIT 30`).all(c.id)
    .map((d) => ({
      id: d.id, lesson: d.lesson_n, lessonTitle: d.lesson_n && flat[d.lesson_n - 1] ? flat[d.lesson_n - 1].title : null,
      kind: d.kind, quote: d.quote, question: d.question, at: d.created_at, answered: Boolean(d.answered), student: d.name
    }));
  const counts = {
    doubts: q(`SELECT COUNT(*) AS n FROM doubts d ${MEMBER_JOIN('d')}`).get(c.id).n,
    mistakes: q(`SELECT COUNT(*) AS n FROM mistakes x ${MEMBER_JOIN('x')}`).get(c.id).n
  };

  sendJSON(res, 200, {
    ok: true,
    class: { ...classOut(c), source: meta.source || 'sample', written: written.size },
    roster, lessons, wrong: wrongQuestions(c.id, flat, roster.length), doubts, counts
  });
}

/* ---------------- shared lessons (hooks.classLesson, called from data.mjs) ---------------- */

// The class's course for this course: the teacher's course behind a student's copy, or the
// course itself when its owner teaches it as a class. Null for every other course.
function sharedCourseFor(user, row) {
  const link = q(`SELECT c.course_id FROM class_members m JOIN classes c ON c.id = m.class_id
      WHERE m.course_id = ? AND m.user_id = ?`).get(row.id, user.id);
  if (link) return link.course_id;
  return q('SELECT 1 FROM classes WHERE course_id = ? AND owner_id = ? LIMIT 1').get(row.id, user.id) ? row.id : null;
}

const writing = new Map(); // "teacherCourseId|n" -> the one request writing it

async function classLesson(user, row, n, write) {
  const shared = sharedCourseFor(user, row);
  if (!shared) return null;
  if (shared !== row.id) {
    // a student's copy: only while its outline still lines up with the teacher's
    const mine = flatten(parseJSON(row.data, {}).units || [])[n - 1];
    const theirs = flatten((courseMeta(shared) || {}).units || [])[n - 1];
    if (!mine || !theirs || mine.title !== theirs.title) return null;
    const have = q('SELECT data, model FROM lessons WHERE course_id = ? AND n = ?').get(shared, n);
    if (have) return { lesson: parseJSON(have.data), model: have.model };
  }
  // Nobody has it yet: write it once, however many students open it at the same moment.
  const key = `${shared}|${n}`;
  if (writing.has(key)) return writing.get(key);
  const job = (async () => {
    const out = await write();
    if (shared !== row.id) {
      try {
        q('INSERT OR IGNORE INTO lessons (course_id, n, data, model, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(shared, n, JSON.stringify(out.lesson), out.model || null, now());
      } catch (err) {
        console.log(`[classes] couldn’t keep lesson ${n} on the class course: ${err.message}`); // e.g. the teacher just deleted it
      }
    }
    return out;
  })().finally(() => writing.delete(key));
  writing.set(key, job);
  return job;
}
hooks.classLesson = classLesson;

export const pages = [{ file: 'class.html', protected: true }];

export const routes = [
  ['GET', /^\/api\/classes$/, listClasses],
  ['POST', /^\/api\/classes$/, createClass],
  ['POST', /^\/api\/classes\/lookup$/, lookup],
  ['POST', /^\/api\/classes\/join$/, join],
  ['GET', /^\/api\/classes\/(?<id>\d{1,12})$/, dashboard],
  ['PATCH', /^\/api\/classes\/(?<id>\d{1,12})$/, patchClass],
  ['DELETE', /^\/api\/classes\/(?<id>\d{1,12})$/, deleteClass],
  ['POST', /^\/api\/classes\/(?<id>\d{1,12})\/leave$/, leave],
  ['DELETE', /^\/api\/classes\/(?<id>\d{1,12})\/members\/(?<uid>\d{1,12})$/, removeMember],
  ['GET', /^\/api\/courses\/(?<id>[^/]+)\/class$/, courseClass]
];
