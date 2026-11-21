// =====================================================================
// Voice, through ElevenLabs (needs ELEVENLABS_API_KEY, or EL_LAB_KEY, in .env).
// - Narration: any part of a lesson read aloud. Maths is turned into
//   words first ("f prime of x equals the limit as h approaches 0...").
// - Sound effects for right answers, wrong answers and newly opened
//   parts, generated once and kept.
// - Spoken doubts: speech to text for the doubt box.
// Every piece of audio is cached in data/audio, so a passage is only
// ever paid for once. Without a key, the endpoints say so and the page
// falls back to quiet built-in tones.
// =====================================================================
import crypto from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, q, parseJSON } from './db.mjs';
import { HttpError, sendJSON, send, readBody, readRaw, text, overLimit } from './http.mjs';
import { requireUser, sessionUser } from './auth.mjs';
import { ownCourse } from './data.mjs';

const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const API = 'https://api.elevenlabs.io/v1';
const key = () => (process.env.ELEVENLABS_API_KEY || '').trim() || (process.env.EL_LAB_KEY || '').trim();
const voiceId = () => (process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb').trim(); // "George": a warm narrator
const MODEL = () => (process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2').trim();

// Which model reads which language (ElevenLabs' /v1/models list). The default, eleven_multilingual_v2,
// reads 29 languages, Hindi, Tamil, Arabic, Spanish, French, Portuguese and Russian among them, and
// keeps the voice it always had. eleven_v3 reads most other Indian languages; of the interface languages
// only Odia needs eleven_v4. Bhojpuri, Maithili, Sanskrit and Konkani are written in Devanagari and are
// read as Hindi.
const V2_LANGS = new Set('en ja zh de hi fr ko pt it es id nl tr fil pl sv bg ro ar cs el fi hr ms sk da ta uk ru'.split(' '));
const V3_LANGS = new Set('bn mr te gu kn ml pa ur as ne fa he sw th vi'.split(' '));
const AS_HINDI = new Set(['bho', 'mai', 'sa', 'kok']);
export function voiceFor(lang) {
  if (!lang || lang === 'en' || V2_LANGS.has(lang)) return { model: MODEL(), code: null }; // as before
  if (AS_HINDI.has(lang)) return { model: MODEL(), code: 'hi' };
  if (V3_LANGS.has(lang)) return { model: 'eleven_v3', code: lang };
  if (lang === 'or') return { model: 'eleven_v4', code: 'or' };
  return { model: MODEL(), code: null }; // no model lists it (Sinhala): the default does its best
}

/* ---------------- maths into words ---------------- */

const CMD = {
  to: ' approaches ', rightarrow: ' gives ', cdot: ' times ', times: ' times ', div: ' divided by ', pm: ' plus or minus ',
  le: ' is at most ', leq: ' is at most ', ge: ' is at least ', geq: ' is at least ', neq: ' is not equal to ', approx: ' is about ',
  infty: ' infinity ', pi: ' pi ', theta: ' theta ', alpha: ' alpha ', beta: ' beta ', gamma: ' gamma ', delta: ' delta ', Delta: ' change in ',
  lambda: ' lambda ', mu: ' mu ', sigma: ' sigma ', omega: ' omega ', phi: ' phi ', epsilon: ' epsilon ',
  sin: ' sine ', cos: ' cosine ', tan: ' tangent ', ln: ' the natural log of ', log: ' log ', exp: ' e to the ',
  int: ' the integral of ', sum: ' the sum of ', prod: ' the product of ', partial: ' partial ', nabla: ' del ',
  in: ' in ', cup: ' union ', cap: ' intersection ', subset: ' is a subset of ', forall: ' for all ', exists: ' there exists ',
  left: '', right: '', displaystyle: '', quad: ' ', qquad: ' ', mathrm: '', text: '', mathbf: '', operatorname: ''
};

// Finds the {...} group starting at s[i] (s[i] === '{'); returns [inner, endIndex].
function group(s, i) {
  if (s[i] !== '{') { const m = /^\\[a-zA-Z]+|^./.exec(s.slice(i)); return [m ? m[0] : '', i + (m ? m[0].length : 1)]; }
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

export function speakTex(tex) {
  let s = String(tex);
  let out = '';
  for (let i = 0; i < s.length;) {
    const rest = s.slice(i);
    let m;
    if ((m = /^\\d?frac/.exec(rest))) {
      const [a, j] = group(s, i + m[0].length);
      const [b, k] = group(s, j);
      out += ` ${speakTex(a)} over ${speakTex(b)} `;
      i = k;
    } else if ((m = /^\\sqrt/.exec(rest))) {
      const [a, j] = group(s, i + m[0].length);
      out += ` the square root of ${speakTex(a)} `;
      i = j;
    } else if ((m = /^\\lim(?:its)?\s*_/.exec(rest))) {
      const [a, j] = group(s, i + m[0].length);
      out += ` the limit as ${speakTex(a)} of `;
      i = j;
    } else if (rest[0] === '^') {
      const [a, j] = group(s, i + 1);
      const p = a.trim();
      out += p === '2' ? ' squared ' : p === '3' ? ' cubed ' : p === "\\prime" || p === "'" ? ' prime ' : ` to the power ${speakTex(a)} `;
      i = j;
    } else if (rest[0] === '_') {
      const [a, j] = group(s, i + 1);
      out += ` sub ${speakTex(a)} `;
      i = j;
    } else if ((m = /^\\([a-zA-Z]+)/.exec(rest))) {
      out += CMD[m[1]] != null ? CMD[m[1]] : ` ${m[1]} `;
      i += m[0].length;
    } else if (rest.startsWith("'")) {
      out += ' prime ';
      i++;
    } else {
      const c = rest[0];
      out += c === '=' ? ' equals ' : c === '+' ? ' plus ' : c === '-' ? ' minus ' : c === '<' ? ' is less than ' : c === '>' ? ' is greater than '
        : c === '(' ? ' of ' : c === '{' || c === '}' || c === ')' || c === '\\' ? ' ' : c === '/' ? ' over ' : c;
      i++;
    }
  }
  return out.replace(/\s+/g, ' ').replace(/ of of /g, ' of ').trim();
}

const strip = (html) => String(html || '')
  .replace(/<\/(p|li|h\d)>/gi, '. ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function speakHTML(html) {
  return strip(html)
    .replace(/\\\((.+?)\\\)/g, (m, t) => speakTex(t))
    .replace(/\\\[(.+?)\\\]/g, (m, t) => speakTex(t))
    .replace(/\s+([.,;:!?])/g, '$1').replace(/\.\s*\./g, '.').replace(/\s+/g, ' ').trim();
}

function sectionScript(section, lang) {
  const en = !lang || lang === 'en';
  const parts = [section.title + '.'];
  for (const b of section.blocks || []) {
    if (b.t === 'p') parts.push(speakHTML(b.html));
    else if (b.t === 'math') parts.push(speakTex(b.tex) + '.');
    else if (b.t === 'list') parts.push(b.items.map(speakHTML).join('. ') + '.');
    else if (b.t === 'callout') parts.push(`${b.title ? b.title + '. ' : ''}${speakHTML(b.html)}`);
    else if (b.t === 'figure' && b.caption) parts.push(en ? `The figure shows: ${speakHTML(b.caption)}` : speakHTML(b.caption));
  }
  if (en && (section.checkpoint || []).length) parts.push('Now try the checkpoint below.');
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 4500);
}

/* ---------------- ElevenLabs calls, cached on disk ---------------- */

async function cachedAudio(name, make) {
  const file = path.join(AUDIO_DIR, name);
  try { await stat(file); return name; } catch { /* not made yet */ }
  const buf = await make();
  await mkdir(AUDIO_DIR, { recursive: true });
  await writeFile(file, buf);
  return name;
}

async function eleven(urlPath, init) {
  const res = await fetch(API + urlPath, { ...init, headers: { 'xi-api-key': key(), ...(init.headers || {}) } });
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = (j.detail && (j.detail.message || j.detail.status || JSON.stringify(j.detail))) || ''; } catch { /* not JSON */ }
    console.log(`[voice] ElevenLabs ${urlPath.split('?')[0]} failed (${res.status}) ${String(msg).slice(0, 160)}`);
    if (res.status === 401) throw new HttpError('ElevenLabs rejected the key. Check ELEVENLABS_API_KEY in .env, then restart Primer.', 502);
    if (res.status === 429) throw new HttpError('ElevenLabs is busy or your character quota is used up. Try again later.', 429);
    throw new HttpError('The voice service couldn’t do that just now. Try again in a moment.', 502);
  }
  return res;
}

