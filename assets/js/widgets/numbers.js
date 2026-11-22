/* =====================================================================
   Numbers (assets/js/widgets.js): hands-on tools for primary and
   middle-school maths, on the lesson's parchment.

   - Fraction shapes: a bar, a circle or a grid cut into equal parts; tap
     a part (or drag across a big grid) to shade it, and the fraction is
     read out as it changes, with its simplest form. Two shapes side by
     side compare fractions, show equal ones (1/2 = 2/4) or add them.
   - A number line: from a to b with ticks (whole numbers, fractions or
     decimals, negatives too) and a marker to drag or tap onto a tick;
     jump buttons add hops of a size, drawn as arcs (3 + 4 as jumps).
   - Place-value blocks: ones, tens, hundreds and thousands as base-10
     blocks, bigger places as labelled stacks; add and take away blocks,
     bundle 10 into 1 of the next place and break 1 into 10 (animated).
     The number shows in digits with Indian (1,23,456) or international
     (123,456) commas, in words, and in expanded form.

   Everything is a button, a checkbox or a slider: a finger, a mouse and
   the keyboard all work (arrow keys move between parts and along the
   line). The maths and the checks are in numbers-core.js, shared with
   the server; this file loads it first, and the loader waits for that
   (document.currentScript.ready, in widgets.js). Every spec is checked
   again here, and its words go into the page as text, never as markup.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;
  const me = document.currentScript;

  const core = window.PrimerNumbers ? Promise.resolve(window.PrimerNumbers) : new Promise((resolve, reject) => {
    let s = document.querySelector('script[data-numbers-core]');
    if (!s) {
      s = document.createElement('script');
      s.src = '/assets/js/widgets/numbers-core.js';
      s.async = true;
      s.setAttribute('data-numbers-core', '');
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => (window.PrimerNumbers ? resolve(window.PrimerNumbers) : reject(new Error('numbers-core.js did not load'))));
    s.addEventListener('error', () => reject(new Error('numbers-core.js could not be loaded')));
  });
  const ready = core.then(start);
  if (me) me.ready = ready;
  ready.catch((err) => console.warn('[Primer] numbers:', err && err.message));

  function start(N) {
    const T = (s) => (P.t ? P.t(s) : s);
    const F = (s, v) => T(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m));
    const esc = P.esc || ((s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const range = (k) => Array.from({ length: k }, (_, i) => i);
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const r1 = (x) => Math.round(x * 10) / 10;
    const SVGNS = 'http://www.w3.org/2000/svg';
    const INK = '#2b1d11', SOFT = '#5b4730', GOLD = '#8a6128', RED = '#9a3324', PAPER = '#f8f1e0', EDGE = '#5b4730';
    const SHADE = '#e2a33b', SHADE_FIXED = '#b98b55';
    const BLOCK = ['#e2a33b', '#4f8a8b', '#7c9a45', '#b5553c', '#c9a24a', '#c9a24a', '#c9a24a', '#c9a24a'];
    const FONT = "'Cormorant Garamond', Georgia, serif";
    const INDIAN = new Set(['hi', 'bho', 'bn', 'mr', 'te', 'ta', 'gu', 'ur', 'kn', 'or', 'ml', 'pa', 'as', 'mai', 'ne', 'sa', 'kok']);
    let lastLang = ''; // the lesson's language, for words outside a mounted part (check, describe, answer)
    const langOf = (lang) => String(lang || lastLang || P.lang || 'en').toLowerCase().split('-')[0];
    const sysFor = (spec, lang) => spec.grouping || (INDIAN.has(langOf(lang)) ? 'indian' : 'international');
    const reduced = (ctx) => Boolean((ctx && ctx.reduce) || (P.motion && P.motion.reduce));
    const andList = (items) => { try { return new Intl.ListFormat(langOf(), { type: 'conjunction' }).format(items); } catch (e) { return items.join(', '); } };
    const orList = (items) => { try { return new Intl.ListFormat(langOf(), { type: 'disjunction' }).format(items); } catch (e) { return items.join(' / '); } };
    const qOf = (v) => (typeof v === 'string' ? N.value(v) : v);
    const showQ = (v, format) => N.show(qOf(v), format);
    // k of n parts, as it is (2/4 stays 2/4)
    const raw = (k, n) => ({ n: k, d: n });

    /* ---------------- markup: a tiny tree, made into a string (the book) or DOM (the page) ---------------- */

    const nd = (tag, attrs, kids) => ({ tag, attrs: attrs || {}, kids: (kids || []).filter((k) => k != null && k !== false) });
    function toStr(n) {
      if (typeof n === 'string') return esc(n);
      const a = Object.keys(n.attrs).filter((k) => n.attrs[k] != null && n.attrs[k] !== false).map((k) => ` ${k}="${esc(n.attrs[k])}"`).join('');
      return `<${n.tag}${a}>${n.kids.map(toStr).join('')}</${n.tag}>`;
    }
    function toDom(n) {
      if (typeof n === 'string') return document.createTextNode(n);
      const d = document.createElementNS(SVGNS, n.tag);
      Object.keys(n.attrs).forEach((k) => { if (n.attrs[k] != null && n.attrs[k] !== false && k !== 'xmlns') d.setAttribute(k, String(n.attrs[k])); });
      n.kids.forEach((k) => d.appendChild(toDom(k)));
      return d;
    }
    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function btn(cls, text, aria) {
      const b = el('button', cls, text);
      b.type = 'button';
      if (aria) b.setAttribute('aria-label', aria);
      return b;
    }
    // a number on the page, a fraction stacked: <span class="nm-q">−<span class="nm-q__f"><span>3</span><span>4</span></span></span>
    function qEl(q, format, grouping) {
      const p = N.pieces(qOf(q), format, grouping);
      const s = el('span', 'nm-q');
      s.setAttribute('aria-label', N.show(qOf(q), format, grouping));
      if (p.sign) s.appendChild(el('span', 'nm-q__sign', p.sign));
      if (p.text != null) { s.appendChild(el('span', 'nm-q__t', p.text)); return s; }
      if (p.whole) s.appendChild(el('span', 'nm-q__w', p.whole));
      const f = el('span', 'nm-q__f');
      f.setAttribute('aria-hidden', 'true');
      f.append(el('span', 'nm-q__n', p.num), el('span', 'nm-q__d', p.den));
      s.appendChild(f);
      return s;
    }
    // a translated sentence with page elements in it: fillEl('The marker is at {v}.', { v: qEl(...) })
    function fillEl(template, parts) {
      const frag = el('span', 'nm-say');
      T(template).split(/(\{\w+\})/).forEach((bit) => {
        const m = /^\{(\w+)\}$/.exec(bit);
        if (m && parts[m[1]] != null) frag.appendChild(typeof parts[m[1]] === 'string' ? document.createTextNode(parts[m[1]]) : parts[m[1]]);
        else if (bit) frag.appendChild(document.createTextNode(bit));
      });
      return frag;
    }
    // a number in an SVG: plain text, or a stacked fraction (num over den) centred on x; y is the middle
    function qSvg(q, format, x, y, size, attrs, grouping) {
      const p = N.pieces(qOf(q), format, grouping);
      const base = Object.assign({ 'text-anchor': 'middle', 'font-size': size, fill: INK }, attrs || {});
      if (p.text != null) return nd('text', Object.assign({ x: r1(x), y: r1(y + size * 0.34) }, base), [p.sign + p.text]);
      const fs = size * 0.82, wFrac = Math.max(p.num.length, p.den.length) * fs * 0.56 + 4;
      const wWhole = p.whole ? p.whole.length * size * 0.56 + 2 : 0, wSign = p.sign ? size * 0.55 : 0;
      const total = wSign + wWhole + wFrac, left = x - total / 2;
      const kids = [];
      if (p.sign) kids.push(nd('text', Object.assign({}, base, { x: r1(left + wSign / 2), y: r1(y + size * 0.34) }), [p.sign]));
      if (p.whole) kids.push(nd('text', Object.assign({}, base, { x: r1(left + wSign + wWhole / 2), y: r1(y + size * 0.34) }), [p.whole]));
      const cx = left + wSign + wWhole + wFrac / 2;
      kids.push(nd('text', Object.assign({}, base, { 'font-size': fs, x: r1(cx), y: r1(y - 2) }), [p.num]));
      kids.push(nd('line', { x1: r1(cx - wFrac / 2 + 1), x2: r1(cx + wFrac / 2 - 1), y1: r1(y + 1), y2: r1(y + 1), stroke: base.fill, 'stroke-width': 1.2 }));
      kids.push(nd('text', Object.assign({}, base, { 'font-size': fs, x: r1(cx), y: r1(y + fs * 0.98) }), [p.den]));
      return nd('g', {}, kids);
    }
    const qWidth = (q, format, size, grouping) => {
      const p = N.pieces(qOf(q), format, grouping);
      if (p.text != null) return (p.sign + p.text).length * size * 0.52 + 4;
      return (p.sign ? size * 0.55 : 0) + (p.whole ? p.whole.length * size * 0.56 + 2 : 0) + Math.max(p.num.length, p.den.length) * size * 0.46 + 4;
    };

    /* ==================================================================
       Fraction shapes
       ================================================================== */

    // the parts of a shape, in its own units: [{ d (an SVG path), cx, cy (where a label goes), w }]
    function shapeGeom(s) {
      if (s.shape === 'bar') {
        const W = 300, H = 64, w = W / s.parts;
        return { w: W + 4, h: H + 4, outline: `M2 2h${W}v${H}h-${W}z`, parts: range(s.parts).map((i) => ({ d: `M${r1(2 + i * w)} 2h${r1(w)}v${H}h-${r1(w)}z`, cx: 2 + (i + 0.5) * w, cy: 2 + H / 2, w })) };
      }
      if (s.shape === 'circle') {
        const R = 96, C = 100, n = s.parts;
        const pt = (a, r) => [C + r * Math.cos(a), C + r * Math.sin(a)];
        return {
          w: 2 * C, h: 2 * C, outline: `M${C - R} ${C}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0z`,
          parts: range(n).map((i) => {
            const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n, a1 = a0 + (2 * Math.PI) / n, am = (a0 + a1) / 2;
            const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [lx, ly] = pt(am, R * (n <= 4 ? 0.52 : 0.64));
            return { d: `M${C} ${C}L${r1(x0)} ${r1(y0)}A${R} ${R} 0 ${n === 1 ? 1 : 0} 1 ${r1(x1)} ${r1(y1)}z`, cx: lx, cy: ly, w: Math.min(R * 2 * Math.PI / n, R) };
          })
        };
      }
      const c = Math.min(300 / s.cols, 260 / s.rows, 80), W = c * s.cols, H = c * s.rows;
      return {
        w: W + 4, h: H + 4, outline: `M2 2h${r1(W)}v${r1(H)}h-${r1(W)}z`,
        parts: range(s.parts).map((i) => { const r = Math.floor(i / s.cols), k = i % s.cols; return { d: `M${r1(2 + k * c)} ${r1(2 + r * c)}h${r1(c)}v${r1(c)}h-${r1(c)}z`, cx: 2 + (k + 0.5) * c, cy: 2 + (r + 0.5) * c, w: c }; })
      };
    }
    const shapeWord = (s) => (s.shape === 'bar' ? F('A bar cut into {n} equal parts', { n: s.parts }) : s.shape === 'circle' ? F('A circle cut into {n} equal parts', { n: s.parts }) : F('A grid of {n} equal squares', { n: s.parts }));

    // a shape as a node tree: live (the page: classes, focusable parts) or not (the book: colours inline)
    function shapeNode(s, shaded, opts) {
      const g = shapeGeom(s), on = new Set(shaded), live = opts.live, fill = s.fixed ? SHADE_FIXED : SHADE;
      const labels = opts.labels && s.parts <= 24;
      const kids = g.parts.map((p, j) => nd('path', {
        d: p.d, class: live ? 'nm-part' : null, 'data-part': live ? j : null,
        fill: on.has(j) ? fill : PAPER, stroke: EDGE, 'stroke-width': s.parts > 40 ? 1 : 1.5, 'stroke-linejoin': 'round',
        tabindex: live && !s.fixed ? (j === 0 ? '0' : '-1') : null, role: live && !s.fixed ? 'checkbox' : null,
        'aria-checked': live && !s.fixed ? String(on.has(j)) : null,
        'aria-label': live && !s.fixed ? F('Part {i} of {n}', { i: j + 1, n: s.parts }) : null
      }));
      kids.push(nd('path', { d: g.outline, fill: 'none', stroke: INK, 'stroke-width': 2.4, 'pointer-events': 'none', class: live ? 'nm-shape__edge' : null }));
      if (labels) {
        const size = clamp(Math.min(g.parts[0].w * 0.42, 24), 11, 24);
        g.parts.forEach((p) => kids.push(nd('g', { 'pointer-events': 'none', 'aria-hidden': 'true' }, [qSvg(N.Q(1, s.parts), 'fraction', p.cx, p.cy - 2, size, { 'font-family': FONT, fill: INK })])));
      }
      return nd('svg', {
        xmlns: SVGNS, viewBox: `0 0 ${r1(g.w)} ${r1(g.h)}`, width: r1(g.w), height: r1(g.h),
        class: live ? 'nm-shape__svg nm-shape__svg--' + s.shape : null, role: live ? 'group' : 'img',
        'aria-label': shapeWord(s) + (s.fixed ? '. ' + F('{k} shaded.', { k: on.size }) : ''),
        'font-family': FONT
      }, kids);
    }

    function fractionView(host, spec, goal, ctx) {
      const task = Boolean(goal), shapes = spec.shapes;
      let sh = shapes.map((s) => new Set(s.shaded)), touched = false, locked = false;
      const root = el('div', 'nm nm--fraction');
      const big = shapes.some((s) => s.parts > 12);
      root.appendChild(el('p', 'nm__how', big ? T('Tap or drag across the squares to shade them. Tap a shaded one to clear it.') : T('Tap the parts to shade them. Tap a shaded part to clear it.')));
      const stacked = shapes.length > 1 && shapes.every((s) => s.shape === 'bar');
      const row = el('div', 'nm-shapes' + (stacked ? ' is-stacked' : ''));
      root.appendChild(row);
      const live = el('p', 'nm__live');
      live.setAttribute('aria-live', 'polite');
      const say = (s) => { live.textContent = s; };

      const views = shapes.map((s, i) => {
        if (i > 0 && spec.join === 'add') row.appendChild(el('span', 'nm-join', '+'));
        const fig = el('div', 'nm-shape' + (s.fixed ? ' is-fixed' : ''));
        if (s.label) fig.appendChild(el('p', 'nm-shape__label', s.label));
        const svg = toDom(shapeNode(s, [...sh[i]], { live: true, labels: spec.labels }));
        const holder = el('div', 'nm-shape__pic');
        holder.appendChild(svg);
        fig.appendChild(holder);
        const read = el('div', 'nm-shape__read');
        if (spec.readout === false) read.hidden = true;
        fig.appendChild(read);
        row.appendChild(fig);
        const parts = [...svg.querySelectorAll('[data-part]')];
        if (s.parts > 12) svg.classList.add('is-paint');
        const v = { s, i, svg, parts, read, focus: 0 };
        if (!s.fixed) wire(v);
        return v;
      });
      const total = el('div', 'nm-total');
      root.append(total, live);
      const bar = el('div', 'nm__actions');
      const clear = btn('nm__link', T('Clear'));
      bar.appendChild(clear);
      root.appendChild(bar);
      clear.addEventListener('click', () => { if (locked) return; sh = shapes.map((s) => new Set(s.fixed ? s.shaded : [])); touched = true; draw(); changed(); });

      function draw() {
        views.forEach((v) => {
          v.parts.forEach((p, j) => {
            const on = sh[v.i].has(j);
            p.classList.toggle('is-on', on);
            if (!v.s.fixed) p.setAttribute('aria-checked', String(on));
          });
          v.read.textContent = '';
          const k = sh[v.i].size, q = N.Q(k, v.s.parts);
          const fr = el('span', 'nm-frac');
          fr.appendChild(qEl(raw(k, v.s.parts), 'fraction'));
          if (!task && k > 0 && q.d !== v.s.parts) { fr.appendChild(el('span', 'nm-eq', '=')); fr.appendChild(qEl(q, 'fraction')); }
          // tenths and hundredths: the decimal too
          if (!task && (v.s.parts === 10 || v.s.parts === 100) && k > 0 && k < v.s.parts) { fr.appendChild(el('span', 'nm-eq', '=')); fr.appendChild(qEl(q, 'decimal')); }
          v.read.appendChild(fr);
          v.read.appendChild(el('span', 'nm-shape__count', F('{k} of {n} parts shaded', { k, n: v.s.parts })));
        });
        // two shapes: how they compare, or their sum (not in a task: that would give it away)
        total.textContent = '';
        if (shapes.length === 2 && !task && spec.readout !== false) {
          const [a, b] = views.map((v) => N.Q(sh[v.i].size, v.s.parts));
          const as = (i) => qEl(raw(sh[i].size, shapes[i].parts), 'fraction');
          if (spec.join === 'add') total.append(as(0), el('span', 'nm-op', '+'), as(1), el('span', 'nm-op', '='), qEl(N.add(a, b), 'mixed'));
          else if (a.n || b.n) {
            const c = N.cmp(a, b);
            total.append(as(0), el('span', 'nm-op' + (c === 0 ? ' is-eq' : ''), c < 0 ? '<' : c > 0 ? '>' : '='), as(1));
            total.appendChild(el('span', 'nm-total__say', c === 0 ? T('They are equal.') : c < 0 ? T('The first is smaller.') : T('The first is bigger.')));
          }
        }
      }
      function changed() { ctx.onChange(value()); }
      function setPart(v, j, on) {
        if (sh[v.i].has(j) === on) return false;
        if (on) sh[v.i].add(j); else sh[v.i].delete(j);
        touched = true;
        return true;
      }
      function wire(v) {
        const { svg, parts, s } = v;
        let paint = null, pending = null;
        const partAt = (x, y) => { const e = document.elementFromPoint(x, y); const p = e && e.closest && e.closest('[data-part]'); return p && svg.contains(p) ? Number(p.getAttribute('data-part')) : null; };
        svg.addEventListener('pointerdown', (e) => {
          if (locked || (e.button != null && e.button > 0)) return;
          const j = partAt(e.clientX, e.clientY);
          if (j == null) return;
          // a finger on a small shape taps (so the page can still scroll); a mouse, or a big grid, paints
          if (e.pointerType !== 'touch' || s.parts > 12) {
            e.preventDefault();
            paint = { id: e.pointerId, on: !sh[v.i].has(j) };
            if (setPart(v, j, paint.on)) { draw(); changed(); }
            try { svg.setPointerCapture(e.pointerId); } catch (err) { /* moves still arrive while over it */ }
            focusPart(v, j, false);
          } else pending = { id: e.pointerId, j };
        });
        svg.addEventListener('pointermove', (e) => {
          if (!paint || e.pointerId !== paint.id || locked) return;
          const j = partAt(e.clientX, e.clientY);
          if (j != null && setPart(v, j, paint.on)) { draw(); changed(); }
        });
        const end = (e) => {
          if (pending && e.type === 'pointerup' && e.pointerId === pending.id && !locked) {
            const j = partAt(e.clientX, e.clientY);
            if (j === pending.j && setPart(v, j, !sh[v.i].has(j))) { draw(); changed(); focusPart(v, j, false); }
          }
          paint = null; pending = null;
        };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
        svg.addEventListener('keydown', (e) => {
          if (locked) return;
          const j = v.focus, cols = s.shape === 'grid' ? s.cols : s.parts;
          let to = null;
          if (e.key === 'ArrowRight') to = s.shape === 'grid' ? (j % cols < cols - 1 ? j + 1 : j) : (j + 1) % s.parts;
          else if (e.key === 'ArrowLeft') to = s.shape === 'grid' ? (j % cols > 0 ? j - 1 : j) : (j + s.parts - 1) % s.parts;
          else if (e.key === 'ArrowDown') to = s.shape === 'grid' ? Math.min(s.parts - 1, j + cols) : (j + 1) % s.parts;
          else if (e.key === 'ArrowUp') to = s.shape === 'grid' ? Math.max(0, j - cols) : (j + s.parts - 1) % s.parts;
          else if (e.key === 'Home') to = 0;
          else if (e.key === 'End') to = s.parts - 1;
          else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            setPart(v, j, !sh[v.i].has(j));
            draw(); changed();
            say(F(sh[v.i].has(j) ? 'Part {i} shaded: {k} of {n}.' : 'Part {i} cleared: {k} of {n}.', { i: j + 1, k: sh[v.i].size, n: s.parts }));
            return;
          }
          if (to == null) return;
          e.preventDefault();
          focusPart(v, to, true);
        });
        parts.forEach((p, j) => p.addEventListener('focus', () => { v.focus = j; }));
      }
      function focusPart(v, j, move) {
        v.parts[v.focus].setAttribute('tabindex', '-1');
        v.focus = j;
        v.parts[j].setAttribute('tabindex', '0');
        if (move) v.parts[j].focus({ preventScroll: true });
      }
      const value = () => (touched ? { shaded: sh.map((x) => [...x].sort((a, b) => a - b)) } : null);
      host.textContent = '';
      host.appendChild(root);
      draw();
      return {
        value,
        reset() { sh = shapes.map((s) => new Set(s.shaded)); touched = false; root.classList.remove('is-done'); draw(); },
        reveal() {
          const sol = goal ? N.solution(spec, goal) : null;
          if (sol) { sh = sol.shaded.map((l) => new Set(l)); touched = true; }
          root.classList.add('is-done');
          locked = true;
          draw();
        },
        lock(on) { locked = Boolean(on); root.classList.toggle('is-locked', locked); clear.disabled = locked; },
        destroy() { host.textContent = ''; }
      };
    }

    /* ==================================================================
       The number line
       ================================================================== */

    const LINE_M = 30; // room at each end for the arrows and the end labels

    // which ticks get a label: what the spec asks, thinned out so neighbours never collide
    function labelled(spec, ticks, unit, size, grouping) {
      const n = ticks.length - 1, L = spec.labels;
      let want = ticks.map((q, k) => (L === 'all' ? true : L === 'none' ? false : L === 'ends' ? k === 0 || k === n : L === 'whole' ? N.isInt(q) : k % L === 0));
      const idx = want.map((w, k) => (w ? k : -1)).filter((k) => k >= 0);
      if (idx.length < 2) return want;
      const need = Math.max(...idx.map((k) => qWidth(ticks[k], spec.format, size, grouping))) + 8;
      const gap = Math.min(...idx.slice(1).map((k, i) => k - idx[i])) * unit;
      if (gap >= need) return want;
      const every = Math.ceil(need / gap);
      // keep every few, counted from 0 when it is on the line (so 0 always keeps its label)
      const z = idx.findIndex((k) => N.cmp(ticks[k], N.ZERO) === 0), from = z >= 0 ? z : 0;
      want = ticks.map(() => false);
      idx.forEach((k, i) => { if ((((i - from) % every) + every) % every === 0) want[k] = true; });
      return want;
    }

    // the line as a node tree: { svg, base: the line's y, x(k) }
    function lineNode(spec, W, opts) {
      const ticks = N.ticksOf(spec), n = ticks.length - 1, hops = opts.hops || [], live = opts.live;
      const hasArcs = (live && Boolean(spec.hops)) || hops.length > 0; // the page keeps room for jumps to come
      const size = W < 420 ? 15 : 17;
      const base = hasArcs ? 100 : 58, H = base + 52;
      const unit = (W - 2 * LINE_M) / n, x = (k) => LINE_M + k * unit;
      const grouping = spec.grouping || (opts.sys === 'indian' && ticks.some((q) => Math.abs(N.toNum(q)) >= 1e5) ? 'indian' : ticks.some((q) => Math.abs(N.toNum(q)) >= 1e4) ? opts.sys : '');
      const show = labelled(spec, ticks, unit, size, grouping);
      const kids = [];
      // the line, with arrows at both ends
      kids.push(nd('line', { x1: 8, x2: W - 8, y1: base, y2: base, stroke: INK, 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
      kids.push(nd('path', { d: `M4 ${base}l10 -6v12z`, fill: INK }));
      kids.push(nd('path', { d: `M${W - 4} ${base}l-10 -6v12z`, fill: INK }));
      ticks.forEach((q, k) => {
        const major = show[k] || N.isInt(q), h = show[k] ? 11 : major ? 8 : 6;
        kids.push(nd('line', { x1: r1(x(k)), x2: r1(x(k)), y1: base - h, y2: base + h, stroke: INK, 'stroke-width': show[k] ? 1.8 : 1.2 }));
        if (show[k]) {
          // a long label at an end is moved in, so it is never cut off
          const half = qWidth(q, spec.format, size, grouping) / 2, lx = clamp(x(k), half + 2, W - half - 2);
          kids.push(qSvg(q, spec.format, lx, base + 26, size, { fill: N.cmp(q, N.ZERO) === 0 ? INK : SOFT, 'font-weight': N.cmp(q, N.ZERO) === 0 ? 700 : 500, class: live ? 'nm-line__lab' : null }, grouping));
        }
      });
      if (spec.unit) kids.push(nd('text', { x: W - 10, y: 20, 'text-anchor': 'end', 'font-size': size, 'font-style': 'italic', fill: SOFT }, [spec.unit]));
      // fixed points
      (spec.marks || []).forEach((m) => {
        const k = N.div(N.sub(N.value(m.at), ticks[0]), N.value(spec.step)), px = LINE_M + N.toNum(k) * unit;
        kids.push(nd('circle', { cx: r1(px), cy: base, r: 5.5, fill: RED, stroke: PAPER, 'stroke-width': 1.5 }));
        // a label that only repeats the tick's own number ("0" on 0) is left off
        const tk = N.isInt(k) ? k.n : -1, same = Boolean(m.label) && tk >= 0 && show[tk] && m.label.replace(/[−-]/g, '-') === N.show(ticks[tk], spec.format, grouping).replace(/[−-]/g, '-');
        if (m.label && !same) kids.push(nd('text', { x: r1(px), y: base - 14, 'text-anchor': 'middle', 'font-size': size - 1, 'font-weight': 600, fill: RED, 'paint-order': 'stroke', stroke: PAPER, 'stroke-width': 3 }, [m.label]));
      });
      // jumps: an arc for each, its size at the top
      const arcs = [], drawn = [];
      let pos = opts.at;
      hops.forEach((u, i) => {
        const a = x(pos), b = x(pos + u), mid = (a + b) / 2, lo = Math.min(a, b), hi = Math.max(a, b);
        // an arc over the same stretch as an earlier one goes above it, so every label stays clear
        const under = drawn.filter((d) => d.lo < hi - 1 && d.hi > lo + 1).reduce((m, d) => Math.max(m, d.h), 0);
        const h = Math.min(base - 34, Math.max(Math.min(56, 16 + (hi - lo) * 0.32), under ? under + 22 : 0));
        drawn.push({ lo, hi, h });
        const d = `M${r1(a)} ${base - 3}Q${r1(mid)} ${r1(base - 3 - 2 * h)} ${r1(b)} ${base - 3}`;
        const dir = Math.sign(u);
        const tip = `M${r1(b)} ${base - 3}l${r1(-dir * 9)} -7l${r1(dir * 1.5)} 9z`;
        const step = N.mul(N.Q(Math.abs(u)), N.value(spec.step)), ink = dir > 0 ? GOLD : RED, sign = dir > 0 ? '+' : N.MINUS;
        const p = N.pieces(step, spec.format), ly = base - 3 - h - 12;
        // "+2" as one word; a fraction stacked, its sign before it
        const label = p.text != null
          ? nd('text', { x: r1(mid), y: r1(ly + (size - 1) * 0.34), 'text-anchor': 'middle', 'font-size': size - 1, 'font-weight': 700, fill: ink }, [sign + p.text])
          : nd('g', {}, [qSvg(step, spec.format, mid + 4, ly, size - 2, { fill: ink, 'font-weight': 600 }), nd('text', { x: r1(mid + 4 - qWidth(step, spec.format, size - 2) / 2 - 3), y: r1(ly + (size - 1) * 0.34), 'text-anchor': 'middle', 'font-size': size - 1, 'font-weight': 700, fill: ink }, [sign])]);
        arcs.push(nd('g', { class: live ? 'nm-arc' : null, 'data-hop': i }, [
          nd('path', { d, fill: 'none', stroke: ink, 'stroke-width': 2.4, 'stroke-linecap': 'round', class: live ? 'nm-arc__path' : null }),
          nd('path', { d: tip, fill: ink }),
          nd('g', { 'aria-hidden': 'true', 'paint-order': 'stroke', stroke: '#f6eedb', 'stroke-width': 3, 'stroke-linejoin': 'round' }, [label])
        ]));
        pos += u;
      });
      kids.push(nd('g', { class: live ? 'nm-arcs' : null }, arcs));
      if (hops.length && opts.at != null && opts.at >= 0) kids.push(nd('circle', { cx: r1(x(opts.at)), cy: base, r: 4.5, fill: PAPER, stroke: GOLD, 'stroke-width': 2 }));
      return { node: nd('g', {}, kids), base, H, x, unit, n };
    }
    // the marker: a pin whose tip is on the line (drawn at x = 0; moved with a transform)
    const pinNode = (base, live, ghost) => nd('g', { class: live ? 'nm-pin' + (ghost ? ' is-ghost' : '') : null }, [
      nd('circle', { cx: 0, cy: base - 26, r: 26, fill: 'transparent', class: live ? 'nm-pin__hit' : null }),
      nd('path', { d: `M0 ${base - 1}C-4 ${base - 11} -13 ${base - 17} -13 ${base - 27}a13 13 0 0 1 26 0C13 ${base - 17} 4 ${base - 11} 0 ${base - 1}z`, fill: RED, stroke: PAPER, 'stroke-width': 1.6, class: live ? 'nm-pin__body' : null }),
      nd('circle', { cx: 0, cy: base - 27, r: 5, fill: PAPER, class: live ? 'nm-pin__eye' : null }),
      live ? nd('text', { x: 0, y: base - 22, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: PAPER, class: 'nm-pin__q' }, ['?']) : null
    ]);

    function lineView(host, spec, goal, ctx) {
      const task = Boolean(goal);
      const ticks = N.ticksOf(spec), n = ticks.length - 1, step = N.value(spec.step);
      const sys = sysFor(spec, ctx.lang);
      const zero = N.tickOf(spec, N.ZERO);
      const startK = spec.start != null ? N.tickOf(spec, N.value(spec.start)) : task ? -1 : zero >= 0 ? zero : 0;
      const sizes = (spec.hops || []).map((h) => N.div(N.value(h), step).n);
      let at = startK, hops = [], touched = false, locked = false, W = 0, geo = null, busy = 0;
      const root = el('div', 'nm nm--line' + (task ? ' is-task' : ''));
      const how = el('p', 'nm__how', spec.hops
        ? (at < 0 ? T('Put the marker where the jumps start (drag it, or tap the line), then jump.') : T('Use the jump buttons to hop along the line.'))
        : T('Drag the marker, or tap the line, to put it on a number.'));
      const wrap = el('div', 'nm-line');
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'nm-line__svg');
      svg.setAttribute('font-family', FONT);
      const layer = document.createElementNS(SVGNS, 'g');
      svg.appendChild(layer);
      let pin = null;
      wrap.appendChild(svg);
      const read = el('p', 'nm-line__read');
      read.setAttribute('aria-live', 'polite');
      root.append(how, wrap, read);

      // the jump buttons
      const hopBar = el('div', 'nm-hops');
      const hopBtns = [];
      if (spec.hops) {
        const fmt = (u) => N.show(N.mul(N.Q(u), step), spec.format);
        [...sizes].reverse().forEach((u) => hopBtns.push([btn('nm-hop nm-hop--back', N.MINUS + fmt(u), F('Jump left by {n}', { n: fmt(u) })), -u]));
        sizes.forEach((u) => hopBtns.push([btn('nm-hop nm-hop--on', '+' + fmt(u), F('Jump right by {n}', { n: fmt(u) })), u]));
        hopBtns.forEach(([b, u]) => { hopBar.appendChild(b); b.addEventListener('click', () => hop(u)); });
        const undo = btn('nm__link', T('Undo jump')), clear = btn('nm__link', T('Clear jumps'));
        undo.addEventListener('click', () => { if (!locked && hops.length) { hops.pop(); touched = true; build(); update(); } });
        clear.addEventListener('click', () => { if (!locked && hops.length) { hops = []; touched = true; build(); update(); } });
        const tools = el('div', 'nm-hops__tools');
        tools.append(undo, clear);
        hopBtns.undo = undo; hopBtns.clear = clear;
        root.append(hopBar, tools);
      }
      if (!task) {
        const bar = el('div', 'nm__actions');
        const again = btn('nm__link', T('Start again'));
        again.addEventListener('click', () => { at = startK; hops = []; touched = false; build(); update(); });
        bar.appendChild(again);
        root.appendChild(bar);
      }

      const endK = () => (at < 0 ? -1 : at + hops.reduce((s, u) => s + u, 0));
      const qAt = (k) => ticks[k];

      function build() {
        W = Math.max(240, Math.round(wrap.clientWidth || 600));
        geo = lineNode(spec, W, { live: true, hops, at, sys });
        svg.setAttribute('viewBox', `0 0 ${W} ${geo.H}`);
        svg.setAttribute('width', String(W));
        svg.setAttribute('height', String(geo.H));
        layer.textContent = '';
        layer.appendChild(toDom(geo.node));
        if (pin) pin.remove();
        pin = toDom(pinNode(geo.base, true, at < 0));
        pin.setAttribute('tabindex', locked ? '-1' : '0');
        pin.setAttribute('role', 'slider');
        pin.setAttribute('aria-label', T('The marker'));
        pin.setAttribute('aria-valuemin', '0');
        pin.setAttribute('aria-valuemax', String(n));
        pin.addEventListener('keydown', onKey);
        svg.appendChild(pin);
        place(endK(), null);
      }
      function place(k, from) {
        if (!pin) return;
        const px = k < 0 ? geo.x(0) : geo.x(k);
        pin.classList.toggle('is-ghost', at < 0);
        const lift = k < 0 ? -16 : 0;
        const to = `translate(${r1(px)}px, ${lift}px)`;
        if (from != null && from >= 0 && !reduced(ctx) && pin.animate) {
          const a = geo.x(from), hgt = Math.min(48, 14 + Math.abs(px - a) * 0.3);
          pin.animate([{ transform: `translate(${r1(a)}px, 0px)` }, { transform: `translate(${r1((a + px) / 2)}px, ${r1(-hgt)}px)` }, { transform: to }], { duration: 380, easing: 'ease-in-out' });
        }
        pin.style.transform = to;
        pin.setAttribute('aria-valuenow', String(Math.max(0, k)));
        pin.setAttribute('aria-valuetext', k < 0 ? T('Not placed yet') : N.show(qAt(k), spec.format));
      }
      function update() {
        how.textContent = spec.hops
          ? (at < 0 ? T('Put the marker where the jumps start (drag it, or tap the line), then jump.') : hops.length ? T('Use the jump buttons to hop along the line. Clear the jumps to move the start.') : T('Use the jump buttons to hop along the line.'))
          : T('Drag the marker, or tap the line, to put it on a number.');
        const e = endK();
        hopBtns.forEach(([b, u]) => { b.disabled = locked || at < 0 || e + u < 0 || e + u > n; });
        if (hopBtns.undo) { hopBtns.undo.disabled = locked || !hops.length; hopBtns.clear.disabled = locked || !hops.length; }
        wrap.classList.toggle('is-hopping', hops.length > 0);
        read.textContent = '';
        if (at < 0) return;
        if (hops.length) {
          read.appendChild(qEl(qAt(at), spec.format, ''));
          let pos = at;
          hops.forEach((u) => { read.appendChild(el('span', 'nm-op', u > 0 ? '+' : N.MINUS)); read.appendChild(qEl(N.mul(N.Q(Math.abs(u)), step), spec.format)); pos += u; });
          read.append(el('span', 'nm-op', '='), qEl(qAt(pos), spec.format));
        } else if (!(task && goal.type === 'place') && spec.readout !== false) {
          read.appendChild(fillEl('The marker is at {v}.', { v: qEl(qAt(e), spec.format) }));
        }
      }
      function moveTo(k) {
        k = clamp(k, 0, n);
        if (k === at || hops.length) return;
        const was = at;
        at = k; touched = true;
        if (was < 0) build(); else place(at, null);
        update();
        ctx.onChange(value());
      }
      function hop(u) {
        if (locked || at < 0 || busy) return;
        const e = endK();
        if (e + u < 0 || e + u > n) return;
        hops.push(u); touched = true;
        build();
        place(e + u, e);
        // the newest arc draws itself
        const arc = svg.querySelector(`[data-hop="${hops.length - 1}"] .nm-arc__path`);
        if (arc && !reduced(ctx) && arc.getTotalLength) {
          const len = arc.getTotalLength();
          arc.style.strokeDasharray = `${len}`;
          if (arc.animate) arc.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 380, easing: 'ease-in-out' });
        }
        update();
        ctx.onChange(value());
      }
      // pointer: a mouse drags at once; a finger taps, or drags sideways (up and down still scrolls the page)
      const kAt = (clientX) => {
        const r = svg.getBoundingClientRect();
        const px = (clientX - r.left) * (W / (r.width || W));
        return clamp(Math.round((px - LINE_M) / geo.unit), 0, n);
      };
      let drag = null;
      svg.addEventListener('pointerdown', (e) => {
        if (locked || hops.length || (e.button != null && e.button > 0)) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', moving: e.pointerType !== 'touch' };
        if (drag.moving) {
          e.preventDefault();
          try { svg.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
          moveTo(kAt(e.clientX));
          if (pin) pin.focus({ preventScroll: true });
        }
      });
      svg.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id || locked) return;
        if (!drag.moving) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
          drag.moving = true;
          try { svg.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
        }
        moveTo(kAt(e.clientX));
      });
      const up = (e) => {
        if (drag && e.type === 'pointerup' && drag.touch && !drag.moving && !locked) moveTo(kAt(e.clientX));
        drag = null;
      };
      svg.addEventListener('pointerup', up);
      svg.addEventListener('pointercancel', up);
      function onKey(e) {
        if (locked) return;
        const big = Math.max(2, Math.round(n / 8));
        const from = at < 0 ? (zero >= 0 ? zero : 0) : at;
        let k = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') k = at < 0 ? from : from + 1;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') k = at < 0 ? from : from - 1;
        else if (e.key === 'PageUp') k = from + big;
        else if (e.key === 'PageDown') k = from - big;
        else if (e.key === 'Home') k = 0;
        else if (e.key === 'End') k = n;
        if (k == null) return;
        e.preventDefault();
        if (hops.length) { read.textContent = T('Clear the jumps to move the start.'); return; }
        moveTo(k);
        if (pin) pin.focus({ preventScroll: true });
      }

      const value = () => (touched && at >= 0 ? { at: N.key(qAt(at)), hops: hops.map((u) => N.key(N.mul(N.Q(u), step))) } : null);
      host.textContent = '';
      host.appendChild(root);
      build();
      update();
      let ro = null, raf = 0, dead = false;
      // redrawn at the new width in the next frame (never inside the observer's own callback)
      const onResize = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (dead) return;
          const w = Math.round(wrap.clientWidth);
          if (w && Math.abs(w - W) > 2 && (w > 280 || W > 280)) { const f = document.activeElement === pin; build(); if (f && pin) pin.focus({ preventScroll: true }); }
        });
      };
      if (window.ResizeObserver) { ro = new ResizeObserver(onResize); ro.observe(wrap); } else window.addEventListener('resize', onResize);
      return {
        value,
        reset() { at = startK; hops = []; touched = false; root.classList.remove('is-done'); build(); update(); },
        reveal() {
          const sol = goal ? N.solution(spec, goal) : null;
          if (sol) {
            at = N.tickOf(spec, N.value(sol.at));
            hops = sol.hops.map((h) => N.div(N.value(h), step).n);
            touched = true;
          }
          locked = true;
          root.classList.add('is-done');
          build(); update();
          if (goal && goal.type === 'place' && at >= 0) read.appendChild(fillEl('The marker is at {v}.', { v: qEl(qAt(endK()), spec.format) }));
        },
        lock(on) { locked = Boolean(on); root.classList.toggle('is-locked', locked); if (pin) pin.setAttribute('tabindex', locked ? '-1' : '0'); update(); },
        destroy() { dead = true; if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); else window.removeEventListener('resize', onResize); host.textContent = ''; }
      };
    }

    /* ==================================================================
       Place-value blocks
       ================================================================== */

    // place names (literal strings, for the translator)
    const placeNames = (sys) => (sys === 'indian'
      ? [T('ones'), T('tens'), T('hundreds'), T('thousands'), T('ten thousands'), T('lakhs'), T('ten lakhs'), T('crores')]
      : [T('ones'), T('tens'), T('hundreds'), T('thousands'), T('ten thousands'), T('hundred thousands'), T('millions'), T('ten millions')]);
    const placeShort = (sys) => (sys === 'indian'
      ? [T('O'), T('T'), T('H'), T('Th'), T('TTh'), T('L'), T('TL'), T('C')]
      : [T('O'), T('T'), T('H'), T('Th'), T('TTh'), T('HTh'), T('M'), T('TM')]);
    const manyOf = (sys) => (sys === 'indian'
      ? [T('{n} ones'), T('{n} tens'), T('{n} hundreds'), T('{n} thousands'), T('{n} ten thousands'), T('{n} lakhs'), T('{n} ten lakhs'), T('{n} crores')]
      : [T('{n} ones'), T('{n} tens'), T('{n} hundreds'), T('{n} thousands'), T('{n} ten thousands'), T('{n} hundred thousands'), T('{n} millions'), T('{n} ten millions')]);
    const oneOf = (sys) => (sys === 'indian'
      ? [T('1 one'), T('1 ten'), T('1 hundred'), T('1 thousand'), T('1 ten thousand'), T('1 lakh'), T('1 ten lakh'), T('1 crore')]
      : [T('1 one'), T('1 ten'), T('1 hundred'), T('1 thousand'), T('1 ten thousand'), T('1 hundred thousand'), T('1 million'), T('1 ten million')]);
    const countText = (i, k, sys) => (k === 1 ? oneOf(sys)[i] : manyOf(sys)[i].replace('{n}', String(k)));
    // "4 tens and 12 ones" (biggest first; nothing for an empty place)
    const countsText = (counts, sys) => {
      const bits = counts.map((k, i) => [k, i]).filter(([k]) => k > 0).reverse().map(([k, i]) => countText(i, k, sys));
      return bits.length ? andList(bits) : '0';
    };

    // one block, drawn in its own box from (0, 0): { node, w, h }
    function blockNode(i, live, label) {
      const c = BLOCK[i] || BLOCK[4], dark = 'rgba(43,29,17,.55)', lite = 'rgba(255,248,230,.55)';
      const cls = live ? 'nm-blk' : null;
      if (i === 0) {
        return { w: 15, h: 15, node: nd('g', { class: cls }, [nd('rect', { x: 0.5, y: 0.5, width: 14, height: 14, rx: 2, fill: c, stroke: dark, 'stroke-width': 1 }), nd('path', { d: 'M2.5 11V2.5H11', fill: 'none', stroke: lite, 'stroke-width': 1.6 })]) };
      }
      if (i === 1) {
        const segs = range(9).map((k) => nd('line', { x1: 1, x2: 9, y1: 9 * (k + 1) + 0.5, y2: 9 * (k + 1) + 0.5, stroke: dark, 'stroke-width': 0.8 }));
        return { w: 10, h: 91, node: nd('g', { class: cls }, [nd('rect', { x: 0.5, y: 0.5, width: 9, height: 90, rx: 1.5, fill: c, stroke: dark, 'stroke-width': 1 }), ...segs, nd('line', { x1: 2.2, x2: 2.2, y1: 2, y2: 89, stroke: lite, 'stroke-width': 1.2 })]) };
      }
      if (i === 2) {
        const s = 62, gl = [];
        for (let k = 1; k < 10; k++) { const p = r1(1 + (k * (s - 2)) / 10); gl.push(`M${p} 1V${s - 1}M1 ${p}H${s - 1}`); }
        return { w: s, h: s, node: nd('g', { class: cls }, [nd('rect', { x: 0.5, y: 0.5, width: s - 1, height: s - 1, rx: 2, fill: c, stroke: dark, 'stroke-width': 1.1 }), nd('path', { d: gl.join(''), stroke: dark, 'stroke-width': 0.5, 'stroke-opacity': 0.7, fill: 'none' }), nd('path', { d: `M2.5 ${s - 4}V2.5H${s - 4}`, fill: 'none', stroke: lite, 'stroke-width': 1.6 })]) };
      }
      if (i === 3) {
        const s = 48, d = 16, gl = [];
        for (let k = 1; k < 5; k++) { const p = r1((k * s) / 5); gl.push(`M${p} ${d}V${d + s}M0 ${r1(d + p)}H${s}`); }
        return {
          w: s + d, h: s + d,
          node: nd('g', { class: cls }, [
            nd('path', { d: `M0 ${d}L${d} 0H${s + d}L${s} ${d}z`, fill: c, stroke: dark, 'stroke-width': 1, 'fill-opacity': 0.85 }),
            nd('path', { d: `M${s} ${d}L${s + d} 0V${s}L${s} ${s + d}z`, fill: c, stroke: dark, 'stroke-width': 1 }),
            nd('path', { d: `M${s} ${d}L${s + d} 0V${s}L${s} ${s + d}z`, fill: 'rgba(43,29,17,.22)' }),
            nd('rect', { x: 0, y: d, width: s, height: s, fill: c, stroke: dark, 'stroke-width': 1.1 }),
            nd('path', { d: gl.join(''), stroke: dark, 'stroke-width': 0.6, 'stroke-opacity': 0.6, fill: 'none' })
          ])
        };
      }
      // ten thousands and up: a counter (a coin seen from the side), the top one labelled
      const w = 84, h = 40;
      return {
        w, h,
        node: nd('g', { class: cls }, [
          nd('path', { d: 'M0.5 15v9a41.5 15 0 0 0 83 0v-9', fill: '#9c7a2e', stroke: dark, 'stroke-width': 1 }),
          nd('ellipse', { cx: 42, cy: 15, rx: 41.5, ry: 14.5, fill: c, stroke: dark, 'stroke-width': 1 }),
          label ? nd('text', { x: 42, y: 22, 'text-anchor': 'middle', 'font-size': label.length > 2 ? 19 : 22, 'font-weight': 700, fill: INK, 'font-family': FONT }, [label]) : null
        ])
      };
    }
    // where each block of a place sits in a column 100 wide and H high (from the bottom up)
    function pileLayout(i, k) {
      const b = blockNode(i, false);
      const at = [];
      let h = 0;
      if (i === 0) {
        for (let j = 0; j < k; j++) { const r = Math.floor(j / 5), f = Math.floor(j / 10); at.push([7.5 + (j % 5) * 17.5, r * 17.5 + f * 6]); }
        h = k ? Math.ceil(k / 5) * 17.5 + Math.floor((k - 1) / 10) * 6 : 0;
      } else if (i === 1) {
        for (let j = 0; j < k; j++) { const r = Math.floor(j / 8); at.push([3 + (j % 8) * 12, r * 95]); }
        h = k ? Math.ceil(k / 8) * 95 : 0;
      } else if (i === 2) {
        for (let j = 0; j < k; j++) at.push([19 - (j % 2) * 4, j * 8]);
        h = k ? b.h + (k - 1) * 8 : 0;
      } else if (i === 3) {
        for (let j = 0; j < k; j++) at.push([18, j * 17]);
        h = k ? b.h + (k - 1) * 17 : 0;
      } else {
        for (let j = 0; j < k; j++) at.push([8, j * 10]);
        h = k ? b.h + (k - 1) * 10 : 0;
      }
      return { at, h, b };
    }
    const TRAY_MIN = 120, TRAY_MAX = 300;
    const trayHeight = (counts) => clamp(Math.max(...counts.map((k, i) => pileLayout(i, k).h)) + 8, TRAY_MIN, TRAY_MAX);
    // a column's pile as a node tree, in a 100-wide box of height H
    function pileNode(i, k, H, live, label) {
      const L = pileLayout(i, k), fit = L.h > H - 8 ? (H - 8) / L.h : 1;
      const kids = L.at.map(([x, y], j) => {
        const b = blockNode(i, live, j === k - 1 ? label : '');
        const node = b.node;
        node.attrs.transform = `translate(${r1(x)} ${r1(-y - L.b.h)})`;
        if (live) node.attrs['data-j'] = j;
        return node;
      });
      const g = nd('g', { transform: `translate(${r1(50 - 50 * fit)} ${r1(H - 4)}) scale(${r1(fit * 1000) / 1000})` }, kids);
      return g;
    }

    function blocksView(host, spec, goal, ctx) {
      const task = Boolean(goal), sys = sysFor(spec, ctx.lang), places = spec.places;
      const showWords = spec.words !== false && langOf(ctx.lang) === 'en';
      const names = placeNames(sys), shorts = placeShort(sys);
      let counts = spec.start.slice(), touched = false, locked = false, busy = false;
      const root = el('div', 'nm nm--blocks');
      root.style.setProperty('--nm-cols', String(places));
      root.appendChild(el('p', 'nm__how', spec.edit
        ? (spec.trade ? T('Add and take away blocks with + and −. Bundle 10 of a kind into 1 of the next, or break 1 into 10.') : T('Add and take away blocks with + and −.'))
        : T('Bundle 10 of a kind into 1 of the next, or break 1 into 10.')));
      const head = el('div', 'nm-num');
      const big = el('p', 'nm-num__digits');
      big.setAttribute('aria-live', 'polite');
      const wordsEl = el('p', 'nm-num__words');
      const expanded = el('p', 'nm-num__expanded');
      head.append(big, wordsEl, expanded);
      if (!showWords) wordsEl.hidden = true;
      const chart = el('div', 'nm-chart');
      chart.setAttribute('role', 'group');
      chart.setAttribute('aria-label', T('Place-value blocks'));
      root.append(head, chart);
      const cols = [];
      for (let i = places - 1; i >= 0; i--) {
        const col = el('div', 'nm-col nm-col--' + Math.min(i, 4));
        col.setAttribute('role', 'group');
        col.setAttribute('aria-label', names[i]);
        const h = el('div', 'nm-col__head');
        h.append(el('span', 'nm-col__short', shorts[i]), el('span', 'nm-col__name', names[i]));
        const tray = el('div', 'nm-col__tray');
        const svg = document.createElementNS(SVGNS, 'svg');
        svg.setAttribute('class', 'nm-col__svg');
        svg.setAttribute('aria-hidden', 'true');
        tray.appendChild(svg);
        const count = el('div', 'nm-col__count');
        const ctl = el('div', 'nm-col__ctl');
        let plus = null, minus = null, bundle = null, brk = null;
        if (spec.edit) {
          minus = btn('nm-pm nm-pm--minus', N.MINUS, F('Take away {what}', { what: countText(i, 1, sys) }));
          plus = btn('nm-pm nm-pm--plus', '+', F('Add {what}', { what: countText(i, 1, sys) }));
          ctl.append(minus, plus);
          minus.addEventListener('click', () => change(i, -1));
          plus.addEventListener('click', () => change(i, 1));
        }
        const trade = el('div', 'nm-col__trade');
        // every column has room for both trade buttons (an empty slot where one can't be), so the rows line up
        const slot = () => { const s = el('span', 'nm-trade nm-trade--none'); s.setAttribute('aria-hidden', 'true'); return s; };
        if (spec.trade && places > 1) {
          if (i < places - 1) {
            bundle = btn('nm-trade nm-trade--bundle', '', F('Bundle {many} into {one}', { many: countText(i, 10, sys), one: countText(i + 1, 1, sys) }));
            bundle.append(icon('bundle'), el('span', 'nm-trade__t', T('Bundle')));
            bundle.addEventListener('click', () => trade1(i, 1));
            trade.appendChild(bundle);
          } else trade.appendChild(slot());
          if (i > 0) {
            brk = btn('nm-trade nm-trade--break', '', F('Break {one} into {many}', { one: countText(i, 1, sys), many: countText(i - 1, 10, sys) }));
            brk.append(icon('break'), el('span', 'nm-trade__t', T('Break')));
            brk.addEventListener('click', () => trade1(i, -1));
            trade.appendChild(brk);
          } else trade.appendChild(slot());
        }
        col.append(h, tray, count, ctl);
        if (spec.trade && places > 1) col.appendChild(trade);
        chart.appendChild(col);
        cols[i] = { col, svg, count, plus, minus, bundle, brk };
      }
      const live = el('p', 'nm__live');
      live.setAttribute('aria-live', 'polite');
      root.appendChild(live);
      if (!task) {
        const bar = el('div', 'nm__actions');
        const again = btn('nm__link', T('Start again'));
        again.addEventListener('click', () => { if (busy) return; counts = spec.start.slice(); touched = false; draw(); });
        bar.appendChild(again);
        root.appendChild(bar);
      }
      function icon(kind) {
        // two small arrows: into the next place to the left (bundle), or out to the right (break)
        const d = kind === 'bundle' ? 'M14 5H4m0 0l4-4M4 5l4 4' : 'M2 5h10m0 0L8 1m4 4L8 9';
        const s = document.createElementNS(SVGNS, 'svg');
        s.setAttribute('viewBox', '0 0 16 10'); s.setAttribute('width', '16'); s.setAttribute('height', '10'); s.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
        s.appendChild(p);
        return s;
      }

      function draw(fresh) {
        const H = trayHeight(counts);
        for (let i = 0; i < places; i++) {
          const c = cols[i];
          c.svg.setAttribute('viewBox', `0 0 100 ${H}`);
          c.svg.textContent = '';
          c.svg.appendChild(toDom(pileNode(i, counts[i], H, true, i >= 4 ? shorts[i] : '')));
          if (fresh && fresh.col === i && !reduced(ctx)) {
            const last = c.svg.querySelector(`[data-j="${counts[i] - 1}"]`);
            if (last && last.animate) last.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
          }
          c.count.textContent = String(counts[i]);
          c.count.classList.toggle('is-over', counts[i] > 9);
          c.count.setAttribute('aria-label', countText(i, counts[i], sys));
          const off = locked || busy;
          if (c.plus) c.plus.disabled = off || counts[i] >= N.CAP;
          if (c.minus) c.minus.disabled = off || counts[i] <= 0;
          if (c.bundle) c.bundle.disabled = off || counts[i] < 10 || counts[i + 1] >= N.CAP;
          if (c.brk) c.brk.disabled = off || counts[i] < 1 || counts[i - 1] > N.CAP - 10;
        }
        const total = N.totalOf(counts);
        big.textContent = N.group(total, sys);
        wordsEl.textContent = showWords ? cap(N.words(total, sys)) : '';
        const terms = counts.map((k, i) => k * 10 ** i).map((v, i) => [v, i]).filter(([v]) => v > 0).reverse();
        // the expanded form; with a place over 9 it adds up to the number above
        const over = counts.some((k) => k > 9);
        expanded.textContent = terms.length > 1 || over
          ? terms.map(([v]) => N.group(v, sys)).join(' + ') + (over ? ' = ' + N.group(total, sys) : '')
          : '';
      }
      const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      function changed(msg) { touched = true; if (msg) live.textContent = msg; ctx.onChange(value()); }
      function change(i, d) {
        if (locked || busy) return;
        const k = counts[i] + d;
        if (k < 0 || k > N.CAP) return;
        counts[i] = k;
        draw(d > 0 ? { col: i } : null);
        changed(F('{what}: {number}', { what: countText(i, k, sys), number: N.group(N.totalOf(counts), sys) }));
      }
      // bundle (dir 1): 10 of place i become 1 of place i + 1; break (dir -1): 1 of place i becomes 10 of place i - 1
      function trade1(i, dir) {
        if (locked || busy) return;
        const to = i + dir;
        if (dir > 0 ? counts[i] < 10 || counts[to] >= N.CAP : counts[i] < 1 || counts[to] > N.CAP - 10) return;
        const msg = dir > 0 ? F('Bundled {many} into {one}.', { many: countText(i, 10, sys), one: countText(to, 1, sys) }) : F('Broke {one} into {many}.', { one: countText(i, 1, sys), many: countText(to, 10, sys) });
        const apply = () => {
          counts[i] -= dir > 0 ? 10 : 1;
          counts[to] += dir > 0 ? 1 : 10;
        };
        if (reduced(ctx) || !root.animate) { apply(); draw(); changed(msg); return; }
        busy = true;
        draw(); // the buttons wait while it moves
        const src = dir > 0 ? range(10).map((j) => counts[i] - 10 + j) : [counts[i] - 1];
        const srcEls = src.map((j) => cols[i].svg.querySelector(`[data-j="${j}"]`)).filter(Boolean);
        const from = unionRect(srcEls);
        if (!from) { busy = false; apply(); draw(); changed(msg); return; }
        // the blocks that go glow, then fly to their new place as one
        srcEls.forEach((e) => e.classList.add('is-going'));
        timers.push(setTimeout(() => {
          if (dead) return;
          apply();
          draw();
          changed(msg);
          const dst = dir > 0 ? [counts[to] - 1] : range(10).map((j) => counts[to] - 10 + j);
          const dstEls = dst.map((j) => cols[to].svg.querySelector(`[data-j="${j}"]`)).filter(Boolean);
          const all = unionRect(dstEls);
          // a bundle becomes the new block; a broken block flies over as it is, and the ten appear under it
          const target = !all ? null : dir > 0 ? all : { left: all.left + all.width / 2 - from.width / 2, top: all.top + all.height / 2 - from.height / 2, width: from.width, height: from.height };
          dstEls.forEach((e) => { e.style.opacity = '0'; });
          const fly = flyer(dir > 0 ? to : i, target, root);
          let over = false;
          const done = () => {
            if (over || dead) return;
            over = true;
            if (fly) fly.remove();
            dstEls.forEach((e) => { e.style.opacity = ''; if (e.animate && dir < 0) e.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: 220 }); });
            busy = false;
            draw();
          };
          if (!fly) { done(); return; }
          const anim = fly.animate([
            { transform: `translate(${r1(from.left - target.left)}px, ${r1(from.top - target.top)}px) scale(${r1((from.width / target.width) * 100) / 100}, ${r1((from.height / target.height) * 100) / 100})`, opacity: 1 },
            { transform: 'translate(0px, 0px) scale(1, 1)', opacity: dir > 0 ? 1 : 0.4 }
          ], { duration: 460, easing: 'cubic-bezier(.3,.7,.3,1)' });
          anim.onfinish = done;
          timers.push(setTimeout(done, 800)); // a hidden tab runs no animations: end up right anyway
        }, 240));
      }
      let dead = false;
      const timers = [];
      function unionRect(els) {
        if (!els.length) return null;
        const base = root.getBoundingClientRect();
        const rs = els.map((e) => e.getBoundingClientRect());
        const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
        const right = Math.max(...rs.map((r) => r.right)), bottom = Math.max(...rs.map((r) => r.bottom));
        if (right - left < 1 || bottom - top < 1) return null;
        return { left: left - base.left, top: top - base.top, width: right - left, height: bottom - top };
      }
      // a picture of one block of place i, over the chart, sized to the target
      function flyer(i, target, host) {
        if (!target) return null;
        const b = blockNode(i, false, i >= 4 ? shorts[i] : '');
        const s = toDom(nd('svg', { viewBox: `0 0 ${b.w} ${b.h}`, preserveAspectRatio: 'none' }, [b.node]));
        const box = el('div', 'nm-fly');
        box.style.left = target.left + 'px';
        box.style.top = target.top + 'px';
        box.style.width = target.width + 'px';
        box.style.height = target.height + 'px';
        box.appendChild(s);
        host.appendChild(box);
        return box;
      }
      const value = () => (touched ? { counts: counts.slice() } : null);
      host.textContent = '';
      host.appendChild(root);
      draw();
      return {
        value,
        reset() { counts = spec.start.slice(); touched = false; root.classList.remove('is-done'); draw(); },
        reveal() {
          const sol = goal ? N.solution(spec, goal) : null;
          if (sol) { counts = sol.counts.slice(); touched = true; }
          locked = true;
          root.classList.add('is-done');
          draw();
        },
        lock(on) { locked = Boolean(on); root.classList.toggle('is-locked', locked); draw(); },
        destroy() { dead = true; timers.forEach(clearTimeout); host.textContent = ''; }
      };
    }

    /* ==================================================================
       Mounting, checking, and saying it in words
       ================================================================== */

    function mount(host, spec, goal, ctx) {
      ctx = ctx || {};
      ctx.onChange = typeof ctx.onChange === 'function' ? ctx.onChange : () => {};
      lastLang = langOf(ctx.lang);
      const view = spec.mode === 'fraction' ? fractionView : spec.mode === 'line' ? lineView : blocksView;
      return view(host, spec, goal, ctx);
    }

    // checked tasks, kept: check(), describe() and answer() are called often with the same ones
    const kept = new Map();
    function cleanTask(spec, goal) {
      let k;
      try { k = JSON.stringify([spec, goal]); } catch (e) { return null; }
      if (kept.has(k)) return kept.get(k);
      let r = null;
      try { r = N.cleanTask(spec, goal); } catch (e) { r = null; }
      if (kept.size > 50) kept.clear();
      kept.set(k, r);
      return r;
    }
    function cleanSpec(spec) { try { return N.cleanSpec(spec); } catch (e) { return null; } }

    // "2/4 = 1/2", or "3/4" when it is already simplest
    const fracText = (k, n) => { const q = N.Q(k, n); return k + '/' + n + (k && q.d !== n ? ' = ' + N.show(q) : ''); };
    const sumText = (start, by, format) => N.show(qOf(start), format) + (qOf(by).n < 0 ? ' ' + N.MINUS + ' ' : ' + ') + N.show(N.Q(Math.abs(qOf(by).n), qOf(by).d), format);

    function noteFor(spec, goal, why) {
      if (!why) return '';
      const sys = sysFor(spec);
      const many = spec.mode === 'fraction' && spec.shapes.length > 1;
      switch (why.code) {
        case 'empty': return spec.mode === 'blocks' ? T('Add some blocks first.') : T('Shade some parts first.');
        case 'shade': {
          const did = many
            ? F('On shape {i}, you shaded {k} of {n} parts: that is {frac}.', { i: why.shape + 1, k: why.k, n: why.n, frac: fracText(why.k, why.n) })
            : F('You shaded {k} of {n} parts: that is {frac}.', { k: why.k, n: why.n, frac: fracText(why.k, why.n) });
          return did + ' ' + F('The task asks for {want}.', { want: why.as || showQ(why.want) });
        }
        case 'sum': return F('Together you shaded {a} + {b} = {got}.', { a: why.a.k + '/' + why.a.n, b: why.b.k + '/' + why.b.n, got: showQ(why.got, 'mixed') }) + ' ' + F('The task asks for {want}.', { want: why.as || showQ(why.want) });
        case 'equal-edge': return T('Shade part of each shape: not none of it, and not all of it.');
        case 'equal': return F('{a} and {b} are not equal.', { a: fracText(why.a.k, why.a.n), b: fracText(why.b.k, why.b.n) });
        case 'unplaced': return T('Put the marker on the line first.');
        case 'place': {
          const did = F('You put the marker at {v}.', { v: showQ(why.got, spec.format) });
          return why.dir < 0 ? did + ' ' + T('That is too far left.') : why.dir > 0 ? did + ' ' + T('That is too far right.') : did;
        }
        case 'no-hops': return T('Make your jumps first.');
        case 'start': return F('Your jumps start at {at}, but {sum} starts at {start}.', { at: showQ(why.at, spec.format), sum: sumText(why.start, why.by, spec.format), start: showQ(why.start, spec.format) });
        case 'direction': return qOf(why.by).n > 0 ? T('To add, jump to the right.') : T('To take away, jump to the left.');
        case 'hop': return F('Make every jump {hop}.', { hop: showQ(why.hop, spec.format) });
        case 'total': return F('Your jumps make {total} in all, so you land on {end}. For {sum}, they should make {by}.', { total: showQ(why.total, spec.format), end: showQ(why.end, spec.format), sum: sumText(why.start, why.by, spec.format), by: N.show(N.Q(Math.abs(qOf(why.by).n), qOf(why.by).d), spec.format) });
        case 'value': return F('You made {got}. The task asks for {want}.', { got: N.group(why.got, sys), want: N.group(why.want, sys) });
        case 'fewest': return F('That makes {got}, but not with the fewest blocks: bundle any 10 of a kind into 1 of the next.', { got: N.group(why.got, sys) });
        case 'counts-same': return F('You have {counts}: that is {got}, but the task asks for {want}.', { counts: countsText(why.counts, sys), got: N.group(why.got, sys), want: countsText(why.wantCounts, sys) });
        case 'counts': return F('You have {counts}, which makes {got}. The task asks for {want}.', { counts: countsText(why.counts, sys), got: N.group(why.got, sys), want: countsText(why.wantCounts, sys) });
        default: return '';
      }
    }

    function describe(value, spec0) {
      const spec = cleanSpec(spec0);
      if (!spec || !value || typeof value !== 'object') return '';
      if (spec.mode === 'fraction') {
        const sh = N.shadingOf(spec, value);
        if (!sh) return '';
        return sh.map((l, i) => F('{k} of {n} parts shaded ({frac})', { k: l.length, n: spec.shapes[i].parts, frac: fracText(l.length, spec.shapes[i].parts) })).join('; ');
      }
      if (spec.mode === 'line') {
        const st = N.lineState(spec, value);
        if (!st || !st.at) return '';
        if (!st.hops.length) return F('The marker at {v}', { v: N.show(st.at, spec.format) });
        return N.show(st.at, spec.format) + st.hops.map((h) => (h.n < 0 ? ' ' + N.MINUS + ' ' : ' + ') + N.show(N.Q(Math.abs(h.n), h.d), spec.format)).join('') + ' = ' + N.show(st.end, spec.format);
      }
      const c = N.blocksState(spec, value);
      if (!c) return '';
      const sys = sysFor(spec);
      return F('{counts}: {number}', { counts: countsText(c, sys), number: N.group(N.totalOf(c), sys) });
    }

    function answer(goal0, spec0) {
      const t = cleanTask(spec0, goal0);
      if (!t) return '';
      const { spec, goal } = t;
      const sol = N.solution(spec, goal);
      if (!sol) return '';
      if (spec.mode === 'fraction') {
        const sh = sol.shaded, n = (i) => spec.shapes[i].parts;
        if (goal.type === 'equal') return F('For example, {k1} of {n1} parts and {k2} of {n2} parts: {a} = {b}.', { k1: sh[0].length, n1: n(0), k2: sh[1].length, n2: n(1), a: sh[0].length + '/' + n(0), b: sh[1].length + '/' + n(1) });
        if (goal.sum) return F('Shade {k1} of {n1} parts and {k2} of {n2} parts: together {want}.', { k1: sh[0].length, n1: n(0), k2: sh[1].length, n2: n(1), want: showQ(goal.value, 'mixed') + (qOf(goal.value).n > qOf(goal.value).d ? ' (' + showQ(goal.value) + ')' : '') });
        if (goal.values) return goal.values.map((v, i) => (v == null ? null : F('Shape {i}: shade {k} of {n} parts ({frac}).', { i: i + 1, k: sh[i].length, n: n(i), frac: fracText(sh[i].length, n(i)) }))).filter(Boolean).join(' ');
        const i = goal.shape || 0, k = sh[i].length;
        return F('Shade {k} of the {n} parts: {frac}.', { k, n: n(i), frac: (goal.as ? goal.as + ' = ' : '') + fracText(k, n(i)) });
      }
      if (spec.mode === 'line') {
        if (goal.type === 'place') return F('The marker at {v}.', { v: orList(goal.at.map((v) => showQ(v, spec.format) + (spec.format === 'fraction' && qOf(v).d > 1 && Math.abs(qOf(v).n) > qOf(v).d ? ' = ' + showQ(v, 'mixed') : ''))) });
        const by = qOf(goal.by), hops = sol.hops.map(qOf), end = N.add(qOf(goal.start), by);
        const same = hops.every((h) => N.eq(h, hops[0]));
        const vals = { start: showQ(goal.start, spec.format), count: hops.length, hop: N.show(N.Q(Math.abs(hops[0].n), hops[0].d), spec.format), sum: sumText(goal.start, goal.by, spec.format), end: N.show(end, spec.format), hops: hops.map((h) => (h.n < 0 ? N.MINUS : '+') + N.show(N.Q(Math.abs(h.n), h.d), spec.format)).join(' ') };
        if (!same) return F('Start at {start} and jump {hops}: {sum} = {end}.', vals);
        if (hops.length === 1) return by.n > 0 ? F('Start at {start} and make one jump of {hop} to the right: {sum} = {end}.', vals) : F('Start at {start} and make one jump of {hop} to the left: {sum} = {end}.', vals);
        return by.n > 0 ? F('Start at {start} and make {count} jumps of {hop} to the right: {sum} = {end}.', vals) : F('Start at {start} and make {count} jumps of {hop} to the left: {sum} = {end}.', vals);
      }
      const sys = sysFor(spec);
      return F('{counts}: {number}.', { counts: countsText(sol.counts, sys), number: N.group(N.totalOf(sol.counts), sys) });
    }

    /* ---------------- the still picture: the book, print and EPUB ---------------- */

    function still(spec0, goal0) {
      const t = goal0 ? cleanTask(spec0, goal0) : null;
      const spec = t ? t.spec : cleanSpec(spec0);
      if (!spec) return '';
      const sys = sysFor(spec);
      if (spec.mode === 'fraction') {
        const pics = spec.shapes.map((s) => shapeNode(s, s.shaded, { live: false, labels: spec.labels }));
        const stack = spec.shapes.length > 1 && spec.shapes.every((s) => s.shape === 'bar');
        const gap = 28;
        let W = 0, H = 0;
        const placed = [];
        pics.forEach((p, i) => {
          const w = Number(p.attrs.width), h = Number(p.attrs.height);
          const label = spec.shapes[i].label ? 22 : 0, read = spec.shapes[i].shaded.length ? 52 : 0;
          if (stack) { placed.push({ p, x: 0, y: H + label, w, h, label, read, i }); W = Math.max(W, w); H += label + h + read + 14; }
          else { placed.push({ p, x: W + (i ? gap : 0), y: label, w, h, label, read, i }); W += (i ? gap : 0) + w; H = Math.max(H, label + h + read); }
        });
        const kids = [];
        placed.forEach(({ p, x, y, w, h, label, read, i }) => {
          const s = spec.shapes[i];
          p.attrs.x = r1(x); p.attrs.y = r1(y);
          kids.push(p);
          if (label) kids.push(nd('text', { x: r1(x + w / 2), y: r1(y - 7), 'text-anchor': 'middle', 'font-size': 15, 'font-style': 'italic', fill: SOFT }, [s.label]));
          if (read) kids.push(qSvg(raw(s.shaded.length, s.parts), 'fraction', x + w / 2, y + h + 22, 26, {}));
          if (!stack && i === 1 && spec.join === 'add') kids.push(nd('text', { x: r1(x - gap / 2), y: r1(y + h / 2 + 8), 'text-anchor': 'middle', 'font-size': 24, fill: INK }, ['+']));
        });
        return toStr(nd('svg', { xmlns: SVGNS, viewBox: `0 0 ${r1(W)} ${r1(H)}`, width: r1(W), height: r1(H), 'font-family': FONT, role: 'img', 'aria-label': spec.shapes.map(shapeWord).join('; ') }, kids));
      }
      if (spec.mode === 'line') {
        const W = 600;
        const at = spec.start != null ? N.tickOf(spec, N.value(spec.start)) : -1;
        const g = lineNode(spec, W, { live: false, hops: [], at, sys });
        const kids = [nd('rect', { x: 0.5, y: 0.5, width: W - 1, height: g.H - 1, rx: 4, fill: PAPER, stroke: '#c9b48a' }), g.node];
        if (at >= 0) { const pn = pinNode(g.base, false, false); pn.attrs.transform = `translate(${r1(g.x(at))} 0)`; kids.push(pn); }
        return toStr(nd('svg', { xmlns: SVGNS, viewBox: `0 0 ${W} ${g.H}`, width: W, height: g.H, 'font-family': FONT, role: 'img', 'aria-label': F('A number line from {a} to {b}', { a: showQ(spec.from, spec.format), b: showQ(spec.to, spec.format) }) }, kids));
      }
      // blocks: a place-value chart with the starting blocks and a box for each digit
      const n = spec.places, colW = 100, gap = 8, H = trayHeight(spec.start), names = placeShort(sys);
      const W = n * colW + (n - 1) * gap, top = 30, kids = [];
      for (let c = 0; c < n; c++) {
        const i = n - 1 - c, x = c * (colW + gap);
        kids.push(nd('rect', { x: x + 0.5, y: 0.5, width: colW - 1, height: top + H + 44, rx: 5, fill: PAPER, stroke: '#c9b48a' }));
        kids.push(nd('text', { x: x + colW / 2, y: 21, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 700, fill: INK }, [names[i]]));
        const pile = pileNode(i, spec.start[i], H, false, i >= 4 ? names[i] : '');
        kids.push(nd('g', { transform: `translate(${x} ${top})` }, [pile]));
        kids.push(nd('rect', { x: x + 30, y: top + H + 6, width: 40, height: 32, rx: 4, fill: '#fffaf0', stroke: SOFT }));
        if (N.totalOf(spec.start)) kids.push(nd('text', { x: x + colW / 2, y: top + H + 29, 'text-anchor': 'middle', 'font-size': 20, fill: INK }, [String(spec.start[i])]));
      }
      const label = N.totalOf(spec.start) ? N.group(N.totalOf(spec.start), sys) : F('Place-value chart: {places}', { places: placeNames(sys).slice(0, n).reverse().join(', ') });
      return toStr(nd('svg', { xmlns: SVGNS, viewBox: `0 0 ${W} ${top + H + 46}`, width: W, height: top + H + 46, 'font-family': FONT, role: 'img', 'aria-label': label }, kids));
    }

    P.widgets.register('numbers', {
      block(host, raw, ctx) {
        let spec;
        try { spec = N.cleanBlock(raw); } catch (e) { throw new Error('this number part does not hold together: ' + e.message); }
        return mount(host, spec, null, ctx);
      },
      task(host, rawSpec, rawGoal, ctx) {
        const t = cleanTask(rawSpec, rawGoal);
        if (!t) throw new Error('this number task does not hold together');
        return mount(host, t.spec, t.goal, ctx);
      },
      check(goal, value, spec) {
        const t = cleanTask(spec, goal);
        if (!t) return { correct: false, invalid: true };
        const r = N.check(t.spec, t.goal, value);
        const note = r.correct ? '' : noteFor(t.spec, t.goal, r.why);
        return r.invalid ? { correct: false, invalid: true, note } : { correct: r.correct, note };
      },
      describe, answer, still
    });
  }
})();
