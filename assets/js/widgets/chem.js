/* =====================================================================
   The chemistry lab (assets/js/widgets.js), in three modes:

   - Balance: the equation with a coefficient before each formula (tap
     + or −, type a number, or use the arrow keys), the molecules each
     side holds drawn as little ball clusters that multiply as the
     numbers change, and a live count of every element (and the charge)
     on each side, each row turning green when the two sides are equal.
   - Atom: protons, neutrons and electrons added and taken away (hold a
     button to keep going); a Bohr picture with the nucleus as a cluster
     and the electrons on their shells (2, 8, 8, as school books draw
     them); the element, the A and Z notation, the charge, the shells,
     the valence electrons and whether the isotope is stable.
   - Compound: a positive and a negative ion chosen from the spec's list
     and how many of each; bars of charge that meet when the compound is
     neutral; its formula and name; the criss-cross method drawn out.

   The chemistry is chem-core.js (shared with the server): this file
   loads it first, and the loader waits for that (document.currentScript
   .ready, in widgets.js). Every spec is checked again here; nothing
   from it goes into the page except as text nodes or escaped text.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;
  const me = document.currentScript;

  const core = window.PrimerChem ? Promise.resolve(window.PrimerChem) : new Promise((resolve, reject) => {
    let s = document.querySelector('script[data-chem-core]');
    if (!s) {
      s = document.createElement('script');
      s.src = '/assets/js/widgets/chem-core.js';
      s.async = true;
      s.setAttribute('data-chem-core', '');
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => (window.PrimerChem ? resolve(window.PrimerChem) : reject(new Error('chem-core.js did not load'))));
    s.addEventListener('error', () => reject(new Error('chem-core.js could not be loaded')));
  });
  const ready = core.then(start);
  if (me) me.ready = ready;
  ready.catch((err) => console.warn('[Primer] chem:', err && err.message));

  function start(C) {
    const T = (s) => (P.t ? P.t(s) : s);
    const F = (s, v) => T(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m));
    const SVGNS = 'http://www.w3.org/2000/svg';
    const INK = '#2b1d11', SOFT = '#5b4730', GOLD = '#8a6128', RED = '#9a3324', GREEN = '#3d6a2c', PAPER = '#f6eedb';
    const PROTON = '#c4573a', NEUTRON = '#a3967a', ELECTRON = '#2f5f9e';
    const MINUS = '−';
    let uid = 0;

    /* ---------------- markup helpers ---------------- */

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // a tiny tree of SVG nodes, made into markup (still pictures) or DOM (the page); text is escaped or set as text
    const h = (tag, attrs, kids) => ({ tag, attrs: attrs || {}, kids: kids || [] });
    function toStr(n) {
      if (n == null) return '';
      if (typeof n === 'string') return esc(n);
      const a = Object.keys(n.attrs).filter((k) => n.attrs[k] != null && n.attrs[k] !== false).map((k) => ` ${k}="${esc(n.attrs[k])}"`).join('');
      return `<${n.tag}${a}>${n.kids.map(toStr).join('')}</${n.tag}>`;
    }
    function toDom(n) {
      if (typeof n === 'string') return document.createTextNode(n);
      const d = document.createElementNS(SVGNS, n.tag);
      Object.keys(n.attrs).forEach((k) => { if (n.attrs[k] != null && n.attrs[k] !== false) d.setAttribute(k, String(n.attrs[k])); });
      n.kids.forEach((k) => { if (k != null) d.appendChild(toDom(k)); });
      return d;
    }
    function el(tag, cls, attrs, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (attrs) Object.keys(attrs).forEach((k) => { const v = attrs[k]; if (v != null && v !== false) e.setAttribute(k, v === true ? '' : String(v)); });
      if (text != null) e.textContent = text;
      return e;
    }
    const r1 = (x) => Math.round(x * 10) / 10;
    const signed = (x) => (x > 0 ? '+' + x : x < 0 ? MINUS + Math.abs(x) : '0');
    const chargeSup = (c) => (c ? (Math.abs(c) > 1 ? Math.abs(c) : '') + (c > 0 ? '+' : MINUS) : '');
    function andList(items) {
      try { return new Intl.ListFormat(P.lang || 'en', { type: 'conjunction' }).format(items); } catch (e) { return items.join(', '); }
    }

    // a formula with real subscripts and charges: <span class="chm-f">Fe<sub>2</sub>O<sub>3</sub></span>
    function formulaEl(text, cls) {
      const s = el('span', 'chm-f' + (cls ? ' ' + cls : ''));
      C.pieces(text).forEach((p) => {
        if (p.k === 't') s.appendChild(document.createTextNode(p.s));
        else s.appendChild(el(p.k === 'b' ? 'sub' : 'sup', null, null, p.s));
      });
      return s;
    }
    // the same as SVG tspans, shifted with dy (every renderer, the book's and EPUB's too, draws that)
    function formulaSvg(text, size) {
      const out = [];
      let shift = 0;
      C.pieces(text).forEach((p) => {
        const want = p.k === 'b' ? size * 0.3 : p.k === 'p' ? -size * 0.42 : 0;
        const attrs = {};
        if (want !== shift) attrs.dy = r1(want - shift);
        if (p.k !== 't') attrs['font-size'] = r1(size * 0.66);
        shift = want;
        out.push(h('tspan', attrs, [p.s]));
      });
      return out;
    }
    // about how wide a formula is drawn at this size (for laying out still pictures)
    function textWidth(text, size) {
      let w = 0;
      C.pieces(text).forEach((p) => {
        const k = p.k === 't' ? 1 : 0.66;
        [...p.s].forEach((ch) => { w += size * k * (/[A-Z]/.test(ch) ? 0.74 : /[a-z]/.test(ch) ? 0.52 : /\d/.test(ch) ? 0.6 : /[()[\]·]/.test(ch) ? 0.38 : 0.66); });
      });
      return w;
    }

    /* ---------------- atoms drawn as balls ---------------- */

    const COLORS = {
      H: '#f3eee2', He: '#79c3d1', Li: '#a678d6', Be: '#9bc26a', B: '#e1a89e', C: '#4b4b4b', N: '#3d63c9', O: '#d0442f', F: '#86b84a', Ne: '#79c3d1',
      Na: '#7f60c8', Mg: '#4f9a48', Al: '#a9a9b6', Si: '#c6a777', P: '#e08a2c', S: '#dcb42a', Cl: '#3f9b4a', Ar: '#79c3d1', K: '#8a52c2', Ca: '#5a9a6a',
      Ti: '#9aa0a6', Cr: '#8c9bc6', Mn: '#9b7cc4', Fe: '#c06a2f', Co: '#d77ea0', Ni: '#6fae7a', Cu: '#c87a3c', Zn: '#7f83b3', Br: '#8f3a22', Kr: '#79c3d1',
      Sr: '#4fa37f', Ag: '#bfc3c8', Cd: '#e8c46a', Sn: '#8f96a3', I: '#6b3a8f', Ba: '#2e9e70', Pt: '#c8c8d0', Au: '#d9a520', Hg: '#b6b8cf', Pb: '#5a5d6e', e: ELECTRON
    };
    const colorOf = (sym) => COLORS[sym] || '#b08a5a';
    const radiusOf = (sym) => (sym === 'e' ? 2.6 : sym === 'H' ? 3.3 : C.zOf(sym) <= 10 ? 4.6 : 5.4);

    // where each atom of a species sits: a central atom with the others round it, or a sunflower cluster
    function cluster(sp) {
      if (sp.electron) return [{ x: 0, y: 0, r: radiusOf('e'), sym: 'e' }];
      const list = [];
      sp.order.forEach((s) => { for (let i = 0; i < sp.atoms[s] && list.length < 40; i++) list.push(s); });
      const heavy = (a, b) => (b === 'H') - (a === 'H') || C.zOf(b) - C.zOf(a);
      const n = list.length;
      if (n === 1) return [{ x: 0, y: 0, r: radiusOf(list[0]), sym: list[0] }];
      if (n === 2) {
        const a = radiusOf(list[0]), b = radiusOf(list[1]);
        return [{ x: -b * 0.78, y: 0, r: a, sym: list[0] }, { x: a * 0.78, y: 0, r: b, sym: list[1] }];
      }
      const nonH = sp.order.filter((s) => s !== 'H');
      // the centre: the scarcest element that isn't hydrogen (oxygen only if nothing else)
      const centre = nonH.length ? nonH.reduce((a, b) => (sp.atoms[b] < sp.atoms[a] || (sp.atoms[b] === sp.atoms[a] && a === 'O') ? b : a)) : list[0];
      const rest = list.slice();
      rest.splice(rest.indexOf(centre), 1);
      if (rest.length <= 6) {
        rest.sort(heavy);
        const rc = radiusOf(centre);
        const out = [];
        const bent = rest.length === 2 && (centre === 'O' || centre === 'S');
        rest.forEach((sym, i) => {
          const ang = bent ? (Math.PI / 2) + (i ? 0.92 : -0.92) : rest.length === 2 ? i * Math.PI : -Math.PI / 2 + (i * 2 * Math.PI) / rest.length;
          const d = rc + radiusOf(sym) * 0.78;
          out.push({ x: d * Math.cos(ang), y: d * Math.sin(ang), r: radiusOf(sym), sym });
        });
        out.push({ x: 0, y: 0, r: rc, sym: centre }); // drawn last, on top
        return out;
      }
      list.sort(heavy);
      return list.map((sym, i) => {
        const rr = 4.7 * Math.sqrt(i), th = i * 2.39996;
        return { x: rr * Math.cos(th), y: rr * Math.sin(th), r: radiusOf(sym), sym };
      }).reverse();
    }
    // a molecule as a small picture, at most max pixels across
    function moleculeTree(sp, max) {
      const at = cluster(sp);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      at.forEach((a) => { x0 = Math.min(x0, a.x - a.r); y0 = Math.min(y0, a.y - a.r); x1 = Math.max(x1, a.x + a.r); y1 = Math.max(y1, a.y + a.r); });
      const pad = 0.8;
      const w = x1 - x0 + 2 * pad, ht = y1 - y0 + 2 * pad;
      const k = Math.min(1.5, max / Math.max(w, ht));
      const kids = [];
      at.forEach((a) => {
        kids.push(h('circle', { cx: r1(a.x), cy: r1(a.y), r: a.r, fill: colorOf(a.sym), stroke: INK, 'stroke-opacity': 0.45, 'stroke-width': 0.6 }));
        kids.push(h('circle', { cx: r1(a.x - a.r * 0.32), cy: r1(a.y - a.r * 0.34), r: r1(a.r * 0.36), fill: '#fff', 'fill-opacity': a.sym === 'H' ? 0.7 : 0.3 }));
      });
      return h('svg', { xmlns: SVGNS, viewBox: [r1(x0 - pad), r1(y0 - pad), r1(w), r1(ht)].join(' '), width: Math.round(w * k), height: Math.round(ht * k), 'aria-hidden': 'true', focusable: 'false', class: 'chm-mol' }, kids);
    }

    /* ---------------- the Bohr picture ---------------- */

    const SHELL_NAMES = ['K', 'L', 'M', 'N', 'O'];
    // the nucleus: protons and neutrons in sunflower slots, mixed evenly (adding one changes only a slot or two)
    function nucleus(p, n) {
      const total = p + n;
      const rb = Math.max(3.6, 6.2 - 0.42 * Math.sqrt(total));
      const c = rb * 1.06;
      const m = Math.min(p, n);
      const out = [];
      for (let k = 0; k < total; k++) {
        const type = k < 2 * m ? (k % 2 ? 'n' : 'p') : p > n ? 'p' : 'n';
        const rr = c * Math.sqrt(k + 0.35), th = k * 2.39996;
        out.push({ x: rr * Math.cos(th), y: rr * Math.sin(th), type, k });
      }
      const R = total ? c * Math.sqrt(total) + rb : 0;
      return { balls: out, rb, R };
    }
    function ringRadii(R, count) {
      const k = Math.max(30, Math.min(50, R + 15));
      const step = count > 3 ? Math.min(19, (108 - k) / (count - 1)) : 19;
      return Array.from({ length: count }, (_, i) => k + i * step);
    }
    function electronPoints(shells, radii) {
      const out = [];
      shells.forEach((cnt, s) => {
        for (let i = 0; i < cnt; i++) {
          const th = -Math.PI / 2 + (i * 2 * Math.PI) / cnt + (s % 2 ? Math.PI / cnt : 0);
          out.push({ s, i, x: radii[s] * Math.cos(th), y: radii[s] * Math.sin(th) });
        }
      });
      return out;
    }
    // the whole picture as a tree (still pictures); the live one is made from the same parts (atomView)
    function bohrTree(p, n, e) {
      const nu = nucleus(p, n);
      const sh = C.shells(p, e);
      const radii = ringRadii(nu.R, sh.length);
      const kids = [h('rect', { x: -120, y: -120, width: 240, height: 240, fill: PAPER, rx: 8 })];
      radii.forEach((r, s) => {
        kids.push(h('circle', { cx: 0, cy: 0, r: r1(r), fill: 'none', stroke: SOFT, 'stroke-opacity': 0.5, 'stroke-width': 1 }));
        kids.push(h('text', { x: r1(r * 0.81), y: r1(-r * 0.6), 'font-size': 10, fill: SOFT, 'font-family': 'Georgia, serif' }, [SHELL_NAMES[s]]));
      });
      nu.balls.forEach((b) => kids.push(h('circle', { cx: r1(b.x), cy: r1(b.y), r: r1(nu.rb), fill: b.type === 'p' ? PROTON : NEUTRON, stroke: INK, 'stroke-opacity': 0.4, 'stroke-width': 0.6 })));
      electronPoints(sh, radii).forEach((pt) => kids.push(h('circle', { cx: r1(pt.x), cy: r1(pt.y), r: 4.4, fill: ELECTRON, stroke: PAPER, 'stroke-width': 1.2 })));
      return h('svg', { xmlns: SVGNS, viewBox: '-120 -120 240 240', width: 240, height: 240, role: 'img', 'aria-label': atomSentence(p, n, e) }, kids);
    }

    /* ---------------- words ---------------- */

    // "Carbon-12" (the element's name is translated: chem-core.js NAMES)
    const isoName = (p, n, t, fill) => { const v = { name: (t || T)(C.nameOf(p)), a: p + n }; return fill ? fill('{name}-{a}', v) : F('{name}-{a}', v); };
    function ionLabel(f, t, fill) {
      if (!f.charge) return t('a neutral atom');
      if (f.ionName) return fill('{name} ion', { name: t(f.ionName) });
      return f.charge > 0 ? t('a positive ion (cation)') : t('a negative ion (anion)');
    }
    // "Na⁺": the symbol and its charge, the same in any language
    const symCharge = (p, e) => C.plain(C.symbolOf(p) + C.chargeText(p - e));
    const atomSentence = (p, n, e, fill) => { const v = { p, n, e, sym: symCharge(p, e) }; return fill ? fill('Protons: {p}, neutrons: {n}, electrons: {e} ({sym})', v) : F('Protons: {p}, neutrons: {n}, electrons: {e} ({sym})', v); };

    /* ---------------- buttons that repeat when held ---------------- */

    // tap or click: once; hold: again and again; keyboard: Enter or Space (the browser's own click)
    function repeatable(btn, fn, signal) {
      let t1 = 0, t2 = 0, skip = false, skipTimer = 0;
      const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = 0; };
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || btn.disabled) return;
        skip = true;
        clearTimeout(skipTimer);
        fn();
        stop();
        t1 = setTimeout(() => { t2 = setInterval(() => { if (btn.disabled) stop(); else fn(); }, 85); }, 420);
      }, { signal });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, () => {
        stop();
        clearTimeout(skipTimer);
        skipTimer = setTimeout(() => { skip = false; }, 700);
      }, { signal }));
      btn.addEventListener('click', () => { if (skip) { skip = false; return; } fn(); }, { signal });
      btn.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
      if (signal) signal.addEventListener('abort', () => { stop(); clearTimeout(skipTimer); });
    }
    function stepBtn(cls, label, text) {
      const b = el('button', 'chm-btn ' + cls, { type: 'button', 'aria-label': label });
      b.appendChild(el('span', null, { 'aria-hidden': 'true' }, text));
      return b;
    }

    /* ---------------- the common frame ---------------- */

    function frame(host, mode, ctx, isTask) {
      const t = ctx.t || T, fill = ctx.fill || F;
      const root = el('div', `chm chm--${mode}${isTask ? ' chm--task' : ''}`, { 'data-no-i18n': '' });
      const say = el('p', 'sr-only', { 'aria-live': 'polite' });
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      const signal = ac ? ac.signal : undefined;
      let sayTimer = 0, destroyed = false;
      return {
        t, fill, root, say, signal, reduce: Boolean(ctx.reduce),
        mount() { root.appendChild(say); host.textContent = ''; host.appendChild(root); },
        speak(text) { clearTimeout(sayTimer); sayTimer = setTimeout(() => { if (!destroyed) say.textContent = text; }, 650); },
        changed(value) { try { if (ctx.onChange) ctx.onChange(value); } catch (err) { /* the page's own handler */ } },
        lock(on) {
          root.classList.toggle('is-locked', Boolean(on));
          root.querySelectorAll('button, input').forEach((b) => { if (!b.hasAttribute('data-keep')) b.disabled = Boolean(on) || b.hasAttribute('data-off'); });
        },
        destroy() {
          destroyed = true;
          clearTimeout(sayTimer);
          if (ac) ac.abort();
          if (root.parentNode) root.parentNode.removeChild(root);
        }
      };
    }
    function foot(fr, hintText, onReset) {
      const f = el('div', 'chm-foot');
      if (hintText) f.appendChild(el('span', 'chm-hint', null, hintText));
      if (onReset) {
        const b = el('button', 'chm-reset', { type: 'button' }, fr.t('Reset'));
        b.addEventListener('click', onReset, { signal: fr.signal });
        f.appendChild(b);
      }
      return f;
    }

    /* ================= balance ================= */

    function balanceView(host, spec, goal, ctx) {
      const isTask = Boolean(goal);
      const fr = frame(host, 'balance', ctx, isTask);
      const { t, fill, root, signal } = fr;
      const eq = C.parseEquation(spec.equation);
      const answer = goal ? goal.coefficients : C.balance(eq);
      const max = Math.min(C.LIMITS.stepper, Math.max(10, 2 * Math.max(...answer)));
      const nL = eq.left.length;
      let coefs = spec.start.slice(), touched = false, locked = false;
      root.setAttribute('aria-label', t('Balance the equation'));

      // the equation, with a coefficient box before each formula
      const line = el('div', 'chm-eq');
      const boxes = [];
      eq.species.forEach((sp, j) => {
        if (j === nL) line.appendChild(el('span', 'chm-op chm-op--arrow', { 'aria-hidden': 'true' }, '→'));
        else if (j) line.appendChild(el('span', 'chm-op', { 'aria-hidden': 'true' }, '+'));
        const name = C.plain(sp.text);
        const term = el('div', 'chm-term');
        const step = el('div', 'chm-step');
        const up = stepBtn('chm-btn--up', fill('More {f}', { f: name }), '+');
        const input = el('input', 'chm-coef', {
          type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 2, autocomplete: 'off', spellcheck: 'false',
          role: 'spinbutton', 'aria-valuemin': 1, 'aria-valuemax': max, 'aria-label': fill('Coefficient of {f}', { f: name })
        });
        const down = stepBtn('chm-btn--down', fill('Fewer {f}', { f: name }), MINUS);
        step.append(up, input, down);
        term.append(step, formulaEl(sp.text, 'chm-term__f'));
        line.appendChild(term);
        const set = (v) => { if (locked) return; const x = Math.max(1, Math.min(max, v)); if (x === coefs[j]) { paint(); return; } coefs[j] = x; touched = true; changed(); };
        repeatable(up, () => set(coefs[j] + 1), signal);
        repeatable(down, () => set(coefs[j] - 1), signal);
        input.addEventListener('focus', () => { try { input.select(); } catch (e) { /* not a text field after all */ } }, { signal });
        input.addEventListener('input', () => {
          const v = input.value.replace(/\D/g, '');
          if (v !== input.value) input.value = v;
          const x = Number(v);
          if (v && x >= 1 && x <= max) set(x);
        }, { signal });
        input.addEventListener('blur', () => { input.value = String(coefs[j]); }, { signal });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); set(coefs[j] + 1); input.select(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); set(coefs[j] - 1); input.select(); }
          else if (e.key === 'Home') { e.preventDefault(); set(1); }
        }, { signal });
        boxes.push({ input, up, down, sp });
      });
      root.appendChild(line);

      // the molecules on each side
      const scene = el('div', 'chm-scene', { 'aria-hidden': 'true' });
      const panes = [el('div', 'chm-pane'), el('div', 'chm-pane')];
      scene.append(panes[0], el('span', 'chm-scene__arrow', null, '→'), panes[1]);
      root.appendChild(scene);
      const groups = eq.species.map((sp, j) => {
        const g = el('div', 'chm-group');
        g.title = C.plain(sp.text);
        panes[j < nL ? 0 : 1].appendChild(g);
        return { g, sp, shown: 0, more: null };
      });
      const SHOW = 10;
      const big = (sp) => Object.values(sp.atoms).reduce((a, b) => a + b, 0);
      function paintGroups(grow) {
        groups.forEach((G, j) => {
          const want = Math.min(SHOW, coefs[j]);
          while (G.shown > want) { G.g.removeChild(G.g.querySelectorAll('.chm-mol')[G.shown - 1]); G.shown--; }
          while (G.shown < want) {
            const m = toDom(moleculeTree(G.sp, big(G.sp) > 8 ? 34 : 26));
            if (grow && !fr.reduce) m.classList.add('is-new');
            if (G.more) G.g.insertBefore(m, G.more); else G.g.appendChild(m);
            G.shown++;
          }
          const extra = coefs[j] - want;
          if (extra > 0) {
            if (!G.more) { G.more = el('span', 'chm-more'); G.g.appendChild(G.more); }
            G.more.textContent = '+' + extra;
          } else if (G.more) { G.g.removeChild(G.more); G.more = null; }
        });
      }

      // the count of each element on each side
      const table = el('div', 'chm-tally', { role: 'table', 'aria-label': t('Atoms on each side') });
      const head = el('div', 'chm-row chm-row--head', { role: 'row' });
      head.append(el('span', 'chm-cell chm-sym', { role: 'columnheader' }, t('Element')), el('span', 'chm-cell chm-head is-left', { role: 'columnheader' }, t('Reactants (left)')),
        el('span', 'chm-cell chm-mark', { role: 'columnheader', 'aria-label': t('Equal?') }), el('span', 'chm-cell chm-head is-right', { role: 'columnheader' }, t('Products (right)')));
      table.appendChild(head);
      const rows = C.tally(eq, coefs).map((r) => {
        const row = el('div', 'chm-row', { role: 'row' });
        const sym = el('span', 'chm-cell chm-sym', { role: 'rowheader' });
        if (r.el) {
          const dot = el('span', 'chm-ball', { 'aria-hidden': 'true' });
          dot.style.background = colorOf(r.el);
          sym.append(dot, el('span', 'chm-sym__t', { title: t(C.nameOf(C.zOf(r.el))) }, r.el));
        } else sym.appendChild(el('span', 'chm-sym__t chm-sym__q', null, t('Charge')));
        const L = el('span', 'chm-cell chm-side is-left', { role: 'cell' }), R = el('span', 'chm-cell chm-side is-right', { role: 'cell' });
        const mark = el('span', 'chm-cell chm-mark', { role: 'cell' });
        row.append(sym, L, mark, R);
        table.appendChild(row);
        return { row, L, R, mark, el: r.el, was: [0, 0] };
      });
      root.appendChild(table);
      const status = el('p', 'chm-status', { role: 'status' });
      root.appendChild(status);
      if (!isTask) root.appendChild(foot(fr, t('Change the numbers in front of the formulas until every row is green.'), () => { coefs = spec.start.slice(); touched = false; paint(); }));
      else root.appendChild(foot(fr, t('Change the numbers in front of the formulas until every row is green.'), null));
      fr.mount();

      function side(cell, n, isCharge, sym, grow) {
        cell.textContent = '';
        const num = el('b', 'chm-num', null, isCharge ? signed(n) : String(n));
        const dots = el('span', 'chm-dots', { 'aria-hidden': 'true' });
        if (!isCharge && n <= 24) {
          for (let i = 0; i < n; i++) {
            const d = el('i', 'chm-dot' + (grow && i >= grow ? ' is-new' : ''));
            d.style.background = colorOf(sym);
            dots.appendChild(d);
          }
        }
        cell.append(dots, num);
      }
      function paint(grow) {
        const tl = C.tally(eq, coefs);
        let allOk = true;
        const off = [];
        tl.forEach((r, i) => {
          const R = rows[i];
          const ok = r.left === r.right;
          if (!ok) { allOk = false; off.push(r); }
          side(R.L, r.left, !r.el, r.el, grow && !fr.reduce && r.left > R.was[0] ? R.was[0] : 0);
          side(R.R, r.right, !r.el, r.el, grow && !fr.reduce && r.right > R.was[1] ? R.was[1] : 0);
          R.was = [r.left, r.right];
          R.row.classList.toggle('is-ok', ok);
          R.row.classList.toggle('is-off', !ok);
          R.mark.textContent = ok ? '=' : '≠';
          R.mark.setAttribute('aria-label', ok ? t('equal') : t('not equal'));
        });
        boxes.forEach((b, j) => {
          if (document.activeElement !== b.input || Number(b.input.value) !== coefs[j]) b.input.value = String(coefs[j]);
          b.input.setAttribute('aria-valuenow', coefs[j]);
          b.input.classList.toggle('is-one', coefs[j] === 1);
          b.down.disabled = locked || coefs[j] <= 1;
          b.up.disabled = locked || coefs[j] >= max;
          if (coefs[j] <= 1) b.down.setAttribute('data-off', ''); else b.down.removeAttribute('data-off');
          if (coefs[j] >= max) b.up.setAttribute('data-off', ''); else b.up.removeAttribute('data-off');
        });
        paintGroups(grow);
        const g = coefs.reduce((a, b) => { let x = a, y = b; while (y) [x, y] = [y, x % y]; return x; }, 0);
        let msg;
        if (allOk) msg = !isTask && g > 1 ? fill('Balanced. Every number can be divided by {n}, so the smallest whole numbers are {c}.', { n: g, c: coefs.map((x) => x / g).join(', ') }) : t('Balanced: every element has the same number of atoms on both sides.');
        else msg = t('Not balanced yet.');
        status.textContent = msg;
        status.classList.toggle('is-ok', allOk);
        root.classList.toggle('is-balanced', allOk);
        fr.speak((off.length ? off.slice(0, 3).map((r) => noteRow(r, fill, t)).join('. ') + '. ' : '') + msg);
      }
      function changed() { paint(true); fr.changed(value()); }
      const value = () => (touched ? { c: coefs.slice() } : null);
      paint(false);

      return {
        value,
        reset() { coefs = spec.start.slice(); touched = false; paint(false); },
        reveal() { coefs = answer.slice(); touched = true; paint(true); },
        lock(on) { locked = Boolean(on); fr.lock(on); boxes.forEach((b) => { b.input.readOnly = locked; }); paint(false); },
        destroy: fr.destroy
      };
    }
    function noteRow(r, fill, t) {
      return r.el ? fill('{el}: {l} on the left, {r} on the right', { el: r.el, l: r.left, r: r.right })
        : fill('Charge: {l} on the left, {r} on the right', { l: signed(r.left), r: signed(r.right) });
    }

    /* ================= atom ================= */

    function atomView(host, spec, goal, ctx) {
      const isTask = Boolean(goal);
      const fr = frame(host, 'atom', ctx, isTask);
      const { t, fill, root, signal } = fr;
      const lim = C.atomLimits(spec.max);
      const hide = new Set(spec.hide || []);
      const locked0 = new Set(spec.lock || []);
      const start0 = { p: spec.protons, n: spec.neutrons, e: spec.electrons };
      let st = Object.assign({}, start0), touched = false, locked = false;
      root.setAttribute('aria-label', t('Build an atom'));

      const wrap = el('div', 'chm-atom');
      const pic = el('div', 'chm-pic');
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', '-120 -120 240 240');
      svg.setAttribute('class', 'chm-bohr');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const gRings = document.createElementNS(SVGNS, 'g');
      const gNuc = document.createElementNS(SVGNS, 'g');
      gNuc.setAttribute('class', 'chm-nucleus');
      svg.append(gRings, gNuc);
      const orbits = [0, 1, 2, 3, 4].map((k) => {
        const g = document.createElementNS(SVGNS, 'g');
        g.setAttribute('class', `chm-orbit chm-orbit--${k}` + (fr.reduce ? '' : ' is-moving'));
        svg.appendChild(g);
        return g;
      });
      pic.appendChild(svg);

      const panel = el('div', 'chm-panel');
      const nota = el('div', 'chm-nota', { 'aria-hidden': 'true' });
      const az = el('span', 'chm-nota__az');
      const aEl = el('span', 'chm-nota__a'), zEl = el('span', 'chm-nota__z');
      az.append(aEl, zEl);
      const xEl = el('span', 'chm-nota__x'), qEl = el('span', 'chm-nota__q');
      nota.append(az, xEl, qEl);
      const nameEl = el('p', 'chm-name');
      const kindEl = el('p', 'chm-kind');
      const facts = el('dl', 'chm-facts');
      const fact = (key, label) => {
        const d = el('div', 'chm-fact');
        const v = el('dd');
        d.append(el('dt', null, null, label), v);
        if (!hide.has(key)) facts.appendChild(d);
        return v;
      };
      const fZ = fact('z', t('Atomic number (Z)'));
      const fA = fact('mass', t('Mass number (A)'));
      const fQ = fact('charge', t('Charge'));
      const fS = fact('shells', t('Shells'));
      const fV = fact('valence', t('Valence electrons'));
      const fSt = fact('stable', t('Stable?'));
      panel.append(nota, nameEl, kindEl, facts);
      wrap.append(pic, panel);
      root.appendChild(wrap);

      // the three counts
      const ctls = el('div', 'chm-ctls');
      const KINDS = [
        { k: 'p', key: 'protons', label: t('Protons'), add: t('Add a proton'), rem: t('Remove a proton'), lo: 1, hi: lim.p, color: PROTON },
        { k: 'n', key: 'neutrons', label: t('Neutrons'), add: t('Add a neutron'), rem: t('Remove a neutron'), lo: 0, hi: lim.n, color: NEUTRON },
        { k: 'e', key: 'electrons', label: t('Electrons'), add: t('Add an electron'), rem: t('Remove an electron'), lo: 0, hi: lim.e, color: ELECTRON }
      ];
      const ctlEls = {};
      KINDS.forEach((K) => {
        const row = el('div', 'chm-ctl' + (locked0.has(K.key) ? ' is-fixed' : ''), { role: 'group' });
        const id = `chm-${++uid}`;
        const name = el('span', 'chm-ctl__name', { id });
        const ball = el('span', 'chm-ball chm-ball--' + K.k, { 'aria-hidden': 'true' });
        ball.style.background = K.color;
        name.append(ball, document.createTextNode(K.label));
        row.setAttribute('aria-labelledby', id);
        const minus = stepBtn('chm-btn--minus', K.rem, MINUS);
        const out = el('output', 'chm-ctl__n', { 'aria-live': 'off' });
        const plus = stepBtn('chm-btn--plus', K.add, '+');
        row.append(name, minus, out, plus);
        if (locked0.has(K.key)) {
          row.appendChild(el('span', 'chm-ctl__lock', null, t('fixed')));
          minus.setAttribute('data-off', ''); plus.setAttribute('data-off', '');
          minus.disabled = plus.disabled = true;
        } else {
          const set = (v) => { if (locked) return; const x = Math.max(K.lo, Math.min(K.hi, v)); if (x === st[K.k]) return; st[K.k] = x; touched = true; changed(); };
          repeatable(plus, () => set(st[K.k] + 1), signal);
          repeatable(minus, () => set(st[K.k] - 1), signal);
        }
        ctls.appendChild(row);
        ctlEls[K.k] = { out, plus, minus, K };
      });
      root.appendChild(ctls);
      root.appendChild(foot(fr, isTask ? '' : t('Add and remove particles to see what changes. Hold a button to keep going.'),
        isTask ? null : () => { st = Object.assign({}, start0); touched = false; paint(); }));
      fr.mount();

      let was = null; // the last counts drawn: what is new gets a little pop
      function paint() {
        const { p, n, e } = st;
        const f = C.atomFacts(p, n, e);
        // the picture
        const nu = nucleus(p, n);
        const sh = f.shells;
        const radii = ringRadii(nu.R, sh.length);
        while (gRings.firstChild) gRings.removeChild(gRings.firstChild);
        radii.forEach((r, s) => {
          gRings.appendChild(toDom(h('circle', { cx: 0, cy: 0, r: r1(r), class: 'chm-ring' })));
          if (!hide.has('shells')) gRings.appendChild(toDom(h('text', { x: r1(r * 0.81), y: r1(-r * 0.6), class: 'chm-ring__k' }, [SHELL_NAMES[s]])));
        });
        const prevNu = was ? nucleus(was.p, was.n).balls : [];
        while (gNuc.firstChild) gNuc.removeChild(gNuc.firstChild);
        nu.balls.slice().reverse().forEach((b) => {
          const c = toDom(h('circle', { cx: r1(b.x), cy: r1(b.y), r: r1(nu.rb), class: 'chm-nuc chm-nuc--' + b.type }));
          c.style.fill = b.type === 'p' ? PROTON : NEUTRON;
          if (was && !fr.reduce && (!prevNu[b.k] || prevNu[b.k].type !== b.type)) c.classList.add('is-new');
          gNuc.appendChild(c);
        });
        const prevSh = was ? C.shells(was.p, was.e) : [];
        orbits.forEach((g) => { while (g.firstChild) g.removeChild(g.firstChild); });
        electronPoints(sh, radii).forEach((pt) => {
          const c = toDom(h('circle', { cx: r1(pt.x), cy: r1(pt.y), r: 4.6, class: 'chm-el' }));
          if (was && !fr.reduce && pt.i >= (prevSh[pt.s] || 0)) c.classList.add('is-new');
          orbits[Math.min(4, pt.s)].appendChild(c);
        });
        was = { p, n, e };
        // the notation and the facts
        const hideName = hide.has('name');
        aEl.textContent = hide.has('mass') ? '?' : String(f.A);
        zEl.textContent = String(p);
        xEl.textContent = hideName ? '?' : f.symbol;
        qEl.textContent = hide.has('charge') ? '' : chargeSup(f.charge);
        nameEl.textContent = hideName ? t('Which element is this?') : hide.has('mass') ? t(f.name) : isoName(p, n, t, fill);
        kindEl.textContent = hide.has('charge') ? '' : hideName && f.ionName ? (f.charge > 0 ? t('a positive ion (cation)') : t('a negative ion (anion)')) : ionLabel(f, t, fill);
        kindEl.classList.toggle('is-ion', Boolean(f.charge));
        fZ.textContent = String(p);
        fA.textContent = `${p} + ${n} = ${f.A}`;
        fQ.textContent = `${p} ${MINUS} ${e} = ${signed(f.charge)}`;
        fS.textContent = sh.length ? sh.join(', ') : '—';
        fV.textContent = String(f.valence);
        const iso = hideName ? '' : isoName(p, n, t, fill);
        if (f.stable) { fSt.textContent = hideName ? t('Yes: a stable isotope') : fill('Yes: {iso} is a stable isotope', { iso }); fSt.className = 'is-yes'; }
        else {
          fSt.textContent = hideName ? t('No: this isotope is radioactive') : fill('No: {iso} is radioactive. Stable: {list}', { iso, list: andList(f.stableN.slice().sort((a, b) => a - b).map((x) => isoName(p, x, t, fill))) });
          fSt.className = 'is-no';
        }
        Object.values(ctlEls).forEach(({ out, plus, minus, K }) => {
          out.textContent = String(st[K.k]);
          if (locked0.has(K.key)) return;
          minus.disabled = locked || st[K.k] <= K.lo;
          plus.disabled = locked || st[K.k] >= K.hi;
          if (st[K.k] <= K.lo) minus.setAttribute('data-off', ''); else minus.removeAttribute('data-off');
          if (st[K.k] >= K.hi) plus.setAttribute('data-off', ''); else plus.removeAttribute('data-off');
        });
        fr.speak([
          hideName ? '' : isoName(p, n, t, fill) + ',',
          hide.has('charge') ? '' : ionLabel(f, t, fill) + '.',
          fill('Protons: {p}, neutrons: {n}, electrons: {e} ({sym})', { p, n, e, sym: hideName ? '?' : symCharge(p, e) }) + '.',
          hide.has('shells') ? '' : fill('Shells: {s}.', { s: sh.join(', ') || '0' })
        ].filter(Boolean).join(' '));
      }
      function changed() { paint(); fr.changed(value()); }
      const value = () => (touched ? { p: st.p, n: st.n, e: st.e } : null);
      paint();

      return {
        value,
        reset() { st = Object.assign({}, start0); touched = false; was = null; paint(); },
        reveal() { const s = C.solution(spec, goal); if (!s) return; st = { p: s.p, n: s.n, e: s.e }; touched = true; paint(); },
        lock(on) { locked = Boolean(on); fr.lock(on); paint(); },
        destroy: fr.destroy
      };
    }

    /* ================= compound ================= */

    // the criss-cross method as school books draw it: the symbols, their valencies under them, arrows that
    // cross over, each valency becoming the other's count; then the formula (divided down if it can be)
    function crissTree(cat, an, t, size) {
      const fs = size || 22;
      const k = C.crissCross(cat, an);
      const raw = [Math.abs(an.charge), Math.abs(cat.charge)]; // crossed over, before dividing
      const part = (ion, n) => (n === 1 ? ion.body : ion.poly ? `(${ion.body})${n}` : ion.body + n);
      const pc = part(cat, raw[0]), pa = part(an, raw[1]);
      const wc = Math.max(textWidth(cat.body, fs), textWidth(pc, fs)), wa = Math.max(textWidth(an.body, fs), textWidth(pa, fs));
      const xc = 64 + wc / 2, xa = xc + wc / 2 + 62 + wa / 2;
      const formula = C.formulaOf(cat, an, k[0], k[1]);
      const wf = textWidth(formula, fs + 2);
      const xr = xa + wa / 2 + 28;
      const W = Math.round(xr + 24 + wf + 14);
      const g = gcdOf(cat.charge, an.charge); // Ca2+ and O2- cross to Ca2O2, written CaO
      const H = g > 1 ? 138 : 124;
      const id = 'chm-ar-' + (++uid);
      const arrow = (x1, x2) => h('path', { d: `M${r1(x1)} 59 L${r1(x2)} 93`, stroke: GOLD, 'stroke-width': 1.6, fill: 'none', 'marker-end': `url(#${id})` });
      const kids = [
        h('defs', {}, [h('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, [h('path', { d: 'M0 0 L10 5 L0 10 z', fill: GOLD })])]),
        h('text', { x: 6, y: 52, 'font-size': 12, fill: SOFT, 'font-style': 'italic' }, [t('valency')]),
        h('text', { x: r1(xc), y: 26, 'font-size': fs, 'text-anchor': 'middle', fill: INK }, formulaSvg(cat.body, fs)),
        h('text', { x: r1(xa), y: 26, 'font-size': fs, 'text-anchor': 'middle', fill: INK }, formulaSvg(an.body, fs)),
        h('text', { x: r1(xc), y: 52, 'font-size': 16, 'text-anchor': 'middle', fill: GOLD, 'font-weight': 700 }, [String(raw[1])]),
        h('text', { x: r1(xa), y: 52, 'font-size': 16, 'text-anchor': 'middle', fill: GOLD, 'font-weight': 700 }, [String(raw[0])]),
        arrow(xc + 8, xa + textWidth(pa, fs) / 2 - 2),
        arrow(xa - 8, xc + textWidth(pc, fs) / 2 - 2),
        h('text', { x: r1(xc), y: 112, 'font-size': fs, 'text-anchor': 'middle', fill: INK }, formulaSvg(pc, fs)),
        h('text', { x: r1(xa), y: 112, 'font-size': fs, 'text-anchor': 'middle', fill: INK }, formulaSvg(pa, fs)),
        h('text', { x: r1(xr), y: 112, 'font-size': fs, 'text-anchor': 'middle', fill: SOFT }, ['→']),
        h('text', { x: r1(xr + 20), y: 112, 'font-size': fs + 2, fill: INK, 'font-weight': 700 }, formulaSvg(formula, fs + 2))
      ];
      if (g > 1) kids.push(h('text', { x: r1(xr + 20), y: 132, 'font-size': 12, fill: SOFT, 'font-style': 'italic' }, [F('both divided by {n}', { n: g })]));
      return h('svg', { xmlns: SVGNS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chm-cross', role: 'img', 'aria-label': F('Criss-cross: {a} and {b} make {f}', { a: C.plain(cat.text), b: C.plain(an.text), f: C.plain(formula) }) }, kids);
    }
    const gcdOf = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
    function compoundName(cat, an, t, fill) {
      if (!cat.name || !an.name) return '';
      return fill('{cation} {anion}', { cation: t(cat.name), anion: t(an.name) });
    }

    function compoundView(host, spec, goal, ctx) {
      const isTask = Boolean(goal);
      const fr = frame(host, 'compound', ctx, isTask);
      const { t, fill, root, signal } = fr;
      const ions = spec.ions.map(C.parseIon);
      const cats = ions.filter((x) => x.charge > 0), ans = ions.filter((x) => x.charge < 0);
      const MAXN = C.LIMITS.count;
      const blank = () => (isTask ? { c: null, a: null, n: [1, 1] } : { c: cats[0], a: ans[0], n: [1, 1] });
      let st = blank(), touched = false, locked = false;
      root.setAttribute('aria-label', t('Make a compound from ions'));

      const pick = el('div', 'chm-pick');
      const name = `chm-ion-${++uid}`;
      const radios = [];
      function chooser(list, title, which) {
        const fs = el('fieldset', 'chm-ions');
        fs.appendChild(el('legend', null, null, title));
        const box = el('div', 'chm-ions__list');
        list.forEach((ion) => {
          const lab = el('label', 'chm-chip');
          const r = el('input', null, { type: 'radio', name: name + which, value: ion.text });
          r.addEventListener('change', () => { if (locked || !r.checked) return; st[which] = ion; st.n = [1, 1]; touched = true; changed(); }, { signal });
          const txt = el('span', 'chm-chip__t');
          txt.appendChild(formulaEl(ion.text));
          if (ion.name) txt.appendChild(el('small', null, null, t(ion.name)));
          lab.append(r, txt);
          box.appendChild(lab);
          radios.push({ r, ion, which });
        });
        fs.appendChild(box);
        return fs;
      }
      pick.append(chooser(cats, t('Positive ions (cations)'), 'c'), chooser(ans, t('Negative ions (anions)'), 'a'));
      root.appendChild(pick);

      const mix = el('div', 'chm-mix');
      const counts = el('div', 'chm-counts');
      const cnt = [0, 1].map((i) => {
        const row = el('div', 'chm-count');
        const minus = stepBtn('chm-btn--minus', '', MINUS), plus = stepBtn('chm-btn--plus', '', '+');
        const out = el('output', 'chm-count__n');
        const lab = el('span', 'chm-count__ion');
        row.append(minus, out, plus, el('span', 'chm-count__x', { 'aria-hidden': 'true' }, '×'), lab);
        const set = (v) => { if (locked) return; const x = Math.max(1, Math.min(MAXN, v)); if (x === st.n[i]) return; st.n[i] = x; touched = true; changed(); };
        repeatable(plus, () => set(st.n[i] + 1), signal);
        repeatable(minus, () => set(st.n[i] - 1), signal);
        counts.appendChild(row);
        return { row, minus, plus, out, lab };
      });
      const bars = el('div', 'chm-bars', { 'aria-hidden': 'true' });
      const barRows = [el('div', 'chm-bar chm-bar--pos'), el('div', 'chm-bar chm-bar--neg')];
      bars.append(barRows[0], barRows[1]);
      const total = el('p', 'chm-total');
      const result = el('div', 'chm-result', { role: 'status' });
      mix.append(counts, bars, total, result);
      root.appendChild(mix);
      const cross = isTask ? null : el('figure', 'chm-crossbox');
      if (cross) root.appendChild(cross);
      root.appendChild(foot(fr, isTask ? t('Choose a positive ion and a negative ion, then how many of each.') : t('Choose two ions, then change how many of each until the charges cancel.'),
        isTask ? null : () => { st = blank(); touched = false; paint(); }));
      fr.mount();

      function paint() {
        radios.forEach(({ r, ion, which }) => {
          r.checked = st[which] === ion;
          r.closest('.chm-chip').classList.toggle('is-on', r.checked);
          r.disabled = locked;
        });
        const both = Boolean(st.c && st.a);
        mix.hidden = !both;
        if (cross) cross.hidden = !both;
        if (!both) { fr.speak(t('Choose a positive ion and a negative ion.')); return; }
        const pair = [st.c, st.a];
        pair.forEach((ion, i) => {
          const c = cnt[i];
          c.out.textContent = String(st.n[i]);
          c.lab.textContent = '';
          c.lab.appendChild(formulaEl(ion.text));
          c.minus.setAttribute('aria-label', fill('One less {ion}', { ion: C.plain(ion.text) }));
          c.plus.setAttribute('aria-label', fill('One more {ion}', { ion: C.plain(ion.text) }));
          c.minus.disabled = locked || st.n[i] <= 1;
          c.plus.disabled = locked || st.n[i] >= MAXN;
        });
        // the bars: one tile per ion, as wide as its charge
        const pos = st.n[0] * st.c.charge, neg = st.n[1] * -st.a.charge;
        const units = Math.max(pos, neg, 1);
        barRows.forEach((row, i) => {
          row.textContent = '';
          const ion = pair[i];
          for (let k = 0; k < st.n[i]; k++) {
            const tile = el('span', 'chm-tile');
            tile.style.width = `${(Math.abs(ion.charge) / units) * 100}%`;
            tile.style.setProperty('--u', String(Math.abs(ion.charge)));
            tile.appendChild(formulaEl(ion.text));
            row.appendChild(tile);
          }
        });
        const sum = pos - neg;
        bars.classList.toggle('is-even', sum === 0);
        total.textContent = fill('Total charge: {sum} = {total}', {
          sum: `${st.n[0]} × (${signed(st.c.charge)}) + ${st.n[1]} × (${signed(st.a.charge)})`, total: signed(sum)
        });
        total.classList.toggle('is-ok', sum === 0);
        result.textContent = '';
        const low = C.crissCross(st.c, st.a);
        const g = gcdOf(st.n[0], st.n[1]);
        let said;
        if (sum === 0) {
          const f = C.formulaOf(st.c, st.a, st.n[0], st.n[1]);
          const nm = compoundName(st.c, st.a, t, fill);
          if (g > 1) {
            result.className = 'chm-result is-near';
            result.appendChild(el('span', 'chm-result__note', null, isTask ? t('Neutral, but a formula uses the smallest whole numbers.') : fill('Neutral, but a formula uses the smallest whole numbers: divide both by {n}.', { n: g })));
            if (!isTask) result.appendChild(formulaEl(C.formulaOf(st.c, st.a, low[0], low[1]), 'chm-result__f'));
            said = t('Neutral, but a formula uses the smallest whole numbers.');
          } else {
            result.className = 'chm-result is-ok';
            result.appendChild(formulaEl(f, 'chm-result__f'));
            if (nm) result.appendChild(el('span', 'chm-result__name', null, nm));
            said = fill('Neutral: {f}', { f: C.plain(f) }) + (nm ? ' (' + nm + ')' : '') + '.';
          }
        } else {
          result.className = 'chm-result is-off';
          const need = sum > 0 ? st.a : st.c;
          result.appendChild(el('span', 'chm-result__note', null, fill('Not neutral yet: add more {ion}, or fewer of the other.', { ion: C.plain(need.text) })));
          said = fill('Not neutral yet: add more {ion}, or fewer of the other.', { ion: C.plain(need.text) });
        }
        if (cross) {
          cross.textContent = '';
          cross.appendChild(el('figcaption', null, null, t('The criss-cross method: each ion’s valency becomes the other’s number.')));
          cross.appendChild(toDom(crissTree(st.c, st.a, t)));
        }
        fr.speak(total.textContent + '. ' + said);
      }
      function changed() { paint(); fr.changed(value()); }
      const value = () => (st.c && st.a && touched ? { ions: [st.c.text, st.a.text], n: st.n.slice() } : null);
      paint();

      return {
        value,
        reset() { st = blank(); touched = false; paint(); },
        reveal() {
          const s = C.solution(spec, goal);
          if (!s) return;
          st = { c: ions.find((x) => x.text === s.ions[0]), a: ions.find((x) => x.text === s.ions[1]), n: s.n.slice() };
          touched = true;
          paint();
        },
        lock(on) { locked = Boolean(on); fr.lock(on); paint(); },
        destroy: fr.destroy
      };
    }

    /* ---------------- checked once, kept ---------------- */

    const checked = new WeakMap(); // spec -> (goal or the spec itself) -> clean result, or null
    function cleanSpec(spec) {
      if (!spec || typeof spec !== 'object') return null;
      let m = checked.get(spec);
      if (!m) { m = new WeakMap(); checked.set(spec, m); }
      if (!m.has(spec)) { let v = null; try { v = C.normSpec(spec); } catch (e) { v = null; } m.set(spec, v); }
      return m.get(spec);
    }
    function cleanTask(spec, goal) {
      if (!spec || typeof spec !== 'object' || !goal || typeof goal !== 'object') return null;
      let m = checked.get(spec);
      if (!m) { m = new WeakMap(); checked.set(spec, m); }
      if (!m.has(goal)) { let v = null; try { v = C.normTask(spec, goal); } catch (e) { v = null; } m.set(goal, v); }
      return m.get(goal);
    }
    const VIEWS = { balance: balanceView, atom: atomView, compound: compoundView };

    /* ---------------- still pictures (the book, print, EPUB) ---------------- */

    function stillBalance(spec, goal) {
      const eq = C.parseEquation(spec.equation);
      const fs = 22, gap = 14, box = 26;
      const nL = eq.left.length;
      const items = [];
      let x = 12;
      eq.species.forEach((sp, j) => {
        if (j) {
          const op = j === nL ? '→' : '+';
          const room = gap + (op === '→' ? 26 : 16);
          items.push({ kind: 'op', x: x + room / 2, text: op });
          x += room;
        }
        const c = goal ? null : spec.start[j];
        const cw = goal ? box + 6 : c > 1 ? textWidth(String(c), fs) + 5 : 0;
        const fw = textWidth(sp.text, fs);
        items.push({ kind: 'sp', x, cw, fw, sp, c });
        x += cw + fw;
      });
      const W = Math.round(x + 12);
      const kids = [];
      items.forEach((it) => {
        if (it.kind === 'op') { kids.push(h('text', { x: r1(it.x), y: 92, 'font-size': fs, fill: SOFT, 'text-anchor': 'middle' }, [it.text])); return; }
        if (goal) kids.push(h('rect', { x: r1(it.x), y: 72, width: box, height: box, rx: 3, fill: '#fffaf0', stroke: GOLD, 'stroke-width': 1.3 }));
        else if (it.c > 1) kids.push(h('text', { x: r1(it.x), y: 92, 'font-size': fs, fill: INK, 'font-weight': 700 }, [String(it.c)]));
        kids.push(h('text', { x: r1(it.x + it.cw), y: 92, 'font-size': fs, fill: INK }, formulaSvg(it.sp.text, fs)));
        // one molecule of each, above its formula
        const mol = moleculeTree(it.sp, 40);
        const mw = Number(mol.attrs.width), mh = Number(mol.attrs.height);
        mol.attrs.x = r1(it.x + it.cw + it.fw / 2 - mw / 2);
        mol.attrs.y = r1(58 - mh);
        delete mol.attrs.class;
        kids.push(mol);
      });
      return toStr(h('svg', { xmlns: SVGNS, viewBox: `0 0 ${W} 112`, width: W, height: 112, role: 'img', 'aria-label': C.eqPlain(eq, goal ? null : spec.start, goal ? '□' : '') , 'font-family': 'Georgia, \'Times New Roman\', serif' }, kids));
    }
    function stillAtom(spec) {
      const { protons: p, neutrons: n, electrons: e } = spec;
      const f = C.atomFacts(p, n, e);
      const hide = new Set(spec.hide || []);
      const pic = bohrTree(p, n, e);
      pic.attrs.x = 0; pic.attrs.y = 0; pic.attrs.width = 200; pic.attrs.height = 200;
      delete pic.attrs.role; delete pic.attrs['aria-label'];
      const sym = hide.has('name') ? '?' : f.symbol;
      const kids = [pic,
        h('text', { x: 232, y: 78, 'font-size': 16, fill: SOFT, 'text-anchor': 'end' }, [hide.has('mass') ? '?' : String(f.A)]),
        h('text', { x: 232, y: 112, 'font-size': 16, fill: SOFT, 'text-anchor': 'end' }, [String(p)]),
        h('text', { x: 236, y: 106, 'font-size': 44, fill: INK }, [sym]),
        h('text', { x: 236 + textWidth(sym, 44) + 2, y: 76, 'font-size': 18, fill: INK }, [hide.has('charge') ? '' : chargeSup(f.charge)]),
        h('circle', { cx: 222, cy: 146, r: 5, fill: PROTON }), h('text', { x: 232, y: 151, 'font-size': 13, fill: INK }, [`${T('Protons')}: ${p}`]),
        h('circle', { cx: 222, cy: 166, r: 5, fill: NEUTRON }), h('text', { x: 232, y: 171, 'font-size': 13, fill: INK }, [`${T('Neutrons')}: ${n}`]),
        h('circle', { cx: 222, cy: 186, r: 5, fill: ELECTRON }), h('text', { x: 232, y: 191, 'font-size': 13, fill: INK }, [`${T('Electrons')}: ${e}`])
      ];
      return toStr(h('svg', { xmlns: SVGNS, viewBox: '0 0 360 200', width: 360, height: 200, role: 'img', 'aria-label': atomSentence(p, n, e), 'font-family': 'Georgia, \'Times New Roman\', serif' }, kids));
    }
    // the ions to choose from (no criss-cross: the book draws a task with no goal, and it could give the answer away)
    function stillCompound(spec) {
      const ions = spec.ions.map(C.parseIon);
      const fs = 19;
      const rows = [ions.filter((x) => x.charge > 0), ions.filter((x) => x.charge < 0)];
      const kids = [];
      let W = 0;
      rows.forEach((list, r) => {
        let x = 10;
        const y = 14 + r * 46;
        list.forEach((ion) => {
          const w = textWidth(ion.text, fs) + 22;
          kids.push(h('rect', { x: r1(x), y, width: r1(w), height: 34, rx: 17, fill: r ? '#eef1f7' : '#f7ece6', stroke: r ? ELECTRON : PROTON, 'stroke-opacity': 0.6 }));
          kids.push(h('text', { x: r1(x + 11), y: y + 23, 'font-size': fs, fill: INK }, formulaSvg(ion.text, fs)));
          x += w + 8;
        });
        W = Math.max(W, x + 4);
      });
      const H = 106;
      W = Math.round(Math.max(W, 120));
      return toStr(h('svg', { xmlns: SVGNS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': ions.map((x) => C.plain(x.text)).join(', '), 'font-family': 'Georgia, \'Times New Roman\', serif' }, kids));
    }

    /* ---------------- the kind ---------------- */

    function failed(host, err) {
      host.classList.remove('is-loading');
      host.classList.add('is-failed');
      host.textContent = T('This interactive part couldn’t be shown here.');
      if (err) console.warn('[Primer] chem:', err.message || err);
      return null;
    }

    P.widgets.register('chem', {
      block(host, spec, ctx) {
        const s = cleanSpec(spec);
        if (!s) return failed(host, new Error('this chemistry part does not hold together'));
        return VIEWS[s.mode](host, s, null, ctx || {});
      },
      task(host, spec, goal, ctx) {
        const r = cleanTask(spec, goal);
        if (!r) return failed(host, new Error('this chemistry task does not hold together'));
        return VIEWS[r.spec.mode](host, r.spec, r.goal, ctx || {});
      },

      check(goal, value, spec) {
        const r = cleanTask(spec, goal);
        if (!r) return { correct: false, invalid: true };
        const res = C.check(r.spec, r.goal, value);
        const why = res.why || {};
        let note = '';
        if (r.spec.mode === 'balance') {
          if (why.rows) note = why.rows.slice(0, 2).map((x) => noteRow(x, F, T)).join('; ') + '.';
          else if (why.divide) note = F('It balances, but every number can be divided by {n}: use the smallest whole numbers.', { n: why.divide });
        } else if (r.spec.mode === 'atom') {
          const f = why.facts;
          const hideName = (r.spec.hide || []).includes('name');
          if (f) {
            const iso = isoName(f.Z, f.N, T);
            note = {
              element: hideName ? F('Protons: {p}.', { p: f.Z }) : F('That is {name} (atomic number {p}).', { name: T(f.name), p: f.Z }),
              protons: F('Protons: {p}.', { p: f.Z }),
              mass: F('Its mass number is {a} (protons + neutrons).', { a: f.A }),
              neutrons: F('Neutrons: {n}.', { n: f.N }),
              electrons: F('Electrons: {e}.', { e: f.electrons }),
              charge: r.goal.charge === 0 ? F('Its charge is {c}: an atom has as many electrons as protons.', { c: signed(f.charge) }) : F('Its charge is {c}.', { c: signed(f.charge) }),
              valence: F('Electrons in the outer shell: {v}.', { v: f.valence }),
              stable: r.goal.stable ? F('{iso} is not stable.', { iso }) : F('{iso} is stable.', { iso })
            }[why.atom] || '';
          }
        } else if (why.pick) note = T('Choose a positive ion and a negative ion.');
        else if (why.charge) note = F('The charges don’t cancel yet: the total is {c}.', { c: signed(why.charge) });
        else if (why.divide) note = T('It is neutral, but use the smallest whole numbers.');
        else if (why.other) note = F('Those ions make {f}.', { f: C.plain(why.other) });
        return res.invalid ? { correct: false, invalid: true, note } : { correct: res.correct, note: res.correct ? '' : note };
      },

      describe(value, spec) {
        if (!value || typeof value !== 'object') return '';
        let mode;
        try { mode = C.modeOf(spec); } catch (e) { return ''; }
        try {
          if (mode === 'balance') {
            const eq = C.parseEquation(spec.equation);
            return Array.isArray(value.c) && value.c.length === eq.species.length ? C.eqPlain(eq, value.c.map((x) => Math.max(1, Math.floor(Number(x)) || 1))) : '';
          }
          if (mode === 'atom') {
            const { p, n, e } = value;
            return [p, n, e].every((x) => Number.isInteger(x) && x >= 0 && x <= 99) && p >= 1 && p <= 118 ? atomSentence(p, n, e) : '';
          }
          if (!Array.isArray(value.ions) || value.ions.length !== 2 || !Array.isArray(value.n)) return '';
          const a = C.parseIon(value.ions[0]), b = C.parseIon(value.ions[1]);
          const k = value.n.map((x) => Math.max(1, Math.min(9, Math.floor(Number(x)) || 1)));
          const sum = k[0] * a.charge + k[1] * b.charge;
          return `${k[0]} × ${C.plain(a.text)}, ${k[1]} × ${C.plain(b.text)}: ` + (sum ? F('total charge {c}', { c: signed(sum) }) : C.plain(C.formulaOf(a, b, k[0], k[1])));
        } catch (e) { return ''; }
      },

      answer(goal, spec) {
        const r = cleanTask(spec, goal);
        if (!r) return '';
        if (r.spec.mode === 'balance') return C.eqPlain(C.parseEquation(r.spec.equation), r.goal.coefficients);
        if (r.spec.mode === 'atom') {
          const s = C.solution(r.spec, r.goal);
          return s ? atomSentence(s.p, s.n, s.e) : '';
        }
        const s = C.solution(r.spec, r.goal);
        if (!s) return '';
        const a = C.parseIon(s.ions[0]), b = C.parseIon(s.ions[1]);
        const nm = compoundName(a, b, T, F);
        return C.plain(r.goal.formula) + (nm ? ` (${nm})` : '');
      },

      still(spec, goal) {
        const r = goal ? cleanTask(spec, goal) : null;
        const s = r ? r.spec : cleanSpec(spec);
        if (!s) return '';
        if (s.mode === 'balance') return stillBalance(s, r && r.goal);
        if (s.mode === 'atom') return stillAtom(s);
        return stillCompound(s);
      }
    });
  }
})();