const audioName = (script, v) => crypto.createHash('sha256').update(`${voiceId()}|${v.model}${v.code ? '|' + v.code : ''}|${script}`).digest('hex').slice(0, 32) + '.mp3';

function tts(script, lang) {
  const v = voiceFor(lang);
  const name = audioName(script, v);
  return cachedAudio(name, async () => {
    const res = await eleven(`/text-to-speech/${encodeURIComponent(voiceId())}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: script, model_id: v.model, ...(v.code ? { language_code: v.code } : {}), voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15 } })
    });
    return Buffer.from(await res.arrayBuffer());
  });
}

const SFX = {
  correct: { text: 'A single soft, warm wooden chime, gentle and pleasant, in a quiet library. Very short.', seconds: 1.2 },
  wrong: { text: 'A soft, low, muted wooden knock, gentle and not harsh. Very short.', seconds: 0.8 },
  unlock: { text: 'One page of an old paper book turning, a quick crisp rustle.', seconds: 1.0 },
  complete: { text: 'A short, warm harp flourish rising, gentle and celebratory.', seconds: 2.0 }
};

/* ---------------- routes ---------------- */

async function narrate({ req, res }) {
  const u = requireUser(req);
  if (!key()) throw new HttpError('Narration needs an ElevenLabs key. Add ELEVENLABS_API_KEY to .env and restart Primer.', 503);
  const body = await readBody(req, 4_000);
  const row = ownCourse(u, text(body.courseId, 64));
  const n = Number(body.n), si = Number(body.section);
  const lesson = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(row.id, n);
  if (!lesson) throw new HttpError('That lesson hasn’t been written yet.', 404);
  // read the learner's translation when there is one, since that's what the page shows
  let tr = null;
  try { tr = q('SELECT data FROM lesson_translations WHERE course_id = ? AND n = ? AND lang = ?').get(row.id, n, u.lang); } catch { /* no translations yet */ }
  const section = (parseJSON((tr || lesson).data, {}).sections || [])[si];
  if (!section) throw new HttpError('That part of the lesson doesn’t exist.', 404);
  const lang = tr ? u.lang : parseJSON(row.data, {}).lang || 'en'; // the language the page shows it in
  const script = typeof body.script === 'string' && body.script.trim() ? text(body.script, 4500) : sectionScript(section, lang);
  const name = path.join(AUDIO_DIR, '');
  const file = audioName(script, voiceFor(lang));
  let fresh = true;
  try { await stat(path.join(name, file)); fresh = false; } catch { /* needs making */ }
  if (fresh && overLimit('voice:' + u.id, 60, 3600_000)) throw new HttpError('You’ve had a lot read aloud this hour. Try again a little later.', 429);
  const made = await tts(script, lang);
  sendJSON(res, 200, { ok: true, url: '/audio/' + made, chars: script.length });
}

// Built-in lessons of sample courses aren't stored on the server, so the page sends their text.
async function narrateText({ req, res }) {
  const u = requireUser(req);
  if (!key()) throw new HttpError('Narration needs an ElevenLabs key. Add ELEVENLABS_API_KEY to .env and restart Primer.', 503);
  const body = await readBody(req, 12_000);
  const script = text(body.script, 4500);
  if (!script) throw new HttpError('Nothing to read.', 400);
  if (overLimit('voice:' + u.id, 60, 3600_000)) throw new HttpError('You’ve had a lot read aloud this hour. Try again a little later.', 429);
  sendJSON(res, 200, { ok: true, url: '/audio/' + await tts(script), chars: script.length });
}

async function transcribe({ req, res }) {
  const u = requireUser(req);
  if (!key()) throw new HttpError('Speaking a doubt needs an ElevenLabs key in .env.', 503);
  if (overLimit('stt:' + u.id, 40, 3600_000)) throw new HttpError('You’ve recorded a lot this hour. Try again a little later.', 429);
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (!/^audio\/(webm|ogg|mp4|mpeg|wav|x-wav)$/.test(type)) throw new HttpError('That recording format isn’t supported.', 415);
  const audio = await readRaw(req, 4_000_000);
  if (audio.length < 1000) throw new HttpError('That recording was too short. Hold the button and speak.', 400);
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('file', new Blob([audio], { type }), 'doubt.' + type.split('/')[1].replace('x-', ''));
  const r = await eleven('/speech-to-text', { method: 'POST', body: form });
  const j = await r.json();
  const said = text(j.text, 1000);
  if (!said) throw new HttpError('I couldn’t make out any words. Try again a little closer to the microphone.', 422);
  sendJSON(res, 200, { ok: true, text: said, language: j.language_code || null });
}

async function serveAudio({ req, res, params }) {
  if (!sessionUser(req)) return send(res, 401, 'Sign in to listen.');
  try {
    const data = await readFile(path.join(AUDIO_DIR, params.name));
    send(res, 200, req.method === 'HEAD' ? undefined : data, 'audio/mpeg', { 'Cache-Control': 'private, max-age=31536000, immutable' });
  } catch {
    send(res, 404, 'Not found');
  }
}

async function serveSfx({ req, res, params }) {
  const fx = SFX[params.name];
  if (!fx || !sessionUser(req)) return send(res, 404, 'Not found');
  const name = `sfx-${params.name}.mp3`;
  try { await stat(path.join(AUDIO_DIR, name)); } catch {
    if (!key()) return send(res, 404, 'Not found');
    try {
      await cachedAudio(name, async () => {
        const r = await eleven('/sound-generation', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({ text: fx.text, duration_seconds: fx.seconds, prompt_influence: 0.6 })
        });
        return Buffer.from(await r.arrayBuffer());
      });
    } catch { return send(res, 404, 'Not found'); }
  }
  return serveAudio({ req, res, params: { name } });
}

export const routes = [
  ['POST', /^\/api\/voice$/, narrate],
  ['POST', /^\/api\/voice\/text$/, narrateText],
  ['POST', /^\/api\/voice\/transcribe$/, transcribe],
  ['GET', /^\/audio\/sfx\/(?<name>[a-z]+)\.mp3$/, serveSfx, 'raw'],
  ['GET', /^\/audio\/(?<name>[0-9a-f]{32}\.mp3)$/, serveAudio, 'raw']
];

export const boot = () => ({ voice: Boolean(key()) });
