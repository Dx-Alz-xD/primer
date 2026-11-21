// =====================================================================
// Real photos in lessons: freely licensed images from Wikimedia Commons,
// always credited.
//
// A lesson asks for a photo with {"t":"photo","query","caption"} (see
// LESSON_SYSTEM in ai.mjs). When the lesson is saved or opened, each one
// is looked up here, once:
//   1. English Wikipedia: the article with that title, or the top search
//      results whose titles fit the query, and their lead image;
//   2. otherwise a Wikimedia Commons file search.
// Only files kept on Commons itself with a free licence (CC0, public
// domain, CC BY, CC BY-SA and the like) are used, with the author and
// licence read from the file's metadata. The ~960px thumbnail is
// downloaded by the server (size limit, short timeouts, checked by its
// magic bytes), kept as data/media/<hash>.<ext> and served from
// /media/<hash>.<ext> on this site, under the same sandboxing headers as
// community photos. So photos work offline, need no CSP change, and the
// learner's browser never contacts Wikimedia. Lookups are cached on disk
// by query (data/cache/photo-*.json).
//
// A found photo becomes
//   {t:'photo', src:'/media/…', width, height, caption, alt,
//    credit:{author, license, licenseUrl, source}}
// Nothing suitable: the block is dropped. Wikimedia unreachable: the
// block waits in the stored lesson (the browser ignores it) and is tried
// again on a later open. Writing or opening a lesson waits a few seconds
// at most; slower lookups finish in the background and are saved then.
//
// Lessons written before photos existed get one photo the first time
// they are opened, from the lesson's title (or the course topic), and are
// marked so that's only tried once (photoCheck). A course gets a cover
// photo the same way, from its topic. Courses framed around self-harm
// never get photos; other safely framed courses only get the photos their
// lessons ask for, never a guessed one or a cover.
// =====================================================================
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile, rename, stat, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { q, parseJSON, DATA_DIR } from './db.mjs';
import { HttpError, send, sendJSON, overLimit } from './http.mjs';
import { requireUser } from './auth.mjs';
import { hooks, ownCourse, flatten } from './data.mjs';
import { courseSafety } from './safety.mjs';

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
mkdirSync(MEDIA_DIR, { recursive: true });

// Nothing about the learner goes to Wikimedia: a generic agent, no cookies, no referrer.
// Wikimedia lets a client with no contact details make about 10 API requests a minute; whoever
// runs the server can add their own contact (an email or a web page) as WIKIMEDIA_CONTACT for
// the 200 a minute it allows identified clients. Nothing is sent unless they do.
const CONTACT = String(process.env.WIKIMEDIA_CONTACT || '').replace(/[^\w@.:/+~-]/g, '').slice(0, 120);
const UA = `PrimerCourseApp/1.0 (educational course builder${CONTACT ? '; ' + CONTACT : ''})`;
const API_PER_MINUTE = CONTACT ? 120 : 9;
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const THUMB_WIDTH = 960;
const MAX_BYTES = 2 * 1024 * 1024;
const API_MS = 4000;       // one Wikimedia API request
const FILE_MS = 6000;      // one thumbnail download
const QUEUE_MS = 90_000;   // a lookup waits this long for its turn under the rate limit, then tries later
const WRITE_WAIT = 6000;   // a newly written lesson waits this long for its photos at most
const OPEN_WAIT = 3500;    // an older lesson opened for the first time waits this long for one
const MAX_PER_LESSON = 2;
const NONE_TTL = 14 * 864e5;   // "nothing suitable" is looked up again after two weeks
const PARALLEL = 3;            // Wikimedia requests at once, as Wikimedia asks

export const MEDIA_SRC = /^\/media\/([a-f0-9]{32}\.(?:jpg|png|webp|gif))$/;
const MEDIA_NAME = /^[a-f0-9]{32}\.(?:jpg|png|webp|gif)$/;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/* ---------------- talking to Wikimedia ---------------- */

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// A network failure, a timeout, a busy server or the rate limit: try again later, and don't remember it.
class Unreachable extends Error {}
let downUntil = 0;
function pause(ms, why, url) {
  if (Date.now() + ms > downUntil) {
    console.log(`[photos] Wikimedia didn’t answer (${why}${url ? ', ' + new URL(url).host : ''}); photo lookups wait ${Math.round(ms / 1000)} s`);
    downUntil = Date.now() + ms;
  }
}

