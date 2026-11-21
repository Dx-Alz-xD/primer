// =====================================================================
// The tutor.
// - Answers every doubt a learner asks in a lesson, using the part of the
//   lesson it came from.
// - A conversation the learner can open on any page.
// Both remember: the prompt includes the learner's recent wrong answers
// and doubts, so the tutor can point out a pattern ("you've mixed up
// secant and tangent before") instead of starting from zero each time.
// =====================================================================
import { q, schema, now, parseJSON } from './db.mjs';
import { HttpError, sendJSON, readBody, text, longText, overLimit } from './http.mjs';
import { requireUser } from './auth.mjs';
import { askJSON, config, mathify } from './ai.mjs';
import { doubtHooks, ownCourse, flatten } from './data.mjs';
import { screen, courseSafety, promptNote, REFUSED } from './safety.mjs';

// What the tutor says when someone may be struggling and the AI can't be reached.
const SUPPORT = {
  en: '<p>I’m really sorry you’re going through this. You don’t have to face it alone. Please talk to someone you trust, or call India’s Tele-MANAS helpline on <strong>14416</strong>. It’s free and open at any time.</p><p>Outside India, findahelpline.com lists free helplines near you.</p>',
  hi: '<p>मुझे बहुत दुख है कि आप इस दौर से गुज़र रहे हैं। आपको इसका सामना अकेले नहीं करना है। कृपया किसी भरोसेमंद व्यक्ति से बात करें, या भारत की टेली-मानस हेल्पलाइन <strong>14416</strong> पर कॉल करें। यह मुफ़्त है और हर समय उपलब्ध है।</p><p>भारत के बाहर, findahelpline.com पर आपके पास की मुफ़्त हेल्पलाइनें मिलेंगी।</p>',
  ru: '<p>Мне очень жаль, что вам сейчас так тяжело. Вы не обязаны справляться с этим в одиночку. Пожалуйста, поговорите с человеком, которому доверяете, или позвоните на индийскую линию помощи Tele-MANAS: <strong>14416</strong>, бесплатно и круглосуточно.</p><p>За пределами Индии бесплатные линии помощи рядом с вами есть на findahelpline.com.</p>'
};
export const support = (lang) => SUPPORT[lang] || SUPPORT.en;

schema('tutor-1', `
  CREATE TABLE tutor_messages (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,             -- learner | tutor
    content    TEXT NOT NULL,             -- learner: plain text; tutor: simple HTML
    course_id  TEXT,
    lesson_n   INTEGER,
    model      TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX tutor_user ON tutor_messages(user_id, created_at);
`);

const LANG_NAMES = { en: 'English', hi: 'Hindi', ru: 'Russian' };

