// =====================================================================
// Careful outside requests for a lesson's sources (sources.mjs) and the
// apps it suggests (apps.mjs).
//
// - Nothing about the learner is ever sent: a generic agent, no cookies,
//   no referrer, only search words and the addresses being checked.
// - Addresses an AI proposed are only fetched over https, from public
//   hosts: an IP address, localhost or a name that resolves to a private
//   or reserved address is refused, at every redirect.
// - Every request has a timeout and a size limit; redirects are followed
//   by hand (at most 5) so each hop is checked.
// - checkLink() says whether a link resolves (HTTP 200 or a redirect),
//   and remembers the answer on disk for a while.
// - Images (app icons) are checked by their first bytes; a Windows .ico
//   is turned into a PNG, so every icon is served as a plain picture
//   from this site's /media/, like lesson photos.
// =====================================================================
import { createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { deflateSync, crc32 } from 'node:zlib';
import { mkdir, readFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './db.mjs';

export const UA = 'PrimerCourseApp/1.0 (educational course builder)';
// Some sites refuse an agent that doesn't look like a browser's; this one still says what it is.
export const PAGE_UA = 'Mozilla/5.0 (compatible; PrimerCourseApp/1.0; educational course builder)';
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const MEDIA_DIR = path.join(DATA_DIR, 'media'); // served at /media/<name> by photos.mjs
export const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
export const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
export const oneLine = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/* ---------------- public hosts only ---------------- */

function privateV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}
function privateIP(ip) {
  if (net.isIPv4(ip)) return privateV4(ip);
  const s = ip.toLowerCase();
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) return privateV4(v4[1]);
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith('64:ff9b:') || s.startsWith('2001:db8');
}

const hostOK = new Map(); // host -> { ok, at }
export async function publicHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h || net.isIP(h.replace(/^\[|\]$/g, '')) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) || /(^|\.)(localhost|local|internal|lan|home|corp|test|invalid|example|onion)$/.test(h)) return false;
  const hit = hostOK.get(h);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.ok;
  let ok = false;
  try {
    const addrs = await lookup(h, { all: true, verbatim: true });
    ok = addrs.length > 0 && addrs.every((a) => !privateIP(a.address));
  } catch { ok = false; }
  hostOK.set(h, { ok, at: Date.now() });
  if (hostOK.size > 2000) hostOK.clear();
  return ok;
}

// https only, on the usual port, no user name or password in it.
export function httpsURL(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  u.hash = '';
  return u;
}

/* ---------------- one request, with its redirects checked ---------------- */

class Refused extends Error {}

// -> { status, url (the last one asked), headers, body: Buffer | null, hops } ; throws on network failure
export async function safeFetch(raw, { method = 'GET', ms = 7000, maxBytes = 600_000, headers = {}, hops = 5, follow = true, body = true } = {}) {
  let u = httpsURL(raw);
  if (!u) throw new Refused('not an https address');
  const deadline = Date.now() + ms;
  for (let hop = 0; ; hop++) {
    if (!(await publicHost(u.hostname))) throw new Refused(`${u.hostname} isn’t a public host`);
    const left = deadline - Date.now();
    if (left < 200) throw new Refused('timed out');
    const res = await fetch(u, {
      method, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, signal: AbortSignal.timeout(left)
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      res.body?.cancel().catch(() => {});
      if (!follow) return { status: res.status, url: u.href, headers: res.headers, body: null, hops: hop };
      if (hop >= hops) throw new Refused('too many redirects');
      const next = httpsURL(new URL(res.headers.get('location'), u).href);
      if (!next) throw new Refused('redirected away from https');
      u = next;
      continue;
    }
    if (!body || method === 'HEAD') {
      res.body?.cancel().catch(() => {});
      return { status: res.status, url: u.href, headers: res.headers, body: null, hops: hop };
    }
    if (Number(res.headers.get('content-length')) > maxBytes) {
      res.body?.cancel().catch(() => {});
      return { status: res.status, url: u.href, headers: res.headers, body: null, tooBig: true, hops: hop };
    }
    const chunks = [];
    let size = 0, cut = false;
    if (res.body) {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > maxBytes) { cut = true; break; } // leaving the loop cancels the rest
        chunks.push(chunk);
      }
    }
    return { status: res.status, url: u.href, headers: res.headers, body: Buffer.concat(chunks), cut, hops: hop };
  }
}

/* ---------------- small disk cache ---------------- */

