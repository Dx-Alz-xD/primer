// =====================================================================
// Course files: "one download, the whole village learns".
//
// A learner turns a course into one file (name.primer) and passes it on
// however they like: WhatsApp, Bluetooth, a USB cable. On another device
// "Open a course file" adds it to that learner's account, with its
// written lessons, photos (and their credits) and the Primer-made
// narration that was already recorded, so it opens with no AI, no
// Wikimedia and no ElevenLabs credit spent. Lessons not written yet
// travel as titles and are written when first opened, as usual.
//
// The format is in assets/js/packfmt.js, which reads and checks a file
// the same way here, in the page and in the service worker (a file
// opened with no internet is kept on the device and arrives here when
// the connection is back: assets/js/sw-packs.js).
//
//   GET  /api/courses/:id/pack/info         what a file would hold, and its size
//   GET  /api/courses/:id/pack?narration=1  the file itself
//   POST /api/packs[?id=<id>]               open one: the file as the body.
//                                           id: the id the device gave it offline
//
// Imported photos and recordings are kept under the SHA-256 of their own
// bytes (data/media, data/audio), never under the names Primer gives the
// files it fetched itself, so a file can't swap a photo or a narration
// in anyone else's lessons. Its narration is found through pack_audio,
// for that course only (voice.mjs and videos.mjs ask through hooks).
// Nothing personal travels: no progress, notes, doubts or names.
// =====================================================================
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, stat, mkdir, unlink } from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';
import fmt from '../assets/js/packfmt.js';
import { normWidgetBlock, normTask } from './widgets.mjs';
import { q, tx, schema, now, parseJSON, DATA_DIR } from './db.mjs';
import { HttpError, sendJSON, readRaw, overLimit } from './http.mjs';
import { requireUser } from './auth.mjs';
import { ownCourse, cleanMeta, flatten, saveLesson, loadCourse, newId } from './data.mjs';
import { screen, REFUSED } from './safety.mjs';
import { voiceFor, sectionScript, audioName as listenName, voiceHooks } from './voice.mjs';
import { videoScript, storedNarration, narrationHooks } from './videos.mjs';

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const MEDIA_SRC = /^\/media\/([a-f0-9]{32})\.(jpg|png|webp|gif)$/;
const AUDIO_URL = /^\/audio\/([0-9a-f]{32})\.mp3$/;
const PACK_SRC = /^media\/([a-f0-9]{32})\.(jpg|png|webp|gif)$/;
const ID_OK = /^[a-z0-9]{8,40}$/;
const TYPES = new Set(['application/octet-stream', 'application/zip', 'application/x-zip-compressed', 'application/x-primer', 'application/vnd.primer+zip']);

schema('packs-1', `
  CREATE TABLE pack_audio (
    course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,            -- watch (Watch mode) | listen (Listen)
    script     TEXT NOT NULL,            -- SHA-256 of the narration script the recording reads
    file       TEXT NOT NULL,            -- <sha>.mp3 in data/audio
    words      TEXT,                     -- Watch mode's word timings (JSON)
    PRIMARY KEY (course_id, kind, script)
  );
`);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const exists = (file) => stat(file).then((s) => (s.isFile() && s.size > 0 ? s.size : 0), () => 0);
const io = {
  inflate: async (bytes, size) => zlib.inflateRawSync(bytes, { maxOutputLength: Math.max(1, size) }),
  sha256: async (bytes) => sha(bytes)
};

/* ---------------- narration that came with a course file ---------------- */

function packAudio(courseId, kind, script) {
  const r = q('SELECT file, words FROM pack_audio WHERE course_id = ? AND kind = ? AND script = ?').get(courseId, kind, sha(script));
  return r ? { file: r.file, url: '/audio/' + r.file, words: parseJSON(r.words, null) } : null;
}
voiceHooks.packAudio = async (courseId, kind, script) => {
  const r = packAudio(courseId, kind, script);
  return r && await exists(path.join(AUDIO_DIR, r.file)) ? { url: r.url } : null;
};
narrationHooks.stored = async (courseId, script) => {
  const r = packAudio(courseId, 'watch', script);
  return r && await exists(path.join(AUDIO_DIR, r.file)) ? { url: r.url, words: r.words } : null;
};

/* ---------------- what a course file holds ---------------- */

const blocksOf = (l) => (l && Array.isArray(l.sections) ? l.sections.flatMap((s) => (s && Array.isArray(s.blocks) ? s.blocks : [])) : []);

