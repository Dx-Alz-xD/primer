// =====================================================================
// A course as a book: book.html?course=<id> reads it page by page, and
// the browser packs the same chapters into an EPUB (assets/js/epub.js).
//
// GET /api/courses/:id/book returns the course and every lesson written
// so far in one call, so the reader doesn't make one request per lesson.
// Lesson HTML is returned as stored; the browser sanitizes it before
// showing it, exactly as the lesson player does.
// =====================================================================
import { q, parseJSON } from './db.mjs';
import { sendJSON } from './http.mjs';
import { requireUser } from './auth.mjs';
import { loadCourse, hooks } from './data.mjs';

// A lesson's kept sources (refs.mjs) go into its chapter too.
const withRefs = (course, n, lesson) => (hooks.bookRefs && lesson ? hooks.bookRefs(course, n, lesson) : lesson);

async function book({ req, res, params }) {
  const course = loadCourse(requireUser(req), params.id);
  const lessons = q('SELECT n, data, model FROM lessons WHERE course_id = ? ORDER BY n').all(course.id)
    .map((r) => ({ n: r.n, lesson: withRefs(course, r.n, parseJSON(r.data, null)), model: r.model || null }))
    .filter((l) => l.lesson && Array.isArray(l.lesson.sections));
  sendJSON(res, 200, { ok: true, course, lessons });
}

export const routes = [
  ['GET', /^\/api\/courses\/(?<id>[^/]+)\/book$/, book]
];

export const pages = [{ file: 'book.html', protected: true }];