let running = 0;
const queue = [];
async function slot(fn) {
  if (running >= PARALLEL) await new Promise((r) => queue.push(r));
  running++;
  try { return await fn(); } finally {
    running--;
    if (queue.length) queue.shift()();
  }
}

// API requests in the last minute, so a burst never goes over Wikimedia's limit.
const recent = [];
async function apiTurn(until) {
  for (;;) {
    const now = Date.now();
    while (recent.length && now - recent[0] >= 60_000) recent.shift();
    if (now < downUntil) {
      if (downUntil > until) throw new Unreachable('Wikimedia asked Primer to wait');
      await sleep(downUntil - now + 20);
      continue;
    }
    if (recent.length < API_PER_MINUTE) { recent.push(now); return; }
    const wait = 60_000 - (now - recent[0]) + 50;
    if (now + wait > until) throw new Unreachable('too many photo lookups this minute');
    await sleep(wait);
  }
}

function wmFetch(url, ms, method = 'GET') {
  return slot(async () => {
    if (Date.now() < downUntil) throw new Unreachable('Wikimedia asked Primer to wait');
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { 'User-Agent': UA, 'Api-User-Agent': UA },
        credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow',
        signal: AbortSignal.timeout(ms)
      });
    } catch (err) {
      const why = err.name === 'TimeoutError' ? 'timed out' : err.message;
      pause(60_000, why, url);
      throw new Unreachable(why);
    }
    if (res.status === 429 || res.status >= 500) {
      const after = Number(res.headers.get('retry-after'));
      pause(res.status === 429 ? Math.min(600, Math.max(10, Number.isFinite(after) ? after : 60)) * 1000 : 60_000, `HTTP ${res.status}`, url);
      res.body?.cancel().catch(() => {});
      throw new Unreachable(`HTTP ${res.status}`);
    }
    return res;
  });
}

async function api(base, params, until, ms = API_MS) {
  const url = base + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  await apiTurn(until);
  const res = await wmFetch(url, ms);
  if (!res.ok) { res.body?.cancel().catch(() => {}); throw new Unreachable(`HTTP ${res.status}`); }
  let data;
  try { data = await res.json(); } catch { throw new Unreachable('the answer wasn’t JSON'); }
  if (data && data.error) throw new Unreachable(String(data.error.info || data.error.code || 'API error'));
  return data;
}

// Other modules' Wikimedia requests (a lesson's sources and its apps' logos, server/sources.mjs and
// server/apps.mjs) share this limiter, agent and back-off. An Unreachable error means "ask again later".
// Their searches ask for more (extracts, links), so they get longer than photos' 4 s before counting as unanswered.
export const wikimedia = {
  api: (base, params, waitMs = QUEUE_MS, ms = 10_000) => api(base, params, Date.now() + waitMs, ms),
  // a page's own address, to check it resolves: counted like an API request, to stay well inside the limit
  head: async (url, waitMs = QUEUE_MS) => { await apiTurn(Date.now() + waitMs); return wmFetch(url, 10_000, 'HEAD'); },
  file: (url) => wmFetch(url, FILE_MS),
  Unreachable
};

const INFO = {
  prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: String(THUMB_WIDTH), iiextmetadatalanguage: 'en',
  iiextmetadatafilter: 'LicenseShortName|License|LicenseUrl|Artist|Credit|NonFree|ObjectName|AttributionRequired'
};
const PAGE = { prop: 'pageimages|pageprops', piprop: 'name', pilicense: 'free', ppprop: 'disambiguation', redirects: '1' };

/* ---------------- words, for telling whether an article fits the query ---------------- */

const STOP = new Set(('a an the of in on at to for and or with by from as is are was were be its it his her their this that these those ' +
  'how why what when where who which into about over under between during after before than then our your my we you ' +
  'introduction intro overview basic basics part lesson understanding meet using use example examples real world').split(' '));
