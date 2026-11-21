/* =====================================================================
   Primer's service worker. The server sends this file as /sw.js
   (server/offline.mjs) so it looks after every page on the site.
   The page side is assets/js/offline.js.

   What it keeps on the device, and how:
   - Files (/assets/, the manifest): network first, the saved copy when
     there's no connection or the network is very slow. KaTeX from
     cdn.jsdelivr.net and Google Fonts: saved copy first (their URLs are
     versioned, so they never change).
   - Pages: network first. The whole response is kept, headers included,
     so a saved page's Content-Security-Policy nonce still matches its
     inline boot script. One copy per page, whatever the query string
     (lesson.html?course=…&lesson=… is one page).
   - Pages and data belong to one learner: they're kept only for a
     signed-in learner, in a cache named after them (primer-user-<id>).
     When someone else signs in on the device, the last learner's cache
     is deleted. Sign-in and account endpoints are never kept.
   - The learner's data: the course list and folders always; for courses
     they downloaded, the course, its written lessons, notes, doubts and
     the book. Network first (a written lesson: the saved copy at once,
     refreshed quietly), the saved copy when offline.
   - Lesson photos (/media/, server/photos.mjs): whenever a downloaded
     course's lesson or book is kept, the photos it shows are kept with
     it, in the learner's cache; they are served from there first (the
     files never change). Removing a download drops the photos no other
     downloaded course uses.
   - Saves made offline (lesson progress, notes, wrong answers) wait in
     IndexedDB and are sent when the connection is back: on the next page
     load, on the 'online' event, or by Background Sync. They're applied
     to the saved copies straight away, so pages opened offline show them.
     Progress is merged with the server's when it's sent, so answers
     given on another device in the meantime aren't lost.
   ===================================================================== */
'use strict';

const VERSION = 'v1';
const STATIC = 'primer-static-' + VERSION; // files anyone can fetch
const META = 'primer-meta';                // who the device's learner is
const USER = 'primer-user-';               // + id: that learner's pages and data
const ORIGIN = self.location.origin;
const abs = (p) => new URL(p, ORIGIN).href;
const OWNER_KEY = abs('/__primer/owner');
const DOWNLOADS_KEY = abs('/__primer/downloads');
const STUDY_PAGES = ['/app.html', '/lesson.html', '/book.html'];

const RE = {
  course: /^\/api\/courses\/([A-Za-z0-9_-]{4,64})$/,
  lesson: /^\/api\/courses\/([A-Za-z0-9_-]{4,64})\/lessons\/(\d+)$/,
  courseNotes: /^\/api\/courses\/([A-Za-z0-9_-]{4,64})\/notes$/,
  book: /^\/api\/courses\/([A-Za-z0-9_-]{4,64})\/book$/,
  notes: /^\/api\/notes\/([A-Za-z0-9_-]{4,64})\/(\d+)$/,
  progress: /^\/api\/courses\/([A-Za-z0-9_-]{4,64})\/progress\/(\d+)$/,
  boot: /window\.__PRIMER__=(.*?);<\/script>/,
  media: /\/media\/[a-f0-9]{32}\.(?:jpg|png|webp|gif)/g,
  withMedia: /^\/api\/courses\/[A-Za-z0-9_-]{4,64}(?:\/lessons\/\d+|\/book)?$/
};

