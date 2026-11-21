// =====================================================================
// Review today: the checkpoint questions a learner got wrong come back
// later, until they have really learned them.
//
// Every wrong answer in a lesson (POST /api/mistakes, data.mjs) creates
// a review item for that question, or sends an existing one back to the
// start. Items move through a small Leitner schedule:
//   a mistake          box 0, back the next day
//   right in review    up one box: back in 3 days (then 7)
//   two right in a row mastered: it stops coming back
//   wrong in review    box 0, back the next day
// Subjective (written) questions are not reviewed. Grading happens in
// the browser, which has the answers already (they're in the lesson);
// the server keeps the schedule and the numbers.
//
//   GET  /api/review[?course=id]        due and coming-up questions, counts, stats
//   POST /api/review/:id/answer         { right: true | false }
//   GET  /api/review/stats[?course=id]  per course: mistakes made, fixed, still learning
// =====================================================================
import { q, schema, now, parseJSON } from './db.mjs';
import { HttpError, sendJSON, readBody, overLimit } from './http.mjs';
import { requireUser } from './auth.mjs';
import { ownCourse, flatten, mistakeHooks } from './data.mjs';

schema('review-1', `
  CREATE TABLE review_items (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    lesson_n     INTEGER NOT NULL,
    qid          TEXT NOT NULL,              -- the question's id in the lesson (q1, q2, ...)
    lesson_title TEXT,
    box          INTEGER NOT NULL DEFAULT 0, -- Leitner box: 0 = just got wrong
    due_at       INTEGER,                    -- NULL once mastered
    streak       INTEGER NOT NULL DEFAULT 0, -- right answers in a row, in review
    misses       INTEGER NOT NULL DEFAULT 0, -- wrong answers, in lessons and in review
    reviews      INTEGER NOT NULL DEFAULT 0, -- answers given in review
    rights       INTEGER NOT NULL DEFAULT 0, -- right answers given in review
    last_review  INTEGER,
    mastered_at  INTEGER,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE (user_id, course_id, lesson_n, qid)
  );
  CREATE INDEX review_items_due ON review_items(user_id, mastered_at, due_at);
  CREATE INDEX review_items_course ON review_items(course_id);
`);

const DAY = 86400_000;
// "Tomorrow" means the next day, not 24 hours to the minute: a mistake made in
// the afternoon is ready the next morning.
const EARLY = 8 * 3600_000;
export const INTERVALS = [1, 3, 7]; // days until the next review, by box
export const MASTER_STREAK = 2;     // right answers in a row that fix a mistake
const REVIEWABLE = new Set(['choice', 'numeric', 'text']);
const QID = /^[A-Za-z0-9_-]{1,40}$/;
const LIST_MAX = 50;

const dueAfter = (box, t) => t + INTERVALS[Math.min(box, INTERVALS.length - 1)] * DAY - EARLY;

function findQuestion(lesson, qid) {
  for (const s of (lesson && Array.isArray(lesson.sections) ? lesson.sections : [])) {
    for (const qq of (Array.isArray(s.checkpoint) ? s.checkpoint : [])) {
      if (qq && qq.id === qid) return { q: qq, section: s };
    }
  }
  return null;
}

// Questions asked beside a lesson rather than in it: the quizzes after its videos (videos.mjs).
// extraQuestion(courseId, n, qid) -> { q, section: { title } } | null
export const reviewHooks = { extraQuestion: null };
const findAny = (lesson, courseId, n, qid) => findQuestion(lesson, qid)
  || (lesson && reviewHooks.extraQuestion ? reviewHooks.extraQuestion(courseId, n, qid) : null);

// Only what the browser needs to ask the question again and check the answer.
const KEYS = ['id', 'type', 'prompt', 'choices', 'answer', 'tolerance', 'unit', 'accept', 'hint', 'explain'];
function questionOut(qq) {
  const out = {};
  KEYS.forEach((k) => { if (qq[k] !== undefined && qq[k] !== null) out[k] = qq[k]; });
  return out;
}

/* ---------------- a wrong answer in a lesson ---------------- */

