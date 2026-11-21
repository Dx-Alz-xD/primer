/* =====================================================================
   The graph (assets/js/widgets.js): curves y = f(x) on a coordinate
   plane, with sliders, points to drag, a tangent showing its slope and
   a shaded area showing its value. As a lesson block it is there to
   play with; as a task the learner sets the sliders ("params"), drags a
   point ("point") or taps an x ("x"), and check() says if it's right.

   Its maths (expressions, specs, goals) is graph-expr.js, shared with
   the server (server/widgets/graph.mjs) and loaded first: register()
   passes that load as `ready`, so nothing here runs before it.

   Drawn as SVG at the plane's own pixel size, so text stays readable at
   340 px, and redrawn when the plane resizes. Labels are text nodes,
   typeset by KaTeX when they hold \( \). A focused point moves with the
   arrow keys (Shift: five steps); in an "x" task the plane does too.
   Curves are sampled more finely where they bend, and broken where they
   jump (tan x, 1/x, floor x) or have no value (sqrt x for x < 0).
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;

  const ready = window.PrimerGraphExpr ? Promise.resolve() : new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/assets/js/widgets/graph-expr.js';
    s.async = true;
    s.dataset.widget = 'graph';
    s.onload = () => (window.PrimerGraphExpr ? resolve() : reject(new Error('the graph\'s maths did not load')));
    s.onerror = () => reject(new Error('the graph\'s maths could not be loaded'));
    document.head.appendChild(s);
  });
  const G = () => window.PrimerGraphExpr;
  const NS = 'http://www.w3.org/2000/svg';
  const fin = Number.isFinite;
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, v) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const esc = P.esc || ((s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
  const COL = (name) => (G() && G().PALETTE[name]) || '#2b1d11';
  let uid = 0;

  const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const sv = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  /* ---------- labels: KaTeX where there is maths, readable text where there is none ---------- */
  const TEX = /\\\(|\\\[/;
  const SYM = { pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', lambda: 'λ', mu: 'μ', sigma: 'σ', omega: 'ω', phi: 'φ', infty: '∞', cdot: '·', times: '×', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', pm: '±', to: '→', circ: '°', approx: '≈', int: '∫' };
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', x: 'ˣ', i: 'ⁱ' };
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };
  const script = (map, mark) => (m, k) => ([...k].every((c) => c in map) ? [...k].map((c) => map[c]).join('') : `${mark}(${k})`);
  // "\(y = ax^2 + \frac{1}{2}\)" -> "y = ax² + (1)/(2)": for the still picture, readouts and pages without KaTeX
  function plain(str) {
    return String(str || '')
      .replace(/\\[()[\]]/g, '')
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, a, b) => `${a.length > 1 ? `(${a})` : a}/${b.length > 1 ? `(${b})` : b}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
      .replace(/\\(left|right|displaystyle|mathrm|text|operatorname|,|;|!|quad)/g, '')
      .replace(/\\([A-Za-z]+)/g, (m, k) => (k in SYM ? SYM[k] : k))
      .replace(/\^\{([^{}]*)\}/g, script(SUP, '^')).replace(/\^([\w+-])/g, script(SUP, '^'))
      .replace(/_\{([^{}]*)\}/g, script(SUB, '_')).replace(/_(\w)/g, script(SUB, '_'))
      .replace(/[{}]/g, '').replace(/(\s)-(?=\s)/g, '$1−').replace(/\s+/g, ' ').trim();
  }
  function label(el, str) {
    if (!str) return;
    if (!TEX.test(str)) { el.textContent = str; return; }
    const katex = Boolean(window.renderMathInElement);
    if (P.math && (katex || document.readyState !== 'complete')) { el.textContent = str; P.math(el); return; } // P.math waits for KaTeX
    if (katex) {
      el.textContent = str;
      try { window.renderMathInElement(el, { delimiters: [{ left: '\\(', right: '\\)', display: false }], throwOnError: false }); } catch (e) { el.textContent = plain(str); }
      return;
    }
    el.textContent = plain(str);
  }

  /* ---------- drawing, shared by the live graph and the still picture ---------- */

  // the plane's height for its width: taller on a phone
  const heightFor = (w) => Math.round(Math.max(230, Math.min(460, w * (w < 520 ? 0.82 : 0.62))));

  function frame(spec, W, H) {
    const pad = 4, X0 = spec.x[0], X1 = spec.x[1], Y0 = spec.y[0], Y1 = spec.y[1];
    const XS = (W - 2 * pad) / (X1 - X0), YS = (H - 2 * pad) / (Y1 - Y0);
    return {
      W, H, X0, X1, Y0, Y1, top: pad, bottom: H - pad, left: pad, right: W - pad,
      px: (x) => pad + (x - X0) * XS, py: (y) => pad + (Y1 - y) * YS,
      ix: (p) => X0 + (p - pad) / XS, iy: (p) => Y1 - (p - pad) / YS
    };
  }

  function piLabel(n, q) {
    if (n === 0) return '0';
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const c = gcd(Math.abs(n), q);
    n /= c; q /= c;
    return (n < 0 ? '−' : '') + (Math.abs(n) === 1 ? '' : Math.abs(n)) + 'π' + (q === 1 ? '' : '/' + q);
  }
  // tick values along an axis, about one per 62 px across and 40 px up
  function tickSet(spec, fr, axis) {
    const g = G();
    const [a, b] = axis === 'x' ? spec.x : spec.y;
    const maxN = Math.max(2, Math.floor((axis === 'x' ? fr.W : fr.H) / (axis === 'x' ? 62 : 40)));
    let step = axis === 'x' ? spec.xstep : spec.ystep;
    let pi = axis === 'x' && spec.xpi ? spec.xpi.slice() : null;
    if (step) { while ((b - a) / step > maxN) { step *= 2; if (pi) pi[0] *= 2; } } else { step = g.niceStep((b - a) / maxN); pi = null; }
    const d = g.decimals(step), list = [];
    for (let k = Math.ceil(a / step - 1e-9); k * step <= b + 1e-9 && list.length < 120; k++) list.push({ v: k * step, k, text: pi ? piLabel(k * pi[0], pi[1]) : g.fmt(k * step, d) });
    return list;
  }
  // the grid, the axes and their numbers, as plain shapes for either kind of drawing
  function gridParts(spec, fr) {
    const out = { grid: [], axes: [], arrows: [], names: [], labels: [] };
    const { top, bottom, left, right } = fr;
    const xt = tickSet(spec, fr, 'x'), yt = tickSet(spec, fr, 'y');
    xt.forEach((tk) => { const X = fr.px(tk.v); out.grid.push([X, top, X, bottom]); });
    yt.forEach((tk) => { const Y = fr.py(tk.v); out.grid.push([left, Y, right, Y]); });
    const xAxis = fr.Y0 <= 0 && fr.Y1 >= 0, yAxis = fr.X0 <= 0 && fr.X1 >= 0;
    const ax = xAxis ? fr.py(0) : bottom, ay = yAxis ? fr.px(0) : left;
    if (xAxis) {
      out.axes.push([left, ax, right, ax]);
      out.arrows.push(`M${right} ${ax}l-8 -3.5v7z`);
      out.names.push({ x: right - 6, y: ax - 8, anchor: 'end', text: 'x' });
    }
    if (yAxis) {
      out.axes.push([ay, bottom, ay, top]);
      out.arrows.push(`M${ay} ${top}l-3.5 8h7z`);
      out.names.push({ x: ay + 9, y: top + 13, anchor: 'start', text: 'y' });
    }
    const below = ax + 18 <= bottom, leftOf = ay - 6 >= left + 24;
    const lx = below ? ax + 15 : ax - 6, ly = leftOf ? ay - 6 : ay + 6, anchor = leftOf ? 'end' : 'start';
    xt.forEach((tk) => {
      if (tk.k === 0 && yAxis) return;
      const X = fr.px(tk.v);
      if (X > left + 10 && X < right - 16) out.labels.push({ x: X, y: lx, anchor: 'middle', text: tk.text });
    });
    yt.forEach((tk) => {
      if (tk.k === 0 && xAxis) return;
      const Y = fr.py(tk.v);
      if (Y > top + 18 && Y < bottom - 8) out.labels.push({ x: ly, y: Y + 4.5, anchor, text: tk.text });
    });
    if (xAxis && yAxis) out.labels.push({ x: ly, y: lx, anchor, text: '0' });
    return out;
  }

  // A curve as pixel polylines: sampled more finely where it bends, broken where it jumps or has no value.
  function trace(f, fr) {
    const { top, bottom } = fr, span = bottom - top;
    const segs = [];
    let cur = null;
    const ev = (x) => { const y = f(x); return fin(y) ? y : NaN; };
    const lim = (p) => Math.max(top - 3 * span, Math.min(bottom + 3 * span, p));
    const add = (x, y) => { const p = [fr.px(x), lim(fr.py(y))]; if (cur) cur.push(p); else { cur = [p]; segs.push(cur); } };
    const cut = () => { cur = null; };
    const side = (y) => { const p = fr.py(y); return p < top - span ? -1 : p > bottom + span ? 1 : 0; };
    // where the curve's values end, between a (a value) and b (none)
    const edge = (a, b) => { for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (fin(ev(m))) a = m; else b = m; } return a; };
    // a big step between a and b: a steep curve shrinks it as the interval shrinks, a break keeps it
    const breaks = (a, ya, b, yb) => {
      for (let k = 0; k < 50; k++) {
        const m = (a + b) / 2, ym = ev(m);
        if (!fin(ym)) return true;
        if (Math.abs(fr.py(ym) - fr.py(ya)) > Math.abs(fr.py(yb) - fr.py(ym))) { b = m; yb = ym; } else { a = m; ya = ym; }
        if (Math.abs(fr.py(yb) - fr.py(ya)) < 1) return false;
      }
      return true;
    };
    const MAXD = 7;
    function seg(x0, y0, x1, y1, d) {
      const f0 = fin(y0), f1 = fin(y1), xm = (x0 + x1) / 2, ym = ev(xm), fm = fin(ym);
      if (f0 && f1 && fm) {
        const s0 = side(y0);
        if (s0 && s0 === side(y1) && s0 === side(ym)) { cut(); add(x1, y1); return; } // far off the plane: nothing to see
        const bend = Math.abs(fr.py(ym) - (fr.py(y0) + fr.py(y1)) / 2);
        if (bend < 0.3) { add(x1, y1); return; }
        if (d >= MAXD) {
          if (Math.abs(fr.py(y1) - fr.py(y0)) > 4 && breaks(x0, y0, x1, y1)) cut();
          add(x1, y1);
          return;
        }
        seg(x0, y0, xm, ym, d + 1);
        seg(xm, ym, x1, y1, d + 1);
        return;
      }
      if (!f0 && !f1 && !fm && d >= 2) { cut(); return; } // no values here at all
      if (d < MAXD) { seg(x0, y0, xm, ym, d + 1); seg(xm, ym, x1, y1, d + 1); return; }
      if (f0 && !f1) { const e = edge(x0, x1); add(e, ev(e)); cut(); return; }
      if (!f0 && f1) { const e = edge(x1, x0); cut(); add(e, ev(e)); add(x1, y1); return; }
      cut();
    }
    const N = Math.max(48, Math.min(320, Math.round(fr.W / 3)));
    let xa = fr.X0, ya = ev(xa);
    if (fin(ya)) add(xa, ya);
    for (let k = 1; k <= N; k++) {
      const xb = fr.X0 + (fr.X1 - fr.X0) * k / N, yb = ev(xb);
      seg(xa, ya, xb, yb, 0);
      xa = xb; ya = yb;
    }
    return segs;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const pathOf = (segs) => segs.filter((s) => s.length > 1).map((s) => 'M' + s.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L')).join('');

  // the shaded area under curve i between a and b, as a path
  function areaPath(m, spec, fr, P) {
    const ar = spec.area;
    const a = m.val(ar.from, P), b = m.val(ar.to, P);
    const lo = Math.max(fr.X0, Math.min(a, b)), hi = Math.min(fr.X1, Math.max(a, b));
    if (!(fin(lo) && fin(hi) && hi > lo)) return '';
    const f = m.curve(ar.plot, P), cl = (p) => Math.max(fr.top - 2, Math.min(fr.bottom + 2, p));
    const base = r1(cl(fr.py(0)));
    let d = `M${r1(fr.px(lo))} ${base}`;
    for (let k = 0; k <= 160; k++) {
      const x = lo + (hi - lo) * k / 160, y = f(x);
      d += `L${r1(fr.px(x))} ${r1(cl(fr.py(fin(y) ? y : 0)))}`;
    }
    return d + `L${r1(fr.px(hi))} ${base}Z`;
  }
  // the tangent at x as a segment across the plane (or nothing where the curve has no slope)
  function tangentLine(m, spec, fr, P, x0) {
    const tg = spec.tangent, y0 = m.y(tg.plot, x0, P), k = m.slope(tg.plot, x0, P);
    if (!fin(y0) || !fin(k)) return null;
    const yr = fr.Y1 - fr.Y0, lo = fr.Y0 - yr, hi = fr.Y1 + yr;
    const end = (x) => {
      const y = y0 + k * (x - x0);
      if (y >= lo && y <= hi) return [x, y];
      const yy = y > hi ? hi : lo;
      return [x0 + (yy - y0) / k, yy];
    };
    const a = end(fr.X0), b = end(fr.X1);
    return { x0, y0, k, d: [fr.px(a[0]), fr.py(a[1]), fr.px(b[0]), fr.py(b[1])].map(r1) };
  }

  /* ---------- specs and goals, checked again here (they are untrusted data) ---------- */
  const specs = new WeakMap(), goals = new WeakMap();
  function specOf(raw) {
    if (raw && typeof raw === 'object' && specs.has(raw)) return specs.get(raw);
    const s = G().cleanSpec(raw);
    if (raw && typeof raw === 'object') specs.set(raw, s);
    return s;
  }
  function goalOf(raw, spec) {
    const hit = raw && typeof raw === 'object' ? goals.get(raw) : null;
    if (hit && hit.spec === spec) return hit.goal;
    const goal = G().cleanGoal(raw, spec, { reach: false });
    if (raw && typeof raw === 'object') goals.set(raw, { spec, goal });
    return goal;
  }

  // numbers in words: a slider's to its own step, coordinates to 3 places
  const pv = (p, v) => G().fmt(v, G().paramDecimals(p));
  const pair = (x, y) => `(${G().fmt(x, 3)}, ${G().fmt(y, 3)})`;
  const orList = (items) => items.reduce((a, b) => fill('{a} or {b}', { a, b }));

  /* ---------- the live graph ---------- */
  function view(host, spec, goal, ctx) {
    const g = G(), m = g.model(spec);
    const T = ctx.t || t, F = ctx.fill || fill;
    const mode = goal ? goal.type : null;
    const X0 = spec.x[0], X1 = spec.x[1], Y0 = spec.y[0], Y1 = spec.y[1];
    const startPos = () => spec.points.map((p) => (p.drag ? { x: p.x, y: p.on != null ? null : p.y } : null));
    const fresh = () => ({ params: false, pts: spec.points.map(() => false), tan: false });
    const st = { P: m.start(), pos: startPos(), tx: spec.tangent ? spec.tangent.x : null, pick: null, hover: null, focus: null, moved: fresh(), locked: false };
    const id = 'gph' + (++uid);
    const rd = Math.max(0, Math.min(5, Math.ceil(-Math.log10((X1 - X0) / 400)))); // readout decimals
    const fx = (v) => g.fmt(v, rd);
    let fr = null, raf = 0, dead = false, dragging = false;

    host.textContent = '';
    const root = h('div', 'gph' + (goal ? ' gph--task' : ''));

    if (spec.plots.some((p) => p.label)) {
      const lg = h('div', 'gph__legend');
      spec.plots.forEach((p) => {
        if (!p.label) return;
        const key = h('span', 'gph__key'), sw = h('span', 'gph__swatch' + (p.dashed ? ' is-dashed' : '')), lt = h('span', 'gph__keytext');
        sw.style.borderTopColor = COL(p.color);
        label(lt, p.label);
        key.append(sw, lt);
        lg.appendChild(key);
      });
      root.appendChild(lg);
    }

    const plane = h('div', 'gph__plane');
    plane.dir = 'ltr';
    const svg = sv('svg', { class: 'gph__svg', role: 'group' });
    const over = h('div', 'gph__over');
    over.setAttribute('aria-hidden', 'true');
    plane.append(svg, over);
    root.appendChild(plane);
    const curvesText = spec.plots.map((p) => 'y = ' + p.expr).join('; ');
    const win = { x0: g.fmt(X0, 3), x1: g.fmt(X1, 3), y0: g.fmt(Y0, 3), y1: g.fmt(Y1, 3) };
    svg.setAttribute('aria-label', spec.plots.length ? F('Graph of {curves}: x from {x0} to {x1}, y from {y0} to {y1}.', { curves: curvesText, ...win }) : F('Graph: x from {x0} to {x1}, y from {y0} to {y1}.', win));

    const defs = sv('defs', {}, svg), clip = sv('clipPath', { id: id + 'c' }, defs), clipR = sv('rect', {}, clip);
    const Lgrid = sv('g', { class: 'gph__grid' }, svg);
    const Laxes = sv('g', { class: 'gph__axes' }, svg);
    const Ldraw = sv('g', { 'clip-path': `url(#${id}c)` }, svg);
    const area = spec.area ? sv('path', { class: 'gph__area', fill: COL(spec.plots[spec.area.plot].color) }, Ldraw) : null;
    const lines = spec.lines.map((l) => {
      const el = sv('line', { class: 'gph__line', stroke: COL(l.color) }, Ldraw);
      const lab = l.label ? h('span', 'gph__lab gph__lab--line') : null;
      if (lab) { label(lab, l.label); lab.style.color = COL(l.color); over.appendChild(lab); }
      return { el, lab };
    });
    // the first curve, usually the one the sliders move, is drawn last, on top of any it starts on
    const Lcurves = sv('g', {}, Ldraw);
    const curves = spec.plots.map((p) => sv('path', { class: 'gph__curve' + (p.dashed ? ' is-dashed' : ''), stroke: COL(p.color) }));
    curves.slice().reverse().forEach((c) => Lcurves.appendChild(c));
    const tanLine = spec.tangent ? sv('line', { class: 'gph__tangent' }, Ldraw) : null;
    const Ltick = sv('g', { class: 'gph__ticks' }, svg);
    const hover = sv('g', { class: 'gph__hover' }, svg);
    const hoverLine = sv('line', {}, hover);
    const hoverDots = spec.plots.map((p) => sv('circle', { r: 3.5, fill: COL(p.color) }, hover));
    const pick = mode === 'x' && !spec.tangent ? sv('g', { class: 'gph__pick' }, svg) : null;
    const pickLine = pick ? sv('line', {}, pick) : null;
    const pickMark = pick ? sv('path', {}, pick) : null;
    const pickLab = pick ? h('span', 'gph__lab gph__lab--pick') : null;
    if (pickLab) over.appendChild(pickLab);
    const Lpts = sv('g', {}, svg);

    // a handle the learner drags: a point, or the tangent's foot
    function handle(colour, roleName) {
      const gEl = sv('g', { class: 'gph__pt is-drag' }, Lpts);
      sv('circle', { r: 15, class: 'gph__focus' }, gEl);
      sv('circle', { r: 10.5, class: 'gph__ring', stroke: colour }, gEl);
      sv('circle', { r: 6.5, class: 'gph__dot', fill: colour }, gEl);
      const hit = sv('circle', { r: 22, class: 'gph__hit', tabindex: '0', role: 'slider', 'aria-roledescription': roleName }, gEl);
      return { g: gEl, hit };
    }
    const pts = spec.points.map((p, i) => {
      const c = COL(p.color);
      let el;
      if (p.drag) el = handle(c, T('draggable point'));
      else { el = { g: sv('g', { class: 'gph__pt' }, Lpts), hit: null }; sv('circle', { r: 5, class: 'gph__dot', fill: c }, el.g); }
      el.lab = p.label ? h('span', 'gph__lab') : null;
      if (el.lab) { label(el.lab, p.label); el.lab.style.color = c; over.appendChild(el.lab); }
      el.name = plain(p.label) || '';
      if (p.drag) {
        drag(el.hit, () => where(i), (x, y) => setPoint(i, x, y));
        el.hit.addEventListener('keydown', (e) => keyMove(e, (dx, dy) => {
          const at = where(i);
          if (p.on != null) { dx = dx || dy; dy = 0; }
          if (setPoint(i, at.x + dx * p.snap[0], at.y + dy * p.snap[1])) say(pointText(i));
        }));
        focusable(el.hit, { kind: 'pt', i });
      }
      return el;
    });
    const tan = spec.tangent ? handle(COL('gold'), T('draggable point')) : null;
    if (tan) {
      drag(tan.hit, () => ({ x: st.tx, y: m.y(spec.tangent.plot, st.tx, st.P) }), (x) => setTan(x));
      tan.hit.addEventListener('keydown', (e) => keyMove(e, (dx, dy) => { if (setTan(st.tx + (dx || dy) * spec.tangent.snap)) say(slopeText()); }));
      focusable(tan.hit, { kind: 'tan' });
    }

    const readout = h('div', 'gph__readout');
    readout.dir = 'ltr';
    const info = h('div', 'gph__info');
    root.append(readout, info);

    const params = spec.params.length ? h('div', 'gph__params') : null;
    const sliders = spec.params.map((p) => {
      const row = h('div', 'gph__param');
      const inId = `${id}-${p.name}`;
      const lab = h('label', 'gph__plabel');
      lab.setAttribute('for', inId);
      if (p.label) label(lab, p.label); else lab.appendChild(h('i', 'gph__pname', p.name));
      const inp = document.createElement('input');
      Object.assign(inp, { type: 'range', className: 'gph__range', id: inId, min: String(p.min), max: String(p.max), step: String(p.step), value: String(p.value), dir: 'ltr' });
      const out = h('output', 'gph__pval');
      out.setAttribute('for', inId);
      out.dir = 'ltr';
      const val = document.createTextNode('');
      // "a = 1.5" beside a labelled slider; beside one shown by its name, the number alone
      if (p.label) out.append(h('i', 'gph__pname', p.name), document.createTextNode(' = '));
      out.appendChild(val);
      inp.addEventListener('input', () => {
        if (st.locked) { inp.value = String(st.P[p.name]); return; }
        st.P[p.name] = g.onSteps(Number(inp.value), p.min, p.step, p.max);
        st.moved.params = true;
        changed();
      });
      row.append(lab, inp, out);
      params.appendChild(row);
      return { p, inp, val };
    });
    if (params) root.appendChild(params);

    if (goal) {
      const hintText = mode === 'params' ? 'Move the sliders, then press Check.'
        : mode === 'point' ? 'Drag the point, or use the arrow keys, then press Check.'
          : 'Tap the graph at the right x, or use the arrow keys, then press Check.';
      root.appendChild(h('p', 'gph__hint', T(hintText)));
    }
    const live = h('div', 'gph__live');
    live.setAttribute('aria-live', 'polite');
    root.appendChild(live);
    host.appendChild(root);

    /* ---- state ---- */
    const where = (i) => m.pointAt(spec.points[i], st.P, st.pos[i]);
    const say = (s) => { live.textContent = s; };
    const pointText = (i) => { const at = where(i); return `${pts[i].name ? pts[i].name + ' ' : ''}${pair(at.x, at.y)}`; };
    const slopeText = () => F('Slope at x = {x}: {m}', { x: fx(st.tx), m: g.fmt(m.slope(spec.tangent.plot, st.tx, st.P), 3) });
    function changed() {
      schedule();
      if (goal && ctx.onChange) { try { ctx.onChange(value()); } catch (e) { /* the page's business */ } }
    }
    // a dragged point's axis is its own (on its snap, in the window) or a slider's (on the slider's steps)
    const sliderOf = (v) => (typeof v === 'string' ? spec.params.find((q) => q.name === v) : null);
    function place2(i, x, y, snap) {
      const p = spec.points[i], qx = sliderOf(p.x), qy = p.on == null ? sliderOf(p.y) : null;
      const pos = Object.assign({}, st.pos[i]);
      if (qx) st.P[qx.name] = snap ? g.onSteps(x, qx.min, qx.step, qx.max) : x;
      else pos.x = snap ? g.onGrid(x, p.snap[0], X0, X1) : x;
      if (p.on == null) {
        if (qy) st.P[qy.name] = snap ? g.onSteps(y, qy.min, qy.step, qy.max) : y;
        else pos.y = snap ? g.onGrid(y, p.snap[1], Y0, Y1) : y;
      }
      st.pos[i] = pos;
      if (qx || qy) st.moved.params = true;
    }
    function setPoint(i, x, y) {
      const before = where(i);
      place2(i, x, y, true);
      const after = where(i);
      if (before.x === after.x && (before.y === after.y || (Number.isNaN(before.y) && Number.isNaN(after.y)))) return false;
      st.moved.pts[i] = true;
      changed();
      return true;
    }
    function setTan(x) {
      const nx = g.onGrid(x, spec.tangent.snap, X0, X1);
      if (nx === st.tx) return false;
      st.tx = nx;
      st.moved.tan = true;
      changed();
      return true;
    }
    function setPick(x) {
      const nx = g.onGrid(x, goal.snap, X0, X1);
      if (nx === st.pick) return false;
      st.pick = nx;
      changed();
      return true;
    }

    /* ---- input ---- */
    function toData(e) {
      const r = svg.getBoundingClientRect(), k = fr.W / (r.width || fr.W);
      return { x: fr.ix((e.clientX - r.left) * k), y: fr.iy((e.clientY - r.top) * k) };
    }
    function drag(target, getPos, setPos) {
      // a touch on a handle drags it instead of scrolling the page
      target.addEventListener('touchstart', (e) => { if (!st.locked) e.preventDefault(); }, { passive: false });
      target.addEventListener('pointerdown', (e) => {
        if (st.locked || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        e.stopPropagation();
        try { target.setPointerCapture(e.pointerId); } catch (err) { /* not captured: moves still arrive while over it */ }
        try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
        dragging = true;
        const p0 = toData(e), at = getPos();
        const ox = at.x - p0.x, oy = fin(at.y) ? at.y - p0.y : 0;
        const move = (ev) => { const p = toData(ev); setPos(p.x + ox, p.y + oy); };
        const up = () => {
          dragging = false;
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      });
    }
    function keyMove(e, fn) {
      if (st.locked) return;
      const n = e.shiftKey ? 5 : 1;
      const d = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, n], ArrowDown: [0, -n] }[e.key];
      if (!d) return;
      e.preventDefault();
      fn(d[0], d[1]);
    }
    function focusable(el, what) {
      el.addEventListener('focus', () => { st.focus = what; schedule(); });
      el.addEventListener('blur', () => { if (st.focus === what) st.focus = null; schedule(); });
    }

    let down = null;
    svg.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    svg.addEventListener('click', (e) => {
      if (st.locked || !fr || (e.target.closest && e.target.closest('.gph__hit'))) return;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
      const p = toData(e);
      if (pick) { if (setPick(p.x)) say('x = ' + fx(st.pick)); }
      else if (spec.tangent && setTan(p.x)) say(slopeText());
    });
    svg.addEventListener('pointermove', (e) => {
      if (dragging || !fr) return;
      const p = toData(e);
      st.hover = Math.max(X0, Math.min(X1, p.x));
      schedule();
    });
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') { st.hover = null; schedule(); } });
    if (pick) { // an "x" task: the plane itself is the control, and takes the arrow keys
      for (const [k, v] of Object.entries({ tabindex: '0', role: 'slider', 'aria-valuemin': String(X0), 'aria-valuemax': String(X1) })) svg.setAttribute(k, v);
      svg.addEventListener('keydown', (e) => {
        if (e.target !== svg) return;
        keyMove(e, (dx, dy) => { if (setPick((st.pick == null ? (X0 + X1) / 2 : st.pick) + (dx || dy) * goal.snap)) say('x = ' + fx(st.pick)); });
      });
    }

    /* ---- drawing ---- */
    function layout() {
      const W = Math.max(240, Math.round(plane.clientWidth) || 600);
      if (fr && fr.W === W) return false;
      fr = frame(spec, W, heightFor(W));
      for (const [k, v] of Object.entries({ viewBox: `0 0 ${fr.W} ${fr.H}`, width: fr.W, height: fr.H })) svg.setAttribute(k, v);
      for (const [k, v] of Object.entries({ x: fr.left, y: fr.top, width: fr.right - fr.left, height: fr.bottom - fr.top })) clipR.setAttribute(k, v);
      const parts = gridParts(spec, fr);
      Lgrid.textContent = ''; Laxes.textContent = ''; Ltick.textContent = '';
      parts.grid.forEach(([x1, y1, x2, y2]) => sv('line', { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2) }, Lgrid));
      parts.axes.forEach(([x1, y1, x2, y2]) => sv('line', { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2) }, Laxes));
      parts.arrows.forEach((d) => sv('path', { d, class: 'gph__arrow' }, Laxes));
      parts.names.forEach((n) => { sv('text', { x: r1(n.x), y: r1(n.y), 'text-anchor': n.anchor, class: 'gph__axname' }, Ltick).textContent = n.text; });
      parts.labels.forEach((n) => { sv('text', { x: r1(n.x), y: r1(n.y), 'text-anchor': n.anchor, class: 'gph__tick' }, Ltick).textContent = n.text; });
      return true;
    }
    const schedule = () => { if (!raf && !dead) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
    const place = (lab, X, Y, vis) => {
      if (!lab) return;
      lab.hidden = !vis;
      if (!vis) return;
      lab.style.left = `${r1(X)}px`;
      lab.style.top = `${r1(Y)}px`;
      lab.classList.toggle('is-left', X > fr.W - 76);
      lab.classList.toggle('is-low', Y < 28);
    };
    const inPlane = (x, y) => fin(x) && fin(y) && x >= X0 && x <= X1 && y >= Y0 && y <= Y1;
    function draw() {
      if (dead || !fr) return;
      spec.plots.forEach((p, i) => curves[i].setAttribute('d', pathOf(trace(m.curve(i, st.P), fr))));
      if (area) area.setAttribute('d', areaPath(m, spec, fr, st.P));
      spec.lines.forEach((l, i) => {
        const L = lines[i];
        if (l.x != null) {
          const x = m.val(l.x, st.P), X = r1(fr.px(x)), ok = fin(x) && x >= X0 && x <= X1;
          for (const [k, v] of Object.entries({ x1: X, x2: X, y1: fr.top, y2: fr.bottom })) L.el.setAttribute(k, ok ? v : -99);
          place(L.lab, X, fr.top + 18, ok);
        } else {
          const y = m.val(l.y, st.P), Y = r1(fr.py(y)), ok = fin(y) && y >= Y0 && y <= Y1;
          for (const [k, v] of Object.entries({ x1: fr.left, x2: fr.right, y1: Y, y2: Y })) L.el.setAttribute(k, ok ? v : -99);
          place(L.lab, fr.right - 70, Y, ok);
        }
      });
      if (tan) {
        const tl = tangentLine(m, spec, fr, st.P, st.tx);
        tanLine.style.display = tl ? '' : 'none';
        if (tl) ['x1', 'y1', 'x2', 'y2'].forEach((k, j) => tanLine.setAttribute(k, tl.d[j]));
        const y = m.y(spec.tangent.plot, st.tx, st.P), vis = inPlane(st.tx, y);
        tan.g.style.display = vis ? '' : 'none';
        if (vis) tan.g.setAttribute('transform', `translate(${r1(fr.px(st.tx))} ${r1(fr.py(y))})`);
        tan.hit.setAttribute('aria-label', F('Tangent at x = {x}', { x: fx(st.tx) }));
        tan.hit.setAttribute('aria-valuenow', String(st.tx));
        tan.hit.setAttribute('aria-valuetext', slopeText());
        tan.g.classList.toggle('is-focus', Boolean(st.focus && st.focus.kind === 'tan'));
      }
      spec.points.forEach((p, i) => {
        const at = where(i), el = pts[i], vis = inPlane(at.x, at.y);
        el.g.style.display = vis ? '' : 'none';
        if (vis) el.g.setAttribute('transform', `translate(${r1(fr.px(at.x))} ${r1(fr.py(at.y))})`);
        place(el.lab, fr.px(at.x), fr.py(at.y), vis);
        if (el.hit) {
          el.hit.setAttribute('aria-label', pointText(i));
          el.hit.setAttribute('aria-valuenow', String(at.x));
          el.hit.setAttribute('aria-valuemin', String(X0));
          el.hit.setAttribute('aria-valuemax', String(X1));
          el.hit.setAttribute('aria-valuetext', pair(at.x, at.y));
          el.g.classList.toggle('is-focus', Boolean(st.focus && st.focus.kind === 'pt' && st.focus.i === i));
        }
      });
      if (pick) {
        const on = st.pick != null;
        pick.style.display = on ? '' : 'none';
        if (on) {
          const X = r1(fr.px(st.pick));
          for (const [k, v] of Object.entries({ x1: X, x2: X, y1: fr.top, y2: fr.bottom })) pickLine.setAttribute(k, v);
          pickMark.setAttribute('d', `M${X} ${fr.bottom - 10}l-6 10h12z`);
        }
        place(pickLab, fr.px(st.pick || 0), fr.bottom - 14, on);
        if (on) pickLab.textContent = 'x = ' + fx(st.pick);
        svg.setAttribute('aria-valuetext', on ? 'x = ' + fx(st.pick) : '—');
        if (on) svg.setAttribute('aria-valuenow', String(st.pick)); else svg.removeAttribute('aria-valuenow');
      }
      const hx = st.hover;
      hover.style.display = hx == null ? 'none' : '';
      if (hx != null) {
        const X = r1(fr.px(hx));
        for (const [k, v] of Object.entries({ x1: X, x2: X, y1: fr.top, y2: fr.bottom })) hoverLine.setAttribute(k, v);
        spec.plots.forEach((p, i) => {
          const y = m.y(i, hx, st.P), ok = inPlane(hx, y);
          hoverDots[i].style.display = ok ? '' : 'none';
          if (ok) { hoverDots[i].setAttribute('cx', X); hoverDots[i].setAttribute('cy', r1(fr.py(y))); }
        });
      }
      readoutNow();
      infoNow();
      sliders.forEach(({ p, inp, val }) => {
        const v = st.P[p.name];
        val.nodeValue = pv(p, v);
        inp.setAttribute('aria-valuetext', `${p.name} = ${pv(p, v)}`);
        if (Number(inp.value) !== v && !inp.matches(':active')) inp.value = String(v);
        inp.disabled = st.locked;
      });
    }
    function readoutNow() {
      readout.textContent = '';
      const f = st.focus;
      if (f && f.kind === 'pt') { readout.appendChild(h('span', 'gph__ri', pointText(f.i))); return; }
      if (f && f.kind === 'tan') {
        readout.appendChild(h('span', 'gph__ri', `x = ${fx(st.tx)}`));
        readout.appendChild(h('span', 'gph__ri', `y = ${fx(m.y(spec.tangent.plot, st.tx, st.P))}`));
        return;
      }
      if (st.hover == null) return;
      readout.appendChild(h('span', 'gph__ri', `x = ${fx(st.hover)}`));
      spec.plots.forEach((p, i) => {
        const item = h('span', 'gph__ri'), dot = h('span', 'gph__rdot');
        dot.style.background = COL(p.color);
        item.append(dot, document.createTextNode(`y = ${fx(m.y(i, st.hover, st.P))}`));
        readout.appendChild(item);
      });
    }
    function infoNow() {
      const rows = [];
      if (spec.tangent) rows.push(slopeText());
      if (spec.area) {
        const a = m.val(spec.area.from, st.P), b = m.val(spec.area.to, st.P);
        rows.push(F('Area from {a} to {b}: {v}', { a: g.fmt(a, 3), b: g.fmt(b, 3), v: g.fmt(m.integral(spec.area.plot, a, b, st.P), 3) }));
      }
      const now = rows.join('\n');
      if (info.dataset.now === now) return;
      info.dataset.now = now;
      info.textContent = '';
      rows.forEach((s) => info.appendChild(h('div', 'gph__infoline', s)));
    }

    layout();
    draw();
    let ro = null;
    const onResize = () => { if (layout()) draw(); };
    // redrawn in the next frame, not inside the observer: the new height would set it off again
    if (window.ResizeObserver) { ro = new ResizeObserver(() => requestAnimationFrame(() => { if (!dead) onResize(); })); ro.observe(plane); } else window.addEventListener('resize', onResize);

    /* ---- the handle widgets.js keeps ---- */
    function value() {
      if (mode === 'params') {
        if (!st.moved.params) return null;
        const o = {};
        spec.params.forEach((p) => { o[p.name] = st.P[p.name]; });
        return o;
      }
      if (mode === 'point') {
        const i = goal.point;
        if (!st.moved.pts[i]) return null;
        const at = where(i);
        return { x: at.x, y: fin(at.y) ? Number(at.y.toFixed(6)) : null };
      }
      if (mode === 'x') {
        if (spec.tangent) return st.moved.tan ? { x: st.tx } : null;
        return st.pick == null ? null : { x: st.pick };
      }
      return null;
    }
    function lock(on) {
      st.locked = Boolean(on);
      root.classList.toggle('is-locked', st.locked);
      [...pts.map((p) => p.hit), tan && tan.hit].forEach((el) => { if (el) el.setAttribute('aria-disabled', String(st.locked)); });
      sliders.forEach(({ inp }) => { inp.disabled = st.locked; });
    }
    function reset() {
      st.P = m.start();
      st.pos = startPos();
      st.tx = spec.tangent ? spec.tangent.x : null;
      st.pick = null;
      st.moved = fresh();
      sliders.forEach(({ p, inp }) => { inp.value = String(p.value); });
      schedule();
    }
    function reveal() {
      lock(true);
      // of several right places, the one nearest where the learner is
      let gl = goal;
      if (goal && mode === 'point' && goal.at.length > 1) {
        const at = where(goal.point), d = ([x, y]) => Math.hypot((x - at.x) / (X1 - X0), (y - (fin(at.y) ? at.y : y)) / (Y1 - Y0));
        gl = Object.assign({}, goal, { at: goal.at.slice().sort((a, b) => d(a) - d(b)) });
      } else if (goal && mode === 'x' && goal.at.length > 1) {
        const x0 = spec.tangent ? st.tx : st.pick;
        if (x0 != null) gl = Object.assign({}, goal, { at: goal.at.slice().sort((a, b) => Math.abs(a - x0) - Math.abs(b - x0)) });
      }
      const sol = gl ? g.solve(gl, spec) : null;
      if (!sol) return;
      const fromP = Object.assign({}, st.P), i = goal.point;
      const fromAt = mode === 'point' ? where(i) : null;
      const fromX = mode === 'x' ? (spec.tangent ? st.tx : st.pick != null ? st.pick : sol.x) : null;
      const mix = (a, b, k) => (k >= 1 || !fin(a) ? b : a + (b - a) * k);
      if (mode === 'params') st.moved.params = true;
      if (mode === 'point') st.moved.pts[i] = true;
      if (mode === 'x' && spec.tangent) st.moved.tan = true;
      const apply = (k) => {
        if (dead) return;
        if (mode === 'params') spec.params.forEach((p) => { st.P[p.name] = mix(fromP[p.name], sol[p.name], k); });
        if (mode === 'point') place2(i, mix(fromAt.x, sol.x, k), mix(fromAt.y, sol.y, k), false);
        if (mode === 'x') { if (spec.tangent) st.tx = mix(fromX, sol.x, k); else st.pick = mix(fromX, sol.x, k); }
        draw();
      };
      if (ctx.reduce || P.motion && P.motion.reduce) apply(1);
      else {
        const t0 = performance.now(), dur = 650;
        const step = (now) => { const k = Math.min(1, (now - t0) / dur); apply(k < 1 ? 0.5 - Math.cos(Math.PI * k) / 2 : 1); if (k < 1 && !dead) requestAnimationFrame(step); };
        requestAnimationFrame(step);
        setTimeout(() => apply(1), dur + 120); // a hidden tab draws no frames: end up right anyway
      }
      say(impl.answer(goal, spec));
    }
    return {
      value, lock, reset, reveal,
      destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', onResize);
        host.textContent = '';
      }
    };
  }

  /* ---------- the still picture: the book, print and EPUB ---------- */
  function still(raw) {
    const g = G();
    if (!g) return '';
    let spec;
    try { spec = specOf(raw); } catch (e) { return ''; }
    const m = g.model(spec), Pm = m.start(), W = 600, H = 400, fr = frame(spec, W, H), cid = 'gphs' + (++uid);
    const out = [];
    const L = ([x1, y1, x2, y2], a) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"${a}/>`;
    const T = (n, a) => `<text x="${r1(n.x)}" y="${r1(n.y)}" text-anchor="${n.anchor}"${a}>${esc(n.text)}</text>`;
    const halo = ' paint-order="stroke" stroke="#f8f1e0" stroke-width="3" stroke-linejoin="round"';
    const aria = spec.plots.length ? spec.plots.map((p) => 'y = ' + p.expr).join('; ') : 'graph';
    out.push(`<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Cormorant Garamond', Georgia, serif" style="font-variant-numeric: lining-nums" role="img" aria-label="${esc(aria)}">`);
    out.push(`<defs><clipPath id="${cid}"><rect x="${fr.left}" y="${fr.top}" width="${fr.right - fr.left}" height="${fr.bottom - fr.top}"/></clipPath></defs>`);
    out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="4" fill="#f8f1e0" stroke="#c9b48a"/>`);
    const parts = gridParts(spec, fr);
    out.push(`<g stroke="#5b4730" stroke-opacity=".16" stroke-width="1">${parts.grid.map((l) => L(l, '')).join('')}</g>`);
    out.push(`<g stroke="#5b4730" stroke-width="1.3">${parts.axes.map((l) => L(l, '')).join('')}</g>`);
    out.push(`<g fill="#5b4730">${parts.arrows.map((d) => `<path d="${d}"/>`).join('')}</g>`);
    out.push(`<g clip-path="url(#${cid})">`);
    if (spec.area) out.push(`<path d="${areaPath(m, spec, fr, Pm)}" fill="${COL(spec.plots[spec.area.plot].color)}" fill-opacity=".2"/>`);
    spec.lines.forEach((l) => {
      const v = m.val(l.x != null ? l.x : l.y, Pm);
      if (!fin(v)) return;
      const d = l.x != null ? [fr.px(v), fr.top, fr.px(v), fr.bottom] : [fr.left, fr.py(v), fr.right, fr.py(v)];
      out.push(L(d, ` stroke="${COL(l.color)}" stroke-width="1.4" stroke-dasharray="6 5"`));
    });
    spec.plots.map((p, i) => `<path d="${pathOf(trace(m.curve(i, Pm), fr))}" fill="none" stroke="${COL(p.color)}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"${p.dashed ? ' stroke-dasharray="9 6"' : ''}/>`).reverse().forEach((s) => out.push(s));
    const tl = spec.tangent ? tangentLine(m, spec, fr, Pm, spec.tangent.x) : null;
    if (tl) out.push(L(tl.d, ` stroke="${COL('gold')}" stroke-width="2"`));
    out.push('</g>');
    out.push(`<g font-size="15" font-weight="500" fill="#5b4730"${halo}>${parts.labels.map((n) => T(n, '')).join('')}</g>`);
    out.push(`<g font-size="18" font-style="italic" fill="#5b4730">${parts.names.map((n) => T(n, '')).join('')}</g>`);
    if (tl) out.push(`<circle cx="${r1(fr.px(tl.x0))}" cy="${r1(fr.py(tl.y0))}" r="5.5" fill="${COL('gold')}" stroke="#f8f1e0" stroke-width="2"/>`);
    spec.points.forEach((p) => {
      const at = m.pointAt(p, Pm, p.drag ? { x: p.x, y: p.y } : null);
      if (!fin(at.x) || !fin(at.y)) return;
      const X = r1(fr.px(at.x)), Y = r1(fr.py(at.y));
      if (p.drag) out.push(`<circle cx="${X}" cy="${Y}" r="10" fill="none" stroke="${COL(p.color)}" stroke-width="1.5" stroke-opacity=".6"/>`);
      out.push(`<circle cx="${X}" cy="${Y}" r="${p.drag ? 6 : 5}" fill="${COL(p.color)}" stroke="#f8f1e0" stroke-width="1.6"/>`);
      if (p.label) {
        const right = X < W - 90;
        out.push(T({ x: right ? X + 10 : X - 10, y: Y - 9, anchor: right ? 'start' : 'end', text: plain(p.label) }, ` font-size="17" fill="${COL(p.color)}"${halo}`));
      }
    });
    // a key in the emptiest corner: the curves' labels, the sliders' values, the slope and the area
    const key = [];
    spec.plots.forEach((p) => { if (p.label) key.push({ text: plain(p.label), colour: COL(p.color), dashed: p.dashed }); });
    if (spec.params.length) key.push({ text: spec.params.map((p) => `${p.name} = ${pv(p, p.value)}`).join(',  ') });
    if (tl) key.push({ text: fill('Slope at x = {x}: {m}', { x: g.fmt(tl.x0, 3), m: g.fmt(tl.k, 3) }) });
    if (spec.area) {
      const a = m.val(spec.area.from, Pm), b = m.val(spec.area.to, Pm);
      key.push({ text: fill('Area from {a} to {b}: {v}', { a: g.fmt(a, 3), b: g.fmt(b, 3), v: g.fmt(m.integral(spec.area.plot, a, b, Pm), 3) }) });
    }
    if (key.length) {
      const bw = Math.min(W - 24, 24 + Math.max(...key.map((k) => k.text.length * 7.6 + (k.colour ? 30 : 0)))), bh = 12 + key.length * 21;
      const corners = [[12, 12], [W - 12 - bw, 12], [12, H - 12 - bh], [W - 12 - bw, H - 12 - bh]];
      const ys = spec.plots.map((p, i) => { const f = m.curve(i, Pm), arr = []; for (let k = 0; k <= 80; k++) { const x = fr.X0 + (fr.X1 - fr.X0) * k / 80; arr.push([fr.px(x), fr.py(f(x))]); } return arr; }).flat();
      const busy = ([cx, cy]) => ys.filter(([x, y]) => fin(y) && x >= cx && x <= cx + bw && y >= cy && y <= cy + bh).length;
      const [kx, ky] = corners.reduce((a, b) => (busy(b) < busy(a) ? b : a));
      out.push(`<g><rect x="${r1(kx)}" y="${r1(ky)}" width="${r1(bw)}" height="${bh}" rx="3" fill="#fbf7ec" fill-opacity=".92" stroke="#c9b48a"/>`);
      key.forEach((k, j) => {
        const y = ky + 22 + j * 21;
        let x = kx + 10;
        if (k.colour) { out.push(L([x, y - 5, x + 22, y - 5], ` stroke="${k.colour}" stroke-width="3"${k.dashed ? ' stroke-dasharray="6 4"' : ''}`)); x += 30; }
        out.push(T({ x, y, anchor: 'start', text: k.text }, ' font-size="16" fill="#2b1d11"'));
      });
      out.push('</g>');
    }
    out.push('</svg>');
    return out.join('');
  }

  /* ---------- checking and saying ---------- */
  const impl = {
    ready,
    block(host, spec, ctx) { return view(host, specOf(spec), null, ctx || {}); },
    task(host, spec, goal, ctx) { const s = specOf(spec); return view(host, s, goalOf(goal, s), ctx || {}); },
    check(goal, value, spec) {
      if (!G()) return { correct: false, invalid: true };
      let s, gl;
      try { s = specOf(spec); gl = goalOf(goal, s); } catch (e) { return { correct: false, invalid: true }; }
      const r = G().meets(gl, value, s);
      if (r.invalid) return { correct: false, invalid: true };
      if (!r.correct && r.miss) return { correct: false, note: fill('The curve doesn’t pass through {p}.', { p: pair(r.miss[0], r.miss[1]) }) };
      return { correct: Boolean(r.correct) };
    },
    describe(value, spec) {
      if (!G() || !value || typeof value !== 'object') return '';
      const s = specOf(spec);
      if ('x' in value && 'y' in value) return fill('the point {p}', { p: pair(value.x, value.y) });
      if ('x' in value) return 'x = ' + G().fmt(value.x, 3);
      return s.params.filter((p) => typeof value[p.name] === 'number').map((p) => `${p.name} = ${pv(p, value[p.name])}`).join(', ');
    },
    answer(goal, spec) {
      if (!G()) return '';
      const s = specOf(spec), gl = goalOf(goal, s);
      if (gl.type === 'params') {
        const named = gl.values ? Object.keys(gl.values) : [];
        const ranged = gl.range ? Object.keys(gl.range) : [];
        const byName = (k) => s.params.find((p) => p.name === k);
        const said = named.map((k) => `${k} = ${pv(byName(k), gl.values[k])}`)
          .concat(ranged.map((k) => fill('{name} between {a} and {b}', { name: k, a: pv(byName(k), gl.range[k][0]), b: pv(byName(k), gl.range[k][1]) })));
        if (!gl.through) return said.join(', ');
        const pts = gl.through.map(([x, y]) => pair(x, y)).join(', ');
        const sol = G().solve(gl, s), uses = G().model(s).uses(gl.plot);
        const eg = sol ? s.params.filter((p) => uses.has(p.name) || named.includes(p.name) || ranged.includes(p.name)).map((p) => `${p.name} = ${pv(p, sol[p.name])}`).join(', ') : '';
        return eg ? fill('{eg}, or any values that put the curve through {pts}', { eg, pts }) : fill('any values that put the curve through {pts}', { pts });
      }
      if (gl.type === 'point') return fill('the point {p}', { p: orList(gl.at.map(([x, y]) => pair(x, y))) });
      return orList(gl.at.map((x) => 'x = ' + G().fmt(x, 3)));
    },
    still(spec) { return still(spec); }
  };
  P.widgets.register('graph', impl);
})();
