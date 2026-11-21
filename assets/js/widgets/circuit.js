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
  function layout(spec, goal) {
    const pos = {};
    const xs = Object.values(spec.nodes).map((p) => p[0]);
    const u = Math.max(46, Math.min(U, 400 / Math.max(1, Math.max(...xs) - Math.min(...xs))));
    Object.keys(spec.nodes).forEach((n) => { pos[n] = [spec.nodes[n][0] * u, spec.nodes[n][1] * u]; });
    const nodePts = Object.values(pos);
    const mid = nodePts.reduce((s, p) => add(s, p), [0, 0]).map((v) => v / Math.max(1, nodePts.length));
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
        for (const k of [1, -1, 2, -2, 3, -3]) {
          const s = mul(nrm, k * out * SHIFT);
          const a2 = add(A, s), b2 = add(B, s);
          if (!clash(a2, b2, false) && !placed.some(([c, d]) => overlap(A, a2, c, d) || overlap(B, b2, c, d))) {
            path = [A, a2, b2, B]; leg = [a2, b2]; side = k * out > 0 ? 1 : -1;
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
  function drawing(spec, goal, res, opts) {
    const live = Boolean(opts.live);
    const id = 'ckt' + (++uid);
    const lay = layout(spec, goal);
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
      else if ((deg[n] || 0) <= 1) { // a loose end (a connect task, on paper): an open terminal, named
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
    let flows = [];
    let raf = 0, last = 0, onScreen = true;
    function buildFlows(res) {
      const g = refs.flow;
      while (g.firstChild) g.removeChild(g.firstChild);
      const was = new Map(flows.map((f) => [f.key, f.phase])); // dots keep going where they were
      flows = [];
      if (!res || res.short) return;
      const all = spec.parts.map((p) => ({ id: p.id, path: lay.items[p.id].path, wire: p.type === 'wire', it: lay.items[p.id] }));
      if (state.w) all.push({ id: '~+', path: [lay.pos[state.w[0]], lay.pos[state.w[1]]], wire: true });
      for (const a of all) {
        const i = res.I[a.id] || 0;
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
          if (!a.wire) {
            const [l1, l2] = a.it.leads.map(track);
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
    const running = () => !destroyed && onScreen && !document.hidden && flows.length > 0;
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
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); schedule(); }) : null;
    if (io) io.observe(svg);
    const onVis = () => schedule();
    document.addEventListener('visibilitychange', onVis);

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
        const line = refs['line:' + p.id];
        if (line) { line.classList.toggle('is-short', short.has(p.id)); line.setAttribute('stroke', short.has(p.id) ? RED : INK); }
        const sym = refs['sym:' + p.id];
        if (sym) sym.setAttribute('stroke', short.has(p.id) ? RED : INK);
        if (p.type === 'switch' && refs['arm:' + p.id]) {
          const closed = has(state.s, p.id) ? state.s[p.id] : p.closed;
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
        const val = refs['val:' + p.id];
        if (val) {
          val.textContent = C.hasValue(p.type) ? fmt(p.type, has(state.v, p.id) ? state.v[p.id] : p.value)
            : res.short ? DASH : fmt(p.type, res.read[p.id] || 0);
        }
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
        if (raf) cancelAnimationFrame(raf);
        clearTimeout(sayTimer);
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        svg.removeEventListener('click', onClick);
        svg.removeEventListener('keydown', onKey);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  const clone = (st) => ({ s: Object.assign({}, st.s), v: Object.assign({}, st.v), w: st.w ? st.w.slice() : null });

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
        return mount(host, clean, null, ctx || {}, 'block');
      });
    },

    task(host, spec, goal, ctx) {
      return later(host, () => {
        const t = cleanTask(spec, goal);
        if (!t) { failed(host, new Error('this circuit task does not hold together')); return null; }
        return mount(host, t.spec, t.goal, ctx || {}, 'task');
      });
    },

    check(goal, value, spec) {
      const t = cleanTask(spec, goal);
      if (!t) return { correct: false, invalid: true };
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
      const g = t ? t.goal : null;
      let res = null;
      try { res = C.solve(s, null, g); } catch (e) { res = null; }
      return toStr(drawing(s, g, res, { live: false }).svg);
    }
  });
})();
