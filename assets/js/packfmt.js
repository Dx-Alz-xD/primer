/* =====================================================================
   The Primer course file (name.primer): one course in one file, to pass
   from phone to phone over WhatsApp, Bluetooth or a USB cable.

   It is a ZIP archive:
     manifest.json        format, version, title, language, counts, and
                          the size and SHA-256 of every other file, with
                          one checksum over that list
     README.txt           what the file is, and the photo credits
     course.json          the outline and the course's settings
     lessons/<n>.json     each written lesson, as Primer stores it; a
                          photo's src is media/<file>
     narration/<n>.json   Primer-made narration of a lesson's parts
                          (Watch mode, with word timings, and Listen)
     media/<sha>.<ext>    photos (JPEG, PNG, WebP, GIF), with their
                          credits kept in the lessons that show them
     audio/<sha>.mp3      narration recordings
   A photo or recording is named after the SHA-256 of its own bytes, so a
   file can't claim to be another one.

   This one file reads and checks a course file, the same way, in three
   places: the server (server/packs.mjs, which writes them too), the page
   (assets/js/packs.js, to show what's inside before importing) and the
   service worker (assets/js/sw-packs.js, to open one with no internet).
   Everything is checked: the archive's structure (no encryption, no
   ZIP64, no overlapping or hidden entries, sizes and CRCs), the names
   (only the files above), each file's size, the manifest's list and
   checksums, photos and recordings by their magic bytes, and the shape
   of every JSON file (unknown fields and blocks are dropped). Checksums
   catch a damaged transfer; the checks catch a file that was tampered
   with. Lessons are still cleaned again every time they are shown.

   PrimerPackFormat.read(bytes, { inflate, sha256 }) -> the course file
     inflate(bytes, size) -> Promise<Uint8Array>   raw DEFLATE, exactly size bytes
     sha256(bytes)        -> Promise<hex string>
   Throws PrimerPackFormat.PackError with a sentence for the learner.
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerPackFormat = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MB = 1024 * 1024;
  const FORMAT = 'primer-course';
  const VERSION = 1;
  const LIMITS = {
    file: 64 * MB,        // the whole course file
    total: 96 * MB,       // everything in it, unpacked
    entries: 1500,
    lessons: 400,
    photo: 2 * MB,        // one photo (the server keeps none larger)
    audio: 8 * MB,        // one narration recording (about 8 minutes)
    warn: 20 * MB         // a file this large is worth a warning on a phone
  };

  // Every name a course file may hold: [pattern, kind, largest size].
  const NAMES = [
    [/^manifest\.json$/, 'manifest', 300000],
    [/^README\.txt$/, 'readme', 60000],
    [/^course\.json$/, 'course', 600000],
    [/^lessons\/([1-9][0-9]{0,3})\.json$/, 'lesson', 400000],
    [/^narration\/([1-9][0-9]{0,3})\.json$/, 'narration', 900000],
    [/^media\/([a-f0-9]{32})\.(jpg|png|webp|gif)$/, 'media', LIMITS.photo],
    [/^audio\/([a-f0-9]{32})\.mp3$/, 'audio', LIMITS.audio]
  ];

  // What the learner is told. The page translates them (they are interface text).
  const MSG = {
    notPack: 'This isn’t a Primer course file.',
    damaged: 'This course file is damaged or incomplete. Ask for it to be sent again.',
    changed: 'This course file was changed after it was made, so Primer won’t open it. Ask for the original file.',
    tooLarge: 'This course file is too large to open (the limit is 64 MB).',
    newer: 'This course file was made by a newer version of Primer. Update Primer to open it.',
    badPhoto: 'A photo in this course file isn’t a real image, so Primer won’t open it.',
    badAudio: 'A narration recording in this course file isn’t real audio, so Primer won’t open it.',
    badCourse: 'The course in this file can’t be read.',
    badLesson: 'A lesson in this course file can’t be read.',
    noDeflate: 'This browser can’t unpack this course file. Update the browser, or open the file while you’re online.'
  };

  class PackError extends Error {
    constructor(code) { super(MSG[code] || MSG.damaged); this.code = code; this.name = 'PackError'; }
  }
  const fail = (code) => { throw new PackError(code); };

  /* ---------------- small helpers ---------------- */

  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const arr = (v) => (Array.isArray(v) ? v : []);
  // one line of text, trimmed; control characters and anything that isn't a string go
  const CTRL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(8) + String.fromCharCode(11, 12) + String.fromCharCode(14) + '-' + String.fromCharCode(31, 127) + ']', 'g');
  const str = (v, max) => (typeof v === 'string' ? v.replace(CTRL, ' ').trim().slice(0, max) : '');
  const line = (v, max) => str(v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);
  const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
  const LINK = /^https:\/\/(?:commons\.wikimedia\.org|[a-z-]+\.wikipedia\.org|creativecommons\.org|www\.gnu\.org|artlibre\.org)\/[^\s"<>]*$/;
  const link = (v) => { const s = str(v, 400); return LINK.test(s) ? s : ''; };

  let table = null;
  function crc32(bytes) {
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const utf8 = (bytes) => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return null; }
  };
  function json(bytes, code) {
    const s = utf8(bytes);
    if (s == null) fail(code);
    try { return JSON.parse(s); } catch (e) { return fail(code); }
  }

  // What the first bytes say a photo is.
  function sniffImage(b) {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'gif';
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return null;
  }
  // An MP3: an ID3 tag, or an MPEG audio frame (sync bits, layer III, a real bitrate and sample rate).
  function isMp3(b) {
    if (b.length < 1000) return false;
    let i = 0;
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
      const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
      i = 10 + size;
      while (i < b.length && i < 10 + size + 4096 && b[i] === 0) i++; // padding after the tag
      if (i + 4 > b.length) return false;
    }
    return b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0 && ((b[i + 1] >> 1) & 3) === 1 && (b[i + 2] >> 4) !== 15 && (b[i + 2] >> 4) !== 0 && ((b[i + 2] >> 2) & 3) !== 3;
  }
  const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

  /* ---------------- the ZIP archive ---------------- */

  function entriesOf(bytes) {
    const len = bytes.length;
    if (len < 22) fail('notPack');
    if (len > LIMITS.file) fail('tooLarge');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== 0x04034b50) fail('notPack');
    let eocd = -1;
    for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) fail('damaged');
    if (dv.getUint16(eocd + 4, true) !== 0 || dv.getUint16(eocd + 6, true) !== 0) fail('damaged'); // split archives
    const count = dv.getUint16(eocd + 10, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    const cdOff = dv.getUint32(eocd + 16, true);
    if (count !== dv.getUint16(eocd + 8, true) || count === 0xffff || cdOff === 0xffffffff) fail('damaged'); // ZIP64 isn't used
    if (count > LIMITS.entries) fail('tooLarge');
    if (cdOff + cdSize > eocd) fail('damaged');
    const out = [];
    let p = cdOff;
    for (let k = 0; k < count; k++) {
      if (p + 46 > cdOff + cdSize || dv.getUint32(p, true) !== 0x02014b50) fail('damaged');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      if (flags & 0x41) fail('damaged');                // encrypted
      if (method !== 0 && method !== 8) fail('damaged'); // stored or deflated only
      if (method === 0 && csize !== usize) fail('damaged');
      const nameBytes = bytes.subarray(p + 46, p + 46 + nlen);
      const name = utf8(nameBytes);
      if (name == null || !nlen) fail('damaged');
      p += 46 + nlen + xlen + clen;
      if (p > cdOff + cdSize) fail('damaged');
      if (lho + 30 > cdOff || dv.getUint32(lho, true) !== 0x04034b50) fail('damaged');
      const lnlen = dv.getUint16(lho + 26, true);
      const lxlen = dv.getUint16(lho + 28, true);
      if (lnlen !== nlen) fail('damaged');
      for (let i = 0; i < nlen; i++) if (bytes[lho + 30 + i] !== nameBytes[i]) fail('damaged');
      const start = lho + 30 + lnlen + lxlen;
      if (start + csize > cdOff) fail('damaged');
      out.push({ name, method, crc, csize, usize, start, header: lho });
    }
    // entries can't overlap (a "zip bomb" reuses the same bytes many times)
    const byStart = out.slice().sort((a, b) => a.header - b.header);
    for (let i = 1; i < byStart.length; i++) {
      if (byStart[i].header < byStart[i - 1].start + byStart[i - 1].csize) fail('damaged');
    }
    return out;
  }

  function kindOf(name) {
    for (const [re, kind, max] of NAMES) {
      const m = re.exec(name);
      if (m) return { kind, max, m };
    }
    return null;
  }

  /* ---------------- the JSON files' shapes ---------------- */

  const BLOCK_KINDS = new Set(['example', 'mnemonic', 'eli5', 'note']);
  const TAGS = new Set(['maths', 'diagram', 'practice', 'written']);
  const SAFETY = new Set(['harm', 'hate', 'selfharm']);

  function cleanCredit(c) {
    const o = isObj(c) ? c : {};
    return { author: line(o.author, 120), license: line(o.license, 40), licenseUrl: link(o.licenseUrl), source: link(o.source) };
  }
  // A found photo points at a photo in this file; one that was still being looked up keeps its query.
  function cleanPhoto(b, media) {
    if (typeof b.src === 'string') {
      const src = str(b.src, 80);
      if (!media.has(src)) return null;
      const w = int(b.width, 16, 10000), h = int(b.height, 16, 10000);
      return {
        t: 'photo', src, width: w && h ? w : 0, height: w && h ? h : 0,
        caption: str(b.caption, 600), alt: line(b.alt, 200), credit: cleanCredit(b.credit)
      };
    }
    const query = line(b.query, 120).replace(/[[\]{}|<>#_]+/g, ' ').trim();
    return query.length >= 2 ? { t: 'photo', query, caption: str(b.caption, 300) } : null;
  }

  function cleanBlock(b, media) {
    if (!isObj(b)) return null;
    const t = str(b.t, 12);
    if (t === 'p') { const html = str(b.html, 6000); return html ? { t, html } : null; }
    if (t === 'h') { const text = line(b.text, 160); return text ? { t, text } : null; }
    if (t === 'math') { const tex = str(b.tex, 1500); return tex ? { t, tex } : null; }
    if (t === 'list') { const items = arr(b.items).map((i) => str(i, 1200)).filter(Boolean).slice(0, 16); return items.length ? { t, items } : null; }
    if (t === 'callout') {
      const html = str(b.html, 4000);
      return html ? { t, kind: BLOCK_KINDS.has(b.kind) ? b.kind : 'note', title: line(b.title, 120), html } : null;
    }
    if (t === 'figure') {
      const svg = str(b.svg, 24000);
      return /^<svg[\s>]/i.test(svg) && /<\/svg>$/i.test(svg) ? { t, svg, caption: str(b.caption, 600) } : null;
    }
    if (t === 'photo') return cleanPhoto(b, media);
    if (t === 'widget') { // an interactive part: plain data, checked again by its kind where it is drawn
      const kind = str(b.kind, 20), spec = plainData(b.spec, 20000);
      return WIDGET_KINDS.has(kind) && spec ? { t, kind, spec, caption: str(b.caption, 600) } : null;
    }
    return null; // a kind of block this version doesn't know
  }

  // the interactive parts this version knows (assets/js/widgets.js, server/widgets.mjs)
  const WIDGET_KINDS = new Set(['chess', 'circuit', 'graph', 'music', 'arrange']);
  // a JSON object of plain data (no functions, nothing cyclic), no bigger than max characters
  function plainData(v, max) {
    if (!isObj(v)) return null;
    try { const s = JSON.stringify(v); return s.length <= max ? JSON.parse(s) : null; } catch (e) { return null; }
  }

  function cleanQuestion(x) {
    if (!isObj(x)) return null;
    const base = { prompt: str(x.prompt, 1600), hint: str(x.hint, 800), explain: str(x.explain, 1600) };
    if (!base.prompt) return null;
    const id = /^q[0-9]{1,3}$/.test(String(x.id || '')) ? x.id : null;
    if (x.type === 'choice') {
      const choices = arr(x.choices).map((c) => str(c, 600)).filter(Boolean).slice(0, 6);
      const answer = int(x.answer, 0, choices.length - 1);
      return choices.length >= 2 && answer != null ? { id, type: 'choice', ...base, choices, answer } : null;
    }
    if (x.type === 'numeric') {
      const answer = Number(x.answer), tol = Number(x.tolerance);
      if (typeof x.answer !== 'number' || !Number.isFinite(answer)) return null;
      return { id, type: 'numeric', ...base, answer, tolerance: Number.isFinite(tol) && tol >= 0 ? tol : Math.max(0.01, Math.abs(answer) * 0.01), unit: line(x.unit, 30) };
    }
    if (x.type === 'text') {
      const accept = arr(x.accept).map((a) => line(a, 120)).filter(Boolean).slice(0, 10);
      return accept.length ? { id, type: 'text', ...base, accept } : null;
    }
    if (x.type === 'subjective') return { id, type: 'subjective', prompt: base.prompt, model: str(x.model, 2000) || null };
    if (x.type === 'task') { // done in an interactive part: what is set up, and what counts as right
      const kind = str(x.kind, 20), spec = plainData(x.spec, 20000), goal = plainData(x.goal, 6000);
      return WIDGET_KINDS.has(kind) && spec && goal ? { id, type: 'task', kind, ...base, spec, goal } : null;
    }
    return null;
  }

  function cleanLesson(raw, media) {
    if (!isObj(raw) || !Array.isArray(raw.sections) || !raw.sections.length || raw.sections.length > 12) fail('badLesson');
    const sections = raw.sections.map((s, i) => {
      if (!isObj(s) || !Array.isArray(s.blocks)) fail('badLesson');
      return {
        id: /^s[0-9]{1,2}$/.test(String(s.id || '')) ? s.id : `s${i + 1}`,
        title: line(s.title, 120) || `Part ${i + 1}`,
        blocks: s.blocks.slice(0, 80).map((b) => cleanBlock(b, media)).filter(Boolean),
        recap: arr(s.recap).map((r) => str(r, 600)).filter(Boolean).slice(0, 6),
        checkpoint: arr(s.checkpoint).map(cleanQuestion).filter(Boolean).slice(0, 4)
      };
    });
    // question ids are how progress is kept: every one present, and each used once
    const ids = sections.flatMap((s) => s.checkpoint.map((x) => x.id));
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      let k = 0;
      sections.forEach((s) => s.checkpoint.forEach((x) => { x.id = `q${++k}`; }));
    }
    const out = { sections };
    if (['ai', 'guess', 'none', 'skip'].includes(raw.photoCheck)) out.photoCheck = raw.photoCheck;
    return out;
  }

  function cleanCourse(raw, media) {
    if (!isObj(raw) || !Array.isArray(raw.units)) fail('badCourse');
    let total = 0;
    const units = raw.units.slice(0, 80).map((u) => {
      if (!isObj(u)) return null;
      const lessons = arr(u.lessons).map((l) => {
        if (!isObj(l) || total >= LIMITS.lessons) return null;
        const title = line(l.title, 140);
        if (!title) return null;
        total++;
        return {
          title, desc: line(l.desc, 300), tags: arr(l.tags).filter((t) => TAGS.has(t)).slice(0, 4),
          minutes: int(l.minutes, 1, 600) || 15, contentId: typeof l.contentId === 'string' ? line(l.contentId, 40) : null
        };
      }).filter(Boolean);
      return lessons.length ? { title: line(u.title, 100) || 'Unit', lessons } : null;
    }).filter(Boolean);
    if (!total) fail('badCourse');
    const c = {
      topic: line(raw.topic, 120), title: line(raw.title, 120), from: line(raw.from, 80), to: line(raw.to, 80),
      instructions: line(raw.instructions, 600),
      style: arr(raw.style).slice(0, 8).filter(isObj).map((s) => ({ key: line(s.key, 20), label: line(s.label, 40) })).filter((s) => s.key),
      source: ['ai', 'sample', 'library'].includes(raw.source) ? raw.source : 'ai',
      lang: /^[a-z]{2,3}$/.test(String(raw.lang || '')) ? raw.lang : 'en',
      units
    };
    if (!c.title && !c.topic) fail('badCourse');
    const syllabus = str(raw.syllabus, 4000);
    if (syllabus) c.syllabus = syllabus;
    if (isObj(raw.safety) && SAFETY.has(raw.safety.kind)) c.safety = { kind: raw.safety.kind, area: line(raw.safety.area, 30) };
    if (isObj(raw.cover)) {
      const cover = cleanPhoto({ ...raw.cover }, media);
      if (cover && cover.src) c.cover = { src: cover.src, width: cover.width, height: cover.height, alt: cover.alt, credit: cover.credit };
    }
    return c;
  }

  const SEG_KINDS = new Set(['title', 'text', 'math', 'figure', 'photo']);
  function cleanWords(w, scriptLen) {
    const out = [];
    for (const x of arr(w).slice(0, 6000)) {
      if (!Array.isArray(x) || x.length !== 4) return null;
      const [o, l, s, e] = x.map((v) => int(v, 0, 36e6));
      if (o == null || l == null || s == null || e == null || o + l > scriptLen || e < s) return null;
      out.push([o, l, s, e]);
    }
    return out.length ? out : null;
  }
  // narration/<n>.json: { sections: [{ i, watch?: { file, script, segments, words }, listen?: { file } }] }
  function cleanNarration(raw, lesson, audio) {
    if (!isObj(raw) || !Array.isArray(raw.sections)) fail('badLesson');
    const out = [];
    const seen = new Set();
    for (const s of raw.sections.slice(0, 12)) {
      if (!isObj(s)) continue;
      const i = int(s.i, 0, 11);
      if (i == null || i >= lesson.sections.length || seen.has(i)) continue;
      seen.add(i);
      const entry = { i };
      if (isObj(s.watch) && audio.has(str(s.watch.file, 60))) {
        const script = str(s.watch.script, 6000);
        if (script) {
          const segments = arr(s.watch.segments).slice(0, 200).filter(isObj).map((g) => {
            const kind = SEG_KINDS.has(g.kind) ? g.kind : 'text';
            const o = { text: str(g.text, 2000), kind, o: int(g.o, 0, script.length) || 0 };
            if (typeof g.src === 'string' && /^media\/[a-f0-9]{32}\.(?:jpg|png|webp|gif)$/.test(g.src)) o.src = g.src;
            if (kind === 'math' && typeof g.tex === 'string') o.tex = str(g.tex, 1000);
            if (kind === 'figure') o.fig = int(g.fig, 0, 80) || 0;
            return o;
          }).filter((g) => g.text);
          entry.watch = { file: s.watch.file, script, segments, words: cleanWords(s.watch.words, script.length) };
        }
      }
      if (isObj(s.listen) && audio.has(str(s.listen.file, 60))) entry.listen = { file: s.listen.file };
      if (entry.watch || entry.listen) out.push(entry);
    }
    return out;
  }

  const listLine = (f) => `${f.path}:${f.size}:${f.sha256}`;

  /* ---------------- reading a whole course file ---------------- */

  async function read(bytes, io) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const entries = entriesOf(bytes);
    const byName = new Map();
    let total = 0;
    for (const e of entries) {
      if (byName.has(e.name)) fail('damaged'); // the same name twice
      const k = kindOf(e.name);
      if (!k) fail(byName.size ? 'changed' : 'notPack'); // only the files a course file can hold
      if (e.usize > k.max) fail('changed'); // Primer never writes one this large
      total += e.usize;
      if (total > LIMITS.total) fail('tooLarge');
      byName.set(e.name, Object.assign(e, { kind: k.kind, m: k.m }));
    }
    const data = async (e) => {
      const raw = bytes.subarray(e.start, e.start + e.csize);
      let out;
      if (e.method === 0) out = raw;
      else {
        try { out = await io.inflate(raw, e.usize); } catch (err) { if (err instanceof PackError) throw err; fail('damaged'); }
      }
      if (!out || out.length !== e.usize || crc32(out) !== e.crc) fail('damaged');
      return out;
    };

    // the manifest: what should be here
    const me = byName.get('manifest.json');
    if (!me) fail('notPack');
    const man = json(await data(me), 'notPack');
    if (!isObj(man) || man.format !== FORMAT) fail('notPack');
    if (!Number.isInteger(man.version) || man.version < 1) fail('notPack');
    if (man.version > VERSION) fail('newer');
    const files = arr(man.files);
    if (files.length !== byName.size - 1 || files.length > LIMITS.entries) fail('changed');
    const listed = new Map();
    for (const f of files) {
      if (!isObj(f) || typeof f.path !== 'string' || !/^[a-f0-9]{64}$/.test(String(f.sha256)) || !Number.isInteger(f.size)) fail('changed');
      if (f.path === 'manifest.json' || listed.has(f.path) || !byName.has(f.path)) fail('changed');
      if (byName.get(f.path).usize !== f.size) fail('changed');
      listed.set(f.path, f);
    }
    const sum = await io.sha256(new TextEncoder().encode(files.map(listLine).join('\n')));
    if (sum !== man.checksum) fail('changed');

    // every file, checked against the manifest
    const contents = new Map();
    for (const [name, e] of byName) {
      if (name === 'manifest.json') continue;
      const buf = await data(e);
      if ((await io.sha256(buf)) !== listed.get(name).sha256) fail('changed');
      contents.set(name, buf);
    }
    const media = new Map(), audio = new Map();
    for (const [name, e] of byName) {
      if (e.kind === 'media') {
        const buf = contents.get(name);
        if (sniffImage(buf) !== e.m[2]) fail('badPhoto');
        if ((await io.sha256(buf)).slice(0, 32) !== e.m[1]) fail('changed');
        media.set(name, { bytes: buf, type: MIME[e.m[2]] });
      } else if (e.kind === 'audio') {
        const buf = contents.get(name);
        if (!isMp3(buf)) fail('badAudio');
        if ((await io.sha256(buf)).slice(0, 32) !== e.m[1]) fail('changed');
        audio.set(name, buf);
      }
    }

    const course = cleanCourse(json(contents.get('course.json') || fail('notPack'), 'badCourse'), media);
    const outline = course.units.reduce((n, u) => n + u.lessons.length, 0);
    const lessons = [];
    const narration = [];
    for (const [name, e] of byName) {
      if (e.kind !== 'lesson') continue;
      const n = Number(e.m[1]);
      if (n > outline) fail('changed');
      lessons.push({ n, lesson: cleanLesson(json(contents.get(name), 'badLesson'), media) });
    }
    lessons.sort((a, b) => a.n - b.n);
    for (const [name, e] of byName) {
      if (e.kind !== 'narration') continue;
      const n = Number(e.m[1]);
      const l = lessons.find((x) => x.n === n);
      if (!l) fail('changed');
      const sections = cleanNarration(json(contents.get(name), 'badLesson'), l.lesson, audio);
      if (sections.length) narration.push({ n, sections });
    }
    if (Number(man.lessons) !== lessons.length) fail('changed');

    // only the photos and recordings something uses are kept
    const used = new Set();
    lessons.forEach(({ lesson }) => lesson.sections.forEach((s) => s.blocks.forEach((b) => { if (b.t === 'photo' && b.src) used.add(b.src); })));
    if (course.cover) used.add(course.cover.src);
    narration.forEach((x) => x.sections.forEach((s) => {
      if (s.watch) { used.add(s.watch.file); s.watch.segments.forEach((g) => { if (g.src) used.add(g.src); }); }
      if (s.listen) used.add(s.listen.file);
    }));
    for (const k of Array.from(media.keys())) if (!used.has(k)) media.delete(k);
    for (const k of Array.from(audio.keys())) if (!used.has(k)) audio.delete(k);

    return {
      manifest: {
        version: man.version, title: course.title || course.topic, lang: course.lang,
        made: typeof man.made === 'string' && !Number.isNaN(Date.parse(man.made)) ? new Date(man.made).toISOString() : null,
        checksum: sum
      },
      course, lessons, narration, media, audio, size: bytes.length, outline
    };
  }

  return { FORMAT, VERSION, LIMITS, MSG, PackError, read, crc32, sniffImage, isMp3, listLine, MIME };
});
