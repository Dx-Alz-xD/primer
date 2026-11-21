/* =====================================================================
   Circuits in lessons: the checker and the DC solver, shared by the
   server (server/widgets/circuit.mjs checks every circuit the AI writes,
   and that each task can be done) and the page (assets/js/widgets/
   circuit.js draws it, runs it live and checks the learner's tasks).
   The server imports this file; the page loads it with a script element
   (window.PrimerCircuit).

   A circuit (the "spec"), after normSpec:
     nodes     { "a": [0, 0], "b": [4, 0], ... }   named points on a grid,
               x and y from 0 to 10 in steps of 0.5 (y grows downward)
     parts     [{ id, type, from, to, value?, closed?, color?, label? }]
               cell, battery   value: volts; "to" is the + terminal
               resistor, bulb  value: ohms
               switch          closed: true or false
               led             lights only when current flows from -> to
               ammeter         about zero ohms; reads the current
               voltmeter       very high resistance; reads the voltage
               wire            (ids of wires are made here: ~1, ~2 ...)
     controls  [{ part: "S1" }, { part: "R1", min, max, step }]
               what the learner may change: switches, and sliders for a
               cell's, resistor's or bulb's value
     labels    [{ at: [x, y], text }]
   A task's goal, after normTask:
     { type: "light", on: [...], off: [...] }    these lamps lit, those not
     { type: "reading", meter, value, tolerance } a meter reads value
     { type: "connect", terminals: [...], on, off, meter?, value?, tolerance? }
               join two of the terminals with one wire so that it works
   The learner's attempt ("value"): { s: { S1: true }, v: { R1: 12 }, w: [a, b] }

   The solver: zero-ohm parts (wires, closed switches, ammeters) join nodes
   into one; cells are ideal voltage sources; modified nodal analysis with
   Gaussian elimination; an LED is 2 V plus 10 ohms when it conducts and
   open when it doesn't, settled by trying both until they agree; the
   current in each wire is shared out within the nodes it joins. A cell
   whose two ends are joined with no resistance, or two different cells
   joined straight across, is a short circuit: no numbers, a warning.
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerCircuit = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const GRID = 10;
  const LIMITS = { parts: 16, wires: 24, nodes: 24, leds: 6, controls: 8, sliders: 3, steps: 100, combos: 4096, labels: 6, terminals: 6 };
  const VF = 2;           // an LED's forward voltage
  const RON = 10;         // and its resistance when it conducts
  const RV = 1e7;         // a voltmeter
  const LIT_BULB = 0.1;   // a bulb is lit with at least a tenth of the voltage it could get
  const LIT_LED = 5e-4;   // an LED, from half a milliampere
  const FULL_LED = 0.02;  // fully bright at 20 mA
  const MAX_LED = 0.06;   // more than this would burn a real one out
  const OHM = 'Ω';

  const TYPES = {
    cell: { unit: 'V', min: 0.1, max: 100, source: true },
    battery: { unit: 'V', min: 0.1, max: 100, source: true },
    resistor: { unit: OHM, min: 0.1, max: 1e6 },
    bulb: { unit: OHM, min: 0.5, max: 1e4, lamp: true },
    switch: {},
    led: { lamp: true },
    ammeter: { meter: 'A' },
    voltmeter: { meter: 'V' },
    wire: {}
  };
  const ALIASES = {
    lamp: 'bulb', 'light bulb': 'bulb', 'electric bulb': 'bulb', light: 'bulb',
    resistance: 'resistor', rheostat: 'resistor', 'variable resistor': 'resistor',
    key: 'switch', 'plug key': 'switch', 'tap key': 'switch',
    'light-emitting diode': 'led', 'light emitting diode': 'led',
    cells: 'battery', 'dry cell': 'cell', source: 'cell',
    'connecting wire': 'wire', lead: 'wire', conductor: 'wire'
  };
  const COLORS = ['red', 'green', 'yellow', 'blue'];
  const hasValue = (type) => TYPES[type] && TYPES[type].min != null;

  class CircuitError extends Error {}
  const fail = (msg) => { throw new CircuitError(msg); };
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
  const ID = /^[A-Za-z][A-Za-z0-9_]{0,7}$/;
  const NODE = /^[A-Za-z0-9_]{1,8}$/;
  // text for the page: no control or direction-changing characters
  const txt = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const show = (v) => String(v).replace(/[^\w .:+-]/g, '').slice(0, 24);
  const round = (x) => Number(Number(x).toPrecision(9));

  // 6, "6", "1.5 V", "10 kΩ", "500 mA"
  const PREFIX = { k: 1e3, M: 1e6, m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6 };
  function parseNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string' || v.length > 40) return NaN;
    const m = /^\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*([kMmuµμ]?)\s*([A-Za-zΩωΩ]*)\s*$/.exec(v);
    if (!m) return NaN;
    if (m[3] && !/^(v|volts?|a|amps?|amperes?|ω|ohms?)$/.test(m[3].toLowerCase().replace('Ω', 'ω'))) return NaN;
    return Number(m[1]) * (m[2] ? PREFIX[m[2]] : 1);
  }
  function parseBool(v, dflt) {
    if (typeof v === 'boolean') return v;
    if (v === 1 || v === 0) return v === 1;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['closed', 'close', 'on', 'true', 'yes', '1'].includes(s)) return true;
      if (['open', 'off', 'false', 'no', '0'].includes(s)) return false;
    }
    return dflt;
  }
  const nodeName = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isInteger(v) ? String(v) : '');
  const snap = (x) => Math.round(x * 2) / 2;
  const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);

  function typeOf(v) {
    const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/_/g, ' ') : '';
    if (TYPES[s]) return s;
    return ALIASES[s] || '';
  }

  /* ---------------- the circuit ---------------- */

  // opts.loose: true (any loose end may be shown, as a terminal) or a Set of nodes that may be loose
  // opts.apart: the parts need not all be joined yet (a connect task, before its wire)
  // opts.fixed: nothing for the learner to change (a connect task)
  function normSpec(raw, opts = {}) {
    if (!isObj(raw)) fail('the spec is not an object');

    const nodes = new Map();
    const entries = Array.isArray(raw.nodes)
      ? raw.nodes.map((n) => (isObj(n) ? [n.id != null ? n.id : n.name, n.at != null ? n.at : n.pos != null ? n.pos : [n.x, n.y]] : null))
      : isObj(raw.nodes) ? Object.keys(raw.nodes).map((k) => [k, raw.nodes[k]]) : fail('there are no "nodes"');
    if (entries.length > LIMITS.nodes) fail(`more than ${LIMITS.nodes} nodes`);
    const taken = new Set();
    for (const ent of entries) {
      if (!ent) fail('a node is not an object');
      const id = nodeName(ent[0]);
      if (!NODE.test(id)) fail(`node "${show(ent[0])}" needs a short name (letters, digits, _)`);
      if (nodes.has(id)) fail(`node ${id} is given twice`);
      const p = Array.isArray(ent[1]) ? ent[1] : isObj(ent[1]) ? [ent[1].x, ent[1].y] : null;
      if (!p || p.length < 2) fail(`node ${id} has no [x, y]`);
      const x = snap(parseNum(p[0])), y = snap(parseNum(p[1]));
      if (!(x >= 0 && x <= GRID && y >= 0 && y <= GRID)) fail(`node ${id} is off the grid (x and y from 0 to ${GRID})`);
      if (taken.has(x + ',' + y)) fail(`two nodes are at [${x}, ${y}]`);
      taken.add(x + ',' + y);
      nodes.set(id, [x, y]);
    }

    const rawParts = Array.isArray(raw.parts) ? raw.parts : Array.isArray(raw.components) ? raw.components : fail('there are no "parts"');
    if (rawParts.length > LIMITS.parts + LIMITS.wires) fail('too many parts');
    const parts = [];
    const ids = new Set();
    let wires = 0, comps = 0, leds = 0;
    for (const p of rawParts) {
      if (!isObj(p)) fail('a part is not an object');
      const type = typeOf(p.type != null ? p.type : p.kind);
      if (!type) fail(`unknown part type "${show(p.type != null ? p.type : p.kind)}"`);
      const pair = Array.isArray(p.nodes) ? p.nodes : Array.isArray(p.between) ? p.between : Array.isArray(p.ends) ? p.ends
        : [p.from != null ? p.from : p.a, p.to != null ? p.to : p.b];
      const from = nodeName(pair[0]), to = nodeName(pair[1]);
      let id = typeof p.id === 'string' ? p.id.trim() : '';
      const what = type === 'wire' ? 'a wire' : `part ${show(id) || type}`;
      if (!nodes.has(from) || !nodes.has(to)) fail(`${what} joins a node that is not in "nodes" (${show(from)}, ${show(to)})`);
      if (from === to) fail(`${what} joins node ${from} to itself`);
      if (type === 'wire') {
        if (++wires > LIMITS.wires) fail(`more than ${LIMITS.wires} wires`);
        parts.push({ id: '~' + wires, type, from, to });
        continue;
      }
      if (!ID.test(id)) fail(`a ${type} needs a short id like R1 (got "${show(id)}")`);
      if (ids.has(id)) fail(`two parts are called ${id}`);
      ids.add(id);
      if (++comps > LIMITS.parts) fail(`more than ${LIMITS.parts} parts besides wires`);
      const out = { id, type, from, to };
      const T = TYPES[type];
      if (hasValue(type)) {
        const keys = T.source ? ['value', 'volts', 'voltage', 'emf', 'v'] : ['value', 'ohms', 'resistance', 'r'];
        const k = keys.find((key) => p[key] != null);
        const v = k ? parseNum(p[k]) : NaN;
        if (!Number.isFinite(v)) fail(`${id} needs a value in ${T.unit === 'V' ? 'volts' : 'ohms'}`);
        if (v < T.min || v > T.max) fail(`${id}'s value ${v} is outside ${T.min} to ${T.max} ${T.unit === 'V' ? 'V' : 'ohms'}`);
        out.value = round(v);
      }
      if (type === 'switch') out.closed = parseBool(p.closed != null ? p.closed : p.state != null ? p.state : p.on, false);
      if (type === 'led') {
        if (++leds > LIMITS.leds) fail(`more than ${LIMITS.leds} LEDs`);
        const c = typeof p.color === 'string' ? p.color.trim().toLowerCase() : typeof p.colour === 'string' ? p.colour.trim().toLowerCase() : '';
        out.color = COLORS.includes(c) ? c : 'red';
      }
      const label = txt(p.label, 16);
      if (label) out.label = label;
      parts.push(out);
    }
    if (!parts.some((p) => TYPES[p.type].source)) fail('there is no cell or battery');
    if (!parts.some((p) => TYPES[p.type].lamp || TYPES[p.type].meter)) fail('there is nothing to see: no bulb, LED or meter');

    // every end joined to something (or a terminal left loose on purpose)
    const deg = new Map();
    parts.forEach((p) => { deg.set(p.from, (deg.get(p.from) || 0) + 1); deg.set(p.to, (deg.get(p.to) || 0) + 1); });
    const mayLoose = (n) => opts.loose === true || (opts.loose instanceof Set && opts.loose.has(n));
    for (const [n] of nodes) {
      const d = deg.get(n) || 0;
      if (d === 1 && !mayLoose(n)) fail(`node ${n} is a loose end: only one part touches it`);
      if (d === 0 && !mayLoose(n)) nodes.delete(n); // unused: left out
    }
    if (!opts.apart && !opts.loose && groups(nodes, parts) > 1) fail('the parts are not all joined into one circuit');

    // what the learner may change
    const byId = new Map(parts.map((p) => [p.id, p]));
    const controls = [];
    const seen = new Set();
    let rawCtl = raw.controls;
    if (isObj(rawCtl)) rawCtl = [...list(rawCtl.switches), ...(Array.isArray(rawCtl.sliders) ? rawCtl.sliders : [])];
    if (opts.fixed) rawCtl = [];
    else if (rawCtl == null) rawCtl = parts.filter((p) => p.type === 'switch').map((p) => p.id);
    else if (!Array.isArray(rawCtl)) fail('"controls" is not a list');
    for (const c of rawCtl) {
      const pid = typeof c === 'string' ? c.trim() : isObj(c) ? String(c.part != null ? c.part : c.id != null ? c.id : '').trim() : '';
      const p = byId.get(pid);
      if (!p) fail(`a control names part "${show(pid)}", which is not in the circuit`);
      if (seen.has(pid)) continue;
      seen.add(pid);
      if (p.type === 'switch') { controls.push({ part: pid }); continue; }
      if (!hasValue(p.type)) fail(`${pid} is a ${p.type}: only switches and the values of cells, resistors and bulbs can be controls`);
      if (!isObj(c)) fail(`${pid} needs a slider: {"part": "${pid}", "min": ..., "max": ..., "step": ...}`);
      const T = TYPES[p.type];
      const min = parseNum(c.min), max = parseNum(c.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) fail(`${pid}'s slider needs a min below its max`);
      if (min < T.min || max > T.max) fail(`${pid}'s slider goes outside ${T.min} to ${T.max}`);
      let step = c.step != null ? parseNum(c.step) : (max - min) / 10;
      if (!Number.isFinite(step) || step <= 0) fail(`${pid}'s slider needs a step above 0`);
      const n = Math.floor((max - min) / step + 1e-9);
      if (n < 1) fail(`${pid}'s slider step is larger than its range`);
      if (n > LIMITS.steps) fail(`${pid}'s slider has more than ${LIMITS.steps} steps`);
      step = round(step);
      const slider = { part: pid, min: round(min), max: round(min + n * step), step };
      p.value = onSlider(slider, p.value);
      controls.push(slider);
    }
    if (controls.length > LIMITS.controls) fail(`more than ${LIMITS.controls} controls`);
    if (controls.filter((c) => c.step).length > LIMITS.sliders) fail(`more than ${LIMITS.sliders} sliders`);

    const labels = [];
    for (const l of Array.isArray(raw.labels) ? raw.labels.slice(0, LIMITS.labels) : []) {
      if (!isObj(l)) continue;
      const at = Array.isArray(l.at) ? l.at : [l.x, l.y];
      const x = snap(parseNum(at[0])), y = snap(parseNum(at[1])), text = txt(l.text, 40);
      if (text && x >= -1 && x <= GRID + 1 && y >= -1 && y <= GRID + 1) labels.push({ at: [x, y], text });
    }

    const spec = { nodes: {}, parts, controls, labels };
    for (const [n, pos] of nodes) spec.nodes[n] = pos;
    const start = run(compile(spec), stateOf(spec, null));
    if (start.short) fail('it is a short circuit as it starts');
    return spec;
  }

  // a slider's value: on one of its steps
  function onSlider(c, x) {
    const v = Number.isFinite(x) ? Math.min(c.max, Math.max(c.min, x)) : c.min;
    return round(c.min + Math.round((v - c.min) / c.step) * c.step);
  }

  // how many separate pieces the parts make (every part joins its two nodes, open or not)
  function groups(nodes, parts, extra) {
    const names = [...nodes.keys()];
    const ix = new Map(names.map((n, i) => [n, i]));
    const uf = names.map((_, i) => i);
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    const join = (a, b) => { const ra = find(ix.get(a)), rb = find(ix.get(b)); if (ra !== rb) uf[ra] = rb; };
    parts.forEach((p) => join(p.from, p.to));
    if (extra) join(extra[0], extra[1]);
    const used = new Set();
    parts.forEach((p) => { used.add(p.from); used.add(p.to); });
    return new Set(names.filter((n) => used.has(n)).map((n) => find(ix.get(n)))).size;
  }

  /* ---------------- the learner's settings ---------------- */

  // a clean state from what the learner did (or the start, for null): only what they may change
  function stateOf(spec, value, goal) {
    const st = { s: {}, v: {}, w: null };
    const byId = partsById(spec);
    for (const c of spec.controls) {
      const p = byId.get(c.part);
      if (!p) continue;
      if (p.type === 'switch') st.s[p.id] = value && own(value.s, p.id) ? parseBool(value.s[p.id], p.closed) : p.closed;
      else st.v[p.id] = onSlider(c, value && own(value.v, p.id) ? parseNum(value.v[p.id]) : p.value);
    }
    if (goal && goal.type === 'connect' && value && Array.isArray(value.w) && value.w.length === 2) {
      const a = nodeName(value.w[0]), b = nodeName(value.w[1]);
      if (a !== b && goal.terminals.includes(a) && goal.terminals.includes(b)) st.w = [a, b];
    }
    return st;
  }

  const cache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function partsById(spec) { return new Map(spec.parts.map((p) => [p.id, p])); }

  /* ---------------- the solver ---------------- */

  function compile(spec) {
    if (cache && cache.has(spec)) return cache.get(spec);
    const names = Object.keys(spec.nodes);
    const ix = new Map(names.map((n, i) => [n, i]));
    const parts = spec.parts.map((p) => ({ id: p.id, type: p.type, a: ix.get(p.from), b: ix.get(p.to), value: p.value, closed: p.closed }));
    // the most voltage any bulb could get: every cell at its highest
    let vref = 0;
    spec.parts.forEach((p) => {
      if (!TYPES[p.type].source) return;
      const c = spec.controls.find((x) => x.part === p.id && x.step);
      vref += c ? c.max : p.value;
    });
    const c = { spec, names, ix, parts, vref: vref || 1 };
    if (cache) cache.set(spec, c);
    return c;
  }

  // Gaussian elimination with partial pivoting; null when it can't be solved
  function gauss(A, rhs, n) {
    for (let col = 0; col < n; col++) {
      let piv = col, best = Math.abs(A[col * n + col]);
      for (let r = col + 1; r < n; r++) { const v = Math.abs(A[r * n + col]); if (v > best) { best = v; piv = r; } }
      if (best < 1e-12) return null;
      if (piv !== col) {
        for (let k = 0; k < n; k++) { const t = A[col * n + k]; A[col * n + k] = A[piv * n + k]; A[piv * n + k] = t; }
        const t = rhs[col]; rhs[col] = rhs[piv]; rhs[piv] = t;
      }
      const d = A[col * n + col];
      for (let r = col + 1; r < n; r++) {
        const f = A[r * n + col] / d;
        if (!f) continue;
        for (let k = col; k < n; k++) A[r * n + k] -= f * A[col * n + k];
        rhs[r] -= f * rhs[col];
      }
    }
    const x = new Float64Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = rhs[r];
      for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
      x[r] = s / A[r * n + r];
    }
    return x;
  }

  const zeroOhm = (e) => e.type === 'wire' || e.type === 'ammeter' || (e.type === 'switch' && e.closed);

  // node potentials, for the cells in reps and the LEDs that conduct (on)
  function nodal(n, els, sup, reps, on) {
    const cond = [];
    for (const e of els) {
      const p = sup[e.a], q = sup[e.b];
      if (p === q) continue;
      if (e.type === 'resistor' || e.type === 'bulb') cond.push([p, q, 1 / e.value, 0]);
      else if (e.type === 'voltmeter') cond.push([p, q, 1 / RV, 0]);
      else if (e.type === 'led' && on.has(e)) cond.push([p, q, 1 / RON, -VF / RON]);
    }
    const uf = Array.from({ length: n }, (_, i) => i);
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) uf[ra] = rb; };
    cond.forEach(([p, q]) => join(p, q));
    reps.forEach((r) => join(sup[r.a], sup[r.b]));
    const ref = new Map(); // each powered piece is measured from its first cell's - terminal
    reps.forEach((r) => { const k = find(sup[r.a]); if (!ref.has(k)) ref.set(k, sup[r.a]); });
    const idx = new Int32Array(n).fill(-1);
    let m = 0;
    for (let i = 0; i < n; i++) if (sup[i] === i && ref.has(find(i)) && ref.get(find(i)) !== i) idx[i] = m++;
    const size = m + reps.length;
    const A = new Float64Array(size * size), rhs = new Float64Array(size);
    for (const [p, q, g, j] of cond) { // current p -> q = g (Vp - Vq) + j
      const ip = idx[p], iq = idx[q];
      if (ip >= 0) { A[ip * size + ip] += g; rhs[ip] -= j; if (iq >= 0) A[ip * size + iq] -= g; }
      if (iq >= 0) { A[iq * size + iq] += g; rhs[iq] += j; if (ip >= 0) A[iq * size + ip] -= g; }
    }
    reps.forEach((r, k) => { // current k flows through the cell from - (a) to + (b)
      const row = m + k, ia = idx[sup[r.a]], ib = idx[sup[r.b]];
      if (ib >= 0) { A[ib * size + row] -= 1; A[row * size + ib] += 1; }
      if (ia >= 0) { A[ia * size + row] += 1; A[row * size + ia] -= 1; }
      rhs[row] = r.value;
    });
    const x = size ? gauss(A, rhs, size) : new Float64Array(0);
    if (!x) return null;
    const V = new Float64Array(n);
    for (let i = 0; i < n; i++) { const k = idx[sup[i]]; V[i] = k >= 0 ? x[k] : 0; }
    return { V, cellI: reps.map((_, k) => x[m + k]) };
  }

  function run(c, st) {
    const n = c.names.length;
    const els = c.parts.map((p) => {
      const e = { id: p.id, type: p.type, a: p.a, b: p.b, value: p.value, closed: p.closed };
      if (p.type === 'switch' && own(st.s, p.id)) e.closed = Boolean(st.s[p.id]);
      if (hasValue(p.type) && own(st.v, p.id)) e.value = st.v[p.id];
      return e;
    });
    if (st.w && c.ix.has(st.w[0]) && c.ix.has(st.w[1])) els.push({ id: '~+', type: 'wire', a: c.ix.get(st.w[0]), b: c.ix.get(st.w[1]) });

    // nodes joined with no resistance are one node
    const uf = Array.from({ length: n }, (_, i) => i);
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    els.forEach((e) => { if (zeroOhm(e)) { const ra = find(e.a), rb = find(e.b); if (ra !== rb) uf[ra] = rb; } });
    const sup = Array.from({ length: n }, (_, i) => find(i));

    const out = { short: null, V: {}, I: {}, lit: {}, glow: {}, read: {}, burn: [], float: [] };
    // a short circuit: a cell's ends joined with nothing in between, or cells of different voltages joined straight across
    const cells = els.filter((e) => TYPES[e.type].source);
    const shorted = cells.filter((e) => sup[e.a] === sup[e.b]);
    const reps = [], share = new Map();
    for (const e of cells) {
      if (sup[e.a] === sup[e.b]) continue;
      const r = reps.find((x) => (sup[x.a] === sup[e.a] && sup[x.b] === sup[e.b]) || (sup[x.a] === sup[e.b] && sup[x.b] === sup[e.a]));
      if (!r) { reps.push(e); share.set(e, [e]); continue; }
      if (sup[r.a] === sup[e.a] && Math.abs(r.value - e.value) < 1e-9) share.get(r).push(e); // the same cell again, side by side
      else shorted.push(e, r);
    }
    const leds = els.filter((e) => e.type === 'led');
    let sol = null;
    if (!shorted.length) {
      let on = new Set();
      let settled = false;
      for (let it = 0; it < 40 && !settled; it++) {
        sol = nodal(n, els, sup, reps, on);
        if (!sol) break;
        settled = true;
        for (const d of leds) {
          const vd = sol.V[d.a] - sol.V[d.b];
          if (!on.has(d) && vd > VF + 1e-9) { on.add(d); settled = false; }
          else if (on.has(d) && vd - VF < -1e-9) { on.delete(d); settled = false; }
        }
      }
      if (sol && !settled) { // rare: try every way the LEDs could be, for one that agrees with itself
        sol = null;
        for (let mask = 0; mask < (1 << leds.length) && !sol; mask++) {
          on = new Set(leds.filter((_, i) => mask & (1 << i)));
          const s = nodal(n, els, sup, reps, on);
          if (s && leds.every((d) => { const vd = s.V[d.a] - s.V[d.b]; return on.has(d) ? vd >= VF - 1e-9 : vd <= VF + 1e-9; })) sol = s;
        }
      }
      if (sol) sol.on = on;
    }
    if (!sol) {
      // nothing else means anything: which parts make the short
      const bad = new Set(shorted.length ? shorted.map((e) => sup[e.a]) : []);
      out.short = {
        cells: [...new Set((shorted.length ? shorted : cells).map((e) => e.id))],
        path: els.filter((e) => zeroOhm(e) && bad.has(sup[e.a])).map((e) => e.id)
      };
      return out;
    }

    const { V } = sol;
    c.names.forEach((name, i) => { out.V[name] = round(V[i]); });
    const I = new Map();
    for (const e of els) {
      if (zeroOhm(e)) continue;
      const dv = V[e.a] - V[e.b];
      if (e.type === 'resistor' || e.type === 'bulb') I.set(e, dv / e.value);
      else if (e.type === 'voltmeter') I.set(e, dv / RV);
      else if (e.type === 'led') I.set(e, sol.on.has(e) && sup[e.a] !== sup[e.b] ? Math.max(0, (dv - VF) / RON) : 0);
      else I.set(e, 0);
    }
    reps.forEach((r, k) => { const g = share.get(r); g.forEach((e) => I.set(e, sol.cellI[k] / g.length)); });

    // the current in each wire, closed switch and ammeter: shared out within the nodes they join
    const inj = new Float64Array(n);
    I.forEach((i, e) => { inj[e.a] -= i; inj[e.b] += i; });
    const members = new Map();
    for (let i = 0; i < n; i++) { if (!members.has(sup[i])) members.set(sup[i], []); members.get(sup[i]).push(i); }
    members.forEach((nodesIn, s) => {
      const edges = els.filter((e) => zeroOhm(e) && sup[e.a] === s);
      if (!edges.length) return;
      if (nodesIn.length < 2) { edges.forEach((e) => I.set(e, 0)); return; }
      const loc = new Map(nodesIn.map((v, i) => [v, i - 1])); // the first is the reference
      const k = nodesIn.length - 1;
      const A = new Float64Array(k * k), rhs = new Float64Array(k);
      for (const e of edges) {
        const p = loc.get(e.a), q = loc.get(e.b);
        if (p >= 0) { A[p * k + p] += 1; if (q >= 0) A[p * k + q] -= 1; }
        if (q >= 0) { A[q * k + q] += 1; if (p >= 0) A[q * k + p] -= 1; }
      }
      nodesIn.forEach((v) => { const p = loc.get(v); if (p >= 0) rhs[p] = inj[v]; });
      const phi = gauss(A, rhs, k) || new Float64Array(k);
      const at = (v) => (loc.get(v) >= 0 ? phi[loc.get(v)] : 0);
      edges.forEach((e) => I.set(e, at(e.a) - at(e.b)));
    });

    const tiny = (x) => (Math.abs(x) < 1e-9 ? 0 : round(x));
    I.forEach((i, e) => { out.I[e.id] = tiny(i); });
    for (const e of els) {
      const dv = Math.abs(V[e.a] - V[e.b]);
      const i = Math.abs(I.get(e) || 0);
      if (e.type === 'bulb') {
        const g = Math.min(1, dv / c.vref);
        out.lit[e.id] = g >= LIT_BULB;
        out.glow[e.id] = round(g * g); // brightness goes with power
      } else if (e.type === 'led') {
        out.lit[e.id] = i >= LIT_LED;
        out.glow[e.id] = round(Math.min(1, i / FULL_LED));
        if (i > MAX_LED) out.burn.push(e.id);
      } else if (e.type === 'ammeter') out.read[e.id] = tiny(i);
      else if (e.type === 'voltmeter') out.read[e.id] = tiny(dv);
    }
    // parts that no cell can reach, however the switches are set
    const reach = new Set();
    const adj = new Map();
    els.forEach((e) => { [[e.a, e.b], [e.b, e.a]].forEach(([x, y]) => { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); }); });
    const todo = cells.map((e) => e.a);
    while (todo.length) { const x = todo.pop(); if (reach.has(x)) continue; reach.add(x); (adj.get(x) || []).forEach((y) => todo.push(y)); }
    out.float = els.filter((e) => !reach.has(e.a) && e.id !== '~+').map((e) => e.id);
    return out;
  }

  // the circuit as it is with the learner's settings (value), or as it starts
  function solve(spec, value, goal) { return run(compile(spec), stateOf(spec, value, goal)); }

  /* ---------------- tasks ---------------- */

  const lampsOf = (spec) => spec.parts.filter((p) => TYPES[p.type].lamp).map((p) => p.id);
  const metersOf = (spec) => spec.parts.filter((p) => TYPES[p.type].meter).map((p) => p.id);

  function goalType(v) {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (['light', 'lights', 'lamp', 'lamps', 'bulbs', 'on'].includes(s)) return 'light';
    if (['reading', 'read', 'meter', 'value', 'measure'].includes(s)) return 'reading';
    if (['connect', 'wire', 'join', 'complete'].includes(s)) return 'connect';
    return '';
  }

  function lampSets(spec, g, needSome) {
    const lamps = lampsOf(spec);
    const ids = (v, what) => list(v).map((x) => {
      const id = typeof x === 'string' ? x.trim() : '';
      if (!lamps.includes(id)) fail(`the goal's "${what}" names ${show(id) || 'something'}, which is not a bulb or LED in the circuit`);
      return id;
    });
    const on = [...new Set(ids(g.on != null ? g.on : g.lit, 'on'))];
    // without "off", every other lamp must be off
    const off = g.off != null ? [...new Set(ids(g.off, 'off'))] : on.length ? lamps.filter((id) => !on.includes(id)) : [];
    if (on.some((id) => off.includes(id))) fail('a lamp is both "on" and "off" in the goal');
    if (needSome && !on.length && !off.length) fail('the goal names no bulb or LED');
    return { on, off };
  }

  function meterGoal(spec, g) {
    const meter = typeof g.meter === 'string' ? g.meter.trim() : '';
    if (!metersOf(spec).includes(meter)) fail(`the goal's meter ${show(meter) || '(none)'} is not an ammeter or voltmeter in the circuit`);
    const value = parseNum(g.value != null ? g.value : g.reads);
    if (!Number.isFinite(value) || value < 0 || value > 1e4) fail('the goal needs the reading as a number');
    let tol = g.tolerance != null ? parseNum(g.tolerance) : NaN;
    if (!Number.isFinite(tol) || tol <= 0) tol = Math.max(0.02 * value, 1e-3);
    tol = Math.min(tol, Math.max(0.1 * value, 1e-3));
    return { meter, value: round(value), tolerance: round(tol) };
  }

  // does this state meet the goal? why not, if not
  function meets(c, goal, st) {
    const r = run(c, st);
    if (goal.type === 'connect' && !st.w) return { ok: false, why: { wire: true }, r };
    if (r.short) return { ok: false, why: { short: true }, r };
    for (const id of goal.on || []) if (!r.lit[id]) return { ok: false, why: { lamp: id, want: true }, r };
    for (const id of goal.off || []) if (r.lit[id]) return { ok: false, why: { lamp: id, want: false }, r };
    if (goal.meter) {
      const got = r.read[goal.meter];
      if (!(Math.abs(got - goal.value) <= goal.tolerance + 1e-12)) return { ok: false, why: { meter: goal.meter, got }, r };
    }
    return { ok: true, r };
  }

  // every setting of the controls (switches open and closed, sliders at each step)
  function settings(spec) {
    const dims = spec.controls.map((c) => (c.step ? Math.round((c.max - c.min) / c.step) + 1 : 2));
    const count = dims.reduce((a, b) => a * b, 1);
    function* all() {
      const k = new Array(dims.length).fill(0);
      for (let i = 0; i < count; i++) {
        const st = { s: {}, v: {}, w: null };
        spec.controls.forEach((c, j) => { if (c.step) st.v[c.part] = round(c.min + k[j] * c.step); else st.s[c.part] = k[j] === 1; });
        yield st;
        for (let j = 0; j < dims.length; j++) { if (++k[j] < dims[j]) break; k[j] = 0; }
      }
    }
    return { count, all };
  }

  const changes = (a, b) => Object.keys(a.s).filter((k) => a.s[k] !== b.s[k]).length + Object.keys(a.v).filter((k) => a.v[k] !== b.v[k]).length;

  // the settings that meet a goal, the one with the fewest changes first; null if none does
  function solution(spec, goal) {
    const c = compile(spec);
    const start = stateOf(spec, null);
    if (goal.type === 'connect') {
      const t = goal.terminals;
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        const st = { s: start.s, v: start.v, w: [t[i], t[j]] };
        if (meets(c, goal, st).ok) return st;
      }
      return null;
    }
    const all = settings(spec);
    if (all.count > LIMITS.combos) return null;
    let best = null, bestScore = Infinity;
    for (const st of all.all()) {
      const m = meets(c, goal, st);
      if (!m.ok) continue;
      const err = goal.meter ? Math.abs(m.r.read[goal.meter] - goal.value) / (goal.tolerance || 1) : 0;
      const score = changes(st, start) + err * 0.5;
      if (score < bestScore) { best = st; bestScore = score; }
    }
    return best;
  }

  // A task: the circuit and its goal, checked; the goal can be met and isn't met from the start.
  function normTask(rawSpec, rawGoal) {
    if (!isObj(rawGoal)) fail('the goal is not an object');
    const type = goalType(rawGoal.type != null ? rawGoal.type : rawGoal.kind);
    if (!type) fail(`unknown goal type "${show(rawGoal.type)}" (light, reading or connect)`);
    let spec, goal;
    if (type === 'connect') {
      const terminals = [...new Set(list(rawGoal.terminals != null ? rawGoal.terminals : rawGoal.nodes).map(nodeName))];
      if (terminals.length < 3 || terminals.length > LIMITS.terminals) fail(`a connect goal needs 3 to ${LIMITS.terminals} terminals to choose from`);
      spec = normSpec(rawSpec, { loose: new Set(terminals), apart: true, fixed: true });
      terminals.forEach((n) => { if (!own(spec.nodes, n)) fail(`terminal ${show(n)} is not a node of the circuit`); });
      goal = { type, terminals, ...lampSets(spec, rawGoal, false) };
      if (rawGoal.meter != null) Object.assign(goal, meterGoal(spec, rawGoal));
      if (!goal.on.length && !goal.meter) { goal.on = lampsOf(spec); goal.off = []; }
      if (!goal.on.length && !goal.meter) fail('a connect goal needs a bulb or LED to light, or a meter reading');
    } else {
      spec = normSpec(rawSpec);
      if (!spec.controls.length) fail('the task gives the learner nothing to change (no controls)');
      goal = type === 'light' ? { type, ...lampSets(spec, rawGoal, true) } : { type, ...meterGoal(spec, rawGoal) };
    }
    const c = compile(spec);
    if (type !== 'connect' && settings(spec).count > LIMITS.combos) fail(`too many settings to check (more than ${LIMITS.combos})`);
    if (meets(c, goal, stateOf(spec, null)).ok) fail('the circuit already meets the goal as it starts');
    const best = solution(spec, goal);
    if (!best) fail('no setting of the controls meets the goal');
    if (type === 'connect') {
      if (groups(new Map(Object.entries(spec.nodes)), spec.parts, best.w) > 1) fail('even with the wire, the parts are not all joined');
      const t = goal.terminals;
      let wrong = 0;
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (!meets(c, goal, { s: {}, v: {}, w: [t[i], t[j]] }).ok) wrong++;
      if (!wrong) fail('every wire works, so there is nothing to choose');
    }
    return { spec, goal };
  }

  // the learner's attempt, checked: { correct, invalid?, why? }
  function check(spec, goal, value) {
    if (!isObj(value)) return { correct: false, invalid: true };
    const st = stateOf(spec, value, goal);
    if (goal.type === 'connect' && !st.w) return { correct: false, invalid: true, why: { wire: true } };
    const m = meets(compile(spec), goal, st);
    return { correct: m.ok, why: m.why || null };
  }

  /* ---------------- numbers, as a textbook writes them ---------------- */

  const sig = (x) => String(Number(Number(x).toPrecision(3)));
  function fmtValue(unit, x) {
    const a = Math.abs(x);
    if (unit === OHM) return a >= 1e6 ? sig(x / 1e6) + ' M' + OHM : a >= 1e3 ? sig(x / 1e3) + ' k' + OHM : sig(x) + ' ' + OHM;
    if (unit === 'A') return a === 0 ? '0 A' : a < 0.1 ? sig(x * 1e3) + ' mA' : sig(x) + ' A';
    if (unit === 'V') return a === 0 ? '0 V' : a < 0.01 ? sig(x * 1e3) + ' mV' : sig(x) + ' V';
    return sig(x);
  }
  const unitOf = (type) => (TYPES[type] ? TYPES[type].unit || TYPES[type].meter || '' : '');

  return {
    GRID, LIMITS, TYPES, COLORS, VF, CircuitError,
    normSpec, normTask, stateOf, solve, check, solution, settings,
    lampsOf, metersOf, hasValue, fmtValue, unitOf, parseNum, text: txt
  };
});