function schedule(user, courseId, body) {
  if (!courseId) return;
  const qid = typeof body.qid === 'string' && QID.test(body.qid) ? body.qid : null;
  const n = Number(body.lesson);
  if (!qid || !Number.isInteger(n) || n < 1) return;
  const row = q('SELECT data FROM courses WHERE id = ? AND user_id = ?').get(courseId, user.id);
  if (!row) return;
  const meta = parseJSON(row.data, {});
  const outline = flatten(meta.units || [])[n - 1];
  if (!outline) return;
  // Sample courses' lessons are built in the browser (P.courseGen.lesson), so the question can't be
  // checked here; every other lesson is saved before it's shown, so the question must be in it.
  if (meta.source !== 'sample') {
    const stored = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(courseId, n);
    const found = stored && findAny(parseJSON(stored.data, null), courseId, n, qid);
    if (!found || !REVIEWABLE.has(found.q.type)) return;
  }
  const t = now();
  q(`INSERT INTO review_items (user_id, course_id, lesson_n, qid, lesson_title, box, due_at, streak, misses, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, 0, 1, ?, ?)
     ON CONFLICT (user_id, course_id, lesson_n, qid) DO UPDATE SET
       box = 0, due_at = excluded.due_at, streak = 0, mastered_at = NULL, misses = misses + 1,
       lesson_title = excluded.lesson_title, updated_at = excluded.updated_at`)
    .run(user.id, courseId, n, qid, outline.title, dueAfter(0, t), t, t);
}

mistakeHooks.afterRecord = (user, courseId, body) => {
  try { schedule(user, courseId, body); } catch (err) { console.error('[review]', err); }
};

/* ---------------- numbers ---------------- */

const dueCount = (userId) => q('SELECT COUNT(*) AS n FROM review_items WHERE user_id = ? AND mastered_at IS NULL AND due_at <= ?').get(userId, now()).n;

function stats(user, courseId) {
  const sql = `SELECT r.course_id AS id, c.data AS data, COUNT(*) AS made,
      SUM(r.mastered_at IS NOT NULL) AS fixed, SUM(r.mastered_at IS NULL AND r.due_at <= ?) AS due,
      SUM(r.misses) AS misses, SUM(r.reviews) AS reviews, SUM(r.rights) AS rights
    FROM review_items r JOIN courses c ON c.id = r.course_id
    WHERE r.user_id = ?${courseId ? ' AND r.course_id = ?' : ''}
    GROUP BY r.course_id ORDER BY MAX(r.updated_at) DESC`;
  const args = courseId ? [now(), user.id, courseId] : [now(), user.id];
  const courses = q(sql).all(...args).map((r) => {
    const meta = parseJSON(r.data, {});
    return {
      id: r.id, title: meta.title || meta.topic || 'Untitled course',
      made: r.made, fixed: r.fixed, learning: r.made - r.fixed, due: r.due,
      misses: r.misses, reviews: r.reviews, rights: r.rights
    };
  });
  const total = { made: 0, fixed: 0, learning: 0, due: 0, misses: 0, reviews: 0, rights: 0 };
  courses.forEach((c) => Object.keys(total).forEach((k) => { total[k] += c[k]; }));
  return { courses, total };
}

/* ---------------- the questions, ready to ask again ---------------- */

function resolver(user) {
  const metas = new Map(), lessons = new Map(), translations = new Map();
  const metaOf = (id) => {
    if (!metas.has(id)) {
      const r = q('SELECT data FROM courses WHERE id = ? AND user_id = ?').get(id, user.id);
      metas.set(id, r ? parseJSON(r.data, {}) : null);
    }
    return metas.get(id);
  };
  const lessonOf = (id, n) => {
    const key = id + '|' + n;
    if (!lessons.has(key)) {
      const r = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(id, n);
      lessons.set(key, r ? parseJSON(r.data, null) : null);
    }
    return lessons.get(key);
  };
  // the learner's own language, if the lesson was translated for them (translate.mjs)
  const translationOf = (id, n, lang) => {
    const key = id + '|' + n + '|' + lang;
    if (!translations.has(key)) {
      let r = null;
      try { r = q('SELECT data FROM lesson_translations WHERE course_id = ? AND n = ? AND lang = ?').get(id, n, lang); } catch { r = null; }
      translations.set(key, r ? parseJSON(r.data, null) : null);
    }
    return translations.get(key);
  };

  return (r) => {
    const meta = metaOf(r.course_id);
    if (!meta) return null;
    const outline = flatten(meta.units || [])[r.lesson_n - 1];
    const lang = meta.lang || 'en';
    const item = {
      id: r.id,
      course: { id: r.course_id, title: meta.title || meta.topic || 'Untitled course', source: meta.source || 'sample', lang },
      lesson: r.lesson_n,
      lessonTitle: (outline && outline.title) || r.lesson_title || '',
      qid: r.qid, box: r.box, streak: r.streak, misses: r.misses, reviews: r.reviews,
      dueAt: r.due_at, createdAt: r.created_at,
      question: null, section: null, translated: null, builtIn: false
    };
    if (item.course.source === 'sample') {
      item.builtIn = true; // the browser builds sample lessons itself (P.courseGen.lesson), as the lesson page does
      return item;
    }
    const lesson = lessonOf(r.course_id, r.lesson_n);
    if (lesson) {
      const f = findAny(lesson, r.course_id, r.lesson_n, r.qid);
      if (!f || !REVIEWABLE.has(f.q.type)) return null;
      item.question = questionOut(f.q);
      item.section = typeof f.section.title === 'string' ? f.section.title : null;
      if (user.lang && user.lang !== lang) {
        const tf = findQuestion(translationOf(r.course_id, r.lesson_n, user.lang), r.qid);
        if (tf && tf.q.type === f.q.type) {
          item.translated = { lang: user.lang, question: questionOut(tf.q), section: typeof tf.section.title === 'string' ? tf.section.title : null };
        }
      }
      return item;
    }
    return null;
  };
}

