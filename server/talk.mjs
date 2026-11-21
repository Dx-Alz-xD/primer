// =====================================================================
// Talk: a spoken conversation with the tutor (assets/js/talk.js).
//
//   POST /api/talk?course=&lesson=   the learner's recording as the body.
//     The answer is a stream of lines (NDJSON), each sent as soon as
//     its step is done, so the page shows what was heard while the tutor
//     thinks:
//       {"type":"heard","text":…}                 ElevenLabs speech to text
//       {"type":"reply","reply":{…},"say":…,"speak":{id,parts},"lang":…,"helpline"?}
//       {"type":"error","error":…}
//   POST /api/talk/text {message, courseId, lesson}   the same, typed (JSON)
//   POST /api/talk/speak {id, part}   one part of a reply read aloud: the MP3
//     ElevenLabs streams, passed straight through. The first part is
//     short and asked for as soon as the reply is written, so the voice
//     starts quickly; the page fetches the next part while one plays.
//
// The tutor is the same one as the text conversation: the same memory
// (wrong answers, doubts, courses, the lesson open) and the same
// messages (tutor_messages), so both are one conversation. Only those
// words are kept. The recording and the spoken reply never touch the
// disk: audio goes from ElevenLabs to the learner and is gone, and a
// reply can be read aloud only by the learner it was written for, for
// ten minutes.
//
// Without ElevenLabs for speaking (no key, out of credit, busy) the
// page reads the reply with the browser's own voice. Someone who may be
// struggling always gets an answer, spoken too, with the helpline shown.
// =====================================================================
import { randomBytes } from 'node:crypto';
import { q, now, parseJSON } from './db.mjs';
import { HttpError, sendJSON, readBody, readRaw, text, longText, overLimit } from './http.mjs';
import { requireUser } from './auth.mjs';
import { askJSON, config } from './ai.mjs';
import { ownCourse, flatten } from './data.mjs';
import { screen, courseSafety, promptNote, REFUSED } from './safety.mjs';
import { memory, courseLine, validateReply, lessonText, support } from './tutor.mjs';
import { speakHTML } from './voice.mjs';
import { LANG_NAMES } from './langs.mjs';

const API = 'https://api.elevenlabs.io/v1';
const key = () => (process.env.ELEVENLABS_API_KEY || '').trim() || (process.env.EL_LAB_KEY || '').trim();
const voiceId = () => (process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb').trim(); // the narrator voice.mjs uses
const sttModel = () => (process.env.ELEVENLABS_STT_MODEL || 'scribe_v2').trim();
const AUDIO_TYPE = /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav)$/;
const HELPLINE = { name: 'Tele-MANAS', number: '14416', note: 'Free, at any time, in India.', more: 'https://findahelpline.com' };

/* ---------------- ElevenLabs ---------------- */

class VoiceDown extends Error {}
async function detail(r) {
  try { const j = await r.json(); const d = j && j.detail; return String((d && (d.status || d.message)) || (typeof d === 'string' ? d : '') || '').slice(0, 160); } catch { return ''; }
}
const quota = (status, why) => status === 402 || /quota|credit|limit_reached/i.test(why);