function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ves') && w.length > 4) return w.slice(0, -3) + 'f';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}
const words = (s) => new Set((String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/['’]s\b/g, '').match(/[\p{L}\p{N}]+/gu) || []).filter((w) => !STOP.has(w)).map(stem));
// How much of an article's title the query covers: "Cell (biology)" is just "cell".
function fit(title, query) {
  const t = words(String(title).replace(/\s*\([^)]*\)\s*$/, ''));
  if (!t.size) return 0;
  const qw = words(query);
  let hit = 0;
  t.forEach((w) => { if (qw.has(w)) hit++; });
  return hit / t.size;
}

/* ---------------- licences, authors and the files themselves ---------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function plain(html, max = 200) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return c > 31 && c < 0x110000 ? String.fromCodePoint(c) : ' '; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

// The licences Primer uses: the free ones Commons accepts. Anything else (fair use, non-commercial,
// no-derivatives, unknown) is skipped.
const FREE = [/^cc0\b/i, /^cc[ -]by(?:[ -]sa)?(?:[ -]\d(?:\.\d)?)?(?:[ -][a-z]{2,3})?$/i, /^public domain\b/i, /^pd\b/i,
  /^attribution$/i, /^no restrictions$/i, /^free art licen[cs]e\b/i, /^fal\b/i, /^gfdl\b/i];
const NOT_FREE = /\b(?:nc|nd)\b|non-?commercial|no-?deriv|fair use|non-?free|all rights reserved/i;
const LICENCE_HOSTS = new Set(['creativecommons.org', 'www.gnu.org', 'artlibre.org', 'commons.wikimedia.org', 'en.wikipedia.org']);

function licence(meta) {
  const v = (k) => plain(meta[k] && meta[k].value, 300);
  if (/^true$/i.test(v('NonFree'))) return null;
  const name = v('LicenseShortName');
  const code = v('License');
  if (NOT_FREE.test(`${name} ${code}`)) return null;
  if (!FREE.some((re) => re.test(name) || re.test(code.replace(/-/g, ' ')))) return null;
  let url = '';
  try {
    const u = new URL(v('LicenseUrl').replace(/^http:/, 'https:').replace(/^\/\//, 'https://'));
    if (u.protocol === 'https:' && LICENCE_HOSTS.has(u.hostname)) url = u.href;
  } catch { /* none, or not a link */ }
  return { name: (name || code).slice(0, 40), url };
}

function author(meta) {
  const artist = plain(meta.Artist && meta.Artist.value, 120).replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  if (artist && !/^unknown( author)?$/i.test(artist)) return artist;
  const credit = plain(meta.Credit && meta.Credit.value, 120);
  if (credit.length <= 80 && !/own work|^https?:|\.(com|org|net)\b|unknown/i.test(credit)) return credit;
  return '';
}

