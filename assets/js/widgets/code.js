/* =====================================================================
   The coding window (assets/js/widgets.js): a code editor in the lesson,
   on a dark slate, where the learner writes and runs real programs
   (Python, or JavaScript), with an output console on paper below it and
   an input box for the lines that input() reads.

   The editor is a textarea over a highlighted copy of its text (the
   textarea's own letters are transparent; its caret and selection show),
   with line numbers beside it. Tab and Shift+Tab indent; Enter keeps the
   indent and adds one after ':' (Python) or '{' (JavaScript); Esc, then
   Tab, leaves the editor. On phones a row of keys gives Tab, : ( ) [ ] "
   = and the rest. Ctrl+Enter runs.

   Programs run in a Web Worker (code-worker.js), so the page stays
   responsive however long they run and Stop ends one at once; the
   interpreters (code-core.js, shared with the server) also stop a loop
   that never ends with a step budget. Where workers can't start, a
   program runs here, on the page, with a smaller budget. A task's check
   runs the learner's code against its tests here, synchronously (the
   lesson's check is), each test with its own step budget.

   Every spec is checked again here; code is shown as text, and the
   highlighted copy is built from escaped text only.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;

  /* ---------------- the interpreters, shared with the server ---------------- */

  let C = window.PrimerCode || null;
  const base = (() => {
    const s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^/]*$/, '') : '/assets/js/widgets/';
  })();
  const ready = C ? Promise.resolve(C) : new Promise((resolve, reject) => {
    let s = document.querySelector('script[data-code-core]');
    if (!s) {
      s = document.createElement('script');
      s.src = base + 'code-core.js';
      s.async = true;
      s.setAttribute('data-code-core', '');
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => { C = window.PrimerCode || null; if (C) resolve(C); else reject(new Error('the interpreters did not load')); });
    s.addEventListener('error', () => reject(new Error('the interpreters could not be loaded')));
  });
  ready.catch(() => {});
  // the loader (assets/js/widgets.js) waits for this before it counts the kind as loaded
  if (document.currentScript) document.currentScript.ready = ready;

  /* ---------------- words ---------------- */

  const T = (s) => (P.t ? P.t(s) : s);
  const F = (s, v) => T(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m));
  function andList(items, lang) {
    try { return new Intl.ListFormat(lang || P.lang || 'en', { type: 'conjunction' }).format(items); } catch (e) { return items.join(', '); }
  }
  const LANG_NAME = { python: 'Python', javascript: 'JavaScript' };
  const clip = (s, n) => { const a = Array.from(String(s)); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
  // a printed value in a sentence: plain when it is a number or a word, in quotes otherwise
  const quoted = (s) => { const v = clip(s, 60); return /^[\p{L}\p{N}.,+\-]+$/u.test(v) ? v : '“' + v + '”'; };
  // a test's input in a sentence: "3 and 4"
  function inputWords(stdin, lang) {
    const ls = String(stdin || '').split('\n');
    const items = ls.slice(0, 4).map((l) => (/^[\p{L}\p{N}.,+\-]+$/u.test(l) && l.length <= 24 ? l : '“' + clip(l, 24) + '”'));
    if (ls.length > 4) items.push('…');
    return andList(items, lang);
  }

  /* ---------------- checking specs again (they come from the AI, or a course file) ---------------- */

  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const MAX = 4000;
  function cleanSpec(spec) {
    if (!C || !isObj(spec)) return null;
    const lang = C.langOf(spec.language);
    if (!lang || typeof spec.code !== 'string' || spec.code.length > MAX) return null;
    const stdin = typeof spec.stdin === 'string' ? spec.stdin.slice(0, 1000) : '';
    const out = { language: lang, code: spec.code.replace(/\r\n?/g, '\n'), stdin };
    if (spec.mode === 'fill' || spec.mode === 'write' || spec.mode === 'edit') out.mode = spec.mode; // a task's starting code
    return out;
  }
  const checked = new WeakMap();
  function cleanTask(spec, goal) {
    if (!C || !isObj(spec) || !isObj(goal)) return null;
    let m = checked.get(spec);
    if (!m) { m = new WeakMap(); checked.set(spec, m); }
    if (m.has(goal)) return m.get(goal);
    let out = null;
    const s = cleanSpec(spec);
    const type = goal.type;
    const tests = Array.isArray(goal.tests) ? goal.tests.slice(0, 8) : [];
    const okTest = (t) => isObj(t) && (type === 'output' ? typeof t.stdout === 'string' && (t.stdin == null || typeof t.stdin === 'string') : Array.isArray(t.args) && 'returns' in t);
    if (s && (type === 'output' || (type === 'function' && /^[A-Za-z_$][\w$]*$/.test(String(goal.name || '')))) && tests.length && tests.every(okTest) &&
      typeof goal.solution === 'string' && goal.solution.length <= MAX) {
      const g = { type, tests, solution: goal.solution.replace(/\r\n?/g, '\n') };
      if (type === 'function') g.name = goal.name;
      if (typeof goal.tolerance === 'number' && goal.tolerance >= 0) g.tolerance = goal.tolerance;
      out = { spec: s, goal: g };
    }
    m.set(goal, out);
    return out;
  }

  /* ---------------- highlighting (from escaped text only) ---------------- */

  const escH = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PY_BUILTINS = new Set(('print input len range int float str bool list dict set tuple abs min max sum round sorted reversed enumerate zip map filter any all ' +
    'chr ord isinstance type open super object pow divmod hex oct bin repr iter next format self None True False').split(' '));
  const JS_BUILTINS = new Set('console Math Number String Array Object JSON parseInt parseFloat prompt alert Map Set isNaN true false null undefined this'.split(' '));
  const PY_RE = /(#[^\n]*)|((?:\b[rRbBuUfF]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(_{3,})|(\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+)|([\p{L}_][\p{L}\p{N}\p{M}_]*)|([^\S\n]+|\n|[\s\S])/gu;
  const JS_RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(`(?:\\[\s\S]|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(_{3,})|(\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+)|([\p{L}_$][\p{L}\p{N}\p{M}_$]*)|([^\S\n]+|\n|[\s\S])/gu;
  const PY_DEF = new Set(['def', 'class']);
  const JS_DEF = new Set(['function']);
  // tokens of code as [kind, text]: c comment, s string, x blank, n number, k keyword, b built-in, f function name, d defined name
  function tokens(code, lang) {
    const py = lang !== 'javascript';
    const re = py ? PY_RE : JS_RE;
    const kw = py ? C.PY_KW : C.JS_KW;
    const builtins = py ? PY_BUILTINS : JS_BUILTINS;
    const defs = py ? PY_DEF : JS_DEF;
    const out = [];
    let m, prevWord = '';
    re.lastIndex = 0;
    while ((m = re.exec(code))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      let kind = '';
      if (m[1]) kind = 'c';
      else if (m[2]) kind = 's';
      else if (m[3]) kind = 'x';
      else if (m[4]) kind = 'n';
      else if (m[5]) {
        const w = m[5];
        if (prevWord && defs.has(prevWord)) kind = 'd';
        else if (kw.has(w) && !(py && (w === 'True' || w === 'False' || w === 'None'))) kind = 'k';
        else if (builtins.has(w)) kind = 'b';
        else if (/^\s*\(/.test(code.slice(re.lastIndex, re.lastIndex + 8))) kind = 'f';
        prevWord = w;
      }
      if (m[6] && !/^\s+$/.test(m[6])) prevWord = '';
      out.push([kind, m[0]]);
    }
    return out;
  }
  const highlight = (code, lang) => tokens(code, lang).map(([k, s]) => (k ? `<span class="cw-${k}">${escH(s)}</span>` : escH(s))).join('');
  // the same with colours written in (the book and print have no stylesheet for it)
  const INK = { c: 'color:#7a6a55;font-style:italic', s: 'color:#3d6a2c', x: 'background:#f1dfb3;outline:1px dashed #8a6128', n: 'color:#9a3324', k: 'color:#8a6128;font-weight:700', b: 'color:#2f5f73', f: 'color:#2b1d11;font-weight:600', d: 'color:#2b1d11;font-weight:700' };
  const highlightInk = (code, lang) => tokens(code, lang).map(([k, s]) => (k ? `<span style="${INK[k]}">${escH(s)}</span>` : escH(s))).join('');

  /* ---------------- small helpers ---------------- */

  let uid = 0;
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(cls, label, kind) {
    const b = el('button', 'cw-btn ' + (cls || ''));
    b.type = 'button'; // inside the checkpoint's form: never a submit button
    if (kind) b.dataset.kind = kind;
    b.textContent = label;
    return b;
  }
  const SVG_PLAY = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
  const SVG_STOP = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/></svg>';
  const SVG_RESET = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3.2 6.3A5 5 0 1 1 3 9.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M2.6 2.8v3.8h3.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function withIcon(b, svg) {
    const label = b.textContent;
    b.textContent = '';
    const tmp = document.createElement('span');
    tmp.innerHTML = svg; // fixed markup, no spec text
    b.appendChild(tmp.firstChild);
    b.appendChild(el('span', '', label));
    return b;
  }

  /* ---------------- the editor ---------------- */

  const KEYS = {
    python: [['tab', '⇥'], ['untab', '⇤'], [':'], ['('], [')'], ['['], [']'], ['"'], ["'"], ['='], ['+'], ['-'], ['*'], ['/'], ['<'], ['>'], ['#'], ['_'], [','], ['.'], ['{'], ['}']],
    javascript: [['tab', '⇥'], ['untab', '⇤'], ['{'], ['}'], ['('], [')'], ['['], [']'], [';'], ['"'], ["'"], ['`'], ['='], ['+'], ['-'], ['*'], ['/'], ['<'], ['>'], ['!'], ['&'], ['|'], [','], ['.'], ['_']]
  };

  function editor(parent, opts) {
    const { lang, t } = opts;
    const unit = lang === 'python' ? '    ' : '  ';
    const id = 'cw' + (++uid);
    const wrap = el('div', 'cw-ed');
    const gutter = el('div', 'cw-gutter');
    gutter.setAttribute('aria-hidden', 'true');
    const nums = el('div', 'cw-nums');
    gutter.appendChild(nums);
    const area = el('div', 'cw-area');
    const pre = el('pre', 'cw-hl');
    pre.setAttribute('aria-hidden', 'true');
    const codeEl = el('code');
    pre.appendChild(codeEl);
    const ta = el('textarea', 'cw-ta');
    ta.id = id + '-code';
    ta.spellcheck = false;
    ['autocapitalize', 'autocomplete', 'autocorrect'].forEach((a) => ta.setAttribute(a, 'off'));
    ta.setAttribute('wrap', 'off');
    ta.setAttribute('translate', 'no');
    ta.setAttribute('data-gramm', 'false');
    ta.setAttribute('aria-label', opts.label);
    if (opts.describedBy) ta.setAttribute('aria-describedby', opts.describedBy);
    ta.value = opts.code;
    area.appendChild(pre);
    area.appendChild(ta);
    wrap.appendChild(gutter);
    wrap.appendChild(area);
    parent.appendChild(wrap);

    // the phone keys
    const keys = el('div', 'cw-keys');
    keys.setAttribute('role', 'toolbar');
    keys.setAttribute('aria-label', t('Keys for code'));
    (KEYS[lang] || KEYS.python).forEach(([k, shown]) => {
      const b = el('button', 'cw-key', shown || k);
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset.key = k;
      if (k === 'tab') b.setAttribute('aria-label', t('Indent'));
      if (k === 'untab') b.setAttribute('aria-label', t('Remove indent'));
      keys.appendChild(b);
    });
    parent.appendChild(keys);

    let lastLines = 0, painted = '', raf = 0, escaped = false, locked = false;
    function paint() {
      raf = 0;
      const v = ta.value;
      if (v !== painted) {
        painted = v;
        codeEl.innerHTML = highlight(v, lang) + '\n'; // escaped text only (highlight)
        const n = v.split('\n').length;
        if (n !== lastLines) {
          lastLines = n;
          let s = '';
          for (let i = 1; i <= n; i++) s += i + '\n';
          nums.textContent = s;
          wrap.style.setProperty('--rows', String(Math.max(opts.minRows || 5, Math.min(24, n))));
          wrap.style.setProperty('--digits', String(Math.max(2, String(n).length)));
        }
      }
      sync();
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
    function sync() {
      pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
      nums.style.transform = `translateY(${-ta.scrollTop}px)`;
    }

    // typing that the undo history keeps, where the browser allows it
    function insert(text, from, to) {
      if (locked) return;
      if (document.activeElement !== ta) ta.focus({ preventScroll: true });
      if (from != null) ta.setSelectionRange(from, to);
      const start = ta.selectionStart;
      if (!text && ta.selectionEnd === start) return;
      let ok = false;
      try { ok = document.execCommand(text ? 'insertText' : 'delete', false, text); } catch (e) { ok = false; }
      if (!ok) {
        ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // the caret just after what was put in (browsers differ on this after a deletion)
      const c = start + text.length;
      if (ta.selectionStart !== c || ta.selectionEnd !== c) ta.setSelectionRange(c, c);
    }
    function lineStart(v, i) { return v.lastIndexOf('\n', i - 1) + 1; }
    function shiftLines(dir) {
      const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      const ls = lineStart(v, s);
      let le = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e);
      if (le < 0) le = v.length;
      const lines = v.slice(ls, le).split('\n');
      const out = lines.map((l) => (dir > 0 ? (l.trim() || lines.length === 1 ? unit + l : l) : l.replace(new RegExp('^(?: {1,' + unit.length + '}|\\t)'), '')));
      const text = out.join('\n');
      if (text === lines.join('\n')) return;
      insert(text, ls, le);
      const d0 = out[0].length - lines[0].length;
      const total = text.length - (le - ls);
      if (s === e) { const c = Math.max(ls, s + d0); ta.setSelectionRange(c, c); } else ta.setSelectionRange(Math.max(ls, s + d0), e + total);
    }
    function onKey(e) {
      if (locked) return;
      if (e.key === 'Escape') { escaped = true; return; }
      if (e.key === 'Tab') {
        if (escaped || e.ctrlKey || e.altKey || e.metaKey) { escaped = false; return; } // let Tab leave the editor
        e.preventDefault();
        const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
        if (e.shiftKey) { shiftLines(-1); return; }
        if (v.slice(s, en).includes('\n')) { shiftLines(1); return; }
        const col = s - lineStart(v, s);
        insert(' '.repeat(unit.length - (col % unit.length)));
        return;
      }
      escaped = false;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (opts.onRun) opts.onRun(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
        const line = v.slice(lineStart(v, s), s);
        let ind = /^[ \t]*/.exec(line)[0];
        const bare = line.replace(lang === 'python' ? /\s+#.*$/ : /\s+\/\/.*$/, '').replace(/\s+$/, '');
        if (lang === 'python') {
          if (/:$/.test(bare)) ind += unit;
          else if (/^\s*(?:return|break|continue|pass|raise)\b/.test(line)) ind = ind.slice(0, Math.max(0, ind.length - unit.length));
          insert('\n' + ind);
          return;
        }
        const close = { '{': '}', '[': ']', '(': ')' }[bare.slice(-1)];
        if (close) {
          const after = v.slice(en).match(/^[ \t]*(.)/);
          if (after && after[1] === close) {
            insert('\n' + ind + unit + '\n' + ind, s, en + after[0].length - 1);
            const c = s + 1 + ind.length + unit.length;
            ta.setSelectionRange(c, c);
            return;
          }
          ind += unit;
        }
        insert('\n' + ind);
        return;
      }
      if (lang === 'javascript' && (e.key === '}' || e.key === ']' || e.key === ')') && !e.ctrlKey && !e.metaKey) {
        const v = ta.value, s = ta.selectionStart;
        const ls = lineStart(v, s);
        const before = v.slice(ls, s);
        if (before.length >= unit.length && /^ +$/.test(before) && ta.selectionEnd === s) {
          e.preventDefault();
          insert(before.slice(unit.length) + e.key, ls, s);
        }
        return;
      }
      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const v = ta.value, s = ta.selectionStart;
        if (s !== ta.selectionEnd) return;
        const ls = lineStart(v, s);
        const before = v.slice(ls, s);
        if (before.length >= 2 && /^ +$/.test(before)) {
          e.preventDefault();
          const n = before.length % unit.length || unit.length;
          insert('', s - n, s);
        }
      }
    }
    // phones put in curly quotes, which programs can't read: straight ones instead
    function onInput() {
      const v = ta.value;
      if (/[“”„‘’‚]/.test(v)) {
        const s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = v.replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'");
        ta.setSelectionRange(s, en);
      }
      schedule();
      if (opts.onChange) opts.onChange();
    }
    function onKeyDown(e) {
      const b = e.target.closest('.cw-key');
      if (b) e.preventDefault(); // keep the phone's keyboard open and the caret where it is
    }
    function onKeyClick(e) {
      const b = e.target.closest('.cw-key');
      if (!b || locked) return;
      const k = b.dataset.key;
      ta.focus({ preventScroll: true });
      if (k === 'tab') { const v = ta.value, s = ta.selectionStart; if (v.slice(s, ta.selectionEnd).includes('\n')) shiftLines(1); else insert(' '.repeat(unit.length - ((s - lineStart(v, s)) % unit.length))); } else if (k === 'untab') shiftLines(-1);
      else insert(k);
    }
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('input', onInput);
    ta.addEventListener('scroll', sync, { passive: true });
    keys.addEventListener('pointerdown', onKeyDown);
    keys.addEventListener('mousedown', onKeyDown);
    keys.addEventListener('click', onKeyClick);
    paint();

    return {
      ta, wrap, keys,
      get value() { return ta.value; },
      // put in new code (reset, reveal): the browser's undo can still bring the old back where it allows
      set(code, keepUndo) {
        if (keepUndo && !locked) {
          const focused = document.activeElement;
          ta.focus({ preventScroll: true });
          ta.select();
          insert(code);
          ta.setSelectionRange(0, 0);
          if (focused && focused !== ta && focused.focus) focused.focus({ preventScroll: true });
        } else ta.value = code;
        ta.scrollTop = 0; ta.scrollLeft = 0;
        schedule();
      },
      lock(on) {
        locked = Boolean(on);
        ta.readOnly = locked;
        wrap.classList.toggle('is-locked', locked);
        keys.querySelectorAll('button').forEach((b) => { b.disabled = locked; });
      },
      destroy() { if (raf) cancelAnimationFrame(raf); }
    };
  }

  /* ---------------- the turtle's canvas ---------------- */

  const TPAPER = '#fffaf0';
  function turtleView(parent, ctx) {
    const box = el('div', 'cw-turtle');
    const c1 = el('canvas'), c2 = el('canvas');
    c1.setAttribute('role', 'img');
    c1.setAttribute('aria-label', ctx.t('What the turtle drew'));
    c2.setAttribute('aria-hidden', 'true');
    box.appendChild(c1);
    box.appendChild(c2);
    box.hidden = true;
    parent.appendChild(box);
    let data = null, frame = 0, pos = 0, part = 0, size = 0, scale = 1, half = 200, onScreen = true, gone = false, cursor = null;
    const g1 = c1.getContext('2d'), g2 = c2.getContext('2d');
    const X = (x) => size / 2 + x * scale, Y = (y) => size / 2 - y * scale;
    function fit() {
      const w = Math.min(box.clientWidth || 360, 460);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size = w;
      [c1, c2].forEach((c) => { c.width = Math.round(w * dpr); c.height = Math.round(w * dpr); c.style.width = w + 'px'; c.style.height = w + 'px'; });
      [g1, g2].forEach((g) => g.setTransform(dpr, 0, 0, dpr, 0, 0));
      scale = size / (2 * half);
    }
    function bounds(ops) {
      let m = 180;
      for (const o of ops) {
        for (const v of [o.x1, o.y1, o.x2, o.y2, o.x, o.y]) if (typeof v === 'number' && Number.isFinite(v)) m = Math.max(m, Math.abs(v) + 12 + (o.r || 0));
        if (o.pts) for (const p of o.pts) m = Math.max(m, Math.abs(p[0]) + 12, Math.abs(p[1]) + 12);
      }
      return Math.min(m, 5000);
    }
    const cleanColor = (c) => (typeof c === 'string' && /^(?:#[0-9a-f]{3,6}|[a-z]{3,24}|rgb\(\d{1,3},\d{1,3},\d{1,3}\))$/i.test(c) ? c : '#2b1d11');
    function drawOp(o, f) {
      const g = g1;
      switch (o.o) {
        case 'line': {
          g.strokeStyle = cleanColor(o.c);
          g.lineWidth = Math.max(1, (o.w || 1) * Math.max(0.6, scale));
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(X(o.x1), Y(o.y1));
          g.lineTo(X(o.x1 + (o.x2 - o.x1) * f), Y(o.y1 + (o.y2 - o.y1) * f));
          g.stroke();
          break;
        }
        case 'dot': g.fillStyle = cleanColor(o.c); g.beginPath(); g.arc(X(o.x), Y(o.y), Math.max(1, o.r * scale), 0, Math.PI * 2); g.fill(); break;
        case 'fill':
          g.fillStyle = cleanColor(o.c);
          g.beginPath();
          o.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
          g.closePath();
          g.fill();
          break;
        case 'text':
          g.fillStyle = cleanColor(o.c);
          g.font = `${Math.max(9, Math.round(o.size * Math.max(0.7, scale) * 1.2))}px Georgia, serif`;
          g.textAlign = o.align === 'center' ? 'center' : o.align === 'right' ? 'right' : 'left';
          g.textBaseline = 'alphabetic';
          g.fillText(String(o.s).slice(0, 200), X(o.x), Y(o.y));
          break;
      }
    }
    function clear() { g1.fillStyle = data && data.bg ? cleanColor(data.bg) : TPAPER; g1.fillRect(0, 0, size, size); }
    // everything up to op n (fills go under the lines drawn after they began, as in Python)
    function redraw(n) {
      clear();
      const ops = data.ops;
      const fills = ops.filter((o, i) => o.o === 'fill' && i < n);
      for (let i = 0; i < n; i++) {
        for (const f of fills) if (f.at === i) drawOp(f, 1);
        const o = ops[i];
        if (o.o === 'bg') { g1.fillStyle = cleanColor(o.c); g1.fillRect(0, 0, size, size); redrawAfterBg(i, n, fills); return; }
        if (o.o !== 'fill') drawOp(o, 1);
      }
    }
    function redrawAfterBg(from, n, fills) {
      const ops = data.ops;
      for (let i = 0; i < n; i++) {
        if (i <= from && ops[i].o !== 'fill' && ops[i].o !== 'bg') { drawOp(ops[i], 1); continue; }
        if (i > from) { for (const f of fills) if (f.at === i) drawOp(f, 1); if (ops[i].o !== 'fill' && ops[i].o !== 'bg') drawOp(ops[i], 1); }
      }
      for (const f of fills) if (f.at <= from) drawOp(f, 1);
    }
    function drawCursor(x, y, h, color) {
      g2.clearRect(0, 0, size, size);
      if (x == null) return;
      const a = -h * Math.PI / 180;
      const s = Math.max(7, 9 * Math.min(1.4, scale));
      g2.save();
      g2.translate(X(x), Y(y));
      g2.rotate(a);
      g2.beginPath();
      g2.moveTo(s, 0);
      g2.lineTo(-s * 0.7, s * 0.6);
      g2.lineTo(-s * 0.35, 0);
      g2.lineTo(-s * 0.7, -s * 0.6);
      g2.closePath();
      g2.fillStyle = cleanColor(color);
      g2.strokeStyle = TPAPER;
      g2.lineWidth = 1.2;
      g2.fill();
      g2.stroke();
      g2.restore();
    }
    const len = (o) => (o.o === 'line' ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) : o.o === 'move' ? 0 : 0);
    function finalCursor() {
      const t0 = data.turtles && data.turtles[0];
      if (t0 && t0.shown) drawCursor(t0.x, t0.y, t0.h, t0.pen); else drawCursor(null);
    }
    function step() {
      frame = 0;
      if (gone || !data) return;
      if (!onScreen || document.hidden) return; // resumes when seen again
      const ops = data.ops;
      let budget = rate;
      while (pos < ops.length && budget > 0) {
        const o = ops[pos];
        const sp = o.sp == null ? 3 : o.sp;
        if (sp === 0) { if (o.o === 'fill' || o.o === 'bg') redraw(pos + 1); else if (o.o !== 'move' && o.o !== 'show' && o.o !== 'new') drawOp(o, 1); pos++; part = 0; continue; }
        const L = len(o);
        if (o.o === 'line' && L > 0) {
          const per = sp * 2.2 * boost;
          const want = Math.min(1, part + (budget * per) / L);
          drawOp(o, want);
          budget -= Math.max(0.15, (want - part) * L / per);
          part = want;
          cursor = [o.x1 + (o.x2 - o.x1) * part, o.y1 + (o.y2 - o.y1) * part, o.h, o.c];
          if (part >= 1) { pos++; part = 0; }
          continue;
        }
        if (o.o === 'fill' || o.o === 'bg') redraw(pos + 1); else if (o.o === 'dot' || o.o === 'text') drawOp(o, 1);
        if (o.o === 'move') cursor = [o.x, o.y, o.h, null];
        pos++; part = 0;
        budget -= o.o === 'move' ? 0.3 : 0.15;
      }
      const t0 = data.turtles && data.turtles[0];
      if (pos >= ops.length) { finalCursor(); return; }
      if (cursor && t0 && t0.shown) drawCursor(cursor[0], cursor[1], cursor[2], cursor[3] || t0.pen);
      frame = requestAnimationFrame(step);
    }
    let rate = 1, boost = 1;
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { onScreen = es.some((x) => x.isIntersecting); if (onScreen && data && pos < data.ops.length && !frame) frame = requestAnimationFrame(step); }) : null;
    if (io) io.observe(box);
    const onVis = () => { if (!document.hidden && data && pos < data.ops.length && !frame) frame = requestAnimationFrame(step); };
    document.addEventListener('visibilitychange', onVis);
    return {
      show(turtle, animate) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        data = turtle;
        if (!data || !data.ops) { box.hidden = true; return; }
        box.hidden = false;
        half = bounds(data.ops);
        fit();
        pos = 0; part = 0; cursor = null;
        if (!animate || ctx.reduce) { redraw(data.ops.length); pos = data.ops.length; finalCursor(); return; }
        // long drawings go faster, so none takes more than a few seconds
        const total = data.ops.reduce((s, o) => s + len(o) / Math.max(0.5, (o.sp || 3) * 2.2) + 0.2, 0);
        boost = Math.max(1, total / 300);
        rate = 1;
        clear();
        frame = requestAnimationFrame(step);
      },
      hide() { if (frame) cancelAnimationFrame(frame); frame = 0; data = null; box.hidden = true; },
      destroy() {
        gone = true;
        if (frame) cancelAnimationFrame(frame);
        if (io) io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
      }
    };
  }

  /* ---------------- running a program ---------------- */

  // one runner per coding window: a worker while it can, the page itself when it can't
  function runner() {
    let w = null, broken = typeof Worker === 'undefined', seq = 0, cur = null;
    function start() {
      if (w || broken) return w;
      try {
        w = new Worker(base + 'code-worker.js');
        w.onmessage = (e) => {
          const m = e.data || {};
          if (!cur || m.id !== cur.id) return;
          if (m.type === 'out') m.chunks.forEach((c) => cur.onOut(c.s, c.k));
          else if (m.type === 'done') { const c = cur; cur = null; c.resolve(m.result); }
        };
        w.onerror = (e) => {
          if (e && e.preventDefault) e.preventDefault();
          broken = true;
          try { w.terminate(); } catch (x) { /* already gone */ }
          w = null;
          if (cur) { const c = cur; cur = null; c.resolve(here(c)); }
        };
      } catch (e) { broken = true; w = null; }
      return w;
    }
    // on the page: a smaller budget, since the page waits
    function here(job) {
      const r = C.run(job.lang, job.code, { stdin: job.stdin, steps: Math.min(job.steps, 1500000), call: job.call });
      r.out.forEach((c) => job.onOut(c.s, c.k));
      delete r.value;
      return r;
    }
    return {
      run(job) {
        return new Promise((resolve) => {
          job.id = ++seq;
          job.resolve = resolve;
          const worker = start();
          if (!worker) { setTimeout(() => resolve(here(job)), 0); return; }
          cur = job;
          worker.postMessage({ type: 'run', id: job.id, lang: job.lang, code: job.code, stdin: job.stdin, steps: job.steps, call: job.call || null });
        });
      },
      stop() {
        if (w) { try { w.terminate(); } catch (e) { /* gone */ } w = null; }
        if (cur) { const c = cur; cur = null; c.resolve(null); }
      },
      get busy() { return Boolean(cur); },
      destroy() { this.stop(); }
    };
  }

  /* ---------------- the coding window ---------------- */

  function mount(host, spec, goal, ctx, mode) {
    const t = ctx.t || T, fill = ctx.fill || F;
    const lang = spec.language;
    const task = mode === 'task';
    const start = spec.code;
    const firstTest = task && goal.tests[0];
    const root = el('div', 'cw cw--' + (task ? 'task' : 'block'));
    root.setAttribute('data-no-i18n', '');
    root.setAttribute('translate', 'no');

    // the bar: the language, and putting the code back as it was
    const bar = el('div', 'cw-bar');
    bar.appendChild(el('span', 'cw-lang', LANG_NAME[lang] || lang));
    const blanks = task && /_{3,}/.test(start);
    if (blanks) bar.appendChild(el('span', 'cw-mode', t('Fill in each ___')));
    const resetBtn = withIcon(button('cw-reset', t('Reset code')), SVG_RESET);
    resetBtn.setAttribute('aria-label', t('Reset code: put back the starting code'));
    bar.appendChild(resetBtn);
    root.appendChild(bar);

    const hintId = 'cwh' + (++uid);
    const ed = editor(root, {
      lang, t, code: start, label: t('Code editor'), describedBy: hintId, minRows: task ? 6 : 4,
      onRun: () => run(),
      onChange: () => { touched = ed ? ed.value !== start : false; if (ctx.onChange) ctx.onChange(value()); }
    });
    let touched = false;

    // what the program reads with input()
    const io = el('div', 'cw-io');
    const inLabel = el('label', 'cw-in-label', t('Input'));
    const inId = 'cwi' + uid;
    inLabel.htmlFor = inId;
    const inBox = el('textarea', 'cw-in');
    inBox.id = inId;
    inBox.rows = 2;
    inBox.spellcheck = false;
    ['autocapitalize', 'autocomplete', 'autocorrect'].forEach((a) => inBox.setAttribute(a, 'off'));
    inBox.placeholder = t('One line for each input()');
    if (lang === 'javascript') inBox.placeholder = t('One line for each prompt()');
    inBox.value = task ? (goal.type === 'output' && firstTest.stdin ? firstTest.stdin : '') : (spec.stdin || '');
    const inHint = el('span', 'cw-in-hint', t('Each input() takes the next line.'));
    if (lang === 'javascript') inHint.textContent = t('Each prompt() takes the next line.');
    io.appendChild(inLabel);
    io.appendChild(inHint);
    io.appendChild(inBox);
    root.appendChild(io);
    const showInput = () => { io.hidden = !(C.uses(lang, ed.value).input || inBox.value.trim()); };

    // a task's first test, as an example
    if (task) {
      const ex = el('p', 'cw-example');
      if (goal.type === 'output') {
        ex.textContent = firstTest.stdin
          ? fill('Example: for input {input}, it should print {output}.', { input: inputWords(firstTest.stdin, ctx.lang), output: quoted(C.outLines(firstTest.stdout).join(' / ')) })
          : fill('It should print {output}.', { output: quoted(C.outLines(firstTest.stdout).join(' / ')) });
      } else ex.textContent = fill('Example: {call} should return {value}.', { call: C.callText(lang, goal.name, firstTest.args), value: C.shown(lang, firstTest.returns) });
      root.insertBefore(ex, io); // above the input box, which starts with the example's input
    }

    // run and stop
    const actions = el('div', 'cw-actions');
    const runBtn = withIcon(button('cw-run', t('Run')), SVG_PLAY);
    const stopBtn = withIcon(button('cw-stop', t('Stop')), SVG_STOP);
    stopBtn.disabled = true;
    const hint = el('span', 'cw-hint', t('Ctrl+Enter runs. Esc, then Tab, leaves the editor.'));
    hint.id = hintId;
    actions.appendChild(runBtn);
    actions.appendChild(stopBtn);
    actions.appendChild(hint);
    root.appendChild(actions);

    // the console
    const outWrap = el('div', 'cw-outwrap');
    const outHead = el('div', 'cw-outhead', t('Output'));
    outHead.id = 'cwo' + uid;
    const out = el('div', 'cw-out');
    out.setAttribute('role', 'log');
    out.setAttribute('aria-labelledby', outHead.id);
    out.setAttribute('aria-live', 'off');
    out.tabIndex = 0;
    const idle = el('span', 'cw-idle', t('Press Run to see what your program prints.'));
    out.appendChild(idle);
    outWrap.appendChild(outHead);
    outWrap.appendChild(out);
    root.appendChild(outWrap);
    const say = el('div', 'cw-sr');
    say.setAttribute('role', 'status');
    say.setAttribute('aria-live', 'polite');
    root.appendChild(say);
    const turtle = turtleView(root, { t, reduce: ctx.reduce });

    host.appendChild(root);
    showInput();

    const R = runner();
    let running = false, locked = false, destroyed = false, printed = 0;
    function clearOut() { out.textContent = ''; printed = 0; }
    function addText(s, k) {
      if (!s) return;
      printed += s.length;
      const last = out.lastChild;
      const cls = k === 'prompt' ? 'cw-p' : k === 'echo' ? 'cw-e' : 'cw-o';
      if (last && last.nodeType === 1 && last.className === cls) last.textContent += s;
      else out.appendChild(el('span', cls, s));
      out.scrollTop = out.scrollHeight;
    }
    function addLine(cls, text) {
      // a line of its own, after what was printed (whose last new line would otherwise leave a blank line)
      const last = out.lastChild;
      if (last && last.nodeType === 1 && last.tagName === 'SPAN' && /\n$/.test(last.textContent)) last.textContent = last.textContent.slice(0, -1);
      out.appendChild(el('div', cls, text));
      out.scrollTop = out.scrollHeight;
    }
    function friendly(e) {
      switch (e.kind) {
        case 'timeout': return t('Your program ran for too long. Is there a loop that never ends?');
        case 'output': return t('Your program printed too much, so it was stopped. Is there a loop that never ends?');
        case 'memory': return e.message === 'turtle' ? t('The turtle drew too much, so the program was stopped.') : t('Your program made something too big to keep, so it was stopped.');
        case 'eof': return fill('Line {line}: your program asked for more input than you gave. Add another line in the input box.', { line: e.line || 1 });
        case 'depth': return e.text + ' ' + t('Does a function keep calling itself without stopping?');
        default: return e.text;
      }
    }
    function setRunning(on) {
      running = on;
      runBtn.disabled = on || locked;
      stopBtn.disabled = !on;
      root.classList.toggle('is-running', on);
    }
    async function run() {
      if (running || locked || destroyed) return;
      clearOut();
      turtle.hide();
      setRunning(true);
      say.textContent = t('Running…');
      const code = ed.value;
      const call = task && goal.type === 'function' ? { name: goal.name, args: firstTest.args } : null;
      const stdin = inBox.value.replace(/\r\n?/g, '\n');
      const r = await R.run({ lang, code, stdin, steps: C.LIMITS.steps, call, onOut: (s, k) => { if (!destroyed) addText(s, k); } });
      if (destroyed) return;
      setRunning(false);
      if (!r) { addLine('cw-info', t('Stopped.')); say.textContent = t('Stopped.'); return; }
      if (r.error) addLine('cw-err', friendly(r.error));
      if (call && !r.error) {
        if (r.found) addLine('cw-info', fill('{call} returned {value}', { call: C.callText(lang, goal.name, firstTest.args), value: r.shown }));
        else addLine('cw-info', fill('There is no function named {name} yet.', { name: goal.name }));
      }
      const drew = Boolean(r.turtle && r.turtle.ops.length);
      if (drew) turtle.show(r.turtle, true);
      if (!printed && !r.error && !(call && r.found !== undefined)) addLine('cw-none', drew ? t('(Nothing printed. The turtle’s drawing is below.)') : t('(Your program printed nothing.)'));
      say.textContent = r.error ? (r.error.line && r.error.kind !== 'timeout' ? fill('Stopped with an error on line {line}.', { line: r.error.line }) : t('Stopped with an error.')) : t('Finished.');
    }
    function stop() {
      if (!running) return;
      R.stop();
    }
    function onReset() {
      if (locked) return;
      R.stop();
      ed.set(start, true);
      clearOut();
      out.appendChild(idle);
      turtle.hide();
      touched = false;
      if (ctx.onChange) ctx.onChange(value());
      showInput();
      ed.ta.focus({ preventScroll: true });
    }
    runBtn.addEventListener('click', run);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', onReset);
    const onInKey = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } };
    inBox.addEventListener('keydown', onInKey);
    let inputTimer = 0;
    ed.ta.addEventListener('input', () => { clearTimeout(inputTimer); inputTimer = setTimeout(() => { if (!destroyed) showInput(); }, 400); });

    function value() { return touched ? { code: ed.value } : null; }
    const handle = {
      value,
      // after a wrong answer, another try: the learner's code stays, to be fixed (Reset code puts back the start)
      reset() { R.stop(); setRunning(false); },
      reveal() {
        if (!task) return;
        R.stop();
        setRunning(false);
        const wasLocked = locked;
        if (wasLocked) ed.lock(false);
        ed.set(goal.solution, false);
        if (wasLocked) ed.lock(true);
        touched = true;
        if (goal.type === 'output') inBox.value = firstTest.stdin || '';
        showInput();
        const l = locked;
        locked = false;
        run().then(() => { locked = l; runBtn.disabled = locked; });
      },
      lock(on) {
        locked = Boolean(on);
        ed.lock(locked);
        inBox.readOnly = locked;
        runBtn.disabled = locked || running;
        resetBtn.disabled = locked;
        root.classList.toggle('is-locked', locked);
      },
      destroy() {
        destroyed = true;
        clearTimeout(inputTimer);
        R.destroy();
        ed.destroy();
        turtle.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
    return handle;
  }

  /* ---------------- what went wrong, in words ---------------- */

  // an error in a note: Python's and JavaScript's own messages as they are; the app's own, in the learner's language
  function errText(e) {
    if (e.kind === 'output') return T('It printed too much, so it was stopped.');
    if (e.kind === 'memory') return T('It made something too big to keep, so it was stopped.');
    return e.text || '';
  }
  function noteFor(t, r, lang) {
    const goal = t.goal, l = t.spec.language;
    const test = goal.tests[r.i] || {};
    if (goal.type === 'function') {
      const call = r.call || C.callText(l, goal.name, test.args);
      if (r.why === 'missing') return F('Your code has no function named {name}.', { name: goal.name });
      if (r.why === 'error') {
        const e = r.error || {};
        if (e.kind === 'timeout') return F('{call} ran for too long. Is there a loop that never ends?', { call });
        if (e.kind === 'eof') return F('{call} asked for input. A function gets its values from its parameters.', { call });
        return F('{call} stopped with an error: {error}', { call, error: errText(e) });
      }
      if ((r.got === 'None' || r.got === 'undefined') && r.stdout && r.stdout.trim()) return F('{call} printed its answer but returned {got}. Use return to give the answer back.', { call, got: r.got });
      return F('{call} returned {got}; it should return {want}.', { call, got: clip(r.got, 60), want: clip(r.want, 60) });
    }
    const has = Boolean(test.stdin);
    const input = has ? inputWords(test.stdin, lang) : '';
    if (r.why === 'error') {
      const e = r.error || {};
      if (e.kind === 'timeout') return has ? F('For input {input}, your program ran for too long. Is there a loop that never ends?', { input }) : T('Your program ran for too long. Is there a loop that never ends?');
      if (e.kind === 'eof') return has ? F('For input {input}, your program asked for more input than the test gives.', { input }) : T('Your program asked for input, but this test gives none.');
      return has ? F('For input {input}, your program stopped with an error: {error}', { input, error: errText(e) }) : F('Your program stopped with an error: {error}', { error: errText(e) });
    }
    const d = r.diff || C.outputDiff(r.got, r.want, goal.tolerance);
    if (!d) return '';
    const want = quoted(d.want == null ? '' : d.want), got = quoted(d.got == null ? '' : d.got);
    if (d.gotLines === 0) return has ? F('For input {input}, your program printed nothing; it should print {want}.', { input, want }) : F('Your program printed nothing; it should print {want}.', { want });
    if (d.got === null) return has ? F('For input {input}, your program stopped too soon: the next line should be {want}.', { input, want }) : F('Your program stopped too soon: the next line should be {want}.', { want });
    if (d.want === null) return has ? F('For input {input}, your program printed an extra line: {got}.', { input, got }) : F('Your program printed an extra line: {got}.', { got });
    if (d.gotLines === 1 && d.wantLines === 1) return has ? F('For input {input}, your program printed {got}; it should print {want}.', { input, got, want }) : F('Your program printed {got}; it should print {want}.', { got, want });
    const n = d.line + 1;
    return has ? F('For input {input}, line {n} of what your program printed is {got}; it should be {want}.', { input, n, got, want }) : F('Line {n} of what your program printed is {got}; it should be {want}.', { n, got, want });
  }

  /* ---------------- until the interpreters have loaded ---------------- */

  function later(host, startFn) {
    let h = null, gone = false;
    const queue = [];
    host.classList.add('is-loading');
    ready.then(() => {
      host.classList.remove('is-loading');
      if (gone) return;
      h = startFn();
      queue.forEach((fn) => fn(h));
    }).catch((err) => failed(host, err));
    const call = (name) => (...args) => { if (h) return h[name](...args); if (name !== 'value') queue.push((x) => x && x[name](...args)); return null; };
    return { value: () => (h ? h.value() : null), reset: call('reset'), reveal: call('reveal'), lock: call('lock'), destroy() { gone = true; if (h) h.destroy(); } };
  }
  function failed(host, err) {
    host.classList.remove('is-loading');
    host.classList.add('is-failed');
    host.textContent = T('This interactive part couldn’t be shown here.');
    if (err) console.warn('[Primer] code:', err.message || err);
  }

  /* ---------------- the still picture: the book, print, EPUB ---------------- */

  const STILL_BOX = 'margin:0;padding:.65em .85em;border-radius:5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,Liberation Mono,monospace;font-size:.86em;line-height:1.5;white-space:pre-wrap;word-break:break-word;text-align:left';
  const STILL_HEAD = 'margin:.6em 0 .25em;font-family:system-ui,sans-serif;font-size:.72em;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5b4730;text-align:left';
  function turtleSvg(tt) {
    if (!tt || !tt.ops || !tt.ops.length) return '';
    let m = 150;
    for (const o of tt.ops) for (const v of [o.x1, o.y1, o.x2, o.y2, o.x, o.y]) if (typeof v === 'number' && Number.isFinite(v)) m = Math.max(m, Math.abs(v) + 10 + (o.r || 0));
    m = Math.min(m, 5000);
    const r1 = (x) => Math.round(x * 10) / 10;
    const color = (c) => (typeof c === 'string' && /^(?:#[0-9a-f]{3,6}|[a-z]{3,24}|rgb\(\d{1,3},\d{1,3},\d{1,3}\))$/i.test(c) ? c : '#2b1d11');
    const parts = [];
    const fills = tt.ops.filter((o) => o.o === 'fill');
    let bg = '#fffaf0';
    tt.ops.forEach((o, i) => {
      fills.forEach((f) => { if (f.at === i) parts.push(`<polygon points="${f.pts.map((p) => r1(p[0]) + ',' + r1(-p[1])).join(' ')}" fill="${escH(color(f.c))}"/>`); });
      if (o.o === 'line') parts.push(`<line x1="${r1(o.x1)}" y1="${r1(-o.y1)}" x2="${r1(o.x2)}" y2="${r1(-o.y2)}" stroke="${escH(color(o.c))}" stroke-width="${r1(o.w || 1)}" stroke-linecap="round"/>`);
      else if (o.o === 'dot') parts.push(`<circle cx="${r1(o.x)}" cy="${r1(-o.y)}" r="${r1(o.r)}" fill="${escH(color(o.c))}"/>`);
      else if (o.o === 'text') parts.push(`<text x="${r1(o.x)}" y="${r1(-o.y)}" font-size="${o.size}" fill="${escH(color(o.c))}" text-anchor="${o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start'}">${escH(String(o.s).slice(0, 200))}</text>`);
      else if (o.o === 'bg') bg = color(o.c);
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-m} ${-m} ${2 * m} ${2 * m}" width="280" height="280" style="display:block;margin:.4em auto 0;max-width:100%;height:auto;background:${escH(bg)};border:1px solid #c9b48a;border-radius:5px" role="img">${parts.join('')}</svg>`;
  }
  function still(spec, goal) {
    const s = cleanSpec(spec);
    if (!s) return '';
    const name = LANG_NAME[s.language] || s.language;
    let html = `<div class="cw-still" style="max-width:38rem;margin:0 auto;text-align:left">`;
    html += `<div style="${STILL_HEAD};margin-top:0">${escH(name)}</div>`;
    const codeText = s.code.trim() ? s.code : (s.language === 'python' ? '# ' : '// ') + T('Write your program here.');
    html += `<pre style="${STILL_BOX};background:#fbf6ea;border:1px solid #c9b48a;color:#2b1d11"><code>${highlightInk(codeText, s.language)}</code></pre>`;
    // an example shows what it prints; a task's starting code doesn't (that would give the answer away, or show its bug)
    if (!goal && !s.mode && s.code.trim()) {
      let r = null;
      try { r = C.run(s.language, s.code, { stdin: s.stdin, steps: 300000, output: 4000 }); } catch (e) { r = null; }
      if (r) {
        const lines = C.outLines(r.out.map((c) => c.s).join('')).slice(0, 30); // as the console shows it: prompts and the lines typed in too
        if (s.stdin) html += `<div style="${STILL_HEAD}">${escH(T('Input'))}</div><pre style="${STILL_BOX};background:#f4ecd8;border:1px dashed #c9b48a;color:#5b4730">${escH(s.stdin)}</pre>`;
        if (lines.length && lines.join('').trim()) html += `<div style="${STILL_HEAD}">${escH(T('Output'))}</div><pre style="${STILL_BOX};background:#fffdf6;border:1px solid #d8c8a4;color:#2b1d11">${escH(lines.join('\n'))}</pre>`;
        html += turtleSvg(r.turtle);
      }
    }
    return html + '</div>';
  }

  /* ---------------- registering ---------------- */

  P.widgets.register('code', {
    ready,

    block(host, spec, ctx) {
      return later(host, () => {
        const s = cleanSpec(spec);
        if (!s) { failed(host, new Error('this code example does not hold together')); return null; }
        return mount(host, s, null, ctx || {}, 'block');
      });
    },

    task(host, spec, goal, ctx) {
      return later(host, () => {
        const t = cleanTask(spec, goal);
        if (!t) { failed(host, new Error('this coding task does not hold together')); return null; }
        return mount(host, t.spec, t.goal, ctx || {}, 'task');
      });
    },

    check(goal, value, spec) {
      const t = cleanTask(spec, goal);
      if (!t || !value || typeof value.code !== 'string') return { correct: false, invalid: true };
      const code = value.code;
      if (!code.trim()) return { correct: false, invalid: true, note: T('Write some code first.') };
      if (/_{3,}/.test(t.spec.code) && /_{3,}/.test(code)) return { correct: false, invalid: true, note: T('Fill in every ___ first.') };
      let res;
      try { res = C.runTests(t.spec.language, t.goal, code, { steps: 1000000, total: 3000000, stop: true }); } catch (e) { return { correct: false, invalid: true }; }
      if (res.syntax) return { correct: false, invalid: true, note: F('Your code has a mistake to fix first: {error}', { error: res.syntax.text }) };
      if (res.passed === res.total) return { correct: true, note: '' };
      const r = res.results.find((x) => !x.pass);
      return { correct: false, note: r ? noteFor(t, r, P.lang) : '' };
    },

    describe(value) {
      if (!value || typeof value.code !== 'string') return '';
      return clip(value.code.trim(), 400);
    },

    answer(goal, spec) {
      const t = cleanTask(spec, goal);
      return t ? t.goal.solution : '';
    },

    still(spec, goal) {
      if (!C) return '';
      return still(spec, goal || null);
    }
  });
})();