// What the learner heard said, in their language (or worked out from the recording).
// A code ElevenLabs doesn't take, or a model it no longer has, is tried again without.
async function hear(audio, type, lang) {
  const code = ['bho', 'mai', 'sa', 'kok'].includes(lang) ? 'hi' : lang;
  const tries = [[sttModel(), code], [sttModel(), null], ['scribe_v1', code], ['scribe_v1', null]]
    .filter(([m, c], i, all) => all.findIndex(([m2, c2]) => m2 === m && c2 === c) === i);
  for (const [model, lc] of tries) {
    const form = new FormData();
    form.append('model_id', model);
    if (lc && lc !== 'en') form.append('language_code', lc);
    form.append('tag_audio_events', 'false');
    form.append('file', new Blob([audio], { type }), 'talk.' + type.split('/')[1].replace('x-', ''));
    let r;
    try {
      r = await fetch(API + '/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key() }, body: form, signal: AbortSignal.timeout(30000) });
    } catch {
      throw new HttpError('The voice service couldn’t be reached. Try again in a moment.', 502);
    }
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      return longText(String(j.text || '').replace(/\((?:silence|music|noise|background noise)\)/gi, ' '), 1500);
    }
    const why = await detail(r);
    console.log(`[talk] speech to text with ${model}${lc ? ' (' + lc + ')' : ''} failed (${r.status}) ${why}`);
    if ([400, 404, 422].includes(r.status) && !quota(r.status, why)) continue;
    if (quota(r.status, why)) throw new HttpError('Primer’s voice credit is used up for now, so it can’t hear you. Type your question instead.', 429);
    if (r.status === 429) throw new HttpError('The voice service is busy. Try again in a moment.', 429);
    throw new HttpError('The voice service couldn’t hear that just now. Try again in a moment.', 502);
  }
  throw new HttpError('The voice service couldn’t hear that just now. Try again in a moment.', 502);
}

// The quickest voice for the language: Flash v2.5 reads these; v4 Turbo the other Indian languages.
const FLASH = new Set('en ja zh de hi fr ko pt it es id nl tr fil pl sv bg ro ar cs el fi hr ms sk da ta uk ru hu no vi'.split(' '));
const V3 = new Set('bn mr te gu kn ml pa ur as ne fa he sw th'.split(' '));
function voices(lang) {
  const l = ['bho', 'mai', 'sa', 'kok'].includes(lang) ? 'hi' : lang || 'en';
  if (l === 'en') return [{ model: 'eleven_flash_v2_5', code: null }, { model: 'eleven_multilingual_v2', code: null }];
  if (FLASH.has(l)) return [{ model: 'eleven_flash_v2_5', code: l }, { model: 'eleven_multilingual_v2', code: null }];
  return [{ model: 'eleven_v4_turbo', code: l }, ...(V3.has(l) ? [{ model: 'eleven_v3', code: l }] : []), { model: 'eleven_v4', code: l }];
}
const skipModel = new Map(); // a model ElevenLabs refused: skipped for an hour

