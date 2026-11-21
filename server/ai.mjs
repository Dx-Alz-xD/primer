// =====================================================================
// Primer AI: course outlines and lessons from OpenRouter's free models.
//
// - Tries each model in OPENROUTER_MODELS in order; a busy or failing
//   model falls through to the next one.
// - Asks for JSON in Primer's lesson format, repairs the usual LaTeX
//   escaping mistakes, and checks the shape before accepting it.
// - Caches every outline and lesson in data/cache, so the same request
//   never spends a second free request.
// =====================================================================
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'data', 'cache');
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function config() {
  return {
    key: (process.env.OPENROUTER_API_KEY || '').trim(),
    models: (process.env.OPENROUTER_MODELS || 'openrouter/free').split(',').map((s) => s.trim()).filter(Boolean),
    appName: process.env.OPENROUTER_APP_NAME || 'Primer',
    siteUrl: process.env.OPENROUTER_SITE_URL || 'http://localhost:5173'
  };
}

export class AIError extends HttpError {
  constructor(message, status = 502) {
    super(message, status);
  }
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

const OUTLINE_SYSTEM = String.raw`You plan detailed online courses. Return ONLY a JSON object (no prose, no code fences) shaped like this:
{
  "title": "course title, at most 6 words",
  "units": [
    { "title": "unit title",
      "lessons": [
        { "title": "lesson title, at most 8 words",
          "desc": "one sentence (at most 20 words) saying what the learner will understand or be able to do",
          "tags": ["maths", "diagram", "practice", "written"],
          "minutes": 15 }
      ] }
  ]
}
Rules:
- As many lessons as the requested range genuinely needs, and no more: usually 12 to 40. A narrow range needs fewer, a whole subject more, and a very large subject can go well beyond 40. Never pad with filler, repeats or vague review lessons to reach a number.
- Group the lessons into units of about 3 to 8 lessons each, ordered so every lesson builds on the ones before it.
- Lessons are specific and concrete (never vague titles like "Advanced concepts"); together they cover the requested range thoroughly.
- Respect the range. If a starting point is given, assume the learner already knows everything before it and open with a short recap lesson of that starting point. If an end point is given, finish exactly there, ending with a capstone lesson on it.
- tags: "maths" if the lesson uses formulas, "diagram" if a figure helps, "practice" if it is problem-heavy, "written" if it asks for a written explanation. Use only these four tags; an empty list is fine.
- minutes: realistic study time between 8 and 25.
- Titles and descriptions are plain text shown in a list: no LaTeX, no $ signs, no markdown. Describe formulas in words (for example "the power rule for powers of x").
- Follow the learner's teaching instructions wherever they affect the plan.`;

const LESSON_SYSTEM = String.raw`You write one lesson of an online course as JSON. The app shows the lesson one section at a time: a learner must answer a section's checkpoint questions before the next section appears, and a wrong answer re-shows that section's "recap" points.

Return ONLY a JSON object (no prose, no code fences) shaped like this:
{
  "sections": [
    { "title": "short section title",
      "blocks": [ ...content blocks... ],
      "recap": ["2 to 4 short key points of this section"],
      "checkpoint": [ ...1 or 2 questions about THIS section... ] }
  ]
}

Content blocks:
- {"t": "p", "html": "A paragraph. May use <strong>, <em>, <sub>, <sup>. Inline maths goes inside \\( and \\), for example \\(x^2 + 1\\)."}
- {"t": "math", "tex": "a display formula in LaTeX without delimiters, for example \\frac{a}{b}"}
- {"t": "list", "items": ["point one", "point two"]}
- {"t": "callout", "kind": "example", "title": "Worked example", "html": "..."}   (kind is one of: example, mnemonic, eli5, note)
- {"t": "figure", "svg": "<svg viewBox=\"0 0 360 240\" xmlns=\"http://www.w3.org/2000/svg\">...</svg>", "caption": "..."}
  Use a figure only when a simple diagram genuinely helps (graphs, geometry, processes). Use only svg, g, line, path, circle, ellipse, rect, polygon, polyline and text elements, colours #2b1d11 (ink), #8a6128 (gold) and #9a3324 (red), and label the parts with text.

Question types:
- {"type": "numeric", "prompt": "...", "answer": 7, "tolerance": 0.01, "unit": "km/s", "hint": "...", "explain": "..."}
- {"type": "choice", "prompt": "...", "choices": ["...", "...", "...", "..."], "answer": 2, "hint": "...", "explain": "..."}   (answer is the index of the correct choice; vary its position)
- {"type": "text", "prompt": "Fill in the blank: ...", "accept": ["answer", "accepted variant"], "hint": "...", "explain": "..."}   (only for one- or two-word answers)
- {"type": "subjective", "prompt": "Explain in your own words ...", "model": "a model answer in 2 to 4 sentences"}

Rules:
- 4 or 5 sections. Each section teaches one idea in 2 to 4 short paragraphs, with a worked example where it helps, then a checkpoint that tests exactly that section.
- The last section is titled "Key takeaways": one list block and an empty checkpoint [].
- Include exactly one subjective question, in the section before "Key takeaways".
- Numeric answers must be exactly computable from the question. Put only the number in "answer" (units go in "unit").
- Teach at the level the course and its range imply. Don't re-teach earlier lessons; set up the next one.
- Follow the learner's teaching instructions (e.g. mnemonics: add mnemonic callouts; "like I'm 5": eli5 callouts and simpler words; LaTeX: write all maths in LaTeX).
- Every piece of maths, everywhere (paragraphs, questions, choices, hints, explanations, recap), goes inside \\( and \\). Never use $ for maths.
- Plain, warm, precise English. Be factually correct; leave out anything you are unsure of.
- This is JSON: every backslash in LaTeX must be written twice, for example "\\frac{1}{2}" and "\\(x\\)".`;

const lineFor = (l) => `${l.n}. [${l.unit}] ${l.title}${l.desc ? ` — ${l.desc}` : ''}`;

function outlineUser({ topic, from, to, instructions }) {
  return [
    `Topic: ${topic}`,
    `Range: from ${from || 'the very beginning'} up to ${to || 'the end of the subject'}`,
    `Teaching instructions from the learner: ${instructions || 'none'}`
  ].join('\n');
}

function lessonUser({ topic, from, to, instructions, courseTitle, outline, n }) {
  const me = outline.find((l) => l.n === n);
  return [
    `Course: "${courseTitle}", on ${topic}.`,
    `Range: from ${from || 'the very beginning'} up to ${to || 'the end of the subject'}.`,
    `Teaching instructions from the learner: ${instructions || 'none'}`,
    '',
    'Full course outline:',
    ...outline.map(lineFor),
    '',
    `Write lesson ${n}: "${me.title}"${me.desc ? ` — ${me.desc}` : ''}`
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* JSON parsing and repair                                             */
/* ------------------------------------------------------------------ */

// Models often write LaTeX with single backslashes inside JSON strings.
// "\(" is invalid JSON, and "\frac", "\theta", "\beta", "\right", "\nu"
// silently turn into control characters. This undoes both.
function fixString(s, key) {
  let out = s
    .replace(/\x0c/g, '\\f')
    .replace(/\x08/g, '\\b')
    .replace(/\t(?=[A-Za-z])/g, '\\t')
    .replace(/\r(?=[A-Za-z])/g, '\\r');
  if (key === 'tex') out = out.replace(/\n(?=[A-Za-z])/g, '\\n');
  else if (/\\\(|\\\[|\$\$|\\[a-zA-Z]{2,}/.test(out)) {
    out = out.replace(/\n(?=(?:eq|e\b|e\s|abla|u\b|u\s|ot\b|otin|ewline|leq|geq|mid|exists|i\b|parallel|subseteq|subset|cdot))/g, '\\n');
  }
  return out;
}

function fixControls(value, key) {
  if (typeof value === 'string') return fixString(value, key);
  if (Array.isArray(value)) return value.map((v) => fixControls(v, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fixControls(v, k);
    return out;
  }
  return value;
}

export function parseJSON(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object in the reply');
  s = s.slice(a, b + 1);
  try {
    return fixControls(JSON.parse(s));
  } catch {
    const repaired = s
      .replace(/\\(?:(["\\/bfnrt])|u([0-9a-fA-F]{4}))?/g, (m, e, u) => (e || u ? m : '\\\\'))
      .replace(/,\s*([}\]])/g, '$1');
    return fixControls(JSON.parse(repaired));
  }
}

/* ------------------------------------------------------------------ */
/* Shape checks: anything malformed is fixed up or rejected            */
/* ------------------------------------------------------------------ */

const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');

// Models sometimes write maths without the \( \) markers the page needs, or with single $...$.
// Add the markers so KaTeX renders it instead of showing raw LaTeX.
function mathify(s) {
  if (!s) return s;
  let out = s.replace(/\$(?!\s)([^$\n]{1,200}?)(?<!\s)\$/g, (m, inner) => (/[\\^_=]|^[A-Za-z]$/.test(inner) ? `\\(${inner}\\)` : m));
  if (!/\\[a-zA-Z]{2,}/.test(out) || /\\\(|\\\[|\$\$/.test(out)) return out;
  const words = out.replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}^_]/g, ' ').match(/[A-Za-z]{3,}/g) || [];
  if (!words.length) return `\\(${out}\\)`;
  return out.replace(/\\[a-zA-Z]+(?:\s*\{(?:[^{}]|\{[^{}]*\})*\})*(?:\s*[\^_]\s*(?:\{[^{}]*\}|\w))*/g, (m) => `\\(${m}\\)`);
}
const mstr = (v, max) => mathify(str(v, max));
const arr = (v) => (Array.isArray(v) ? v : []);
const TAGS = new Set(['maths', 'diagram', 'practice', 'written']);
export const OUTLINE_MIN = 5;
export const OUTLINE_MAX = 150;

export function normalizeOutline(raw) {
  const units = arr(raw && raw.units)
    .map((u) => ({
      title: str(u && u.title, 80) || 'Unit',
      lessons: arr(u && u.lessons)
        .map((l) => ({
          title: str(l && l.title, 100),
          desc: str(l && (l.desc || l.description), 240),
          tags: arr(l && l.tags).map((t) => str(t, 20).toLowerCase()).filter((t) => TAGS.has(t)),
          minutes: Math.min(25, Math.max(8, Math.round(Number(l && l.minutes) || 15)))
        }))
        .filter((l) => l.title)
    }))
    .filter((u) => u.lessons.length);

  // A course is as long as its range needs. The floor and ceiling only catch broken or runaway replies.
  let total = units.reduce((n, u) => n + u.lessons.length, 0);
  if (total < OUTLINE_MIN) throw new Error(`only ${total} lessons`);
  while (total > OUTLINE_MAX) {
    const longest = units.reduce((a, b) => (b.lessons.length > a.lessons.length ? b : a));
    longest.lessons.splice(-2, 1);
    total--;
  }
  return { title: str(raw.title, 80), units };
}

// Models tend to put the right answer in the same slot every time. Shuffle (repeatably, seeded by
// the question) unless an option like "All of the above" depends on the order.
function shuffleChoices(choices, answer, seed) {
  if (choices.some((c) => /\b(all|none|both|neither) of (the )?(above|these)\b/i.test(c))) return { choices, answer };
  const bytes = createHash('sha256').update(seed).digest();
  const order = choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { choices: order.map((i) => choices[i]), answer: order.indexOf(answer) };
}

function normQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  const type = str(q.type, 20).toLowerCase();
  const base = { prompt: mstr(q.prompt, 1200), hint: mstr(q.hint, 600), explain: mstr(q.explain || q.explanation, 1200) };
  if (!base.prompt) return null;
  if (type === 'numeric' || type === 'number') {
    const answer = typeof q.answer === 'number' ? q.answer : parseFloat(String(q.answer).replace(/[^0-9eE+\-.]/g, ''));
    if (!Number.isFinite(answer)) return null;
    const tol = Number(q.tolerance);
    return { type: 'numeric', ...base, answer, tolerance: Number.isFinite(tol) && tol >= 0 ? tol : Math.max(0.01, Math.abs(answer) * 0.01), unit: str(q.unit, 30) };
  }
  if (type === 'choice' || type === 'mcq' || type === 'multiple_choice') {
    const choices = arr(q.choices).map((c) => mstr(c, 400)).filter(Boolean).slice(0, 6);
    if (choices.length < 2) return null;
    let answer = q.answer;
    if (typeof answer === 'string') {
      const letter = answer.trim().match(/^[A-Fa-f]$/);
      if (letter) answer = letter[0].toUpperCase().charCodeAt(0) - 65;
      else if (/^\d+$/.test(answer.trim())) answer = Number(answer);
      else answer = choices.findIndex((c) => c.toLowerCase() === answer.trim().toLowerCase());
    }
    if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) return null;
    return { type: 'choice', ...base, ...shuffleChoices(choices, answer, base.prompt) };
  }
  if (type === 'text' || type === 'short' || type === 'fill') {
    const accept = arr(q.accept).map((a) => str(a, 80)).filter(Boolean).slice(0, 8);
    if (!accept.length) return null;
    return { type: 'text', ...base, accept };
  }
  if (type === 'subjective' || type === 'written' || type === 'open') {
    return { type: 'subjective', prompt: base.prompt, model: mstr(q.model || q.model_answer, 1500) || null };
  }
  return null;
}

function normBlock(b) {
  if (!b || typeof b !== 'object') return null;
  const t = str(b.t || b.type, 20).toLowerCase();
  if (t === 'p' || t === 'paragraph') { const html = mstr(b.html || b.text, 4000); return html ? { t: 'p', html } : null; }
  if (t === 'h' || t === 'heading') { const text = str(b.text, 120); return text ? { t: 'h', text } : null; }
  if (t === 'math') { const tex = str(b.tex, 1000).replace(/^\$\$|\$\$$/g, '').replace(/^\\\[|\\\]$/g, '').trim(); return tex ? { t: 'math', tex } : null; }
  if (t === 'list') { const items = arr(b.items).map((i) => mstr(i, 800)).filter(Boolean).slice(0, 12); return items.length ? { t: 'list', items } : null; }
  if (t === 'callout') {
    const html = mstr(b.html || b.text, 3000);
    if (!html) return null;
    const kind = ['example', 'mnemonic', 'eli5', 'note'].includes(str(b.kind, 20)) ? str(b.kind, 20) : 'note';
    return { t: 'callout', kind, title: str(b.title, 80), html };
  }
  if (t === 'figure') {
    const svg = str(b.svg, 16000);
    return /^<svg[\s>]/i.test(svg) && /<\/svg>\s*$/i.test(svg) ? { t: 'figure', svg, caption: str(b.caption, 400) } : null;
  }
  return null;
}

export function normalizeLesson(raw, lessonTitle = 'this lesson') {
  const sections = arr(raw && raw.sections).slice(0, 7).map((s, i) => ({
    id: `s${i + 1}`,
    title: str(s && s.title, 90) || `Part ${i + 1}`,
    blocks: arr(s && s.blocks).map(normBlock).filter(Boolean),
    recap: arr(s && s.recap).map((r) => mstr(r, 400)).filter(Boolean).slice(0, 5),
    checkpoint: arr(s && s.checkpoint).map(normQuestion).filter(Boolean).slice(0, 3)
  })).filter((s) => s.blocks.length || s.checkpoint.length);

  if (sections.length < 3) throw new Error(`only ${sections.length} usable sections`);
  if (!sections.some((s) => s.checkpoint.length)) throw new Error('no usable questions');
  // every lesson asks for at least one answer in the learner's own words
  if (!sections.some((s) => s.checkpoint.some((x) => x.type === 'subjective'))) {
    const target = [...sections].reverse().find((s) => s.checkpoint.length) || sections[sections.length - 2];
    target.checkpoint.push({ type: 'subjective', prompt: `In two or three sentences, explain the main idea of “${lessonTitle}” in your own words.`, model: null });
  }
  let q = 0;
  sections.forEach((s) => s.checkpoint.forEach((x) => { x.id = `q${++q}`; }));
  return { sections };
}

/* ------------------------------------------------------------------ */
/* OpenRouter                                                          */
/* ------------------------------------------------------------------ */

const short = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 160);

// Every free model on OpenRouter can "think" before answering, which is slow and can use up the
// whole answer budget. The public catalog says which models let us switch thinking off.
let catalog = null;
let catalogAt = 0;
async function reasoningFor(model) {
  if (model === 'openrouter/free') return undefined;
  if (!catalog || Date.now() - catalogAt > 6 * 3600 * 1000) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      const data = await res.json();
      catalog = new Map((data.data || []).map((m) => [m.id, m.reasoning || null]));
      catalogAt = Date.now();
    } catch {
      catalog = catalog || new Map();
    }
  }
  const info = catalog.get(model);
  if (!info) return { effort: 'none' };
  if (!info.mandatory) return { effort: 'none' };
  const efforts = info.supported_efforts || [];
  return efforts.length ? { effort: efforts[efforts.length - 1] } : undefined; // lowest it allows
}

async function callModel(model, messages, maxTokens, timeoutMs) {
  const reasoning = await reasoningFor(model);
  const cfg = config();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': cfg.siteUrl,
        'X-Title': cfg.appName
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        ...(reasoning ? { reasoning: { ...reasoning, exclude: true } } : {})
      })
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !data || data.error) {
      const status = !res.ok ? res.status : Number(data && data.error && data.error.code) || 502;
      return { ok: false, status, message: (data && data.error && data.error.message) || text };
    }
    const choice = data.choices && data.choices[0];
    let content = choice && choice.message && choice.message.content;
    if (Array.isArray(content)) content = content.map((p) => p.text || '').join('');
    if (!content) {
      const u = data.usage || {};
      const thought = (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
      return { ok: false, status: 502, message: `empty reply (finish: ${choice && choice.finish_reason}, ${u.completion_tokens || 0} tokens, ${thought} spent thinking)` };
    }
    return { ok: true, content, finish: choice.finish_reason, model: data.model || model };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    return { ok: false, status: timedOut ? 504 : 502, message: timedOut ? 'timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function generate({ system, user, maxTokens, timeoutMs, deadlineMs, validate, label }) {
  const cfg = config();
  if (!cfg.key) throw new AIError('There is no OpenRouter key yet. Add OPENROUTER_API_KEY to .env and restart the server.', 503);
  const failures = [];
  const started = Date.now();
  for (const model of cfg.models) {
    const left = deadlineMs - (Date.now() - started);
    if (left < 15000) { console.log(`[ai] ${label}: out of time, skipping the remaining models`); break; }
    const t0 = Date.now();
    const r = await callModel(model, [{ role: 'system', content: system }, { role: 'user', content: user }], maxTokens, Math.min(timeoutMs, left));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!r.ok) {
      console.log(`[ai] ${label}: ${model} failed (${r.status}) after ${secs}s: ${short(r.message)}`);
      if (r.status === 401) throw new AIError('OpenRouter rejected the key. Check OPENROUTER_API_KEY in .env, then restart the server.', 502);
      if (r.status === 402) throw new AIError('OpenRouter refused the request because your credit balance is below zero. Add any amount of credit at openrouter.ai/settings/credits, then try again.', 502);
      failures.push(r.status);
      continue;
    }
    try {
      const value = validate(parseJSON(r.content));
      console.log(`[ai] ${label}: ${r.model} answered in ${secs}s`);
      return { value, model: r.model };
    } catch (err) {
      console.log(`[ai] ${label}: ${model} gave an unusable reply after ${secs}s (${err.message}${r.finish === 'length' ? ', reply was cut off' : ''})`);
      failures.push('bad');
    }
  }
  if (failures.length && failures.every((f) => f === 429)) {
    throw new AIError('Every free model is busy, or today’s free requests are used up. Try again in a minute, or later today.', 429);
  }
  throw new AIError('None of the free models gave a usable answer this time. Try again in a moment.', 502);
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

const inflight = new Map();
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

const cacheFile = (kind, keyObj) => path.join(CACHE_DIR, `${kind}-${createHash('sha256').update(JSON.stringify(keyObj)).digest('hex').slice(0, 24)}.json`);

async function readCache(kind, keyObj) {
  try { return JSON.parse(await readFile(cacheFile(kind, keyObj), 'utf8')); } catch { return null; }
}

async function writeCache(kind, keyObj, value) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile(kind, keyObj), JSON.stringify(value, null, 1));
}