const strip = (html) => String(html || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

// The words of a lesson (or one part of it), as plain text with LaTeX left in.
export function lessonText(courseId, n, sectionTitle, max = 5000) {
  const row = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(courseId, n);
  if (!row) return '';
  const sections = (parseJSON(row.data, {}).sections) || [];
  let pick = sectionTitle ? sections.filter((s) => s.title === sectionTitle) : [];
  if (!pick.length) pick = sections;
  return pick.map((s) => `## ${s.title}\n` + (s.blocks || []).map((b) => {
    if (b.t === 'math') return `\\[${b.tex}\\]`;
    if (b.items) return b.items.map((i) => '- ' + strip(i)).join('\n');
    if (b.t === 'figure') return b.caption ? `(Figure: ${strip(b.caption)})` : '';
    return strip(b.html || b.text || '');
  }).filter(Boolean).join('\n')).join('\n\n').slice(0, max);
}

// What the tutor remembers about this learner.
function memory(userId) {
  const mistakes = q('SELECT lesson_title, prompt, given, correct FROM mistakes WHERE user_id = ? ORDER BY created_at DESC LIMIT 8').all(userId);
  const doubts = q('SELECT lesson_title, question FROM doubts WHERE user_id = ? ORDER BY created_at DESC LIMIT 6').all(userId);
  const parts = [];
  parts.push(mistakes.length
    ? 'Questions they recently got wrong (newest first):\n' + mistakes.map((m) =>
      `- In "${m.lesson_title || 'a lesson'}": "${m.prompt.slice(0, 220)}" They answered "${m.given || '?'}"; the answer was "${m.correct || '?'}".`).join('\n')
    : 'They have no wrong answers on record yet.');
  if (doubts.length) parts.push('Doubts they asked recently:\n' + doubts.map((d) => `- "${d.question.slice(0, 220)}"${d.lesson_title ? ` (in "${d.lesson_title}")` : ''}`).join('\n'));
  return parts.join('\n\n');
}

function courseLine(meta) {
  return `"${meta.title}" on ${meta.topic}, from ${meta.from || 'the very beginning'} to ${meta.to || 'the end of the subject'}` +
    (meta.instructions ? `. Their teaching instructions: "${meta.instructions}"` : '');
}

const SYSTEM = (lang) => String.raw`You are the tutor inside Primer, a course app. You help one learner, and you know their recent wrong answers and doubts.
Return ONLY a JSON object: {"html": "your reply"}.
How to reply:
- Answer their actual question first, directly. Then, only if it helps, one short example or a check-your-understanding question.
- At most about 170 words. Short paragraphs. Warm, plain and precise, at the level of their course.
- Allowed HTML: <p>, <strong>, <em>, <ul>, <ol>, <li>, <br>. Nothing else.
- Every piece of maths goes inside \\( and \\) (written with double backslashes, because this is JSON).
- If one of their past mistakes is relevant, name the pattern kindly in one sentence. Don't list their history otherwise.
- Follow their teaching instructions if the course has any.
- If you are not sure of something, say so. Never invent facts.
- Safety: keep dangerous subjects at textbook level (the science in general terms, history, safety, law). Never give instructions, recipes, quantities, designs, or ways to obtain or hide anything dangerous. Answer hateful or extremist claims critically, with the evidence.
- If the learner seems to be struggling or mentions hurting themselves, answer kindly first, encourage them to talk to someone they trust, and give India's Tele-MANAS helpline (14416, free, any time) or a local helpline.
- Write in ${LANG_NAMES[lang] || 'English'}.`;

function validateReply(raw) {
  const html = typeof raw.html === 'string' ? raw.html.trim() : typeof raw.answer === 'string' ? raw.answer.trim() : '';
  if (html.length < 8) throw new Error('empty reply');
  const wrapped = /^<(p|ul|ol)\b/i.test(html) ? html : `<p>${html}</p>`;
  return mathify(wrapped.slice(0, 6000));
}

/* ---------------- answering doubts ---------------- */

const answering = new Set();
async function answerDoubt(user, d) {
  if (answering.has(d.id)) return;
  answering.add(d.id);
  try {
    let course = '', lesson = '', meta = null;
    if (d.course_id) {
      const row = q('SELECT data FROM courses WHERE id = ?').get(d.course_id);
      meta = parseJSON(row && row.data, {});
      course = `Course: ${courseLine(meta)}.`;
      lesson = lessonText(d.course_id, d.lesson_n, d.section, 3500);
    }
    const answer = (html, model) => q('UPDATE doubts SET answer = ?, answer_model = ?, answered_at = ? WHERE id = ?').run(html, model, now(), d.id);
    const s = screen(d.question, d.quote, d.context) || (meta ? courseSafety(meta) : null);
    if (s && s.kind === 'refuse') return answer(`<p>${REFUSED}</p>`, 'safety');
    const about = d.kind === 'drawing'
      ? `They drew on the lesson page (a sketch, circled or underlined something) near this text: "${d.context || ''}"`
      : d.kind === 'selection' ? `They selected this passage: "${d.quote || ''}"` : '';
    const prompt = [
      course,
      d.lesson_title ? `Lesson: "${d.lesson_title}"${d.section ? `, part "${d.section}"` : ''}.` : '',
      lesson ? `The part of the lesson they were reading:\n${lesson}` : '',
      about,
      `Their question: ${d.question}`,
      '',
      memory(user.id),
      promptNote(s)
    ].filter(Boolean).join('\n');
    let out;
    try {
      out = await askJSON({ system: SYSTEM(user.lang), user: prompt, maxTokens: 1600, validate: validateReply, label: `doubt ${d.id}` });
    } catch (err) {
      if (s && s.kind === 'selfharm') return answer(support(user.lang), 'safety'); // never leave someone struggling without an answer
      throw err;
    }
    answer(out.value, out.model);
  } finally {
    answering.delete(d.id);
  }
}

doubtHooks.afterAsk = (user, row) => {
  const urgent = screen(row.question, row.quote, row.context);
  if (!config().ai && !(urgent && (urgent.kind === 'selfharm' || urgent.kind === 'refuse'))) return;
  if (overLimit('doubt-answers:' + user.id, 40, 3600_000)) return;
  answerDoubt(user, row).catch((err) => console.log(`[tutor] doubt ${row.id} not answered: ${err.message}`));
};

// Ask again for a doubt that has no answer (the first try can fail when the free models are busy).
async function retryDoubt({ req, res, params }) {
  const u = requireUser(req);
  const d = q('SELECT * FROM doubts WHERE id = ? AND user_id = ?').get(Number(params.id), u.id);
  if (!d) throw new HttpError('That doubt doesn’t exist.', 404);
  if (d.answer) return sendJSON(res, 200, { ok: true, answered: true });
  if (!config().ai) throw new HttpError('The tutor needs an OpenRouter key in .env.', 503);
  if (overLimit('doubt-answers:' + u.id, 40, 3600_000)) throw new HttpError('You’ve asked a lot this hour. Try again a little later.', 429);
  await answerDoubt(u, d);
  sendJSON(res, 200, { ok: true, answered: true });
}

/* ---------------- the conversation ---------------- */

const msgOut = (m) => ({ id: m.id, role: m.role, content: m.content, courseId: m.course_id, lesson: m.lesson_n, at: m.created_at });

async function history({ req, res }) {
  const u = requireUser(req);
  const rows = q('SELECT * FROM (SELECT * FROM tutor_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 60) ORDER BY created_at').all(u.id);
  sendJSON(res, 200, { ok: true, messages: rows.map(msgOut), ai: config().ai });
}

async function clear({ req, res }) {
  const u = requireUser(req);
  q('DELETE FROM tutor_messages WHERE user_id = ?').run(u.id);
  sendJSON(res, 200, { ok: true });
}

async function chat({ req, res }) {
  const u = requireUser(req);
  if (overLimit('tutor:' + u.id, 40, 3600_000)) throw new HttpError('You’ve asked the tutor a lot this hour. Try again a little later.', 429);
  const body = await readBody(req, 8_000);
  const message = longText(body.message, 1500);
  if (!message) throw new HttpError('Type a question first.', 400);
  let s = screen(message);
  if (s && s.kind === 'refuse') throw new HttpError(REFUSED, 400);
  // someone who may be struggling always gets an answer, even with no AI
  const struggling = Boolean(s && s.kind === 'selfharm');
  if (!config().ai && !struggling) throw new HttpError('The tutor needs an OpenRouter key in .env.', 503);

  let courseId = null, lessonN = null, here = '';
  if (body.courseId) {
    const row = ownCourse(u, text(body.courseId, 64));
    const meta = parseJSON(row.data, {});
    if (!s) s = courseSafety(meta);
    if (s && s.kind === 'refuse') throw new HttpError(REFUSED, 400);
    courseId = row.id;
    lessonN = Number.isInteger(Number(body.lesson)) && Number(body.lesson) > 0 ? Number(body.lesson) : null;
    const flat = flatten(meta.units || []);
    here = `They are looking at the course ${courseLine(meta)}.` +
      (lessonN && flat[lessonN - 1] ? `\nThey are on lesson ${lessonN}, "${flat[lessonN - 1].title}". Its text:\n${lessonText(row.id, lessonN, null, 4000)}` : '');
  }
  const courses = q('SELECT c.data, (SELECT COUNT(*) FROM progress p WHERE p.course_id = c.id AND p.done = 1) AS done FROM courses c WHERE c.user_id = ? ORDER BY c.opened_at DESC LIMIT 8').all(u.id)
    .map((r) => { const m = parseJSON(r.data, {}); return `- "${m.title}" (${flatten(m.units || []).length} lessons, ${r.done} done)`; });
  const past = q('SELECT role, content FROM (SELECT * FROM tutor_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 10) ORDER BY created_at').all(u.id)
    .map((m) => `${m.role === 'learner' ? 'Learner' : 'Tutor'}: ${m.role === 'tutor' ? strip(m.content) : m.content}`.slice(0, 700));

  const prompt = [
    `The learner is ${u.name}.`,
    courses.length ? `Their courses:\n${courses.join('\n')}` : 'They have no courses yet.',
    here,
    memory(u.id),
    past.length ? `Your conversation so far:\n${past.join('\n')}` : '',
    `Their new message: ${message}`,
    promptNote(s)
  ].filter(Boolean).join('\n\n');

  const t = now();
  const mine = q('INSERT INTO tutor_messages (user_id, role, content, course_id, lesson_n, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(u.id, 'learner', message, courseId, lessonN, t);
  let out;
  try {
    out = await askJSON({ system: SYSTEM(u.lang), user: prompt, maxTokens: 1600, validate: validateReply, label: `tutor ${u.id}` });
  } catch (err) {
    if (!struggling) {
      q('DELETE FROM tutor_messages WHERE id = ?').run(Number(mine.lastInsertRowid));
      throw err;
    }
    out = { value: support(u.lang), model: 'safety' };
  }
  const id = Number(q('INSERT INTO tutor_messages (user_id, role, content, course_id, lesson_n, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(u.id, 'tutor', out.value, courseId, lessonN, out.model, now()).lastInsertRowid);
  sendJSON(res, 200, { ok: true, reply: msgOut(q('SELECT * FROM tutor_messages WHERE id = ?').get(id)), model: out.model });
}

export const routes = [
  ['GET', /^\/api\/tutor$/, history],
  ['POST', /^\/api\/tutor$/, chat],
  ['DELETE', /^\/api\/tutor$/, clear],
  ['POST', /^\/api\/doubts\/(?<id>\d+)\/answer$/, retryDoubt]
];
