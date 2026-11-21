/* =====================================================================
   Languages. Primer's interface is written in English; this swaps every
   piece of interface text for its translation from assets/i18n/<lang>.json,
   including text that pages add later (a MutationObserver watches).
   Lessons, tutor replies and posts are content, not interface: the AI
   writes or translates those in the learner's language instead.

   P.lang          the current language ('en', 'hi', 'ru')
   P.t(text)       translate one interface string (used by scripts)
   P.setLang(code) save the choice and reload
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$;

  const LANGS = {
    en: { name: 'English', label: 'English' },
    hi: { name: 'हिन्दी', label: 'Hindi', font: 'Tiro+Devanagari+Hindi:ital@0;1', head: '"Tiro Devanagari Hindi"', body: '"Tiro Devanagari Hindi"' },
    ru: { name: 'Русский', label: 'Russian', font: 'Old+Standard+TT:ital,wght@0,400;0,700;1,400', head: '"Old Standard TT"', body: '"Cormorant Garamond"' }
  };
  P.LANGS = LANGS;

  let stored = null;
  try { stored = P.store.get('primer.lang', null); } catch (e) { stored = null; }
  let lang = (P.boot.user && P.boot.user.lang) || stored || 'en';
  if (!LANGS[lang]) lang = 'en';
  P.lang = lang;
  document.documentElement.lang = lang;

  let dict = {}, patterns = [];
  P.t = (s) => {
    if (lang === 'en' || s == null) return s;
    const key = String(s).replace(/\s+/g, ' ').trim();
    if (!key) return s;
    if (Object.prototype.hasOwnProperty.call(dict, key)) return String(s).replace(key, dict[key]);
    for (const [re, to] of patterns) { if (re.test(key)) return String(s).replace(key, key.replace(re, to)); }
    return s;
  };

  P.setLang = async (code) => {
    if (!LANGS[code]) return;
    P.store.set('primer.lang', code);
    if (P.boot.user) {
      try { await P.put('/api/me', { lang: code }); } catch (e) { P.toast(e.message, 'error'); return; }
    }
    location.reload();
  };

  /* ---------------- the picker, in each page's top bar ---------------- */
  function mountPicker() {
    const host = $('.nav__links') || $('.lbar__tools');
    if (!host || host.querySelector('.langpick')) return;
    const wrap = document.createElement('label');
    wrap.className = 'langpick';
    wrap.setAttribute('data-no-i18n', '');
    wrap.innerHTML = `<span class="sr-only">Language</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
      <select aria-label="Language">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}"${k === lang ? ' selected' : ''}>${v.name}</option>`).join('')}</select>`;
    wrap.querySelector('select').addEventListener('change', (e) => P.setLang(e.target.value));
    host.prepend(wrap);
  }

  if (lang === 'en') {
    document.addEventListener('DOMContentLoaded', mountPicker);
    return;
  }

  /* ---------------- fonts that have the script ---------------- */
  const L = LANGS[lang];
  if (L.font) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${L.font}&display=swap`;
    document.head.appendChild(link);
    const st = document.createElement('style');
    st.textContent = `:root{--font-head:${L.head}, "IM Fell English", Georgia, serif;--font-body:${L.body}, "Cormorant Garamond", Georgia, serif}`;
    document.head.appendChild(st);
  }

  /* ---------------- translating the page ---------------- */
  // content people or the AI wrote is never "translated" by the dictionary: lessons, notes,
  // tutor replies, posts, and names the learner chose (folder names in shelves and menus)
  const SKIP = '[data-no-i18n], script, style, textarea, code, pre, .katex, .lbody, .lhead h1, .nb__text, .nb__entry, .tmsg, .ditem__q, .ditem__a, .ditem__quote, .doubt__quote, .user__name, .ugc, .shelf__title:not(#shelf-unfiled), option[value]:not([value=""])';
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const done = new WeakMap();

  function textNode(n) {
    const v = n.nodeValue;
    if (!v || !v.trim() || done.get(n) === v) return;
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const out = P.t(v);
    if (out !== v) n.nodeValue = out;
    done.set(n, n.nodeValue);
  }
  function element(el) {
    if (el.closest(SKIP)) return;
    ATTRS.forEach((a) => {
      const v = el.getAttribute(a);
      if (!v) return;
      const out = P.t(v);
      if (out !== v) el.setAttribute(a, out);
    });
  }
  function walk(root) {
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1) return;
    if (root.closest && root.closest(SKIP)) return;
    element(root);
    root.querySelectorAll('[placeholder], [aria-label], [title], [alt]').forEach(element);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = it.nextNode())) textNode(n);
  }

  const ready = fetch(`assets/i18n/${lang}.json`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((d) => {
      dict = d.strings || {};
      patterns = (d.patterns || []).map(([re, to]) => [new RegExp(re), to]);
    })
    .catch(() => {});

  document.documentElement.classList.add('i18n-wait');
  const reveal = () => document.documentElement.classList.remove('i18n-wait');
  setTimeout(reveal, 1500); // never hide the page for long, translated or not

  document.addEventListener('DOMContentLoaded', () => {
    mountPicker();
    ready.then(() => {
      walk(document.body);
      document.title = P.t(document.title.split(' | ')[0]) + (document.title.includes(' | ') ? ' | Primer' : '');
      reveal();
      new MutationObserver((muts) => {
        muts.forEach((m) => {
          if (m.type === 'characterData') textNode(m.target);
          else if (m.type === 'attributes') element(m.target);
          else m.addedNodes.forEach(walk);
        });
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    });
  });
})();
