/* =====================================================================
   The logic gates lab (assets/js/widgets.js): input switches on the
   left, gates in the distinctive shapes school textbooks use (NCERT's
   too: AND a D, OR a curved shield, NOT a triangle with a bubble, NAND
   and NOR with bubbles, XOR with its second curve), ready blocks (half
   adder, full adder, SR latch, D flip-flop), lamps on the right and a
   seven-segment digit. Wires carrying a 1 glow gold; a 0 stays dark ink.
   Beside the board, the truth table: every row, the current one
   highlighted, the target column and mismatches in a task; for a circuit
   that remembers (a latch, a flip-flop), a timing diagram instead.

   - Placing: drag a gate from the palette onto the board, or tap it and
     then tap the board (phones). With the keyboard, the palette button
     places it in the first free slot; arrow keys move a focused gate.
   - Wiring: tap an output (a switch's dot, or a gate), then an input (a
     gate, or one of its pins, or a lamp); or drag from one to the
     other. Each input takes one wire (a new one replaces it); an output
     can feed many. Delete removes the selected gate or wire; Undo.
   - The circuit runs as it changes (assets/js/widgets/logic-core.js,
     shared with the server), so the wires light and the lamps glow.

   As a task: build a circuit for a truth table, fill in a circuit's
   truth table, set the switches to light the lamps, or swap the one
   wrong gate; check() runs the learner's circuit against the goal.
   Every spec is checked again here before it is drawn; its text goes
   into the page as text, never as markup.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;

  /* ---------------- the core, shared with the server ---------------- */

  let L = window.PrimerLogic || null;
  const ready = L ? Promise.resolve(L) : new Promise((resolve, reject) => {
    let s = document.querySelector('script[data-logic-core]');
    if (!s) {
      s = document.createElement('script');
      s.src = '/assets/js/widgets/logic-core.js';
      s.async = true;
      s.setAttribute('data-logic-core', '');
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => { L = window.PrimerLogic || null; if (L) resolve(L); else reject(new Error('the logic core did not load')); });
    s.addEventListener('error', () => reject(new Error('the logic core could not be loaded')));
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
  const chipName = (type, t) => (type === 'HA' ? t('half adder') : type === 'FA' ? t('full adder') : type === 'SR' ? t('SR latch') : t('D flip-flop'));
  const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ---------------- drawing ---------------- */

  const SVGNS = 'http://www.w3.org/2000/svg';
  const INK = '#2b1d11', SOFT = '#5b4730', PAPER = '#fbf4e2', AMBER = '#c27c06', GLOW = '#f6c445', LIT = '#ffd84d', DIM = '#d6c7a1';
  const ON = '#e0a127', OFF = '#cbbb93', SEL = '#b4561c', RED = '#9a3324';
  const SW = 100, SH = 76, TOP = 14, BOT = 14, LM = 16;   // a slot for a gate is SW by SH
  const FONT = 'Arial, Helvetica, sans-serif';

  // a tiny tree of SVG nodes, made into markup (the book) or DOM (the page): text is escaped or set as text
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
  const r1 = (x) => Math.round(x * 10) / 10;
  const text = (x, y, s, attrs) => el('text', Object.assign({ x: r1(x), y: r1(y) }, attrs || {}), [String(s)]);

  // where each pin sits on a gate, from its centre
  const inOffsets = (type, n) => (L.CHIPS[type] ? (n === 3 ? [-16, 0, 16] : [-12, 12]) : n === 1 ? [0] : n === 2 ? [-10, 10] : [-14, 0, 14]);
  const outOffsets = (type) => (L.CHIPS[type] ? [-12, 12] : [0]);
  const halfOf = (type, n) => (L.CHIPS[type] ? (n === 3 ? 27 : 22) : type === 'NOT' ? 13 : n === 3 ? 20 : 16);
  const tipX = (type) => ({ AND: 20, OR: 20, XOR: 20, NAND: 28, NOR: 28, XNOR: 28, NOT: 22 }[type] || 25);
  // where an input's stub meets the gate's back (the back of OR and XOR is curved)
  function backX(type, dy, hh) {
    const t = Math.min(1, Math.max(0, (dy / hh + 1) / 2));
    if (type === 'OR' || type === 'NOR') return -22 + 20 * t * (1 - t) + 1;
    if (type === 'XOR' || type === 'XNOR') return -24 + 20 * t * (1 - t);
    if (type === 'NOT') return -16;
    if (L.CHIPS[type]) return -25;
    return -20;
  }
  function bodyPath(type, hh) {
    switch (type) {
      case 'AND': case 'NAND': return `M-20,${-hh} H${20 - hh} A${hh},${hh} 0 0 1 ${20 - hh},${hh} H-20 Z`;
      case 'OR': case 'NOR': return `M-22,${-hh} Q2,${-hh} 20,0 Q2,${hh} -22,${hh} Q-12,0 -22,${-hh} Z`;
      case 'XOR': case 'XNOR': return `M-18,${-hh} Q4,${-hh} 20,0 Q4,${hh} -18,${hh} Q-8,0 -18,${-hh} Z`;
      default: return 'M-16,-13 L14,0 L-16,13 Z';
    }
  }
  // a small picture of a gate, for the palette
  function iconSvg(type) {
    const kids = [];
    if (L.CHIPS[type]) {
      kids.push(el('rect', { x: -20, y: -14, width: 40, height: 28, rx: 3, fill: PAPER, stroke: INK, 'stroke-width': 2.4 }));
      kids.push(text(0, 4.5, type === 'D' ? 'D' : type, { 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: INK, 'font-family': FONT }));
    } else {
      [-8, 8].slice(type === 'NOT' ? 1 : 0).forEach((dy) => kids.push(el('line', { x1: -30, y1: type === 'NOT' ? 0 : dy, x2: -14, y2: type === 'NOT' ? 0 : dy, stroke: INK, 'stroke-width': 2.4 })));
      kids.push(el('line', { x1: 14, y1: 0, x2: 30, y2: 0, stroke: INK, 'stroke-width': 2.4 }));
      kids.push(el('path', { d: bodyPath(type, 15), fill: PAPER, stroke: INK, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }));
      if (type === 'XOR' || type === 'XNOR') kids.push(el('path', { d: 'M-24,-15 Q-14,0 -24,15', fill: 'none', stroke: INK, 'stroke-width': 2.4 }));
      if (type === 'NAND' || type === 'NOR' || type === 'XNOR') kids.push(el('circle', { cx: 24, cy: 0, r: 4, fill: PAPER, stroke: INK, 'stroke-width': 2.2 }));
      if (type === 'NOT') kids.push(el('circle', { cx: 18, cy: 0, r: 4, fill: PAPER, stroke: INK, 'stroke-width': 2.2 }));
    }
    return toStr(el('svg', { xmlns: SVGNS, viewBox: '-32 -18 64 36', width: 40, height: 22, 'aria-hidden': 'true', focusable: 'false' }, kids));
  }

  /* ---------------- where things go ---------------- */

  // each gate's column: one after the deepest gate that feeds it; the gates of a loop (a latch) share one
  function depthCols(gates) {
    const byId = new Map(gates.map((g) => [g.id, g]));
    const srcG = (r) => (r == null ? null : byId.get(String(r).split('.')[0]) || null);
    let index = 0, nc = 0;
    const idx = {}, low = {}, comp = {}, on = new Set(), stack = [];
    function strong(g) {
      idx[g.id] = low[g.id] = index++;
      stack.push(g); on.add(g.id);
      g.in.forEach((r) => {
        const h = srcG(r);
        if (!h) return;
        if (idx[h.id] == null) { strong(h); low[g.id] = Math.min(low[g.id], low[h.id]); } else if (on.has(h.id)) low[g.id] = Math.min(low[g.id], idx[h.id]);
      });
      if (low[g.id] === idx[g.id]) { let h; do { h = stack.pop(); on.delete(h.id); comp[h.id] = nc; } while (h !== g); nc++; }
    }
    gates.forEach((g) => { if (idx[g.id] == null) strong(g); });
    const dep = {};
    const dc = (k) => {
      if (dep[k] != null) return dep[k];
      dep[k] = 0;
      let m = 0;
      gates.forEach((g) => { if (comp[g.id] === k) g.in.forEach((r) => { const h = srcG(r); if (h && comp[h.id] !== k) m = Math.max(m, dc(comp[h.id]) + 1); }); });
      return (dep[k] = m);
    };
    const out = {};
    gates.forEach((g) => { out[g.id] = dc(comp[g.id]); });
    return out;
  }
  // the board's size (C columns and R rows of slots), and a slot for every gate that has none
  function layout(s, b, opts) {
    opts = opts || {};
    const cols = depthCols(b.gates);
    const ni = s.inputs.length, no = s.outputs.length;
    let C = Math.max(1, ...b.gates.map((g) => (b.pos[g.id] ? b.pos[g.id][0] + 1 : cols[g.id] + 1)));
    const perCol = {};
    b.gates.forEach((g) => { const c = b.pos[g.id] ? b.pos[g.id][0] : cols[g.id]; perCol[c] = (perCol[c] || 0) + 1; });
    let R = Math.max(opts.edit ? 2 : 1, Math.ceil(ni * 36 / SH), Math.ceil(no * 40 / SH), ...Object.values(perCol), ...b.gates.map((g) => (b.pos[g.id] ? b.pos[g.id][1] + 1 : 1)));
    if (opts.edit) {
      // room to build: three columns first (they fit a phone), then more rows, then more columns
      const need = b.gates.length + Math.min(6, opts.room || 0) + 1;
      C = Math.max(C, 2);
      while (C * R < need && C < 3) C++;
      while (C * R < need && R < 4) R++;
      while (C * R < need && C < 5) C++;
      while (C * R < need && R < 6) R++;
    }
    if (opts.C) C = Math.max(C, opts.C);
    if (opts.R) R = Math.max(R, opts.R);
    // rows: near the average height of what feeds each gate and of the lamps it lights, column by column
    const taken = new Set(b.gates.filter((g) => b.pos[g.id]).map((g) => b.pos[g.id].join(',')));
    const band = R * SH;
    const rowOfIn = (i) => (i + 0.5) * band / ni / SH - 0.5;
    const rowOfLamp = (j) => (j + 0.5) * band / no / SH - 0.5;
    const lampsOf = (g) => s.outputs.map((o, j) => (b.out[o.name] != null && String(b.out[o.name]).split('.')[0] === g.id ? rowOfLamp(j) : null)).filter((y) => y != null);
    const rowOf = (r) => {
      const i = s.inputs.findIndex((x) => x.name === r);
      if (i >= 0) return rowOfIn(i);
      const p = b.pos[String(r).split('.')[0]];
      return p ? p[1] : null;
    };
    const todo = b.gates.filter((g) => !b.pos[g.id]);
    const order = [...new Set(todo.map((g) => cols[g.id]))].sort((x, y) => x - y);
    for (const col of order) {
      const list = todo.filter((g) => cols[g.id] === col).map((g, k) => {
        const ys = g.in.map(rowOf).filter((y) => y != null);
        const ls = lampsOf(g);
        const w = ys.length + ls.length * 1.5;
        return { g, want: w ? (ys.reduce((a, y) => a + y, 0) + ls.reduce((a, y) => a + y * 1.5, 0)) / w : (R - 1) / 2, k };
      }).sort((x, y) => x.want - y.want || x.k - y.k);
      for (const it of list) {
        let c = Math.min(col, C - 1), best;
        for (;;) {
          const w = Math.max(0, Math.min(R - 1, Math.round(it.want)));
          const cands = [w];
          for (let d = 1; d < R; d++) cands.push(w + d, w - d);
          best = cands.find((r) => r >= 0 && r < R && !taken.has(c + ',' + r));
          if (best != null) break;
          if (c < C - 1) c++; else R++;
        }
        b.pos[it.g.id] = [c, best];
        taken.add(c + ',' + best);
      }
    }
    return { C, R };
  }
  function geometry(s, b, C, R) {
    const longest = (xs, f) => Math.max(0, ...xs.map(f));
    const IW = Math.min(140, Math.max(74, 14 + Math.round(Math.min(18, longest(s.inputs, (x) => (x.label || '').length)) * 5), 58 + longest(s.inputs, (x) => x.name.length) * 12));
    const OW = Math.min(150, Math.max(70, 42 + Math.round(longest(s.outputs, (o) => (o.label || '').length) * 4.9), 42 + longest(s.outputs, (o) => o.name.length) * 9));
    const X0 = IW + LM;
    const lampX = X0 + C * SW + 14;
    const segX = lampX + OW;
    const W = segX + (s.seg7 ? 56 : 0);
    const H = TOP + R * SH + BOT;
    const band = R * SH;
    const ins = s.inputs.map((x, i) => ({ name: x.name, y: TOP + (i + 0.5) * band / s.inputs.length }));
    const lamps = s.outputs.map((o, i) => ({ name: o.name, y: TOP + (i + 0.5) * band / s.outputs.length }));
    const lampIdx = {};
    lamps.forEach((l, i) => { lampIdx[l.name] = i; });
    const gates = new Map();
    b.gates.forEach((g) => {
      const [c, r] = b.pos[g.id] || [0, 0];
      const cx = X0 + c * SW + SW / 2, cy = TOP + r * SH + SH / 2;
      const n = g.in.length;
      gates.set(g.id, { g, c, r, cx, cy, hh: halfOf(g.type, n), ins: inOffsets(g.type, n).map((o) => [cx - 32, cy + o]), outs: outOffsets(g.type).map((o) => [cx + 32, cy + o]) });
    });
    return { IW, OW, X0, lampX, segX, W, H, C, R, ins, lamps, lampIdx, gates };
  }
  const slotXY = (G, c, r) => [G.X0 + c * SW + SW / 2, TOP + r * SH + SH / 2];

  /* ---------------- wires ---------------- */

  function wiresOf(b) {
    const ws = [];
    b.gates.forEach((g) => g.in.forEach((r, k) => { if (r != null) ws.push({ key: 'w:' + g.id + ':' + k, src: r, dst: { gate: g.id, pin: k } }); }));
    Object.keys(b.out).forEach((name) => { if (b.out[name] != null) ws.push({ key: 'w:=' + name, src: b.out[name], dst: { lamp: name } }); });
    return ws;
  }
  const rowAt = (G, y) => Math.max(0, Math.min(G.R - 1, Math.floor((y - TOP) / SH)));
  function srcAt(G, s, ref) {
    const i = s.inputs.findIndex((x) => x.name === ref);
    if (i >= 0) return { x: G.IW - 8, y: G.ins[i].y, ch: 0, row: rowAt(G, G.ins[i].y) };
    const [id, pin] = String(ref).split('.');
    const gg = G.gates.get(id);
    if (!gg) return null;
    const chip = L.CHIPS[gg.g.type];
    const k = chip ? Math.max(0, chip.outs.indexOf(pin || chip.outs[0])) : 0;
    return { x: gg.outs[k][0], y: gg.outs[k][1], ch: gg.c + 1, row: gg.r };
  }
  function dstAt(G, d) {
    if (d.lamp != null) { const y = G.lamps[G.lampIdx[d.lamp]].y; return { x: G.lampX, y, ch: G.C, row: rowAt(G, y) }; }
    const gg = G.gates.get(d.gate);
    if (!gg || !gg.ins[d.pin]) return null;
    return { x: gg.ins[d.pin][0], y: gg.ins[d.pin][1], ch: gg.c, row: gg.r };
  }
  // the channels between columns, where wires run up and down: channel k is left of column k
  const chL = (G, ch) => (ch === 0 ? G.IW - 8 : G.X0 + (ch - 1) * SW + 82);
  const chR = (G, ch) => (ch === G.C ? G.lampX : G.X0 + ch * SW + 18);
  // each wire as a path of straight lines, the way a textbook draws them: across, down the channel, across;
  // round the gates in the way along the gap between rows (and back to the left, for a latch's feedback)
  function routes(G, s, ws) {
    const lanes = new Map(), gutters = new Map();
    const want = (m, k, src, order) => { if (!m.has(k)) m.set(k, new Map()); if (!m.get(k).has(src)) m.get(k).set(src, order); };
    const plans = [];
    for (const w of ws) {
      const a = srcAt(G, s, w.src), d = dstAt(G, w.dst);
      if (!a || !d) continue;
      let type = 'direct', rb = null;
      if (d.ch < a.ch) type = 'round';
      else if (d.ch > a.ch) {
        for (const gg of G.gates.values()) if (gg.c >= a.ch && gg.c < d.ch && Math.abs(d.y - gg.cy) < gg.hh + 6) { type = 'round'; break; }
      }
      if (type === 'round') {
        if (d.ch >= a.ch) rb = Math.abs(TOP + d.row * SH - a.y) <= Math.abs(TOP + (d.row + 1) * SH - a.y) ? d.row : d.row + 1;
        else if (a.row === d.row) rb = a.row + 1;
        else rb = a.row < d.row ? a.row + 1 : a.row;
        want(gutters, rb, w.src, a.x * 1000 + a.y);
        want(lanes, d.ch, w.src, a.y);
      }
      want(lanes, a.ch, w.src, a.y);
      plans.push({ w, a, d, type, rb });
    }
    const laneX = new Map(), gutY = new Map();
    lanes.forEach((m, ch) => {
      const keys = [...m.entries()].sort((p, q) => p[1] - q[1]).map((e) => e[0]);
      const l = chL(G, ch) + 3, r = chR(G, ch) - 3;
      keys.forEach((k, i) => laneX.set(ch + '|' + k, l + (i + 1) * (r - l) / (keys.length + 1)));
    });
    gutters.forEach((m, rb) => {
      const keys = [...m.entries()].sort((p, q) => p[1] - q[1]).map((e) => e[0]);
      const gap = Math.min(6, 18 / Math.max(1, keys.length));
      keys.forEach((k, i) => gutY.set(rb + '|' + k, TOP + rb * SH + (i - (keys.length - 1) / 2) * gap));
    });
    return plans.map((p) => {
      const x1 = laneX.get(p.a.ch + '|' + p.w.src);
      let pts;
      if (p.type === 'direct') pts = [[p.a.x, p.a.y], [x1, p.a.y], [x1, p.d.y], [p.d.x, p.d.y]];
      else {
        const x2 = laneX.get(p.d.ch + '|' + p.w.src), gy = gutY.get(p.rb + '|' + p.w.src);
        pts = [[p.a.x, p.a.y], [x1, p.a.y], [x1, gy], [x2, gy], [x2, p.d.y], [p.d.x, p.d.y]];
      }
      return { key: p.w.key, src: p.w.src, dst: p.w.dst, pts: tidyPts(pts) };
    });
  }
  function tidyPts(pts) {
    const out = [];
    pts.forEach((q) => {
      const p = [r1(q[0]), r1(q[1])];
      const last = out[out.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) return;
      if (out.length >= 2) {
        const a = out[out.length - 2];
        if ((a[0] === last[0] && last[0] === p[0]) || (a[1] === last[1] && last[1] === p[1])) out.pop();
      }
      out.push(p);
    });
    return out;
  }
  // a dot wherever one signal's wires branch (three or more ways from a point)
  function dotsOf(paths) {
    const by = new Map();
    paths.forEach((p) => { if (!by.has(p.src)) by.set(p.src, []); for (let i = 1; i < p.pts.length; i++) by.get(p.src).push([p.pts[i - 1], p.pts[i]]); });
    const dots = [];
    const dir = (q, a) => (a[0] < q[0] ? 'L' : a[0] > q[0] ? 'R' : a[1] < q[1] ? 'U' : 'D');
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    const on = (q, a, b) => (a[0] === b[0] ? q[0] === a[0] && q[1] >= Math.min(a[1], b[1]) && q[1] <= Math.max(a[1], b[1]) : q[1] === a[1] && q[0] >= Math.min(a[0], b[0]) && q[0] <= Math.max(a[0], b[0]));
    by.forEach((segs, src) => {
      const pts = new Map();
      segs.forEach(([a, b]) => { pts.set(a.join(','), a); pts.set(b.join(','), b); });
      pts.forEach((q) => {
        const dirs = new Set();
        segs.forEach(([a, b]) => { if (!on(q, a, b)) return; if (!same(q, a)) dirs.add(dir(q, a)); if (!same(q, b)) dirs.add(dir(q, b)); });
        if (dirs.size >= 3) dots.push({ x: q[0], y: q[1], src });
      });
    });
    return dots;
  }
  const dPath = (pts) => 'M' + pts.map((p) => p[0] + ' ' + p[1]).join(' L');

  /* ---------------- the board ---------------- */

  // V: { s, b, G, sig(ref), lamp(name), vec, live, edit, switches, fixing, sel, arm, place, hover, names, t, fill, seqNow }
  function drawBoard(V) {
    const { s, b, G } = V;
    const t = V.t || T, fill = V.fill || F;
    const kids = [];
    const col = (v) => (V.live && v === 1 ? AMBER : INK);
    const tabbable = (on) => (on ? '0' : null);

    // free slots, while a gate is being placed
    if (V.place || V.dragging) {
      const used = new Set(b.gates.map((g) => (b.pos[g.id] || []).join(',')));
      const sl = [];
      for (let c = 0; c < G.C; c++) for (let r = 0; r < G.R; r++) {
        if (used.has(c + ',' + r) && !(V.hover && V.hover[0] === c && V.hover[1] === r)) continue;
        const [x, y] = slotXY(G, c, r);
        const hot = V.hover && V.hover[0] === c && V.hover[1] === r;
        sl.push(el('rect', { x: x - 38, y: y - 30, width: 76, height: 60, rx: 6, fill: hot ? 'rgba(214,165,84,.28)' : 'rgba(214,165,84,.08)', stroke: hot ? SEL : '#b39a6b', 'stroke-width': hot ? 1.6 : 1, 'stroke-dasharray': '4 3' }));
      }
      kids.push(el('g', { class: 'lg-slots', 'pointer-events': 'none' }, sl));
    }

    // the wires
    const paths = routes(G, s, wiresOf(b));
    const wireKids = [];
    paths.forEach((p) => {
      const v = V.sig(p.src);
      const lit = V.live && v === 1;
      const selected = V.sel && V.sel.wire && sameDst(V.sel.wire, p.dst);
      const d = dPath(p.pts);
      wireKids.push(el('g', { 'data-key': p.key, class: 'lg-wire' + (selected ? ' is-sel' : '') }, [
        lit ? el('path', { d, fill: 'none', stroke: GLOW, 'stroke-width': 7, 'stroke-opacity': 0.55, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }) : null,
        el('path', { d, fill: 'none', stroke: selected ? SEL : col(v), 'stroke-width': lit ? 3.2 : 2.2, 'stroke-linejoin': 'round', 'stroke-dasharray': selected ? '7 4' : null }),
        V.edit ? el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 12, class: 'lg-hit' }) : null
      ]));
    });
    dotsOf(paths).forEach((q) => wireKids.push(el('circle', { cx: q.x, cy: q.y, r: 3.4, fill: col(V.sig(q.src)), 'pointer-events': 'none' })));
    kids.push(el('g', { class: 'lg-wires' }, wireKids));

    // the switches
    const sw = [];
    s.inputs.forEach((x, i) => {
      const y = G.ins[i].y, on = V.vec[i] === 1, X = G.IW;
      const g = [];
      g.push(el('rect', { x: 2, y: y - 22, width: X - 6, height: 44, fill: 'transparent' }));
      g.push(text(8, x.label || x.clock ? y + 2 : y + 5.5, x.name, { 'font-size': 15, 'font-weight': 700, fill: INK, class: 'lg-name' }));
      if (x.label) g.push(text(8, y + 19, x.label.length > 18 ? x.label.slice(0, 17) + '…' : x.label, { 'font-size': 9.5, fill: SOFT }));
      else if (x.clock) g.push(el('path', { d: `M8 ${y + 16} h4 v-6 h5 v6 h5 v-6 h5 v6 h4`, fill: 'none', stroke: SOFT, 'stroke-width': 1.3 }));
      g.push(el('rect', { x: X - 50, y: y - 9, width: 29, height: 18, rx: 9, fill: on ? ON : OFF, stroke: INK, 'stroke-width': 1.3 }));
      g.push(text(on ? X - 42 : X - 29, y + 3.5, on ? '1' : '0', { 'font-size': 9.5, 'font-weight': 700, fill: on ? '#3a2608' : SOFT, 'text-anchor': 'middle' }));
      g.push(el('circle', { cx: on ? X - 30.5 : X - 40.5, cy: y, r: 6.5, fill: '#fffaf0', stroke: INK, 'stroke-width': 1.3 }));
      g.push(el('line', { x1: X - 21, y1: y, x2: X - 8, y2: y, stroke: col(V.vec[i]), 'stroke-width': V.live && on ? 3.2 : 2.2 }));
      sw.push(el('g', {
        'data-key': 'sw:' + x.name, class: 'lg-switch' + (V.switches ? '' : ' is-off'), role: V.interactive ? 'switch' : null,
        'aria-checked': V.interactive ? String(on) : null, tabindex: tabbable(V.interactive && V.switches),
        'aria-disabled': V.interactive && !V.switches ? 'true' : null,
        'aria-label': V.interactive ? (x.clock ? fill('Clock {name}', { name: x.name }) : fill('Switch {name}', { name: x.name })) + (x.label ? ' (' + x.label + ')' : '') : null
      }, g));
    });
    kids.push(el('g', { class: 'lg-switches' }, sw));

    // the gates
    const gk = [];
    G.gates.forEach((gg) => {
      const { g, cx, cy, hh } = gg;
      const chip = L.CHIPS[g.type];
      const selected = V.sel && V.sel.gate === g.id;
      const outV = V.sig(chip ? g.id + '.' + chip.outs[0] : g.id);
      const k = [];
      k.push(el('rect', { x: cx - 36, y: cy - hh - 12, width: 72, height: hh * 2 + 20, fill: 'transparent' }));
      gg.ins.forEach(([x, y], i) => {
        const v = g.in[i] != null ? V.sig(g.in[i]) : null;
        k.push(el('line', { x1: x, y1: y, x2: cx + backX(g.type, y - cy, hh), y2: y, stroke: col(v), 'stroke-width': V.live && v === 1 ? 3.2 : 2.2 }));
      });
      gg.outs.forEach(([x, y], i) => {
        const v = V.sig(chip ? g.id + '.' + chip.outs[i] : g.id);
        k.push(el('line', { x1: cx + (chip ? 25 : tipX(g.type)), y1: y, x2: x, y2: y, stroke: col(v), 'stroke-width': V.live && v === 1 ? 3.2 : 2.2 }));
      });
      const stroke = selected ? SEL : INK, sw2 = selected ? 2.8 : 1.9;
      if (chip) {
        k.push(el('rect', { x: cx - 25, y: cy - hh, width: 50, height: hh * 2, rx: 3, fill: PAPER, stroke, 'stroke-width': sw2 }));
        k.push(text(cx, cy + 3.5, g.type === 'D' ? 'D FF' : g.type, { 'font-size': 9.5, 'font-weight': 700, fill: SOFT, 'text-anchor': 'middle' }));
        chip.ins.forEach((name, i) => {
          const y = gg.ins[i][1];
          if (name === 'CLK') k.push(el('path', { d: `M${cx - 25} ${y - 4} L${cx - 19} ${y} L${cx - 25} ${y + 4}`, fill: 'none', stroke: INK, 'stroke-width': 1.3 }));
          else k.push(text(cx - 21, y + 3, name, { 'font-size': 8, fill: INK }));
        });
        chip.outs.forEach((name, i) => {
          const y = gg.outs[i][1];
          k.push(text(cx + 21, y + 3, name === 'Qn' ? 'Q' : name, { 'font-size': 8, fill: INK, 'text-anchor': 'end' }));
          if (name === 'Qn') k.push(el('line', { x1: cx + 15, y1: y - 6, x2: cx + 21, y2: y - 6, stroke: INK, 'stroke-width': 0.9 }));
        });
      } else {
        k.push(el('path', { d: bodyPath(g.type, hh), transform: `translate(${cx} ${cy})`, fill: PAPER, stroke, 'stroke-width': sw2, 'stroke-linejoin': 'round' }));
        if (g.type === 'XOR' || g.type === 'XNOR') k.push(el('path', { d: `M${cx - 24} ${cy - hh} Q${cx - 14} ${cy} ${cx - 24} ${cy + hh}`, fill: 'none', stroke, 'stroke-width': sw2 }));
        if (g.type === 'NAND' || g.type === 'NOR' || g.type === 'XNOR') k.push(el('circle', { cx: cx + 24, cy, r: 4, fill: PAPER, stroke, 'stroke-width': sw2 }));
        if (g.type === 'NOT') k.push(el('circle', { cx: cx + 18, cy, r: 4, fill: PAPER, stroke, 'stroke-width': sw2 }));
        if (V.names) {
          if (g.type === 'NOT') k.push(text(cx - 3, cy + hh + 12, 'NOT', { 'font-size': 9, 'font-weight': 700, fill: SOFT, 'text-anchor': 'middle', 'letter-spacing': 0.4 }));
          else k.push(text(cx + (g.type === 'AND' || g.type === 'NAND' ? -4 : g.type === 'XOR' || g.type === 'XNOR' ? 1 : -2), cy + 3.3, g.type, { 'font-size': g.type.length > 3 ? 8.4 : 9.4, 'font-weight': 700, fill: SOFT, 'text-anchor': 'middle', 'letter-spacing': 0.3 }));
        }
      }
      k.push(text(cx - (chip ? 25 : 20), cy - hh - 4, g.id, { 'font-size': 9, fill: SOFT, class: 'lg-id' }));
      const outLabel = V.live ? (outV === 1 ? '1' : '0') : '?';
      gk.push(el('g', {
        'data-key': 'g:' + g.id, class: 'lg-gate' + (selected ? ' is-sel' : ''),
        role: V.interactive && (V.edit || V.fixing) ? 'button' : null, tabindex: tabbable(V.interactive && (V.edit || V.fixing)),
        'aria-pressed': V.interactive && V.fixing ? String(selected) : null,
        'aria-label': V.interactive ? (chip ? fill('{id}, {type}', { id: g.id, type: chipName(g.type, t) }) : fill('{id}, {type} gate, output {value}', { id: g.id, type: g.type, value: outLabel })) : null
      }, k));
    });
    kids.push(el('g', { class: 'lg-gates' }, gk));

    // the lamps
    const lk = [];
    s.outputs.forEach((o, i) => {
      const y = G.lamps[i].y, x0 = G.lampX, cx = x0 + 22;
      const v = V.lamp(o.name);
      const lit = V.live && v === 1;
      const wired = b.out[o.name] != null;
      const k = [];
      k.push(el('rect', { x: x0 - 6, y: y - 20, width: G.OW, height: 40, fill: 'transparent' }));
      k.push(el('line', { x1: x0, y1: y, x2: cx - 10.5, y2: y, stroke: col(v), 'stroke-width': lit ? 3.2 : 2.2 }));
      k.push(el('circle', { cx, cy: y, r: 17, fill: GLOW, opacity: lit ? 0.6 : 0 }));
      k.push(el('circle', { cx, cy: y, r: 10.5, fill: lit ? LIT : DIM, stroke: INK, 'stroke-width': 1.5, 'stroke-dasharray': wired ? null : '3 2' }));
      if (V.live) k.push(el('path', { d: `M${cx - 5} ${y + 3} q2.5 -7 5 0 q2.5 7 5 0`, fill: 'none', stroke: lit ? '#8a5a00' : '#9c8b67', 'stroke-width': 1.2 }));
      else k.push(text(cx, y + 4, '?', { 'font-size': 11, 'font-weight': 700, fill: SOFT, 'text-anchor': 'middle' }));
      k.push(text(cx + 16, o.label ? y + 1 : y + 5.5, o.name, { 'font-size': 15, 'font-weight': 700, fill: INK, class: 'lg-name' }));
      if (o.label) k.push(text(cx + 16, y + 14, o.label.length > 18 ? o.label.slice(0, 17) + '…' : o.label, { 'font-size': 9.5, fill: SOFT }));
      const say = !wired ? fill('Lamp {name}: no wire', { name: o.name }) : !V.live ? fill('Lamp {name}', { name: o.name }) : lit ? fill('Lamp {name}: on', { name: o.name }) : fill('Lamp {name}: off', { name: o.name });
      lk.push(el('g', {
        'data-key': 'lamp:' + o.name, class: 'lg-lamp', role: V.interactive ? (V.edit ? 'button' : 'img') : null,
        tabindex: tabbable(V.interactive && V.edit), 'aria-label': V.interactive ? say + (o.label ? ' (' + o.label + ')' : '') : null
      }, k));
    });
    kids.push(el('g', { class: 'lg-lamps' }, lk));

    // a seven-segment digit
    if (s.seg7) {
      const vals = s.outputs.map((o) => (V.live ? V.lamp(o.name) || 0 : 0));
      let on;
      if (s.seg7 === 'segments') on = vals.map(Boolean);
      else {
        const n = vals.reduce((a, x) => a * 2 + x, 0);
        on = SEG[n].split('').map((c) => c === '1');
      }
      const x0 = G.segX + 8, y0 = G.H / 2 - 28;
      const segs = [[4, 0, 20, 5], [24, 4, 5, 22], [24, 30, 5, 22], [4, 51, 20, 5], [-1, 30, 5, 22], [-1, 4, 5, 22], [4, 25.5, 20, 5]];
      const d = [el('rect', { x: G.segX, y: G.H / 2 - 36, width: 44, height: 72, rx: 4, fill: '#2a1c10', stroke: INK, 'stroke-width': 1.4 })];
      segs.forEach((q, i) => d.push(el('rect', { x: x0 + q[0], y: y0 + q[1], width: q[2], height: q[3], rx: 2, fill: on[i] ? '#ff7a45' : '#4a3322' })));
      kids.push(el('g', { class: 'lg-seg', 'aria-hidden': 'true' }, d));
    }

    // the pins: what the learner taps to wire (drawn over everything)
    const pk = [];
    const pin = (key, x, y, v, label, armed, empty) => {
      pk.push(el('g', { 'data-key': key, class: 'lg-pin' + (armed ? ' is-armed' : ''), role: V.edit && V.interactive ? 'button' : null, tabindex: tabbable(V.edit && V.interactive), 'aria-label': V.edit && V.interactive ? label : null }, [
        el('circle', { cx: x, cy: y, r: 10, fill: 'transparent', class: 'lg-pin__hit' }),
        armed ? el('circle', { cx: x, cy: y, r: 7.5, fill: 'none', stroke: SEL, 'stroke-width': 2, 'stroke-dasharray': '3 2' }) : null,
        el('circle', { cx: x, cy: y, r: 3.2, fill: empty ? PAPER : col(v), stroke: empty ? INK : 'none', 'stroke-width': empty ? 1.2 : 0 })
      ]));
    };
    const armedFrom = V.arm && V.arm.from;
    const armedTo = V.arm && V.arm.to;
    s.inputs.forEach((x, i) => pin('sp:' + x.name, G.IW - 8, G.ins[i].y, V.vec[i], fill('Wire from switch {name}', { name: x.name }), armedFrom === x.name, false));
    G.gates.forEach((gg) => {
      const { g } = gg;
      const chip = L.CHIPS[g.type];
      gg.ins.forEach(([x, y], i) => {
        const r = g.in[i];
        const pinName = chip ? chip.ins[i] : String(i + 1);
        const label = r != null ? fill('{id} input {pin}, from {src}', { id: g.id, pin: pinName, src: r }) : fill('{id} input {pin}, no wire', { id: g.id, pin: pinName });
        pin('gi:' + g.id + ':' + i, x, y, r != null ? V.sig(r) : null, label, armedTo && armedTo.gate === g.id && armedTo.pin === i, r == null);
      });
      gg.outs.forEach(([x, y], i) => {
        const ref = chip ? g.id + '.' + chip.outs[i] : g.id;
        pin('go:' + ref, x, y, V.sig(ref), chip ? fill('{id} output {pin}', { id: g.id, pin: chip.outs[i] }) : fill('{id} output', { id: g.id }), armedFrom === ref, false);
      });
    });
    s.outputs.forEach((o, i) => pin('lp:' + o.name, G.lampX, G.lamps[i].y, V.lamp(o.name), fill('Lamp {name}', { name: o.name }), armedTo && armedTo.lamp === o.name, b.out[o.name] == null));
    if (V.edit) kids.push(el('g', { class: 'lg-pins' }, pk));
    kids.push(el('g', { class: 'lg-over', 'pointer-events': 'none' }));
    return kids;
  }
  const SEG = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '1011111', '1110000', '1111111', '1111011', '1110111', '0011111', '1001110', '0111101', '1001111', '1000111'];
  const sameDst = (a, b) => Boolean(a && b) && (a.lamp != null ? a.lamp === b.lamp : a.gate === b.gate && a.pin === b.pin);

  // a truth table as a picture (the book): columns [{ head, bits, goal? }]
  function tableTree(s, cols, x0, y0) {
    const n = s.inputs.length, R = 1 << n;
    const heads = s.inputs.map((x) => x.name).concat(cols.map((c) => c.head));
    const cw = heads.map((h) => Math.max(24, 10 + String(h).length * 8));
    const rh = 17;
    const W = cw.reduce((a, w) => a + w, 0);
    const kids = [el('rect', { x: x0, y: y0, width: W, height: rh * (R + 1), fill: '#fffaf0', stroke: INK, 'stroke-width': 1 })];
    let x = x0;
    heads.forEach((h, i) => {
      kids.push(text(x + cw[i] / 2, y0 + 12.5, h, { 'font-size': 11, 'font-weight': 700, fill: INK, 'text-anchor': 'middle' }));
      if (i) kids.push(el('line', { x1: x, y1: y0, x2: x, y2: y0 + rh * (R + 1), stroke: i === n ? INK : '#b39a6b', 'stroke-width': i === n ? 1.4 : 0.8 }));
      x += cw[i];
    });
    for (let r = 0; r < R; r++) {
      const y = y0 + rh * (r + 1);
      kids.push(el('line', { x1: x0, y1: y, x2: x0 + W, y2: y, stroke: r ? '#d8c9a6' : INK, 'stroke-width': r ? 0.7 : 1.2 }));
      const vals = L.rowBits(r, n).map(String).concat(cols.map((c) => (c.bits ? c.bits[r] : '?')));
      let xx = x0;
      vals.forEach((v, i) => { kids.push(text(xx + cw[i] / 2, y + 12.5, v === '-' ? '–' : v, { 'font-size': 11, fill: i >= n ? INK : SOFT, 'text-anchor': 'middle', 'font-weight': i >= n ? 700 : 400 })); xx += cw[i]; });
    }
    return { kids, W, H: rh * (R + 1) };
  }

  /* ---------------- the live lab ---------------- */

  function hostEl(tag, cls, attrs, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.keys(attrs).forEach((k) => { const v = attrs[k]; if (v != null && v !== false) e.setAttribute(k, v === true ? '' : String(v)); });
    if (txt != null) e.textContent = txt;
    return e;
  }
  function button(cls, txt, onClick, attrs) {
    const b = hostEl('button', 'lg-btn' + (cls ? ' ' + cls : ''), Object.assign({ type: 'button' }, attrs || {}), txt);
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  const startBuild = (s) => ({
    gates: s.gates.map((g) => ({ id: g.id, type: g.type, in: g.in.slice() })),
    out: Object.fromEntries(s.outputs.map((o) => [o.name, o.from])),
    pos: Object.fromEntries(s.gates.filter((g) => g.at).map((g) => [g.id, g.at.slice()]))
  });
  const asSpec = (s, b) => ({ inputs: s.inputs, outputs: s.outputs.map((o) => ({ name: o.name, from: b.out[o.name] })), gates: b.gates });
  const remembers = (s, b) => Boolean(L.loopOf(asSpec(s, b))) || b.gates.some((g) => L.CHIPS[g.type] && L.CHIPS[g.type].state);

  function mount(host, s, goal, ctx, mode) {
    const t = ctx.t || T;
    const fill = ctx.fill || F;
    const reduce = Boolean(ctx.reduce);
    const kind = goal ? goal.type : 'block';
    const isTask = mode === 'task';
    const canEdit = kind === 'build' || (kind === 'block' && s.edit);
    const live = kind !== 'fill' || Boolean(goal.live);
    const canSwitch = live;
    const fixing = kind === 'fix';
    const avail = canEdit ? L.available(s) : {};

    let b, C, R, c, st, vec, seqNow;
    let cells = {}, path = [], history = [], timing = [];
    let sel = null, arm = null, place = null, hover = null, dragging = false;
    let touched = false, locked = false, destroyed = false, warn = '';
    let running = false, timer = null, visible = true;

    function room() {
      let n = 0;
      (s.palette || []).forEach((p) => { n += p.count == null ? 4 : p.count; });
      return n;
    }
    function fresh() {
      b = startBuild(s);
      const g = layout(s, b, { edit: canEdit, room: room() });
      C = g.C; R = g.R;
      vec = L.startVec(s);
      cells = {};
      if (kind === 'fill') goal.outputs.forEach((k) => { cells[k] = new Array(1 << s.inputs.length).fill(null); });
      path = []; history = []; sel = null; arm = null; place = null; warn = '';
      structure();
      timing = [];
      record();
    }
    function structure() {
      c = L.compile(asSpec(s, b));
      seqNow = remembers(s, b);
      st = L.settle(c, vec, null);
    }
    const sig = (ref) => { if (ref == null || !c.idx.has(ref)) return null; return st.v[c.idx.get(ref)]; };
    const lampV = (name) => { const r = b.out[name]; return r == null ? null : sig(r); };
    function record() {
      if (!seqNow) return;
      timing.push({ vec: vec.slice(), lamps: s.outputs.map((o) => lampV(o.name)) });
      if (timing.length > 24) timing.shift();
    }

    const root = hostEl('div', 'lg' + (isTask ? ' lg--task' : '') + (reduce ? ' is-still' : ''), { 'data-no-i18n': true });

    // the toolbar: the palette, then the tools
    const bar = hostEl('div', 'lg-bar');
    const pal = hostEl('div', 'lg-pal', { role: 'group', 'aria-label': t('Gates to place') });
    const palBtns = [];
    if (canEdit) {
      (s.palette || []).forEach((p) => {
        const name = p.type + (p.n === 3 ? '3' : '');
        const btn = button('lg-pbtn', null, null, { 'aria-pressed': 'false', 'data-pal': name });
        const icon = hostEl('span', 'lg-pbtn__icon', { 'aria-hidden': 'true' });
        icon.innerHTML = iconSvg(p.type); // our own drawing, from a fixed list of types
        const lab = hostEl('span', 'lg-pbtn__name', null, L.CHIPS[p.type] ? p.type : name);
        const cnt = hostEl('span', 'lg-pbtn__count');
        btn.append(icon, lab, cnt);
        palBtns.push({ p, btn, cnt, name });
        pal.appendChild(btn);
      });
      bar.appendChild(pal);
    }
    const tools = hostEl('div', 'lg-tools');
    const btnUndo = canEdit ? button('', t('Undo'), () => undo(), { 'aria-keyshortcuts': 'Control+Z' }) : null;
    const btnDel = canEdit ? button('', t('Delete'), () => removeSel(), { 'aria-keyshortcuts': 'Delete' }) : null;
    const btnReset = button('', t('Reset'), () => { if (!locked) { fresh(); touched = false; changed(); } });
    const clockIn = s.inputs.findIndex((x) => x.clock);
    const btnRun = clockIn >= 0 ? button('lg-btn--go', t('Run clock'), () => setRun(!running), { 'aria-pressed': 'false' }) : null;
    const btnTick = clockIn >= 0 ? button('', t('Tick'), () => tick()) : null;
    [btnUndo, btnDel, btnRun, btnTick, btnReset].forEach((x) => { if (x) tools.appendChild(x); });
    bar.appendChild(tools);
    root.appendChild(bar);

    // a fix task: the chosen gate's other types
    const fixBox = hostEl('div', 'lg-fix', { role: 'group' });
    fixBox.hidden = true;
    root.appendChild(fixBox);

    const main = hostEl('div', 'lg-main');
    const stage = hostEl('div', 'lg-stage');
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'lg-svg');
    svg.setAttribute('font-family', FONT);
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-roledescription', t('logic circuit'));
    svg.setAttribute('aria-label', canEdit
      ? t('Logic circuit. Tab to a switch, gate, pin or lamp; Enter taps it; arrow keys move a gate; Delete removes; Escape cancels.')
      : t('Logic circuit. Tab to a switch and press Enter or Space to flip it.'));
    stage.appendChild(svg);
    main.appendChild(stage);
    const side = hostEl('div', 'lg-side');
    main.appendChild(side);
    root.appendChild(main);

    const status = hostEl('p', 'lg-status', { role: 'status' });
    status.hidden = true;
    root.appendChild(status);
    const hint = hostEl('p', 'lg-hint');
    root.appendChild(hint);
    const say = hostEl('p', 'sr-only', { 'aria-live': 'polite' });
    root.appendChild(say);
    host.appendChild(root);

    fresh();

    /* ---- drawing ---- */

    let G = null;
    function render() {
      if (destroyed) return;
      const fk = document.activeElement && root.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
      G = geometry(s, b, C, R);
      svg.setAttribute('viewBox', `0 0 ${G.W} ${G.H}`);
      // a slot never smaller than about 53 px across on screen (three columns fit a 340 px phone, in a task too);
      // a wider board scrolls sideways
      svg.style.minWidth = Math.round(G.W * 0.53) + 'px';
      svg.style.maxWidth = Math.round(G.W * 1.35) + 'px';
      // drawn small (a phone): larger names, so they stay readable
      const shown = stage.clientWidth || G.W;
      root.classList.toggle('is-small', shown / G.W < 0.72);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      drawBoard({
        s, b, G, sig, lamp: lampV, vec, live, edit: canEdit && !locked, switches: canSwitch && !locked, fixing: fixing && !locked, interactive: true,
        sel, arm, place, hover, dragging, names: s.names, t, fill
      }).forEach((n) => svg.appendChild(toDom(n)));
      paintSide();
      paintBar();
      paintStatus();
      if (fk) {
        const n = root.querySelector(`[data-key="${CSS.escape(fk)}"]`);
        if (n && typeof n.focus === 'function') n.focus({ preventScroll: true });
      }
    }

    function paintBar() {
      const used = {};
      b.gates.forEach((g) => { const k = L.keyOf(g.type, g.in.length); used[k] = (used[k] || 0) + 1; });
      palBtns.forEach((x) => {
        const k = L.keyOf(x.p.type, x.p.n);
        const left = (avail[k] == null ? 0 : avail[k]) - (used[k] || 0);
        x.left = left;
        x.cnt.textContent = left === Infinity ? '' : '×' + Math.max(0, left);
        x.btn.disabled = locked || left <= 0 || b.gates.length >= L.LIMITS.gates;
        x.btn.setAttribute('aria-pressed', place === x ? 'true' : 'false');
        const what = L.CHIPS[x.p.type] ? chipName(x.p.type, t) : x.p.n === 3 ? fill('{type} gate, 3 inputs', { type: x.p.type }) : fill('{type} gate', { type: x.p.type });
        x.btn.setAttribute('aria-label', left === Infinity ? fill('Place: {what}', { what }) : fill('Place: {what}, {n} left', { what, n: Math.max(0, left) }));
      });
      if (btnUndo) btnUndo.disabled = locked || !history.length;
      if (btnDel) btnDel.disabled = locked || !(sel && (sel.gate || sel.wire));
      btnReset.disabled = locked;
      if (btnRun) { btnRun.textContent = running ? t('Pause clock') : t('Run clock'); btnRun.setAttribute('aria-pressed', String(running)); btnRun.disabled = locked; }
      if (btnTick) btnTick.disabled = locked;
      // a fix task: the chosen gate's types
      fixBox.textContent = '';
      const g = fixing && sel && sel.gate ? b.gates.find((x) => x.id === sel.gate) : null;
      if (g && L.GATE[g.type] && g.type !== 'NOT' && !locked) {
        fixBox.hidden = false;
        fixBox.setAttribute('aria-label', fill('Change {id} to', { id: g.id }));
        fixBox.appendChild(hostEl('span', 'lg-fix__label', null, fill('Change {id} to:', { id: g.id })));
        goal.choices.forEach((ty) => {
          const btn = button('lg-btn--small' + (g.type === ty ? ' is-on' : ''), ty, () => swapType(g.id, ty), { 'aria-pressed': String(g.type === ty), 'data-key': 'fx:' + ty });
          fixBox.appendChild(btn);
        });
      } else if (g && g.type === 'NOT' && !locked) {
        fixBox.hidden = false;
        fixBox.appendChild(hostEl('span', 'lg-fix__label', null, t('A NOT gate has only one input: it isn’t the one to change.')));
      } else fixBox.hidden = true;
    }

    function paintStatus() {
      let msg = warn;
      if (!msg && st.osc) msg = t('This loop never settles: its gates keep switching.');
      else if (!msg && st.bad) msg = t('S and R are both 1: the latch’s outputs are both 0, a state it should never be in.');
      else if (!msg && seqNow && live) {
        // a latch of gates: Q and Q' the same means both its inputs are active at once
        const names = s.outputs.map((o) => o.name);
        const low = names.map((n) => n.toLowerCase());
        for (const a of names) {
          const bName = ['n', "'", '_bar', 'bar', 'b'].map((x) => a + x).find((x) => low.includes(x.toLowerCase()));
          const bb = bName && names[low.indexOf(bName.toLowerCase())];
          if (!bb || lampV(a) == null || lampV(a) !== lampV(bb)) continue;
          msg = fill('{a} and {b} are both {v}: a latch should never have both its inputs active at once.', { a, b: bb, v: lampV(a) });
          break;
        }
      }
      status.textContent = msg;
      status.hidden = !msg;
      status.classList.toggle('is-bad', Boolean(msg));
      let h;
      if (locked) h = '';
      else if (place) h = fill('Tap the board where the {type} gate goes.', { type: place.name });
      else if (arm && arm.from) h = fill('Now tap where the signal from {src} goes: a gate, one of its inputs, or a lamp.', { src: arm.from });
      else if (arm && arm.to) h = t('Now tap what feeds it: a switch’s dot, or a gate’s output.');
      else if (canEdit && sel && sel.gate) h = fill('{id} is chosen: tap a gate or a lamp to wire its output there. Arrow keys move it; Delete removes it.', { id: sel.gate });
      else if (canEdit && sel && sel.wire) h = t('A wire is chosen: Delete removes it.');
      else if (canEdit) h = t('Drag a gate onto the board, or tap it and then the board. To wire, tap an output (a switch’s dot or a gate), then where it goes.');
      else if (fixing) h = t('Tap the gate that is wrong, then choose its right type.');
      else if (kind === 'fill') h = live ? t('Flip the switches to try each row, then tap the cells to fill in the outputs.') : t('Work out each row from the circuit, then tap the cells to fill in the outputs: 0 or 1.');
      else if (kind === 'find') h = t('Flip the switches until the lamps show what is asked.');
      else if (clockIn >= 0) h = t('Flip the switches, or run the clock, and watch the signals.');
      else h = t('Flip the switches and watch the signals: a wire carrying 1 glows.');
      hint.textContent = h;
      hint.hidden = !h;
      clearTimeout(sayTimer);
      sayTimer = setTimeout(() => {
        if (destroyed || !live) return;
        const bits = s.outputs.filter((o) => b.out[o.name] != null).map((o) => fill('{name} is {value}', { name: o.name, value: lampV(o.name) }));
        say.textContent = bits.join('. ') + (bits.length ? '.' : '') + (msg ? ' ' + msg : '');
      }, 600);
    }
    let sayTimer = null;

    // the truth table (or, for a circuit that remembers, the timing diagram)
    function paintSide() {
      const fk = document.activeElement && side.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
      side.textContent = '';
      if (seqNow) { side.appendChild(timingEl()); return; }
      const n = s.inputs.length, rows = 1 << n;
      const spec = asSpec(s, b);
      const tb = L.table(spec, c);
      const target = goal && goal.out && (kind === 'build' || kind === 'fix') ? goal.out : null;
      const loose = {};
      s.outputs.forEach((o) => { loose[o.name] = Boolean(L.looseIn(spec, [o.name])); });
      const wrap = hostEl('div', 'lg-tt-wrap');
      const tbl = hostEl('table', 'lg-tt');
      tbl.appendChild(hostEl('caption', 'sr-only', null, t('Truth table')));
      const thead = hostEl('thead');
      const h1 = hostEl('tr', 'lg-tt__group');
      h1.appendChild(hostEl('th', null, { colspan: n, scope: 'colgroup' }, t('Inputs')));
      h1.appendChild(hostEl('th', 'lg-tt__out', { colspan: s.outputs.length, scope: 'colgroup' }, kind === 'fill' ? t('Outputs') : target ? t('Yours') : t('Outputs')));
      const tkeys = target ? Object.keys(target) : [];
      if (target) h1.appendChild(hostEl('th', 'lg-tt__goal', { colspan: tkeys.length, scope: 'colgroup' }, t('Goal')));
      thead.appendChild(h1);
      const h2 = hostEl('tr');
      s.inputs.forEach((x) => h2.appendChild(hostEl('th', null, { scope: 'col' }, x.name)));
      s.outputs.forEach((o, i) => h2.appendChild(hostEl('th', 'lg-tt__out' + (i === 0 ? ' is-first' : ''), { scope: 'col' }, o.name)));
      tkeys.forEach((k, i) => h2.appendChild(hostEl('th', 'lg-tt__goal' + (i === 0 ? ' is-first' : ''), { scope: 'col' }, k)));
      thead.appendChild(h2);
      tbl.appendChild(thead);
      const tbody = hostEl('tbody');
      const now = parseInt(L.vecStr(vec), 2);
      let misses = 0;
      for (let r = 0; r < rows; r++) {
        const tr = hostEl('tr', r === now && live ? 'is-now' : null, r === now && live ? { 'aria-current': 'true' } : null);
        L.rowBits(r, n).forEach((v) => tr.appendChild(hostEl('td', 'lg-tt__in', null, String(v))));
        s.outputs.forEach((o, i) => {
          const cls = 'lg-tt__out' + (i === 0 ? ' is-first' : '');
          if (kind === 'fill' && cells[o.name]) {
            const v = cells[o.name][r];
            const td = hostEl('td', cls + ' lg-tt__fill');
            const rowName = L.rowName(s, r);
            const btn = hostEl('button', 'lg-cell' + (v == null ? ' is-blank' : ''), {
              type: 'button', 'data-key': 'c:' + o.name + ':' + r, 'data-row': r, 'data-out': o.name,
              'aria-label': fill('Row {row}: {name} = {value}', { row: rowName, name: o.name, value: v == null ? '?' : v }),
              disabled: locked
            }, v == null ? '?' : String(v));
            td.appendChild(btn);
            tr.appendChild(td);
            return;
          }
          if (kind === 'fill' && !live) { tr.appendChild(hostEl('td', cls, null, '')); return; }
          const got = b.out[o.name] == null || loose[o.name] ? null : tb[o.name][r];
          const miss = target && target[o.name] != null && got != null && got !== target[o.name][r];
          if (miss) misses++;
          const td = hostEl('td', cls + (got === '1' ? ' is-1' : '') + (miss ? ' is-miss' : ''), miss ? { 'aria-label': fill('{value}, should be {want}', { value: got, want: target[o.name][r] }) } : null, got == null ? '–' : got);
          tr.appendChild(td);
        });
        tkeys.forEach((k, i) => tr.appendChild(hostEl('td', 'lg-tt__goal' + (i === 0 ? ' is-first' : '') + (target[k][r] === '1' ? ' is-1' : ''), null, target[k][r])));
        if (canSwitch && !locked) tr.addEventListener('click', (e) => { if (e.target.closest('button')) return; setRow(r); });
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      wrap.appendChild(tbl);
      side.appendChild(wrap);
      if (target) {
        const allWired = tkeys.every((k) => b.out[k] != null && !loose[k]);
        const msg = !allWired ? t('Wire every lamp to see your column.') : misses === 1 ? t('1 row doesn’t match the goal yet.') : misses ? fill('{n} rows don’t match the goal yet.', { n: misses }) : t('Every row matches the goal.');
        side.appendChild(hostEl('p', 'lg-tt__note' + (allWired && !misses ? ' is-ok' : ''), null, msg));
      }
      if (goal && goal.expr && kind !== 'fill') {
        const ex = hostEl('p', 'lg-tt__expr');
        Object.keys(goal.expr).forEach((k) => ex.appendChild(hostEl('span', null, null, `${k} = ${goal.expr[k]}`)));
        side.insertBefore(ex, side.firstChild);
      }
      if (goal && (goal.only || goal.max) && kind === 'build') {
        const bits = [];
        if (goal.only) bits.push(fill('Only {types}', { types: andList(goal.only) }));
        if (goal.max) bits.push(fill('at most {n} gates', { n: goal.max }));
        side.insertBefore(hostEl('p', 'lg-tt__rule', null, bits.join(', ')), side.firstChild);
      }
      if (fk) { const nd = side.querySelector(`[data-key="${CSS.escape(fk)}"]`); if (nd) nd.focus({ preventScroll: true }); }
    }
    function timingEl() {
      const names = s.inputs.map((x) => x.name).concat(s.outputs.map((o) => o.name));
      const rows = timing.map((e) => e.vec.concat(e.lamps.map((v) => (v == null ? 0 : v))));
      const stepW = 14, rowH = 22, lw = 38;
      const W = lw + Math.max(1, rows.length) * stepW + 6, H = names.length * rowH + 8;
      const kids = [];
      names.forEach((nm, i) => {
        const y0 = 4 + i * rowH;
        const isOut = i >= s.inputs.length;
        kids.push(text(4, y0 + 15, nm, { 'font-size': 11, 'font-weight': 700, fill: isOut ? INK : SOFT }));
        let d = '';
        rows.forEach((row, k) => {
          const y = row[i] ? y0 + 4 : y0 + 17;
          const x = lw + k * stepW;
          d += (k ? ` L${x} ${y}` : `M${x} ${y}`) + ` L${x + stepW} ${y}`;
          if (row[i]) kids.push(el('rect', { x, y: y0 + 4, width: stepW, height: 13, fill: isOut ? 'rgba(246,196,69,.45)' : 'rgba(224,161,39,.22)' }));
        });
        kids.push(el('path', { d, fill: 'none', stroke: isOut ? AMBER : INK, 'stroke-width': 1.6 }));
        kids.push(el('line', { x1: lw, y1: y0 + 20.5, x2: W - 4, y2: y0 + 20.5, stroke: '#d8c9a6', 'stroke-width': 0.6 }));
      });
      const box = hostEl('div', 'lg-timing');
      box.appendChild(hostEl('p', 'lg-timing__head', null, t('Timing: each step is one change, the newest on the right')));
      const sv = toDom(el('svg', { xmlns: SVGNS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'font-family': FONT, role: 'img', 'aria-label': t('Timing diagram') }, kids));
      sv.setAttribute('class', 'lg-timing__svg');
      box.appendChild(sv);
      return box;
    }

    /* ---- changing things ---- */

    function changed() {
      render();
      if (ctx.onChange) ctx.onChange(value());
    }
    function snapshot() { history.push(clone({ gates: b.gates, out: b.out, pos: b.pos, C, R })); if (history.length > 60) history.shift(); }
    function undo() {
      if (locked || !history.length) return;
      const h = history.pop();
      b = { gates: h.gates, out: h.out, pos: h.pos };
      C = h.C; R = h.R;
      sel = null; arm = null; warn = '';
      structure(); record();
      touched = true;
      changed();
    }
    function flip(i) {
      if (locked || !canSwitch) return;
      vec[i] = 1 - vec[i];
      st = L.settle(c, vec, seqNow ? st : null);
      if (kind === 'find' && seqNow) {
        path.push(L.vecStr(vec));
        if (path.length >= L.LIMITS.path) shortenPath();
      }
      record();
      touched = true;
      warn = '';
      changed();
    }
    // a long history of flips, replaced by the shortest way to the same state
    function shortenPath() {
      const r = L.reach(s, c);
      const key = (v, x) => L.vecStr(v) + '|' + x.v.slice(c.ni).join('') + '|' + x.q.join('') + x.ck.join('');
      const k = key(vec, st);
      const node = r.nodes.find((x) => key(x.vec, x.st) === k);
      path = node ? node.path.slice() : path.slice(-L.LIMITS.path + 1);
    }
    function setRow(r) {
      if (locked || !canSwitch || seqNow) return;
      vec = L.rowBits(r, s.inputs.length);
      st = L.settle(c, vec, null);
      touched = true;
      changed();
    }
    function tick() {
      if (locked || clockIn < 0) return;
      flip(clockIn);
    }
    function setRun(on) {
      running = Boolean(on) && clockIn >= 0;
      clearInterval(timer);
      timer = null;
      if (running) timer = setInterval(() => { if (visible && !document.hidden && !locked) tick(); }, Math.max(125, (s.inputs[clockIn].clock || 1000) / 2));
      paintBar();
    }

    // is src fed (anywhere upstream) by the gate id? then wiring src into id would make a loop
    function feeds(id, src) {
      const byId = new Map(b.gates.map((g) => [g.id, g]));
      const seen = new Set();
      const walk = (r) => {
        if (r == null) return false;
        const g = byId.get(String(r).split('.')[0]);
        if (!g || seen.has(g.id)) return false;
        if (g.id === id) return true;
        seen.add(g.id);
        return g.in.some(walk);
      };
      return walk(src);
    }
    function connect(dst, src) {
      if (!canEdit || locked) return;
      if (dst.gate != null && String(src).split('.')[0] === dst.gate) { warn = t('A gate’s output can’t go straight back into its own input.'); render(); return; }
      if (dst.gate != null && !s.latch && feeds(dst.gate, src)) { warn = t('That wire would make a loop: a gate’s output would come back to its own input.'); render(); return; }
      snapshot();
      if (dst.gate != null) { const g = b.gates.find((x) => x.id === dst.gate); if (!g) return; g.in[dst.pin] = src; } else b.out[dst.lamp] = src;
      warn = '';
      touched = true;
      structure(); record();
      sel = null;
      changed();
    }
    function freePin(id, y) {
      const gg = G.gates.get(id);
      const g = gg.g;
      const k = g.in.findIndex((x) => x == null);
      if (k >= 0) return k;
      let best = 0;
      gg.ins.forEach((p, i) => { if (Math.abs(p[1] - y) < Math.abs(gg.ins[best][1] - y)) best = i; });
      return best;
    }
    function outRef(id, y) {
      const gg = G.gates.get(id);
      const chip = L.CHIPS[gg.g.type];
      if (!chip) return id;
      let best = 0;
      gg.outs.forEach((p, i) => { if (Math.abs(p[1] - y) < Math.abs(gg.outs[best][1] - y)) best = i; });
      return id + '.' + chip.outs[best];
    }
    function removeGate(id) {
      snapshot();
      b.gates = b.gates.filter((g) => g.id !== id);
      delete b.pos[id];
      const gone = (r) => r != null && String(r).split('.')[0] === id;
      b.gates.forEach((g) => { g.in = g.in.map((r) => (gone(r) ? null : r)); });
      Object.keys(b.out).forEach((k) => { if (gone(b.out[k])) b.out[k] = null; });
      sel = null; arm = null;
      touched = true;
      structure(); record();
      changed();
    }
    function removeWire(dst) {
      const has1 = dst.lamp != null ? b.out[dst.lamp] != null : (b.gates.find((g) => g.id === dst.gate) || { in: [] }).in[dst.pin] != null;
      if (!has1) return;
      snapshot();
      if (dst.lamp != null) b.out[dst.lamp] = null; else b.gates.find((g) => g.id === dst.gate).in[dst.pin] = null;
      sel = null; arm = null;
      touched = true;
      structure(); record();
      changed();
    }
    function removeSel() {
      if (!canEdit || locked || !sel) return;
      if (sel.gate) removeGate(sel.gate); else if (sel.wire) removeWire(sel.wire);
    }
    function freshId(type) {
      const pre = L.CHIPS[type] ? 'U' : 'G';
      const taken = new Set(b.gates.map((g) => g.id.toLowerCase()).concat(s.inputs.map((x) => x.name.toLowerCase()), s.outputs.map((o) => o.name.toLowerCase())));
      let k = 1;
      while (taken.has((pre + k).toLowerCase())) k++;
      return pre + k;
    }
    const usedSlots = () => new Set(b.gates.map((g) => (b.pos[g.id] || []).join(',')));
    function freeSlot(near) {
      const used = usedSlots();
      let best = null, bd = Infinity;
      for (let cc = 0; cc < C; cc++) for (let rr = 0; rr < R; rr++) {
        if (used.has(cc + ',' + rr)) continue;
        const d = near ? Math.abs(cc - near[0]) * 1.2 + Math.abs(rr - near[1]) : cc * 10 + rr;
        if (d < bd) { bd = d; best = [cc, rr]; }
      }
      return best;
    }
    function placeGate(x, slot, viaKeys) {
      if (!canEdit || locked || !x || !(x.left > 0)) return;
      if (b.gates.length >= L.LIMITS.gates) { warn = t('The board is full.'); render(); return; }
      let at = slot && !usedSlots().has(slot.join(',')) ? slot : freeSlot(slot);
      if (!at) { if (C < 6) C++; else R++; at = freeSlot(slot); }
      snapshot();
      const id = freshId(x.p.type);
      const n = L.CHIPS[x.p.type] ? L.CHIPS[x.p.type].ins.length : x.p.n;
      b.gates.push({ id, type: x.p.type, in: new Array(n).fill(null) });
      b.pos[id] = at;
      if (freeSlot(null) == null && C < 6) C++; // always room for one more
      place = null; hover = null;
      sel = { gate: id }; arm = { from: L.CHIPS[x.p.type] ? id + '.' + L.CHIPS[x.p.type].outs[0] : id };
      touched = true;
      warn = '';
      structure(); record();
      changed();
      if (viaKeys) { const n2 = svg.querySelector(`[data-key="g:${CSS.escape(id)}"]`); if (n2) n2.focus({ preventScroll: true }); }
      say.textContent = fill('{type} gate {id} placed. Arrow keys move it.', { type: x.p.type, id });
    }
    function moveGate(id, slot) {
      if (!slot || slot[0] < 0 || slot[1] < 0 || slot[0] >= C || slot[1] >= R) return false;
      const other = b.gates.find((g) => g.id !== id && b.pos[g.id] && b.pos[g.id][0] === slot[0] && b.pos[g.id][1] === slot[1]);
      snapshot();
      if (other) b.pos[other.id] = b.pos[id].slice();
      b.pos[id] = slot.slice();
      touched = true;
      return true;
    }
    function nudge(id, dx, dy) {
      const p = b.pos[id];
      if (!p) return;
      const used = usedSlots();
      let x = p[0] + dx, y = p[1] + dy;
      while (x >= 0 && y >= 0 && x < C && y < R && used.has(x + ',' + y)) { x += dx; y += dy; }
      if (x < 0 || y < 0 || x >= C || y >= R) return;
      if (moveGate(id, [x, y])) changed();
    }
    function swapType(id, ty) {
      if (!fixing || locked) return;
      const g = b.gates.find((x) => x.id === id);
      if (!g || g.type === ty) return;
      g.type = ty;
      touched = true;
      structure();
      changed();
    }
    function cycleCell(name, r, to) {
      if (locked || !cells[name]) return;
      const v = cells[name][r];
      cells[name][r] = to != null ? to : v == null ? 0 : 1 - v;
      touched = true;
      changed();
    }

    /* ---- pointer and keys ---- */

    function toSvg(x, y) {
      const m = svg.getScreenCTM();
      if (!m) return [0, 0];
      const pt = svg.createSVGPoint();
      pt.x = x; pt.y = y;
      const q = pt.matrixTransform(m.inverse());
      return [q.x, q.y];
    }
    const scale = () => { const r = svg.getBoundingClientRect(); return r.width / G.W || 1; };
    function slotAt(p) {
      const cc = Math.floor((p[0] - G.X0) / SW), rr = Math.floor((p[1] - TOP) / SH);
      return [Math.max(0, Math.min(C - 1, cc)), Math.max(0, Math.min(R - 1, rr))];
    }
    const onBoard = (p) => p[0] >= G.X0 - 6 && p[0] <= G.X0 + C * SW + 6 && p[1] >= 0 && p[1] <= G.H;
    // what is under a point: pins first (within a finger's reach), then what the point is on
    function pickKey(key, p) {
      if (!key) return { kind: 'board', p };
      const [k, a, b2] = key.split(':');
      if (k === 'sw') return { kind: 'switch', i: s.inputs.findIndex((x) => x.name === a), p };
      if (k === 'sp') return { kind: 'src', ref: a, p };
      if (k === 'go') return { kind: 'src', ref: a, p };
      if (k === 'gi') return { kind: 'in', dst: { gate: a, pin: Number(b2) }, p };
      if (k === 'lp' || k === 'lamp') return { kind: 'in', dst: { lamp: a }, p };
      if (k === 'g') return { kind: 'gate', id: a, p };
      if (k === 'w') return { kind: 'wire', dst: a === '' ? { lamp: b2 } : a[0] === '=' ? { lamp: key.slice(3) } : { gate: a, pin: Number(b2) }, p };
      return { kind: 'board', p };
    }
    function pickAt(cx, cy, target) {
      const p = toSvg(cx, cy);
      if (canEdit) {
        const reach = Math.max(12, 14 / scale());
        let best = null, bd = reach;
        svg.querySelectorAll('.lg-pin').forEach((n) => {
          const ci = n.querySelector('.lg-pin__hit');
          const d = Math.hypot(Number(ci.getAttribute('cx')) - p[0], Number(ci.getAttribute('cy')) - p[1]);
          if (d < bd) { bd = d; best = n.getAttribute('data-key'); }
        });
        if (best) return pickKey(best, p);
      }
      const node = target && target.closest ? target.closest('[data-key]') : null;
      return pickKey(node && svg.contains(node) ? node.getAttribute('data-key') : null, p);
    }
    const centerOf = (node) => { const r = node.getBoundingClientRect(); return toSvg(r.left + r.width / 2, r.top + r.height / 2); };

    function tap(pk, viaKeys) {
      if (locked || !pk) return;
      if (place) {
        if (pk.kind === 'board' || pk.kind === 'gate' || pk.kind === 'wire') { if (onBoard(pk.p) || viaKeys) { placeGate(place, slotAt(pk.p), viaKeys); return; } }
        place = null;
      }
      switch (pk.kind) {
        case 'switch':
          if (pk.i >= 0) flip(pk.i);
          return;
        case 'src':
          if (!canEdit) return;
          if (arm && arm.to) { const d = arm.to; arm = null; connect(d, pk.ref); return; }
          arm = arm && arm.from === pk.ref ? null : { from: pk.ref };
          sel = null;
          break;
        case 'in':
          if (!canEdit) return;
          if (arm && arm.from) { const f = arm.from; arm = null; connect(pk.dst, f); return; }
          if (arm && arm.to && sameDst(arm.to, pk.dst)) { arm = null; sel = null; break; }
          arm = { to: pk.dst };
          sel = wired(pk.dst) ? { wire: pk.dst } : null;
          break;
        case 'gate':
          if (fixing) { sel = sel && sel.gate === pk.id ? null : { gate: pk.id }; break; }
          if (!canEdit) return;
          if (arm && arm.from && String(arm.from).split('.')[0] !== pk.id) { const f = arm.from; arm = null; connect({ gate: pk.id, pin: freePin(pk.id, pk.p[1]) }, f); return; }
          if (arm && arm.to && arm.to.gate !== pk.id) { const d = arm.to; arm = null; connect(d, outRef(pk.id, pk.p[1])); return; }
          if (sel && sel.gate === pk.id) { sel = null; arm = null; break; }
          sel = { gate: pk.id };
          arm = { from: outRef(pk.id, pk.p[1]) };
          break;
        case 'wire':
          if (!canEdit) return;
          sel = { wire: pk.dst }; arm = null;
          break;
        default:
          sel = null; arm = null;
      }
      warn = '';
      render();
    }
    const wired = (d) => (d.lamp != null ? b.out[d.lamp] != null : ((b.gates.find((g) => g.id === d.gate) || { in: [] }).in[d.pin] != null));

    let down = null;
    function overlay(kids) {
      const ov = svg.querySelector('.lg-over');
      if (!ov) return;
      while (ov.firstChild) ov.removeChild(ov.firstChild);
      kids.forEach((k) => ov.appendChild(toDom(k)));
    }
    function pinXY(ref) { const a = srcAt(G, s, ref); return a ? [a.x, a.y] : null; }
    function dstXY(d) { const a = dstAt(G, d); return a ? [a.x, a.y] : null; }
    function onDown(e) {
      if (locked || (e.button != null && e.button > 0)) return;
      const pk = pickAt(e.clientX, e.clientY, e.target);
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, pk, drag: null };
      if (canEdit && (pk.kind === 'src' || pk.kind === 'in' || pk.kind === 'gate')) {
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      }
    }
    function onMove(e) {
      if (!G) return;
      if (!down) {
        // a hint of where things would go, with a mouse
        if (e.pointerType !== 'mouse') return;
        const p = toSvg(e.clientX, e.clientY);
        if (place) {
          const h = onBoard(p) ? slotAt(p) : null;
          if (String(h) !== String(hover)) { hover = h; render(); }
        } else if (arm && arm.from) {
          const a = pinXY(arm.from);
          if (a) overlay([el('line', { x1: a[0], y1: a[1], x2: p[0], y2: p[1], stroke: SEL, 'stroke-width': 1.6, 'stroke-dasharray': '5 4' })]);
        } else if (arm && arm.to) {
          const a = dstXY(arm.to);
          if (a) overlay([el('line', { x1: a[0], y1: a[1], x2: p[0], y2: p[1], stroke: SEL, 'stroke-width': 1.6, 'stroke-dasharray': '5 4' })]);
        }
        return;
      }
      if (down.id !== e.pointerId) return;
      const far = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7;
      if (!down.drag && far && canEdit) {
        if (down.pk.kind === 'src' || down.pk.kind === 'in') down.drag = 'wire';
        else if (down.pk.kind === 'gate' && b.pos[down.pk.id]) { down.drag = 'move'; dragging = true; render(); }
      }
      if (!down.drag) return;
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      if (down.drag === 'wire') {
        const a = down.pk.kind === 'src' ? pinXY(down.pk.ref) : dstXY(down.pk.dst);
        if (a) overlay([el('line', { x1: a[0], y1: a[1], x2: p[0], y2: p[1], stroke: SEL, 'stroke-width': 2, 'stroke-dasharray': '5 4' })]);
      } else {
        const node = svg.querySelector(`[data-key="g:${CSS.escape(down.pk.id)}"]`);
        const p0 = toSvg(down.x, down.y);
        if (node) node.setAttribute('transform', `translate(${r1(p[0] - p0[0])} ${r1(p[1] - p0[1])})`);
        const h = slotAt(p);
        if (String(h) !== String(hover)) {
          hover = h;
          const [hx, hy] = slotXY(G, h[0], h[1]);
          overlay([el('rect', { x: hx - 38, y: hy - 30, width: 76, height: 60, rx: 6, fill: 'rgba(214,165,84,.22)', stroke: SEL, 'stroke-width': 1.6, 'stroke-dasharray': '4 3' })]);
        }
      }
    }
    function onUp(e) {
      if (!down || down.id !== e.pointerId) return;
      const d = down;
      down = null;
      try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
      if (!d.drag) { tap(d.pk, false); return; }
      if (d.drag === 'wire') {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const to = pickAt(e.clientX, e.clientY, under);
        if (d.pk.kind === 'src' && (to.kind === 'in')) connect(to.dst, d.pk.ref);
        else if (d.pk.kind === 'src' && to.kind === 'gate' && String(d.pk.ref).split('.')[0] !== to.id) connect({ gate: to.id, pin: freePin(to.id, to.p[1]) }, d.pk.ref);
        else if (d.pk.kind === 'in' && to.kind === 'src') connect(d.pk.dst, to.ref);
        else if (d.pk.kind === 'in' && to.kind === 'gate') connect(d.pk.dst, outRef(to.id, to.p[1]));
        else render();
        return;
      }
      dragging = false;
      const p = toSvg(e.clientX, e.clientY);
      hover = null;
      if (onBoard(p)) moveGate(d.pk.id, slotAt(p));
      changed();
    }
    function onCancel() { if (down && down.drag) { down = null; dragging = false; hover = null; render(); } else down = null; }
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onCancel);
    svg.addEventListener('pointerleave', () => { if (!down && (hover || (arm && !down))) { if (place) { hover = null; render(); } else overlay([]); } });

    function onKey(e) {
      if (locked) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && canEdit) { e.preventDefault(); undo(); return; }
      const node = e.target && e.target.closest ? e.target.closest('[data-key]') : null;
      const key = node ? node.getAttribute('data-key') : null;
      if (e.key === 'Escape') { if (place || arm || sel) { e.preventDefault(); place = null; arm = null; sel = null; hover = null; render(); } return; }
      if (!key) return;
      if (key.startsWith('c:')) { // a truth-table cell to fill
        const [, name, r] = key.split(':');
        if (e.key === '0' || e.key === '1') { e.preventDefault(); cycleCell(name, Number(r), Number(e.key)); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = side.querySelector(`[data-key="${CSS.escape('c:' + name + ':' + (Number(r) + (e.key === 'ArrowDown' ? 1 : -1)))}"]`);
          if (next) next.focus();
        }
        return;
      }
      if (!svg.contains(node)) return;
      const pk = pickKey(key, centerOf(node));
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(pk, true); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) {
        e.preventDefault();
        if (pk.kind === 'gate') removeGate(pk.id);
        else if (pk.kind === 'in') removeWire(pk.dst);
        return;
      }
      if (pk.kind === 'gate' && canEdit) {
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (dir) { e.preventDefault(); nudge(pk.id, dir[0], dir[1]); }
      }
    }
    root.addEventListener('keydown', onKey);
    side.addEventListener('click', (e) => {
      const btn = e.target.closest ? e.target.closest('.lg-cell') : null;
      if (btn && !locked) cycleCell(btn.getAttribute('data-out'), Number(btn.getAttribute('data-row')));
    });

    // the palette: tap (then the board), drag onto the board, or Enter (the first free slot)
    let swallow = false;
    palBtns.forEach((x) => {
      x.btn.addEventListener('click', (e) => {
        if (swallow) { swallow = false; return; }
        if (locked || !(x.left > 0)) return;
        if (e.detail === 0) { placeGate(x, null, true); return; } // the keyboard
        place = place === x ? null : x;
        sel = null; arm = null; hover = null;
        render();
      });
      x.btn.addEventListener('pointerdown', (e) => {
        if (locked || !(x.left > 0) || (e.button != null && e.button > 0)) return;
        const start = [e.clientX, e.clientY];
        let ghost = null;
        const move = (ev) => {
          if (!ghost && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 8) {
            ghost = hostEl('div', 'lg-ghost', { 'aria-hidden': 'true' });
            ghost.innerHTML = iconSvg(x.p.type); // our own drawing
            document.body.appendChild(ghost);
            dragging = true; place = null; render();
          }
          if (!ghost) return;
          ev.preventDefault();
          ghost.style.left = ev.clientX + 'px';
          ghost.style.top = ev.clientY + 'px';
          const p = toSvg(ev.clientX, ev.clientY);
          const h = onBoard(p) ? slotAt(p) : null;
          if (String(h) !== String(hover)) { hover = h; render(); }
        };
        const up = (ev) => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', up);
          if (!ghost) return;
          ghost.remove();
          swallow = true;
          setTimeout(() => { swallow = false; }, 0);
          dragging = false;
          const p = toSvg(ev.clientX, ev.clientY);
          const h = ev.type === 'pointerup' && onBoard(p) ? slotAt(p) : null;
          hover = null;
          if (h) placeGate(x, h, false); else render();
        };
        document.addEventListener('pointermove', move, { passive: false });
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
      });
    });

    // a clock that ticks only while it can be seen
    let io = null;
    if (clockIn >= 0 && 'IntersectionObserver' in window) {
      io = new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting); });
      io.observe(root);
    }
    if (clockIn >= 0 && !isTask && !reduce) setRun(true);

    render();

    /* ---- the handle ---- */

    function value() {
      if (!touched) return null;
      if (kind === 'build' || kind === 'block') {
        const out = {};
        Object.keys(b.out).forEach((k) => { if (b.out[k] != null) out[k] = b.out[k]; });
        return { gates: b.gates.map((g) => ({ id: g.id, type: g.type, in: g.in.slice() })), outputs: out };
      }
      if (kind === 'fill') {
        if (!Object.values(cells).some((col) => col.some((v) => v != null))) return null;
        return { cells: clone(cells) };
      }
      if (kind === 'find') {
        const set = Object.fromEntries(s.inputs.map((x, i) => [x.name, vec[i]]));
        return seqNow ? { set, path: path.slice() } : { set };
      }
      if (kind === 'fix') {
        const types = {};
        b.gates.forEach((g) => { const orig = s.gates.find((x) => x.id === g.id); if (orig && orig.type !== g.type) types[g.id] = g.type; });
        return Object.keys(types).length ? { types } : null;
      }
      return null;
    }
    function reveal() {
      if (!goal) return;
      const sol = goal.solution || {};
      if (kind === 'build' && sol.gates) {
        b = { gates: clone(sol.gates), out: Object.fromEntries(s.outputs.map((o) => [o.name, has(sol.outputs, o.name) ? sol.outputs[o.name] : null])), pos: {} };
        const g = layout(s, b, { edit: true, room: 0 });
        C = g.C; R = g.R;
        structure();
      } else if (kind === 'fill') {
        goal.outputs.forEach((k) => { cells[k] = goal.out[k].split('').map(Number); });
      } else if (kind === 'find') {
        if (sol.set) { vec = s.inputs.map((x) => (sol.set[x.name] ? 1 : 0)); st = L.settle(c, vec, null); } else if (sol.path) {
          const r = L.replay(s, c, sol.path);
          if (r) { vec = r.vec.slice(); st = r.st; path = sol.path.slice(); }
          timing = [];
          let st2 = L.startState(s, c);
          timing.push({ vec: L.startVec(s), lamps: L.lampsOf(c, st2) });
          sol.path.forEach((p) => { const v = L.vecFrom(p, s.inputs.length); st2 = L.settle(c, v, st2); timing.push({ vec: v, lamps: L.lampsOf(c, st2) }); });
        }
      } else if (kind === 'fix') {
        Object.keys(sol).forEach((id) => { const g = b.gates.find((x) => x.id === id); if (g) g.type = sol[id]; });
        structure();
      }
      sel = null; arm = null; place = null; warn = '';
      touched = true;
      render();
    }

    return {
      value,
      reset() { fresh(); touched = false; render(); },
      reveal,
      lock(on) {
        locked = Boolean(on);
        root.classList.toggle('is-locked', locked);
        if (locked) { place = null; arm = null; sel = null; hover = null; setRun(false); }
        render();
      },
      destroy() {
        destroyed = true;
        clearInterval(timer);
        clearTimeout(sayTimer);
        if (io) io.disconnect();
        root.removeEventListener('keydown', onKey);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  /* ---------------- checked once, kept ---------------- */

  const checked = new WeakMap();   // spec -> goal (or a key, for a block) -> { spec, goal } or null
  function cleanTask(spec, goal) {
    if (!L || !spec || typeof spec !== 'object' || !goal || typeof goal !== 'object') return null;
    let m = checked.get(spec);
    if (!m) { m = new WeakMap(); checked.set(spec, m); }
    if (!m.has(goal)) { let v = null; try { v = L.normTask(spec, goal); } catch (e) { v = null; } m.set(goal, v); }
    return m.get(goal);
  }
  function cleanSpec(spec, loose) {
    if (!L || !spec || typeof spec !== 'object') return null;
    let m = checked.get(spec);
    if (!m) { m = new WeakMap(); checked.set(spec, m); }
    const key = loose ? cleanSpec : checked;
    if (!m.has(key)) { let v = null; try { v = L.normSpec(spec, loose ? { loose: true, quick: true } : {}); } catch (e) { v = null; } m.set(key, v); }
    return m.get(key);
  }

  // until the core has loaded (it is usually there first: widgets.js waits for "ready"), a handle that waits
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
    if (err) console.warn('[Primer] logic:', err.message || err);
  }

  // the still picture: the board as it starts, with the goal's truth table beside it in a task
  function stillOf(s, goal) {
    const b = startBuild(s);
    const g = layout(s, b, { edit: false });
    const G = geometry(s, b, g.C, g.R);
    const c = L.compile(asSpec(s, b));
    const st = L.startState(s, c);
    const sig = (ref) => (ref != null && c.idx.has(ref) ? st.v[c.idx.get(ref)] : null);
    const live = !(goal && goal.type === 'fill' && !goal.live);
    const kids = drawBoard({ s, b, G, sig, lamp: (n) => (b.out[n] == null ? null : sig(b.out[n])), vec: L.startVec(s), live, edit: false, switches: false, interactive: false, names: s.names });
    let W = G.W, H = G.H;
    if (goal && !s.seq && (goal.type === 'build' || goal.type === 'fill' || goal.type === 'fix') && s.inputs.length <= 4) {
      const cols = goal.type === 'fill' ? goal.outputs.map((k) => ({ head: k, bits: null })) : Object.keys(goal.out).map((k) => ({ head: k, bits: goal.out[k] }));
      const tt = tableTree(s, cols, W + 12, 8);
      kids.push(el('g', {}, tt.kids));
      W += tt.W + 18;
      H = Math.max(H, tt.H + 16);
    }
    if (goal && goal.expr && goal.type !== 'fill') {
      const lines = Object.keys(goal.expr).map((k) => `${k} = ${goal.expr[k]}`);
      lines.forEach((ln, i) => kids.push(text(8, H + 16 + i * 17, ln, { 'font-size': 13, 'font-weight': 700, fill: INK })));
      H += 10 + lines.length * 17;
    }
    return toStr(el('svg', { xmlns: SVGNS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'font-family': FONT, role: 'img' }, kids));
  }

  function noteOf(s, why) {
    const w = why || {};
    switch (w.kind) {
      case 'lamp': return F('Wire the lamp {name} first.', { name: w.out });
      case 'loose': return F('{id} has an input with no wire.', { id: w.gate });
      case 'broken': return T('This circuit doesn’t hold together.');
      case 'loop': return T('The circuit has a loop: a gate’s output comes back to its own input.');
      case 'only': return F('Use only {types} gates.', { types: andList(w.only) });
      case 'max': return F('Use at most {n} gates; this uses {used}.', { n: w.max, used: w.used });
      case 'row': {
        const row = L.rowName(s, w.row);
        const got = w.got == null ? '–' : w.got;
        return s.outputs.length > 1 ? F('Row {row}: {name} gives {got}; it should give {want}.', { row, name: w.out, got, want: w.want }) : F('Row {row} gives {got}; it should give {want}.', { row, got, want: w.want });
      }
      case 'cells': return T('Fill in every row first.');
      case 'fill': return w.wrong === 1 ? F('One cell is wrong: check the row {row} again.', { row: L.rowName(s, w.row) }) : F('{n} cells are wrong: check the row {row} again.', { n: w.wrong, row: L.rowName(s, w.row) });
      case 'out': return F('{name} is {got}; it should be {want}.', { name: w.out, got: w.got == null ? '–' : w.got, want: w.want });
      case 'keep': return F('Now set {name} to {want}.', { name: w.input, want: w.want });
      case 'same': return T('Change the type of the gate that is wrong first.');
      default: return '';
    }
  }

  P.widgets.register('logic', {
    ready,

    block(host, spec, ctx) {
      return later(host, () => {
        const s = cleanSpec(spec);
        if (!s) { failed(host, new Error('this logic circuit does not hold together')); return null; }
        return mount(host, s, null, ctx || {}, 'block');
      });
    },

    task(host, spec, goal, ctx) {
      return later(host, () => {
        const tk = cleanTask(spec, goal);
        if (!tk) { failed(host, new Error('this logic task does not hold together')); return null; }
        return mount(host, tk.spec, tk.goal, ctx || {}, 'task');
      });
    },

    check(goal, value, spec) {
      const tk = cleanTask(spec, goal);
      if (!tk) return { correct: false, invalid: true };
      const r = L.check(tk.spec, tk.goal, value);
      const note = noteOf(tk.spec, r.why);
      return r.invalid ? { correct: false, invalid: true, note } : { correct: r.correct, note: r.correct ? '' : note };
    },

    describe(value, spec) {
      if (!value || typeof value !== 'object' || !L) return '';
      const s = cleanSpec(spec, true);
      if (!s) return '';
      if (Array.isArray(value.gates)) {
        const b = L.builtOf(s, value);
        if (!b) return '';
        const bits = b.outputs.filter((o) => o.from != null).map((o) => `${o.name} = ${L.exprOf(b, o.from) || o.from}`);
        return bits.length ? bits.join('; ') : L.gateList(b.gates, {});
      }
      if (value.cells && typeof value.cells === 'object') {
        return Object.keys(value.cells).filter((k) => Array.isArray(value.cells[k])).map((k) => `${k}: ${value.cells[k].map((v) => (v == null ? '?' : v)).join(' ')}`).join('; ');
      }
      if (value.types && typeof value.types === 'object') {
        return Object.keys(value.types).map((id) => F('{id} changed to {type}', { id, type: String(value.types[id]).slice(0, 6) })).join('; ');
      }
      if (value.set && typeof value.set === 'object') return s.inputs.map((x) => `${x.name} = ${value.set[x.name] ? 1 : 0}`).join(', ');
      return '';
    },

    answer(goal, spec) {
      const tk = cleanTask(spec, goal);
      if (!tk) return '';
      const g = tk.goal, s = tk.spec;
      if (g.type === 'build') return L.gateList(g.solution.gates, g.solution.outputs);
      if (g.type === 'fill') {
        const rows = [];
        for (let r = 0; r < 1 << s.inputs.length; r++) rows.push(L.rowBits(r, s.inputs.length).join(''));
        return g.outputs.map((k) => `${k}: ${g.out[k].split('').join(' ')}`).join('; ') + ' ' + F('(rows {rows})', { rows: rows.join(', ') });
      }
      if (g.type === 'find') {
        if (g.solution.set) return s.inputs.map((x) => `${x.name} = ${g.solution.set[x.name]}`).join(', ');
        return g.solution.path.map((p) => s.inputs.map((x, i) => `${x.name} = ${p[i]}`).join(', ')).join(' → ');
      }
      if (g.type === 'fix') {
        return Object.keys(g.solution).map((id) => F('Change {id} from {from} to {to}', { id, from: (s.gates.find((x) => x.id === id) || {}).type, to: g.solution[id] })).join('; ');
      }
      return '';
    },

    still(spec, goal) {
      if (!L) return '';
      const tk = goal ? cleanTask(spec, goal) : null;
      const s = tk ? tk.spec : cleanSpec(spec, true);
      if (!s) return '';
      try { return stillOf(s, tk ? tk.goal : null); } catch (e) { return ''; }
    }
  });
})();