// The course's written lessons, the photos they show and the narration already recorded, with sizes.
async function contents(row) {
  const meta = parseJSON(row.data, {});
  const flat = flatten(meta.units || []);
  const lang = meta.lang || 'en';
  const lessons = q('SELECT n, data FROM lessons WHERE course_id = ? ORDER BY n').all(row.id)
    .filter((r) => r.n >= 1 && r.n <= flat.length)
    .map((r) => ({ n: r.n, lesson: parseJSON(r.data, null), bytes: r.data.length }))
    .filter((l) => l.lesson && Array.isArray(l.lesson.sections));
  const photos = new Map(); // '/media/x.jpg' -> { file, size }
  const want = (src) => { if (typeof src === 'string' && MEDIA_SRC.test(src)) photos.set(src, null); };
  lessons.forEach((l) => blocksOf(l.lesson).forEach((b) => { if (b && b.t === 'photo') want(b.src); }));
  if (meta.cover) want(meta.cover.src);
  for (const src of Array.from(photos.keys())) {
    const file = path.join(MEDIA_DIR, src.slice(7));
    const size = await exists(file);
    if (size) photos.set(src, { file, size }); else photos.delete(src);
  }
  const audio = []; // { n, i, kind, file, size, words, script, segments }
  const v = voiceFor(lang);
  for (const l of lessons) {
    for (const [i, s] of l.lesson.sections.entries()) {
      if (!s || !Array.isArray(s.blocks)) continue;
      const watch = videoScript(s);
      if (watch.script) {
        const have = await storedNarration(watch.script, row.id);
        const m = have && AUDIO_URL.exec(have.url);
        const file = m && path.join(AUDIO_DIR, m[1] + '.mp3');
        const size = file ? await exists(file) : 0;
        if (size) audio.push({ n: l.n, i, kind: 'watch', file, size, words: have.words || null, script: watch.script, segments: watch.segments });
      }
      const script = sectionScript(s, lang);
      if (script) {
        const own = packAudio(row.id, 'listen', script);
        const file = path.join(AUDIO_DIR, own ? own.file : listenName(script, v));
        const size = await exists(file);
        if (size) audio.push({ n: l.n, i, kind: 'listen', file, size });
      }
    }
  }
  return { meta, flat, lessons, photos, audio };
}

function sizes(c) {
  const json = c.lessons.reduce((a, l) => a + l.bytes, 0) * 0.3 + 4000;
  const photoBytes = Array.from(c.photos.values()).reduce((a, p) => a + p.size, 0);
  const files = new Map(c.audio.map((a) => [a.file, a.size]));
  const audioBytes = Array.from(files.values()).reduce((a, s) => a + s, 0);
  return { photoBytes, audioBytes, without: Math.round(json + photoBytes), with: Math.round(json + photoBytes + audioBytes) };
}