const cacheFile = (kind, key) => path.join(CACHE_DIR, `${kind}-${hash(JSON.stringify(key)).slice(0, 24)}.json`);
export async function readCache(kind, key, ttl) {
  try {
    const v = JSON.parse(await readFile(cacheFile(kind, key), 'utf8'));
    if (ttl && Date.now() - (v.at || 0) > ttl) return null;
    return v;
  } catch { return null; }
}
export async function writeCache(kind, key, value) {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = cacheFile(kind, key);
  const tmp = `${file}.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify({ ...value, at: value.at || Date.now() }));
  await rename(tmp, file).catch(async () => { await unlink(tmp).catch(() => {}); });
}

// One job per key at a time, whoever asks.
const running = new Map();
export function once(key, fn) {
  if (running.has(key)) return running.get(key);
  const job = Promise.resolve().then(fn).finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

/* ---------------- does a link resolve? ---------------- */

const LINK_OK_TTL = 30 * 864e5;
const LINK_BAD_TTL = 864e5;

// A link resolves when it answers 200 or a redirect (followed to a 200 when `follow`).
// Returns { ok, status, url } and keeps the answer for a while. `fetcher` (optional) does the request
// itself (Wikimedia's own limiter, say) and returns { status, url }.
export async function checkLink(url, { follow = true, fetcher = null, method = 'HEAD' } = {}) {
  const key = { v: 1, url, follow };
  const hit = await readCache('link', key);
  if (hit && Date.now() - hit.at < (hit.ok ? LINK_OK_TTL : LINK_BAD_TTL)) return hit;
  return once('link|' + url + '|' + follow, async () => {
    let status = 0, final = url;
    try {
      let r = fetcher ? await fetcher(url) : await safeFetch(url, { method, follow, ms: 8000 });
      // some servers don't answer HEAD properly: ask again with GET, reading a little
      if (!fetcher && method === 'HEAD' && (r.status === 405 || r.status === 501 || r.status === 400)) r = await safeFetch(url, { follow, ms: 8000, maxBytes: 20_000 });
      status = r.status;
      final = r.url || url;
    } catch (err) {
      if (err && err.retryLater) throw err; // the service asked us to wait: nothing is known yet, try again later
      status = 0;
    }
    const ok = (status >= 200 && status < 300) || (status >= 300 && status < 400 && !follow);
    const out = { ok, status, url: final, at: Date.now() };
    if (status) await writeCache('link', key, out).catch(() => {});
    return out;
  });
}

/* ---------------- images ---------------- */

export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (/^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0 && buf.readUInt16LE(4) > 0) return 'ico';
  return null;
}

// Width and height of a PNG, JPEG, GIF or WebP (0 when they can't be read).
export function imageSize(buf, ext) {
  try {
    if (ext === 'png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (ext === 'gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (ext === 'webp') {
      const kind = buf.subarray(12, 16).toString('latin1');
      if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (ext === 'jpg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* unreadable */ }
  return { w: 0, h: 0 };
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// The largest picture in a Windows .ico, as a PNG: either one stored inside it, or its bitmap converted.
export function icoToPNG(buf) {
  const count = buf.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < Math.min(count, 32); i++) {
    const o = 6 + i * 16;
    if (o + 16 > buf.length) break;
    const size = buf.readUInt32LE(o + 8), at = buf.readUInt32LE(o + 12);
    if (!size || at + size > buf.length) continue;
    entries.push({ w: buf[o] || 256, h: buf[o + 1] || 256, bpp: buf.readUInt16LE(o + 6), size, at });
  }
  entries.sort((a, b) => b.w - a.w || b.bpp - a.bpp);
  for (const e of entries) {
    const data = buf.subarray(e.at, e.at + e.size);
    if (sniff(data) === 'png') return { png: Buffer.from(data), w: e.w, h: e.h };
    if (data.length < 40 || data.readUInt32LE(0) < 40) continue;
    const w = data.readInt32LE(4), h2 = data.readInt32LE(8), bpp = data.readUInt16LE(14), compression = data.readUInt32LE(16);
    const h = Math.abs(h2) / 2;
    if (compression !== 0 || w < 1 || w > 256 || h < 1 || h > 256 || ![1, 4, 8, 24, 32].includes(bpp)) continue;
    const head = data.readUInt32LE(0);
    const colors = bpp <= 8 ? (data.readUInt32LE(32) || (1 << bpp)) : 0;
    const palette = head;
    const pixels = palette + colors * 4;
    const stride = Math.ceil((w * bpp) / 32) * 4;
    const maskStride = Math.ceil(w / 32) * 4;
    const maskAt = pixels + stride * h;
    if (maskAt > data.length) continue;
    const rgba = Buffer.alloc(w * h * 4);
    let anyAlpha = false;
    for (let y = 0; y < h; y++) {
      const row = pixels + (h - 1 - y) * stride; // bottom-up
      for (let x = 0; x < w; x++) {
        let r, g, b, a = 255;
        if (bpp === 32) { const p = row + x * 4; b = data[p]; g = data[p + 1]; r = data[p + 2]; a = data[p + 3]; if (a) anyAlpha = true; }
        else if (bpp === 24) { const p = row + x * 3; b = data[p]; g = data[p + 1]; r = data[p + 2]; }
        else {
          const bit = x * bpp;
          const byte = data[row + (bit >> 3)];
          const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
          const p = palette + idx * 4;
          b = data[p]; g = data[p + 1]; r = data[p + 2];
        }
        const o = (y * w + x) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
      }
    }
    // without an alpha channel, the AND mask says which pixels are transparent
    if (bpp !== 32 || !anyAlpha) {
      for (let y = 0; y < h; y++) {
        const row = maskAt + (h - 1 - y) * maskStride;
        for (let x = 0; x < w; x++) {
          const m = row + (x >> 3) < data.length ? (data[row + (x >> 3)] >> (7 - (x & 7))) & 1 : 0;
          rgba[(y * w + x) * 4 + 3] = m ? 0 : 255;
        }
      }
    }
    return { png: encodePNG(w, h, rgba), w, h };
  }
  return null;
}

const exists = (file) => stat(file).then((s) => s.isFile() && s.size > 0, () => false);

// Keeps an image as data/media/<hash>.<ext> (served at /media/ by photos.mjs) and returns
// { src, w, h }, or null when the bytes aren't a picture we can use.
export async function keepImage(buf, sourceKey) {
  let ext = sniff(buf);
  if (!ext) return null;
  let w, h;
  if (ext === 'ico') {
    const png = icoToPNG(buf);
    if (!png) return null;
    buf = png.png; ext = 'png'; w = png.w; h = png.h;
  } else {
    ({ w, h } = imageSize(buf, ext));
  }
  if (!(w >= 16 && h >= 16 && w <= 4096 && h <= 4096)) return null;
  const name = `${hash(sourceKey).slice(0, 32)}.${ext}`;
  const file = path.join(MEDIA_DIR, name);
  if (!(await exists(file))) {
    await mkdir(MEDIA_DIR, { recursive: true });
    const tmp = path.join(MEDIA_DIR, `.${name}.${randomBytes(4).toString('hex')}`);
    await writeFile(tmp, buf);
    await rename(tmp, file).catch(async (err) => { await unlink(tmp).catch(() => {}); throw err; });
  }
  return { src: '/media/' + name, w, h };
}
export const mediaExists = (src) => exists(path.join(MEDIA_DIR, String(src).replace(/^\/media\//, '')));

/* ---------------- words, for telling whether a title fits a query ---------------- */

const STOP = new Set(('a an the of in on at to for and or with by from as is are was were be its it his her their this that these those ' +
  'how why what when where who which into about over under between during after before than then our your my we you ' +
  'introduction intro overview basic basics part lesson understanding meet using use example examples real world simple ' +
  'one two first second new more most some any all can do does make making learn learning guide practice step steps ' +
  // Hindi and other Devanagari languages: the commonest little words
  'का की के को में से पर और एक यह है हैं था थी थे तथा या भी तक लिए वाले वाली करने करना कैसे क्या परिचय भाग ' +
  // Spanish, French, Portuguese
  'el la los las de del y en un una por para con al le les des du et à au aux une pour avec da do dos das em um uma ao').split(' '));
// A light English stemmer: "equations" -> "equation", "solving"/"solved"/"solve" -> "solv".
function stem(w) {
  if (w.length <= 3 || !/^[a-z]+$/.test(w)) return w;
  let s = w;
  if (s.endsWith('ies') && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('sses')) s = s.slice(0, -2);
  else if (/(ch|sh|x|z)es$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed') && !s.endsWith('eed')) s = s.slice(0, -2);
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}
export function words(s) {
  const t = String(s || '').toLowerCase().normalize('NFKD').replace(/([a-z])\p{M}+/gu, '$1').normalize('NFKC').replace(/['’]s\b/g, '');
  return new Set((t.match(/[\p{L}\p{M}\p{N}]+/gu) || []).filter((w) => !STOP.has(w) && (w.length > 1 || /\p{N}/u.test(w)))
    .map(stem).filter((w) => !STOP.has(w)));
}
// Two words match when they are the same, or share a long beginning ("bricklaying", "bricklayer"; "photosynthesis", "photosynthetic").
function near(a, b) {
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (short < 6) return false;
  let i = 0;
  while (i < short && a[i] === b[i]) i++;
  return i >= 6 && i >= short * 0.75;
}
// How much of `a`'s words `b` has (0 to 1).
export function covers(a, b) {
  const aw = a instanceof Set ? a : words(a);
  const bw = b instanceof Set ? b : words(b);
  if (!aw.size) return 0;
  let hit = 0;
  aw.forEach((w) => { if (bw.has(w) || [...bw].some((x) => near(w, x))) hit++; });
  return hit / aw.size;
}
