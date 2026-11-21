/* =====================================================================
   "Start from…" in the course builder (app.html): new ways to start a
   course, served by server/sources-in.mjs.
     Your knowledge    startfrom-knowledge.js
     A photo           startfrom-photo.js
     A textbook page   startfrom-photo.js
   This file has what they share: the row of buttons at the top of the
   builder, the dialog they open in, shrinking photos before they are
   sent, the language menu, the wait while a course is planned, and, on
   a course built this way, its label ("From your knowledge", who gave
   it and when), its source text, sharing it on the community board, and
   starting a course someone shared there (app.html?learn=<token>).

   P.startFrom.panels[name] = { title, render(body, opts) -> cleanup? }
   P.startFrom.open(name, opts)    opens a panel in the dialog
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  // interface sentences with {placeholders}: translated whole, then filled in
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const BOOT = Object.assign({ vision: false, maxMaterial: 30000, maxPages: 6 }, P.boot.startFrom || {});
  const SF = (P.startFrom = { boot: BOOT, t, fill, panels: {} });

  const ICON = {
    knowledge: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5C9.6 4.8 6.4 4.5 3.5 5.3v13c2.9-.8 6.1-.5 8.5 1.2 2.4-1.7 5.6-2 8.5-1.2v-13c-2.9-.8-6.1-.5-8.5 1.2z"/><path d="M12 6.5v13"/><path d="M15 9.5h2.8M15 12.5h2.8"/></svg>',
    photo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.3" r="3.6"/></svg>',
    page: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14.5 3.5V8H19"/><path d="M9 12h7M9 15h7M9 18h4.5"/></svg>'
  };
  SF.ICON = ICON;

  /* ---------------- the dialog ---------------- */
  const dlg = document.createElement('dialog');
  dlg.className = 'sf';
  dlg.setAttribute('aria-labelledby', 'sf-title');
  dlg.innerHTML = `
    <div class="sf__head">
      <div>
        <p class="sf__eyebrow">Start from…</p>
        <h2 class="sf__title" id="sf-title"></h2>
      </div>
      <button class="sf__x" type="button" data-sf-close aria-label="Close">×</button>
    </div>
    <div class="sf__body"></div>`;
  document.body.appendChild(dlg);
  const titleEl = $('#sf-title', dlg), bodyEl = $('.sf__body', dlg);
  let busy = null;   // while a course is being planned: asked before the dialog closes
  let cleanup = null; // the open panel's own tidying up (a microphone to release, photos to forget)

  SF.busy = (msg) => { busy = msg || null; };
  SF.close = () => {
    if (busy && !window.confirm(busy)) return;
    busy = null;
    dlg.close();
  };
  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-sf-close]')) SF.close(); });
  dlg.addEventListener('cancel', (e) => { if (busy && !window.confirm(busy)) e.preventDefault(); else busy = null; });
  dlg.addEventListener('close', () => {
    const fn = cleanup;
    cleanup = null;
    busy = null;
    if (fn) try { fn(); } catch (e) { console.warn('[Primer] start from:', e); }
    if (SF.returnFocus && document.contains(SF.returnFocus)) SF.returnFocus.focus();
  });

  SF.open = (name, opts) => {
    const panel = SF.panels[name];
    if (!panel) return;
    if (dlg.open) { busy = null; dlg.close(); }
    SF.returnFocus = document.activeElement;
    dlg.className = `sf sf--${name}`;
    titleEl.textContent = t(panel.title);
    bodyEl.innerHTML = '';
    bodyEl.scrollTop = 0;
    dlg.showModal();
    cleanup = panel.render(bodyEl, opts || {}) || null;
    const first = bodyEl.querySelector('[autofocus], input:not([type=hidden]):not([type=file]), textarea, select, button');
    if (first && !(window.matchMedia && matchMedia('(pointer:coarse)').matches)) first.focus({ preventScroll: true });
  };

  /* ---------------- shared pieces ---------------- */

  // The course languages, each by its own name with its name in the interface language beside it.
  SF.langOptions = (selected) => {
    const opt = (code) => {
      const C = P.COURSE_LANGS[code], local = P.langName(code);
      return `<option value="${code}" lang="${code}"${code === selected ? ' selected' : ''}>${esc(C.name)}${local && local !== C.name ? ` · ${esc(local)}` : ''}</option>`;
    };
    const more = P.MORE_LANGS.slice().sort((a, b) => P.langName(a).localeCompare(P.langName(b), P.lang));
    return Object.keys(P.LANGS).map(opt).join('') + `<optgroup label="${esc(t('More languages'))}">${more.map(opt).join('')}</optgroup>`;
  };
  SF.defaultLang = () => { const b = $('#b-lang'); return (b && b.value) || P.lang || 'en'; };
  SF.folderId = () => { const f = $('#b-folder'); return f && f.value ? Number(f.value) : null; };
  SF.number = (n) => { try { return new Intl.NumberFormat(P.lang).format(n); } catch (e) { return String(n); } };
  SF.date = (ms) => { try { return new Intl.DateTimeFormat(P.lang, { dateStyle: 'long' }).format(new Date(ms)); } catch (e) { return new Date(ms).toDateString(); } };

  // A photo made smaller (longest side at most maxSide) and re-encoded as JPEG in the browser:
  // quicker to send, and its metadata (where it was taken) never leaves the device.
  function loadImg(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve({ img, url, width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  SF.prepImage = async (file, maxSide, quality) => {
    if (!file || (file.type && !/^image\//.test(file.type))) throw new Error(t('That file isn’t an image.'));
    if (file.size > 40 * 1024 * 1024) throw new Error(t('That image is too large. Choose a smaller one.'));
    let src, w0, h0, url = null;
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' });
      w0 = src.width; h0 = src.height;
    } catch (e) {
      try { const r = await loadImg(file); src = r.img; url = r.url; w0 = r.width; h0 = r.height; } catch (e2) {
        throw new Error(t('That image couldn’t be opened. Try a JPEG or PNG photo.'));
      }
    }
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, w, h);
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    if (url) URL.revokeObjectURL(url);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error(t('That image couldn’t be opened. Try a JPEG or PNG photo.'));
    return { blob, width: w, height: h, url: URL.createObjectURL(blob) };
  };

  // Sends a photo as it is (not as JSON) and returns the server's JSON answer.
  SF.sendImage = async (url, blob, timeout = 150000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob, credentials: 'same-origin', signal: ctrl.signal });
      let data = null;
      try { data = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok || !data || data.ok === false) {
        throw Object.assign(new Error((data && data.error) || fill('The server answered with an error ({status}).', { status: res.status })), { status: res.status });
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(t('That took too long. Try again.'));
      if (err instanceof TypeError) throw new Error(t('Can’t reach the Primer server. Start it with npm start.'));
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  // The wait while a course is planned, then off to the course (or straight into its only lesson).
  SF.build = async ({ form, url, payload, steps, note, onError }) => {
    const wait = document.createElement('div');
    wait.className = 'sf-wait';
    wait.setAttribute('role', 'status');
    wait.innerHTML = `<p class="sf-wait__lead"><span class="sf-dots" aria-hidden="true"><i></i><i></i><i></i></span> <span>${esc(t('Planning your course…'))}</span></p>
      <ol class="sf-wait__steps">${steps.map((s) => `<li>${esc(t(s))}</li>`).join('')}</ol>
      <p class="help">${esc(t(note || 'Free AI models usually take 20 to 90 seconds to plan a course.'))}</p>`;
    form.hidden = true;
    form.after(wait);
    const items = $$('li', wait);
    let i = 0;
    items[0].className = 'is-active';
    const tick = setInterval(() => {
      if (i < items.length - 1) { items[i].className = 'is-done'; i++; items[i].className = 'is-active'; }
    }, P.motion.reduce ? 80 : 2600);
    SF.busy(t('Stop waiting? The course is still being planned, and will be in your library when it’s ready.'));
    try {
      const d = await P.post(url, payload, { timeout: 330000, timeoutMessage: t('The AI took too long to plan the course. Try again.') });
      clearInterval(tick);
      const away = !wait.isConnected || !dlg.open;
      if (!away) SF.busy(null);
      items.forEach((li) => { li.className = 'is-done'; });
      if (P.courses) P.courses.put(d.course);
      const lessons = (d.course.units || []).reduce((n, u) => n + u.lessons.length, 0);
      const id = encodeURIComponent(d.course.id);
      const href = lessons === 1 ? `lesson.html?course=${id}&lesson=1` : `app.html?course=${id}`;
      if (away) {
        // the learner stopped waiting: the course is in their library, and nothing moves under them
        if (P.shelves && P.shelves.render && document.getElementById('shelves')) P.shelves.render();
        P.toast(fill('“{title}” is ready. It’s in your courses.', { title: d.course.title }));
        return;
      }
      location.href = href;
    } catch (err) {
      clearInterval(tick);
      const away = !wait.isConnected || !dlg.open;
      if (!away) SF.busy(null);
      wait.remove();
      form.hidden = false;
      if (away) P.toast(err.message, 'error');
      else onError(err);
    }
  };

  // Toggles a set of chip buttons (aria-pressed); returns the pressed values.
  SF.pressed = (root, attr) => $$(`[${attr}][aria-pressed="true"]`, root).map((b) => b.getAttribute(attr));

  /* ---------------- the row in the builder ---------------- */
  function mountEntry() {
    const form = $('#builder');
    if (!form || form.querySelector('.sf-entry')) return;
    const row = document.createElement('div');
    row.className = 'sf-entry';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-labelledby', 'sf-entry-label');
    row.innerHTML = `<span class="sf-entry__label" id="sf-entry-label">Start from…</span>
      <span class="sf-entry__btns">
        <button class="sf-entry__btn" type="button" data-sf-open="knowledge" aria-haspopup="dialog">${ICON.knowledge}<span>Your knowledge</span></button>
        <button class="sf-entry__btn" type="button" data-sf-open="photo" aria-haspopup="dialog">${ICON.photo}<span>A photo</span></button>
        <button class="sf-entry__btn" type="button" data-sf-open="page" aria-haspopup="dialog">${ICON.page}<span>A textbook page</span></button>
      </span>`;
    form.prepend(row);
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sf-open]');
      if (b) SF.open(b.dataset.sfOpen);
    });
  }

  /* ---------------- a course built this way: its label, source and sharing ---------------- */
  const KIND_LABEL = {
    knowledge: 'From your knowledge',
    shared: 'Shared knowledge',
    page: 'From a textbook page',
    photo: 'From your photo'
  };
  const labelOf = (from) => {
    if (from.kind === 'knowledge' && from.shared) return t(KIND_LABEL.shared);
    if (from.kind === 'page' && from.pages > 1) return fill('From {n} textbook pages', { n: SF.number(from.pages) });
    return t(KIND_LABEL[from.kind] || KIND_LABEL.knowledge);
  };
  const noShareKey = (id) => 'primer.sf.noshare.' + id;
  const SIZE_LABEL = { lesson: 'A short lesson', unit: 'A short unit', course: 'A full course' };

  function coverFigure(photo, kind) {
    const dims = photo.width && photo.height ? ` width="${photo.width}" height="${photo.height}"` : '';
    return `<figure class="photo ccover ccover--${kind} sf-cover"><img class="photo__img ccover__img" src="${esc(photo.src)}" alt="${esc(t('Your photo'))}"${dims} loading="lazy" decoding="async"><figcaption class="ccover__credit">${esc(t('Your photo'))}</figcaption></figure>`;
  }
  const safePhoto = (p) => p && typeof p.src === 'string' && /^\/start-photo\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(p.src) ? p : null;

  function originHTML(c) {
    const f = c.startedFrom;
    const who = f.by ? `<span class="ugc">${esc(f.by)}</span>` : '';
    const when = f.at ? `<time datetime="${new Date(f.at).toISOString()}">${esc(SF.date(f.at))}</time>` : '';
    let by = '';
    if (f.kind === 'knowledge' && who) by = esc(t(f.shared ? 'Shared by {name} on {date}' : 'Contributed by {name} on {date}')).replace('{name}', () => who).replace('{date}', () => when);
    else if (when) by = esc(t('Made on {date}')).replace('{date}', () => when);
    const gaps = (f.gaps || []).filter(Boolean);
    const grounded = f.kind === 'knowledge' || f.kind === 'page';
    const canShare = f.kind === 'knowledge' && !f.shared;
    const invite = canShare && !P.store.get(noShareKey(c.id), false);
    return `<div class="sf-origin">
        <p class="sf-origin__label"><span class="sf-origin__badge">${ICON[f.kind === 'photo' ? 'photo' : f.kind === 'page' ? 'page' : 'knowledge']}<span>${esc(labelOf(f))}</span></span>${by ? ` <span class="sf-origin__by">${by}</span>` : ''}</p>
        ${f.summary ? `<p class="sf-origin__summary ugc">${esc(f.summary)}</p>` : ''}
        ${grounded ? `<p class="sf-origin__rule">${esc(t('Every lesson is written only from this material.'))}</p>` : ''}
        ${f.kind === 'photo' && f.size ? `<p class="sf-origin__rule">${esc(t(SIZE_LABEL[f.size] || ''))}</p>` : ''}
        ${gaps.length ? `<details class="sf-origin__gaps"><summary>${esc(t('What the material doesn’t cover'))}</summary><ul class="ugc">${gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></details>` : ''}
        ${grounded ? `<div class="sf-origin__actions">
          <button class="textlink" type="button" data-sf-source aria-expanded="false">${esc(t(f.kind === 'page' ? 'Read the page text' : 'Read the source text'))}</button>
          ${canShare ? `<button class="textlink" type="button" data-sf-share aria-haspopup="dialog">${esc(t('Share it on the community board'))}</button>` : ''}
        </div>
        <div class="sf-origin__source" data-sf-source-box hidden></div>` : ''}
        ${invite ? `<div class="sf-invite" data-sf-invite>
          <p>${esc(t('This may be knowledge that isn’t written down anywhere else. Share it on the community board, so that it’s kept and others can learn it too.'))}</p>
          <div class="sf-actions"><button class="btn btn--small" type="button" data-sf-share aria-haspopup="dialog">${esc(t('Share it publicly'))}</button><button class="textlink" type="button" data-sf-noshare>${esc(t('Not now'))}</button></div>
        </div>` : ''}
      </div>`;
  }

  function mountOrigin(head, c) {
    const anchor = head.querySelector('.course-head__meta') || head.querySelector('h1');
    anchor.insertAdjacentHTML('afterend', originHTML(c));
    const box = head.querySelector('.sf-origin');
    const photo = c.startedFrom.kind === 'photo' && safePhoto(c.startedFrom.photo);
    if (photo && !head.querySelector('.ccover')) head.insertAdjacentHTML('afterbegin', coverFigure(photo, 'head'));
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-sf-share')) SF.open('share', { course: c });
      else if (b.hasAttribute('data-sf-noshare')) {
        P.store.set(noShareKey(c.id), true);
        const inv = box.querySelector('[data-sf-invite]');
        if (inv) inv.remove();
      } else if (b.hasAttribute('data-sf-source')) toggleSource(b, box.querySelector('[data-sf-source-box]'), c);
    });
  }

  async function toggleSource(btn, panel, c) {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    panel.hidden = open;
    if (open || panel.dataset.loaded) return;
    panel.innerHTML = `<p class="help">${esc(t('Loading…'))}</p>`;
    try {
      const d = await P.get('/api/start/source/' + encodeURIComponent(c.id));
      panel.dataset.loaded = '1';
      panel.innerHTML = `<div class="sf-source ugc" tabindex="0"></div>
        <p class="sf-source__foot"><span class="help">${esc(fill('{n} characters', { n: SF.number(d.material.length) }))}</span> <button class="textlink" type="button" data-sf-save>${esc(t('Save it as a text file'))}</button></p>`;
      const src = panel.querySelector('.sf-source');
      src.textContent = d.material;
      if (P.contentLang && c.lang) P.contentLang(src, c.lang === 'en' ? 'en' : c.lang);
      panel.querySelector('[data-sf-save]').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([d.material], { type: 'text/plain;charset=utf-8' }));
        a.download = (c.title || 'source').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) + '.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      });
    } catch (err) {
      panel.innerHTML = `<p class="field__error">${esc(err.message)}</p>`;
    }
  }

  function decorate() {
    if (!P.courses) return;
    const view = document.getElementById('view-course');
    if (view && !view.hidden) {
      const head = view.querySelector('.course-head');
      const c = P.courses.get(P.params.get('course'));
      if (head && c && c.startedFrom && !head.querySelector('.sf-origin')) mountOrigin(head, c);
    }
    $$('#shelves .ccard[data-course]').forEach((card) => {
      if (card.querySelector('.sf-src')) return;
      const c = P.courses.get(card.dataset.course);
      if (!c || !c.startedFrom) return;
      const h = card.querySelector('h3');
      if (h) h.insertAdjacentHTML('afterend', `<p class="ccard__src sf-src">${esc(labelOf(c.startedFrom))}</p>`);
      const photo = c.startedFrom.kind === 'photo' && safePhoto(c.startedFrom.photo);
      if (photo && !card.querySelector('.ccover')) card.insertAdjacentHTML('afterbegin', coverFigure(photo, 'card'));
    });
  }
  function watch() {
    const roots = ['view-course', 'shelves'].map((id) => document.getElementById(id)).filter(Boolean);
    if (!roots.length) return;
    decorate();
    const mo = new MutationObserver(decorate);
    roots.forEach((r) => mo.observe(r, { childList: true, subtree: true }));
  }

  /* ---------------- sharing on the community board ---------------- */
  const POST_MAX = 20000;
  function postBody(s, material, withText) {
    const parts = [];
    parts.push(fill('Knowledge shared by {name} on {date}, so that it’s kept and others can learn it.', { name: s.by, date: SF.date(s.at) }));
    if (s.summary) parts.push(s.summary);
    let n = 0;
    parts.push(t('What the course teaches:') + '\n' + s.units.map((u, i) => `${fill('Unit {n}', { n: P.roman(i + 1) })}: ${u.title}\n` + u.lessons.map((l) => `${++n}. ${l}`).join('\n')).join('\n\n'));
    if (s.gaps.length) parts.push(t('What it doesn’t cover:') + '\n' + s.gaps.map((g) => '- ' + g).join('\n'));
    parts.push(t('Start the course with the link below. Every lesson in it is written only from this knowledge.'));
    if (withText) {
      const head = t('The knowledge, as it was given:');
      const room = POST_MAX - parts.join('\n\n').length - head.length - 120;
      let txt = material;
      if (txt.length > room) txt = txt.slice(0, Math.max(0, room)).replace(/\s+\S*$/, '') + '\n\n' + t('[The rest is in the course.]');
      parts.push(head + '\n\n' + txt);
    }
    return parts.join('\n\n').slice(0, POST_MAX);
  }

  SF.panels.share = {
    title: 'Share it publicly',
    render(body, { course }) {
      body.innerHTML = `<p class="help">${esc(t('Getting it ready…'))}</p>`;
      let alive = true;
      P.post('/api/start/share/' + encodeURIComponent(course.id), {}).then((d) => {
        if (!alive) return;
        const s = d.share;
        const link = `${location.origin}/${d.path}`;
        body.innerHTML = `
          <form class="sf-form" novalidate>
            <p class="sf-lead">${esc(t('Anyone will be able to read this post, and start the course from it. Check that nothing in it is private.'))}</p>
            <div class="field"><label class="label" for="sfs-title">Title</label><input class="input" id="sfs-title" maxlength="160"></div>
            <div class="field"><label class="label" for="sfs-tag">Topic</label><input class="input" id="sfs-tag" maxlength="40"></div>
            <div class="field">
              <label class="label" for="sfs-body">Post</label>
              <textarea class="textarea sf-material" id="sfs-body" rows="12" maxlength="${POST_MAX}"></textarea>
            </div>
            <label class="sf-check"><input type="checkbox" id="sfs-all" checked> <span>${esc(t('Include the full text of the knowledge in the post'))}</span></label>
            <p class="help">${esc(t('The post links to the course, so anyone signed in to Primer can start it.'))} <span class="sf-link ugc">${esc(link)}</span></p>
            <p class="field__error" role="alert"></p>
            <div class="sf-actions"><button class="btn" type="submit">${esc(t('Post it'))}</button><button class="textlink" type="button" data-sf-close>${esc(t('Cancel'))}</button></div>
          </form>`;
        const f = body.querySelector('form');
        const titleIn = $('#sfs-title', f), tagIn = $('#sfs-tag', f), bodyIn = $('#sfs-body', f), all = $('#sfs-all', f), err = f.querySelector('.field__error');
        titleIn.value = P.clean(fill('Local knowledge: {title}', { title: s.title }), 160);
        tagIn.value = P.clean(t('Local knowledge'), 40);
        const refill = () => { bodyIn.value = postBody(s, d.material, all.checked); };
        refill();
        all.addEventListener('change', refill);
        if (P.contentLang && s.lang) P.contentLang(bodyIn, s.lang);
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          err.textContent = '';
          const title = P.clean(titleIn.value, 160);
          if (!title) { err.textContent = t('Give your post a title.'); titleIn.focus(); return; }
          const btn = f.querySelector('[type=submit]');
          btn.disabled = true;
          try {
            const r = await P.post('/api/community/posts', {
              title, tag: P.clean(tagIn.value, 40), body: bodyIn.value.slice(0, POST_MAX),
              sources: [{ url: link, label: t('Start this course on Primer') }], images: []
            });
            SF.busy(null);
            P.store.set(noShareKey(course.id), true);
            location.href = 'post.html?id=' + r.post.id;
          } catch (er) {
            btn.disabled = false;
            err.textContent = er.message;
          }
        });
        titleIn.focus();
      }).catch((er) => {
        if (alive) body.innerHTML = `<p class="field__error">${esc(er.message)}</p>`;
      });
      return () => { alive = false; };
    }
  };

  /* ---------------- starting a course someone shared (app.html?learn=<token>) ---------------- */
  SF.panels.learn = {
    title: 'Shared knowledge',
    render(body, { token }) {
      body.innerHTML = `<p class="help">${esc(t('Loading…'))}</p>`;
      let alive = true;
      const forget = () => { if (P.params.get('learn')) history.replaceState(null, '', 'app.html' + location.hash); };
      P.get('/api/start/shared/' + encodeURIComponent(token)).then((d) => {
        if (!alive) return;
        const s = d.share;
        const by = esc(t('Shared by {name} on {date}')).replace('{name}', () => `<span class="ugc">${esc(s.by)}</span>`).replace('{date}', () => esc(SF.date(s.at)));
        body.innerHTML = `
          <div class="sf-learn">
            <h3 class="sf-learn__title ugc">${esc(s.title)}</h3>
            <p class="sf-origin__by">${by}</p>
            ${s.summary ? `<p class="sf-origin__summary ugc">${esc(s.summary)}</p>` : ''}
            <p class="help">${esc(fill(s.lessons === 1 ? '{n} lesson, written only from the knowledge that was shared' : '{n} lessons, written only from the knowledge that was shared', { n: SF.number(s.lessons) }))}</p>
            <details class="sf-origin__gaps"><summary>${esc(t('What the course teaches'))}</summary><ol class="ugc">${s.units.flatMap((u) => u.lessons).map((l) => `<li>${esc(l)}</li>`).join('')}</ol></details>
            <blockquote class="sf-learn__quote ugc"></blockquote>
            <p class="field__error" role="alert"></p>
            <div class="sf-actions"><button class="btn" type="button" data-sf-copy>${esc(t('Start this course'))}</button><button class="textlink" type="button" data-sf-close>${esc(t('Not now'))}</button></div>
          </div>`;
        const quote = body.querySelector('.sf-learn__quote');
        quote.textContent = d.excerpt + (s.chars > d.excerpt.length ? '…' : '');
        if (P.contentLang && s.lang) [body.querySelector('.sf-learn'), quote].forEach((el) => P.contentLang(el, s.lang));
        const btn = body.querySelector('[data-sf-copy]');
        btn.focus();
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const r = await P.post(`/api/start/shared/${encodeURIComponent(token)}/copy`, {});
            if (P.courses) P.courses.put(r.course);
            location.href = 'app.html?course=' + encodeURIComponent(r.course.id);
          } catch (er) {
            btn.disabled = false;
            body.querySelector('.field__error').textContent = er.message;
          }
        });
      }).catch((er) => {
        if (alive) body.innerHTML = `<p class="field__error">${esc(er.message)}</p>`;
      });
      return () => { alive = false; forget(); };
    }
  };

  function start() {
    mountEntry();
    watch();
    const token = P.params.get('learn');
    if (token && /^[A-Za-z0-9_-]{16}$/.test(token)) SF.open('learn', { token });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