async function info({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const c = await contents(row);
  const s = sizes(c);
  sendJSON(res, 200, {
    ok: true,
    lessons: c.lessons.length, outline: c.flat.length, sample: c.meta.source === 'sample',
    photos: c.photos.size, narrated: new Set(c.audio.map((a) => `${a.n}:${a.i}`)).size, // parts, whether for Watch or Listen
    photoBytes: s.photoBytes, audioBytes: s.audioBytes, size: s.with, sizeWithout: s.without,
    limit: fmt.LIMITS.file, warn: fmt.LIMITS.warn
  });
}

/* ---------------- writing one ---------------- */

function dosTime(d) {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), day: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

// A ZIP archive: JSON and text deflated, photos and MP3s (already compressed) stored as they are.
function zip(entries) {
  const { time, day } = dosTime(new Date());
  const parts = [], dir = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = zlib.crc32(e.data);
    let body = e.data, method = 0;
    if (e.deflate) {
      const d = zlib.deflateRawSync(e.data, { level: 9 });
      if (d.length < e.data.length) { body = d; method = 8; }
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method ? 20 : 10, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(method ? 20 : 10, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(day, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    dir.push(cen, name);
    offset += 30 + name.length + body.length;
  }
  const dirSize = dir.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return parts.concat(dir, [end]);
}

const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function readme(meta, lessons, credits, narrated) {
  const lines = [
    `This is a Primer course file: "${meta.title || meta.topic}".`,
    '',
    'To open it, start Primer, go to Your courses and choose "Open a course file".',
    `It holds the course outline, ${lessons} written lesson${lessons === 1 ? '' : 's'}, ${credits.length} photo${credits.length === 1 ? '' : 's'} and ${narrated} narration recording${narrated === 1 ? '' : 's'}.`,
    'Nothing personal is in it: no progress, notes, doubts or names.'
  ];
  if (credits.length) {
    lines.push('', 'Photo credits (all freely licensed, from Wikimedia Commons)');
    credits.forEach((c) => lines.push(`- ${c.what || 'Photo'}: ${[c.author, c.license, c.licenseUrl, c.source].filter(Boolean).join(', ')}`));
  }
  return lines.join('\r\n') + '\r\n';
}

async function build(row, { narration }) {
  const c = await contents(row);
  const { meta } = c;
  const entries = [];
  const files = [];
  const add = (name, data, deflate) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    entries.push({ name, data: buf, deflate });
    files.push({ path: name, size: buf.length, sha256: sha(buf) });
  };

  // photos, named after their own bytes
  const photoName = new Map(); // '/media/x.jpg' -> 'media/<sha>.jpg'
  for (const [src, p] of c.photos) {
    const buf = await readFile(p.file).catch(() => null);
    const ext = buf && fmt.sniffImage(buf);
    if (!ext || buf.length > fmt.LIMITS.photo) continue;
    const name = `media/${sha(buf).slice(0, 32)}.${ext}`;
    photoName.set(src, name);
    if (!files.some((f) => f.path === name)) add(name, buf, false);
  }
  const credits = [];
  const fixPhoto = (b, where) => {
    if (typeof b.src !== 'string') return b; // still being looked up: the other server tries again
    const to = photoName.get(b.src);
    if (!to) return null;
    if (!credits.some((x) => x.src === to)) credits.push({ src: to, what: plain(b.alt || b.caption || where).slice(0, 120), ...(b.credit || {}) });
    return { ...b, src: to };
  };

  // narration recordings
  const audioName = new Map(); // file on disk -> 'audio/<sha>.mp3'
  if (narration) {
    for (const a of c.audio) {
      if (audioName.has(a.file)) continue;
      const buf = await readFile(a.file).catch(() => null);
      if (!buf || buf.length > fmt.LIMITS.audio || !fmt.isMp3(buf)) continue;
      const name = `audio/${sha(buf).slice(0, 32)}.mp3`;
      audioName.set(a.file, name);
      if (!files.some((f) => f.path === name)) add(name, buf, false);
    }
  }

  // the course
  const course = {
    topic: meta.topic, title: meta.title, from: meta.from || '', to: meta.to || '', instructions: meta.instructions || '',
    style: meta.style || [], source: meta.source === 'library' ? 'ai' : meta.source, lang: meta.lang || 'en', units: meta.units
  };
  if (meta.syllabus) course.syllabus = meta.syllabus;
  if (meta.safety) course.safety = meta.safety;
  if (meta.cover && meta.cover.src) { const cover = fixPhoto(meta.cover, meta.topic); if (cover) course.cover = cover; }
  add('course.json', JSON.stringify(course), true);

  // the lessons, and their narration
  const flat = c.flat;
  for (const { n, lesson } of c.lessons) {
    const L = structuredClone(lesson);
    L.sections.forEach((s) => {
      if (Array.isArray(s.blocks)) s.blocks = s.blocks.map((b) => (b && b.t === 'photo' ? fixPhoto(b, flat[n - 1] && flat[n - 1].title) : b)).filter(Boolean);
    });
    delete L.model;
    add(`lessons/${n}.json`, JSON.stringify(L), true);
    const parts = new Map();
    for (const a of c.audio) {
      if (a.n !== n || !audioName.has(a.file)) continue;
      const p = parts.get(a.i) || { i: a.i };
      if (a.kind === 'watch') {
        p.watch = {
          file: audioName.get(a.file), script: a.script, words: a.words,
          segments: a.segments.map((g) => (g.src ? { ...g, src: photoName.get(g.src) } : g)).map((g) => { if (!g.src) delete g.src; return g; })
        };
      } else p.listen = { file: audioName.get(a.file) };
      parts.set(a.i, p);
    }
    if (parts.size) add(`narration/${n}.json`, JSON.stringify({ sections: Array.from(parts.values()) }), true);
  }
  add('README.txt', readme(meta, c.lessons.length, credits, audioName.size), true);

  const checksum = sha(Buffer.from(files.map(fmt.listLine).join('\n'), 'utf8'));
  const manifest = {
    format: fmt.FORMAT, version: fmt.VERSION, app: 'Primer',
    title: meta.title || meta.topic, lang: meta.lang || 'en',
    lessons: c.lessons.length, outline: flat.length, photos: photoName.size, narration: audioName.size,
    made: new Date().toISOString(), files, checksum
  };
  const parts = zip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf8'), deflate: true }, ...entries]);
  return { parts, size: parts.reduce((a, b) => a + b.length, 0), title: manifest.title };
}

const asciiName = (title) => String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'course';
const fileName = (title) => String(title || 'course').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'course';

async function exportPack({ req, res, params, url }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  if (overLimit('pack-out:' + u.id, 30, 3600_000)) throw new HttpError('You’ve made a lot of course files this hour. Try again a little later.', 429);
  const narration = url.searchParams.get('narration') !== '0';
  const out = await build(row, { narration });
  if (out.size > fmt.LIMITS.file) {
    throw new HttpError(narration ? 'This course is too large for one file with its narration. Leave the narration out and try again.' : 'This course is too large for one file.', 413);
  }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': out.size,
    'Content-Disposition': `attachment; filename="${asciiName(out.title)}.primer"; filename*=UTF-8''${encodeURIComponent(fileName(out.title) + '.primer')}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  if (req.method === 'HEAD') return res.end();
  for (const p of out.parts) {
    if (!res.write(p)) await new Promise((r) => res.once('drain', r));
  }
  res.end();
}

/* ---------------- opening one ---------------- */

async function keep(dir, name, buf) {
  const file = path.join(dir, name);
  if (await exists(file)) return; // the same bytes are already here
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${name}.${randomBytes(4).toString('hex')}`);
  await writeFile(tmp, buf);
  await rename(tmp, file).catch(async (err) => { await unlink(tmp).catch(() => {}); throw err; });
}

// A lesson's words, part by part, for the safety check.
function sectionText(s) {
  const bits = [s.title];
  for (const b of s.blocks || []) bits.push(b.html, b.text, b.tex, b.caption, ...(b.items || []), b.title);
  (s.recap || []).forEach((r) => bits.push(r));
  (s.checkpoint || []).forEach((x) => bits.push(x.prompt, x.hint, x.explain, x.model, ...(x.choices || []), ...(x.accept || [])));
  return plain(bits.filter((x) => typeof x === 'string').join(' . '));
}

const importing = new Set();
let importsNow = 0;

async function importPack({ req, res, url }) {
  const u = requireUser(req);
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!TYPES.has(type)) throw new HttpError('Send the course file as it is.', 415);
  if (importing.has(u.id)) throw new HttpError('A course file is already being opened. Wait for it to finish.', 429);
  if (importsNow >= 3) throw new HttpError('Primer is busy opening other course files. Try again in a minute.', 503);
  if (overLimit('pack-in:' + u.id, 20, 3600_000)) throw new HttpError('You’ve opened a lot of course files this hour. Try again a little later.', 429);
  importing.add(u.id);
  importsNow++;
  try {
    let buf;
    try { buf = await readRaw(req, fmt.LIMITS.file); } catch (err) {
      if (err instanceof HttpError && err.status === 413) throw new HttpError(fmt.MSG.tooLarge, 413);
      throw err;
    }
    let pack;
    try { pack = await fmt.read(buf, io); } catch (err) {
      if (err instanceof fmt.PackError) throw new HttpError(err.message, err.code === 'tooLarge' ? 413 : 400);
      throw err;
    }
    buf = null;

    // the course, as Primer keeps it (cleanMeta checks it again, and keeps only what it knows)
    const raw = { ...pack.course };
    if (raw.source === 'library') raw.source = 'ai';
    const meta = cleanMeta(raw);
    delete meta.library; delete meta.aiError; delete meta.model;
    const s = screen(meta.topic, meta.title, meta.from, meta.to, meta.instructions);
    if (s && s.kind === 'refuse') throw new HttpError(REFUSED, 400);
    if (s && !meta.safety) meta.safety = { kind: s.kind, area: s.area || '' };
    for (const { lesson } of pack.lessons) {
      for (const sec of lesson.sections) {
        const hit = screen(sectionText(sec));
        if (hit && hit.kind === 'refuse') throw new HttpError(REFUSED, 400);
      }
    }
    const outline = flatten(meta.units).length;
    const lessons = pack.lessons.filter((l) => l.n <= outline);
    // interactive parts are held to their kind's own checks, as when the AI writes them (widgets.mjs)
    lessons.forEach(({ lesson }) => lesson.sections.forEach((sec) => {
      sec.blocks = sec.blocks.map((b) => (b && b.t === 'widget' ? normWidgetBlock(b) : b)).filter(Boolean);
      sec.checkpoint = (sec.checkpoint || []).map((x) => {
        if (!x || x.type !== 'task') return x;
        const t = normTask(x, { prompt: x.prompt, hint: x.hint || '', explain: x.explain || '' });
        return t ? { ...t, id: x.id } : null;
      }).filter(Boolean);
    }));

    // photos and recordings, kept under their own hashes
    for (const [name, m] of pack.media) await keep(MEDIA_DIR, name.slice(6), Buffer.from(m.bytes));
    for (const [name, a] of pack.audio) await keep(AUDIO_DIR, name.slice(6), Buffer.from(a));
    const toSite = (src) => (typeof src === 'string' && PACK_SRC.test(src) ? '/' + src : src);
    lessons.forEach(({ lesson }) => lesson.sections.forEach((sec) => sec.blocks.forEach((b) => { if (b.t === 'photo' && b.src) b.src = toSite(b.src); })));
    if (pack.course.cover) meta.cover = { ...pack.course.cover, src: toSite(pack.course.cover.src) };
    meta.pack = { from: 'file', at: now(), made: pack.manifest.made, checksum: pack.manifest.checksum };

    // narration, matched to the scripts this server reads from the lessons as they are stored
    const narr = [];
    for (const { n, sections } of pack.narration) {
      const l = lessons.find((x) => x.n === n);
      if (!l) continue;
      for (const e of sections) {
        const sec = l.lesson.sections[e.i];
        if (!sec) continue;
        if (e.watch) {
          const { script } = videoScript(sec);
          if (script) narr.push({ kind: 'watch', script: sha(script), file: e.watch.file.slice(6), words: e.watch.script === script && e.watch.words ? JSON.stringify(e.watch.words) : null });
        }
        if (e.listen) {
          const script = sectionScript(sec, meta.lang || 'en');
          if (script) narr.push({ kind: 'listen', script: sha(script), file: e.listen.file.slice(6), words: null });
        }
      }
    }

    // the id: the one this device gave it while offline, unless it's taken
    const want = String(url.searchParams.get('id') || '');
    const taken = ID_OK.test(want) ? q('SELECT user_id, data FROM courses WHERE id = ?').get(want) : null;
    if (taken && taken.user_id === u.id && (parseJSON(taken.data, {}).pack || {}).checksum === pack.manifest.checksum) {
      return sendJSON(res, 200, { ok: true, course: loadCourse(u, want), again: true }); // sent twice: it's already here
    }
    const id = ID_OK.test(want) && !taken ? want : newId();
    const t = now();
    tx(() => {
      q('INSERT INTO courses (id, user_id, data, folder_id, created_at, opened_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, u.id, JSON.stringify(meta), null, t, t);
      for (const { n, lesson } of lessons) saveLesson(id, n, lesson, null);
      for (const a of narr) {
        q('INSERT OR REPLACE INTO pack_audio (course_id, kind, script, file, words) VALUES (?, ?, ?, ?, ?)').run(id, a.kind, a.script, a.file, a.words);
      }
    });
    console.log(`[packs] ${u.id} opened a course file: ${lessons.length} lessons, ${pack.media.size} photos, ${pack.audio.size} recordings`);
    sendJSON(res, 201, { ok: true, course: loadCourse(u, id), lessons: lessons.length, photos: pack.media.size, narration: narr.length });
  } finally {
    importing.delete(u.id);
    importsNow--;
  }
}

export const routes = [
  ['GET', /^\/api\/courses\/(?<id>[^/]+)\/pack\/info$/, info],
  ['GET', /^\/api\/courses\/(?<id>[^/]+)\/pack$/, exportPack],
  ['POST', /^\/api\/packs$/, importPack]
];

export const boot = () => ({ packs: { limit: fmt.LIMITS.file, warn: fmt.LIMITS.warn } });
