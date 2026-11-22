/* =====================================================================
   The circuit (assets/js/widgets.js): a live circuit diagram for lessons
   on electricity, with the symbols school textbooks use (NCERT's too):
   a cell as a long and a short line, a zigzag resistor, a bulb as a
   circle with a cross, a lever switch, meters as circles with A or V, an
   LED as a diode with two arrows.

   The circuit is solved as it changes (assets/js/widgets/circuit-core.js,
   shared with the server): dots move along the wires with the current,
   faster for more (arrows instead, with reduced motion); bulbs glow by
   their power; meters read live; a short circuit shows a warning and no
   numbers. Switches are buttons in the drawing (tap, click, Enter or
   Space); values the learner may change are sliders under it.

   As a task, the learner sets the switches and sliders, or joins two
   terminals with a wire, and check() runs the circuit to see whether it
   meets the goal. Every spec is checked again here before it is drawn;
   its text goes into the page as text, never as markup.

   In build mode (a spec with "build": true) the learner places the parts
   themselves on a board of dots, from a palette: see mountBuild below.
   The same drawing, current and meters run on whatever they build.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;

  /* ---------------- the solver, shared with the server ---------------- */

  let C = window.PrimerCircuit || null;
  const ready = C ? Promise.resolve(C) : new Promise((resolve, reject) => {
    let s = document.querySelector('script[data-circuit-core]');
    if (!s) {
      s = document.createElement('script');
      s.src = '/assets/js/widgets/circuit-core.js';
      s.async = true;
      s.setAttribute('data-circuit-core', '');
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => { C = window.PrimerCircuit || null; if (C) resolve(C); else reject(new Error('the circuit solver did not load')); });
    s.addEventListener('error', () => reject(new Error('the circuit solver could not be loaded')));
  });
  ready.catch(() => {});
  // the loader (assets/js/widgets.js) waits for this before it counts the kind as loaded, so still
  // pictures can be drawn as soon as it has (on the script element, and on the impl below)
  if (document.currentScript) document.currentScript.ready = ready;

  /* ---------------- words ---------------- */

  const T = (s) => (P.t ? P.t(s) : s);
  const F = (s, v) => T(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m));
  function andList(items) {
    try { return new Intl.ListFormat(P.lang || 'en', { type: 'conjunction' }).format(items); } catch (e) { return items.join(', '); }
  }
  const nameOf = (p) => (p && (p.label || p.id)) || '';
  const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
  const fmt = (type, x) => C.fmtValue(C.unitOf(type), x);

  /* ---------------- drawing ---------------- */

  const SVGNS = 'http://www.w3.org/2000/svg';
  const INK = '#2b1d11', SOFT = '#5b4730', GOLD = '#8a6128', RED = '#9a3324', PAPER = '#f1e6cc', FLOW = '#b4561c', WARM = '#f6c445';
  const LEDS = { red: '#d8402a', green: '#3f9a3a', yellow: '#dfae17', blue: '#3a6fd8' };
  const U = 64;        // one grid step (less for a wide circuit, so its symbols stay large on a phone)
  const SHIFT = 46;    // a part drawn alongside another, this far out
  const GAP = 22;      // between moving dots
  const DASH = '—';
  let uid = 0;

  // a tiny tree of SVG nodes, made into markup (the book) or DOM (the page): text is escaped or set as text
  const el = (tag, attrs, kids, ref) => ({ tag, attrs: attrs || {}, kids: kids || [], ref });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toStr(n) {
    if (n == null) return '';
    if (typeof n === 'string') return esc(n);
    const a = Object.keys(n.attrs).filter((k) => n.attrs[k] != null && n.attrs[k] !== false).map((k) => ` ${k}="${esc(n.attrs[k])}"`).join('');
    return `<${n.tag}${a}>${n.kids.map(toStr).join('')}</${n.tag}>`;
  }
  function toDom(n, refs) {
    if (typeof n === 'string') return document.createTextNode(n);
    const d = document.createElementNS(SVGNS, n.tag);
    Object.keys(n.attrs).forEach((k) => { if (n.attrs[k] != null && n.attrs[k] !== false) d.setAttribute(k, String(n.attrs[k])); });
    n.kids.forEach((k) => { if (k != null) d.appendChild(toDom(k, refs)); });
    if (n.ref) refs[n.ref] = d;
    return d;
  }

  const r1 = (x) => Math.round(x * 10) / 10;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const pts = (list) => list.map((p) => r1(p[0]) + ',' + r1(p[1])).join(' ');
  // p strictly inside the segment a-b
  function inside(p, a, b) {
    const ab = sub(b, a), L = Math.hypot(ab[0], ab[1]);
    if (L < 1e-6) return false;
    const t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (L * L);
    const off = Math.abs((p[0] - a[0]) * ab[1] - (p[1] - a[1]) * ab[0]) / L;
    return off < 0.5 && t > 1e-3 && t < 1 - 1e-3;
  }
  // two segments on one line, overlapping for more than a point
  function overlap(a, b, c, d) {
    const ab = sub(b, a), L = Math.hypot(ab[0], ab[1]);
    if (L < 1e-6) return false;
    const off = (p) => Math.abs((p[0] - a[0]) * ab[1] - (p[1] - a[1]) * ab[0]) / L;
    if (off(c) > 0.5 || off(d) > 0.5) return false;
    const t = (p) => ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (L * L);
    const lo = Math.max(0, Math.min(t(c), t(d))), hi = Math.min(1, Math.max(t(c), t(d)));
    return hi - lo > 1e-3;
  }

  // how big each symbol is, along its part (half its length)
  const HALF = { resistor: 21, cell: 4, battery: 16, bulb: 14, switch: 15, led: 9, ammeter: 15, voltmeter: 15 };

  // where everything goes: nodes, each part's path (shifted alongside another when they would overlap), the view box
  // fixed (a board to build on): its own grid step, view box, middle and shift, the same however much is built
  function layout(spec, goal, fixed) {
    const pos = {};
    const xs = Object.values(spec.nodes).map((p) => p[0]);
    const u = fixed ? fixed.u : Math.max(46, Math.min(U, 400 / Math.max(1, Math.max(...xs) - Math.min(...xs))));
    Object.keys(spec.nodes).forEach((n) => { pos[n] = [spec.nodes[n][0] * u, spec.nodes[n][1] * u]; });
    const nodePts = Object.values(pos);
    const mid = fixed ? fixed.mid : nodePts.reduce((s, p) => add(s, p), [0, 0]).map((v) => v / Math.max(1, nodePts.length));
    const shift = fixed ? fixed.shift : SHIFT;
    const deg = {};
    spec.parts.forEach((p) => { deg[p.from] = (deg[p.from] || 0) + 1; deg[p.to] = (deg[p.to] || 0) + 1; });
    const placed = [];
    const clash = (a, b, ends) => nodePts.some((p) => (ends ? dist(p, a) > 0.5 && dist(p, b) > 0.5 : true) && (inside(p, a, b) || (!ends && (dist(p, a) < 0.5 || dist(p, b) < 0.5))))
      || placed.some(([c, d]) => overlap(a, b, c, d) || overlap(c, d, a, b));
    const order = spec.parts.filter((p) => p.type !== 'voltmeter').concat(spec.parts.filter((p) => p.type === 'voltmeter'));
    const items = {};
    for (const part of order) {
      const A = pos[part.from], B = pos[part.to];
      const L = dist(A, B);
      const dir = mul(sub(B, A), 1 / L);
      const nrm = [-dir[1], dir[0]];
      const out = (nrm[0] * ((A[0] + B[0]) / 2 - mid[0]) + nrm[1] * ((A[1] + B[1]) / 2 - mid[1])) >= -1e-6 ? 1 : -1;
      let path = [A, B], leg = [A, B], side = out;
      if (clash(A, B, true)) {
        // drawn alongside: outward, or on a board inward when outward would leave the grid
        const m = add(mul(add(A, B), 0.5), mul(nrm, out * shift));
        const sgn = fixed && fixed.area && (m[0] < -1 || m[1] < -1 || m[0] > fixed.area[0] + 1 || m[1] > fixed.area[1] + 1) ? -out : out;
        for (const k of [1, -1, 2, -2, 3, -3]) {
          const s = mul(nrm, k * sgn * shift);
          const a2 = add(A, s), b2 = add(B, s);
          if (!clash(a2, b2, false) && !placed.some(([c, d]) => overlap(A, a2, c, d) || overlap(B, b2, c, d))) {
            path = [A, a2, b2, B]; leg = [a2, b2]; side = k * sgn > 0 ? 1 : -1;
            break;
          }
        }
      }
      for (let i = 0; i < path.length - 1; i++) placed.push([path[i], path[i + 1]]);
      const c = mul(add(leg[0], leg[1]), 0.5);
      const half = HALF[part.type] ? Math.min(HALF[part.type], (dist(leg[0], leg[1]) - 10) / 2) : 0;
      // the wire, or the two leads from the nodes to the symbol's ends
      const ends = [add(c, mul(dir, -half)), add(c, mul(dir, half))];
      const leads = part.type === 'wire' ? [path] : path.length === 2 ? [[A, ends[0]], [ends[1], B]] : [[A, path[1], ends[0]], [ends[1], path[2], B]];
      items[part.id] = { part, path, leg, c, dir, nrm, side, half, leads, scale: HALF[part.type] ? half / HALF[part.type] : 1, ang: Math.atan2(dir[1], dir[0]) * 180 / Math.PI };
    }
    // on a board, where the learner puts parts anywhere: each part's words go on its freer side
    if (fixed) {
      const comps = Object.values(items).filter((it) => it.part.type !== 'wire');
      const [vx, vy, vw, vh] = fixed.vb;
      comps.forEach((it) => {
        if (it.path.length !== 2) return;
        const crowd = (s) => {
          const at = add(it.c, mul(it.nrm, s * 40));
          let pen = 0;
          comps.forEach((o) => { if (o !== it) pen += Math.max(0, 60 - dist(at, o.c)); });
          // the far edge of the words: off the board, they'd be cut off
          const far = add(it.c, mul(it.nrm, s * (Math.abs(it.nrm[0]) > 0.6 ? 74 : 62)));
          if (far[0] < vx || far[0] > vx + vw || far[1] < vy || far[1] > vy + vh) pen += 100;
          return pen;
        };
        if (crowd(-it.side) + 1e-6 < crowd(it.side)) it.side = -it.side;
      });
    }
    // a part with another drawn alongside it keeps its words on the other side
    Object.values(items).forEach((sh) => {
      if (sh.path.length !== 4) return;
      const A = sh.path[0], B = sh.path[3];
      Object.values(items).forEach((it) => {
        if (it === sh || it.path.length !== 2 || it.part.type === 'wire') return;
        const s = Math.sign(it.nrm[0] * sh.nrm[0] + it.nrm[1] * sh.nrm[1]) || 1; // the two normals may point opposite ways
        if ((overlap(it.path[0], it.path[1], A, B) || overlap(A, B, it.path[0], it.path[1])) && it.side * s === sh.side) it.side = -it.side;
      });
    });
    // the view: every node, label and symbol, with room for the words around them
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (p, rx, ry) => { x0 = Math.min(x0, p[0] - rx); x1 = Math.max(x1, p[0] + rx); y0 = Math.min(y0, p[1] - ry); y1 = Math.max(y1, p[1] + ry); };
    nodePts.forEach((p) => grow(p, 16, 16));
    Object.values(items).forEach((it) => {
      if (it.part.type === 'wire') return;
      grow(it.c, 26, 26);
      const words = Math.max(nameOf(it.part).length, 7) * 8.6;
      const at = add(it.c, mul(it.nrm, it.side * 30));
      if (Math.abs(it.nrm[0]) > 0.6) grow([at[0] + (it.nrm[0] * it.side > 0 ? words : -words), at[1]], 4, 24);
      else grow([at[0], at[1] + (it.nrm[1] * it.side > 0 ? 40 : -40)], words / 2 + 4, 4);
    });
    spec.labels.forEach((l) => grow([l.at[0] * u, l.at[1] * u], l.text.length * 4.4 + 6, 14));
    if (goal && goal.terminals) goal.terminals.forEach((n) => { if (pos[n]) grow(pos[n], 34, 34); });
    const padX = 10, padY = 8;
    if (fixed) { // the board, or more if words reach past it
      const [fx, fy, fw, fh] = fixed.vb;
      const lx = Math.min(fx, x0 - padX), ly = Math.min(fy, y0 - padY);
      return { u, pos, mid, deg, items, vb: [r1(lx), r1(ly), r1(Math.max(fx + fw, x1 + padX) - lx), r1(Math.max(fy + fh, y1 + padY) - ly)] };
    }
    return { u, pos, mid, deg, items, vb: [r1(x0 - padX), r1(y0 - padY), r1(x1 - x0 + 2 * padX), r1(y1 - y0 + 2 * padY)] };
  }

  // how a lamp looks for a solved state: its glow, a bulb's warm fill, an LED's colour
  function lampLook(part, res) {
    const lit = Boolean(res && !res.short && res.lit[part.id]);
    const g = res && !res.short ? res.glow[part.id] || 0 : 0;
    const v = part.type === 'bulb' ? Math.sqrt(g) : g; // a bulb's glow is its power; it looks brighter sooner
    return { lit, glow: lit ? r1(0.25 + 0.75 * v) : 0, fill: lit ? r1(0.3 + 0.7 * v) : 0, led: lit ? LEDS[part.color] || LEDS.red : PAPER };
  }

  // a symbol in its own frame: along x from -half to +half, centred on 0
  function symbol(part, live, look) {
    const s = HALF[part.type];
    const line = (x1, y1, x2, y2, extra) => el('line', Object.assign({ x1, y1, x2, y2 }, extra || {}));
    switch (part.type) {
      case 'resistor': {
        const zig = [[-21, 0], [-17.5, -7.5], [-10.5, 7.5], [-3.5, -7.5], [3.5, 7.5], [10.5, -7.5], [17.5, 7.5], [21, 0]];
        return [el('polyline', { points: pts(zig), fill: 'none' })];
      }
      case 'cell': // the long thin line is +, the short thick one -
        return [line(-4, -7, -4, 7, { 'stroke-width': 5, 'stroke-linecap': 'butt' }), line(4, -15, 4, 15)];
      case 'battery':
        return [line(-16, -7, -16, 7, { 'stroke-width': 5, 'stroke-linecap': 'butt' }), line(-9, -15, -9, 15), line(-4.5, 0, 4.5, 0, { 'stroke-dasharray': '2 3', 'stroke-width': 1.8 }),
          line(9, -7, 9, 7, { 'stroke-width': 5, 'stroke-linecap': 'butt' }), line(16, -15, 16, 15)];
      case 'bulb':
        return [el('circle', { r: 14, fill: PAPER }), el('circle', { r: 14, fill: WARM, opacity: look.fill, stroke: 'none' }, [], live ? 'fill:' + part.id : null),
          el('circle', { r: 14, fill: 'none' }), line(-9.9, -9.9, 9.9, 9.9), line(-9.9, 9.9, 9.9, -9.9)];
      case 'led': {
        const col = LEDS[part.color] || LEDS.red;
        // the two arrows are its light: in its colour when it is lit
        return [el('polygon', { points: '-9,-10 -9,10 9,0', fill: look.led }, [], live ? 'fill:' + part.id : null), line(9, -10, 9, 10),
          el('g', { stroke: look.lit ? col : SOFT, 'stroke-width': 1.6 }, [line(-1, -13, 5, -21), el('polyline', { points: '1.4,-21.6 5,-21 4.6,-17.4', fill: 'none' }),
            line(5, -11, 11, -19), el('polyline', { points: '7.4,-19.6 11,-19 10.6,-15.4', fill: 'none' })], live ? 'rays:' + part.id : null)];
      }
      case 'ammeter':
      case 'voltmeter':
        return [el('circle', { r: s, fill: PAPER })];
      default: return [];
    }
  }

  // the whole drawing; live: with what the page moves and changes (refs), and the switches as buttons
  // opts.fixed, opts.build: on a board to build on (its grid, no node names: loose ends are small open rings)
  function drawing(spec, goal, res, opts) {
    const live = Boolean(opts.live);
    const id = 'ckt' + (++uid);
    const lay = layout(spec, goal, opts.fixed);
    const { pos, items, deg, vb } = lay;
    const kidsGlow = [], kidsLines = [], kidsParts = [], kidsNodes = [], kidsWords = [], kidsTerms = [];
    const fs = 15;
    const short = res && res.short ? new Set([...res.short.cells, ...res.short.path]) : new Set();
    const swState = (p) => (opts.state && has(opts.state.s, p.id) ? opts.state.s[p.id] : p.closed);
    const control = new Set(spec.controls.filter((c) => !c.step).map((c) => c.part));
    const sliders = new Set(spec.controls.filter((c) => c.step).map((c) => c.part));

    const defs = el('defs', {}, [
      el('radialGradient', { id: id + '-warm' }, [el('stop', { offset: '0', 'stop-color': '#ffe27a', 'stop-opacity': '0.95' }), el('stop', { offset: '0.45', 'stop-color': '#f6c445', 'stop-opacity': '0.55' }), el('stop', { offset: '1', 'stop-color': '#f6c445', 'stop-opacity': '0' })])
    ].concat(Object.keys(LEDS).map((k) => el('radialGradient', { id: id + '-' + k }, [el('stop', { offset: '0', 'stop-color': LEDS[k], 'stop-opacity': '0.8' }), el('stop', { offset: '1', 'stop-color': LEDS[k], 'stop-opacity': '0' })]))));

    for (const part of spec.parts) {
      const it = items[part.id];
      const ang = r1(it.ang);
      const tr = `translate(${r1(it.c[0])} ${r1(it.c[1])}) rotate(${ang})${it.scale < 0.999 ? ` scale(${r1(it.scale * 100) / 100})` : ''}`;
      // its wire, or the leads to its symbol
      kidsLines.push(el('g', { class: short.has(part.id) ? 'is-short' : null, stroke: short.has(part.id) ? RED : INK }, it.leads.map((l) => el('polyline', { points: pts(l), fill: 'none' })), live ? 'line:' + part.id : null));
      if (part.type === 'wire') continue;

      // a lamp's glow, under everything
      const look = lampLook(part, res);
      if (part.type === 'bulb' || part.type === 'led') {
        kidsGlow.push(el('circle', { cx: r1(it.c[0]), cy: r1(it.c[1]), r: part.type === 'bulb' ? 36 : 26, fill: `url(#${id}-${part.type === 'bulb' ? 'warm' : part.color || 'red'})`, opacity: look.glow }, [], live ? 'glow:' + part.id : null));
      }

      if (part.type === 'switch') {
        const closed = swState(part);
        const arm = el('g', { transform: 'translate(-15 0)' }, [el('g', { class: 'ckt-arm', transform: live ? null : closed ? null : 'rotate(-30)', style: live ? `transform:rotate(${closed ? 0 : -30}deg)` : null }, [el('line', { x1: 0, y1: 0, x2: 30, y2: 0, 'stroke-width': 2.6 })], live ? 'arm:' + part.id : null)]);
        const body = [el('circle', { cx: -15, cy: 0, r: 3.2, fill: PAPER }), el('circle', { cx: 15, cy: 0, r: 3.2, fill: PAPER }), arm];
        const canTap = live && control.has(part.id);
        if (canTap) {
          body.unshift(el('rect', { class: 'ckt-hit', x: -30, y: -32, width: 60, height: 50, rx: 8, fill: 'transparent', stroke: 'none' }),
            el('rect', { class: 'ckt-ring', x: -25, y: -25, width: 50, height: 36, rx: 7, fill: 'none', stroke: GOLD, 'stroke-width': 2 }));
        }
        kidsParts.push(el('g', {
          transform: tr, class: canTap ? 'ckt-sw' : null, stroke: canTap ? GOLD : INK, 'stroke-width': 2.2,
          role: canTap ? 'button' : null, tabindex: canTap ? '0' : null, 'data-switch': canTap ? part.id : null,
          'aria-label': canTap ? F(closed ? 'Switch {name}: closed' : 'Switch {name}: open', { name: nameOf(part) }) : null
        }, body, live ? 'sw:' + part.id : null));
      } else {
        const body = symbol(part, live, look);
        if (sliders.has(part.id) && part.type === 'resistor') { // a rheostat: an arrow through it
          body.push(el('line', { x1: -15, y1: 13, x2: 13, y2: -13, 'stroke-width': 1.6 }), el('polyline', { points: '6,-13.5 13,-13 12.5,-6', fill: 'none', 'stroke-width': 1.6 }));
        }
        kidsParts.push(el('g', { transform: tr, stroke: short.has(part.id) ? RED : INK, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, body, live ? 'sym:' + part.id : null));
      }
      // what can't turn with it: a meter's letter, a cell's + sign
      if (part.type === 'ammeter' || part.type === 'voltmeter') {
        kidsParts.push(el('text', { x: r1(it.c[0]), y: r1(it.c[1]), dy: '0.36em', 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 700, fill: INK, class: 'ckt-letter' }, [part.type === 'ammeter' ? 'A' : 'V']));
      }
      if (part.type === 'cell' || part.type === 'battery') {
        const plus = add(add(it.c, mul(it.dir, (part.type === 'cell' ? 4 : 16) * it.scale + 8)), mul(it.nrm, -it.side * 17));
        kidsParts.push(el('text', { x: r1(plus[0]), y: r1(plus[1]), dy: '0.35em', 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 700, fill: SOFT, class: 'ckt-plus' }, ['+']));
      }

      // its name and value, on the outside
      const valueText = C.hasValue(part.type) ? fmt(part.type, opts.state && has(opts.state.v, part.id) ? opts.state.v[part.id] : part.value)
        : (part.type === 'ammeter' || part.type === 'voltmeter') ? (res && !res.short ? fmt(part.type, res.read[part.id] || 0) : DASH) : '';
      const n = mul(it.nrm, it.side);
      const off = Math.abs(n[0]) > 0.6 ? 26 : 24;
      const at = add(it.c, mul(n, off));
      const sideways = Math.abs(n[0]) > 0.6;
      const anchor = sideways ? (n[0] > 0 ? 'start' : 'end') : 'middle';
      const two = Boolean(valueText);
      const dy1 = sideways ? (two ? '-0.2em' : '0.35em') : n[1] > 0 ? '0.85em' : (two ? '-1.3em' : '-0.3em');
      const spans = [el('tspan', { x: r1(at[0]), dy: dy1, class: 'ckt-name', 'font-weight': 600 }, [nameOf(part)])];
      if (two) spans.push(el('tspan', { x: r1(at[0]), dy: '1.15em', class: part.type === 'ammeter' || part.type === 'voltmeter' ? 'ckt-read' : 'ckt-val' }, [valueText], live ? 'val:' + part.id : null));
      kidsWords.push(el('text', { x: r1(at[0]), y: r1(at[1]), 'text-anchor': anchor, 'font-size': fs, fill: INK }, spans));
    }

    // joins (three or more parts at a node), and loose ends
    const terms = new Set(goal && goal.terminals ? goal.terminals : []);
    // a node's name, just outside the circuit from it
    const nodeWord = (n, d) => {
      const p = pos[n], away = sub(p, lay.mid);
      const L = Math.hypot(away[0], away[1]) || 1;
      const lab = add(p, mul(away, d / L));
      kidsWords.push(el('text', { x: r1(lab[0]), y: r1(lab[1]), dy: '0.35em', 'text-anchor': away[0] > 8 ? 'start' : away[0] < -8 ? 'end' : 'middle', 'font-size': fs, fill: GOLD, 'font-style': 'italic', 'font-weight': 600 }, [n]));
    };
    Object.keys(pos).forEach((n) => {
      if (terms.has(n)) return;
      if ((deg[n] || 0) >= 3) kidsNodes.push(el('circle', { cx: r1(pos[n][0]), cy: r1(pos[n][1]), r: 3.8, fill: INK }));
      else if (opts.build) { // being built: an end joined to nothing yet
        if (deg[n] === 1) kidsNodes.push(el('circle', { cx: r1(pos[n][0]), cy: r1(pos[n][1]), r: 4.2, fill: PAPER, stroke: INK, 'stroke-width': 1.8, class: 'ckt-loose' }));
      } else if ((deg[n] || 0) <= 1) { // a loose end (a connect task, on paper): an open terminal, named
        kidsNodes.push(el('circle', { cx: r1(pos[n][0]), cy: r1(pos[n][1]), r: 5, fill: PAPER, stroke: INK, 'stroke-width': 2 }));
        nodeWord(n, 15);
      }
    });
    // a connect task's terminals: buttons, each with its name
    terms.forEach((n) => {
      if (!pos[n]) return;
      const p = pos[n];
      const parts = [el('circle', { class: 'ckt-hit', r: 18, fill: 'transparent', stroke: 'none' }), el('circle', { class: 'ckt-ring', r: 13, fill: 'none', stroke: GOLD, 'stroke-width': 2 }),
        el('circle', { class: 'ckt-dot', r: 7.5, fill: PAPER, stroke: GOLD, 'stroke-width': 2.6 }, [], live ? 'tdot:' + n : null)];
      kidsTerms.push(el('g', { transform: `translate(${r1(p[0])} ${r1(p[1])})`, class: live ? 'ckt-term' : null, role: live ? 'button' : null, tabindex: live ? '0' : null, 'data-term': live ? n : null, 'aria-label': live ? F('Terminal {name}', { name: n }) : null }, parts, live ? 'term:' + n : null));
      nodeWord(n, 23);
    });
    spec.labels.forEach((l) => kidsWords.push(el('text', { x: r1(l.at[0] * lay.u), y: r1(l.at[1] * lay.u), dy: '0.35em', 'text-anchor': 'middle', 'font-size': fs - 1, fill: SOFT, 'font-style': 'italic', class: 'ckt-note' }, [l.text])));

    const svg = el('svg', {
      xmlns: SVGNS, viewBox: vb.join(' '), width: live ? null : vb[2], height: live ? null : vb[3], class: live ? 'ckt-svg' : null,
      role: live ? 'group' : 'img', 'aria-label': T('Circuit diagram'),
      'font-family': live ? null : 'Georgia, \'Times New Roman\', serif', style: live ? null : 'font-variant-numeric:lining-nums',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }, [
      defs,
      el('g', { class: 'ckt-glows' }, kidsGlow),
      el('g', { class: 'ckt-lines', 'stroke-width': 2.2, fill: 'none' }, kidsLines, live ? 'lines' : null),
      live ? el('g', { class: 'ckt-added', stroke: GOLD, 'stroke-width': 2.6, fill: 'none' }, [], 'added') : null,
      live ? el('g', { class: 'ckt-flow', fill: FLOW, stroke: 'none' }, [], 'flow') : null,
      el('g', { class: 'ckt-parts' }, kidsParts),
      el('g', { class: 'ckt-nodes' }, kidsNodes),
      el('g', { class: 'ckt-words' }, kidsWords),
      el('g', { class: 'ckt-terms' }, kidsTerms)
    ]);
    return { svg, lay, id };
  }

  // a polyline's length, and the point a distance along it
  function track(list) {
    const cum = [0];
    for (let i = 1; i < list.length; i++) cum.push(cum[i - 1] + dist(list[i - 1], list[i]));
    return { list, cum, len: cum[cum.length - 1] };
  }
  function pointAt(tk, d) {
    const { list, cum } = tk;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
    return [list[i - 1][0] + (list[i][0] - list[i - 1][0]) * t, list[i - 1][1] + (list[i][1] - list[i - 1][1]) * t, Math.atan2(list[i][1] - list[i - 1][1], list[i][0] - list[i - 1][0])];
  }

  /* ---------------- shared by the diagram and the board ---------------- */

  // what moves for a solved circuit: each part's path and its current (and a connect task's added wire)
  function flowList(spec, lay, res, extra) {
    if (!res || res.short) return [];
    const all = spec.parts.map((p) => ({ id: p.id, path: lay.items[p.id].path, wire: p.type === 'wire', leads: lay.items[p.id].leads, i: res.I[p.id] || 0 }));
    if (extra) all.push(Object.assign({ i: res.I[extra.id] || 0 }, extra));
    return all;
  }

  // The moving current: dots along each path, faster for more current; an arrow each with reduced motion.
  // Runs only while on screen and the page is shown; set() keeps the dots going where they were.
  function flowEngine(reduce) {
    let flows = [], raf = 0, last = 0, onScreen = true, gone = false, io = null;
    function set(g, list) {
      if (!g) return;
      while (g.firstChild) g.removeChild(g.firstChild);
      const was = new Map(flows.map((f) => [f.key, f.phase]));
      flows = [];
      for (const a of list) {
        const i = a.i;
        if (Math.abs(i) < 1e-6) continue;
        const tk = track(a.path);
        if (tk.len < 1) continue;
        // faster for more current: 120 units a second at half an ampere
        const gap = tk.len / Math.max(1, Math.round(tk.len / GAP));
        const f = { key: a.id + (i > 0 ? '+' : '-'), tk, dir: i > 0 ? 1 : -1, speed: Math.max(8, Math.min(220, 120 * Math.sqrt(Math.abs(i) / 0.5))), gap, dots: [] };
        f.phase = (was.get(f.key) || 0) % gap;
        if (reduce) {
          // still: an arrow halfway along the wire, or along the longer lead of a part
          let lead = tk;
          if (!a.wire && a.leads) {
            const [l1, l2] = a.leads.map(track);
            lead = l1.len >= l2.len ? l1 : l2;
            if (lead.len < 14) continue;
          }
          const at = pointAt(lead, lead.len / 2);
          const ang = at[2] * 180 / Math.PI + (f.dir > 0 ? 0 : 180);
          const arrow = document.createElementNS(SVGNS, 'path');
          arrow.setAttribute('d', 'M -5 -4.5 L 5 0 L -5 4.5 z');
          arrow.setAttribute('transform', `translate(${r1(at[0])} ${r1(at[1])}) rotate(${r1(ang)})`);
          g.appendChild(arrow);
        } else {
          const n = Math.round(tk.len / f.gap);
          for (let k = 0; k < n; k++) {
            const dot = document.createElementNS(SVGNS, 'circle');
            dot.setAttribute('r', '2.7');
            g.appendChild(dot);
            f.dots.push(dot);
          }
          flows.push(f);
        }
      }
      if (!reduce) { place(); schedule(); }
    }
    function place() {
      flows.forEach((f) => f.dots.forEach((dot, k) => {
        const d = f.phase + k * f.gap;
        const at = pointAt(f.tk, f.dir > 0 ? d : f.tk.len - d);
        dot.setAttribute('cx', r1(at[0]));
        dot.setAttribute('cy', r1(at[1]));
      }));
    }
    const running = () => !gone && onScreen && !document.hidden && flows.length > 0;
    function frame(now) {
      raf = 0;
      if (!running()) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      flows.forEach((f) => { f.phase = (f.phase + f.speed * dt) % f.gap; });
      place();
      raf = requestAnimationFrame(frame);
    }
    function schedule() {
      if (!raf && running()) { last = 0; raf = requestAnimationFrame(frame); }
    }
    const onVis = () => schedule();
    document.addEventListener('visibilitychange', onVis);
    return {
      set,
      watch(node) {
        if (!('IntersectionObserver' in window)) return;
        io = new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); schedule(); });
        io.observe(node);
      },
      destroy() {
        gone = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (io) io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
      }
    };
  }

  // one part of a drawing, shown for a solved state in place (so a switch's arm swings and a glow fades)
  function paintPart(refs, p, res, short, closed, val, fill) {
    const line = refs['line:' + p.id];
    if (line) { line.classList.toggle('is-short', short.has(p.id)); line.setAttribute('stroke', short.has(p.id) ? RED : INK); }
    const sym = refs['sym:' + p.id];
    if (sym) sym.setAttribute('stroke', short.has(p.id) ? RED : INK);
    if (p.type === 'switch' && refs['arm:' + p.id]) {
      refs['arm:' + p.id].style.transform = `rotate(${closed ? 0 : -30}deg)`;
      const sw = refs['sw:' + p.id];
      if (sw && sw.hasAttribute('data-switch')) {
        sw.setAttribute('aria-label', fill(closed ? 'Switch {name}: closed' : 'Switch {name}: open', { name: nameOf(p) }));
        sw.classList.toggle('is-closed', closed);
      }
    }
    if (p.type === 'bulb' || p.type === 'led') {
      const look = lampLook(p, res);
      const glow = refs['glow:' + p.id];
      if (glow) glow.setAttribute('opacity', look.glow);
      const f = refs['fill:' + p.id];
      if (f && p.type === 'bulb') f.setAttribute('opacity', look.fill);
      if (f && p.type === 'led') f.setAttribute('fill', look.led);
      const rays = refs['rays:' + p.id];
      if (rays) rays.setAttribute('stroke', look.lit ? LEDS[p.color] || LEDS.red : SOFT);
    }
    const v = refs['val:' + p.id];
    if (v) v.textContent = C.hasValue(p.type) ? fmt(p.type, val) : res.short ? DASH : fmt(p.type, res.read[p.id] || 0);
  }

  /* ---------------- the live circuit ---------------- */

  function mount(host, spec, goal, ctx, mode) {
    const t = ctx.t || T;
    const fill = ctx.fill || F;
    const reduce = Boolean(ctx.reduce);
    const isTask = mode === 'task';
    const connect = Boolean(goal && goal.type === 'connect');
    const byId = new Map(spec.parts.map((p) => [p.id, p]));
    const start = C.stateOf(spec, null, goal);
    let state = clone(start);
    let touched = false, locked = false, pick = null, destroyed = false;

    const root = document.createElement('div');
    root.className = 'ckt' + (isTask ? ' ckt--task' : '');
    root.setAttribute('data-no-i18n', '');
    const stage = document.createElement('div');
    stage.className = 'ckt-stage';
    root.appendChild(stage);

    const refs = {};
    const res0 = C.solve(spec, state, goal);
    const { svg: tree, lay } = drawing(spec, goal, res0, { live: true, state });
    const svg = toDom(tree, refs);
    svg.style.maxWidth = Math.round(lay.vb[2] * 1.12) + 'px';
    stage.appendChild(svg);

    const status = document.createElement('p');
    status.className = 'ckt-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    root.appendChild(status);

    const meters = spec.parts.filter((p) => p.type === 'ammeter' || p.type === 'voltmeter');
    const chips = {};
    if (meters.length) {
      const box = document.createElement('div');
      box.className = 'ckt-meters';
      meters.forEach((p) => {
        const chip = document.createElement('span');
        chip.className = 'ckt-chip';
        const b = document.createElement('b');
        b.textContent = nameOf(p);
        const v = document.createElement('span');
        chip.append(b, ' ', v);
        box.appendChild(chip);
        chips[p.id] = v;
      });
      root.appendChild(box);
    }

    const sliderEls = {};
    const sliderCtl = spec.controls.filter((c) => c.step);
    if (sliderCtl.length) {
      const box = document.createElement('div');
      box.className = 'ckt-sliders';
      sliderCtl.forEach((c) => {
        const p = byId.get(c.part);
        const lab = document.createElement('label');
        lab.className = 'ckt-slider';
        const name = document.createElement('span');
        name.className = 'ckt-slider__name';
        name.textContent = nameOf(p);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(c.min); input.max = String(c.max); input.step = String(c.step);
        input.value = String(state.v[p.id]);
        const out = document.createElement('output');
        out.className = 'ckt-slider__out';
        lab.append(name, input, out);
        box.appendChild(lab);
        input.addEventListener('input', () => {
          if (locked) { input.value = String(state.v[p.id]); return; }
          state.v[p.id] = Number(input.value);
          changed();
        });
        sliderEls[p.id] = { input, out, p };
      });
      root.appendChild(box);
    }

    const switches = spec.controls.filter((c) => !c.step).length;
    const hintText = connect ? t('Tap two terminals to join them with a wire.')
      : switches && sliderCtl.length ? t('Tap a switch to open or close it, and drag a slider to change a value.')
        : switches ? t('Tap a switch to open or close it.') : sliderCtl.length ? t('Drag a slider to change a value.') : '';
    let resetBtn = null;
    if (hintText || !isTask) {
      const foot = document.createElement('div');
      foot.className = 'ckt-foot';
      if (hintText) {
        const hint = document.createElement('span');
        hint.className = 'ckt-hint';
        hint.textContent = hintText;
        foot.appendChild(hint);
      }
      if (!isTask && spec.controls.length) {
        resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'ckt-reset';
        resetBtn.textContent = t('Reset');
        resetBtn.addEventListener('click', () => { state = clone(start); touched = false; pick = null; paint(); });
        foot.appendChild(resetBtn);
      }
      if (foot.childNodes.length) root.appendChild(foot);
    }
    const say = document.createElement('p');
    say.className = 'sr-only';
    say.setAttribute('aria-live', 'polite');
    root.appendChild(say);

    host.textContent = '';
    host.appendChild(root);

    /* switches and terminals */
    function toggle(idSw) {
      if (locked || !has(state.s, idSw)) return;
      state.s[idSw] = !state.s[idSw];
      changed();
    }
    function tapTerminal(n) {
      if (locked || !connect) return;
      if (pick === n) pick = null;
      else if (!pick) pick = n;
      else { state.w = [pick, n]; pick = null; touched = true; changed(); return; }
      paintPick();
    }
    function onActivate(e) {
      const sw = e.target.closest && e.target.closest('[data-switch]');
      if (sw) { toggle(sw.getAttribute('data-switch')); return true; }
      const term = e.target.closest && e.target.closest('[data-term]');
      if (term) { tapTerminal(term.getAttribute('data-term')); return true; }
      return false;
    }
    const onClick = (e) => { onActivate(e); };
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      if (onActivate(e)) e.preventDefault();
    };
    svg.addEventListener('click', onClick);
    svg.addEventListener('keydown', onKey);

    function changed() {
      touched = true;
      paint();
      try { ctx.onChange && ctx.onChange(value()); } catch (err) { /* the page's own handler */ }
    }

    /* moving current */
    const flows = flowEngine(reduce);
    flows.watch(svg);
    const buildFlows = (res) => flows.set(refs.flow, flowList(spec, lay, res, state.w ? { id: '~+', path: [lay.pos[state.w[0]], lay.pos[state.w[1]]], wire: true } : null));

    // words big enough to read at any width
    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => {
      const w = svg.getBoundingClientRect().width;
      if (!w) return;
      const scale = w / lay.vb[2];
      svg.style.setProperty('--ckt-fs', String(Math.max(15, Math.min(22, 12.5 / scale))));
    }) : null;
    if (ro) ro.observe(svg);

    /* showing the state */
    let sayTimer = 0;
    function paintPick() {
      Object.keys(refs).forEach((k) => {
        if (!k.startsWith('term:')) return;
        const n = k.slice(5);
        const on = pick === n || Boolean(state.w && state.w.includes(n));
        refs[k].classList.toggle('is-picked', pick === n);
        refs[k].classList.toggle('is-joined', Boolean(state.w && state.w.includes(n)));
        refs[k].setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    function paint() {
      const res = C.solve(spec, state, goal);
      const short = res.short ? new Set([...res.short.cells, ...res.short.path]) : new Set();
      spec.parts.forEach((p) => {
        paintPart(refs, p, res, short, has(state.s, p.id) ? state.s[p.id] : p.closed, has(state.v, p.id) ? state.v[p.id] : p.value, fill);
        if (chips[p.id]) chips[p.id].textContent = res.short ? DASH : fmt(p.type, res.read[p.id] || 0);
        if (sliderEls[p.id]) {
          const s = sliderEls[p.id];
          const x = state.v[p.id];
          if (Number(s.input.value) !== x) s.input.value = String(x);
          s.out.textContent = fmt(p.type, x);
          s.input.setAttribute('aria-valuetext', fmt(p.type, x));
        }
      });
      // the wire the learner added
      const added = refs.added;
      while (added.firstChild) added.removeChild(added.firstChild);
      if (state.w) {
        const a = lay.pos[state.w[0]], b = lay.pos[state.w[1]];
        const ln = document.createElementNS(SVGNS, 'line');
        ln.setAttribute('x1', r1(a[0])); ln.setAttribute('y1', r1(a[1])); ln.setAttribute('x2', r1(b[0])); ln.setAttribute('y2', r1(b[1]));
        if (res.short) ln.setAttribute('stroke', RED);
        added.appendChild(ln);
      }
      paintPick();
      // what's wrong, if anything
      let msg = '';
      if (res.short) msg = t('Short circuit! Nothing in the way slows the current, so it would be dangerously large.');
      else if (res.burn.length) msg = fill('{name} has too much current: a real LED would burn out. A resistor in series keeps it safe.', { name: nameOf(byId.get(res.burn[0])) });
      status.textContent = msg;
      status.hidden = !msg;
      status.classList.toggle('is-short', Boolean(res.short));
      buildFlows(res);
      // for screen readers, once things settle
      clearTimeout(sayTimer);
      sayTimer = setTimeout(() => {
        if (destroyed) return;
        if (res.short) { say.textContent = msg; return; }
        const bits = [];
        spec.parts.forEach((p) => {
          if (p.type === 'bulb' || p.type === 'led') bits.push(fill(res.lit[p.id] ? '{name} is lit' : '{name} is off', { name: nameOf(p) }));
          if (p.type === 'ammeter' || p.type === 'voltmeter') bits.push(fill('{name} reads {value}', { name: nameOf(p), value: fmt(p.type, res.read[p.id] || 0) }));
        });
        say.textContent = bits.join('. ') + (bits.length ? '.' : '') + (msg ? ' ' + msg : '');
      }, 700);
    }
    paint();

    function value() {
      if (!touched) return null;
      if (connect) return state.w ? { s: {}, v: {}, w: state.w.slice() } : null;
      return { s: Object.assign({}, state.s), v: Object.assign({}, state.v) };
    }

    return {
      value,
      reset() { state = clone(start); touched = false; pick = null; paint(); },
      reveal() {
        const sol = solved(spec, goal);
        if (!sol) return;
        state = clone(sol);
        touched = true;
        pick = null;
        paint();
      },
      lock(on) {
        locked = Boolean(on);
        root.classList.toggle('is-locked', locked);
        svg.querySelectorAll('[data-switch],[data-term]').forEach((n) => {
          n.setAttribute('tabindex', locked ? '-1' : '0');
          if (locked) n.setAttribute('aria-disabled', 'true'); else n.removeAttribute('aria-disabled');
        });
        Object.values(sliderEls).forEach((s) => { s.input.disabled = locked; });
        if (resetBtn) resetBtn.disabled = locked;
      },
      destroy() {
        destroyed = true;
        flows.destroy();
        clearTimeout(sayTimer);
        if (ro) ro.disconnect();
        svg.removeEventListener('click', onClick);
        svg.removeEventListener('keydown', onKey);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  const clone = (st) => ({ s: Object.assign({}, st.s), v: Object.assign({}, st.v), w: st.w ? st.w.slice() : null });

  /* ---------------- build mode: a board of dots to build on ----------------
     The palette lists the parts to place, with how many are left. Choose one, then tap the gap between two
     dots (or tap two dots in a row or column; a wire may turn one corner), or drag it from the palette onto
     the board. Tap a part to choose it (a switch also opens or closes), then rotate, flip, change its value,
     move it (drag, or Shift and the arrow keys) or delete it; Undo goes back a step. The keyboard: arrows move
     between dots, Enter places or chooses, R, F, T, Delete and Escape. Everything is solved as it is built. */

  const BU = 64;                  // a grid step
  const BMX = 52, BMY = 54;       // room round the dots for the words
  const boardBox = (spec) => ({ u: BU, vb: [-BMX, -BMY, spec.grid[0] * BU + 2 * BMX, spec.grid[1] * BU + 2 * BMY], mid: [spec.grid[0] * BU / 2, spec.grid[1] * BU / 2], area: [spec.grid[0] * BU, spec.grid[1] * BU], shift: 28 });
  const samePt = (a, b) => a[0] === b[0] && a[1] === b[1];
  const copyB = (p) => { const q = Object.assign({}, p, { from: p.from.slice(), to: p.to.slice() }); if (p.values) q.values = p.values.slice(); return q; };
  const isMeter = (p) => p.type === 'ammeter' || p.type === 'voltmeter';

  function typeName(type, t) {
    switch (type) {
      case 'cell': return t('Cell');
      case 'battery': return t('Battery');
      case 'resistor': return t('Resistor');
      case 'bulb': return t('Bulb');
      case 'switch': return t('Switch');
      case 'led': return t('LED');
      case 'ammeter': return t('Ammeter');
      case 'voltmeter': return t('Voltmeter');
      default: return t('Wire');
    }
  }
  function colorWord(c, t) {
    switch (c) {
      case 'green': return t('green');
      case 'yellow': return t('yellow');
      case 'blue': return t('blue');
      default: return t('red');
    }
  }
  function placeWords(code, t) {
    switch (code) {
      case 'off': return t('That is off the board.');
      case 'same': return t('Choose two different dots.');
      case 'bent': return t('A part goes straight along a row or a column of dots.');
      case 'covered': return t('That crosses the middle of another part: parts join only at their ends.');
      case 'overlap': return t('That runs along another part. Choose dots that are free.');
      case 'full': return t('There is no room for another part between those two dots.');
      default: return t('That can’t go there.');
    }
  }
  // a palette item's value: "4 Ω", or a choice "2–6 Ω"
  function itemValue(it) {
    if (!it.values) return '';
    if (it.values.length === 1) return fmt(it.type, it.values[0]);
    const a = fmt(it.type, Math.min(...it.values)), b = fmt(it.type, Math.max(...it.values));
    const ua = a.slice(a.lastIndexOf(' ')), ub = b.slice(b.lastIndexOf(' '));
    return (ua === ub ? a.slice(0, a.lastIndexOf(' ')) : a) + '–' + b;
  }

  // the dots, and the labelled ones with their names
  function gridTree(spec) {
    const kids = [];
    for (let y = 0; y <= spec.grid[1]; y++) for (let x = 0; x <= spec.grid[0]; x++) kids.push(el('circle', { cx: x * BU, cy: y * BU, r: 2.7 }));
    return el('g', { class: 'ckt-grid', fill: '#b8a274', stroke: 'none' }, kids);
  }
  function marksTree(spec) {
    const kids = [];
    const mid = [spec.grid[0] * BU / 2, spec.grid[1] * BU / 2];
    Object.keys(spec.nodes).forEach((n) => {
      const p = [spec.nodes[n][0] * BU, spec.nodes[n][1] * BU];
      const away = sub(p, mid);
      const L = Math.hypot(away[0], away[1]) || 1;
      const at = add(p, mul(away, 19 / L));
      kids.push(el('circle', { cx: p[0], cy: p[1], r: 6.5, fill: 'none', stroke: GOLD, 'stroke-width': 2.2 }));
      kids.push(el('text', { x: r1(at[0]), y: r1(at[1] - (Math.abs(away[1]) < 1 ? 12 : 0)), dy: '0.35em', 'text-anchor': away[0] > 8 ? 'start' : away[0] < -8 ? 'end' : 'middle', 'font-size': 16, fill: GOLD, 'font-style': 'italic', 'font-weight': 700, class: 'ckt-mark' }, [n]));
    });
    return el('g', { class: 'ckt-marks' }, kids);
  }
  // a palette item's little picture
  function iconTree(it) {
    const leads = (h) => [el('line', { x1: -26, y1: 0, x2: -h, y2: 0 }), el('line', { x1: h, y1: 0, x2: 26, y2: 0 })];
    let body;
    if (it.type === 'wire') body = [el('line', { x1: -24, y1: 0, x2: 24, y2: 0 }), el('circle', { cx: -24, cy: 0, r: 3, fill: INK }), el('circle', { cx: 24, cy: 0, r: 3, fill: INK })];
    else if (it.type === 'switch') body = leads(15).concat([el('circle', { cx: -15, cy: 0, r: 3.2, fill: PAPER }), el('circle', { cx: 15, cy: 0, r: 3.2, fill: PAPER }), el('line', { x1: -15, y1: 0, x2: 11, y2: -14, 'stroke-width': 2.6 })]);
    else {
      const part = { id: 'x', type: it.type, color: it.color };
      body = leads(HALF[it.type] || 10).concat(symbol(part, false, { lit: it.type === 'led', glow: 0, fill: 0, led: it.type === 'led' ? LEDS[it.color] || LEDS.red : PAPER }));
      if (isMeter(it)) body.push(el('text', { x: 0, y: 0, dy: '0.36em', 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 700, fill: INK, stroke: 'none' }, [it.type === 'ammeter' ? 'A' : 'V']));
    }
    return el('svg', { xmlns: SVGNS, viewBox: '-28 -25 56 44', class: 'ckt-pal__icon', 'aria-hidden': 'true', focusable: 'false' },
      [el('g', { stroke: INK, 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, body)]);
  }

  // the build in words: "B1 6 V, R1 4 Ω, L1 and 5 wires; S1 closed"
  function buildWords(parts, t, fill) {
    const comps = parts.filter((p) => p.type !== 'wire');
    const wires = parts.length - comps.length;
    const bits = comps.map((p) => (C.hasValue(p.type) ? `${nameOf(p)} ${fmt(p.type, p.value)}` : nameOf(p)));
    if (wires) bits.push(wires === 1 ? t('1 wire') : fill('{n} wires', { n: wires }));
    let s = bits.length ? andList(bits) : t('Nothing built');
    const closed = comps.filter((p) => p.type === 'switch' && p.closed).map(nameOf);
    const open = comps.filter((p) => p.type === 'switch' && !p.closed).map(nameOf);
    if (closed.length) s += '; ' + fill('{parts} closed', { parts: andList(closed) });
    if (open.length) s += '; ' + fill('{parts} open', { parts: andList(open) });
    return s;
  }
  // the palette in words, for a still picture: "To place: 2 × Bulb 6 Ω and 8 × Wire"
  function paletteWords(spec) {
    const pool = C.pools(spec);
    const bits = pool.groups.map((g) => `${g.ids.length} × ${typeName(g.type, T)}${g.values ? ' ' + itemValue(g) : g.type === 'led' ? ' (' + colorWord(g.color, T) + ')' : ''}`);
    if (pool.wires) bits.push(`${pool.wires} × ${T('Wire')}`);
    return bits.length ? F('To place: {parts}', { parts: andList(bits) }) : '';
  }

  // what a learner's failed build is missing, kindly (check's note)
  function buildNote(why, find, goal) {
    if (!why) return '';
    const n = (id) => nameOf(find(id)) || id;
    if (why.short) return T('That makes a short circuit.');
    if (why.missing) return F('{name} isn’t in your circuit yet.', { name: n(why.missing) });
    if (why.lamp) return F(why.want ? '{name} isn’t lit.' : '{name} is lit, but it shouldn’t be.', { name: n(why.lamp) });
    if (why.burn) return F('{name} would burn out: put a resistor in series with it.', { name: n(why.burn) });
    if (why.order) return F('{a} should be brighter than {b}.', { a: n(why.order[0]), b: n(why.order[1]) });
    if (why.equal) return F('{a} and {b} aren’t equally bright.', { a: n(why.equal[0]), b: n(why.equal[1]) });
    if (why.nocurrent) return F('No current flows through {name}: make a complete loop through it.', { name: n(why.nocurrent) });
    if (why.series) return why.par ? F('{a} and {b} are in parallel: each has its own branch. For series, put them one after the other in a single loop.', { a: n(why.series[0]), b: n(why.series[1]) })
      : F('{a} and {b} aren’t in series: in series, the same current goes through one and then the other.', { a: n(why.series[0]), b: n(why.series[1]) });
    if (why.parallel) return why.ser ? F('{a} and {b} are in series: a break in one turns off both. For parallel, give each its own branch between the same two points.', { a: n(why.parallel[0]), b: n(why.parallel[1]) })
      : F('{a} and {b} aren’t in parallel: each needs its own branch, joined to the same two points.', { a: n(why.parallel[0]), b: n(why.parallel[1]) });
    if (why.misplaced) {
      const p = find(why.misplaced);
      return p && p.type === 'ammeter' ? F('{name} is in parallel: an ammeter goes in series, in the loop.', { name: n(why.misplaced) })
        : F('{name} is in series: a voltmeter goes across a part, in parallel.', { name: n(why.misplaced) });
    }
    if (why.meter) { const p = find(why.meter); return F('{name} reads {value}.', { name: n(why.meter), value: fmt(p ? p.type : 'ammeter', why.got || 0) }); }
    if (why.across) return F('{meter} isn’t across {part}: join its two ends to the two ends of {part}.', { meter: n(why.across[0]), part: n(why.across[1]) });
    if (why.through) return F('{meter} isn’t in series with {part}: the current through {part} must go through {meter} too.', { meter: n(why.through[0]), part: n(why.through[1]) });
    if (why.ctl === 'on') return F('With {switch} closed, {name} isn’t lit.', { switch: n(goal.switch), name: n(why.lamp) });
    if (why.ctl === 'off') return F('{switch} doesn’t turn {name} off.', { switch: n(goal.switch), name: n(why.lamp) });
    if (why.ctl === 'other') return F('{switch} turns {name} on and off too.', { switch: n(goal.switch), name: n(why.lamp) });
    if (why.ctl === 'dark') return F('{name} should stay lit.', { name: n(why.lamp) });
    return '';
  }

  function buildAnswer(t) {
    const g = t.goal, spec = t.spec;
    const parts = C.readBuild(spec, { parts: g.answer || [] }, false) || [];
    const find = (id) => parts.find((p) => p.id === id) || { id };
    const n = (id) => nameOf(find(id));
    const list = (ids) => andList(ids.map(n));
    switch (g.type) {
      case 'lit':
        if (g.order) return F('Light {parts}, with {first} the brightest: {build}', { parts: list(g.on), first: n(g.order[0]), build: buildWords(parts, T, F) });
        if (g.equal) return F('Light {parts}, all equally bright: {build}', { parts: list(g.on), build: buildWords(parts, T, F) });
        return F('Light {parts}: {build}', { parts: list(g.on), build: buildWords(parts, T, F) });
      case 'series': return F('{parts} one after another in a single loop with the cell.', { parts: list(g.parts) });
      case 'parallel': return F('{parts}, each in its own branch across the same two points.', { parts: list(g.parts) });
      case 'reading': return F('{name} reads {value} with {build}', { name: n(g.meter), value: fmt(find(g.meter).type || 'ammeter', g.value), build: buildWords(parts, T, F) });
      case 'equivalent': {
        const sp = C.seriesParallel(spec, parts, g.between[0], g.between[1]);
        return sp ? F('Between {a} and {b}: {sum} = {value}.', { a: g.between[0], b: g.between[1], sum: sp.text, value: fmt('resistor', sp.ohms) })
          : F('{value} between {a} and {b}, with {build}', { a: g.between[0], b: g.between[1], value: fmt('resistor', g.value), build: buildWords(parts, T, F) });
      }
      case 'measure':
        return find(g.meter).type === 'voltmeter' ? F('{meter} across {part}: its two ends on the two ends of {part}.', { meter: n(g.meter), part: n(g.part) })
          : F('{meter} in series with {part}, in the same loop.', { meter: n(g.meter), part: n(g.part) });
      case 'control': {
        const lamps = parts.filter((p) => p.type === 'bulb' || p.type === 'led');
        return g.on.length >= lamps.length ? F('{switch} in the main line, where all the current flows.', { switch: n(g.switch) })
          : F('{switch} in series with {parts} only, in their own branch.', { switch: n(g.switch), parts: list(g.on) });
      }
      default: return buildWords(parts, T, F);
    }
  }

  // a still picture of the board as it starts (the book): the dots, the parts placed, what there is to place
  function buildStill(spec) {
    const box = boardBox(spec);
    const parts = C.startBuild(spec);
    const res = C.solveBuild(spec, parts);
    const d = drawing(res.sol, null, res, { live: false, fixed: box, build: true });
    const words = paletteWords(spec);
    const x0 = d.lay.vb[0] - 14, y0 = d.lay.vb[1] - 14, w = d.lay.vb[2] + 28, h0 = d.lay.vb[3] + 28; // a little more room: nothing is cut off on paper
    const h = h0 + (words ? 30 : 0);
    const kids = [gridTree(spec)].concat(d.svg.kids, [marksTree(spec)]);
    if (words) kids.push(el('text', { x: r1(x0 + w / 2), y: r1(y0 + h0 + 14), 'text-anchor': 'middle', 'font-size': 15, fill: SOFT, 'font-style': 'italic' }, [words]));
    return el('svg', {
      xmlns: SVGNS, viewBox: [x0, y0, w, h].join(' '), width: w, height: h, role: 'img', 'aria-label': T('Circuit to build'),
      'font-family': 'Georgia, \'Times New Roman\', serif', style: 'font-variant-numeric:lining-nums', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }, kids);
  }

  function mountBuild(host, spec, goal, ctx, mode) {
    const t = ctx.t || T;
    const fill = ctx.fill || F;
    const reduce = Boolean(ctx.reduce);
    const isTask = mode === 'task';
    const box = boardBox(spec);
    const W = spec.grid[0], H = spec.grid[1];
    const start = C.startBuild(spec);
    const pool = C.pools(spec);
    const specById = new Map(spec.parts.map((p) => [p.id, p]));
    let build = start.map(copyB);
    let history = [];
    let sel = null;            // the chosen part's id
    let act = null;            // placing: { item, first }
    let hover = null;          // where it would go: { a, b } a gap, or { p } a dot
    let drag = null;           // { k: 'move', id, d } a part being moved, { k: 'pal', item, span } one from the palette
    let down = null;           // the pointer, while pressed on the board
    let cursor = [0, 0], focused = false, kbd = false;
    let touched = false, locked = false, destroyed = false, zoomed = false, suppress = false, palUndo = null, warnTimer = 0;
    let res = null, lay = null, refs = {};
    let wireN = 0;

    const mk = (tag, cls, attrs, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
      if (text != null) n.textContent = text;
      return n;
    };
    const button = (cls, text, onClick, attrs) => { const b = mk('button', cls, Object.assign({ type: 'button' }, attrs || {}), text); b.addEventListener('click', onClick); return b; };
    const partOf = (id) => build.find((p) => p.id === id) || null;
    const nm = (id) => nameOf(partOf(id) || specById.get(id) || { id });

    const root = mk('div', 'ckt ckt--build' + (isTask ? ' ckt--task' : ''), { 'data-no-i18n': '' });

    // the palette: the wire first, then the parts
    const items = (pool.wires ? [{ type: 'wire' }] : []).concat(pool.groups);
    const pal = mk('div', 'ckt-pal', { role: 'group', 'aria-label': t('Parts to place') });
    items.forEach((it) => {
      const b = mk('button', 'ckt-pal__item', { type: 'button', 'aria-pressed': 'false' });
      b.appendChild(toDom(iconTree(it), {}));
      const txtBox = mk('span', 'ckt-pal__text');
      txtBox.appendChild(mk('span', 'ckt-pal__name', null, it.label || typeName(it.type, t)));
      const v = it.type === 'led' ? colorWord(it.color, t) : itemValue(it);
      if (v) txtBox.appendChild(mk('span', 'ckt-pal__val', null, v));
      const count = mk('span', 'ckt-pal__n');
      b.append(txtBox, count);
      b.addEventListener('click', (e) => palClick(e, it));
      b.addEventListener('pointerdown', (e) => palDown(e, it, b));
      it.btn = b;
      it.count = count;
      pal.appendChild(b);
    });
    root.appendChild(pal);

    // the tools
    const bar = mk('div', 'ckt-bar', { role: 'group', 'aria-label': t('Tools') });
    const bRotate = button('ckt-btn', t('Rotate'), () => rotate(), { 'aria-keyshortcuts': 'R' });
    const bFlip = button('ckt-btn', t('Flip'), () => flip(), { 'aria-keyshortcuts': 'F' });
    const bSwitch = button('ckt-btn', t('Close switch'), () => { if (sel) toggle(sel); }, { 'aria-keyshortcuts': 'T' });
    const valSel = mk('select', 'ckt-valsel', { 'aria-label': t('Value') });
    const bDelete = button('ckt-btn', t('Delete'), () => removeSel(), { 'aria-keyshortcuts': 'Delete' });
    const bUndo = button('ckt-btn', t('Undo'), () => undo(), { 'aria-keyshortcuts': 'Control+Z' });
    const bReset = isTask ? null : button('ckt-btn', t('Start again'), () => resetAll());
    const bZoom = button('ckt-btn', t('Zoom'), () => toggleZoom(), { 'aria-pressed': 'false' });
    [bRotate, bFlip, bSwitch, valSel, bDelete, bUndo, bReset, bZoom].forEach((b) => { if (b) bar.appendChild(b); });
    valSel.addEventListener('change', () => {
      const p = partOf(sel);
      if (locked || !p || !p.values) return;
      snapshot();
      p.value = Number(valSel.value);
      changed();
    });
    root.appendChild(bar);

    // the board
    const stage = mk('div', 'ckt-stage ckt-stage--build');
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'ckt-svg ckt-board');
    svg.setAttribute('viewBox', box.vb.join(' '));
    svg.setAttribute('role', 'application');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-roledescription', t('circuit board'));
    svg.setAttribute('aria-label', t('Circuit board. Arrow keys move between dots; Enter places a part or chooses one; R rotates, F flips, T opens or closes a switch, Delete removes, Escape cancels.'));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.maxWidth = Math.round(box.vb[2] * 1.2) + 'px';
    const layer = (cls) => { const g = document.createElementNS(SVGNS, 'g'); g.setAttribute('class', cls); svg.appendChild(g); return g; };
    const gGrid = layer('ckt-gridl'), gCircuit = layer('ckt-circuit'), gMarks = layer('ckt-marksl'), gOver = layer('ckt-over');
    gGrid.appendChild(toDom(gridTree(spec), {}));
    gMarks.appendChild(toDom(marksTree(spec), {}));
    stage.appendChild(svg);
    root.appendChild(stage);

    const status = mk('p', 'ckt-status', { role: 'status' });
    status.hidden = true;
    const chipBox = mk('div', 'ckt-meters');
    const hint = mk('p', 'ckt-hint');
    const say = mk('p', 'sr-only', { 'aria-live': 'polite' });
    root.append(status, chipBox, hint, say);

    host.textContent = '';
    host.appendChild(root);

    const flows = flowEngine(reduce);
    flows.watch(svg);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => {
      const w = svg.getBoundingClientRect().width;
      if (!w) return;
      svg.style.setProperty('--ckt-fs', String(Math.max(15, Math.min(22, 12.5 / (w / (lay ? lay.vb[2] : box.vb[2]))))));
    }) : null;
    if (ro) ro.observe(svg);

    /* how many are left, and what's next */
    const left = (it) => (it.type === 'wire'
      ? pool.wires - build.filter((p) => p.type === 'wire' && !p.locked).length
      : it.ids.filter((id) => !build.some((p) => p.id === id)).length);
    const nextId = (it) => it.ids.find((id) => !build.some((p) => p.id === id)) || null;
    const newWireId = () => { let id; do { id = '~n' + (++wireN); } while (build.some((p) => p.id === id)); return id; };
    const touches = (p, pt) => samePt(p.from, pt) || samePt(p.to, pt) || (p.type === 'wire' && C.along(p.from, p.to).some((q) => samePt(q, pt)));
    const px = (p) => [p[0] * BU, p[1] * BU];
    const pathOf = (p) => (p.type === 'wire' || !lay || !lay.items[p.id] ? [px(p.from), px(p.to)] : lay.items[p.id].path);

    function snapshot() { history.push(JSON.stringify(build)); if (history.length > 60) history.shift(); }
    const emit = () => { try { if (ctx.onChange) ctx.onChange(value()); } catch (err) { /* the page's own handler */ } };
    function changed() { touched = true; render(); emit(); }

    /* drawing */
    function render() {
      res = C.solveBuild(spec, build);
      const d = drawing(res.sol, null, res, { live: true, fixed: box, build: true, state: { s: {}, v: {} } });
      lay = d.lay;
      svg.setAttribute('viewBox', lay.vb.join(' '));
      refs = {};
      while (gCircuit.firstChild) gCircuit.removeChild(gCircuit.firstChild);
      d.svg.kids.forEach((k) => { if (k) gCircuit.appendChild(toDom(k, refs)); });
      flows.set(refs.flow, flowList(res.sol, lay, res, null));
      paintLive();
      drawOver();
      refreshUI();
    }

    let sayTimer = 0;
    const announce = (s) => { if (s) say.textContent = s; };
    function paintLive() {
      let msg = '', bad = false;
      if (res.short) { msg = t('Short circuit! Nothing in the way slows the current, so it would be dangerously large.'); bad = true; }
      else if (res.burn.length) { msg = fill('{name} has too much current: a real LED would burn out. A resistor in series keeps it safe.', { name: nm(res.burn[0]) }); bad = true; }
      else if (res.misplaced.length) {
        const m = res.misplaced[0];
        msg = m.type === 'voltmeter'
          ? fill('{name} is in series: a voltmeter has a very high resistance, so it stops the current and reads nearly the whole supply. Connect it across a part instead.', { name: nm(m.id) })
          : m.across ? fill('{name} is across {part}: an ammeter has almost no resistance, so the current goes through it instead of {part}. Put it in series, in the loop.', { name: nm(m.id), part: nm(m.across) })
            : fill('{name} is in parallel: an ammeter has almost no resistance, so it takes the current from what it is across. Put it in series, in the loop.', { name: nm(m.id) });
      } else if (res.open) msg = t('Open circuit: there is a gap or an open switch, so no current flows. Make a complete loop from + back to −.');
      status.textContent = msg;
      status.hidden = !msg;
      status.classList.toggle('is-short', bad);
      // the readings
      while (chipBox.firstChild) chipBox.removeChild(chipBox.firstChild);
      const chip = (name, val) => {
        const c = mk('span', 'ckt-chip');
        const b = mk('b', null, null, name);
        c.append(b, ' ', mk('span', null, null, val));
        chipBox.appendChild(c);
      };
      build.filter(isMeter).forEach((p) => chip(nameOf(p), res.short ? DASH : fmt(p.type, res.read[p.id] || 0)));
      if (res.total != null) chip(t('Total current'), res.short ? DASH : fmt('ammeter', res.total));
      if (spec.resistance) chip(fill('Resistance {a}–{b}', { a: spec.resistance[0], b: spec.resistance[1] }), res.ohms === Infinity ? '∞' : fmt('resistor', res.ohms));
      chipBox.hidden = !chipBox.childNodes.length;
      // for screen readers, once things settle
      clearTimeout(sayTimer);
      sayTimer = setTimeout(() => {
        if (destroyed) return;
        if (res.short) { say.textContent = msg; return; }
        const bits = [];
        build.forEach((p) => {
          if (p.type === 'bulb' || p.type === 'led') bits.push(fill(res.lit[p.id] ? '{name} is lit' : '{name} is off', { name: nameOf(p) }));
          if (isMeter(p)) bits.push(fill('{name} reads {value}', { name: nameOf(p), value: fmt(p.type, res.read[p.id] || 0) }));
        });
        say.textContent = bits.join('. ') + (bits.length ? '.' : '') + (msg ? ' ' + msg : '');
      }, 900);
    }

    // hit areas for the parts, the chosen part, where a part would go, the dot picked first, the keyboard's dot
    function drawOver() {
      while (gOver.firstChild) gOver.removeChild(gOver.firstChild);
      const kids = [];
      const ordered = build.filter((p) => p.type === 'wire').concat(build.filter((p) => p.type !== 'wire'));
      ordered.forEach((p) => kids.push(el('polyline', { points: pts(pathOf(p)), class: 'ckt-hitp' + (p.locked ? ' is-fixed' : ''), 'data-part': p.id, fill: 'none', stroke: 'transparent', 'stroke-width': p.type === 'wire' ? 18 : 30, 'pointer-events': 'stroke' })));
      const p = partOf(sel);
      if (p && !(drag && drag.k === 'move')) {
        kids.push(el('polyline', { points: pts(pathOf(p)), class: 'ckt-sel', fill: 'none', stroke: GOLD, 'stroke-width': 9, 'stroke-opacity': 0.32, 'pointer-events': 'none' }));
        [p.from, p.to].forEach((q) => kids.push(el('circle', { cx: q[0] * BU, cy: q[1] * BU, r: 6, fill: GOLD, stroke: 'none', 'pointer-events': 'none' })));
      }
      // a ghost: a part being moved, dragged in, or about to be placed
      let ghost = null;
      if (drag && drag.k === 'move') {
        const q = partOf(drag.id);
        if (q) {
          const c = Object.assign({}, q, { from: [q.from[0] + drag.d[0], q.from[1] + drag.d[1]], to: [q.to[0] + drag.d[0], q.to[1] + drag.d[1]] });
          ghost = { a: c.from, b: c.to, ok: !C.placeWhy(spec, build, c, q.id) };
        }
      } else if (drag && drag.k === 'pal' && drag.span) ghost = { a: drag.span.a, b: drag.span.b, ok: !why(drag.item, drag.span.a, drag.span.b) };
      else if (act && act.first && hover) {
        const b = hover.p || hover.b;
        if (b && !samePt(b, act.first)) ghost = { a: act.first, b, ok: !why(act.item, act.first, b) };
      } else if (act && hover && hover.a) ghost = { a: hover.a, b: hover.b, ok: !why(act.item, hover.a, hover.b) };
      if (ghost) {
        const route = ghost.ok && act && act.item.type === 'wire' ? C.wireRoute(spec, build, ghost.a, ghost.b) : null;
        const line = route ? [px(route[0][0])].concat(route.map((s) => px(s[1]))) : [px(ghost.a), px(ghost.b)];
        kids.push(el('polyline', { points: pts(line), class: 'ckt-ghost', fill: 'none', stroke: ghost.ok ? GOLD : RED, 'stroke-width': 4, 'stroke-dasharray': '7 6', 'stroke-opacity': 0.85, 'pointer-events': 'none' }));
        [ghost.a, ghost.b].forEach((q) => kids.push(el('circle', { cx: q[0] * BU, cy: q[1] * BU, r: 6, fill: 'none', stroke: ghost.ok ? GOLD : RED, 'stroke-width': 2.4, 'pointer-events': 'none' })));
      }
      if (act && act.first) kids.push(el('circle', { cx: act.first[0] * BU, cy: act.first[1] * BU, r: 9, fill: GOLD, 'fill-opacity': 0.35, stroke: GOLD, 'stroke-width': 2.4, 'pointer-events': 'none', class: 'ckt-first' }));
      if (focused && kbd) kids.push(el('circle', { cx: cursor[0] * BU, cy: cursor[1] * BU, r: 13, fill: 'none', stroke: '#d6a554', 'stroke-width': 3, 'pointer-events': 'none', class: 'ckt-cursor' }));
      kids.forEach((k) => gOver.appendChild(toDom(k, {})));
    }
    // why an item can't go from a to b ('' when it can)
    function why(it, a, b) {
      if (it.type === 'wire') return C.wireRoute(spec, build, a, b) ? '' : C.placeWhy(spec, build, { type: 'wire', from: a, to: a[0] === b[0] || a[1] === b[1] ? b : [b[0], a[1]] }) || 'covered';
      return C.placeWhy(spec, build, { id: '?', type: it.type, from: a, to: b });
    }

    function refreshUI() {
      items.forEach((it) => {
        const n = left(it);
        it.count.textContent = '×' + Math.max(0, n);
        it.btn.disabled = locked || n <= 0;
        it.btn.setAttribute('aria-pressed', act && act.item === it ? 'true' : 'false');
        it.btn.setAttribute('aria-label', fill('{part}: {n} left', { part: (it.label || typeName(it.type, t)) + (it.values ? ' ' + itemValue(it) : it.type === 'led' ? ' ' + colorWord(it.color, t) : ''), n: Math.max(0, n) }));
      });
      const p = partOf(sel);
      const movable = Boolean(p && !p.locked && !locked);
      bRotate.disabled = !movable;
      bFlip.disabled = !(movable && ['cell', 'battery', 'led'].includes(p.type));
      bDelete.disabled = !movable;
      bUndo.disabled = locked || !history.length;
      if (bReset) bReset.disabled = locked;
      bZoom.disabled = false;
      bSwitch.hidden = !(p && p.type === 'switch');
      if (p && p.type === 'switch') { bSwitch.textContent = p.closed ? t('Open switch') : t('Close switch'); bSwitch.disabled = locked; }
      const choices = p && p.values && p.values.length > 1 ? p.values : null;
      valSel.hidden = !choices;
      if (choices) {
        if (valSel.getAttribute('data-for') !== p.id || valSel.options.length !== choices.length) {
          while (valSel.firstChild) valSel.removeChild(valSel.firstChild);
          choices.forEach((v) => { const o = document.createElement('option'); o.value = String(v); o.textContent = fmt(p.type, v); valSel.appendChild(o); });
          valSel.setAttribute('data-for', p.id);
        }
        valSel.value = String(p.value);
        valSel.disabled = locked;
      }
      svg.classList.toggle('is-placing', Boolean(act));
      svg.classList.toggle('is-active', Boolean(act || sel));
    }

    let warned = false;
    function setHint(text, warn) {
      clearTimeout(warnTimer);
      warned = Boolean(warn);
      hint.classList.toggle('is-warn', warned);
      if (text) { hint.textContent = text; if (warn) { announce(text); warnTimer = setTimeout(() => { if (!destroyed) setHint(); }, 4000); } return; }
      const p = partOf(sel);
      hint.textContent = locked ? ''
        : act ? (act.first ? t('Now tap the second dot.') : act.item.type === 'wire' ? t('Wire: tap two dots to join them (it can turn one corner). Tap Wire again when you are done.')
          : fill('{part}: tap the gap between two dots, or tap two dots.', { part: act.item.label || typeName(act.item.type, t) }))
          : p ? (p.locked ? (p.type === 'switch' ? fill('{name} is fixed in place: tap it to open or close it.', { name: nameOf(p) }) : fill('{name} is fixed in place.', { name: nameOf(p) }))
            : fill('{name} chosen: drag it to move it, or use the buttons above.', { name: nameOf(p) }))
            : build.some((q) => !q.locked) ? t('Tap a part to choose it; tap a switch to open or close it.')
              : t('Choose a part, then tap the gap between two dots to place it.');
    }

    /* acting on the board */
    function startPlacing(it) { act = { item: it, first: null }; sel = null; hover = null; refreshUI(); drawOver(); setHint(); }
    function stopPlacing() { act = null; hover = null; refreshUI(); drawOver(); setHint(); }
    function choose(id, tapped) {
      const p = partOf(id);
      if (!p) return;
      sel = id;
      if (tapped && p.type === 'switch') { toggle(id); return; }
      refreshUI(); drawOver(); setHint();
      announce(fill('{name} chosen.', { name: nameOf(p) }));
    }
    function toggle(id) {
      const p = partOf(id);
      if (locked || !p || p.type !== 'switch') return;
      snapshot();
      p.closed = !p.closed;
      touched = true;
      sel = id;
      res = C.solveBuild(spec, build);
      // in place: the arm swings, the glows fade
      const short = res.short ? new Set([...res.short.cells, ...res.short.path]) : new Set();
      res.sol.parts.forEach((q) => paintPart(refs, q, res, short, Boolean(q.closed), q.value, fill));
      flows.set(refs.flow, flowList(res.sol, lay, res, null));
      paintLive(); drawOver(); refreshUI(); setHint();
      announce(fill(p.closed ? '{name} closed.' : '{name} opened.', { name: nameOf(p) }));
      emit();
    }
    function pickDot(pt) {
      if (!act.first) { act.first = pt; hover = null; setHint(); drawOver(); return; }
      if (samePt(act.first, pt)) { act.first = null; setHint(); drawOver(); return; }
      const a = act.first;
      act.first = null;
      placeSpan(a, pt);
    }
    function placeSpan(a, b) {
      const it = act.item;
      if (it.type === 'wire') {
        const segs = C.wireRoute(spec, build, a, b);
        if (!segs) { setHint(placeWords(why(it, a, b), t), true); drawOver(); return; }
        if (segs.length > left(it)) { setHint(t('There are no wires left.'), true); drawOver(); return; }
        snapshot();
        segs.forEach(([p, q]) => build.push({ id: newWireId(), type: 'wire', from: p.slice(), to: q.slice(), locked: false }));
        hover = null;
        if (left(it) <= 0) act = null;
        changed();
        setHint();
        announce(t('Wire placed.'));
        return;
      }
      const id = nextId(it);
      if (!id) { stopPlacing(); setHint(t('There are none of those left.'), true); return; }
      const part = { id, type: it.type, from: a.slice(), to: b.slice(), locked: false };
      if (it.values) { part.value = it.values[0]; if (it.values.length > 1) part.values = it.values.slice(); }
      if (it.type === 'switch') part.closed = false;
      if (it.type === 'led') part.color = it.color || 'red';
      if (it.label) part.label = it.label;
      const no = C.placeWhy(spec, build, part);
      if (no) { setHint(placeWords(no, t), true); drawOver(); return; }
      snapshot();
      build.push(part);
      act = null; hover = null; sel = id;
      changed();
      setHint();
      announce(fill('{name} placed.', { name: nameOf(part) }));
    }
    function moveBy(id, d) {
      const p = partOf(id);
      if (locked || !p || p.locked) return;
      if (!d[0] && !d[1]) { choose(id, false); return; }
      const c = Object.assign({}, p, { from: [p.from[0] + d[0], p.from[1] + d[1]], to: [p.to[0] + d[0], p.to[1] + d[1]] });
      const no = C.placeWhy(spec, build, c, p.id);
      if (no) { setHint(placeWords(no, t), true); drawOver(); return; }
      snapshot();
      p.from = c.from; p.to = c.to;
      sel = id;
      changed();
      setHint();
    }
    function rotate() {
      const p = partOf(sel);
      if (locked || !p || p.locked) return;
      let r = [p.to[0] - p.from[0], p.to[1] - p.from[1]];
      for (let k = 0; k < 3; k++) {
        r = [-r[1], r[0]];
        const to = [p.from[0] + r[0], p.from[1] + r[1]];
        if (!C.placeWhy(spec, build, Object.assign({}, p, { to }), p.id)) { snapshot(); p.to = to; changed(); setHint(); return; }
      }
      setHint(t('There is no room to turn it here.'), true);
    }
    function flip() {
      const p = partOf(sel);
      if (locked || !p || p.locked) return;
      snapshot();
      const f = p.from; p.from = p.to; p.to = f;
      changed();
      announce(fill('{name} turned round.', { name: nameOf(p) }));
    }
    function removeSel() {
      const p = partOf(sel);
      if (locked || !p || p.locked) return;
      snapshot();
      build = build.filter((q) => q !== p);
      sel = null;
      changed();
      setHint();
      announce(fill('{name} removed.', { name: nameOf(p) }));
    }
    function undo() {
      if (locked || !history.length) return;
      build = JSON.parse(history.pop());
      if (!partOf(sel)) sel = null;
      act = null; hover = null;
      changed();
      setHint();
    }
    function resetAll() {
      if (locked) return;
      if (touched) snapshot();
      build = start.map(copyB);
      sel = null; act = null; hover = null;
      render();
      touched = false;
      emit();
      setHint();
    }
    function toggleZoom() {
      zoomed = !zoomed;
      stage.classList.toggle('is-zoomed', zoomed);
      bZoom.setAttribute('aria-pressed', zoomed ? 'true' : 'false');
    }

    /* the pointer on the board */
    function toUser(ev) {
      const m = svg.getScreenCTM();
      if (!m) return null;
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const q = pt.matrixTransform(m.inverse());
      return [q.x / BU, q.y / BU];
    }
    // a dot near the point, or the gap between two dots (edges: the nearest gap, for a drag)
    function spotAt(g, edges) {
      if (!g) return null;
      const inGrid = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H;
      const rx = Math.round(g[0]), ry = Math.round(g[1]);
      if (!edges && inGrid(rx, ry) && Math.hypot(g[0] - rx, g[1] - ry) <= 0.3) return { p: [rx, ry] };
      const reach = edges ? 0.55 : 0.32;
      const fx = Math.floor(g[0]), fy = Math.floor(g[1]);
      let best = null;
      if (inGrid(fx, ry) && inGrid(fx + 1, ry)) { const d = Math.abs(g[1] - ry); if (d <= reach) best = { a: [fx, ry], b: [fx + 1, ry], d }; }
      if (inGrid(rx, fy) && inGrid(rx, fy + 1)) { const d = Math.abs(g[0] - rx); if (d <= reach && (!best || d < best.d)) best = { a: [rx, fy], b: [rx, fy + 1], d }; }
      return best;
    }
    function onDown(e) {
      if (locked || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const hit = e.target && e.target.closest ? e.target.closest('[data-part]') : null;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, g: toUser(e), part: hit ? hit.getAttribute('data-part') : null, moved: false };
      const p = down.part ? partOf(down.part) : null;
      if (p && !p.locked && !act) { try { svg.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ } }
    }
    function onMove(e) {
      if (down && e.pointerId === down.id) {
        if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) down.moved = true;
        const p = down.moved && down.part && !act ? partOf(down.part) : null;
        if (p && !p.locked && down.g) {
          const g = toUser(e);
          if (!g) return;
          drag = { k: 'move', id: p.id, d: [Math.round(g[0] - down.g[0]), Math.round(g[1] - down.g[1])] };
          sel = p.id;
          drawOver();
          if (e.cancelable) e.preventDefault();
        }
        return;
      }
      if (act && e.pointerType === 'mouse') { hover = spotAt(toUser(e)); drawOver(); }
    }
    function onUp(e) {
      if (!down || e.pointerId !== down.id) return;
      const d0 = down;
      down = null;
      if (drag && drag.k === 'move') { const m = drag; drag = null; moveBy(m.id, m.d); return; }
      if (d0.moved) return;
      kbd = false;
      tap(d0.g, d0.part);
    }
    function onCancel(e) { if (down && e.pointerId === down.id) { down = null; if (drag) { drag = null; drawOver(); } } }
    function onLeave() { if (hover && !down) { hover = null; drawOver(); } }
    function tap(g, partId) {
      if (locked) return;
      if (act) {
        const s = spotAt(g);
        if (!s) return;
        if (s.p) pickDot(s.p); else placeSpan(s.a, s.b);
        return;
      }
      if (partId) { choose(partId, true); return; }
      if (sel) { sel = null; refreshUI(); drawOver(); setHint(); }
    }
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onCancel);
    svg.addEventListener('pointerleave', onLeave);

    /* the palette */
    function palClick(e, it) {
      if (suppress) { suppress = false; return; }
      if (locked) return;
      if (act && act.item === it) { stopPlacing(); return; }
      if (left(it) <= 0) return;
      startPlacing(it);
      if (e.detail === 0) { kbd = true; svg.focus(); drawOver(); } // from the keyboard: on to the board
    }
    // dragged from the palette onto a gap between two dots
    function palDown(e, it, b) {
      if (locked || left(it) <= 0 || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const st = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ }
      const over = (ev) => { const r = svg.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; };
      const move = (ev) => {
        if (ev.pointerId !== st.id) return;
        if (!st.moved && Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > 8) st.moved = true;
        if (!st.moved) return;
        drag = { k: 'pal', item: it, span: over(ev) ? spotAt(toUser(ev), true) : null };
        drawOver();
      };
      const up = (ev) => {
        if (ev.pointerId !== st.id) return;
        done();
        if (!st.moved) return;
        suppress = true;
        setTimeout(() => { suppress = false; }, 0);
        const span = drag && drag.span;
        drag = null;
        if (!span) { drawOver(); return; }
        act = { item: it, first: null };
        sel = null;
        placeSpan(span.a, span.b);
        if (act && act.item.type !== 'wire') { act = null; refreshUI(); drawOver(); }
      };
      const cancel = (ev) => { if (ev.pointerId !== st.id) return; done(); drag = null; drawOver(); };
      function done() {
        b.removeEventListener('pointermove', move);
        b.removeEventListener('pointerup', up);
        b.removeEventListener('pointercancel', cancel);
        palUndo = null;
      }
      if (palUndo) palUndo();
      b.addEventListener('pointermove', move);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', cancel);
      palUndo = done;
    }

    /* the keyboard */
    const dotWords = (pt) => {
      const here = build.filter((p) => touches(p, pt) && p.type !== 'wire').map(nameOf);
      const wire = build.some((p) => p.type === 'wire' && touches(p, pt));
      const mark = Object.keys(spec.nodes).find((n) => samePt(spec.nodes[n], pt));
      const bits = (mark ? [mark] : []).concat(here, wire ? [t('a wire')] : []);
      return bits.length ? fill('Dot {x}, {y}: {parts}', { x: pt[0], y: pt[1], parts: andList(bits) }) : fill('Dot {x}, {y}', { x: pt[0], y: pt[1] });
    };
    function onKey(e) {
      if (locked) return;
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { undo(); e.preventDefault(); return; }
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      kbd = true;
      if (dirs[k]) {
        e.preventDefault();
        if (e.shiftKey && sel && !act) { moveBy(sel, dirs[k]); return; }
        cursor = [Math.max(0, Math.min(W, cursor[0] + dirs[k][0])), Math.max(0, Math.min(H, cursor[1] + dirs[k][1]))];
        hover = act ? { p: cursor } : null;
        drawOver();
        announce(dotWords(cursor));
        return;
      }
      if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (act) { pickDot(cursor.slice()); return; }
        const here = build.filter((p) => touches(p, cursor));
        if (!here.length) { sel = null; refreshUI(); drawOver(); setHint(); announce(dotWords(cursor)); return; }
        const i = here.findIndex((p) => p.id === sel);
        choose(here[(i + 1) % here.length].id, false);
        return;
      }
      if (k === 'Escape') { if (act) stopPlacing(); else if (sel) { sel = null; refreshUI(); drawOver(); setHint(); } return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'r' || k === 'R') { rotate(); e.preventDefault(); return; }
      if (k === 'f' || k === 'F') { flip(); e.preventDefault(); return; }
      if (k === 't' || k === 'T') { if (sel) toggle(sel); e.preventDefault(); return; }
      if (k === 'Delete' || k === 'Backspace') { removeSel(); e.preventDefault(); }
    }
    const onFocus = () => { focused = true; drawOver(); };
    const onBlur = () => { focused = false; drawOver(); };
    svg.addEventListener('keydown', onKey);
    svg.addEventListener('focus', onFocus);
    svg.addEventListener('blur', onBlur);

    render();
    setHint();

    function value() {
      if (!touched) return null;
      return {
        parts: build.map((p) => {
          const q = { type: p.type, from: p.from.slice(), to: p.to.slice() };
          if (p.type !== 'wire') q.id = p.id;
          if (p.value != null) q.value = p.value;
          if (p.type === 'switch') q.closed = Boolean(p.closed);
          if (p.color) q.color = p.color;
          return q;
        })
      };
    }

    return {
      value,
      reset() { build = start.map(copyB); history = []; sel = null; act = null; hover = null; drag = null; touched = false; render(); setHint(); },
      reveal() {
        const ans = goal && goal.answer ? C.readBuild(spec, { parts: goal.answer }, false) : null;
        if (!ans) return;
        build = ans.map(copyB);
        sel = null; act = null; hover = null; drag = null;
        touched = true;
        render();
        setHint();
      },
      lock(on) {
        locked = Boolean(on);
        root.classList.toggle('is-locked', locked);
        if (locked) { act = null; sel = null; drag = null; hover = null; down = null; }
        [bRotate, bFlip, bSwitch, valSel, bDelete, bUndo, bReset].forEach((b) => { if (b) b.disabled = locked; });
        refreshUI();
        drawOver();
        setHint();
      },
      destroy() {
        destroyed = true;
        flows.destroy();
        clearTimeout(sayTimer);
        clearTimeout(warnTimer);
        if (ro) ro.disconnect();
        if (palUndo) palUndo();
        svg.removeEventListener('pointerdown', onDown);
        svg.removeEventListener('pointermove', onMove);
        svg.removeEventListener('pointerup', onUp);
        svg.removeEventListener('pointercancel', onCancel);
        svg.removeEventListener('pointerleave', onLeave);
        svg.removeEventListener('keydown', onKey);
        svg.removeEventListener('focus', onFocus);
        svg.removeEventListener('blur', onBlur);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  /* ---------------- checked once, kept ---------------- */

  const checked = new WeakMap();   // spec -> goal (or the spec itself, for a block) -> { spec, goal } or null
  function cleanTask(spec, goal) {
    if (!C || !spec || typeof spec !== 'object' || !goal || typeof goal !== 'object') return null;
    let m = checked.get(spec);
    if (!m) { m = new WeakMap(); checked.set(spec, m); }
    if (!m.has(goal)) { let v = null; try { v = C.normTask(spec, goal); } catch (e) { v = null; } m.set(goal, v); }
    return m.get(goal);
  }
  function cleanSpec(spec, loose) {
    if (!C || !spec || typeof spec !== 'object') return null;
    let m = checked.get(spec);
    if (!m) { m = new WeakMap(); checked.set(spec, m); }
    const key = loose ? cleanSpec : checked; // two keys for the two ways of checking it
    if (!m.has(key)) { let v = null; try { v = C.normSpec(spec, loose ? { loose: true } : {}); } catch (e) { v = null; } m.set(key, v); }
    return m.get(key);
  }
  const solutions = new WeakMap();
  function solved(spec, goal) {
    if (!solutions.has(goal)) solutions.set(goal, C.solution(spec, goal));
    return solutions.get(goal);
  }

  // until the solver has loaded (it is usually there first: widgets.js waits for "ready"), a handle that waits
  function later(host, start) {
    let h = null, gone = false;
    const queue = [];
    host.classList.add('is-loading');
    ready.then(() => {
      host.classList.remove('is-loading');
      if (gone) return;
      h = start();
      queue.forEach((fn) => fn(h));
    }).catch((err) => failed(host, err));
    const call = (name) => (...args) => { if (h) return h[name](...args); if (name !== 'value') queue.push((x) => x && x[name](...args)); return null; };
    return { value: () => (h ? h.value() : null), reset: call('reset'), reveal: call('reveal'), lock: call('lock'), destroy() { gone = true; if (h) h.destroy(); } };
  }
  function failed(host, err) {
    host.classList.remove('is-loading');
    host.classList.add('is-failed');
    host.textContent = T('This interactive part couldn’t be shown here.');
    if (err) console.warn('[Primer] circuit:', err.message || err);
  }

  P.widgets.register('circuit', {
    ready, // see above

    block(host, spec, ctx) {
      return later(host, () => {
        const clean = cleanSpec(spec);
        if (!clean) { failed(host, new Error('this circuit does not hold together')); return null; }
        return (clean.build ? mountBuild : mount)(host, clean, null, ctx || {}, 'block');
      });
    },

    task(host, spec, goal, ctx) {
      return later(host, () => {
        const t = cleanTask(spec, goal);
        if (!t) { failed(host, new Error('this circuit task does not hold together')); return null; }
        return (t.spec.build ? mountBuild : mount)(host, t.spec, t.goal, ctx || {}, 'task');
      });
    },

    check(goal, value, spec) {
      const t = cleanTask(spec, goal);
      if (!t) return { correct: false, invalid: true };
      if (t.spec.build) {
        const r = C.check(t.spec, t.goal, value);
        if (r.invalid) return { correct: false, invalid: true, note: T('Build your circuit first, then press Check.') };
        if (r.correct) return { correct: true, note: '' };
        const built = C.readBuild(t.spec, value, false) || [];
        const find = (id) => built.find((p) => p.id === id) || t.spec.parts.find((p) => p.id === id) || { id, type: (C.pools(t.spec).groups.find((g) => g.ids.includes(id)) || {}).type };
        return { correct: false, note: buildNote(r.why, find, t.goal) };
      }
      const r = C.check(t.spec, t.goal, value);
      const why = r.why || {};
      const byId = new Map(t.spec.parts.map((p) => [p.id, p]));
      let note = '';
      if (why.wire) note = T('Join two terminals with a wire first.');
      else if (why.short) note = T('That makes a short circuit.');
      else if (why.lamp) note = F(why.want ? '{name} isn’t lit.' : '{name} is lit, but it shouldn’t be.', { name: nameOf(byId.get(why.lamp)) });
      else if (why.meter) { const p = byId.get(why.meter); note = F('{name} reads {value}.', { name: nameOf(p), value: fmt(p.type, why.got || 0) }); }
      return r.invalid ? { correct: false, invalid: true, note } : { correct: r.correct, note: r.correct ? '' : note };
    },

    describe(value, spec) {
      if (!value || typeof value !== 'object') return '';
      const s = cleanSpec(spec, true);
      if (!s) return '';
      if (s.build) { const built = C.readBuild(s, value, false); return built ? buildWords(built, T, F) : ''; }
      if (Array.isArray(value.w) && value.w.length === 2) return F('A wire from {a} to {b}', { a: String(value.w[0]).slice(0, 8), b: String(value.w[1]).slice(0, 8) });
      const st = C.stateOf(s, value, null);
      const byId = new Map(s.parts.map((p) => [p.id, p]));
      const closed = Object.keys(st.s).filter((k) => st.s[k]).map((k) => nameOf(byId.get(k)));
      const open = Object.keys(st.s).filter((k) => !st.s[k]).map((k) => nameOf(byId.get(k)));
      const bits = [];
      if (closed.length) bits.push(F('{parts} closed', { parts: andList(closed) }));
      if (open.length) bits.push(closed.length ? F('{parts} open', { parts: andList(open) }) : T('All switches open'));
      Object.keys(st.v).forEach((k) => { const p = byId.get(k); bits.push(`${nameOf(p)} = ${fmt(p.type, st.v[k])}`); });
      return bits.join('; ');
    },

    answer(goal, spec) {
      const t = cleanTask(spec, goal);
      if (!t) return '';
      if (t.spec.build) return buildAnswer(t);
      const sol = solved(t.spec, t.goal);
      if (!sol) return '';
      if (sol.w) return F('A wire from {a} to {b}', { a: sol.w[0], b: sol.w[1] });
      const start = C.stateOf(t.spec, null, t.goal);
      const byId = new Map(t.spec.parts.map((p) => [p.id, p]));
      const close = Object.keys(sol.s).filter((k) => sol.s[k] && !start.s[k]).map((k) => nameOf(byId.get(k)));
      const open = Object.keys(sol.s).filter((k) => !sol.s[k] && start.s[k]).map((k) => nameOf(byId.get(k)));
      const bits = [];
      if (close.length) bits.push(F('Close {parts}', { parts: andList(close) }));
      if (open.length) bits.push(F(close.length ? 'open {parts}' : 'Open {parts}', { parts: andList(open) }));
      Object.keys(sol.v).forEach((k) => { if (sol.v[k] !== start.v[k]) { const p = byId.get(k); bits.push(`${nameOf(p)} = ${fmt(p.type, sol.v[k])}`); } });
      return bits.join('; ');
    },

    still(spec, goal) {
      if (!C) return '';
      const t = goal ? cleanTask(spec, goal) : null;
      const s = t ? t.spec : cleanSpec(spec, true);
      if (!s) return '';
      if (s.build) { try { return toStr(buildStill(s)); } catch (e) { return ''; } }
      const g = t ? t.goal : null;
      let res = null;
      try { res = C.solve(s, null, g); } catch (e) { res = null; }
      return toStr(drawing(s, g, res, { live: false }).svg);
    }
  });
})();
