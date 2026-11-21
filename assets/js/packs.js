/* =====================================================================
   Course files on app.html: "one download, the whole village learns".

   - P.packs.mountCourse(slot, course): "Share as a file" on a course's
     page. It says what the file will hold and how large it is (with a
     warning for phones, and the narration left out on request), makes
     it on the server, then offers the share sheet where the browser can
     share files, or saves it, to send by WhatsApp, Bluetooth or a cable.
     A course that came from a file says so.
   - P.packs.mountLibrary(): "Open a course file" in the library. The
     file is read and checked here first (assets/js/packfmt.js), so the
     learner sees what's in it before adding it; the server checks it
     again and keeps it. With no internet it is opened on this device by
     the service worker (assets/js/sw-packs.js) and joins the account
     once the connection is back.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const F = window.PrimerPackFormat;
  const $ = P.$, esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  // interface text with numbers in it: the dictionary has the sentence with {placeholders}
  const tf = (s, vars) => t(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  const MB = 1024 * 1024;
  const size = (n) => (n >= MB ? `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const LIMIT = (P.boot.packs && P.boot.packs.limit) || (F ? F.LIMITS.file : 64 * MB);
  const WARN = (P.boot.packs && P.boot.packs.warn) || 20 * MB;
  const online = () => navigator.onLine !== false && !(P.offline && P.offline.isOffline && P.offline.isOffline());

  const ICON_FILE = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9.5 14.5L12 17l2.5-2.5"/></svg>';
  const ICON_SHARE = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>';
  const ICON_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /* ---------- reading a file in the page ---------- */
  async function inflate(bytes, n) {
    if (typeof DecompressionStream !== 'function') throw new F.PackError('noDeflate');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const out = new Uint8Array(n);
    let off = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (off + value.length > n) { reader.cancel().catch(() => {}); throw new F.PackError('damaged'); }
      out.set(value, off);
      off += value.length;
    }
    if (off !== n) throw new F.PackError('damaged');
    return out;
  }
  async function sha256(bytes) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const canCheck = () => Boolean(F && window.crypto && crypto.subtle);

  /* ---------- a dialog, like the class dialogs ---------- */
  let dialogN = 0;
  function dialog(title, bodyHTML) {
    const id = `pkdialog-${++dialogN}`;
    const dlg = document.createElement('dialog');
    dlg.className = 'cdialog pkdialog';
    dlg.setAttribute('aria-labelledby', `${id}-title`);
    dlg.innerHTML = `
      <button class="cdialog__x" type="button" data-close aria-label="Close">${ICON_X}</button>
      <h2 class="cdialog__title" id="${id}-title">${esc(title)}</h2>
      <div class="cdialog__body" aria-live="polite">${bodyHTML}</div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') && !dlg.dataset.busy) dlg.close();
    });
    dlg.addEventListener('cancel', (e) => { if (dlg.dataset.busy) e.preventDefault(); });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
  }
  const body = (dlg) => dlg.querySelector('.cdialog__body');

  /* ---------- "Open a course file" ---------- */
  function mountLibrary() {
    const head = $('.library__head');
    if (!head || head.querySelector('.pack-open')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost btn--small pack-open';
    b.setAttribute('aria-haspopup', 'dialog');
    b.innerHTML = `${ICON_FILE}<span>Open a course file</span>`;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.primer,.zip,application/zip,application/octet-stream';
    input.hidden = true;
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    const before = head.querySelector('#folder-new-btn');
    head.insertBefore(b, before || null);
    head.appendChild(input);
    b.addEventListener('click', () => { input.value = ''; input.click(); });
    input.addEventListener('change', () => { if (input.files && input.files[0]) openFile(input.files[0], b); });
    keepShell();
  }

  function summary(pack) {
    const c = pack.course;
    const parts = pack.narration.reduce((a, x) => a + x.sections.length, 0);
    const lang = c.lang || 'en';
    const langName = P.COURSE_LANGS && P.COURSE_LANGS[lang] ? P.COURSE_LANGS[lang].name : lang;
    const rows = [
      `<li>${esc(tf('{n} of {total} lessons written', { n: pack.lessons.length, total: pack.outline }))}</li>`,
      pack.media.size ? `<li>${esc(tf(pack.media.size === 1 ? '1 photo, with its credit' : '{n} photos, with their credits', { n: pack.media.size }))}</li>` : '',
      parts ? `<li>${esc(tf(parts === 1 ? 'Narration for 1 part' : 'Narration for {n} parts', { n: parts }))}</li>` : '',
      `<li>${esc(tf('In {lang}', { lang: langName }))} · ${esc(size(pack.size))}</li>`
    ].join('');
    const note = pack.lessons.length < pack.outline && c.source !== 'sample'
      ? `<p class="pkdialog__note">${esc(t('Lessons not written yet are written the first time you open them with internet.'))}</p>` : '';
    return `<p class="cdialog__lead"><strong class="ugc" lang="${esc(lang)}">${esc(c.title || c.topic)}</strong></p>
      <ul class="cdialog__have pkdialog__have">${rows}</ul>${note}`;
  }

  async function openFile(file, opener) {
    const dlg = dialog(t('Open a course file'), `<p class="cdialog__state" role="status">${esc(t('Checking the file…'))}</p>`);
    const done = () => { if (opener) opener.focus({ preventScroll: true }); };
    dlg.addEventListener('close', done);
    const showError = (msg) => {
      body(dlg).innerHTML = `<p class="cdialog__state is-closed" role="alert">${esc(t(msg))}</p>
        <div class="cdialog__actions"><button class="btn btn--small" type="button" data-close>Close</button></div>`;
    };
    if (file.size > LIMIT) { showError(F ? F.MSG.tooLarge : 'This course file is too large to open.'); return; }
    let bytes, pack = null;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      if (canCheck()) pack = await F.read(bytes, { inflate, sha256 });
    } catch (err) {
      if (!(F && err instanceof F.PackError && err.code === 'noDeflate' && online())) {
        showError(err && err.name === 'PackError' ? err.message : 'This course file couldn’t be read.');
        return;
      }
      pack = null; // this browser can't unpack it, but the server can
    }
    const intro = pack ? summary(pack) : `<p class="cdialog__lead">${esc(file.name)} · ${esc(size(file.size))}</p><p class="pkdialog__note">${esc(t('Primer checks the file as it adds it.'))}</p>`;
    const offlineNote = online() ? '' : `<p class="pkdialog__note">${esc(t('You’re offline. The course opens on this device now and joins your account when you’re back online.'))}</p>`;
    body(dlg).innerHTML = `${intro}${offlineNote}
      <div class="cdialog__actions">
        <button class="btn btn--small" type="button" data-add>Add to my courses</button>
        <button class="textlink" type="button" data-close>Cancel</button>
      </div>
      <p class="pkdialog__err" role="alert"></p>`;
    body(dlg).querySelector('[data-add]').focus();
    body(dlg).querySelector('[data-add]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      dlg.dataset.busy = '1';
      const err = body(dlg).querySelector('.pkdialog__err');
      err.textContent = '';
      btn.textContent = t('Adding the course…');
      try {
        const out = await add(file, bytes, pack);
        delete dlg.dataset.busy;
        if (out.local) P.toast(tf('“{title}” is on this device. It joins your account when you’re back online.', { title: out.title }));
        else P.toast(tf('“{title}” is in your courses.', { title: out.title }));
        location.href = 'app.html?course=' + encodeURIComponent(out.courseId);
      } catch (e2) {
        delete dlg.dataset.busy;
        btn.disabled = false;
        btn.textContent = t('Add to my courses');
        err.textContent = t(e2.message || 'The course couldn’t be added.');
      }
    });
  }

  // Online: the server checks and keeps it. Offline (or the server can't be reached): the service worker.
  async function add(file, bytes, pack) {
    if (online()) {
      let res = null;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 180000);
        res = await fetch('/api/packs', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file, credentials: 'same-origin', signal: ctrl.signal });
        clearTimeout(timer);
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('The server took too long to add the course. Try again.');
        res = null; // no connection after all
      }
      if (res && !(res.status >= 502 && res.status <= 504)) {
        const d = await res.json().catch(() => null);
        if (!res.ok || !d || !d.ok) throw new Error((d && d.error) || `The server answered with an error (${res.status}).`);
        P.courses.put(d.course);
        return { courseId: d.course.id, title: d.course.title, local: false };
      }
    }
    if (!pack) throw new Error('You’re offline. Connect to the internet to add this course.');
    if (!P.offline || !P.offline.supported || !P.offline.ask) throw new Error('You’re offline, and this browser can’t keep courses on the device. Connect to the internet to add this course.');
    const copy = bytes.slice().buffer;
    return P.offline.ask('pack', { op: 'import', data: copy }, null, 120000);
  }

  // The study pages kept on this device, so a course opened from a file works with no internet.
  function keepShell() {
    if (!P.offline || !P.offline.supported || !P.offline.ask || !online()) return;
    if (P.session.get('primer.packs.shell', 0) > Date.now() - 6 * 3600e3) return;
    addEventListener('load', () => setTimeout(() => {
      P.offline.ask('pack', { op: 'shell', assets: P.offline.pageFiles ? P.offline.pageFiles() : [] }, null, 90000)
        .then((ok) => { if (ok) P.session.set('primer.packs.shell', Date.now()); }).catch(() => {});
    }, 4000));
  }

  /* ---------- "Share as a file" on a course's page ---------- */
  function mountCourse(slot, course) {
    if (!slot || !course) return;
    slot.classList.add('pack', 'noprint');
    const view = slot.closest('#view-course') || document;
    // a course that came from a file says so
    if (course.pack && course.pack.from === 'file') {
      const meta = view.querySelector('.course-head__meta');
      const note = document.createElement('p');
      note.className = 'course-head__note pack-from';
      note.innerHTML = `${ICON_FILE}<span></span>`;
      let when = '';
      try { when = course.pack.made ? new Date(course.pack.made).toLocaleDateString(P.lang || 'en', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; } catch (e) { when = ''; }
      note.querySelector('span').textContent = course.pack.local
        ? t('Opened from a course file on this device. It joins your account when you’re back online.')
        : when ? tf('Shared from a file made on {date}.', { date: when }) : t('Shared from a file.');
      if (meta) meta.after(note);
      // only on this device until it reaches the account: its download can't be removed meanwhile
      if (course.pack.local) slot.closest('.course-head').classList.add('is-local-pack');
    }
    const actions = view.querySelector('.course-head__actions');
    if (!actions || course.pack && course.pack.local) return; // the server makes the file; this one isn't there yet
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'textlink';
    b.dataset.packShare = '';
    b.setAttribute('aria-expanded', 'false');
    b.textContent = 'Share as a file';
    const delBtn = actions.querySelector('[data-delete]');
    actions.insertBefore(b, delBtn || null);
    let open = false;
    b.addEventListener('click', () => {
      open = !open;
      b.setAttribute('aria-expanded', String(open));
      if (!open) { slot.innerHTML = ''; return; }
      sharePanel(slot, course, () => { open = false; b.setAttribute('aria-expanded', 'false'); slot.innerHTML = ''; b.focus(); });
    });
  }

  async function sharePanel(slot, course, close) {
    slot.innerHTML = `<div class="pack-share"><p class="pack-share__status" role="status">${esc(t('Working out what goes in the file…'))}</p></div>`;
    if (!online()) {
      slot.innerHTML = `<div class="pack-share"><p class="pack-share__status">${esc(t('Making a course file needs the internet. Connect, then try again.'))}</p></div>`;
      return;
    }
    let info;
    try {
      info = await P.get(`/api/courses/${encodeURIComponent(course.id)}/pack/info`, { timeout: 30000 });
    } catch (err) {
      slot.innerHTML = `<div class="pack-share"><p class="pack-share__status is-error" role="alert">${esc(err.message)}</p></div>`;
      return;
    }
    const withAudio = info.narrated > 0;
    const fits = info.size <= WARN; // narration is left out of a large file unless the learner asks for it
    const lead = info.sample
      ? t('This is a sample course: its lessons are built into Primer, so the file is small.')
      : t('One file with the outline, the written lessons, their photos and the narration already made. Nothing personal goes in it: no progress, notes or doubts.');
    const have = [
      info.sample ? '' : `<li>${esc(tf('{n} of {total} lessons written', { n: info.lessons, total: info.outline }))}</li>`,
      info.photos ? `<li>${esc(tf(info.photos === 1 ? '1 photo, with its credit' : '{n} photos, with their credits', { n: info.photos }))}</li>` : '',
      withAudio ? `<li>${esc(tf(info.narrated === 1 ? 'Narration for 1 part' : 'Narration for {n} parts', { n: info.narrated }))}</li>` : ''
    ].join('');
    const missing = !info.sample && info.lessons < info.outline
      ? `<p class="pack-share__note">${esc(tf(info.outline - info.lessons === 1 ? 'The other lesson travels as a title: it’s written the first time it’s opened with internet.' : 'The other {n} lessons travel as titles: they’re written the first time they’re opened with internet.', { n: info.outline - info.lessons }))}</p>` : '';
    slot.innerHTML = `
      <div class="pack-share" role="region" aria-label="${esc(t('Share as a file'))}">
        <h2 class="pack-share__title">Share this course as a file</h2>
        <p class="pack-share__lead">${esc(lead)}</p>
        ${have ? `<ul class="pack-share__have">${have}</ul>` : ''}
        ${missing}
        ${withAudio ? `<label class="pack-share__opt"><input type="checkbox" data-audio${fits ? ' checked' : ''}> <span></span></label>` : ''}
        <p class="pack-share__size" data-size></p>
        <p class="pack-share__warn" data-warn hidden></p>
        <div class="pack-share__actions">
          <button class="btn btn--small" type="button" data-make>${ICON_FILE}<span>Make the file</span></button>
          <button class="textlink" type="button" data-cancel>Cancel</button>
        </div>
        <p class="pack-share__status" role="status" aria-live="polite"></p>
        <p class="pack-share__how">Send it however you like: WhatsApp, Bluetooth, a USB cable. On the other phone, open Primer and choose “Open a course file” under Your courses.</p>
      </div>`;
    const box = slot.querySelector('.pack-share');
    const audio = box.querySelector('[data-audio]');
    const paint = () => {
      const on = audio && audio.checked;
      const n = on ? info.size : info.sizeWithout;
      if (audio) audio.nextElementSibling.textContent = tf('Include the narration (+{size})', { size: size(info.audioBytes) });
      box.querySelector('[data-size]').textContent = tf('About {size}', { size: size(n) });
      const warn = box.querySelector('[data-warn]');
      if (n > LIMIT) {
        warn.hidden = false;
        warn.textContent = on ? t('That’s too large for one file. Leave out the narration.') : t('This course is too large for one file.');
      } else if (n > WARN) {
        warn.hidden = false;
        warn.textContent = on
          ? tf('This file is large. Sending it over mobile data can be slow or cost a lot; without the narration it’s about {size}.', { size: size(info.sizeWithout) })
          : t('This file is large. Sending it over mobile data can be slow or cost a lot.');
      } else warn.hidden = true;
      box.querySelector('[data-make]').disabled = n > LIMIT;
    };
    if (audio) audio.addEventListener('change', paint);
    paint();
    box.querySelector('[data-cancel]').addEventListener('click', close);
    box.querySelector('[data-make]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const status = box.querySelector('.pack-share__status');
      btn.disabled = true;
      status.classList.remove('is-error');
      status.textContent = t('Making the file…');
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 180000);
        const res = await fetch(`/api/courses/${encodeURIComponent(course.id)}/pack?narration=${audio && audio.checked ? 1 : 0}`, { credentials: 'same-origin', signal: ctrl.signal });
        if (!res.ok) {
          clearTimeout(timer);
          const d = await res.json().catch(() => null);
          throw new Error((d && d.error) || `The server answered with an error (${res.status}).`);
        }
        const blob = await res.blob();
        clearTimeout(timer);
        const name = fileName(res, course);
        ready(box, new File([blob], name, { type: 'application/octet-stream' }));
      } catch (err) {
        btn.disabled = false;
        status.classList.add('is-error');
        status.textContent = err.name === 'AbortError' ? t('Making the file took too long. Try again.') : t(err.message);
      }
    });
  }

  function fileName(res, course) {
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    try { if (m) return decodeURIComponent(m[1]); } catch (e) { /* fall through */ }
    return (String(course.title || 'course').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'course') + '.primer';
  }

  // The file is made: share it (where the browser can share files), or save it.
  function ready(box, file) {
    const url = URL.createObjectURL(file);
    const shareable = Boolean(navigator.canShare && navigator.share && (() => { try { return navigator.canShare({ files: [file] }); } catch (e) { return false; } })());
    const actions = box.querySelector('.pack-share__actions');
    const audio = box.querySelector('[data-audio]');
    if (audio) audio.disabled = true; // this file is made; Cancel and start again for the other kind
    actions.innerHTML = `
      ${shareable ? `<button class="btn btn--small" type="button" data-share>${ICON_SHARE}<span>Share…</span></button>` : ''}
      <a class="${shareable ? 'textlink' : 'btn btn--small'}" href="${url}" download="${esc(file.name)}" data-save>${shareable ? '' : ICON_FILE}<span>Save the file</span></a>`;
    const status = box.querySelector('.pack-share__status');
    status.textContent = tf('The file is ready: {name}, {size}.', { name: file.name, size: size(file.size) });
    const share = actions.querySelector('[data-share]');
    if (share) {
      share.addEventListener('click', async () => {
        try { await navigator.share({ files: [file], title: file.name.replace(/\.primer$/, '') }); }
        catch (err) { if (err.name !== 'AbortError') P.toast(t('This phone couldn’t share the file. Save it instead, then send it from your files.'), 'error'); }
      });
      share.focus();
    } else actions.querySelector('[data-save]').focus();
    actions.querySelector('[data-save]').addEventListener('click', () => {
      setTimeout(() => { status.textContent = t('Saved. Send it from your Downloads with WhatsApp, Bluetooth or a cable.'); }, 300);
    });
  }

  /* ---------- word from the service worker: a file opened offline reached the account ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type !== 'pack') return;
      if (d.ok) {
        // after the general "your progress is saved" note that the same sync sends
        setTimeout(() => P.toast(tf('“{title}” is now in your account.', { title: d.title || '' })), 900);
        const here = P.params.get('course');
        if (here && here === d.from && d.courseId !== d.from) location.replace('app.html?course=' + encodeURIComponent(d.courseId));
        else if (here && here === d.from) setTimeout(() => location.reload(), 1200);
      } else {
        P.toast(tf('“{title}” couldn’t join your account: {why}', { title: d.title || '', why: t(d.error || 'The server turned the file away.') }), 'error');
        if (P.params.get('course') === d.from) setTimeout(() => { location.href = 'app.html'; }, 2500);
      }
    });
  }

  P.packs = { mountCourse, mountLibrary };
})();
