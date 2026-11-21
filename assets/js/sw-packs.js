/* =====================================================================
   Course files opened with no internet: the service worker's part
   (loaded by sw.js with importScripts; the format is packfmt.js, the
   page side packs.js, the server side server/packs.mjs).

   A learner who is signed in on this device can open a course file
   while offline. The file is checked here exactly as the server checks
   it, then the course is laid out in the learner's cache the way a
   downloaded course is (the course, its lessons, Watch mode's
   narration, empty notes and doubts, the photos and recordings), added
   to the library, and marked downloaded, so app.html and lesson.html
   open it at once. The file itself waits in IndexedDB (primer-packs)
   and is sent to the server when the connection is back, before any
   progress saved meanwhile (sw.js's replay asks this first), under the
   id it was given here, so those saves still fit. If the server turns
   it away, it comes off this device and the page says why.

   Signing in once while online is what makes this possible: the pages
   and files a course needs are kept then ('shell', asked for by
   packs.js on the library page).
   ===================================================================== */
'use strict';

(function () {
  const F = self.PrimerPackFormat;
  const PACK_MSG = {
    signin: 'Sign in to Primer while you’re online once, then you can open course files with no internet.',
    unsupported: 'This browser can’t open course files with no internet. Open the file while you’re online.'
  };

  /* ---------------- the waiting files (IndexedDB) ---------------- */

  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open('primer-packs', 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('packs')) r.result.createObjectStore('packs', { keyPath: 'id' }); };
        r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; resolve(d); };
        r.onerror = () => { dbp = null; reject(r.error); };
      });
    }
    return dbp;
  }
  function store(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction('packs', mode);
      const req = fn(t.objectStore('packs'));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  const allPacks = () => store('readonly', (s) => s.getAll()).then((a) => a || []).catch(() => []);
  const putPack = (p) => store('readwrite', (s) => s.put(p));
  const delPack = (id) => store('readwrite', (s) => s.delete(id));

  /* ---------------- reading a file here ---------------- */

  async function inflate(bytes, size) {
    if (typeof DecompressionStream !== 'function') throw new F.PackError('noDeflate');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const out = new Uint8Array(size);
    let off = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (off + value.length > size) { reader.cancel().catch(() => {}); throw new F.PackError('damaged'); }
      out.set(value, off);
      off += value.length;
    }
    if (off !== size) throw new F.PackError('damaged');
    return out;
  }
  async function sha256(bytes) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    let s = '';
    for (let i = 0; i < d.length; i++) s += d[i].toString(16).padStart(2, '0');
    return s;
  }
  const io = { inflate, sha256 };

  // the same kind of id the server gives a course
  function newId() {
    const r = crypto.getRandomValues(new Uint8Array(5));
    return Date.now().toString(36) + Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const toSite = (src) => (typeof src === 'string' && /^media\/[a-f0-9]{32}\.(?:jpg|png|webp|gif)$/.test(src) ? '/' + src : src);

  // Watch mode's answer for a lesson: the narration that came with the file (sw.js keeps these for downloads).
  function videosAnswer(lang, n, lesson, pack) {
    const nar = (pack.narration.find((x) => x.n === n) || { sections: [] }).sections;
    const parts = lesson.sections.map((s, i) => {
      const w = (nar.find((x) => x.i === i) || {}).watch;
      if (!w) return { i, title: String(s.title || '').slice(0, 90), script: '', segments: [] };
      return {
        i, title: String(s.title || '').slice(0, 90), script: w.script,
        segments: w.segments.map((g) => (g.src ? Object.assign({}, g, { src: toSite(g.src) }) : g)),
        url: '/' + w.file, words: w.words
      };
    });
    return {
      ok: true,
      youtube: { configured: false, status: 'off', query: null, pickedBy: null, videos: [] },
      signed: null, narration: { [lang]: parts }, voice: false
    };
  }

  async function importHere(msg) {
    const owner = await getOwner();
    if (!owner || (msg.user != null && String(msg.user) !== owner)) throw new Error(PACK_MSG.signin);
    if (!self.crypto || !crypto.subtle || !self.indexedDB) throw new Error(PACK_MSG.unsupported);
    const bytes = new Uint8Array(msg.data);
    const pack = await F.read(bytes, io);
    const id = newId();
    const t = Date.now();
    const lang = pack.course.lang || 'en';
    pack.lessons.forEach(({ lesson }) => lesson.sections.forEach((s) => s.blocks.forEach((b) => { if (b.t === 'photo' && b.src) b.src = toSite(b.src); })));
    const course = Object.assign({}, pack.course, {
      title: pack.course.title || pack.course.topic, topic: pack.course.topic || pack.course.title,
      source: pack.course.source === 'library' ? 'ai' : pack.course.source,
      id, folderId: null, createdAt: t, openedAt: t, lastLesson: null,
      written: pack.lessons.map((l) => l.n), progress: {},
      pack: { from: 'file', at: t, made: pack.manifest.made, local: true }
    });
    if (course.cover) course.cover = Object.assign({}, course.cover, { src: toSite(course.cover.src) });

    const cache = await caches.open(USER + owner);
    const put = (p, data) => cache.put(abs(p), jsonRes(data));
    // photos and recordings first, so the lessons that show them work at once
    for (const [name, m] of pack.media) {
      await cache.put(abs('/' + name), new Response(new Blob([m.bytes], { type: m.type }), { headers: { 'Content-Type': m.type, 'Content-Length': String(m.bytes.length) } }));
    }
    for (const [name, a] of pack.audio) {
      await cache.put(abs('/' + name), new Response(new Blob([a], { type: 'audio/mpeg' }), { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(a.length) } }));
    }
    const cid = encodeURIComponent(id);
    for (const { n, lesson } of pack.lessons) {
      await put(`/api/courses/${cid}/lessons/${n}`, { ok: true, lesson, model: null });
      await put(`/api/courses/${cid}/lessons/${n}/videos`, videosAnswer(lang, n, lesson, pack));
      await put(`/api/notes/${cid}/${n}`, { ok: true, text: '', sketch: null, updatedAt: null });
      await put(`/api/doubts?course=${cid}&lesson=${n}`, { ok: true, doubts: [] });
    }
    await put(`/api/courses/${cid}/notes`, { ok: true, notes: [] });
    await put(`/api/courses/${cid}`, { ok: true, course });
    await serial(async () => {
      const key = abs('/api/courses');
      const list = (await readJSON(cache, key)) || { ok: true, courses: [] };
      list.courses = [course].concat((list.courses || []).filter((c) => c.id !== id));
      await cache.put(key, jsonRes(list));
    });
    await updateDownloads(owner, (all) => { all[id] = { at: t, local: true }; });
    await putPack({ id, user: owner, at: t, title: course.title, size: bytes.length, file: new Blob([bytes], { type: 'application/octet-stream' }) });
    return { courseId: id, title: course.title, lessons: pack.lessons.length, local: true };
  }

  /* ---------------- sending them to the server ---------------- */

  // A course the server gave another id (the one made here was taken): its waiting saves follow it.
  async function moveSaves(from, to) {
    for (const it of await qAll()) {
      if (!it.url.includes('/' + from + '/') && !it.url.endsWith('/' + from)) continue;
      const url = it.url.split('/' + from).join('/' + to);
      await qDelete(it.key, it.at);
      await qPut(Object.assign({}, it, { url, key: it.key.split('/' + from).join('/' + to) }));
    }
  }
  async function dropSaves(courseId) {
    for (const it of await qAll()) if (it.url.includes('/' + courseId + '/') || it.url.endsWith('/' + courseId)) await qDelete(it.key, it.at);
  }
  async function dropFromList(owner, courseId) {
    await serial(async () => {
      const cache = await caches.open(USER + owner);
      const key = abs('/api/courses');
      const list = await readJSON(cache, key);
      if (!list) return;
      list.courses = (list.courses || []).filter((c) => c.id !== courseId);
      await cache.put(key, jsonRes(list));
    });
  }

  // Sends this learner's waiting files, oldest first. Returns false when one has to wait (no connection).
  async function upload(uid) {
    const mine = (await allPacks()).filter((p) => p.user === uid).sort((a, b) => a.at - b.at);
    for (const p of mine) {
      let res;
      try {
        res = await fetch(abs('/api/packs?id=' + encodeURIComponent(p.id)), {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: p.file, credentials: 'same-origin'
        });
      } catch (e) { return false; }
      if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) return false;
      const d = await res.json().catch(() => null);
      if (res.ok && d && d.course) {
        const to = d.course.id;
        if (to !== p.id) {
          await moveSaves(p.id, to);
          await removeDownload(p.id);
          await dropFromList(uid, p.id);
        }
        await updateDownloads(uid, (all) => { delete all[p.id]; all[to] = { at: Date.now() }; });
        await keepJSON(uid, abs('/api/courses/' + encodeURIComponent(to)), jsonRes({ ok: true, course: d.course }));
        await serial(async () => {
          const cache = await caches.open(USER + uid);
          const key = abs('/api/courses');
          const list = await readJSON(cache, key);
          if (!list) return;
          list.courses = [d.course].concat((list.courses || []).filter((c) => c.id !== to && c.id !== p.id));
          await cache.put(key, jsonRes(list));
        });
        await delPack(p.id);
        if (to !== p.id) syncCourses(to).catch(() => {});
        broadcast({ type: 'pack', ok: true, title: p.title, courseId: to, from: p.id });
      } else {
        // turned away for good (damaged, refused): it comes off this device
        await removeDownload(p.id);
        await dropFromList(uid, p.id);
        await dropSaves(p.id);
        await delPack(p.id);
        broadcast({ type: 'pack', ok: false, title: p.title, from: p.id, error: (d && d.error) || '' });
      }
    }
    return true;
  }

  async function waiting(owner) {
    const all = await allPacks();
    return all.filter((p) => !owner || p.user === owner).length;
  }

  // The study pages and their files, kept the first time the library is opened online.
  async function keepShell(msg) {
    if (offlineNow()) return false;
    const u = await userCache();
    if (!u || (msg.user != null && String(msg.user) !== u.owner)) return false;
    const files = (msg.assets || []).slice(0, 200);
    for (const p of STUDY_PAGES) {
      if (await u.cache.match(abs(p))) continue;
      const html = await keepPageFromNetwork(p);
      if (html) files.push(...filesIn(html, abs(p)));
    }
    if (msg.lang && msg.lang !== 'en') files.push(abs(`/assets/i18n/${msg.lang}.json`));
    const list = await fileList(files, msg.lang);
    await pool(list, 3, (h) => keepFile(h));
    return true;
  }

  self.PrimerPacks = {
    waiting,
    upload,
    // the page's requests: { op: 'import' | 'shell' | 'waiting' }
    handle(msg) {
      if (msg.op === 'import') return importHere(msg);
      if (msg.op === 'shell') return keepShell(msg);
      if (msg.op === 'waiting') return getOwner().then((o) => waiting(o));
      return Promise.resolve(null);
    }
  };
})();