async function cached(kind, keyObj, produce) {
  const file = cacheFile(kind, keyObj);
  const hit = await readCache(kind, keyObj);
  if (hit) return { ...hit, cached: true };
  if (inflight.has(file)) return inflight.get(file);
  const job = (async () => {
    const out = await produce();
    await writeCache(kind, keyObj, out);
    return out;
  })().finally(() => inflight.delete(file));
  inflight.set(file, job);
  return job;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function generateOutline(input) {
  const key = { v: 3, topic: norm(input.topic), from: norm(input.from), to: norm(input.to), instructions: norm(input.instructions) };
  return cached('outline', key, async () => {
    const { value, model } = await generate({
      system: OUTLINE_SYSTEM,
      user: outlineUser(input),
      maxTokens: 16000,
      timeoutMs: 100000,
      deadlineMs: 210000,
      validate: normalizeOutline,
      label: `outline "${input.topic}"`
    });
    return { outline: value, model };
  });
}

export function generateLesson(input) {
  const me = input.outline.find((l) => l.n === input.n);
  const prev = input.outline.find((l) => l.n === input.n - 1);
  const next = input.outline.find((l) => l.n === input.n + 1);
  const key = {
    v: 2, topic: norm(input.topic), from: norm(input.from), to: norm(input.to), instructions: norm(input.instructions),
    n: input.n, title: norm(me.title), prev: norm(prev && prev.title), next: norm(next && next.title)
  };
  return cached('lesson', key, async () => {
    const { value, model } = await generate({
      system: LESSON_SYSTEM,
      user: lessonUser(input),
      maxTokens: 12000,
      timeoutMs: 110000,
      deadlineMs: 300000,
      validate: (raw) => normalizeLesson(raw, me.title),
      label: `lesson ${input.n} "${me.title}"`
    });
    return { lesson: value, model };
  });
}

/* ------------------------------------------------------------------ */
/* Small calls: folder fit                                             */
/* Short prompts and small budgets; callers treat a failure as "skip". */
/* ------------------------------------------------------------------ */

const FIT_SYSTEM = `You help a learner keep their course folders tidy. You get a folder name and a numbered list of course topics filed in it. For each topic, decide whether a reasonable person would file it in a folder with that name. Be generous: parts, tools, techniques, history and related skills of the folder's subject all fit, and a vague folder name (like "Misc" or "To learn") fits anything. Flag only clear mismatches.
Return ONLY a JSON object (no prose, no code fences) like this:
{"results": [{"i": 1, "fits": true, "reason": ""}, {"i": 2, "fits": false, "reason": "derivatives are a maths topic"}]}
- One entry per topic, with its number as "i" and "fits" as true or false.
- reason: empty when it fits. Otherwise at most 12 plain words saying what the topic is really about, starting in lower case unless it starts with a name.`;

const posInt = (v) => { const n = Math.round(Number(String(v ?? '').replace(/^#/, ''))); return Number.isInteger(n) && n > 0 ? n : null; };
const asBool = (v) => (typeof v === 'boolean' ? v : /^(true|yes)$/i.test(String(v)) ? true : /^(false|no)$/i.test(String(v)) ? false : null);

// Does each topic belong in a folder with this name? Answers are cached per folder name and
// topic, so only pairs never seen before reach the AI, all of them in one request.
// Returns one { ok, reason, model } per topic, or null where the AI gave no answer.
export async function checkFolderFit(folder, topics) {
  const keys = topics.map((t) => ({ v: 1, folder: norm(folder), topic: norm(t) }));
  const out = await Promise.all(keys.map((k) => readCache('fit', k)));
  const uniq = [], slot = new Map();
  topics.forEach((t, i) => {
    if (out[i] || slot.has(keys[i].topic)) return;
    slot.set(keys[i].topic, uniq.length);
    uniq.push(t);
  });
  if (!uniq.length) return out;
  const { value, model } = await generate({
    system: FIT_SYSTEM,
    user: [`Folder: "${folder}"`, 'Topics:', ...uniq.map((t, i) => `${i + 1}. ${t}`)].join('\n'),
    maxTokens: 2000,
    timeoutMs: 45000,
    deadlineMs: 60000,
    validate: (raw) => {
      const res = new Map();
      for (const r of arr(raw && raw.results)) {
        const i = posInt(r && (r.i ?? r.n ?? r.index));
        const fits = asBool(r && (r.fits ?? r.ok ?? r.fit));
        if (!i || i > uniq.length || fits == null) continue;
        res.set(i - 1, { ok: fits, reason: fits ? '' : str(r.reason, 160).replace(/[.\s]+$/, '') });
      }
      if (!res.size) throw new Error('no usable results');
      return res;
    },
    label: `folder fit "${folder}" (${uniq.length} topic${uniq.length === 1 ? '' : 's'})`
  });
  const saves = [];
  topics.forEach((t, i) => {
    if (out[i]) return;
    const r = value.get(slot.get(keys[i].topic));
    if (!r) return;
    out[i] = { ...r, model };
    saves.push(writeCache('fit', keys[i], out[i]));
  });
  await Promise.all(saves);
  return out;
}
