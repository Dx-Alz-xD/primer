/* =====================================================================
   A lesson's references (server/refs.mjs sends them as lesson.refs).

   - Sources: small superscript numbers beside each part's title, linking
     to the numbered "Sources" list at the end of the lesson. The same
     markup goes into the book reader and the EPUB (book-content.js):
       P.refs.tags(lesson, sectionIndex, { prefix })  -> '<sup>…</sup>'
       P.refs.list(lesson, { prefix, heading, cls, lang, anchor }) -> HTML
   - Practise with (lesson page only): the apps for this lesson, each
     with its icon and name. Hovering, focusing or tapping one opens a
     card: what it is, whether it's free and open source, where it runs,
     and two or three steps for practising this lesson in it.
       P.refs.start({ course, n, lesson })
     While the server is still finding them, the page asks again a few
     times (GET /api/courses/:id/lessons/:n/refs).

   Everything from the server is checked again here: sources link only
   to Wikipedia, doi.org or YouTube over https, apps only over https,
   and icons only come from this site's /media/.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const arr = (v) => (Array.isArray(v) ? v : []);

  const LINKS = {
    wiki: /^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\/[^\s"<>]+$/,
    paper: /^https:\/\/doi\.org\/10\.\d{4,9}\/[^\s"<>]+$/,
    video: /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/
  };
  const ICON = /^\/media\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/;
  const PLATFORMS = { android: 'Android', web: 'Web browser', ios: 'iPhone and iPad', windows: 'Windows', mac: 'macOS', linux: 'Linux' };

  /* ---------- checking what the server sent ---------- */
  function clean(refs) {
    if (!refs || typeof refs !== 'object') return null;
    const sources = arr(refs.sources).slice(0, 24).map((s) => {
      if (!s || typeof s !== 'object') return null;
      const n = Math.round(Number(s.n));
      if (!(n >= 1 && n <= 24)) return null;
      const own = s.kind === 'own';
      if (!own && !(LINKS[s.kind] && LINKS[s.kind].test(String(s.url || '')))) return null;
      return {
        n, kind: s.kind, title: text(s.title, 300), url: own ? '' : s.url, site: text(s.site, 160), lang: text(s.lang, 8),
        year: Math.round(Number(s.year)) || 0, authors: arr(s.authors).map((a) => text(a, 80)).filter(Boolean).slice(0, 3), more: Boolean(s.more),
        doi: text(s.doi, 200), channel: text(s.channel, 120), contributor: text(s.contributor, 120), date: text(s.date, 40)
      };
    }).filter((s) => s && s.title);
    const have = new Set(sources.map((s) => s.n));
    const tags = {};
    Object.entries(refs.tags && typeof refs.tags === 'object' ? refs.tags : {}).forEach(([i, ks]) => {
      const nums = arr(ks).map(Number).filter((k) => have.has(k));
      if (/^\d{1,2}$/.test(i) && nums.length) tags[i] = Array.from(new Set(nums)).sort((a, b) => a - b);
    });
    const apps = arr(refs.apps).slice(0, 3).map((a) => {
      if (!a || typeof a !== 'object' || !/^https:\/\/[^\s"<>]+$/.test(String(a.url || ''))) return null;
      return {
        name: text(a.name, 40), url: a.url, host: text(a.host, 120) || a.url.replace(/^https:\/\/(?:www\.)?([^/]+).*$/, '$1'),
        icon: ICON.test(String(a.icon || '')) ? a.icon : '', what: text(a.what, 240), free: a.free === true, oss: a.oss === true,
        platforms: arr(a.platforms).filter((p) => Object.prototype.hasOwnProperty.call(PLATFORMS, p)), steps: arr(a.steps).map((s) => text(s, 260)).filter(Boolean).slice(0, 3)
      };
    }).filter((a) => a && a.name && a.steps.length);
    const status = ['found', 'none', 'pending'].includes(refs.status) ? refs.status : 'none';
    return {
      sources, tags, apps,
      status: sources.length ? 'found' : status === 'found' ? 'none' : status,
      mode: ['grounded', 'checked'].includes(refs.mode) ? refs.mode : null,
      appsStatus: apps.length ? 'found' : refs.appsStatus === 'pending' ? 'pending' : 'none'
    };
  }
  const refsOf = (lesson) => {
    if (!lesson || !lesson.refs) return null;
    if (!lesson.refs.__clean) { const c = clean(lesson.refs); lesson.refs = c ? Object.assign(c, { __clean: true }) : null; }
    return lesson.refs;
  };

  /* ---------- sources ---------- */
  // opts.text: the numbers as text (the book and the EPUB). On the lesson page they are drawn by CSS from
  // data-n, so a part's title still reads as itself (doubts and narration read its text).
  function tags(lesson, i, opts) {
    const r = refsOf(lesson);
    const nums = r && r.tags[String(i)];
    if (!nums || !nums.length) return '';
    const o = opts || {};
    const pre = o.prefix || 'src-';
    return `<sup class="srctags">${nums.map((k) => `<a class="srctag" href="#${pre}${k}" data-n="${k}" aria-label="${esc(fill('Source {n}', { n: k }))}">${o.text ? k : ''}</a>`).join('')}</sup>`;
  }

  const langNote = (code, lang) => (code && lang && code !== lang && P.langName ? ` (${esc(P.langName(code))})` : '');
  const quoted = (s) => `“${esc(s)}”`;

  function item(s, opts) {
    const link = (label) => (s.url ? `<a class="src__link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label);
    let body;
    if (s.kind === 'wiki') {
      body = `${link(quoted(s.title))}<span class="src__site">, ${esc(t('Wikipedia'))}${langNote(s.lang, opts.lang)}</span>`;
    } else if (s.kind === 'paper') {
      const by = s.authors.length ? `${esc(s.authors.join(', '))}${s.more ? ` ${esc(t('and others'))}` : ''}${s.year ? ` (${s.year})` : ''}. ` : s.year ? `(${s.year}). ` : '';
      body = `<span class="src__by">${by}</span>${link(quoted(s.title))}${s.site ? `<span class="src__site">, <em>${esc(s.site)}</em></span>` : ''}<span class="src__site">${langNote(s.lang, opts.lang)}</span><span class="src__doi"> · doi:${esc(s.doi)}</span>`;
    } else if (s.kind === 'video') {
      body = `${link(quoted(s.title))}<span class="src__site">, ${esc(t('YouTube video'))}${s.channel ? ` ${esc(fill('by {channel}', { channel: s.channel }))}` : ''}</span>`;
    } else {
      body = `<span class="src__own">${esc(fill('From your knowledge: {title}', { title: s.title }))}${s.contributor ? `, ${esc(s.contributor)}` : ''}${s.date ? `, ${esc(s.date)}` : ''}</span>`;
    }
    const a = opts.anchor ? ` data-a="${opts.anchor}-${s.n}"` : '';
    return `<li class="src src--${s.kind}" id="${opts.prefix}${s.n}"${a}><span class="src__n" aria-hidden="true">${s.n}</span><span class="src__body">${body}</span></li>`;
  }

  const NOTES = {
    grounded: 'This lesson was written by AI from these sources. The small numbers beside each part show which sources it follows.',
    checked: 'This lesson was written by AI; these sources were checked against it afterwards. The small numbers beside each part show which sources support it.',
    other: 'The small numbers beside each part show which sources it uses.',
    none: 'No outside sources were found for this lesson; it was written by AI — check important facts.',
    pending: 'Looking for sources for this lesson…'
  };

  // opts: { prefix: id prefix for the items, heading: 'h2' | 'h3', cls, lang (the lesson's language), anchor (book bookmarks), pending: show the wait }
  function list(lesson, opts) {
    const o = Object.assign({ prefix: 'src-', heading: 'h2', cls: 'srcs' }, opts || {});
    const r = refsOf(lesson);
    if (!r || (r.status === 'pending' && !o.pending)) return '';
    const H = o.heading === 'h3' ? 'h3' : 'h2';
    const id = `${o.prefix}title`;
    const a = o.anchor ? ` data-a="${o.anchor}"` : '';
    const note = r.status === 'found' ? NOTES[r.mode || 'other'] : NOTES[r.status];
    return `<section class="${esc(o.cls)}${r.status === 'found' ? '' : ' is-' + r.status}" aria-labelledby="${id}">
      <${H} class="srcs__title" id="${id}"${a}>${esc(t('Sources'))}</${H}>
      <p class="srcs__note">${esc(t(note))}</p>
      ${r.sources.length ? `<ol class="srcs__list">${r.sources.map((s) => item(s, o)).join('')}</ol>` : ''}
    </section>`;
  }

  /* ---------- practise with: apps for this lesson ---------- */
  const letter = (name) => esc(String(name).trim().charAt(0).toUpperCase() || '?');

  function appHTML(a, k) {
    const facts = [a.free ? t('Free') : '', a.oss ? t('Open source') : ''].filter(Boolean);
    const on = a.platforms.map((p) => t(PLATFORMS[p]));
    return `<li class="papp">
      <button class="papp__btn" type="button" aria-expanded="false" aria-controls="papp-${k}">
        <span class="papp__icon" aria-hidden="true">${a.icon ? `<img src="${esc(a.icon)}" alt="" width="40" height="40" loading="lazy" decoding="async">` : `<span class="papp__letter">${letter(a.name)}</span>`}</span>
        <span class="papp__name">${esc(a.name)}</span>
      </button>
      <div class="papp__card" id="papp-${k}" role="group" aria-label="${esc(a.name)}" hidden>
        <p class="papp__head"><strong>${esc(a.name)}</strong>${facts.map((f) => `<span class="papp__badge">${esc(f)}</span>`).join('')}</p>
        ${a.what ? `<p class="papp__what">${esc(a.what)}</p>` : ''}
        ${on.length ? `<p class="papp__on"><span class="papp__label">${esc(t('Works on:'))}</span> ${on.map(esc).join(' · ')}</p>` : ''}
        <p class="papp__label papp__label--how">${esc(t('Practise this lesson in it:'))}</p>
        <ol class="papp__steps">${a.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <a class="papp__open" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(fill('Open {site}', { site: a.host }))}<span class="sr-only"> ${esc(t('(opens in a new tab)'))}</span></a>
      </div>
    </li>`;
  }

  function appsHTML(r) {
    if (!r || !r.apps.length) return '';
    return `<section class="papps" aria-labelledby="papps-title">
      <h2 class="papps__title" id="papps-title">${esc(t('Practise with'))}</h2>
      <p class="papps__note">${esc(t('Apps where you can try what this lesson teaches. Hover over one, or tap it, to see how.'))}</p>
      <ul class="papps__list">${r.apps.map(appHTML).join('')}</ul>
    </section>`;
  }

  // Hover (a mouse), focus (a keyboard) or tap (a phone) opens a card; one at a time; Escape or a tap elsewhere closes it.
  let open = null, pinned = false, timer = 0;
  // the card stays inside the window: shifted sideways when it would run off an edge, opened upwards when
  // there's room above but not below, and (when tapped or clicked) scrolled into view if it still doesn't fit
  function place(card, pin) {
    card.style.transform = '';
    card.classList.remove('is-above');
    const r = card.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let shift = 0;
    if (r.right > vw - 10) shift = -(r.right - (vw - 10));
    if (r.left + shift < 10) shift += 10 - (r.left + shift);
    if (shift) card.style.transform = `translateX(${Math.round(shift)}px)`;
    if (r.bottom > innerHeight - 8) {
      const btn = card.parentNode.querySelector('.papp__btn');
      const top = btn ? btn.getBoundingClientRect().top : 0;
      if (top - r.height - 16 > 72) card.classList.add('is-above');
      else if (pin) card.scrollIntoView({ block: 'nearest', behavior: P.motion && P.motion.reduce ? 'auto' : 'smooth' });
    }
  }
  function show(li, pin) {
    clearTimeout(timer);
    if (open && open !== li) hide(open);
    const btn = li.querySelector('.papp__btn'), card = li.querySelector('.papp__card');
    open = li;
    pinned = Boolean(pin);
    card.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    li.classList.add('is-open');
    place(card, pin);
  }
  function hide(li) {
    if (!li) return;
    li.querySelector('.papp__card').hidden = true;
    li.querySelector('.papp__btn').setAttribute('aria-expanded', 'false');
    li.classList.remove('is-open');
    if (open === li) { open = null; pinned = false; }
  }
  document.addEventListener('click', (e) => { if (open && !open.contains(e.target)) hide(open); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    const btn = open.querySelector('.papp__btn');
    hide(open);
    btn.focus();
  });
  addEventListener('resize', () => { if (open) place(open.querySelector('.papp__card')); });

  function bindApps(root) {
    open = null; pinned = false;
    root.querySelectorAll('.papp').forEach((li) => {
      const btn = li.querySelector('.papp__btn');
      li.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(li, false); });
      li.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'mouse' || pinned || li.contains(document.activeElement)) return;
        timer = setTimeout(() => hide(li), 180);
      });
      btn.addEventListener('click', () => {
        if (open === li && pinned) hide(li);
        else show(li, true);
      });
      li.addEventListener('focusin', () => { if (open !== li) show(li, false); });
      li.addEventListener('focusout', (e) => { if (!li.contains(e.relatedTarget) && !pinned) hide(li); });
      // an icon that can't load (offline and not downloaded) becomes the app's first letter
      const img = li.querySelector('.papp__icon img');
      if (img) {
        img.addEventListener('error', () => {
          const box = img.parentNode;
          box.innerHTML = `<span class="papp__letter">${letter(li.querySelector('.papp__name').textContent)}</span>`;
        });
      }
    });
  }

  /* ---------- on the lesson page ---------- */
  let state = null;

  function render() {
    const { lesson } = state;
    const r = refsOf(lesson);
    let box = document.getElementById('lrefs');
    if (!r) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('section');
      box.id = 'lrefs';
      box.className = 'lrefs';
      // titles, app names and steps are content; the few interface words are translated here (P.t)
      box.setAttribute('data-no-i18n', '');
      const after = document.getElementById('ldone') || document.getElementById('lbody');
      after.after(box);
    }
    const lang = P.api && state.course ? P.api.lessonLang(state.course) : '';
    box.innerHTML = appsHTML(r) + list(lesson, { prefix: 'src-', heading: 'h2', cls: 'srcs', lang, pending: true });
    if (P.contentLang && lang) box.querySelectorAll('.papp__what, .papp__steps, .src__body').forEach((el) => P.contentLang(el, lang));
    bindApps(box);
    // the parts already on the page get their numbers (later parts get them as they open)
    document.querySelectorAll('#lbody .lsec').forEach((sec) => {
      const title = sec.querySelector('.lsec__title');
      if (!title) return;
      const old = title.querySelector('.srctags');
      if (old) old.remove();
      const html = tags(lesson, sec.dataset.sec);
      if (!html) return;
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      title.insertBefore(tpl.content, title.querySelector('.vlisten'));
    });
  }

  // A source number takes the reader to its entry, which glows for a moment.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.srctag');
    if (!a || !document.getElementById('lrefs')) return;
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: P.motion && P.motion.reduce ? 'auto' : 'smooth', block: 'center' });
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  });

  const WAITS = [4000, 6000, 8000, 12000, 15000, 20000];
  async function poll(k) {
    const { course, n, lesson } = state;
    const r = refsOf(lesson);
    if (!r || (r.status !== 'pending' && r.appsStatus !== 'pending') || k >= WAITS.length || course.source === 'sample') return;
    await P.delay(WAITS[k]);
    if (state.lesson !== lesson) return;
    let d;
    try { d = await P.get(`/api/courses/${encodeURIComponent(course.id)}/lessons/${n}/refs`, { timeout: 20000 }); } catch (e) { return; } // offline: what is kept stays
    if (!d || !d.refs || state.lesson !== lesson) return;
    lesson.refs = d.refs;
    render();
    poll(k + 1);
  }

  function start(opts) {
    state = opts;
    if (!opts || !opts.lesson || !refsOf(opts.lesson)) return;
    render();
    // the interface words, once the dictionary has loaded
    if (P.tReady && P.lang && P.lang !== 'en') P.tReady.then(() => { if (state === opts) render(); });
    poll(0);
  }

  P.refs = { clean, tags, list, start };
})();
