/* =====================================================================
   Primer offline: the page side of the service worker (assets/js/sw.js).

   - Registers /sw.js and tells it who is signed in, so it keeps this
     learner's pages and data apart from anyone else's on the device.
   - P.offline.mountCourse(el, course): "Download for offline" on a
     course's page, its progress, "Available offline · N lessons", and
     removing the download.
   - A quiet banner while there's no connection, and a note once saves
     made offline have reached the account. Saves themselves wait in the
     service worker (IndexedDB), so they survive closing the page.
   - Signing out sends waiting saves first, then clears everything
     Primer kept on this device (shared phones).
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  const user = P.boot.user;
  const sw = ('serviceWorker' in navigator) && window.caches && window.isSecureContext ? navigator.serviceWorker : null;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const MSG = {
    banner: 'You’re offline. Downloaded courses still work, and your progress will sync when you’re back.',
    synced: 'You’re back online. Your progress and notes are saved to your account.',
    unsupported: window.isSecureContext === false
      ? 'Offline use needs a secure (https) connection to Primer.'
      : 'This browser can’t keep courses for offline use.',
    slow: 'The browser took too long to answer. Try again.',
    failed: 'Something went wrong. Try again.',
    needNet: 'You’re offline. Connect to the internet to download this course.',
    signOutOffline: 'You’re offline. Connect to the internet to sign out.'
  };

  const ICON_DOWN = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>';
  const ICON_SAVED = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.4c-2.3-1.7-5.3-2-8.2-1.2v12c2.9-.8 5.9-.5 8.2 1.2 2.3-1.7 5.3-2 8.2-1.2v-12c-2.9-.8-5.9-.5-8.2 1.2z"/><path d="M9 11.6l2 2 4-4"/></svg>';
  const ICON_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 18.5h9.8a3.7 3.7 0 0 0 .9-7.3A5.6 5.6 0 0 0 8 8.6a4.6 4.6 0 0 0-.5 9.9z"/><path d="M4 4l16 16"/></svg>';

  /* ---------- the service worker ---------- */
  let ready = null;
  if (sw) {
    ready = sw.register('/sw.js', { scope: '/' })
      .then(() => sw.ready)
      .catch((err) => { console.warn('[Primer] Offline use is off:', err.message); return null; });
  }

  // Asks the service worker something; `onProgress` gets its progress reports.
  // `idle` is how long to wait with no word from it.
  function ask(type, data, onProgress, idle = 15000) {
    if (!ready) return Promise.reject(new Error(MSG.unsupported));
    return ready.then((reg) => new Promise((resolve, reject) => {
      const target = (reg && reg.active) || (sw && sw.controller);
      if (!target) { reject(new Error(MSG.unsupported)); return; }
      const ch = new MessageChannel();
      let timer = 0;
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => { ch.port1.close(); reject(new Error(MSG.slow)); }, idle); };
      ch.port1.onmessage = (e) => {
        const d = e.data || {};
        if (d.progress) { arm(); if (onProgress) onProgress(d.progress); return; }
        clearTimeout(timer);
        ch.port1.close();
        if (d.ok) resolve(d.result); else reject(new Error(d.error || MSG.failed));
      };
      arm();
      target.postMessage(Object.assign({ type, user: user ? user.id : null, lang: P.lang || 'en' }, data || {}), [ch.port2]);
    }));
  }

  // The scripts, stylesheets and dictionary this page uses, so the worker can keep them.
  function pageFiles() {
    const out = new Set();
    $$('script[src], link[rel="stylesheet"][href], link[rel="manifest"][href], link[rel="apple-touch-icon"][href]').forEach((el) => {
      try { out.add(new URL(el.getAttribute('src') || el.getAttribute('href'), location.href).href); } catch (e) { /* not a URL */ }
    });
    if (P.lang && P.lang !== 'en') out.add(new URL(`assets/i18n/${P.lang}.json`, location.href).href);
    return Array.from(out);
  }

  /* ---------- the offline banner ---------- */
  let swDown = false;
  let banner = null;
  let wasOffline = false;
  let ping = 0;
  const isOffline = () => navigator.onLine === false || swDown;

  function placeBanner() {
    banner = document.createElement('div');
    banner.className = 'offline-bar';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `${ICON_OFF}<span>${MSG.banner}</span>`;
    const bar = $('.lbar');
    const page = $('.page');
    if (bar) bar.after(banner);
    else if (page) page.prepend(banner);
    else document.body.prepend(banner);
  }

  function renderNet() {
    const off = isOffline();
    document.documentElement.classList.toggle('is-offline', off);
    if (off && !banner && document.body) placeBanner();
    if (banner) banner.hidden = !off;
    // someone reading further down the page wouldn't see the banner appear
    if (off && !wasOffline && document.readyState !== 'loading' && window.scrollY > 120) P.toast(MSG.banner);
    wasOffline = off;
    // the browser thinks it's online but the server didn't answer: check now and then
    clearInterval(ping);
    if (swDown && navigator.onLine !== false) {
      ping = setInterval(() => {
        fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' }).then((r) => {
          if (!r.ok) return;
          swDown = false;
          renderNet();
          flush();
        }).catch(() => {});
      }, 15000);
    }
  }

  function flush() {
    if (!ready || !user) return;
    ask('flush', {}, null, 30000).catch(() => {});
  }

  // Background Sync sends waiting saves when the connection comes back, even with the page closed.
  // (While the page is open and only the server is unreachable, the health check above does it.)
  function registerSync() {
    if (!ready || navigator.onLine !== false) return;
    ready.then((reg) => (reg && reg.sync ? reg.sync.register('primer-sync') : null)).catch(() => {});
  }

  addEventListener('online', () => { swDown = false; renderNet(); flush(); });
  addEventListener('offline', renderNet);
  if (sw) {
    sw.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'net') { swDown = Boolean(d.down); renderNet(); }
      else if (d.type === 'synced') P.toast(MSG.synced);
      else if (d.type === 'queued') registerSync();
    });
    sw.startMessages();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderNet);
  else renderNet();

  /* ---------- say hello once the page has loaded ---------- */
  const courseParam = P.params.get('course');
  if (ready) {
    addEventListener('load', () => setTimeout(() => {
      ask('hello', { page: location.pathname, assets: user ? pageFiles() : [] }, null, 60000).then((r) => {
        if (r && r.down && !swDown) { swDown = true; renderNet(); }
        if (r && r.queued > 0) registerSync();
        if (user && navigator.onLine !== false) ask('sync', { courseId: courseParam }, null, 60000).catch(() => {});
      }).catch(() => {});
    }, 1200));
  }

  // Leaving a lesson: lessons written while it was open are saved into its download.
  let signingOut = false;
  const syncOnLeave = () => {
    if (signingOut || !user || !courseParam || navigator.onLine === false || !sw || !sw.controller) return;
    sw.controller.postMessage({ type: 'sync', courseId: courseParam, user: user.id, lang: P.lang || 'en' });
  };
  addEventListener('pagehide', syncOnLeave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) syncOnLeave(); });

  /* ---------- signing out clears this device ---------- */
  if (P.auth && typeof P.auth.signOut === 'function') {
    const signOut = P.auth.signOut;
    P.auth.signOut = async function () {
      if (navigator.onLine === false) { P.toast(MSG.signOutOffline, 'error'); return undefined; }
      signingOut = true;
      if (ready) {
        // saves still waiting go first; any that can't be sent wait for this learner's next sign-in
        await ask('flush', {}, null, 8000).catch(() => {});
        await ask('clear', {}, null, 8000).catch(() => {});
      }
      try {
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.filter((k) => k.startsWith('primer-')).map((k) => caches.delete(k)));
        }
      } catch (e) { /* storage blocked */ }
      return signOut.apply(this, arguments);
    };
  }

  /* ---------- "Download for offline" on a course's page ---------- */
  function mountCourse(slot, course) {
    if (!slot || !course) return;
    slot.classList.add('offline-dl', 'noprint');
    if (!ready) {
      slot.innerHTML = `<p class="offline-dl__note">${MSG.unsupported}</p>`;
      return;
    }
    const total = P.courseGen.count(course);
    const sample = course.source === 'sample';
    const writtenNow = () => (sample ? total : ((P.courses.get(course.id) || course).written || []).length);
    let state = null; // { downloaded, lessons } once the worker answers
    let busy = null;  // { done, total } while downloading

    function paint() {
      const w = writtenNow();
      if (busy) {
        const pct = busy.total ? Math.round((busy.done / busy.total) * 100) : 0;
        slot.innerHTML = `
          <div class="offline-dl__row">
            <button class="btn btn--ghost btn--small" type="button" disabled>${ICON_DOWN}<span>Downloading…</span></button>
            <span class="offline-dl__count" role="status">${busy.total ? `Saving ${busy.done} of ${busy.total}…` : 'Getting ready…'}</span>
          </div>
          <div class="bar offline-dl__bar" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>`;
        return;
      }
      if (!state) { slot.innerHTML = ''; return; }
      const missingNote = !sample && w < total
        ? `<p class="offline-dl__note">Lessons not written yet need the internet: the AI writes each one the first time you open it.</p>`
        : '';
      if (state.downloaded) {
        const n = sample ? total : state.lessons;
        slot.innerHTML = `
          <div class="offline-dl__row">
            <p class="offline-dl__status">${ICON_SAVED}<span>Available offline · ${plural(n, 'lesson')}</span></p>
            <button class="textlink" type="button" data-remove>Remove download</button>
          </div>
          ${missingNote}
          ${!sample && n < total ? '<p class="offline-dl__note">Lessons you open while online are added to the download.</p>' : ''}`;
        return;
      }
      slot.innerHTML = `
        <div class="offline-dl__row">
          <button class="btn btn--ghost btn--small" type="button" data-download>${ICON_DOWN}<span>Download for offline</span></button>
        </div>
        <p class="offline-dl__note">Saves this course on this device, so you can study it with no internet.</p>
        ${!sample && w < total ? `<p class="offline-dl__note">${w} of ${total} lessons are written. Lessons not written yet need the internet: the AI writes each one the first time you open it.</p>` : ''}`;
    }

    async function start(btn) {
      if (navigator.onLine === false) { P.toast(MSG.needNet, 'error'); return; }
      busy = { done: 0, total: 0 };
      paint();
      try {
        const r = await ask('download', { courseId: course.id, assets: pageFiles() }, (p) => { busy = p; paint(); }, 60000);
        state = r.status;
        busy = null;
        paint();
        if (r.failed) P.toast('Some parts didn’t download. Try again when the connection is better.', 'error');
        else P.toast('This course now works offline.');
        markShelves();
      } catch (err) {
        busy = null;
        paint();
        P.toast('The download didn’t finish: ' + err.message, 'error');
      }
      const again = slot.querySelector('[data-download], [data-remove]');
      if (again && btn && document.activeElement === document.body) again.focus();
    }

    async function remove() {
      try {
        state = await ask('remove', { courseId: course.id });
        paint();
        P.toast('Removed the download. The course is still in your account.');
        const b = slot.querySelector('[data-download]');
        if (b) b.focus();
      } catch (err) {
        P.toast('Couldn’t remove the download: ' + err.message, 'error');
      }
    }

    slot.addEventListener('click', (e) => {
      if (e.target.closest('[data-download]')) start(e.target.closest('[data-download]'));
      else if (e.target.closest('[data-remove]')) remove();
    });

    ask('status', { courseId: course.id }).then((s) => { state = s; paint(); })
      .catch(() => { state = { downloaded: false, lessons: 0 }; paint(); });
  }

  /* ---------- "Available offline" on the library's course cards ---------- */
  let shelfIds = null;
  let shelfWatch = null;
  function applyShelves(root) {
    $$('.ccard[data-course]', root).forEach((card) => {
      const on = shelfIds.has(card.dataset.course);
      const badge = card.querySelector('.ccard__offline');
      if (on && !badge) {
        const b = document.createElement('p');
        b.className = 'ccard__offline';
        b.innerHTML = `${ICON_SAVED}<span>Available offline</span>`;
        const meta = card.querySelector('.ccard__meta');
        if (meta) meta.before(b); else card.appendChild(b);
      } else if (!on && badge) badge.remove();
    });
  }
  function markShelves() {
    const root = $('#shelves');
    if (!root || !ready || !user) return;
    ask('downloads').then((ids) => {
      shelfIds = new Set(ids || []);
      applyShelves(root);
      if (!shelfWatch) {
        shelfWatch = new MutationObserver(() => applyShelves(root));
        shelfWatch.observe(root, { childList: true, subtree: true });
      }
    }).catch(() => {});
  }
  if (ready && user) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markShelves);
    else markShelves();
  }

  P.offline = {
    supported: Boolean(ready),
    mountCourse,
    flush,
    isOffline
  };
})();
