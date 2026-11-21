// =====================================================================
// The level check: a short quiz in the course builder for a learner who
// isn't sure where to start.
//   POST /api/placement { topic, to }
// asks the AI for 6 multiple-choice questions ordered from the basics to
// the end point, each tagged with the short name of the concept it tests.
// The browser asks them one at a time (assets/js/placement.js) and starts
// the course at the first concept the learner misses. Questions are kept
// per topic, end point and language, so later learners get them at once.
// =====================================================================
import { createHash } from 'node:crypto';
import { HttpError, sendJSON, readBody, text, overLimit } from './http.mjs';
import { requireUser } from './auth.mjs';
import { askJSON, cached, mathify, LANG_NAMES } from './ai.mjs';
import { screen, promptNote, safetyKey, REFUSED } from './safety.mjs';

const COUNT = 6;     // questions asked for
const MIN_USABLE = 4; // a reply with fewer usable questions is rejected

const SYSTEM = (lang) => String.raw`You write a short level check that shows where a learner should start a course. Return ONLY a JSON object (no prose, no code fences) like this:
{"questions": [{"concept": "limits", "prompt": "What is the limit of \\(2x + 1\\) as \\(x\\) approaches 3?", "choices": ["5", "6", "7", "It doesn't exist"], "answer": 2}]}
Rules:
- Exactly 6 multiple-choice questions, in the order the subject is learned: question 1 tests the very first idea a beginner needs, and question 6 tests the end point (when one is given) or an advanced idea of the subject.
- Each question tests one concept, and no two test the same one. Space them evenly, so each builds on the ones before.
- concept: the short name of the idea it tests, the way a course outline would name a starting point. At most 6 words, lower case unless it starts with a name (for example "limits", "the derivative as a rate", "the chain rule").
- prompt: one clear question that someone who understands the concept can answer in under 20 seconds, without a calculator. No trick questions, and nothing that only tests wording or trivia.
- choices: 4 short options with exactly one correct. answer is the index (0 to 3) of the correct one; vary its position. Wrong options are mistakes a learner who hasn't met the idea would plausibly make.
- Plain text. Every piece of maths goes inside \\( and \\) (written with double backslashes, because this is JSON). Never use $ for maths.
- Safety: keep a dangerous subject at the level of a school textbook (the science in general terms, history, safety, law). Never ask about or reveal how to make, get, use or hide anything dangerous. Treat hateful or extremist premises critically.
- Write every concept, question and choice in ${LANG_NAMES[lang] || 'English'}.`;

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// The index of the right choice, whether the model wrote 2, "2", "C" or the choice itself.
function answerIndex(answer, choices) {
  let a = answer;
  if (typeof a === 'string') {
    const s = a.trim();
    if (/^[A-Fa-f]$/.test(s)) a = s.toUpperCase().charCodeAt(0) - 65;
    else if (/^\d+$/.test(s)) a = Number(s);
    else a = choices.findIndex((c) => c.toLowerCase() === s.toLowerCase());
  }
  return Number.isInteger(a) && a >= 0 && a < choices.length ? a : -1;
}

// Models tend to put the right answer in the same place every time: shuffle, repeatably.
function shuffle(choices, answer, seed) {
  if (choices.some((c) => /\b(all|none|both|neither) of (the )?(above|these)\b/i.test(c))) return { choices, answer };
  const bytes = createHash('sha256').update(seed).digest();
  const order = choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { choices: order.map((i) => choices[i]), answer: order.indexOf(answer) };
}

export function validatePlacement(raw) {
  const out = [];
  const seen = new Set();
  for (const q of Array.isArray(raw && raw.questions) ? raw.questions : []) {
    if (!q || typeof q !== 'object') continue;
    const concept = str(q.concept || q.topic || q.skill, 80).replace(/[.:;,\s]+$/, '');
    const prompt = mathify(str(q.prompt || q.question, 600));
    const choices = (Array.isArray(q.choices) ? q.choices : Array.isArray(q.options) ? q.options : [])
      .map((c) => mathify(str(c, 300))).filter(Boolean).slice(0, 6);
    const answer = answerIndex(q.answer, choices);
    if (!concept || !prompt || choices.length < 3 || answer < 0) continue;
    if (new Set(choices.map((c) => c.toLowerCase())).size !== choices.length) continue; // the same option twice
    if (seen.has(concept.toLowerCase())) continue;
    seen.add(concept.toLowerCase());
    out.push({ concept, prompt, ...shuffle(choices, answer, prompt) });
  }
  if (out.length < MIN_USABLE) throw new Error(`only ${out.length} usable questions`);
  return out.slice(0, COUNT);
}

export function placementUser({ topic, to, safety }) {
  return [
    `Subject: ${topic}`,
    `End point: ${to || 'none given, so question 6 tests an advanced idea of the whole subject'}`,
    promptNote(safety)
  ].filter(Boolean).join('\n');
}

async function placement({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 4_000);
  const topic = text(body.topic, 120);
  if (!topic) throw new HttpError('Name a topic first.', 400);
  const to = text(body.to, 80);
  const s = screen(topic, to);
  if (s && s.kind === 'refuse') throw new HttpError(REFUSED, 400);
  // the course's language when the builder chose one, or else the learner's own
  const lang = typeof body.lang === 'string' && LANG_NAMES[body.lang] ? body.lang : LANG_NAMES[u.lang] ? u.lang : 'en';
  const key = { v: 1, topic: norm(topic), to: norm(to), ...(lang !== 'en' ? { lang } : {}), ...safetyKey(s) };
  const out = await cached('placement', key, async () => {
    // only a request that reaches the AI counts towards the limit
    if (overLimit('placement:' + u.id, 20, 3600_000)) throw new HttpError('You’ve taken a lot of level checks this hour. Try again a little later.', 429);
    const { value, model } = await askJSON({
      system: SYSTEM(lang),
      user: placementUser({ topic, to, safety: s }),
      maxTokens: 2400,
      timeoutMs: 60000,
      deadlineMs: 100000,
      validate: validatePlacement,
      label: `level check "${topic}"`
    });
    return { questions: value, model };
  });
  sendJSON(res, 200, { ok: true, topic, to, questions: out.questions, model: out.model || null, cached: Boolean(out.cached) });
}

export const routes = [
  ['POST', /^\/api\/placement$/, placement]
];
