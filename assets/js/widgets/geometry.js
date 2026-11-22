/* =====================================================================
   The geometry board (assets/js/widgets.js): a small GeoGebra-like board
   for lessons on geometry. The learner drags points; the segments, lines,
   circles, polygons and marked angles made from them follow, and the
   measurements (lengths, angles, areas, sums, ratios, coordinates) change
   live, on the board and in a small panel under it.

   The figure's logic is assets/js/widgets/geometry-core.js, shared with
   the server (server/widgets/geometry.mjs) and loaded first: the model of
   free and derived objects, the measurements and the goal checks, so a
   board the server lets through is read the same way here.

   Drawn as SVG at the board's own pixel size (one scale both ways, so
   angles look as they are), redrawn when it resizes; at 340 px it is as
   wide as the phone. A point is picked up from anywhere near it (a big,
   forgiving touch area); a focused point moves with the arrow keys
   (Shift: five steps), along its path if it is kept on one. Reset puts
   the figure back. As a task, check() measures the learner's figure
   against the goal and says what is still off; reveal() moves the
   points to the example solution (at once with reduced motion).
   Everything from the spec goes into the page as text, never markup.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;

  /* ---------------- the logic, shared with the server ---------------- */

  let G = window.PrimerGeometry || null;
  const ready = G ? Promise.resolve(G) : new Promise((resolve, reject) => {
    let s = document.querySelector('script[data-geometry-core]');
    if (!s) {
      s = document.createElement('script');
      s.src = '/assets/js/widgets/geometry-core.js';
      s.async = true;
      s.setAttribute('data-geometry-core', '');
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => { G = window.PrimerGeometry || null; if (G) resolve(G); else reject(new Error('the geometry board did not load')); });
    s.addEventListener('error', () => reject(new Error('the geometry board could not be loaded')));
  });
  ready.catch(() => {});
  // the loader (assets/js/widgets.js) waits for this before it counts the kind as loaded
  if (document.currentScript) document.currentScript.ready = ready;

  /* ---------------- words ---------------- */

  const T = (s) => (P.t ? P.t(s) : s);
  const F = (s, v) => T(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m));
  function andList(items) {
    try { return new Intl.ListFormat(P.lang || 'en', { type: 'conjunction' }).format(items); } catch (e) { return items.join(', '); }
  }
  const fin = Number.isFinite;
  const fmt = (v, d) => G.fmt(v, d == null ? 2 : d);
  const pair = (x, y) => `(${fmt(x)}, ${fmt(y)})`;
  // the words in measurements ("area ABC"), in the learner's language
  const wordsFor = (fill) => ({
    area: (p) => fill('area {p}', { p }),
    perimeter: (p) => fill('perimeter {p}', { p }),
    radius: (c) => fill('radius {c}', { c }),
    diameter: (c) => fill('diameter {c}', { c }),
    circumference: (c) => fill('circumference {c}', { c }),
    num: (v) => fmt(v, 3)
  });

  /* ---------------- drawing: a tiny tree of SVG nodes, made into markup (the book) or DOM (the page) ---------------- */

  const SVGNS = 'http://www.w3.org/2000/svg';
  const PAPER = '#f6eedb', GRID = 'rgba(91,71,48,.15)', AXIS = '#5b4730', SOFT = '#5b4730';
  const COL = (name, dflt) => (G.PALETTE[name] || G.PALETTE[dflt] || '#2b1d11');
  const DRAG = '#9a3324', GOLD = '#8a6128';
  let uid = 0;
  const el = (tag, attrs, kids) => ({ tag, attrs: attrs || {}, kids: kids || [] });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  const r1 = (v) => Math.round(v * 10) / 10;

  // the board's pixel frame for a width: one scale both ways
  function frame(M, W) {
    const v = M.view, pad = 18;
    const k = (W - 2 * pad) / (v.x1 - v.x0);
    const H = Math.round((v.y1 - v.y0) * k + 2 * pad);
    return {
      W, H, k, pad,
      px: (x) => pad + (x - v.x0) * k, py: (y) => pad + (v.y1 - y) * k,
      ix: (X) => v.x0 + (X - pad) / k, iy: (Y) => v.y1 - (Y - pad) / k
    };
  }
  // the width to draw at: the space there is, but not so wide that the board is too tall to see whole
  const widthFor = (M, avail) => {
    const v = M.view, a = (v.y1 - v.y0) / (v.x1 - v.x0);
    return Math.max(240, Math.round(Math.min(avail, 640, 470 / a + 36)));
  };

  // a line, ray or segment's visible part, in data units (t from .. to), clipped to the view and a margin
  function visible(l, M, margin) {
    const v = M.view;
    let lo = l.lo, hi = l.hi;
    const clip = (p, d, a, b) => {
      if (Math.abs(d) < 1e-12) return p >= a && p <= b;
      let t1 = (a - p) / d, t2 = (b - p) / d;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      lo = Math.max(lo, t1); hi = Math.min(hi, t2);
      return true;
    };
    if (!clip(l.x, l.dx, v.x0 - margin, v.x1 + margin) || !clip(l.y, l.dy, v.y0 - margin, v.y1 + margin) || lo > hi) return null;
    return [lo, hi];
  }

  // which way to put a point's name: away from the lines that meet there
  function labelDir(M, V, fr, id) {
    const n = M.nodes[id], at = V[id];
    let sx = 0, sy = 0;
    const toward = (q) => { if (!q) return; const dx = fr.px(q.x) - fr.px(at.x), dy = fr.py(q.y) - fr.py(at.y), d = Math.hypot(dx, dy); if (d > 1) { sx += dx / d; sy += dy / d; } };
    M.nodes.forEach((m) => {
      if (!m.draw) return;
      const ids = (m.of || []).map((p) => M.names.get(p));
      const k = ids.indexOf(id);
      if (k >= 0) {
        if (m.kind === 'poly') { toward(V[ids[(k + 1) % ids.length]]); toward(V[ids[(k + ids.length - 1) % ids.length]]); }
        else ids.forEach((j) => { if (j !== id) toward(V[j]); });
      }
      if (m.kind === 'circle' && V[m.id] && Math.abs(Math.hypot(at.x - V[m.id].x, at.y - V[m.id].y) - V[m.id].r) < 1e-6) toward(V[m.id]);
      if (m.op === 'angle' && M.names.get(m.at) === id) { toward(V[M.names.get(m.from)]); toward(V[M.names.get(m.to)]); }
      if ((m.op === 'perp' || m.op === 'par') && M.names.get(m.through) === id && V[m.id]) { const l = V[m.id]; toward({ x: at.x + l.dx, y: at.y + l.dy }); toward({ x: at.x - l.dx, y: at.y - l.dy }); }
    });
    if (n.op === 'glider') { const o = n.ref.get(V); if (o && o.r != null) toward(o); }
    let d = Math.hypot(sx, sy);
    if (d < 0.3) { sx = -0.6; sy = 0.8; d = 1; } // nothing around it: above and to the right
    return { x: -sx / d, y: -sy / d };
  }

  // The whole figure as a tree: grid and axes, shapes, lines, circles, marked angles, measurements on the
  // board, then the points and their names. o: { drag: Set, focus, still, words, unit }
  function scene(M, V, fr, o) {
    const v = M.view, out = [], top = [];
    const taken = []; // the boxes words already use: the axes' numbers, then sizes and notes, then names
    const cid = 'geoclip' + (++uid);
    out.push(el('defs', {}, [el('clipPath', { id: cid }, [el('rect', { x: fr.pad - 6, y: fr.pad - 6, width: fr.W - 2 * fr.pad + 12, height: fr.H - 2 * fr.pad + 12 })])]));
    // the squared paper and the axes
    if (M.grid) {
      const g = [];
      const step = M.grid, mk = Math.max(1, Math.ceil(14 / (step * fr.k))); // never closer than 14 px
      for (let i = Math.ceil(v.x0 / step - 1e-9); i * step <= v.x1 + 1e-9; i++) if (i % mk === 0) { const X = r1(fr.px(i * step)); g.push(el('line', { x1: X, y1: r1(fr.py(v.y0)), x2: X, y2: r1(fr.py(v.y1)) })); }
      for (let i = Math.ceil(v.y0 / step - 1e-9); i * step <= v.y1 + 1e-9; i++) if (i % mk === 0) { const Y = r1(fr.py(i * step)); g.push(el('line', { x1: r1(fr.px(v.x0)), y1: Y, x2: r1(fr.px(v.x1)), y2: Y })); }
      out.push(el('g', { class: 'geo-grid', stroke: GRID, 'stroke-width': 1 }, g));
    }
    if (M.axes) {
      const g = [], labs = [];
      const step = M.grid || G.niceStep((v.x1 - v.x0) / 10), every = Math.max(1, Math.ceil(30 / (step * fr.k)));
      const onX = v.y0 <= 0 && v.y1 >= 0, onY = v.x0 <= 0 && v.x1 >= 0;
      const ax = onX ? fr.py(0) : fr.py(v.y0), ay = onY ? fr.px(0) : fr.px(v.x0);
      g.push(el('line', { x1: r1(fr.px(v.x0)), y1: r1(ax), x2: r1(fr.px(v.x1) + 8), y2: r1(ax) }), el('line', { x1: r1(ay), y1: r1(fr.py(v.y0)), x2: r1(ay), y2: r1(fr.py(v.y1) - 8) }));
      g.push(el('path', { d: `M${r1(fr.px(v.x1) + 12)} ${r1(ax)}l-8 -3.5v7z`, fill: AXIS, stroke: 'none' }), el('path', { d: `M${r1(ay)} ${r1(fr.py(v.y1) - 12)}l-3.5 8h7z`, fill: AXIS, stroke: 'none' }));
      for (let i = Math.ceil(v.x0 / step - 1e-9); i * step <= v.x1 + 1e-9; i++) {
        if (i === 0 && onY) continue;
        if (i % every) continue;
        labs.push(el('text', { x: r1(fr.px(i * step)), y: r1(ax + 15), 'text-anchor': 'middle' }, [fmt(i * step)]));
      }
      for (let i = Math.ceil(v.y0 / step - 1e-9); i * step <= v.y1 + 1e-9; i++) {
        if (i === 0 && onX) continue;
        if (i % every) continue;
        labs.push(el('text', { x: r1(ay - 6), y: r1(fr.py(i * step) + 5), 'text-anchor': 'end' }, [fmt(i * step)]));
      }
      if (onX && onY) labs.push(el('text', { x: r1(ay - 6), y: r1(ax + 15), 'text-anchor': 'end' }, ['0']));
      out.push(el('g', { class: 'geo-axes', stroke: AXIS, 'stroke-width': 1.3 }, g));
      labs.forEach((n) => { const w = 7.5 * String(n.kids[0]).length + 2, x = n.attrs.x; taken.push({ x: n.attrs['text-anchor'] === 'end' ? x - w : x - w / 2, y: n.attrs.y - 12, w, h: 14 }); });
      out.push(el('g', { class: 'geo-ticks', fill: SOFT, 'font-size': 13, stroke: PAPER, 'stroke-width': 3, 'paint-order': 'stroke' }, labs));
    }
    const shapes = [], lines = [], marks = [], notes = [];
    // the points that are drawn, where they are, and how much room their dots take
    const shown = M.nodes.filter((n) => n.kind === 'pt' && !(n.style && n.style.hidden) && n.name && !n.name.startsWith('~') && V[n.id] && M.inView(V[n.id]));
    const spots = shown.map((n) => ({ id: n.id, X: r1(fr.px(V[n.id].x)), Y: r1(fr.py(V[n.id].y)), r: o.drag.has(n.name) ? 12 : 5 }));
    const dotBox = (s) => ({ x: s.X - s.r, y: s.Y - s.r, w: 2 * s.r, h: 2 * s.r });
    const overlap = (b, q) => b.x < q.x + q.w && b.x + b.w > q.x && b.y < q.y + q.h && b.y + b.h > q.y;
    const outside = (b) => b.x < 2 || b.y < 2 || b.x + b.w > fr.W - 2 || b.y + b.h > fr.H - 2; // words cut off at the board's edge
    const hits = (b, also) => outside(b) || taken.some((q) => overlap(b, q)) || (also || spots.map(dotBox)).some((q) => overlap(b, q));
    const pt = (p) => `${r1(fr.px(p.x))},${r1(fr.py(p.y))}`;
    const at = (name) => V[M.names.get(name)];
    // polygons: a light wash of their colour, an outline
    M.nodes.forEach((n) => {
      if (!n.draw || V[n.id] == null) return;
      const st = n.style || {}, c = COL(st.color, 'ink');
      if (n.kind === 'poly') {
        shapes.push(el('polygon', { points: V[n.id].pts.map(pt).join(' '), fill: c, 'fill-opacity': 0.08, stroke: c, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-dasharray': st.dashed ? '7 5' : null }));
        if (st.label) { const q = V[n.id].pts, cx = q.reduce((s, p) => s + p.x, 0) / q.length, cy = q.reduce((s, p) => s + p.y, 0) / q.length; notes.push(note(fr.px(cx), fr.py(cy), st.label, c, 'middle')); }
      } else if (n.kind === 'circle') {
        const ci = V[n.id];
        shapes.push(el('circle', { cx: r1(fr.px(ci.x)), cy: r1(fr.py(ci.y)), r: r1(ci.r * fr.k), fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-dasharray': st.dashed ? '7 5' : null }));
        if (st.label) notes.push(note(fr.px(ci.x + ci.r * 0.72) + 6, fr.py(ci.y + ci.r * 0.72) - 6, st.label, c, 'start'));
      } else if (n.kind === 'line') {
        const l = V[n.id], seg = n.op === 'segment';
        const iv = seg ? [0, 1] : visible(l, M, 12 / fr.k);
        if (!iv) return;
        const a = G.geo.along(l, iv[0]), b = G.geo.along(l, iv[1]);
        const made = n.made || !['segment', 'ray', 'line'].includes(n.op); // constructions are blue
        const col = COL(st.color, made ? 'blue' : 'ink');
        lines.push(el('line', { x1: r1(fr.px(a.x)), y1: r1(fr.py(a.y)), x2: r1(fr.px(b.x)), y2: r1(fr.py(b.y)), stroke: col, 'stroke-width': seg ? 2.2 : 1.7, 'stroke-linecap': 'round', 'stroke-dasharray': st.dashed ? '7 5' : null }));
        if (st.length && seg) {
          const len = Math.hypot(l.dx, l.dy), m = { x: l.x + l.dx / 2, y: l.y + l.dy / 2 };
          const s = side(n, l, m);
          notes.push(note(fr.px(m.x) + s.x * 14, fr.py(m.y) + s.y * 14 + 5, fmt(len) + (M.unit ? ' ' + M.unit : ''), col, 'middle', 'geo-len'));
        }
        if (st.label) {
          const q = seg ? { x: l.x + l.dx * 0.5, y: l.y + l.dy * 0.5 } : G.geo.along(l, iv[0] + (iv[1] - iv[0]) * 0.82);
          const s = side(n, l, q);
          notes.push(note(fr.px(q.x) + s.x * 16, fr.py(q.y) + s.y * 16 + 5, st.label, col, 'middle'));
        }
      }
    });
    // which side of a segment its words go: away from the polygon it bounds, else above it
    function side(n, l, m) {
      let nx = -l.dy, ny = -l.dx; // screen normal (y flipped)
      const d = Math.hypot(nx, ny) || 1;
      nx /= d; ny /= d;
      const poly = n.of && M.nodes.find((q) => q.kind === 'poly' && q.draw && n.of.every((p) => q.of.includes(p)) && V[q.id]);
      if (poly) {
        const pts = V[poly.id].pts, cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const tx = fr.px(cx) - fr.px(m.x), ty = fr.py(cy) - fr.py(m.y);
        if (tx * nx + ty * ny > 0) { nx = -nx; ny = -ny; }
      } else if (ny > 0) { nx = -nx; ny = -ny; }
      return { x: nx, y: ny };
    }
    // marked angles: an arc (a square for a right angle) and the size
    const perVertex = {};
    M.nodes.forEach((n) => {
      if (n.op !== 'angle' || V[n.id] == null) return;
      const a = V[n.id], st = n.style || {}, c = COL(st.color, 'gold');
      const vx = fr.px(a.v.x), vy = fr.py(a.v.y);
      const u1 = unit(fr.px(a.a.x) - vx, fr.py(a.a.y) - vy), u2 = unit(fr.px(a.b.x) - vx, fr.py(a.b.y) - vy);
      const near = Math.min(Math.hypot(fr.px(a.a.x) - vx, fr.py(a.a.y) - vy), Math.hypot(fr.px(a.b.x) - vx, fr.py(a.b.y) - vy));
      const k = perVertex[n.at] = (perVertex[n.at] || 0) + 1;
      const R = Math.max(11, Math.min(24, near * 0.32)) + (k - 1) * 7;
      const shown = fmt(a.deg, 1);
      let bx = u1.x + u2.x, by = u1.y + u2.y;
      const bl = Math.hypot(bx, by);
      if (bl < 1e-6) { bx = -u1.y; by = u1.x; } else { bx /= bl; by /= bl; }
      if (shown === '90') {
        const s = Math.min(R, 15) * 0.8;
        marks.push(el('path', { d: `M${r1(vx + s * u1.x)} ${r1(vy + s * u1.y)}L${r1(vx + s * (u1.x + u2.x))} ${r1(vy + s * (u1.y + u2.y))}L${r1(vx + s * u2.x)} ${r1(vy + s * u2.y)}`, fill: 'none', stroke: c, 'stroke-width': 1.8 }));
        marks.push(el('path', { d: `M${r1(vx)} ${r1(vy)}L${r1(vx + s * u1.x)} ${r1(vy + s * u1.y)}L${r1(vx + s * (u1.x + u2.x))} ${r1(vy + s * (u1.y + u2.y))}L${r1(vx + s * u2.x)} ${r1(vy + s * u2.y)}Z`, fill: c, 'fill-opacity': 0.14, stroke: 'none' }));
      } else {
        const sx = vx + R * u1.x, sy = vy + R * u1.y, ex = vx + R * u2.x, ey = vy + R * u2.y;
        const sweep = u1.x * u2.y - u1.y * u2.x > 0 ? 1 : 0, big = a.deg > 180 ? 1 : 0;
        marks.push(el('path', { d: `M${r1(vx)} ${r1(vy)}L${r1(sx)} ${r1(sy)}A${r1(R)} ${r1(R)} 0 ${big} ${sweep} ${r1(ex)} ${r1(ey)}Z`, fill: c, 'fill-opacity': 0.14, stroke: 'none' }));
        marks.push(el('path', { d: `M${r1(sx)} ${r1(sy)}A${r1(R)} ${r1(R)} 0 ${big} ${sweep} ${r1(ex)} ${r1(ey)}`, fill: 'none', stroke: c, 'stroke-width': 1.8 }));
      }
      if (st.value !== false) {
        // along the bisector, further out if something is already there (either side of a straight angle)
        const off = R + 15 + (a.deg < 35 ? 10 : 0), text = shown + '°';
        const tries = [[1, 0], [1, 13], [1, 26]].concat(a.deg > 170 ? [[-1, 0], [-1, 13]] : []);
        const at = tries.map(([sg, more]) => [vx + sg * bx * (off + more), vy + sg * by * (off + more) + 5]);
        const free = at.find(([x, y]) => !hits(boxOf(x, y, text, 'middle'))) || at[0];
        notes.push(note(free[0], free[1], text, c, 'middle', 'geo-deg'));
      }
    });
    function unit(x, y) { const d = Math.hypot(x, y) || 1; return { x: x / d, y: y / d }; }
    function boxOf(x, y, text, anchor) {
      const w = 8.5 * String(text).length + 4;
      return { x: anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2, y: y - 14, w, h: 17 };
    }
    function note(x, y, text, colour, anchor, cls) {
      taken.push(boxOf(x, y, text, anchor));
      return el('text', { x: r1(x), y: r1(y), 'text-anchor': anchor || 'middle', fill: colour, class: cls || 'geo-note' }, [text]);
    }
    out.push(el('g', { 'clip-path': `url(#${cid})` }, [el('g', { class: 'geo-shapes' }, shapes), el('g', { class: 'geo-lines' }, lines), el('g', { class: 'geo-marks' }, marks)]));
    // the points, and their names: each name where it reads best, moved round its point if another name, a
    // number on the board or a dot is already there
    const dots = [], names = [];
    shown.forEach((n, i) => {
      const { X, Y } = spots[i];
      const drag = o.drag.has(n.name), c = COL(n.style && n.style.color, drag ? 'red' : 'ink');
      if (drag) {
        if (o.focus === n.name) dots.push(el('circle', { cx: X, cy: Y, r: 16, fill: 'none', stroke: GOLD, 'stroke-width': 2, 'stroke-dasharray': '3 3', class: 'geo-focus' }));
        dots.push(el('circle', { cx: X, cy: Y, r: 11, fill: c, 'fill-opacity': 0.12, stroke: c, 'stroke-opacity': 0.55, 'stroke-width': 1.5 }));
        dots.push(el('circle', { cx: X, cy: Y, r: 6, fill: c, stroke: PAPER, 'stroke-width': 1.6 }));
      } else if (n.base) dots.push(el('circle', { cx: X, cy: Y, r: 4.5, fill: c, stroke: PAPER, 'stroke-width': 1.4 }));
      else dots.push(el('circle', { cx: X, cy: Y, r: 4, fill: PAPER, stroke: c, 'stroke-width': 2 }));
      const d = labelDir(M, V, fr, n.id), off = drag ? 19 : 13, w = 11 * n.name.length + 2;
      const others = spots.filter((s) => s.id !== n.id).map(dotBox);
      const base = Math.atan2(d.y, d.x);
      let best = null;
      for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
        const a = base + k * Math.PI / 4, dx = Math.cos(a), dy = Math.sin(a);
        const x = X + dx * off, y = Y + dy * off + 6, anchor = dx > 0.35 ? 'start' : dx < -0.35 ? 'end' : 'middle';
        const box = { x: anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2, y: y - 15, w, h: 18 };
        const cand = { x, y, anchor, box };
        if (!best) best = cand;
        if (!hits(box, others)) { best = cand; break; }
      }
      taken.push(best.box);
      names.push(el('text', { x: r1(best.x), y: r1(best.y), 'text-anchor': best.anchor, fill: c, class: 'geo-name' }, [n.name]));
    });
    top.push(el('g', { class: 'geo-notes', stroke: PAPER, 'stroke-width': 3.5, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, notes));
    top.push(el('g', { class: 'geo-dots' }, dots));
    top.push(el('g', { class: 'geo-names', stroke: PAPER, 'stroke-width': 3.5, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, names));
    return out.concat(top);
  }

  /* ---------------- specs and goals, checked again here (they are untrusted data) ---------------- */

  const specs = new WeakMap();
  function specOf(raw) {
    if (raw && typeof raw === 'object' && specs.has(raw)) return specs.get(raw);
    const s = G.cleanSpec(raw);
    if (raw && typeof raw === 'object') specs.set(raw, s);
    return s;
  }
  // a measurement's row: "∠ACB = 71.6°", "A = (2, 3)"
  function measureText(m, V, M, W) {
    const v = m.f(V);
    if (m.coords) return `${m.text} = ${v ? pair(v[0], v[1]) : '—'}`;
    return `${m.show(W)} = ${G.showValue(v, m.dim, M.unit)}`;
  }

  /* ---------------- the live board ---------------- */

  function view(host, raw, goalRaw, ctx) {
    const spec = specOf(raw), M = G.model(spec);
    const t = ctx.t || T, fill = ctx.fill || F;
    const W = wordsFor(fill);
    const goal = goalRaw || null;
    const drag = new Set(M.drag);
    const st = { S: M.init(), moved: false, locked: false, focus: null, grab: null };
    const id = 'geo' + (++uid);
    let fr = null, raf = 0, dead = false;

    host.textContent = '';
    const root = document.createElement('div');
    root.className = 'geo' + (goal ? ' geo--task' : '');
    const board = document.createElement('div');
    board.className = 'geo__board';
    board.dir = 'ltr';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'geo__svg');
    svg.setAttribute('role', 'group');
    const sceneG = document.createElementNS(SVGNS, 'g');
    const handlesG = document.createElementNS(SVGNS, 'g');
    handlesG.setAttribute('class', 'geo__handles');
    svg.append(sceneG, handlesG);
    board.appendChild(svg);
    root.appendChild(board);
    const keys = document.createElement('p');
    keys.className = 'geo__sr';
    keys.id = id + '-keys';
    keys.textContent = t('Tab to a point, then move it with the arrow keys (Shift moves it further).');
    root.appendChild(keys);
    svg.setAttribute('aria-describedby', keys.id);

    // the panel of measurements
    const panel = document.createElement('div');
    panel.className = 'geo__panel';
    panel.dir = 'ltr';
    const rows = M.measures.map((m) => {
      const row = document.createElement('div');
      row.className = 'geo__m';
      if (m.label) { const lab = document.createElement('span'); lab.className = 'geo__mlabel'; lab.dir = 'auto'; lab.textContent = m.label; row.appendChild(lab); }
      const val = document.createElement('span');
      val.className = 'geo__mval';
      row.appendChild(val);
      panel.appendChild(row);
      return val;
    });
    if (rows.length) root.appendChild(panel);

    // the bar: what to do, and Reset
    const bar = document.createElement('div');
    bar.className = 'geo__bar';
    const hint = document.createElement('p');
    hint.className = 'geo__hint';
    const who = andList(M.drag);
    hint.textContent = !M.drag.length ? '' : goal ? fill('Drag {names}, then press Check.', { names: who }) : fill('Drag {names} and watch what changes.', { names: who });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'geo__reset';
    reset.textContent = t('Reset');
    bar.append(hint, reset);
    root.appendChild(bar);
    const live = document.createElement('div');
    live.className = 'geo__sr';
    live.setAttribute('aria-live', 'polite');
    root.appendChild(live);
    host.appendChild(root);

    // one invisible, focusable handle per draggable point (the screen reader's and keyboard's way in)
    const handles = {};
    M.drag.forEach((name) => {
      const h = document.createElementNS(SVGNS, 'circle');
      h.setAttribute('class', 'geo__hit');
      h.setAttribute('r', '20');
      h.setAttribute('tabindex', '0');
      h.setAttribute('role', 'slider');
      h.setAttribute('aria-roledescription', t('draggable point'));
      h.addEventListener('focus', () => { st.focus = name; schedule(); });
      h.addEventListener('blur', () => { if (st.focus === name) st.focus = null; schedule(); });
      h.addEventListener('keydown', (e) => keyMove(e, name));
      handlesG.appendChild(h);
      handles[name] = h;
    });

    /* ---- the state ---- */
    const where = (name, V) => M.point(V || M.compute(st.S), name);
    const say = (s) => { live.textContent = ''; live.textContent = s; };
    const first = () => (M.measures.length ? measureText(M.measures[0], M.compute(st.S), M, W) : '');
    const pointSays = (name) => { const p = where(name); return p ? `${name} ${pair(p.x, p.y)}${first() ? '. ' + first() : ''}` : name; };
    function value() { return st.moved ? M.positions(st.S) : null; }
    function changed() {
      schedule();
      if (goal && ctx.onChange) { try { ctx.onChange(value()); } catch (e) { /* the page's business */ } }
    }
    function moveTo(name, x, y, snap) {
      const before = where(name);
      const S = M.place(st.S, name, x, y, snap);
      const after = M.point(M.compute(S), name);
      if (!after || (before && Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9)) return false;
      st.S = S;
      st.moved = true;
      changed();
      return true;
    }

    /* ---- the keyboard ---- */
    const stepOf = () => M.snap || G.niceStep(M.span / 40);
    function keyMove(e, name) {
      if (st.locked) return;
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (!k) return;
      e.preventDefault();
      const n = M.nodes[M.names.get(name)], V = M.compute(st.S), p = M.point(V, name), times = e.shiftKey ? 5 : 1;
      if (!p) return;
      let moved;
      if (n.op === 'glider') {
        // along its path: right and up go one way, left and down the other
        const o = n.ref.get(V), sgn = k[0] + k[1];
        if (o && o.r != null) {
          const th = Math.atan2(p.y - o.y, p.x - o.x) + sgn * times * 3 * Math.PI / 180;
          moved = moveTo(name, o.x + o.r * Math.cos(th), o.y + o.r * Math.sin(th), true);
        } else if (o) {
          let dx = o.dx, dy = o.dy;
          const d = Math.hypot(dx, dy);
          dx /= d; dy /= d;
          if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
          moved = moveTo(name, p.x + sgn * times * stepOf() * dx, p.y + sgn * times * stepOf() * dy, true);
        }
      } else moved = moveTo(name, p.x + k[0] * times * stepOf(), p.y + k[1] * times * stepOf(), true);
      if (moved) say(pointSays(name));
    }

    /* ---- the pointer: a point is picked up from anywhere near it ---- */
    const toData = (cx, cy) => {
      const r = svg.getBoundingClientRect(), s = fr.W / (r.width || fr.W);
      return { X: (cx - r.left) * s, Y: (cy - r.top) * s };
    };
    function nearest(cx, cy, reach) {
      if (!fr) return null;
      const q = toData(cx, cy), V = M.compute(st.S);
      let best = null, bd = reach;
      M.drag.forEach((name) => {
        const p = M.point(V, name);
        if (!p) return;
        const d = Math.hypot(fr.px(p.x) - q.X, fr.py(p.y) - q.Y);
        if (d < bd) { bd = d; best = name; }
      });
      return best;
    }
    svg.addEventListener('touchstart', (e) => {
      if (st.locked || !e.touches[0]) return;
      if (nearest(e.touches[0].clientX, e.touches[0].clientY, 30)) e.preventDefault(); // dragging a point, not scrolling the page
    }, { passive: false });
    svg.addEventListener('pointerdown', (e) => {
      if (st.locked || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const name = nearest(e.clientX, e.clientY, e.pointerType === 'mouse' ? 20 : 30);
      if (!name) return;
      e.preventDefault();
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* moves still arrive while over it */ }
      try { handles[name].focus({ preventScroll: true }); } catch (err) { handles[name].focus(); }
      const p = where(name), q = toData(e.clientX, e.clientY);
      st.grab = { name, ox: fr.px(p.x) - q.X, oy: fr.py(p.y) - q.Y, id: e.pointerId };
      root.classList.add('is-dragging');
    });
    svg.addEventListener('pointermove', (e) => {
      const g = st.grab;
      if (!g || e.pointerId !== g.id || st.locked) return;
      const q = toData(e.clientX, e.clientY);
      moveTo(g.name, fr.ix(q.X + g.ox), fr.iy(q.Y + g.oy), true);
    });
    const drop = (e) => {
      const g = st.grab;
      if (!g || (e && e.pointerId !== g.id)) return;
      st.grab = null;
      root.classList.remove('is-dragging');
      say(pointSays(g.name));
    };
    svg.addEventListener('pointerup', drop);
    svg.addEventListener('pointercancel', drop);
    svg.addEventListener('lostpointercapture', drop);

    reset.addEventListener('click', () => {
      if (st.locked) return;
      st.S = M.init();
      st.moved = false;
      changed();
      say(t('The figure is back as it started.'));
    });

    /* ---- drawing ---- */
    function layout() {
      const avail = Math.round(board.clientWidth) || 600;
      const w = widthFor(M, avail);
      if (fr && fr.W === w) return false;
      fr = frame(M, w);
      svg.setAttribute('viewBox', `0 0 ${fr.W} ${fr.H}`);
      svg.setAttribute('width', String(fr.W));
      svg.setAttribute('height', String(fr.H));
      return true;
    }
    const schedule = () => { if (!raf && !dead) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
    function draw() {
      if (dead || !fr) return;
      const V = M.compute(st.S);
      sceneG.textContent = '';
      scene(M, V, fr, { drag, focus: st.focus }).forEach((n) => sceneG.appendChild(toDom(n)));
      M.drag.forEach((name) => {
        const h = handles[name], p = M.point(V, name);
        if (!p) { h.setAttribute('cx', '-99'); h.setAttribute('cy', '-99'); return; }
        h.setAttribute('cx', String(r1(fr.px(p.x))));
        h.setAttribute('cy', String(r1(fr.py(p.y))));
        h.setAttribute('aria-label', fill('Point {name}', { name }));
        h.setAttribute('aria-valuetext', pair(p.x, p.y));
        h.setAttribute('aria-valuenow', String(r1(p.x)));
        h.setAttribute('aria-disabled', String(st.locked));
      });
      M.measures.forEach((m, i) => { rows[i].textContent = measureText(m, V, M, W); });
      svg.setAttribute('aria-label', describeBoard(M, V, fill, t, W));
      reset.disabled = st.locked;
    }

    layout();
    draw();
    let ro = null;
    const onResize = () => { if (layout()) draw(); };
    // redrawn in the next frame, not inside the observer: the new size would set it off again
    if (window.ResizeObserver) { ro = new ResizeObserver(() => requestAnimationFrame(() => { if (!dead) onResize(); })); ro.observe(board); } else window.addEventListener('resize', onResize);

    /* ---- the handle widgets.js keeps ---- */
    function lock(on) {
      st.locked = Boolean(on);
      if (st.locked) st.grab = null;
      root.classList.toggle('is-locked', st.locked);
      schedule();
    }
    function resetAll() { st.S = M.init(); st.moved = false; st.grab = null; schedule(); }
    function reveal() {
      lock(true);
      if (!goal || !goal.solution) return;
      const target = goal.solution, V0 = M.compute(st.S);
      const from = {};
      Object.keys(target).forEach((p) => { const q = M.point(V0, p); if (q) from[p] = q; });
      st.moved = true;
      const finish = () => { if (dead) return; st.S = M.fromPositions(target, false); draw(); };
      const apply = (k) => {
        if (dead) return;
        let S = st.S;
        Object.keys(from).forEach((p) => { const a = from[p], b = target[p]; S = M.place(S, p, a.x + (b[0] - a.x) * k, a.y + (b[1] - a.y) * k, false); });
        st.S = S;
        draw();
      };
      if (ctx.reduce || (P.motion && P.motion.reduce)) finish();
      else {
        const t0 = performance.now(), dur = 700;
        const stepF = (now) => { const k = Math.min(1, (now - t0) / dur); if (k < 1) { apply(0.5 - Math.cos(Math.PI * k) / 2); requestAnimationFrame(stepF); } else finish(); };
        requestAnimationFrame(stepF);
        setTimeout(finish, dur + 150); // a hidden tab draws no frames: end up right anyway
      }
      say(impl.answer(goalRaw, raw));
    }
    return {
      value, lock, reset: resetAll, reveal,
      destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', onResize);
        host.textContent = '';
      }
    };
  }

  // the board in words, for a screen reader: what is drawn, and the measurements
  function describeBoard(M, V, fill, t, W) {
    const parts = [];
    M.nodes.forEach((n) => {
      if (!n.draw || V[n.id] == null) return;
      if (n.kind === 'poly') parts.push(fill('polygon {p}', { p: n.of.join('') }));
      else if (n.kind === 'circle') parts.push(n.name ? fill('circle {c}', { c: n.name }) : n.center ? fill('circle with centre {c}', { c: n.center }) : t('a circle'));
      else if (n.op === 'segment') parts.push(fill('segment {p}', { p: n.of.join('') }));
      else if (n.op === 'angle') parts.push(`∠${n.from}${n.at}${n.to} = ${fmt(V[n.id].deg, 1)}°`);
    });
    const ms = M.measures.map((m) => measureText(m, V, M, W));
    const pts = M.nodes.filter((n) => n.kind === 'pt' && n.name && !n.name.startsWith('~') && !(n.style && n.style.hidden) && V[n.id]).map((n) => `${n.name} ${pair(V[n.id].x, V[n.id].y)}`);
    return fill('Geometry board: {what}. Points: {pts}.', { what: parts.join(', ') || t('points'), pts: pts.join(', ') }) + (ms.length ? ' ' + ms.join('; ') + '.' : '');
  }

  /* ---------------- the still picture: the book, print and EPUB ---------------- */

  function still(raw) {
    if (!G) return '';
    let spec, M;
    try { spec = specOf(raw); M = G.model(spec); } catch (e) { return ''; }
    const V = M.compute(M.init()), fr = frame(M, widthFor(M, 600));
    const W = wordsFor(F);
    const lines = M.measures.map((m) => (m.label ? m.label + ': ' : '') + measureText(m, V, M, W));
    const extra = lines.length ? 14 + lines.length * 24 : 0;
    const H = fr.H + extra;
    const out = [`<svg xmlns="${SVGNS}" viewBox="0 0 ${fr.W} ${H}" width="${fr.W}" height="${H}" font-family="'Cormorant Garamond', Georgia, serif" style="font-variant-numeric: lining-nums" role="img" aria-label="${esc(describeBoard(M, V, F, T, W))}">`];
    out.push(`<rect x="0.5" y="0.5" width="${fr.W - 1}" height="${H - 1}" rx="4" fill="#f8f1e0" stroke="#c9b48a"/>`);
    // the still's text sizes are attributes (no stylesheet in the book)
    const tree = scene(M, V, fr, { drag: new Set(M.drag), focus: null, still: true });
    const sized = (n) => {
      if (!n || typeof n === 'string') return n;
      const cls = n.attrs.class || '';
      if (n.tag === 'text' || /geo-(names|notes|ticks)/.test(cls)) {
        if (/geo-name/.test(cls)) Object.assign(n.attrs, { 'font-size': 19, 'font-style': 'italic', 'font-weight': 600 });
        else if (/geo-deg|geo-len|geo-note/.test(cls)) Object.assign(n.attrs, { 'font-size': 15, 'font-weight': 600 });
      }
      n.kids.forEach(sized);
      return n;
    };
    tree.forEach((n) => out.push(toStr(sized(n))));
    lines.forEach((s, i) => out.push(`<text x="${fr.pad}" y="${fr.H + 20 + i * 24}" font-size="17" fill="#2b1d11">${esc(s)}</text>`));
    out.push('</svg>');
    return out.join('');
  }

  /* ---------------- checking and saying ---------------- */

  const refName = (r) => (r.axis === 'x' ? T('the x-axis') : r.axis === 'y' ? T('the y-axis') : r.text);
  const sidesOf = (pts, v) => pts.map((p, i) => `${p}${pts[(i + 1) % pts.length]} = ${fmt(v[i])}`).join(', ');
  const anglesOf = (pts, v) => pts.map((p, i) => `∠${p} = ${fmt(v[i], 1)}°`).join(', ');
  // what is still off, in a short line
  function noteFor(c, r, M) {
    const W = wordsFor(F);
    if (r.missing) return T('Part of the figure isn’t there now (two lines that don’t meet, say): move the points back a little.');
    const p = (c.pts || []).join('');
    if (c.kind === 'cmp') {
      const v = (x) => G.showValue(x, c.dim, M.unit), a = c.a.show(W);
      if (c.b.lit) {
        if (c.op === '=') return F('{a} is {v}; it needs to be {w}.', { a, v: v(r.va), w: v(r.vb) });
        if (c.op === '<' || c.op === '<=') return F('{a} is {v}; it needs to be less than {w}.', { a, v: v(r.va), w: v(r.vb) });
        return F('{a} is {v}; it needs to be more than {w}.', { a, v: v(r.va), w: v(r.vb) });
      }
      const b = c.b.show(W);
      if (c.op === '=') return F('{a} is {v} and {b} is {w}; they need to be equal.', { a, b, v: v(r.va), w: v(r.vb) });
      if (c.op === '<' || c.op === '<=') return F('{a} is {v} and {b} is {w}; {a} needs to be the smaller.', { a, b, v: v(r.va), w: v(r.vb) });
      return F('{a} is {v} and {b} is {w}; {a} needs to be the bigger.', { a, b, v: v(r.va), w: v(r.vb) });
    }
    if (c.kind === 'on') return F('{p} is not on {o} yet.', { p: c.p, o: refName(c.r) });
    if (c.kind === 'parallel') return F('{a} and {b} are not parallel yet: they meet at {v}.', { a: refName(c.r1), b: refName(c.r2), v: fmt(r.deg, 1) + '°' });
    if (c.kind === 'perpendicular') return F('{a} and {b} meet at {v}; they need to meet at 90°.', { a: refName(c.r1), b: refName(c.r2), v: fmt(r.deg, 1) + '°' });
    if (c.kind === 'congruent') return F('{a} and {b} are not congruent yet: their sides are {s} and {u}.', { a: c.p1.join(''), b: c.p2.join(''), s: sidesOf(c.p1, r.sa), u: sidesOf(c.p2, r.sb) });
    if (c.kind === 'similar') return F('{a} and {b} are not similar yet: their angles are {s} and {u}.', { a: c.p1.join(''), b: c.p2.join(''), s: anglesOf(c.p1, r.aa), u: anglesOf(c.p2, r.ab) });
    if (c.kind === 'collinear') return F('{p} are not in a line yet.', { p: andList(c.pts) });
    if (c.kind === 'concyclic') return F('{p} are not on one circle yet.', { p: andList(c.pts) });
    if (r.flat) return F('{p} is flat: its corners are in a line.', { p });
    const s = sidesOf(c.pts, r.sides), a = anglesOf(c.pts, r.angs);
    switch (c.shape) {
      case 'isosceles': return F('Triangle {p} is not isosceles yet: its sides are {s}.', { p, s });
      case 'equilateral': return F('Triangle {p} is not equilateral yet: its sides are {s}.', { p, s });
      case 'scalene': return F('Triangle {p} is not scalene yet: its sides are {s}.', { p, s });
      case 'right': return F('Triangle {p} has no right angle yet: its angles are {a}.', { p, a });
      case 'acute': return F('Triangle {p} is not acute yet: its angles are {a}.', { p, a });
      case 'obtuse': return F('Triangle {p} is not obtuse yet: its angles are {a}.', { p, a });
      case 'parallelogram': return F('{p} is not a parallelogram yet.', { p });
      case 'rectangle': return F('{p} is not a rectangle yet: its angles are {a}.', { p, a });
      case 'rhombus': return F('{p} is not a rhombus yet: its sides are {s}.', { p, s });
      case 'square': return F('{p} is not a square yet: its sides are {s} and its angles {a}.', { p, s, a });
      case 'trapezium': return F('{p} is not a trapezium yet: no two of its sides are parallel.', { p });
      case 'kite': return F('{p} is not a kite yet: its sides are {s}.', { p, s });
      default: return F('{p} is not a cyclic quadrilateral yet: its corners are not on one circle.', { p });
    }
  }
  // a condition in words, for the answer
  function condWords(c, M) {
    const W = wordsFor(F), p = (c.pts || []).join('');
    if (c.kind === 'cmp' || c.kind === 'parallel' || c.kind === 'perpendicular' || c.kind === 'congruent' || c.kind === 'similar') return c.show(W);
    if (c.kind === 'on') return F('{p} on {o}', { p: c.p, o: refName(c.r) });
    if (c.kind === 'collinear') return F('{p} in a line', { p: andList(c.pts) });
    if (c.kind === 'concyclic') return F('{p} on one circle', { p: andList(c.pts) });
    switch (c.shape) {
      case 'isosceles': return F('triangle {p} is isosceles', { p });
      case 'equilateral': return F('triangle {p} is equilateral', { p });
      case 'scalene': return F('triangle {p} is scalene', { p });
      case 'right': return F('triangle {p} has a right angle', { p });
      case 'acute': return F('triangle {p} is acute', { p });
      case 'obtuse': return F('triangle {p} is obtuse', { p });
      case 'parallelogram': return F('{p} is a parallelogram', { p });
      case 'rectangle': return F('{p} is a rectangle', { p });
      case 'rhombus': return F('{p} is a rhombus', { p });
      case 'square': return F('{p} is a square', { p });
      case 'trapezium': return F('{p} is a trapezium', { p });
      case 'kite': return F('{p} is a kite', { p });
      default: return F('{p} is a cyclic quadrilateral', { p });
    }
  }
  const placesText = (pos) => andList(Object.keys(pos).filter((k) => Array.isArray(pos[k]) && fin(pos[k][0]) && fin(pos[k][1])).map((k) => F('{p} at {xy}', { p: k, xy: pair(pos[k][0], pos[k][1]) })));

  const impl = {
    ready,
    block(host, spec, ctx) { return view(host, spec, null, ctx || {}); },
    task(host, spec, goal, ctx) {
      const s = specOf(spec);
      G.conditions(goal, s); // a goal that doesn't read is not shown
      return view(host, s, goal, ctx || {});
    },
    check(goal, value, spec) {
      if (!G) return { correct: false, invalid: true };
      let s, r;
      try { s = specOf(spec); r = G.check(s, goal, value); } catch (e) { return { correct: false, invalid: true }; }
      if (r.invalid) return { correct: false, invalid: true };
      if (r.correct) return { correct: true };
      return { correct: false, note: noteFor(r.fail.cond, r.fail.r, G.model(s)) };
    },
    describe(value, spec) {
      if (!G || !value || typeof value !== 'object') return '';
      return placesText(value);
    },
    answer(goal, spec) {
      if (!G) return '';
      const s = specOf(spec), M = G.model(s), { C } = G.conditions(goal, s);
      const what = andList(C.map((c) => condWords(c, M)));
      const where = goal && goal.solution ? placesText(goal.solution) : '';
      return where ? F('{what}: for example, {where}', { what, where }) : what;
    },
    still(spec) { return still(spec); }
  };
  P.widgets.register('geometry', impl);
})();