async function synth(part, lang) {
  let last = 'failed';
  for (const v of voices(lang)) {
    if ((skipModel.get(v.model) || 0) > Date.now()) continue;
    let r;
    try {
      r = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId())}/stream?output_format=mp3_44100_64`, {
        method: 'POST',
        headers: { 'xi-api-key': key(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: part, model_id: v.model, ...(v.code ? { language_code: v.code } : {}), voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.1 } }),
        signal: AbortSignal.timeout(40000)
      });
    } catch {
      throw new VoiceDown('busy');
    }
    if (r.ok) return r;
    const why = await detail(r);
    console.log(`[talk] ElevenLabs ${v.model} failed (${r.status}) ${why}`);
    if (quota(r.status, why)) throw new VoiceDown('quota');
    if (r.status === 429) throw new VoiceDown('busy');
    if (r.status === 401) throw new VoiceDown('key');
    if ([400, 404, 422].includes(r.status)) { skipModel.set(v.model, Date.now() + 3600_000); last = 'failed'; continue; }
    throw new VoiceDown('failed');
  }
  throw new VoiceDown(last);
}

const BROWSER = {
  'no-key': 'Primer has no ElevenLabs key, so your device’s voice reads the answers.',
  quota: 'Primer’s voice credit is used up for now, so your device’s voice reads the answers.',
  busy: 'The voice service is busy, so your device’s voice reads this answer.',
  key: 'The voice service turned Primer away, so your device’s voice reads the answers.',
  failed: 'The voice couldn’t be made just now, so your device’s voice reads this answer.'
};

/* ---------------- replies, kept in memory for reading aloud ---------------- */

const speeches = new Map(); // id -> { user, lang, parts, at, first }
const SPEECH_TTL = 600_000;
function dropSpeech(id) {
  const s = speeches.get(id);
  if (s && s.first) s.first.then((r) => { if (r && r.body) r.body.cancel().catch(() => {}); }, () => {});
  speeches.delete(id);
}
setInterval(() => { for (const [id, s] of speeches) if (Date.now() - s.at > SPEECH_TTL) dropSpeech(id); }, 60_000).unref();

function keepSpeech(userId, lang, parts) {
  const mine = Array.from(speeches.entries()).filter(([, s]) => s.user === userId);
  mine.slice(0, Math.max(0, mine.length - 4)).forEach(([id]) => dropSpeech(id)); // only the latest few
  const id = randomBytes(16).toString('hex');
  const s = { user: userId, lang, parts, at: Date.now(), first: null };
  // the first part is asked for now, so its sound is on its way before the page asks
  if (key()) {
    s.first = synth(parts[0], lang).catch((err) => err);
    setTimeout(() => { if (s.first) { const f = s.first; s.first = null; f.then((r) => { if (r && r.body) r.body.cancel().catch(() => {}); }, () => {}); } }, 60_000).unref();
  }
  speeches.set(id, s);
  return id;
}

// The reply as it should sound: plain words, maths read out, the helpline number digit by digit.
function sayable(html) {
  return speakHTML(html)
    .replace(/\b14416\b/g, '1 4 4 1 6')
    .replace(/https?:\/\/(?:www\.)?/gi, '')
    .replace(/[*_#`~]+/g, ' ')
    .replace(/([.!?।؟…]["”’)]?)\s*\.(?=\s|$)/g, '$1') // "make sense?." from the end of a paragraph
    .replace(/\s+/g, ' ').trim().slice(0, 2400);
}

// The first part short, so the voice starts quickly; then parts of a few sentences.
export function chunks(say) {
  const sentences = String(say || '').split(/(?<=[.!?।؟]["”’)]*)\s+/); // "3.14" stays whole
  const out = [];
  let cur = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    cur = cur ? cur + ' ' + s : s;
    if (!out.length ? cur.length >= 30 : cur.length >= 220) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out.slice(0, 10);
}

/* ---------------- the tutor, spoken ---------------- */

const TALK_SYSTEM = (lang) => `You are the tutor inside Primer, a course app, talking out loud with one learner. You know their recent wrong answers and doubts.
Return ONLY a JSON object: {"html": "your reply"}.
How to reply:
- This is a spoken conversation: your reply is read aloud, and the learner answers by speaking.
- Answer what they actually asked, directly, in 1 to 4 short sentences (at most about 70 words). Only if they ask for more, up to about 140 words.
- Sound like a person talking: no lists, headings, tables, code, emojis or links.
- Say maths in words, the way you would read it aloud in ${LANG_NAMES[lang] || 'English'} (for example "x squared plus two x", "the square root of two"). Never write LaTeX, and no symbols like ^, \\ or =.
- You may end with one short question that checks their understanding or keeps the conversation going.
- Allowed HTML: <p>, <strong>, <em>. Nothing else.
- If one of their past mistakes is relevant, name the pattern kindly in one sentence.
- Follow their course's teaching instructions if it has any.
- If you are not sure of something, say so. Never invent facts.
- Safety: keep dangerous subjects at textbook level (the science in general terms, history, safety, law). Never give instructions, recipes, quantities, designs, or ways to obtain or hide anything dangerous. Answer hateful or extremist claims critically, with the evidence.
- If the learner seems to be struggling or mentions hurting themselves, answer kindly first, encourage them to talk to someone they trust, and give India's Tele-MANAS helpline (14416, free, any time) or a local helpline.
- Speak in ${LANG_NAMES[lang] || 'English'}.`;

const msgOut = (m) => ({ id: m.id, role: m.role, content: m.content, courseId: m.course_id, lesson: m.lesson_n, at: m.created_at });

function where(u, courseId, lesson) {
  if (!courseId) return { row: null, meta: null, lessonN: null };
  const row = ownCourse(u, text(String(courseId), 64));
  const n = Number(lesson);
  return { row, meta: parseJSON(row.data, {}), lessonN: Number.isInteger(n) && n > 0 ? n : null };
}

async function answer(u, message, ctx) {
  const lang = u.lang || 'en';
  let s = screen(message);
  if (s && s.kind === 'refuse') {
    const html = `<p>${REFUSED}</p>`;
    return { reply: { role: 'tutor', content: html, at: now() }, ...speakable(u, lang, html), lang, helpline: null, model: 'safety' };
  }
  // someone who may be struggling always gets an answer, even with no AI
  const struggling = Boolean(s && s.kind === 'selfharm');
  if (!config().ai && !struggling) throw new HttpError('The tutor needs an AI key on the server.', 503);
  let here = '';
  if (ctx.row) {
    if (!s) s = courseSafety(ctx.meta);
    if (s && s.kind === 'refuse') throw new HttpError(REFUSED, 400);
    const flat = flatten(ctx.meta.units || []);
    here = `They are looking at the course ${courseLine(ctx.meta)}.` +
      (ctx.lessonN && flat[ctx.lessonN - 1] ? `\nThey are on lesson ${ctx.lessonN}, "${flat[ctx.lessonN - 1].title}". Its text:\n${lessonText(ctx.row.id, ctx.lessonN, null, 3000)}` : '');
  }
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const courses = q('SELECT c.data, (SELECT COUNT(*) FROM progress p WHERE p.course_id = c.id AND p.done = 1) AS done FROM courses c WHERE c.user_id = ? ORDER BY c.opened_at DESC LIMIT 8').all(u.id)
    .map((r) => { const m = parseJSON(r.data, {}); return `- "${m.title}" (${flatten(m.units || []).length} lessons, ${r.done} done)`; });
  const past = q('SELECT role, content FROM (SELECT * FROM tutor_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 10) ORDER BY created_at').all(u.id)
    .map((m) => `${m.role === 'learner' ? 'Learner' : 'Tutor'}: ${m.role === 'tutor' ? strip(m.content) : m.content}`.slice(0, 600));
  const prompt = [
    `The learner is ${u.name}. They are speaking to you; what they said was transcribed by speech recognition, so allow for a misheard word.`,
    courses.length ? `Their courses:\n${courses.join('\n')}` : 'They have no courses yet.',
    here,
    memory(u.id),
    past.length ? `Your conversation so far:\n${past.join('\n')}` : '',
    `What they just said: ${message}`,
    promptNote(s)
  ].filter(Boolean).join('\n\n');

  const courseId = ctx.row ? ctx.row.id : null;
  const mine = q('INSERT INTO tutor_messages (user_id, role, content, course_id, lesson_n, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(u.id, 'learner', message, courseId, ctx.lessonN, now());
  let out;
  try {
    out = await askJSON({ system: TALK_SYSTEM(lang), user: prompt, maxTokens: 1000, timeoutMs: 30000, deadlineMs: 55000, validate: validateReply, label: `talk ${u.id}` });
  } catch (err) {
    if (!struggling) {
      q('DELETE FROM tutor_messages WHERE id = ?').run(Number(mine.lastInsertRowid));
      throw err;
    }
    out = { value: support(lang), model: 'safety' };
  }
  const id = Number(q('INSERT INTO tutor_messages (user_id, role, content, course_id, lesson_n, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(u.id, 'tutor', out.value, courseId, ctx.lessonN, out.model, now()).lastInsertRowid);
  const selfharm = struggling || Boolean(s && s.kind === 'selfharm');
  return {
    reply: msgOut(q('SELECT * FROM tutor_messages WHERE id = ?').get(id)),
    ...speakable(u, lang, out.value), lang, helpline: selfharm ? HELPLINE : null, model: out.model
  };
}

function speakable(u, lang, html) {
  const say = sayable(html);
  const parts = chunks(say);
  return { say, speak: parts.length ? { id: keepSpeech(u.id, lang, parts), parts } : null };
}

/* ---------------- routes ---------------- */

async function talk({ req, res, url }) {
  const u = requireUser(req);
  if (!key()) throw new HttpError('Talking needs ElevenLabs on the server (an ElevenLabs key in .env).', 503);
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!AUDIO_TYPE.test(type)) throw new HttpError('That recording format isn’t supported.', 415);
  if (overLimit('talk:' + u.id, 80, 3600_000)) throw new HttpError('You’ve talked with the tutor a lot this hour. Try again a little later.', 429);
  const ctx = where(u, url.searchParams.get('course'), url.searchParams.get('lesson'));
  const audio = await readRaw(req, 6_000_000);
  if (audio.length < 1000) throw new HttpError('That was too short to hear. Hold the button while you speak, or tap it and talk.', 400);
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  const line = (o) => res.write(JSON.stringify(o) + '\n');
  try {
    const heard = await hear(audio, type, u.lang || 'en');
    if (!heard) {
      line({ type: 'error', code: 'silence', error: 'I couldn’t make out any words. Try again a little closer to the microphone.' });
    } else {
      line({ type: 'heard', text: heard });
      line({ type: 'reply', ...await answer(u, heard, ctx) });
    }
  } catch (err) {
    if (!(err instanceof HttpError)) console.error('[talk]', err);
    line({ type: 'error', error: err instanceof HttpError ? err.message : 'Something went wrong on the server.' });
  }
  res.end();
}

async function talkText({ req, res }) {
  const u = requireUser(req);
  if (overLimit('talk:' + u.id, 80, 3600_000)) throw new HttpError('You’ve talked with the tutor a lot this hour. Try again a little later.', 429);
  const body = await readBody(req, 8_000);
  const message = longText(body.message, 1500);
  if (!message) throw new HttpError('Say or type a question first.', 400);
  const ctx = where(u, body.courseId, body.lesson);
  sendJSON(res, 200, { ok: true, ...await answer(u, message, ctx) });
}

async function speak({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 1_000);
  const s = speeches.get(String(body.id || ''));
  const i = Number(body.part);
  if (!s || s.user !== u.id || !Number.isInteger(i) || !s.parts[i]) throw new HttpError('That answer can’t be read aloud any more.', 404);
  // no voice from ElevenLabs is an ordinary answer (like Watch mode's narration): the device reads it instead
  if (!key()) return sendJSON(res, 200, { ok: true, fallback: 'no-key', error: BROWSER['no-key'] });
  let r;
  try {
    const first = i === 0 ? s.first : null;
    if (i === 0) s.first = null;
    r = first ? await first : await synth(s.parts[i], s.lang);
    if (r instanceof Error) throw r;
  } catch (err) {
    const why = err instanceof VoiceDown ? err.message : 'failed';
    return sendJSON(res, 200, { ok: true, fallback: why, error: BROWSER[why] || BROWSER.failed });
  }
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  const reader = r.body.getReader();
  let gone = false;
  res.on('close', () => { if (!res.writableFinished) { gone = true; reader.cancel().catch(() => {}); } });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || gone) break;
      if (!res.write(value)) await new Promise((ok) => res.once('drain', ok));
    }
  } catch { /* the learner stopped it, or ElevenLabs broke off */ }
  res.end();
}

export const routes = [
  ['POST', /^\/api\/talk$/, talk],
  ['POST', /^\/api\/talk\/text$/, talkText],
  ['POST', /^\/api\/talk\/speak$/, speak]
];

export const boot = () => ({ talk: Boolean(key()) });
