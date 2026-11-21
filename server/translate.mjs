// =====================================================================
// Lessons in the learner's language. New courses are written in it from
// the start (see data.mjs); this translates a lesson that was written in
// another language, once, and keeps the result per lesson and language.
// =====================================================================
import { q, schema, now, parseJSON } from './db.mjs';
import { HttpError, sendJSON, readBody, text, overLimit } from './http.mjs';
import { requireUser } from './auth.mjs';
import { ownCourse, flatten } from './data.mjs';
import { translateLesson, LANG_NAMES } from './ai.mjs';

schema('translate-1', `
  CREATE TABLE lesson_translations (
    course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    n          INTEGER NOT NULL,
    lang       TEXT NOT NULL,
    data       TEXT NOT NULL,
    model      TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (course_id, n, lang)
  );
`);

async function translate({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 4_000);
  const row = ownCourse(u, text(body.courseId, 64));
  const n = Number(body.n);
  const lang = text(body.lang, 5) || u.lang;
  if (!LANG_NAMES[lang]) throw new HttpError('That language isn’t available yet.', 400);
  const meta = parseJSON(row.data, {});
  const original = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(row.id, n);
  if (!original) throw new HttpError('That lesson hasn’t been written yet.', 404);
  if ((meta.lang || 'en') === lang) return sendJSON(res, 200, { ok: true, lesson: parseJSON(original.data), lang, original: true });
  const have = q('SELECT data, model FROM lesson_translations WHERE course_id = ? AND n = ? AND lang = ?').get(row.id, n, lang);
  if (have) return sendJSON(res, 200, { ok: true, lesson: parseJSON(have.data), model: have.model, lang });
  if (overLimit('translate:' + u.id, 30, 3600_000)) throw new HttpError('You’ve translated a lot this hour. Try again a little later.', 429);
  const title = (flatten(meta.units || [])[n - 1] || {}).title || 'this lesson';
  const out = await translateLesson({ lesson: parseJSON(original.data), lang, title });
  q('INSERT OR REPLACE INTO lesson_translations (course_id, n, lang, data, model, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, n, lang, JSON.stringify(out.lesson), out.model, now());
  sendJSON(res, 200, { ok: true, lesson: out.lesson, model: out.model, lang });
}

export const routes = [
  ['POST', /^\/api\/lesson\/translate$/, translate]
];