const clean = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.origin + x.pathname : ''; } catch { return ''; } };
const COMMONS_FILE = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//;
const COMMONS_THUMB = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//;
const fileTitle = (t) => String(t || '').replace(/^File:/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim();

// One Commons file page -> what Primer needs from it, or null when it can't be used.
function usable(page, alt) {
  const ii = page && !page.missing && Array.isArray(page.imageinfo) && page.imageinfo[0];
  if (!ii || !/^image\/(?:jpeg|png|gif|webp|svg\+xml|tiff)$/.test(ii.mime || '')) return null;
  const original = clean(ii.url);
  const thumb = clean(ii.thumburl || ii.url);
  if (!COMMONS_FILE.test(original) || !COMMONS_THUMB.test(thumb)) return null; // on Commons itself, never a local non-free file
  const width = Math.round(Number(ii.thumbwidth || ii.width));
  const height = Math.round(Number(ii.thumbheight || ii.height));
  if (!(Math.min(width, height) >= 180 && Math.max(width, height) >= 300)) return null;
  const ratio = width / height;
  if (ratio > 3.2 || ratio < 0.3) return null;
  const meta = ii.extmetadata || {};
  const lic = licence(meta);
  if (!lic) return null;
  const source = clean(ii.descriptionurl);
  if (!/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(source)) return null;
  let name = plain(meta.ObjectName && meta.ObjectName.value, 160) || fileTitle(page.title);
  if (/^(?:img|dsc[nf]?|p|pict|photo|image)?[\s_-]*\d[\d\s_-]*$/i.test(name)) name = '';
  return {
    thumb, width, height,
    alt: (alt || name || '').slice(0, 160),
    credit: { author: author(meta), license: lic.name, licenseUrl: lic.url, source }
  };
}

// What the first bytes say the file is (the same check community photos get).
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const exists = (file) => stat(file).then((s) => s.isFile() && s.size > 0, () => false);

// Downloads a thumbnail into data/media. Returns the file name, or null when the file can't be used.
async function keepFile(url) {
  const id = createHash('sha256').update(url).digest('hex').slice(0, 32);
  for (const ext of Object.keys(MIME)) if (await exists(path.join(MEDIA_DIR, `${id}.${ext}`))) return `${id}.${ext}`;
  const res = await wmFetch(url, FILE_MS);
  if (!res.ok || Number(res.headers.get('content-length')) > MAX_BYTES) { res.body?.cancel().catch(() => {}); return null; }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX_BYTES) return null; // leaving the loop cancels the download
      chunks.push(chunk);
    }
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'timed out' : err.message;
    pause(60_000, why, url);
    throw new Unreachable(why);
  }
  const buf = Buffer.concat(chunks);
  const ext = sniff(buf);
  if (!ext) return null;
  const name = `${id}.${ext}`;
  const tmp = path.join(MEDIA_DIR, `.${name}.${randomBytes(4).toString('hex')}`);
  await writeFile(tmp, buf);
  await rename(tmp, path.join(MEDIA_DIR, name)).catch(async (err) => { await unlink(tmp).catch(() => {}); throw err; });
  return name;
}

/* ---------------- looking a query up ---------------- */

const sameTitle = (a, b) => {
  const k = (s) => String(s).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return k(a) === k(b);
};
const isDisambiguation = (p) => Boolean(p.pageprops && 'disambiguation' in p.pageprops);

// Two or three requests at most: a Wikipedia search with the results' lead images, the licence
// and author of the best few, and (only if those give nothing) a Commons file search.
// strict (a guess from a lesson's title): only an article whose title the query fully covers, no Commons search.
// Throws Unreachable when Wikimedia couldn't be asked; returns { found: null } when it said there's nothing.
async function lookup(query, strict) {
  const until = Date.now() + QUEUE_MS;
  const search = await api(WIKI_API, { action: 'query', generator: 'search', gsrsearch: query, gsrlimit: '5', gsrnamespace: '0', ...PAGE }, until);
  const pages = ((search.query && search.query.pages) || []).sort((a, b) => (a.index || 0) - (b.index || 0));

  const wiki = []; // [{ file, alt }] in order of preference
  const add = (p) => { if (p.pageimage && !wiki.some((c) => c.file === p.pageimage)) wiki.push({ file: p.pageimage, alt: p.title.replace(/\s*\([^)]*\)\s*$/, '') }); };
  const article = pages.find((p) => sameTitle(p.title, query) && !isDisambiguation(p));
  if (article) {
    // the article itself: its lead image, or nothing (a film or a logo with no free image shouldn't get a stranger's photo)
    if (!article.pageimage) return { found: null };
    add(article);
  } else {
    // the results whose titles the query covers best ("Monarch butterfly" before "Monarch butterfly migration")
    pages.map((p) => ({ p, f: fit(p.title, query) }))
      .filter(({ p, f }) => p.pageimage && !isDisambiguation(p) && f >= (strict ? 1 : 0.5))
      .sort((a, b) => b.f - a.f || (a.p.index || 0) - (b.p.index || 0))
      .slice(0, 3).forEach(({ p }) => add(p));
  }

  const candidates = [];
  if (wiki.length) {
    const info = await api(COMMONS_API, { action: 'query', titles: wiki.map((c) => 'File:' + c.file).join('|'), ...INFO }, until);
    const files = (info.query && info.query.pages) || [];
    const norm = new Map(((info.query && info.query.normalized) || []).map((x) => [x.from, x.to]));
    wiki.forEach((c) => {
      const title = norm.get('File:' + c.file) || ('File:' + c.file).replace(/_/g, ' ');
      const ok = usable(files.find((p) => p.title === title), c.alt);
      if (ok) candidates.push(ok);
    });
  }
  if (!strict && !article && !candidates.length) {
    const commons = await api(COMMONS_API, { action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '6', ...INFO }, until);
    ((commons.query && commons.query.pages) || []).sort((a, b) => (a.index || 0) - (b.index || 0))
      .forEach((p) => { const ok = usable(p, ''); if (ok) candidates.push({ ...ok, alt: ok.alt || query }); });
  }

  for (const c of candidates.slice(0, 3)) {
    const name = await keepFile(c.thumb); // Unreachable propagates: try again later
    if (name) return { found: { name, thumb: c.thumb, width: c.width, height: c.height, alt: c.alt, credit: c.credit } };
  }
  return { found: null };
}

