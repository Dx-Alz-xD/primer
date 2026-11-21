/* =====================================================================
   Languages. Primer's interface is written in English; this swaps every
   piece of interface text for its translation from assets/i18n/<lang>.json,
   including text that pages add later (a MutationObserver watches).
   Lessons, tutor replies and posts are content, not interface: the AI
   writes or translates those in the learner's language instead.

   P.lang              the interface language ('en', 'hi', 'ta', 'ur'...)
   P.LANGS             the interface languages, by their own names
   P.COURSE_LANGS      every language a course can be written in (P.LANGS first)
   P.langName(code)    a language's name in the interface language
   P.t(text)           translate one interface string (used by scripts)
   P.tReady            a promise: the dictionary has loaded (or isn't needed)
   P.setLang(code)     save the choice and reload
   P.contentLang(el, code)  mark content written in another language
                       (lang, right-to-left, and a font for its script)

   Interface text inside content (a checkpoint's "Check" button inside a
   lesson, say) is marked data-i18n, and is translated even there.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$;

  // Fonts that have each script, from Google Fonts; one is loaded only when its language is used.
  const font = (family, axes) => ({ font: family.replace(/ /g, '+') + (axes || ':wght@400;500;600;700'), family: `"${family}"` });
  const DEVA = font('Tiro Devanagari Hindi', ':ital@0;1');
  const MARATHI = font('Tiro Devanagari Marathi', ':ital@0;1');

  // The interface languages, each by its own name, in the order the picker lists them.
  const LANGS = {
    en: { name: 'English', label: 'English' },
    hi: { name: 'हिन्दी', label: 'Hindi', ...DEVA },
    bho: { name: 'भोजपुरी', label: 'Bhojpuri', ...DEVA },
    bn: { name: 'বাংলা', label: 'Bengali', ...font('Noto Serif Bengali') },
    mr: { name: 'मराठी', label: 'Marathi', ...MARATHI },
    te: { name: 'తెలుగు', label: 'Telugu', ...font('Noto Serif Telugu') },
    ta: { name: 'தமிழ்', label: 'Tamil', ...font('Noto Serif Tamil') },
    gu: { name: 'ગુજરાતી', label: 'Gujarati', ...font('Noto Serif Gujarati') },
    ur: { name: 'اردو', label: 'Urdu', dir: 'rtl', ...font('Noto Nastaliq Urdu') },
    kn: { name: 'ಕನ್ನಡ', label: 'Kannada', ...font('Noto Serif Kannada') },
    or: { name: 'ଓଡ଼ିଆ', label: 'Odia', ...font('Noto Serif Oriya') },
    ml: { name: 'മലയാളം', label: 'Malayalam', ...font('Noto Serif Malayalam') },
    pa: { name: 'ਪੰਜਾਬੀ', label: 'Punjabi', ...font('Noto Serif Gurmukhi') },
    as: { name: 'অসমীয়া', label: 'Assamese', ...font('Noto Serif Bengali') },
    mai: { name: 'मैथिली', label: 'Maithili', ...DEVA },
    es: { name: 'Español', label: 'Spanish' },
    fr: { name: 'Français', label: 'French' },
    ar: { name: 'العربية', label: 'Arabic', dir: 'rtl', ...font('Noto Naskh Arabic') },
    pt: { name: 'Português', label: 'Portuguese' },
    ru: { name: 'Русский', label: 'Russian', font: 'Old+Standard+TT:ital,wght@0,400;0,700;1,400', family: '"Old Standard TT"', body: '"Cormorant Garamond"' }
  };
  // More languages a course can be written in (the server's list is server/langs.mjs).
  const MORE = {
    ne: { name: 'नेपाली', label: 'Nepali', ...DEVA },
    si: { name: 'සිංහල', label: 'Sinhala', ...font('Noto Serif Sinhala') },
    sa: { name: 'संस्कृतम्', label: 'Sanskrit', ...font('Tiro Devanagari Sanskrit', ':ital@0;1') },
    kok: { name: 'कोंकणी', label: 'Konkani', ...MARATHI },
    de: { name: 'Deutsch', label: 'German' },
    it: { name: 'Italiano', label: 'Italian' },
    nl: { name: 'Nederlands', label: 'Dutch' },
    pl: { name: 'Polski', label: 'Polish', ...font('Noto Serif', ':ital,wght@0,400;0,600;1,400') },
    uk: { name: 'Українська', label: 'Ukrainian' },
    el: { name: 'Ελληνικά', label: 'Greek', ...font('Noto Serif', ':ital,wght@0,400;0,600;1,400') },
    tr: { name: 'Türkçe', label: 'Turkish', ...font('Noto Serif', ':ital,wght@0,400;0,600;1,400') },
    fa: { name: 'فارسی', label: 'Persian', dir: 'rtl', ...font('Noto Naskh Arabic') },
    he: { name: 'עברית', label: 'Hebrew', dir: 'rtl', ...font('Noto Serif Hebrew') },
    sw: { name: 'Kiswahili', label: 'Swahili' },
    ja: { name: '日本語', label: 'Japanese', ...font('Noto Serif JP') },
    ko: { name: '한국어', label: 'Korean', ...font('Noto Serif KR') },
    zh: { name: '中文（简体）', label: 'Chinese (Simplified)', ...font('Noto Serif SC') },
    vi: { name: 'Tiếng Việt', label: 'Vietnamese', ...font('Noto Serif', ':ital,wght@0,400;0,600;1,400') },
    th: { name: 'ไทย', label: 'Thai', ...font('Noto Serif Thai') },
    id: { name: 'Bahasa Indonesia', label: 'Indonesian' },
    ms: { name: 'Bahasa Melayu', label: 'Malay' },
    fil: { name: 'Filipino', label: 'Filipino' }
  };
  P.LANGS = LANGS;
  P.COURSE_LANGS = Object.assign({}, LANGS, MORE);
  P.MORE_LANGS = Object.keys(MORE);

  let stored = null;
  try { stored = P.store.get('primer.lang', null); } catch (e) { stored = null; }
  let lang = (P.boot.user && P.boot.user.lang) || stored || 'en';
  if (!Object.prototype.hasOwnProperty.call(LANGS, lang)) lang = 'en';
  P.lang = lang;
  const L = LANGS[lang];
  document.documentElement.lang = lang;
  if (L.dir === 'rtl') document.documentElement.dir = 'rtl';

  /* ---------------- language names ---------------- */
  // A language's name in the interface language ("Tamil", "तमिल", "التاميلية"), from the browser's own data.
  let names = null;
  try { names = new Intl.DisplayNames([lang, lang === 'bho' || lang === 'mai' ? 'hi' : 'en'], { type: 'language' }); } catch (e) { names = null; }
  P.langName = (code) => {
    const C = P.COURSE_LANGS[code];
    if (!C) return code;
    if (code === lang) return C.name;
    if (lang === 'en' || !names) return C.label;
    let n = null;
    try { n = names.of(code); } catch (e) { n = null; }
    return n && n.toLowerCase() !== code ? n : C.label;
  };

  /* ---------------- fonts and direction ---------------- */
  const loaded = new Set();
  function loadFont(spec) {
    if (!spec || loaded.has(spec)) return;
    loaded.add(spec);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
    document.head.appendChild(link);
  }
  let rtlCSS = false;
  function loadRTL() {
    if (rtlCSS) return;
    rtlCSS = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/css/rtl.css';
    document.head.appendChild(link);
  }
  if (L.dir === 'rtl') loadRTL();
  if (L.font) {
    loadFont(L.font);
    const st = document.createElement('style');
    st.textContent = `:root{--font-head:${L.head || L.family}, "IM Fell English", Georgia, serif;--font-body:${L.body || L.family}, "Cormorant Garamond", Georgia, serif}`;
    document.head.appendChild(st);
  }

  // Content in another language than the interface (a Tamil course in the English interface, say):
  // its lang, its direction, and its script's font right after the page's own first font.
  P.contentLang = (el, code) => {
    const C = P.COURSE_LANGS[code];
    if (!el || !C) return;
    el.lang = code;
    const dir = C.dir || 'ltr';
    if (dir !== (L.dir || 'ltr')) { el.dir = dir; if (dir === 'rtl') loadRTL(); } else el.removeAttribute('dir');
    if (!C.font || C.font === L.font) return;
    loadFont(C.font);
    const cs = getComputedStyle(document.documentElement);
    ['--font-head', '--font-body'].forEach((v) => {
      const stack = cs.getPropertyValue(v).trim();
      if (stack && !stack.includes(C.family)) el.style.setProperty(v, stack.replace(/,/, `, ${C.family},`));
    });
  };

  /* ---------------- translating one string ---------------- */
  let dict = {}, patterns = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(dict, k);
  // A pattern's groups are names, titles and numbers, kept as they are; a group that is itself a whole
  // interface sentence (a server's error message, say) is translated too.
  function lookup(key, depth) {
    if (has(key)) return dict[key];
    for (const [re, to] of patterns) {
      const m = re.exec(key);
      if (!m) continue;
      return to.replace(/\$([1-9])/g, (all, i) => {
        const g = m[Number(i)];
        if (g == null) return '';
        const inner = depth < 1 && /[.!?]$/.test(g) ? lookup(g, depth + 1) : null;
        return inner != null ? inner : g;
      });
    }
    return null;
  }
  P.t = (s) => {
    if (lang === 'en' || s == null) return s;
    const str = String(s);
    const key = str.replace(/\s+/g, ' ').trim();
    if (!key) return s;
    const out = lookup(key, 0);
    if (out == null) return s;
    return str.match(/^\s*/)[0] + out + str.match(/\s*$/)[0];
  };

  P.setLang = async (code) => {
    if (!Object.prototype.hasOwnProperty.call(LANGS, code)) return;
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
    wrap.setAttribute('data-no-i18n', ''); // the languages keep their own names
    wrap.innerHTML = `<span class="sr-only">Language</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
      <select aria-label="Language">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" lang="${k}"${v.dir ? ` dir="${v.dir}"` : ''}${k === lang ? ' selected' : ''}>${v.name}</option>`).join('')}</select>`;
    const sel = wrap.querySelector('select');
    sel.addEventListener('change', (e) => P.setLang(e.target.value));
    host.prepend(wrap);
    P.tReady.then(() => {
      const word = P.t('Language');
      wrap.querySelector('.sr-only').textContent = word;
      sel.setAttribute('aria-label', word);
    });
  }

  if (lang === 'en') {
    P.tReady = Promise.resolve();
    document.addEventListener('DOMContentLoaded', mountPicker);
    return;
  }

  // Messages the browser shows itself (confirm before deleting, say), one paragraph at a time.
  const paras = (m) => String(m == null ? '' : m).split(/\n{2,}/).map((p) => P.t(p)).join('\n\n');
  const nativeConfirm = window.confirm.bind(window), nativePrompt = window.prompt.bind(window), nativeAlert = window.alert.bind(window);
  window.confirm = (m) => nativeConfirm(paras(m));
  window.prompt = (m, d) => nativePrompt(paras(m), d);
  window.alert = (m) => nativeAlert(paras(m));

  /* ---------------- translating the page ---------------- */
  // content people or the AI wrote is never "translated" by the dictionary: lessons, notes,
  // tutor replies, posts, and names the learner chose (folder names in shelves and menus)
  const SKIP = '[data-no-i18n], script, style, textarea, code, pre, .katex, .lbody, .lhead h1, .nb__text, .nb__entry, .tmsg, .ditem__q, .ditem__a, .ditem__quote, .doubt__quote, .user__name, .ugc, .shelf__title:not(#shelf-unfiled), option[value]:not([value=""])';
  const ISLAND = '[data-i18n]'; // interface text inside content
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const done = new WeakMap();

  function skipped(el) {
    const s = el.closest(SKIP);
    if (!s) return false;
    const island = el.closest(ISLAND);
    return !(island && s.contains(island));
  }
  function textNode(n) {
    const v = n.nodeValue;
    if (!v || !v.trim() || done.get(n) === v) return;
    const p = n.parentElement;
    if (!p || skipped(p)) return;
    const out = P.t(v);
    if (out !== v) n.nodeValue = out;
    done.set(n, n.nodeValue);
  }
  function element(el) {
    // a text box's own placeholder is interface text, though what is typed in it is not
    const at = el.tagName === 'TEXTAREA' && el.parentElement ? el.parentElement : el;
    if (skipped(at)) return;
    ATTRS.forEach((a) => {
      const v = el.getAttribute(a);
      if (!v) return;
      const out = P.t(v);
      if (out !== v) el.setAttribute(a, out);
    });
  }
  function walkIn(root) {
    element(root);
    root.querySelectorAll('[placeholder], [aria-label], [title], [alt]').forEach(element);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = it.nextNode())) textNode(n);
  }
  function walk(root) {
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1) return;
    if (skipped(root)) { root.querySelectorAll(ISLAND).forEach(walkIn); return; }
    walkIn(root);
  }

  const ready = fetch(`assets/i18n/${lang}.json`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((d) => {
      dict = d.strings || {};
      patterns = (d.patterns || []).map(([re, to]) => [new RegExp(re), to]);
    })
    .catch(() => {});
  P.tReady = ready;

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