/* ---------------- routes ---------------- */

async function getReview({ req, res, url }) {
  const u = requireUser(req);
  const filter = url.searchParams.get('course');
  const own = filter ? ownCourse(u, filter) : null;
  const courseId = own ? own.id : null;
  const rows = courseId
    ? q('SELECT * FROM review_items WHERE user_id = ? AND course_id = ? AND mastered_at IS NULL ORDER BY due_at, id').all(u.id, courseId)
    : q('SELECT * FROM review_items WHERE user_id = ? AND mastered_at IS NULL ORDER BY due_at, id').all(u.id);
  const t = now();
  const resolve = resolver(u);
  const due = [], upcoming = [];
  for (const r of rows) {
    const item = resolve(r);
    if (item) (r.due_at <= t ? due : upcoming).push(item);
  }
  const s = stats(u, courseId);
  const learning = due.concat(upcoming);
  const meta = own ? parseJSON(own.data, {}) : null;
  sendJSON(res, 200, {
    ok: true, now: t,
    course: own ? { id: own.id, title: meta.title || meta.topic || 'Untitled course' } : null,
    counts: {
      due: due.length, upcoming: upcoming.length, mastered: s.total.fixed, total: learning.length + s.total.fixed,
      wrongLast: learning.filter((x) => x.streak === 0).length, // got it wrong the last time it was asked
      rightOnce: learning.filter((x) => x.streak > 0).length    // one more right answer fixes it
    },
    due: due.slice(0, LIST_MAX),
    upcoming: upcoming.slice(0, LIST_MAX),
    stats: s,
    dueAll: courseId ? dueCount(u.id) : due.length
  });
}

async function getStats({ req, res, url }) {
  const u = requireUser(req);
  const filter = url.searchParams.get('course');
  const courseId = filter ? ownCourse(u, filter).id : null;
  sendJSON(res, 200, { ok: true, ...stats(u, courseId) });
}

async function answer({ req, res, params }) {
  const u = requireUser(req);
  if (overLimit('review:' + u.id, 400, 600_000)) throw new HttpError('That’s a lot of answers in a few minutes. Take a short break, then carry on.', 429);
  const id = Number(params.id);
  const row = Number.isSafeInteger(id) ? q('SELECT * FROM review_items WHERE id = ? AND user_id = ?').get(id, u.id) : null;
  if (!row) throw new HttpError('That review question doesn’t exist.', 404);
  const body = await readBody(req, 1_000);
  if (typeof body.right !== 'boolean') throw new HttpError('Say whether the answer was right.', 400);
  const t = now();
  const early = row.mastered_at == null && row.due_at > t;
  let { box, streak, due_at: dueAt, mastered_at: masteredAt } = row;
  if (body.right) {
    if (masteredAt == null) {
      streak += 1;
      box = Math.min(box + 1, INTERVALS.length - 1);
      if (streak >= MASTER_STREAK) { masteredAt = t; dueAt = null; } else dueAt = dueAfter(box, t);
    }
  } else {
    box = 0; streak = 0; masteredAt = null; dueAt = dueAfter(0, t);
  }
  q(`UPDATE review_items SET box = ?, streak = ?, due_at = ?, mastered_at = ?, reviews = reviews + 1,
       rights = rights + ?, misses = misses + ?, last_review = ?, updated_at = ? WHERE id = ?`)
    .run(box, streak, dueAt, masteredAt, body.right ? 1 : 0, body.right ? 0 : 1, t, t, row.id);
  sendJSON(res, 200, {
    ok: true,
    item: { id: row.id, box, streak, dueAt, mastered: masteredAt != null, masteredAt, early },
    dueAll: dueCount(u.id)
  });
}

export const routes = [
  ['GET', /^\/api\/review$/, getReview],
  ['GET', /^\/api\/review\/stats$/, getStats],
  ['POST', /^\/api\/review\/(?<id>\d+)\/answer$/, answer]
];

export const pages = [{ file: 'review.html', protected: true }];

// How many questions are due, for the badge on the Review link in the header.
export const boot = (user) => (user ? { reviewDue: dueCount(user.id) } : {});