// Shown in the page when something needs the internet (the page translates them).
const MSG = {
  offline: 'You’re offline. Connect to the internet and try again.',
  lesson: 'You’re offline, and this lesson isn’t downloaded. Connect to the internet to open it.',
  write: 'You’re offline. This lesson isn’t written yet: the AI writes each lesson the first time you open it, so it needs the internet.',
  signin: 'Sign in again to download this course.',
  failed: 'The course didn’t download. Try again.'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const offlineNow = () => self.navigator.onLine === false;
const isGateway = (s) => s >= 502 && s <= 504;
const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const offlineJSON = (error) => jsonRes({ ok: false, offline: true, error }, 503);
const parseBody = (s) => { try { return JSON.parse(s) || {}; } catch (e) { return {}; } };

async function readJSON(cache, key) {
  const r = await cache.match(key);
  if (!r) return null;
  try { return await r.json(); } catch (e) { return null; }
}

// Cache writes run one at a time, so two saves can't overwrite each other's changes.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

/* ---------------- whose device it is ---------------- */

async function getOwner() {
  const d = await readJSON(await caches.open(META), OWNER_KEY);
  return d && d.id != null ? String(d.id) : null;
}
async function ownerLang() {
  const d = await readJSON(await caches.open(META), OWNER_KEY);
  return (d && d.lang) || 'en';
}

// Called with what the server says (a page's boot data, /api/auth/me), or by a page
// when nobody is known yet. A different learner means the last one's things go.
function setOwner(id, lang) {
  if (id == null) return Promise.resolve();
  id = String(id);
  return serial(async () => {
    const meta = await caches.open(META);
    const cur = await readJSON(meta, OWNER_KEY);
    const same = cur && String(cur.id) === id;
    if (same && (!lang || cur.lang === lang)) return;
    if (!same) {
      for (const k of await caches.keys()) if (k.startsWith(USER) && k !== USER + id) await caches.delete(k);
    }
    await meta.put(OWNER_KEY, jsonRes({ id, lang: lang || (same && cur.lang) || null }));
  });
}

async function userCache() {
  const owner = await getOwner();
  return owner ? { owner, cache: await caches.open(USER + owner) } : null;
}

/* ---------------- connection state, for the offline banner ---------------- */

let down = false;
async function broadcast(msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach((c) => c.postMessage(msg));
}
function setNet(isDown, event) {
  if (down === isDown) return;
  down = isDown;
  broadcast({ type: 'net', down });
  if (!down) {
    const p = replay().catch(() => {});
    if (event) { try { event.waitUntil(p); } catch (e) { /* the event already finished */ } }
  }
}

/* ---------------- the queue of saves made offline (IndexedDB) ---------------- */

let dbp = null;
function idb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('primer-offline', 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('queue')) r.result.createObjectStore('queue', { keyPath: 'key' });
      };
      r.onsuccess = () => {
        const d = r.result;
        d.onversionchange = () => { d.close(); dbp = null; };
        resolve(d);
      };
      r.onerror = () => { dbp = null; reject(r.error); };
    });
  }
  return dbp;
}
function tx(mode, fn) {
  return idb().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction('queue', mode);
    const req = fn(t.objectStore('queue'));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const qAll = () => tx('readonly', (s) => s.getAll()).then((a) => a || []);
const qPut = (item) => tx('readwrite', (s) => s.put(item));
// Removes a waiting save, but only the copy that was sent (`at`): a newer one may have replaced it.
const qDelete = (key, at) => tx('readwrite', (s) => {
  const g = s.get(key);
  g.onsuccess = () => { if (g.result && (at == null || g.result.at === at)) s.delete(key); };
  return null;
});
const queuedFor = async (owner) => (await qAll()).filter((it) => !it.user || it.user === owner);

// Lesson progress from two places: keep every answer, the most tries, and "done" if either says so.
function mergeProgress(server, local) {
  if (!server || typeof server !== 'object') return local;
  if (!local || typeof local !== 'object') return server;
  const out = Object.assign({}, server, local);
  out.answered = Object.assign({}, server.answered || {}, local.answered || {});
  const tries = Object.assign({}, server.tries || {});
  Object.entries(local.tries || {}).forEach(([k, v]) => { tries[k] = Math.max(Number(tries[k]) || 0, Number(v) || 0); });
  out.tries = tries;
  out.done = Boolean(server.done || local.done);
  const at = [server.doneAt, local.doneAt].filter(Boolean);
  if (at.length) out.doneAt = Math.min(...at);
  return out;
}

// Applies one waiting save to a saved API answer (`data`, for `path`), in place.
function overlay(path, data, it) {
  let m = RE.progress.exec(it.url);
  if (m) {
    const id = m[1], n = m[2];
    const prog = parseBody(it.body).progress;
    if (!prog || typeof prog !== 'object') return;
    const set = (c) => {
      if (!c || c.id !== id) return;
      c.progress = Object.assign({}, c.progress || {});
      c.progress[n] = mergeProgress(c.progress[n], prog);
      c.lastLesson = Number(n);
    };
    if (path === '/api/courses') (data.courses || []).forEach(set);
    else if (path === `/api/courses/${id}` || path === `/api/courses/${id}/book`) set(data.course);
    return;
  }
  m = RE.notes.exec(it.url);
  if (m) {
    const id = m[1], n = Number(m[2]);
    const b = parseBody(it.body);
    if (path === `/api/notes/${id}/${n}`) {
      if (b.text != null) data.text = typeof b.text === 'string' ? b.text : '';
      if (b.sketch !== undefined) data.sketch = b.sketch;
      data.updatedAt = it.at;
    } else if (path === `/api/courses/${id}/notes` && b.text != null) {
      const text = typeof b.text === 'string' ? b.text : '';
      const list = (data.notes || []).filter((x) => x.lesson !== n);
      if (text !== '') list.push({ lesson: n, text, updatedAt: it.at });
      data.notes = list.sort((a, c) => a.lesson - c.lesson);
    }
  }
}

// The saved answers one save changes (`create`: make the entry if that course is downloaded).
function affected(it) {
  let m = RE.progress.exec(it.url);
  if (m) return [{ path: '/api/courses' }, { path: `/api/courses/${m[1]}` }, { path: `/api/courses/${m[1]}/book` }];
  m = RE.notes.exec(it.url);
  if (m) return [{ path: `/api/notes/${m[1]}/${m[2]}`, create: m[1] }, { path: `/api/courses/${m[1]}/notes` }];
  return [];
}

// Writes a save into the saved copies, so a page opened offline shows it.
function applyLocal(owner, it) {
  return serial(async () => {
    if ((await getOwner()) !== owner) return;
    const cache = await caches.open(USER + owner);
    for (const { path, create } of affected(it)) {
      const key = abs(path);
      let data = await readJSON(cache, key);
      if (!data) {
        if (!create || !(await isDownloaded(cache, create))) continue;
        data = { ok: true, text: '', sketch: null, updatedAt: null };
      }
      overlay(path, data, it);
      await cache.put(key, jsonRes(data));
    }
  });
}

// Keeps an API answer, with any saves still waiting applied on top.
async function keepJSON(owner, key, res) {
  if (!res || !res.ok || !/json/.test(res.headers.get('Content-Type') || '')) return;
  let data;
  try { data = await res.json(); } catch (e) { return; }
  if (!data || data.ok === false) return;
  const waiting = await queuedFor(owner);
  const path = new URL(key).pathname;
  await serial(async () => {
    if ((await getOwner()) !== owner) return;
    waiting.forEach((it) => overlay(path, data, it));
    await (await caches.open(USER + owner)).put(key, jsonRes(data));
  });
  // a downloaded course's lesson or book: the photos it shows are kept too
  if (RE.withMedia.test(path)) await keepMedia(owner, mediaIn(data)).catch(() => {});
}

/* ---------------- lesson photos (/media/) ---------------- */

const mediaIn = (data) => Array.from(new Set(JSON.stringify(data || null).match(RE.media) || []));

async function keepMedia(owner, paths) {
  for (const p of paths) {
    const key = abs(p);
    const cache = await caches.open(USER + owner);
    if (await cache.match(key)) continue;
    const res = await fetch(key, { credentials: 'same-origin' }).catch(() => null);
    if (!res || !res.ok || !/^image\//.test(res.headers.get('Content-Type') || '')) continue;
    await serial(async () => { if ((await getOwner()) === owner) await cache.put(key, res); });
  }
}

// Photos never change, so a kept copy is used first; others come from the network as usual.
async function mediaFile(req, url) {
  const u = await userCache();
  const hit = u ? await u.cache.match(abs(url.pathname)) : null;
  if (hit) return hit;
  try { return await fetch(req); } catch (e) { setNet(true); return new Response('', { status: 504 }); }
}

/* ---------------- sending the waiting saves ---------------- */

let replaying = null;
let replayFailedAt = 0;
function replay(force) {
  if (!replaying) {
    if (!force && Date.now() - replayFailedAt < 10000) return Promise.resolve(-1);
    replaying = runReplay().finally(() => { replaying = null; });
  }
  return replaying;
}

async function sendOne(it, courses) {
  let body = it.body;
  const m = RE.progress.exec(it.url);
  if (m) {
    // merge with what the server has now, so answers from another device aren't overwritten
    let course = courses.get(m[1]);
    if (course === undefined) {
      const r = await fetch(abs('/api/courses/' + m[1]), { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return r;
      course = (await r.json()).course || null;
      courses.set(m[1], course);
    }
    const local = parseBody(body).progress;
    if (course && local) {
      const merged = mergeProgress((course.progress || {})[m[2]], local);
      body = JSON.stringify({ progress: merged });
      course.progress = Object.assign({}, course.progress || {}, { [m[2]]: merged });
    }
  }
  return fetch(abs(it.url), { method: it.method, headers: { 'Content-Type': it.type || 'application/json' }, body, credentials: 'same-origin' });
}

// Returns how many saves are still waiting for the signed-in learner.
async function runReplay() {
  const all = await qAll();
  if (!all.length) return 0;
  let me;
  try {
    const r = await fetch(abs('/api/auth/me'), { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw new Error('status ' + r.status);
    me = (await r.json()).user;
  } catch (e) {
    replayFailedAt = Date.now();
    setNet(true);
    return all.length;
  }
  setNet(false);
  if (!me) { replayFailedAt = Date.now(); return all.length; } // signed out: they wait for this learner's next sign-in
  const uid = String(me.id);
  await setOwner(uid, me.lang);
  // another learner's saves wait for them, but not forever
  for (const it of all) if (it.user && it.user !== uid && Date.now() - it.at > 30 * 864e5) await qDelete(it.key, it.at);
  const mine = all.filter((it) => !it.user || it.user === uid).sort((a, b) => a.at - b.at);
  const courses = new Map();
  let sent = 0;
  for (const it of mine) {
    let res;
    try { res = await sendOne(it, courses); } catch (e) { replayFailedAt = Date.now(); setNet(true); break; }
    if (res.status === 401 || isGateway(res.status)) { replayFailedAt = Date.now(); break; }
    await qDelete(it.key, it.at); // sent, or refused for good (the course was deleted, say)
    if (res.ok) sent++;
  }
  if (sent) broadcast({ type: 'synced', sent });
  return (await queuedFor(uid)).length;
}

/* ---------------- fetch strategies ---------------- */

// Network first. With a saved copy and `wait`, a slow network gets `wait` ms before the copy is used
// (the network answer still updates the copy when it comes).
async function networkFirst(event, req, cached, { wait = 0, keep, fallback } = {}) {
  if (cached && offlineNow()) { setNet(true); return cached; }
  const net = fetch(req).then((res) => {
    if (isGateway(res.status)) { setNet(true); return { res, ok: false }; }
    setNet(false, event);
    const kept = keep ? Promise.resolve().then(() => keep(res.clone())).catch(() => {}) : null;
    return { res, ok: true, kept };
  }, () => { setNet(true); return { res: null, ok: false }; });
  event.waitUntil(net.then((r) => r.kept));
  const first = cached && wait ? await Promise.race([net, sleep(wait).then(() => null)]) : await net;
  if (first && first.ok) return first.res;
  if (cached) return cached;
  if (first && first.res) return first.res;
  return fallback ? fallback() : Response.error();
}

async function passThrough(event, req, message) {
  if (offlineNow()) { setNet(true); return offlineJSON(message); }
  try {
    const res = await fetch(req);
    setNet(isGateway(res.status), event);
    return res;
  } catch (e) {
    setNet(true);
    return offlineJSON(message);
  }
}

/* ---------------- pages ---------------- */

const isPage = (p) => p === '/' || /^\/[a-z]+\.html$/.test(p);
const pageKey = (pathname) => abs(pathname === '/' ? '/index.html' : pathname);
const NEVER_KEEP = new Set([abs('/auth.html')]);

// Keeps a page made for a signed-in learner, headers and all.
async function keepPage(key, res) {
  if (!res.ok || res.type !== 'basic' || res.redirected || NEVER_KEEP.has(key)) return null;
  if (!/text\/html/.test(res.headers.get('Content-Type') || '')) return null;
  const html = await res.text();
  const m = RE.boot.exec(html);
  let boot = null;
  try { boot = m ? JSON.parse(m[1]) : null; } catch (e) { boot = null; }
  const user = boot && boot.user;
  if (!user || user.id == null) return null; // signed out: nothing of theirs to keep
  await setOwner(user.id, user.lang);
  await serial(async () => {
    if ((await getOwner()) !== String(user.id)) return;
    const copy = new Response(html, { status: 200, statusText: 'OK', headers: res.headers });
    await (await caches.open(USER + user.id)).put(key, copy);
  });
  return html;
}

async function page(event, req, url) {
  const key = pageKey(url.pathname);
  const u = NEVER_KEEP.has(key) ? null : await userCache();
  const cached = u ? await u.cache.match(key) : null;
  return networkFirst(event, req, cached, {
    wait: 4000,
    keep: (res) => keepPage(key, res),
    fallback: () => offlinePage()
  });
}

// A page that was never saved, asked for with no connection.
async function offlinePage() {
  const lang = await ownerLang();
  let dict = {};
  if (lang !== 'en') {
    const d = await readJSON(await caches.open(STATIC), abs(`/assets/i18n/${lang}.json`));
    dict = (d && d.strings) || {};
  }
  const t = (s) => (Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html>
<html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#120b06"><title>${esc(t('You’re offline'))} | Primer</title>
<style>
html,body{margin:0;min-height:100%;background:#120b06;color:#efe2c6;font:500 19px/1.5 "Cormorant Garamond",Georgia,serif}
main{max-width:30rem;margin:18vh auto 0;padding:2rem 1.6rem;background:rgba(24,15,8,.92);border:1px solid #4a3322;border-radius:5px;position:relative}
main::before{content:"";position:absolute;inset:5px;border:3px double rgba(214,165,84,.26);border-radius:3px;pointer-events:none}
p.brand{margin:0 0 1rem;color:#d6a554;font:1.3rem "IM Fell English",Georgia,serif;letter-spacing:.02em}
h1{margin:0 0 .6rem;font:400 2rem/1.15 "IM Fell English",Georgia,serif}
p{margin:0;color:#cfbf9d}
a{display:inline-block;margin-top:1.4rem;padding:.6rem 1.1rem;border-radius:4px;color:#24160a;text-decoration:none;font:1.05rem "IM Fell English",Georgia,serif;background:linear-gradient(180deg,#f3d38f,#d6a554 50%,#b07f3a);border:1px solid #8a6128}
@media (max-width:560px){main{margin:10vh 16px 0}}
</style></head>
<body><main>
<p class="brand">Primer</p>
<h1>${esc(t('You’re offline'))}</h1>
<p>${esc(t('This page isn’t saved on this device yet. Connect to the internet to open it, or go to your courses: the ones you downloaded work offline.'))}</p>
<a href="/app.html">${esc(t('Your courses'))}</a>
</main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}

/* ---------------- files ---------------- */

function isCDN(url) {
  if (url.origin === 'https://cdn.jsdelivr.net') return /@\d/.test(url.pathname); // versioned only
  return url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';
}
function keepableFile(href) {
  let url;
  try { url = new URL(href); } catch (e) { return false; }
  if (url.origin === ORIGIN) return url.pathname.startsWith('/assets/') || url.pathname === '/manifest.webmanifest';
  return isCDN(url);
}

async function siteFile(event, req) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(req.url, { ignoreVary: true });
  return networkFirst(event, req, cached, {
    wait: 3500,
    keep: (res) => (res.ok && res.type === 'basic' ? serial(() => cache.put(req.url, res)) : null)
  });
}

// Google Fonts stylesheets are requested without CORS; asking with CORS gives a copy that
// can be read (for its font files) and doesn't take up padded space in the cache.
const fetchFile = (href) => {
  const url = new URL(href);
  return url.origin === ORIGIN
    ? fetch(href, { credentials: 'same-origin' })
    : fetch(href, { mode: 'cors', credentials: 'omit' });
};

async function cdnFile(event, req, url) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(url.href, { ignoreVary: true });
  if (hit) return hit;
  const res = url.origin === 'https://fonts.googleapis.com' && req.mode === 'no-cors' ? await fetchFile(url.href) : await fetch(req);
  if (res.ok && (res.type === 'cors' || res.type === 'basic')) event.waitUntil(serial(() => cache.put(url.href, res.clone())).catch(() => {}));
  return res;
}

// The scripts, stylesheets and icons a page links to.
function filesIn(html, base) {
  const out = [];
  const tags = html.match(/<(?:script|link)\s[^>]*>/gi) || [];
  tags.forEach((tag) => {
    const get = (re) => { const m = re.exec(tag); return m ? m[1].replace(/&amp;/g, '&') : null; };
    let href = null;
    if (/^<script/i.test(tag)) href = get(/\ssrc="([^"]+)"/i);
    else if (/\srel="(?:stylesheet|manifest|apple-touch-icon|icon)"/i.test(tag)) href = get(/\shref="([^"]+)"/i);
    if (!href || /^data:/i.test(href)) return;
    try { out.push(new URL(href, base).href); } catch (e) { /* not a URL */ }
  });
  return out;
}

// The font files a stylesheet uses. From Google Fonts, only the alphabets the learner reads.
function fontsIn(css, base, lang) {
  const google = base.startsWith('https://fonts.googleapis.com/');
  const want = new Set(['latin', 'latin-ext']);
  // the script of the interface language (the subsets Google Fonts names in its stylesheets)
  const SCRIPT = {
    ru: 'cyrillic cyrillic-ext', hi: 'devanagari', bho: 'devanagari', mr: 'devanagari', mai: 'devanagari', bn: 'bengali', as: 'bengali',
    te: 'telugu', ta: 'tamil', gu: 'gujarati', ur: 'arabic', ar: 'arabic', kn: 'kannada', or: 'oriya', ml: 'malayalam', pa: 'gurmukhi'
  };
  (SCRIPT[lang] || '').split(' ').filter(Boolean).forEach((s) => want.add(s));
  const out = [];
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (google && m[1] && !want.has(m[1])) continue;
    const src = /url\(\s*['"]?([^'")\s]+\.woff2)['"]?\s*\)/.exec(m[2]);
    if (src) { try { out.push(new URL(src[1], base).href); } catch (e) { /* skip */ } }
  }
  return out;
}

async function pool(items, n, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const it = items[i++]; await fn(it).catch(() => false); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

// Works out the files to keep: the given ones, plus the fonts their stylesheets use.
async function fileList(hrefs, lang) {
  const cache = await caches.open(STATIC);
  const list = [...new Set(hrefs.filter(keepableFile))];
  const isCSS = (h) => /\.css(\?|$)/.test(h) || h.startsWith('https://fonts.googleapis.com/css');
  const fonts = [];
  await pool(list.filter(isCSS), 4, async (h) => {
    let res = await cache.match(h, { ignoreVary: true });
    if (!res) {
      res = await fetchFile(h).catch(() => null);
      if (res && res.ok) await serial(() => cache.put(h, res.clone()));
    }
    if (res && res.ok) fonts.push(...fontsIn(await res.text(), h, lang));
  });
  return [...new Set(list.filter((h) => !isCSS(h)).concat(fonts))];
}

async function keepFile(href) {
  const cache = await caches.open(STATIC);
  if (await cache.match(href, { ignoreVary: true })) return true;
  const res = await fetchFile(href).catch(() => null);
  if (!res || !res.ok) return false;
  await serial(() => cache.put(href, res));
  return true;
}

// Fetches and keeps a page; returns its HTML (or null).
async function keepPageFromNetwork(path) {
  const res = await fetch(abs(path), { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
  if (!res) return null;
  return keepPage(pageKey(path), res);
}

/* ---------------- downloaded courses ---------------- */

async function readDownloads(cache) { return (await readJSON(cache, DOWNLOADS_KEY)) || {}; }
async function isDownloaded(cache, courseId) { return Boolean(courseId && (await readDownloads(cache))[courseId]); }
function updateDownloads(owner, fn) {
  return serial(async () => {
    if ((await getOwner()) !== owner) return;
    const cache = await caches.open(USER + owner);
    const all = await readDownloads(cache);
    fn(all);
    await cache.put(DOWNLOADS_KEY, jsonRes(all));
  });
}

const countLessons = (course) => (course.units || []).reduce((a, u) => a + ((u && u.lessons) || []).length, 0);
// Lessons that can be studied offline: all of a sample course's (they're built in), else the written ones.
function lessonsOf(course) {
  if (course.source === 'sample') return Array.from({ length: countLessons(course) }, (_, i) => i + 1);
  return (course.written || []).filter((n) => Number.isInteger(n) && n > 0);
}

function courseData(course, lessons) {
  const id = encodeURIComponent(course.id);
  const out = [];
  lessons.forEach((n) => {
    if (course.source !== 'sample') out.push(`/api/courses/${id}/lessons/${n}`);
    out.push(`/api/notes/${id}/${n}`, `/api/doubts?course=${id}&lesson=${n}`);
  });
  return out;
}

async function keepData(owner, path) {
  const res = await fetch(abs(path), { credentials: 'same-origin', cache: 'no-store' });
  if (res.status === 404 && (path === '/api/folders' || path.endsWith('/book'))) return true; // that feature isn't on this server
  if (!res.ok) return false;
  await keepJSON(owner, abs(path), res);
  return true;
}

async function cachedLessons(cache, courseId) {
  const prefix = abs(`/api/courses/${encodeURIComponent(courseId)}/lessons/`);
  return (await cache.keys()).filter((k) => k.url.startsWith(prefix)).map((k) => Number(k.url.slice(prefix.length)));
}

async function status(courseId) {
  const u = await userCache();
  if (!u) return { downloaded: false, lessons: 0 };
  const info = (await readDownloads(u.cache))[courseId];
  if (!info) return { downloaded: false, lessons: 0 };
  return { downloaded: true, at: info.at, lessons: (await cachedLessons(u.cache, courseId)).length };
}

async function download(msg, report) {
  const owner = await getOwner();
  if (!owner) throw new Error(MSG.signin);
  const courseId = String(msg.courseId || '');
  const path = `/api/courses/${encodeURIComponent(courseId)}`;
  const res = await fetch(abs(path), { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
  if (!res) throw new Error(MSG.offline);
  const d = await res.clone().json().catch(() => null);
  if (!res.ok || !d || !d.course) throw new Error((d && d.error) || MSG.failed);
  // marked first, so everything of this course fetched from now on is kept
  await updateDownloads(owner, (all) => { all[courseId] = { at: Date.now() }; });
  await keepJSON(owner, abs(path), res);
  report({ done: 0, total: 0 });

  // the pages to study with, and the files they need
  const files = (msg.assets || []).slice(0, 200);
  for (const p of STUDY_PAGES) {
    const html = await keepPageFromNetwork(p);
    if (html) files.push(...filesIn(html, abs(p)));
  }
  if (msg.lang && msg.lang !== 'en') files.push(abs(`/assets/i18n/${msg.lang}.json`));
  files.push(abs('/manifest.webmanifest'), abs('/assets/icons/icon-192.png'), abs('/assets/icons/icon-512.png'));
  const fileJobs = await fileList(files, msg.lang);

  const id = encodeURIComponent(courseId);
  const dataJobs = ['/api/courses', '/api/folders', `/api/courses/${id}/notes`, `/api/courses/${id}/book`]
    .concat(courseData(d.course, lessonsOf(d.course)));
  const jobs = dataJobs.map((p) => () => keepData(owner, p)).concat(fileJobs.map((h) => () => keepFile(h)));
  let done = 0, failed = 0;
  const total = jobs.length;
  report({ done, total });
  await pool(jobs, 4, async (job) => {
    const ok = await job().catch(() => false);
    if (!ok) failed++;
    done++;
    report({ done, total });
  });
  return { status: await status(courseId), failed };
}

async function removeDownload(courseId) {
  const owner = await getOwner();
  if (!owner) return;
  const id = encodeURIComponent(courseId);
  const exact = abs(`/api/courses/${id}`);
  const prefixes = [abs(`/api/courses/${id}/`), abs(`/api/notes/${id}/`)];
  await serial(async () => {
    const cache = await caches.open(USER + owner);
    for (const k of await cache.keys()) {
      const u = new URL(k.url);
      if (k.url === exact || prefixes.some((p) => k.url.startsWith(p))
        || (u.pathname === '/api/doubts' && u.searchParams.get('course') === courseId)) await cache.delete(k);
    }
    const all = await readDownloads(cache);
    delete all[courseId];
    await cache.put(DOWNLOADS_KEY, jsonRes(all));
    // the photos only this course used go with it
    const keys = await cache.keys();
    const used = new Set();
    for (const k of keys) {
      if (RE.withMedia.test(new URL(k.url).pathname)) mediaIn(await readJSON(cache, k.url)).forEach((m) => used.add(m));
    }
    for (const k of keys) {
      const path = new URL(k.url).pathname;
      if (path.startsWith('/media/') && !used.has(path)) await cache.delete(k);
    }
  });
}

// Keeps downloaded courses up to date: lessons written since they were downloaded are saved too.
const lastSync = new Map();
async function syncCourses(courseId) {
  if (offlineNow()) return;
  const u = await userCache();
  if (!u) return;
  const all = await readDownloads(u.cache);
  const ids = courseId ? (all[courseId] ? [courseId] : []) : Object.keys(all);
  if (!ids.length) return;
  // the whole library was just fetched by the page; one course gets a fresh copy
  const list = courseId ? null : await readJSON(u.cache, abs('/api/courses'));
  for (const cid of ids) {
    if (Date.now() - (lastSync.get(cid) || 0) < 10000) continue;
    lastSync.set(cid, Date.now());
    let course = list ? (list.courses || []).find((c) => c.id === cid) : null;
    if (!course) {
      const path = `/api/courses/${encodeURIComponent(cid)}`;
      const res = await fetch(abs(path), { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
      if (!res) { setNet(true); return; }
      if (res.status === 404) { await removeDownload(cid); continue; } // deleted on another device
      if (!res.ok) continue;
      const d = await res.clone().json().catch(() => null);
      await keepJSON(u.owner, abs(path), res);
      course = d && d.course;
    }
    if (!course || course.source === 'sample') continue;
    const have = new Set(await cachedLessons(u.cache, cid));
    const missing = lessonsOf(course).filter((n) => !have.has(n));
    if (!missing.length) continue;
    await pool(courseData(course, missing), 3, (p) => keepData(u.owner, p).catch(() => false));
    await keepData(u.owner, `/api/courses/${encodeURIComponent(cid)}/book`).catch(() => false);
  }
}

// A page loaded before this worker took charge isn't saved yet: keep it and its files now.
async function warmPage(msg) {
  if (offlineNow() || typeof msg.page !== 'string') return;
  const path = msg.page === '/' ? '/index.html' : msg.page;
  if (!isPage(path) || NEVER_KEEP.has(abs(path))) return;
  const u = await userCache();
  if (!u || u.owner !== String(msg.user)) return;
  if (!(await u.cache.match(abs(path)))) await keepPageFromNetwork(path);
  // the library every study page starts from
  for (const p of ['/api/courses', '/api/folders']) {
    if (!(await u.cache.match(abs(p)))) await keepData(u.owner, p).catch(() => false);
  }
  const files = await fileList((msg.assets || []).slice(0, 200), msg.lang);
  await pool(files, 3, (h) => keepFile(h));
}

async function clearAll() {
  await serial(async () => {
    for (const k of await caches.keys()) if (k.startsWith('primer-')) await caches.delete(k);
  });
}

/* ---------------- events ---------------- */

self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('primer-static-') && k !== STATIC) await caches.delete(k);
    await self.clients.claim();
  })());
});

// If anything here goes wrong, a GET still goes to the network as if this worker weren't here.
const safe = (work, req) => work.catch((err) => {
  console.warn('[Primer] service worker:', err);
  return fetch(req);
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== ORIGIN) {
    if (req.method === 'GET' && isCDN(url)) event.respondWith(safe(cdnFile(event, req, url), req));
    return;
  }
  const p = url.pathname;
  // signing in and out, and the account itself, always go straight to the server
  if (p.startsWith('/api/auth/') || p === '/api/me' || p === '/api/health' || p === '/sw.js') {
    if (req.method !== 'GET' && offlineNow()) event.respondWith(offlineJSON(MSG.offline));
    return;
  }
  if (req.method === 'GET') {
    if (p.startsWith('/api/')) event.respondWith(safe(apiGet(event, req, url), req));
    else if (isPage(p)) event.respondWith(safe(page(event, req, url), req));
    else if (p.startsWith('/assets/') || p === '/manifest.webmanifest') event.respondWith(safe(siteFile(event, req), req));
    else if (p.startsWith('/media/')) event.respondWith(safe(mediaFile(req, url), req));
    return;
  }
  if (p.startsWith('/api/')) {
    const handled = apiWrite(event, req, url);
    if (handled) event.respondWith(handled);
  }
});

function classify(url) {
  const p = url.pathname;
  let m;
  if (p === '/api/courses' || p === '/api/folders') return { kind: 'list' };
  if ((m = RE.lesson.exec(p))) return { kind: 'lesson', course: m[1] };
  if ((m = RE.course.exec(p) || RE.courseNotes.exec(p) || RE.book.exec(p) || RE.notes.exec(p))) return { kind: 'course', course: m[1] };
  if (p === '/api/doubts' && url.searchParams.get('course') && url.searchParams.get('lesson')) return { kind: 'course', course: url.searchParams.get('course') };
  return { kind: 'live' };
}

async function apiGet(event, req, url) {
  const { kind, course } = classify(url);
  const u = kind === 'live' ? null : await userCache();
  const keepIt = u && (kind === 'list' || await isDownloaded(u.cache, course));
  if (!keepIt) return passThrough(event, req, kind === 'lesson' ? MSG.lesson : MSG.offline);
  const key = url.href;
  const cached = await u.cache.match(key);
  if (kind === 'lesson' && cached) {
    // a written lesson doesn't change: the saved copy now, a fresh one for next time
    if (!offlineNow()) {
      event.waitUntil(fetch(req).then((res) => (res.ok ? keepJSON(u.owner, key, res) : null)).catch(() => {}));
    }
    return cached;
  }
  // saves still waiting go first, so this answer includes them
  if (!offlineNow() && (await queuedFor(u.owner)).length) await replay().catch(() => {});
  return networkFirst(event, req, cached, {
    keep: (res) => keepJSON(u.owner, key, res),
    fallback: () => offlineJSON(kind === 'lesson' ? MSG.lesson : MSG.offline)
  });
}

function apiWrite(event, req, url) {
  const p = url.pathname;
  if ((req.method === 'PUT' && (RE.progress.test(p) || RE.notes.test(p))) || (req.method === 'POST' && p === '/api/mistakes')) {
    return queueable(event, req, url);
  }
  if (offlineNow()) return Promise.resolve(offlineJSON(p === '/api/lesson' ? MSG.write : MSG.offline));
  const m = req.method === 'DELETE' ? RE.course.exec(p) : null;
  if (m) {
    return fetch(req).then((res) => {
      if (res.ok) event.waitUntil(removeDownload(decodeURIComponent(m[1])).catch(() => {}));
      return res;
    });
  }
  return null;
}

// Progress, notes and wrong answers: sent now if possible, otherwise kept and sent later.
async function queueable(event, req, url) {
  const body = await req.clone().text();
  const owner = await getOwner();
  const put = req.method === 'PUT';
  const item = {
    key: put ? 'PUT ' + url.pathname : 'POST ' + url.pathname + ' ' + Date.now().toString(36) + Math.random().toString(36).slice(2),
    method: req.method, url: url.pathname, body, type: req.headers.get('Content-Type') || 'application/json',
    user: owner, at: Date.now()
  };
  if (owner) await applyLocal(owner, item).catch(() => {});
  if (!offlineNow()) {
    if (replaying) await replaying.catch(() => {}); // an older copy of this save may be on its way: let it land first
    if (put) await qDelete(item.key);              // this save replaces any older one still waiting
    try {
      const res = await fetch(req);
      if (!isGateway(res.status)) { setNet(false, event); return res; }
    } catch (e) { /* no connection: keep it for later */ }
  }
  setNet(true);
  await qPut(item);
  broadcast({ type: 'queued' });
  return jsonRes({ ok: true, queued: true, updatedAt: item.at });
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  const port = event.ports && event.ports[0];
  const reply = (v) => { if (port) port.postMessage(v); };
  const work = (async () => {
    // A page that has just loaded says who's signed in, which counts only while nobody is known
    // (this worker started after the page loaded); after that the server's pages decide.
    if (msg.type === 'hello' && msg.user != null && !(await getOwner())) await setOwner(msg.user, msg.lang);
    switch (msg.type) {
      case 'hello':
        await warmPage(msg).catch(() => {});
        return { down, queued: offlineNow() ? (await qAll()).length : await replay(true) };
      case 'flush': return { queued: await replay(true) };
      case 'download': return download(msg, (p) => reply({ progress: p }));
      case 'status': return status(String(msg.courseId || ''));
      case 'downloads': { const u = await userCache(); return u ? Object.keys(await readDownloads(u.cache)) : []; }
      case 'remove': await removeDownload(String(msg.courseId || '')); return status(String(msg.courseId || ''));
      case 'sync': await syncCourses(msg.courseId ? String(msg.courseId) : null); return true;
      case 'clear': await clearAll(); return true;
      default: return null;
    }
  })();
  event.waitUntil(work.then((result) => reply({ ok: true, result }), (err) => reply({ ok: false, error: (err && err.message) || String(err) })));
});

self.addEventListener('sync', (event) => {
  if (event.tag !== 'primer-sync') return;
  event.waitUntil(replay(true).then((left) => { if (left > 0) throw new Error('Saves are still waiting.'); }));
});