const inflight = new Map();
const cacheFile = (key) => path.join(CACHE_DIR, `photo-${createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 24)}.json`);
export const cleanQuery = (s) => String(s || '').replace(/[\p{Cc}[\]{}|<>#_]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

// -> { status: 'found', photo } | { status: 'none' } | { status: 'error', error }
export async function findPhoto(query, { strict = false } = {}) {
  const text = cleanQuery(query);
  if (text.length < 2) return { status: 'none' };
  const key = { v: 1, strict: Boolean(strict), q: text.toLowerCase().normalize('NFKC') };
  const file = cacheFile(key);
  let hit = null;
  try { hit = JSON.parse(await readFile(file, 'utf8')); } catch { /* not looked up yet */ }
  if (hit && hit.photo && await exists(path.join(MEDIA_DIR, hit.photo.name))) return { status: 'found', photo: hit.photo };
  if (hit && !hit.photo && Date.now() - hit.at < NONE_TTL) return { status: 'none' };
  if (inflight.has(file)) return inflight.get(file);
  const job = (async () => {
    let found = null;
    if (hit && hit.photo && hit.photo.thumb) { // the file went missing: fetch the same one again
      const name = await keepFile(hit.photo.thumb);
      if (name) found = { ...hit.photo, name };
    }
    if (!found) found = (await lookup(text, strict)).found;
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify({ ...key, query: text, at: Date.now(), photo: found }, null, 1));
    return found ? { status: 'found', photo: found } : { status: 'none' };
  })().catch((err) => {
    if (!(err instanceof Unreachable)) console.log(`[photos] "${text}": ${err.message}`);
    return { status: 'error', error: err.message };
  }).finally(() => inflight.delete(file));
  inflight.set(file, job);
  return job;
}

/* ---------------- photos in a lesson ---------------- */

const isPhoto = (b) => Boolean(b && typeof b === 'object' && b.t === 'photo');
const isFound = (b) => isPhoto(b) && typeof b.src === 'string' && MEDIA_SRC.test(b.src);
const blocksOf = (l) => (l && Array.isArray(l.sections) ? l.sections.flatMap((s) => (s && Array.isArray(s.blocks) ? s.blocks : [])) : []);
const escHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const block = (p, caption) => ({
  t: 'photo', src: '/media/' + p.name, width: p.width, height: p.height,
  caption: String(caption || '').slice(0, 300), alt: p.alt || '',
  credit: { author: p.credit.author || '', license: p.credit.license || '', licenseUrl: p.credit.licenseUrl || '', source: p.credit.source || '' }
});

const kindOf = (meta) => { const s = courseSafety(meta); return s ? s.kind : null; };

function needsWork(lesson, meta) {
  if (!lesson || !Array.isArray(lesson.sections)) return false;
  if (meta.source !== 'ai' && meta.source !== 'library') return false;
  const blocks = blocksOf(lesson);
  if (kindOf(meta) === 'selfharm') return blocks.some(isPhoto);
  if (blocks.some((b) => isPhoto(b) && !isFound(b))) return true;
  return !lesson.photoCheck && !blocks.some(isFound);
}

const mathHeavy = (lesson) => blocksOf(lesson).filter((b) => b && b.t === 'math').length >= 3;
const usedElsewhere = (courseId, n, src) => Boolean(q('SELECT 1 FROM lessons WHERE course_id = ? AND n <> ? AND instr(data, ?) > 0 LIMIT 1').get(courseId, n, src));

// Works out the lesson with its photos. Returns the new lesson, or null when nothing changed.
async function prepare(courseId, meta, n, lesson, { force = false } = {}) {
  const L = structuredClone(lesson);
  const kind = kindOf(meta);
  if (kind === 'selfharm') {
    L.sections.forEach((s) => { if (Array.isArray(s.blocks)) s.blocks = s.blocks.filter((b) => !isPhoto(b)); });
    L.photoCheck = 'none';
    return L;
  }

  // photos the lesson asked for (at most two, each image once)
  const pending = blocksOf(L).filter((b) => isPhoto(b) && !isFound(b));
  if (pending.length) {
    const allowed = Math.max(0, MAX_PER_LESSON - blocksOf(L).filter(isFound).length);
    const asked = pending.slice(0, allowed);
    const results = await Promise.all(asked.map((b) => findPhoto(b.query || '')));
    const answer = new Map(asked.map((b, i) => [b, results[i]]));
    const seen = new Set(blocksOf(L).filter(isFound).map((b) => b.src));
    let waiting = 0;
    L.sections.forEach((s) => {
      if (!Array.isArray(s.blocks)) return;
      s.blocks = s.blocks.flatMap((b) => {
        if (!isPhoto(b) || isFound(b)) return [b];
        const r = answer.get(b);
        if (!r || r.status === 'none') return [];        // over the limit, or nothing suitable
        if (r.status === 'error') { waiting++; return [b]; } // Wikimedia unreachable: try again later
        const out = block(r.photo, b.caption);
        if (seen.has(out.src)) return [];
        seen.add(out.src);
        return [out];
      });
    });
    if (!waiting) L.photoCheck = L.photoCheck || 'ai';
    return L;
  }

  // an older lesson with no photos: one guessed from its title, else the course topic
  if ((L.photoCheck && !force) || blocksOf(L).some(isFound)) return null;
  if (kind || (mathHeavy(L) && !force)) { L.photoCheck = 'skip'; return L; } // safely framed or maths: no guesses
  const me = flatten(meta.units || [])[n - 1];
  const topic = (meta.library && meta.library.subject) || meta.topic || '';
  const tries = [me && me.title, topic].filter(Boolean);
  const results = await Promise.all(tries.map((t) => findPhoto(t, { strict: true })));
  if (results.some((r) => r.status === 'error') && !results.some((r) => r.status === 'found')) return null; // try again next time
  const pick = results.find((r) => r.status === 'found' && !usedElsewhere(courseId, n, '/media/' + r.photo.name));
  if (!pick) { L.photoCheck = 'none'; return L; }
  const first = L.sections.find((s) => Array.isArray(s.blocks));
  if (!first) return null;
  const english = !meta.lang || meta.lang === 'en';
  const out = block(pick.photo, english ? escHTML(pick.photo.alt) : '');
  first.blocks.splice(first.blocks[0] && first.blocks[0].t === 'p' ? 1 : 0, 0, out);
  L.photoCheck = 'guess';
  return L;
}

const saveStored = (courseId, n, lesson) => q('UPDATE lessons SET data = ? WHERE course_id = ? AND n = ?').run(JSON.stringify(lesson), courseId, n);

// After a slow lookup has finished in the background: apply it to whatever is stored now (from the warm cache).
async function refreshStored(courseId, meta, n) {
  const row = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(courseId, n);
  const lesson = row && parseJSON(row.data, null);
  if (!lesson || !needsWork(lesson, meta)) return;
  const out = await prepare(courseId, meta, n, lesson);
  if (out && JSON.stringify(out) !== row.data) saveStored(courseId, n, out);
}

// A course's cover: the lead image of its topic's Wikipedia article (a full match only), looked up
// once in the background the first time one of its lessons is written or opened, and kept in the
// course (meta.cover; null when there's none). Safely framed courses get none.
const covering = new Set();
function findCover(row, meta) {
  if (meta.cover !== undefined || covering.has(row.id) || (meta.source !== 'ai' && meta.source !== 'library')) return;
  const keep = (cover) => q("UPDATE courses SET data = json_set(data, '$.cover', json(?)) WHERE id = ?").run(JSON.stringify(cover), row.id);
  if (kindOf(meta)) { keep(null); return; }
  covering.add(row.id);
  findPhoto((meta.library && meta.library.subject) || meta.topic || '', { strict: true }).then((r) => {
    if (r.status === 'error') return; // try again another time
    const b = r.status === 'found' ? block(r.photo, '') : null;
    keep(b && { src: b.src, width: b.width, height: b.height, alt: b.alt, credit: b.credit });
  }).catch((err) => console.log(`[photos] cover for ${row.id}: ${err.message}`)).finally(() => covering.delete(row.id));
}

const TIMEOUT = Symbol('timeout');

// hooks.photos in data.mjs: called with every lesson that is written (stored: false, the caller
// saves it) or opened (stored: true, saved here if it changed). Never throws, never waits long.
async function lessonPhotos(row, meta, n, lesson, stored) {
  try {
    findCover(row, meta);
    if (!needsWork(lesson, meta)) return lesson;
    const job = prepare(row.id, meta, n, lesson);
    // while Wikimedia has asked Primer to wait, only cached photos are worth waiting for
    const wait = Date.now() < downUntil ? 400 : stored ? OPEN_WAIT : WRITE_WAIT;
    const out = await Promise.race([job, sleep(wait).then(() => TIMEOUT)]);
    if (out === TIMEOUT) {
      job.then(() => refreshStored(row.id, meta, n)).catch((err) => console.log(`[photos] lesson ${n}: ${err.message}`));
      return lesson;
    }
    if (!out) return lesson;
    if (stored) saveStored(row.id, n, out);
    return out;
  } catch (err) {
    console.log(`[photos] lesson ${n} of ${row.id}: ${err.message}`);
    return lesson;
  }
}
hooks.photos = lessonPhotos;

/* ---------------- routes ---------------- */

// "Add photos": look one up for a written lesson that has none, now, even if that was tried before.
async function addPhotos({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const n = Number(params.n);
  const meta = parseJSON(row.data, {});
  if (meta.source !== 'ai' && meta.source !== 'library') throw new HttpError('Sample courses use their built-in lessons.', 400);
  const have = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(row.id, n);
  if (!have) throw new HttpError('That lesson hasn’t been written yet.', 404);
  if (overLimit('photos:' + u.id, 30, 3600_000)) throw new HttpError('You’ve asked for a lot of photos this hour. Try again later.', 429);
  const lesson = parseJSON(have.data, null);
  if (!lesson || !Array.isArray(lesson.sections)) throw new HttpError('That lesson can’t be read.', 500);
  const before = blocksOf(lesson).filter(isFound).length;
  const out = await prepare(row.id, meta, n, lesson, { force: true });
  if (out) saveStored(row.id, n, out);
  const now = out || lesson;
  sendJSON(res, 200, { ok: true, lesson: now, added: blocksOf(now).filter(isFound).length - before });
}

// The image itself. Only names this module made can match, and the headers make sure a browser
// treats it as a picture and nothing else.
async function serveMedia({ req, res, params }) {
  if (!MEDIA_NAME.test(params.name)) return send(res, 404, 'Not found');
  let data;
  try { data = await readFile(path.join(MEDIA_DIR, params.name)); } catch { return send(res, 404, 'Not found'); }
  res.writeHead(200, {
    'Content-Type': MIME[params.name.split('.').pop()],
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'public, max-age=31536000, immutable'
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

export const routes = [
  ['POST', /^\/api\/courses\/(?<id>[^/]+)\/lessons\/(?<n>\d{1,4})\/photos$/, addPhotos],
  ['GET', /^\/media\/(?<name>[a-f0-9]{32}\.(?:jpg|png|webp|gif))$/, serveMedia, 'raw']
];
