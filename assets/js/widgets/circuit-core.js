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

   Build mode (a spec with "build": true, or a "palette"): the learner puts
   the parts on a grid of dots themselves, and the same solver runs on what
   they build. See "build mode" below for its spec, the learner's build and
   its goals (bulbs lit, parts in series or in parallel, a reading, an
   equivalent resistance, a meter placed right, a switch that controls a
   lamp), each checked on the learner's netlist, whatever its layout.
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
    // a circuit the learner builds: its own checks (a block's, unless only drawn or described)
    if (isBuild(raw)) return normBuildSpec(raw, { block: !opts.loose && !opts.apart && !opts.fixed });

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
    if (start.short) fail(shortWhy(spec, start));
    return spec;
  }

  // a short circuit as it starts, in words the AI can act on: what joins which cell's ends
  function shortWhy(spec, r) {
    const type = (id) => (spec.parts.find((p) => p.id === id) || {}).type;
    const amm = r.short.path.filter((id) => type(id) === 'ammeter'), sw = r.short.path.filter((id) => type(id) === 'switch');
    const what = [amm.length ? `the ammeter ${amm.join(', ')}` : '', sw.length ? `the closed switch ${sw.join(', ')}` : '', r.short.path.some((id) => type(id) === 'wire') ? 'wires' : ''].filter(Boolean);
    return `it is a short circuit as it starts: nothing but ${what.join(' and ') || 'wires'} joins the two ends of ${r.short.cells.join(' and ')}`
      + (amm.length ? ' (an ammeter goes in series, in the loop, never straight across a cell)' : sw.length ? ' (open the switch, or put a part in its path)' : ' (put a bulb or resistor in the loop)');
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
    if (isBuild(rawSpec)) return normBuildTask(rawSpec, rawGoal);
    const type = goalType(rawGoal.type != null ? rawGoal.type : rawGoal.kind);
    if (!type && buildGoalType(rawGoal.type != null ? rawGoal.type : rawGoal.kind)) fail(`"${show(rawGoal.type)}" is a build goal: give the spec "build": true and a "palette" for the learner to build from`);
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
    if (spec && spec.build) return checkBuild(spec, goal, value);
    if (!isObj(value)) return { correct: false, invalid: true };
    const st = stateOf(spec, value, goal);
    if (goal.type === 'connect' && !st.w) return { correct: false, invalid: true, why: { wire: true } };
    const m = meets(compile(spec), goal, st);
    return { correct: m.ok, why: m.why || null };
  }

  /* ---------------- build mode: the learner places the parts ----------------

     A build spec, after normSpec:
       build       true
       grid        [W, H]: dots at whole x from 0 to W, y from 0 to H (W up to 8, H up to 6; 6 by 4 if not given)
       nodes       { "P": [x, y] }  labelled dots (shown with their names: for "the resistance between P and Q")
       parts       placed at the start: { id, type, from: [x, y], to: [x, y], value?, values?, closed?, color?, label?, locked }
                   (locked: it stays where it is; its switch can still be tapped, its value chosen from "values")
       palette     [{ type, ids: ["R1", "R2"], values: [4] (or a choice: [2, 4, 6]), color? }, { type: "wire", count }]
                   its parts are named after the spec's own: R1, R2 ... by type, in order
       resistance  ["P", "Q"]: the resistance between them is shown, live
     Every part lies along a row or a column between two dots, a wire too. A wire joins every dot it passes;
     another part joins only its two ends, and nothing may touch its middle (its leads). Two parts may share
     the same two dots (a voltmeter across a resistor, a wire across a bulb), drawn side by side.
     The learner's build (the "value"): { parts: [{ id, type, from, to, value?, closed? }, { type: "wire", from, to }] },
     everything on the board, the spec's fixed parts too (only their switch and value count).
     A build goal names parts by id and carries "answer", a build that meets it made only from the palette:
       { type: "lit", on: [...], off: [...], order?: [brightest ... dimmest], equal?: [...] }
       { type: "series" | "parallel", parts: [...] }        those parts carry current, all in series or in parallel
       { type: "reading", meter, value, tolerance }          a meter placed rightly reads it
       { type: "equivalent", between: [P, Q], value, tolerance }   the resistance between two labelled dots
       { type: "measure", meter, part }                      a voltmeter across the part, or an ammeter in series with it
       { type: "control", switch, on: [...] }                the switch turns those lamps on and off, and no other
     Checks look at the netlist: wires, closed switches and ammeters join dots into one node; two parts are in
     parallel when they join the same two nodes, and in series when every loop through one goes through the
     other (removing both splits the circuit, removing either alone does not).
  */

  const BUILD = { w: 6, h: 4, maxW: 8, maxH: 6, wires: 40, wiresDefault: 30, choices: 12 };
  const ID_PREFIX = { cell: 'B', battery: 'B', resistor: 'R', bulb: 'L', switch: 'S', led: 'D', ammeter: 'A', voltmeter: 'V' };
  const DEFAULTS = { cell: 1.5, battery: 6, resistor: 10, bulb: 10 };
  const LOADS = ['resistor', 'bulb', 'led', 'cell', 'battery'];
  const pkey = (p) => p[0] + ',' + p[1];
  const samePt = (a, b) => a[0] === b[0] && a[1] === b[1];
  const straight = (a, b) => (a[0] === b[0]) !== (a[1] === b[1]);
  const sameSpan = (p, a, b) => (samePt(p.from, a) && samePt(p.to, b)) || (samePt(p.from, b) && samePt(p.to, a));
  const edgeKey = (p, q) => (p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? pkey(p) + '|' + pkey(q) : pkey(q) + '|' + pkey(p));
  const where = (p) => `[${p[0]}, ${p[1]}]`;
  // the dots along a straight span, both ends included
  function along(a, b) {
    const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    const out = [];
    for (let i = 0; i <= n; i++) out.push([a[0] + dx * i, a[1] + dy * i]);
    return out;
  }
  const ends = (p) => (Array.isArray(p.nodes) ? p.nodes : Array.isArray(p.between) ? p.between : Array.isArray(p.ends) ? p.ends
    : [p.from != null ? p.from : p.a, p.to != null ? p.to : p.b]);
  const copyPart = (p) => { const q = Object.assign({}, p, { from: p.from.slice(), to: p.to.slice() }); if (p.values) q.values = p.values.slice(); return q; };

  function isBuild(raw) {
    return isObj(raw) && (parseBool(raw.build, false) === true || raw.mode === 'build' || raw.palette != null);
  }

  // a point: a labelled node's name, or [x, y] on the grid's dots
  function buildPoint(v, nodes, grid, what) {
    let p;
    if (typeof v === 'string' || typeof v === 'number') {
      const n = nodeName(v);
      if (!nodes.has(n)) fail(`${what} names "${show(n)}", which is not in "nodes" (or give an [x, y] point)`);
      p = nodes.get(n);
    } else if (Array.isArray(v) && v.length >= 2) p = [parseNum(v[0]), parseNum(v[1])];
    else if (isObj(v)) p = [parseNum(v.x), parseNum(v.y)];
    else fail(`${what} needs a point: a node's name or [x, y]`);
    const x = Math.round(p[0]), y = Math.round(p[1]);
    if (!(Math.abs(x - p[0]) < 0.01 && Math.abs(y - p[1]) < 0.01)) fail(`${what} [${show(p[0])}, ${show(p[1])}] is not on a dot: build points are whole numbers`);
    if (!(x >= 0 && y >= 0 && (!grid || (x <= grid[0] && y <= grid[1])))) fail(`${what} [${x}, ${y}] is off the grid (x 0 to ${grid ? grid[0] : BUILD.maxW}, y 0 to ${grid ? grid[1] : BUILD.maxH})`);
    return [x, y];
  }

  function checkValue(type, v, who) {
    const T = TYPES[type];
    if (!Number.isFinite(v)) fail(`${who} needs a value in ${T.unit === 'V' ? 'volts' : 'ohms'}`);
    if (v < T.min || v > T.max) fail(`${who}'s value ${show(v)} is outside ${T.min} to ${T.max} ${T.unit === 'V' ? 'V' : 'ohms'}`);
    return round(v);
  }
  const valueKeys = (type) => (TYPES[type].source ? ['value', 'volts', 'voltage', 'emf', 'v'] : ['value', 'ohms', 'resistance', 'r']);
  function valueIn(raw, type) {
    const k = valueKeys(type).find((key) => raw[key] != null);
    return k ? parseNum(raw[k]) : NaN;
  }
  // a choice of values: a list, or {min, max, step}
  function choiceList(type, v, who) {
    let xs;
    if (Array.isArray(v)) xs = v.map(parseNum);
    else if (isObj(v) && v.min != null && v.max != null) {
      const min = parseNum(v.min), max = parseNum(v.max), step = v.step != null ? parseNum(v.step) : (max - min) / 4;
      if (!(Number.isFinite(min) && Number.isFinite(max) && step > 0 && max > min)) fail(`${who}'s choice needs a min below its max, and a step`);
      xs = [];
      for (let x = min; x <= max + 1e-9 && xs.length <= BUILD.choices; x += step) xs.push(round(x));
    } else fail(`${who}'s "values" is a list, like [2, 4, 6]`);
    const out = [...new Set(xs.map((x) => checkValue(type, x, who)))];
    if (!out.length) fail(`${who}'s "values" is empty`);
    if (out.length > BUILD.choices) fail(`${who} has more than ${BUILD.choices} values to choose from`);
    return out;
  }
  const colorOf = (p) => { const c = typeof p.color === 'string' ? p.color.trim().toLowerCase() : typeof p.colour === 'string' ? p.colour.trim().toLowerCase() : ''; return COLORS.includes(c) ? c : 'red'; };
  function freeId(type, taken) {
    let k = 1;
    while (taken.has(ID_PREFIX[type] + k)) k++;
    return ID_PREFIX[type] + k;
  }

  // why a part can't go there: '' when it can (ignore: the id of a part being moved)
  const PLACE_WHY = {
    off: 'is off the grid',
    same: 'starts and ends on the same dot',
    bent: 'is not along a row or a column',
    covered: 'crosses the middle of another part (a part joins only at its two ends)',
    overlap: 'runs along the same stretch as another part',
    full: 'is on two dots that already have two parts (or a wire) between them'
  };
  function placeWhy(spec, parts, c, ignore) {
    const W = spec.grid[0], H = spec.grid[1];
    if (![c.from, c.to].every((p) => p[0] >= 0 && p[1] >= 0 && p[0] <= W && p[1] <= H)) return 'off';
    if (samePt(c.from, c.to)) return 'same';
    if (!straight(c.from, c.to)) return 'bent';
    const cw = c.type === 'wire';
    const cPts = along(c.from, c.to), cIn = cPts.slice(1, -1);
    const hits = (pts, mid) => pts.some((p) => mid.some((q) => samePt(p, q)));
    if (!cw && hits(Object.keys(spec.nodes).map((n) => spec.nodes[n]), cIn)) return 'covered';
    const cEdges = new Set();
    for (let i = 0; i < cPts.length - 1; i++) cEdges.add(edgeKey(cPts[i], cPts[i + 1]));
    let same = 0;
    for (const q of parts) {
      if (ignore != null && q.id === ignore) continue;
      const qw = q.type === 'wire';
      if (sameSpan(q, c.from, c.to)) {
        if ((qw && cw) || ++same >= 2) return 'full';
        continue;
      }
      const qPts = along(q.from, q.to);
      for (let i = 0; i < qPts.length - 1; i++) if (cEdges.has(edgeKey(qPts[i], qPts[i + 1]))) return 'overlap';
      if (!qw && hits(cPts, qPts.slice(1, -1))) return 'covered';
      if (!cw && hits(qPts, cIn)) return 'covered';
    }
    return '';
  }
  // a wire from a to b: straight, or round one corner; the pieces, or null if there's no room
  function wireRoute(spec, parts, a, b) {
    if (samePt(a, b)) return null;
    const ways = straight(a, b) ? [[[a, b]]] : [[[a, [b[0], a[1]]], [[b[0], a[1]], b]], [[a, [a[0], b[1]]], [[a[0], b[1]], b]]];
    for (const segs of ways) {
      const placed = parts.slice();
      let ok = true;
      for (const [p, q] of segs) {
        const c = { id: '~?', type: 'wire', from: p, to: q };
        if (placeWhy(spec, placed, c)) { ok = false; break; }
        placed.push(c);
      }
      if (ok) return segs;
    }
    return null;
  }

  // the palette: { type: count | [values or colours] | { count, value, values, color, ids } } or a list of those
  function normPalette(raw, taken, comps0, leds0) {
    const items = [];
    if (raw == null) raw = {};
    if (Array.isArray(raw)) raw.forEach((x) => { if (!isObj(x)) fail('a palette entry is not an object'); items.push([x.type != null ? x.type : x.kind, x]); });
    else if (isObj(raw)) Object.keys(raw).forEach((k) => items.push([k, raw[k]]));
    else fail('"palette" is an object, like {"resistor": [4, 4], "wire": 10}');
    const subs = [];
    let wires = null;
    const sub = (type, x) => {
      const who = `the palette's ${type}`;
      let n = x.count != null ? parseNum(x.count) : x.n != null ? parseNum(x.n) : NaN;
      const idsRaw = Array.isArray(x.ids) ? x.ids.map((s) => (typeof s === 'string' ? s.trim() : '')) : null;
      if (!Number.isFinite(n)) n = idsRaw ? idsRaw.length : 1;
      n = Math.round(n);
      if (!(n >= 0 && n <= LIMITS.parts)) fail(`${who} count ${show(x.count)} is not a small whole number`);
      const s = { type, n, ids: idsRaw || [] };
      if (hasValue(type)) {
        const ch = x.values != null ? x.values : x.choices != null ? x.choices : x.min != null ? x : null;
        if (ch != null) s.values = choiceList(type, ch, who);
        else { const v = valueIn(x, type); s.values = [checkValue(type, Number.isFinite(v) ? v : DEFAULTS[type], who)]; }
      }
      if (type === 'led') s.color = colorOf(x);
      subs.push(s);
    };
    // "bulbs", "switches", "batteries", "cells": a palette names kinds of part, often in the plural
    const kind = (k) => {
      const s = typeof k === 'string' ? k.trim().toLowerCase().replace(/_/g, ' ') : '';
      const one = [s.replace(/ies$/, 'y'), s.replace(/(ch|sh)es$/, '$1'), s.replace(/s$/, '')].find((x) => x !== s && TYPES[x]);
      return one || typeOf(k);
    };
    for (const [tRaw, v] of items) {
      const type = kind(tRaw);
      if (!type) fail(`the palette has an unknown part "${show(tRaw)}"`);
      if (type === 'wire') {
        const n = v === true ? BUILD.wiresDefault : parseNum(isObj(v) ? v.count : v);
        if (!(Number.isFinite(n) && n >= 0)) fail('the palette\'s "wire" is how many wires, like 10');
        wires = Math.min(BUILD.wires, (wires || 0) + Math.round(n));
        continue;
      }
      const key = type === 'led' ? 'color' : 'value';
      if (Array.isArray(v)) v.forEach((x) => sub(type, isObj(x) ? x : { count: 1, [key]: x }));
      else if (isObj(v)) sub(type, v);
      else if (typeof v === 'number' || (typeof v === 'string' && /^\s*\d+\s*$/.test(v))) sub(type, { count: v });
      else if (v === true) sub(type, { count: 1 });
      else if (typeof v === 'string') sub(type, { count: 1, [key]: v });
      else fail(`the palette's "${type}" is a count, a list of values, or {"count": ..., "value": ...}`);
    }
    // the same part twice is one group
    const groups = [];
    for (const s of subs) {
      const k = [s.type, JSON.stringify(s.values || null), s.color || ''].join('|');
      const g = groups.find((x) => x.k === k);
      if (g) { g.n += s.n; g.ids.push(...s.ids); } else groups.push(Object.assign({ k }, s));
    }
    let comps = comps0, leds = leds0;
    const out = [];
    for (const g of groups) {
      if (!g.n) continue;
      comps += g.n;
      if (g.type === 'led') leds += g.n;
      if (comps > LIMITS.parts) fail(`more than ${LIMITS.parts} parts in all, placed and in the palette`);
      if (leds > LIMITS.leds) fail(`more than ${LIMITS.leds} LEDs`);
      const ids = [];
      for (let i = 0; i < g.n; i++) {
        let id = g.ids[i];
        if (!(id && ID.test(id) && !taken.has(id))) id = freeId(g.type, taken);
        taken.add(id);
        ids.push(id);
      }
      const o = { type: g.type, ids };
      if (g.values) o.values = g.values;
      if (g.color) o.color = g.color;
      out.push(o);
    }
    out.push({ type: 'wire', count: wires == null ? BUILD.wiresDefault : wires });
    return out;
  }

  function normBuildSpec(raw, opts = {}) {
    // the labelled dots
    const nodes = new Map();
    const entries = raw.nodes == null ? []
      : Array.isArray(raw.nodes) ? raw.nodes.map((n) => (isObj(n) ? [n.id != null ? n.id : n.name, n.at != null ? n.at : n.pos != null ? n.pos : [n.x, n.y]] : null))
        : isObj(raw.nodes) ? Object.keys(raw.nodes).map((k) => [k, raw.nodes[k]]) : fail('"nodes" is not an object');
    if (entries.length > LIMITS.nodes) fail(`more than ${LIMITS.nodes} nodes`);
    const at = new Set();
    for (const ent of entries) {
      if (!ent) fail('a node is not an object');
      const id = nodeName(ent[0]);
      if (!NODE.test(id)) fail(`node "${show(ent[0])}" needs a short name (letters, digits, _)`);
      if (nodes.has(id)) fail(`node ${id} is given twice`);
      const p = buildPoint(Array.isArray(ent[1]) || isObj(ent[1]) ? ent[1] : null, nodes, null, `node ${id}`);
      if (at.has(pkey(p))) fail(`two nodes are at ${where(p)}`);
      at.add(pkey(p));
      nodes.set(id, p);
    }
    const rawParts = raw.parts == null ? [] : Array.isArray(raw.parts) ? raw.parts : Array.isArray(raw.components) ? raw.components : fail('"parts" is not a list');
    if (rawParts.length > LIMITS.parts + BUILD.wires) fail('too many parts');

    // the grid: as given, or big enough for every point (at least 6 by 4)
    let W, H;
    const g = raw.grid != null ? raw.grid : raw.size;
    if (g != null) {
      W = Math.round(parseNum(Array.isArray(g) ? g[0] : isObj(g) ? (g.w != null ? g.w : g.width) : g));
      H = Math.round(parseNum(Array.isArray(g) ? g[1] : isObj(g) ? (g.h != null ? g.h : g.height) : NaN));
      if (!(W >= 2 && W <= BUILD.maxW && H >= 1 && H <= BUILD.maxH)) fail(`"grid" is [width, height], from [2, 1] to [${BUILD.maxW}, ${BUILD.maxH}]`);
    } else {
      let mx = 0, my = 0;
      const see = (v) => { if (Array.isArray(v) && v.length >= 2) { mx = Math.max(mx, Math.round(parseNum(v[0])) || 0); my = Math.max(my, Math.round(parseNum(v[1])) || 0); } };
      nodes.forEach(see);
      rawParts.forEach((p) => { if (isObj(p)) ends(p).forEach(see); });
      W = Math.min(BUILD.maxW, Math.max(BUILD.w, mx));
      H = Math.min(BUILD.maxH, Math.max(BUILD.h, my));
    }
    const grid = [W, H];
    nodes.forEach((p, id) => { if (p[0] > W || p[1] > H) fail(`node ${id} ${where(p)} is off the grid (x 0 to ${W}, y 0 to ${H})`); });

    const spec = { build: true, grid, nodes: {}, parts: [], palette: [], controls: [], labels: [] };
    nodes.forEach((p, id) => { spec.nodes[id] = p; });
    const specLocked = raw.locked == null ? true : parseBool(raw.locked, true);
    const ids = new Set();
    const later = [];
    let wires = 0, comps = 0, leds = 0;
    for (const p of rawParts) {
      if (!isObj(p)) fail('a part is not an object');
      const type = typeOf(p.type != null ? p.type : p.kind);
      if (!type) fail(`unknown part type "${show(p.type != null ? p.type : p.kind)}"`);
      const pair = ends(p);
      const idRaw = typeof p.id === 'string' ? p.id.trim() : '';
      const what = type === 'wire' ? 'a wire' : `part ${show(idRaw) || type}`;
      const out = { id: '', type, from: buildPoint(pair[0], nodes, grid, `${what}'s "from"`), to: buildPoint(pair[1], nodes, grid, `${what}'s "to"`) };
      if (type === 'wire') {
        if (++wires > BUILD.wires) fail(`more than ${BUILD.wires} wires`);
        out.id = '~' + wires;
      } else {
        if (++comps > LIMITS.parts) fail(`more than ${LIMITS.parts} parts besides wires`);
        if (idRaw) {
          if (!ID.test(idRaw)) fail(`a ${type} needs a short id like R1 (got "${show(idRaw)}")`);
          if (ids.has(idRaw)) fail(`two parts are called ${idRaw}`);
          ids.add(idRaw);
          out.id = idRaw;
        } else later.push(out);
        const who = idRaw || type;
        if (hasValue(type)) {
          const v = valueIn(p, type);
          out.value = checkValue(type, Number.isFinite(v) ? v : DEFAULTS[type], who);
          if (p.values != null) {
            const vs = choiceList(type, p.values, who);
            if (!vs.includes(out.value)) out.value = vs[0];
            if (vs.length > 1) out.values = vs;
          }
        }
        if (type === 'switch') out.closed = parseBool(p.closed != null ? p.closed : p.state != null ? p.state : p.on, false);
        if (type === 'led') { if (++leds > LIMITS.leds) fail(`more than ${LIMITS.leds} LEDs`); out.color = colorOf(p); }
        const label = txt(p.label, 16);
        if (label) out.label = label;
      }
      out.locked = p.locked == null && p.fixed == null ? specLocked : parseBool(p.locked != null ? p.locked : p.fixed, specLocked);
      spec.parts.push(out);
    }
    later.forEach((out) => { out.id = freeId(out.type, ids); ids.add(out.id); });
    const placed = [];
    for (const p of spec.parts) {
      const why = placeWhy(spec, placed, p);
      if (why) fail(`${p.type === 'wire' ? 'the wire' : p.id} from ${where(p.from)} to ${where(p.to)} ${PLACE_WHY[why]}`);
      placed.push(p);
    }
    spec.palette = normPalette(raw.palette != null ? raw.palette : raw.bin, ids, comps, leds);

    const rr = raw.resistance != null ? raw.resistance : raw.ohmmeter;
    if (rr != null) {
      const pair = list(rr).map(nodeName);
      if (pair.length !== 2 || pair[0] === pair[1] || !pair.every((n) => own(spec.nodes, n))) fail('"resistance" names two labelled points in "nodes", like ["P", "Q"]');
      spec.resistance = pair;
    }
    for (const l of Array.isArray(raw.labels) ? raw.labels.slice(0, LIMITS.labels) : []) {
      if (!isObj(l)) continue;
      const lat = Array.isArray(l.at) ? l.at : [l.x, l.y];
      const x = snap(parseNum(lat[0])), y = snap(parseNum(lat[1])), text = txt(l.text, 40);
      if (text && x >= -1 && x <= W + 1 && y >= -1 && y <= H + 1) spec.labels.push({ at: [x, y], text });
    }

    const r0 = solveBuild(spec, startBuild(spec));
    if (r0.short) fail(shortWhy(r0.sol, r0));
    if (opts.block) {
      const pl = pools(spec);
      // with a cell, the current it gives is always shown; without one, only a resistance between two points
      const types = new Set([...spec.parts.map((p) => p.type), ...pl.groups.map((x) => x.type)]);
      if (!types.has('cell') && !types.has('battery') && !spec.resistance) fail('there is nothing to see: put a cell (and bulbs or meters) in the palette or the parts, or show "resistance" between two labelled points');
      if (!pl.groups.length && !spec.parts.length) fail('the palette is empty: give the learner parts to place');
    }
    return spec;
  }

  const startBuild = (spec) => spec.parts.map(copyPart);

  // what the learner may place: the palette's groups, the spec's movable parts, and the wires
  function pools(spec) {
    const groups = [];
    const add = (g) => {
      const k = [g.type, JSON.stringify(g.values || null), g.color || '', g.label || ''].join('|');
      const same = groups.find((x) => x.k === k);
      if (same) same.ids.push(...g.ids);
      else groups.push(Object.assign({ k }, g, { ids: g.ids.slice() }));
    };
    spec.palette.forEach((g) => { if (g.type !== 'wire') add({ type: g.type, ids: g.ids, values: g.values, color: g.color }); });
    spec.parts.forEach((p) => { if (!p.locked && p.type !== 'wire') add({ type: p.type, ids: [p.id], values: p.values || (hasValue(p.type) ? [p.value] : undefined), color: p.color, label: p.label }); });
    const w = spec.palette.find((g) => g.type === 'wire');
    return { groups, wires: (w ? w.count : 0) + spec.parts.filter((p) => !p.locked && p.type === 'wire').length };
  }

  // A build from the learner (or a goal's "answer", strict: anything wrong fails with a reason): every part
  // checked against the palette and the grid. Lenient, what can't be placed is left out; null if unreadable.
  // The learner's build is the whole board; an "answer" adds to the spec's parts (and may move those not locked).
  function readBuild(spec, value, strict) {
    const items = Array.isArray(value) ? value : isObj(value) && Array.isArray(value.parts) ? value.parts : null;
    const bad = (msg) => { if (strict) fail(msg); };
    if (!items) { bad('the "answer" is a list of parts'); return null; }
    if (items.length > LIMITS.parts + BUILD.wires + 4) { bad('the "answer" has too many parts'); return null; }
    const nodes = new Map(Object.keys(spec.nodes).map((n) => [n, spec.nodes[n]]));
    const pl = pools(spec);
    const owner = new Map();
    pl.groups.forEach((g) => g.ids.forEach((id) => owner.set(id, g)));
    const out = (strict ? spec.parts : spec.parts.filter((p) => p.locked)).map(copyPart);
    const used = new Set(out.map((p) => p.id));
    const movable = new Set(strict ? spec.parts.filter((p) => !p.locked && p.type !== 'wire').map((p) => p.id) : []);
    let wiresLeft = pl.wires - out.filter((p) => p.type === 'wire' && !p.locked).length, wn = 0;
    const near = (vs, x) => vs.find((v) => Math.abs(v - x) <= 1e-9 * Math.max(1, Math.abs(v)));
    for (const raw of items) {
      if (!isObj(raw)) { bad('a part in the "answer" is not an object'); continue; }
      const type = typeOf(raw.type != null ? raw.type : raw.kind);
      if (!type) { bad(`the "answer" has an unknown part "${show(raw.type)}"`); continue; }
      const idRaw = typeof raw.id === 'string' ? raw.id.trim() : '';
      const who = `${type === 'wire' ? 'a wire' : show(idRaw) || 'a ' + type} in the "answer"`;
      const pair = ends(raw);
      let a, b;
      try { a = buildPoint(pair[0], nodes, spec.grid, who); b = buildPoint(pair[1], nodes, spec.grid, who); } catch (err) { if (strict) throw err; continue; }
      if (type === 'wire') {
        if (out.some((q) => q.type === 'wire' && sameSpan(q, a, b))) continue; // a wire already there, given again
        const segs = wireRoute(spec, out, a, b);
        if (!segs) { bad(`the wire from ${where(a)} to ${where(b)} ${PLACE_WHY[placeWhy(spec, out, { type: 'wire', from: a, to: straight(a, b) ? b : [b[0], a[1]] }) || 'covered']}`); continue; }
        if (segs.length > wiresLeft) { bad(`the "answer" uses more wires than the palette has (${pl.wires})`); continue; }
        segs.forEach(([p, q]) => {
          let id;
          do { id = '~w' + (++wn); } while (used.has(id));
          used.add(id);
          out.push({ id, type: 'wire', from: p, to: q, locked: false });
          wiresLeft--;
        });
        continue;
      }
      const fixed = out.find((q) => q.id === idRaw && q.locked);
      if (fixed) {
        if (fixed.type !== type || !sameSpan(fixed, a, b)) { bad(`${idRaw} is fixed in the spec (a ${fixed.type} from ${where(fixed.from)} to ${where(fixed.to)}); the "answer" can't move it`); }
        if (fixed.type === 'switch') fixed.closed = parseBool(raw.closed != null ? raw.closed : raw.state, fixed.closed);
        if (fixed.values) { const v = near(fixed.values, valueIn(raw, type)); if (v != null) fixed.value = v; }
        continue;
      }
      // an answer that names one of the spec's movable parts moves it (once)
      const moved = movable.has(idRaw) ? out.findIndex((q) => q.id === idRaw && q.type === type) : -1;
      if (moved >= 0) { out.splice(moved, 1); used.delete(idRaw); movable.delete(idRaw); }
      // a part from the palette, or one of the spec's that may move
      const want = hasValue(type) ? valueIn(raw, type) : NaN;
      const wantColor = type === 'led' && (raw.color || raw.colour) ? colorOf(raw) : '';
      const fits = (g) => g.type === type && (!Number.isFinite(want) || near(g.values, want) != null) && (!wantColor || g.color === wantColor);
      let id = idRaw, g = owner.get(idRaw);
      if (!g || used.has(id) || !fits(g)) {
        g = pl.groups.find((x) => fits(x) && x.ids.some((y) => !used.has(y)));
        if (!g) {
          const same = pl.groups.filter((x) => x.type === type);
          if (!same.length) bad(`the "answer" uses a ${type}, but the palette has none`);
          else if (!same.some(fits)) bad(`the "answer" uses ${show(idRaw) || 'a ' + type} of ${show(want)}, but the palette's ${type}s are ${same.map((x) => (x.values ? x.values.join(' or ') : x.color)).join(', ')}`);
          else bad(`the "answer" uses more ${type}s than the palette has (${same.reduce((n, x) => n + x.ids.length, 0)})`);
          continue;
        }
        id = g.ids.find((y) => !used.has(y));
      }
      const part = { id, type, from: a, to: b, locked: false };
      if (hasValue(type)) {
        part.value = Number.isFinite(want) ? near(g.values, want) : g.values[0];
        if (g.values.length > 1) part.values = g.values.slice();
      }
      if (type === 'switch') part.closed = parseBool(raw.closed != null ? raw.closed : raw.state, false);
      if (type === 'led') part.color = g.color || 'red';
      if (g.label) part.label = g.label;
      const why = placeWhy(spec, out, part);
      if (why) { bad(`${id} from ${where(a)} to ${where(b)} ${PLACE_WHY[why]}`); continue; }
      used.add(id);
      out.push(part);
    }
    return out;
  }

  // the build as a circuit for the solver: a node at each end of a part, at each labelled dot and where wires
  // cross; wires cut into pieces at the nodes they pass (a piece's id: the wire's, then .0, .1 ...)
  function compileBuild(spec, parts) {
    const mark = new Map(Object.keys(spec.nodes).map((n) => [pkey(spec.nodes[n]), n]));
    const keyPts = new Set(mark.keys());
    parts.forEach((p) => { keyPts.add(pkey(p.from)); keyPts.add(pkey(p.to)); });
    const touch = new Map();
    parts.forEach((p) => { if (p.type === 'wire') along(p.from, p.to).forEach((q) => { const k = pkey(q); touch.set(k, (touch.get(k) || 0) + 1); }); });
    touch.forEach((n, k) => { if (n >= 2) keyPts.add(k); });
    const nodes = {};
    const nameAt = (p) => { const k = pkey(p); const n = mark.get(k) || '@' + k; nodes[n] = [p[0], p[1]]; return n; };
    const out = [];
    for (const p of parts) {
      if (p.type !== 'wire') {
        const q = { id: p.id, type: p.type, from: nameAt(p.from), to: nameAt(p.to) };
        ['value', 'closed', 'color', 'label'].forEach((k) => { if (p[k] != null) q[k] = p[k]; });
        out.push(q);
        continue;
      }
      const pts = along(p.from, p.to).filter((q, i, all) => i === 0 || i === all.length - 1 || keyPts.has(pkey(q)));
      for (let j = 0; j < pts.length - 1; j++) out.push({ id: p.id + '.' + j, type: 'wire', from: nameAt(pts[j]), to: nameAt(pts[j + 1]), wire: p.id });
    }
    mark.forEach((n, k) => { if (!nodes[n]) nodes[n] = k.split(',').map(Number); });
    return { nodes, parts: out, controls: [], labels: spec.labels || [] };
  }

  /* the netlist: dots joined into nodes, and the parts between them as edges
       'goal': wires, closed switches and ammeters join; voltmeters and open switches are left out
       'amm':  ammeters stay edges (is one in series with a part?)
       'volt': voltmeters and open switches stay edges (is one across a part?) */
  function netOf(parts, mode) {
    const uf = new Map();
    const find = (k) => { if (!uf.has(k)) uf.set(k, k); let x = k; while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x))); x = uf.get(x); } return x; };
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) uf.set(ra, rb); };
    const merges = (p) => p.type === 'wire' || (p.type === 'switch' && p.closed) || (p.type === 'ammeter' && mode !== 'amm');
    const drops = (p) => (p.type === 'voltmeter' && mode !== 'volt') || (p.type === 'switch' && !p.closed && mode !== 'volt');
    parts.forEach((p) => {
      if (p.type === 'wire') { const pts = along(p.from, p.to); pts.forEach((q) => join(pkey(pts[0]), pkey(q))); } else if (merges(p)) join(pkey(p.from), pkey(p.to));
    });
    const edges = parts.filter((p) => !merges(p) && !drops(p)).map((p) => ({ id: p.id, type: p.type, value: p.value, u: find(pkey(p.from)), v: find(pkey(p.to)) }));
    return { at: (pt) => find(pkey(pt)), edges, byId: new Map(edges.map((e) => [e.id, e])) };
  }
  function linked(edges, skip, a, b) {
    if (a === b) return true;
    const adj = new Map();
    edges.forEach((e) => { if (skip.includes(e.id)) return; [[e.u, e.v], [e.v, e.u]].forEach(([x, y]) => { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); }); });
    const seen = new Set([a]);
    const todo = [a];
    while (todo.length) { const x = todo.pop(); for (const y of adj.get(x) || []) { if (y === b) return true; if (!seen.has(y)) { seen.add(y); todo.push(y); } } }
    return false;
  }
  const loopy = (net, e) => e.u !== e.v && linked(net.edges, [e.id], e.u, e.v); // on some loop
  function inSeries(net, a, b) {
    const e = net.byId.get(a), f = net.byId.get(b);
    if (!e || !f || e === f || !loopy(net, e) || !loopy(net, f)) return false;
    return !linked(net.edges, [e.id, f.id], f.u, f.v);
  }
  function inParallel(net, a, b) {
    const e = net.byId.get(a), f = net.byId.get(b);
    return Boolean(e && f && e !== f && e.u !== e.v && ((e.u === f.u && e.v === f.v) || (e.u === f.v && e.v === f.u)));
  }

  // meters in the wrong place: an ammeter across a part (in parallel, it short-circuits it), a voltmeter in series
  function meterProblems(parts) {
    const out = [];
    const amm = parts.filter((p) => p.type === 'ammeter');
    if (amm.length) {
      const net = netOf(parts, 'amm');
      amm.forEach((m) => {
        const e = net.byId.get(m.id);
        if (!e || !loopy(net, e)) return;
        if (net.edges.some((x) => x.type !== 'ammeter' && inSeries(net, m.id, x.id))) return;
        const across = net.edges.find((x) => x.type !== 'ammeter' && inParallel(net, m.id, x.id));
        out.push({ id: m.id, type: 'ammeter', across: across ? across.id : null });
      });
    }
    const volt = parts.filter((p) => p.type === 'voltmeter');
    if (volt.length) {
      const net = netOf(parts, 'volt');
      volt.forEach((m) => {
        const e = net.byId.get(m.id);
        if (!e || !loopy(net, e)) return;
        if (net.edges.some((x) => x.type !== 'voltmeter' && inParallel(net, m.id, x.id))) return;
        if (net.edges.some((x) => x.type !== 'voltmeter' && inSeries(net, m.id, x.id))) out.push({ id: m.id, type: 'voltmeter' });
      });
    }
    return out;
  }

  // the resistance between two labelled dots, as an ohmmeter reads it (cells taken out): Infinity with no path
  function resistanceBetween(spec, parts, A, B) {
    if (!own(spec.nodes, A) || !own(spec.nodes, B)) return NaN;
    const net = netOf(parts, 'goal');
    const a = net.at(spec.nodes[A]), b = net.at(spec.nodes[B]);
    if (a === b) return 0;
    const rs = net.edges.filter((e) => (e.type === 'resistor' || e.type === 'bulb') && e.u !== e.v);
    if (!linked(rs, [], a, b)) return Infinity;
    // the piece with a and b in it, b as the reference; one ampere in at a
    const reach = new Set([a]);
    let grew = true;
    while (grew) { grew = false; rs.forEach((e) => { if (reach.has(e.u) !== reach.has(e.v)) { reach.add(e.u); reach.add(e.v); grew = true; } }); }
    const names = [...reach].filter((x) => x !== b);
    const ix = new Map(names.map((x, i) => [x, i]));
    const n = names.length;
    const A2 = new Float64Array(n * n), rhs = new Float64Array(n);
    rs.forEach((e) => {
      if (!reach.has(e.u)) return;
      const g = 1 / e.value, p = ix.has(e.u) ? ix.get(e.u) : -1, q = ix.has(e.v) ? ix.get(e.v) : -1;
      if (p >= 0) { A2[p * n + p] += g; if (q >= 0) A2[p * n + q] -= g; }
      if (q >= 0) { A2[q * n + q] += g; if (p >= 0) A2[q * n + p] -= g; }
    });
    rhs[ix.get(a)] = 1;
    const x = gauss(A2, rhs, n);
    return x ? round(x[ix.get(a)]) : Infinity;
  }

  // The build, solved: everything run() gives, and the build's own readouts
  //   total      the current from the supply (one cell or battery, or cells all in series), or null
  //   ohms       the resistance between spec.resistance's two dots
  //   misplaced  meters in the wrong place;  open: a supply and parts, but no current anywhere
  function solveBuild(spec, parts) {
    const sol = compileBuild(spec, parts);
    const r = run(compile(sol), { s: {}, v: {}, w: null });
    r.sol = sol;
    r.total = null;
    r.misplaced = [];
    r.open = false;
    const cells = parts.filter((p) => TYPES[p.type].source);
    if (!r.short) {
      r.misplaced = meterProblems(parts);
      if (cells.length) {
        const net = cells.length > 1 ? netOf(parts, 'goal') : null;
        if (cells.length === 1 || cells.slice(1).every((c) => inSeries(net, cells[0].id, c.id))) r.total = Math.abs(r.I[cells[0].id] || 0);
        const loads = parts.filter((p) => ['resistor', 'bulb', 'led', 'ammeter'].includes(p.type));
        r.open = loads.length > 0 && parts.every((p) => p.type === 'wire' || p.type === 'voltmeter' || !r.I[p.id]);
      }
    }
    if (spec.resistance) r.ohms = resistanceBetween(spec, parts, spec.resistance[0], spec.resistance[1]);
    return r;
  }

  // A network of resistors between two dots as a sum, when it is one: "R1 + (R2 ∥ R3)", or null
  function seriesParallel(spec, parts, A, B) {
    const net = netOf(parts, 'goal');
    const a = net.at(spec.nodes[A]), b = net.at(spec.nodes[B]);
    let es = net.edges.filter((e) => (e.type === 'resistor' || e.type === 'bulb') && e.u !== e.v).map((e) => ({ u: e.u, v: e.v, s: e.id, k: 'one', r: e.value }));
    for (let guard = 0; guard < 80 && es.length > 1; guard++) {
      const deg = new Map();
      es.forEach((e) => { deg.set(e.u, (deg.get(e.u) || 0) + 1); deg.set(e.v, (deg.get(e.v) || 0) + 1); });
      // a loose end that leads nowhere
      const dead = es.findIndex((e) => (deg.get(e.u) === 1 && e.u !== a && e.u !== b) || (deg.get(e.v) === 1 && e.v !== a && e.v !== b));
      if (dead >= 0) { es.splice(dead, 1); continue; }
      let done = false;
      for (let i = 0; i < es.length && !done; i++) for (let j = i + 1; j < es.length && !done; j++) {
        const e = es[i], f = es[j];
        if ((e.u === f.u && e.v === f.v) || (e.u === f.v && e.v === f.u)) {
          const w = (x) => (x.k === 'ser' ? '(' + x.s + ')' : x.s);
          es[i] = { u: e.u, v: e.v, s: w(e) + ' ∥ ' + w(f), k: 'par', r: 1 / (1 / e.r + 1 / f.r) };
          es.splice(j, 1);
          done = true;
        }
      }
      if (done) continue;
      const mid = [...deg.keys()].find((x) => x !== a && x !== b && deg.get(x) === 2);
      if (mid == null) break;
      const two = es.filter((e) => e.u === mid || e.v === mid);
      const far = (e) => (e.u === mid ? e.v : e.u);
      const w = (x) => (x.k === 'par' ? '(' + x.s + ')' : x.s);
      es = es.filter((e) => !two.includes(e));
      es.push({ u: far(two[0]), v: far(two[1]), s: w(two[0]) + ' + ' + w(two[1]), k: 'ser', r: two[0].r + two[1].r });
    }
    if (es.length !== 1 || !((es[0].u === a && es[0].v === b) || (es[0].u === b && es[0].v === a))) return null;
    return { text: es[0].s, ohms: round(es[0].r) };
  }

  /* build goals */

  const BUILD_GOALS = {
    lit: ['lit', 'light', 'lights', 'lamp', 'lamps', 'bulb', 'bulbs', 'on', 'glow', 'bright', 'brightness'],
    series: ['series', 'in series'],
    parallel: ['parallel', 'in parallel'],
    reading: ['reading', 'read', 'meter', 'value'],
    equivalent: ['equivalent', 'resistance', 'equivalent resistance', 'effective resistance', 'total resistance', 'ohms', 'combination'],
    measure: ['measure', 'place', 'placement', 'place meter', 'meter placement', 'use meter', 'connect meter'],
    control: ['control', 'controls', 'switch', 'switches']
  };
  function buildGoalType(v) {
    const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/[_-]/g, ' ') : '';
    return Object.keys(BUILD_GOALS).find((k) => BUILD_GOALS[k].includes(s)) || '';
  }
  // a number to reach, with a tolerance: 2% unless given, never more than 10%
  function target(raw, keys, floor, max, what) {
    const k = keys.find((key) => raw[key] != null);
    const value = k ? parseNum(raw[k]) : NaN;
    if (!Number.isFinite(value) || value < 0 || value > max) fail(`the goal needs ${what} as a number`);
    let tol = raw.tolerance != null ? parseNum(raw.tolerance) : NaN;
    if (!Number.isFinite(tol) || tol <= 0) tol = Math.max(0.02 * value, floor);
    tol = Math.min(tol, Math.max(0.1 * value, floor));
    return { value: round(value), tolerance: round(tol) };
  }

  function normBuildGoal(spec, raw) {
    const type = buildGoalType(raw.type != null ? raw.type : raw.kind);
    if (!type) fail(`unknown goal type "${show(raw.type)}" for a build (lit, series, parallel, reading, equivalent, measure or control)`);
    const all = new Map();
    spec.parts.forEach((p) => { if (p.type !== 'wire') all.set(p.id, p.type); });
    spec.palette.forEach((g) => (g.ids || []).forEach((id) => all.set(id, g.type)));
    const one = (v, what, ok, kind) => {
      const id = typeof v === 'string' ? v.trim() : '';
      if (!all.has(id)) fail(`the goal's "${what}" names ${show(id) || 'nothing'}, which is not a part (the spec's and palette's are ${[...all.keys()].join(', ') || 'none'})`);
      if (!ok(all.get(id))) fail(`the goal's "${what}" names ${id}, a ${all.get(id)}: it must be ${kind}`);
      return id;
    };
    const many = (v, what, ok, kind) => [...new Set(list(v).map((x) => one(x, what, ok, kind)))];
    const lamp = (t) => Boolean(TYPES[t].lamp), meter = (t) => Boolean(TYPES[t].meter);
    const lamps = [...all.keys()].filter((id) => lamp(all.get(id)));
    const sameKind = (ids, what) => { if (new Set(ids.map((id) => all.get(id))).size > 1) fail(`"${what}" compares bulbs with bulbs, or LEDs with LEDs`); };
    const goal = { type };
    if (type === 'lit') {
      const on = raw.on != null ? raw.on : raw.lit != null ? raw.lit : raw.lamps != null ? raw.lamps : raw.bulbs;
      goal.on = on == null || on === 'all' ? lamps.slice() : many(on, 'on', lamp, 'a bulb or LED');
      goal.off = raw.off != null ? many(raw.off, 'off', lamp, 'a bulb or LED') : [];
      if (raw.order != null) {
        goal.order = many(raw.order, 'order', lamp, 'a bulb or LED');
        if (goal.order.length < 2) fail('"order" lists two or more lamps, brightest first');
        sameKind(goal.order, 'order');
        goal.order.forEach((id) => { if (!goal.on.includes(id)) goal.on.push(id); });
      }
      const eq = raw.equal != null ? raw.equal : raw.same;
      if (Array.isArray(eq) || parseBool(eq, false) === true) {
        if (goal.order) fail('a goal has "order" or "equal", not both');
        goal.equal = Array.isArray(eq) ? many(eq, 'equal', lamp, 'a bulb or LED') : goal.on.slice();
        if (goal.equal.length < 2) fail('"equal" needs two or more lamps');
        sameKind(goal.equal, 'equal');
        goal.equal.forEach((id) => { if (!goal.on.includes(id)) goal.on.push(id); });
      }
      if (!goal.on.length) fail('the goal names no bulb or LED to light');
      if (goal.on.some((id) => goal.off.includes(id))) fail('a lamp is both "on" and "off" in the goal');
    } else if (type === 'series' || type === 'parallel') {
      goal.parts = many(raw.parts != null ? raw.parts : raw.ids != null ? raw.ids : raw.items, 'parts', (t) => LOADS.includes(t), 'a resistor, bulb, LED or cell');
      if (goal.parts.length < 2) fail(`a ${type} goal names two or more "parts"`);
    } else if (type === 'reading') {
      goal.meter = one(raw.meter, 'meter', meter, 'an ammeter or voltmeter');
      Object.assign(goal, target(raw, ['value', 'reads', 'reading'], 1e-3, 1e4, 'the reading'));
    } else if (type === 'equivalent') {
      const pair = list(raw.between != null ? raw.between : raw.points != null ? raw.points : raw.nodes).map(nodeName);
      if (pair.length !== 2 || pair[0] === pair[1] || !pair.every((n) => own(spec.nodes, n))) fail('an equivalent goal needs "between": two labelled points of the spec\'s "nodes", like ["P", "Q"]');
      goal.between = pair;
      Object.assign(goal, target(raw, ['value', 'ohms', 'resistance'], 0.01, 1e6, 'the resistance in ohms'));
      if (!(goal.value > 0)) fail('the goal needs the resistance in ohms, above 0');
    } else if (type === 'measure') {
      goal.meter = one(raw.meter, 'meter', meter, 'an ammeter or voltmeter');
      const volt = all.get(goal.meter) === 'voltmeter';
      const tgt = raw.across != null ? raw.across : raw.through != null ? raw.through : raw.part != null ? raw.part : raw.with;
      goal.part = one(tgt, volt ? 'across' : 'through', (t) => LOADS.includes(t), 'a resistor, bulb, LED or cell');
    } else if (type === 'control') {
      goal.switch = one(raw.switch != null ? raw.switch : raw.part, 'switch', (t) => t === 'switch', 'a switch');
      goal.on = many(raw.on != null ? raw.on : raw.lamps != null ? raw.lamps : raw.controls, 'on', lamp, 'a bulb or LED');
      if (!goal.on.length) fail('a control goal names in "on" the lamps the switch turns on and off');
    }
    return goal;
  }

  // brightness, to compare: a bulb's power, an LED's current
  function bright(r, parts, id) {
    const p = parts.find((x) => x.id === id);
    const i = Math.abs(r.I[id] || 0);
    return p && p.type === 'bulb' ? i * i * p.value : i;
  }
  const differ = (x, y, rel) => Math.abs(x - y) > rel * Math.max(Math.abs(x), Math.abs(y)) + 1e-9;

  // does this build meet the goal? why not, if not (ids as they are)
  function evalBuild(spec, goal, parts) {
    const has = new Set(parts.map((p) => p.id));
    const no = (why) => ({ ok: false, why });
    const ids = (goal.on || []).concat(goal.parts || [], goal.meter ? [goal.meter] : [], goal.part ? [goal.part] : [], goal.switch ? [goal.switch] : []);
    if (goal.type === 'equivalent') {
      const R = resistanceBetween(spec, parts, goal.between[0], goal.between[1]);
      return Math.abs(R - goal.value) <= goal.tolerance + 1e-12 ? { ok: true } : no({ req: R });
    }
    if (goal.type === 'control') {
      // every lamp is on the board (a lamp left off is no test of "only")
      const lampIds = spec.parts.filter((p) => TYPES[p.type].lamp).map((p) => p.id)
        .concat(...spec.palette.filter((g) => TYPES[g.type].lamp).map((g) => g.ids));
      const missing = ids.concat(lampIds).find((id) => !has.has(id));
      if (missing) return no({ missing });
      const set = (closed) => parts.map((p) => (p.id === goal.switch ? Object.assign({}, p, { closed }) : p));
      const r1 = solveBuild(spec, set(true)), r0 = solveBuild(spec, set(false));
      if (r1.short || r0.short) return no({ short: true, when: r1.short ? 'closed' : 'open' });
      for (const id of goal.on) {
        if (!r1.lit[id]) return no({ ctl: 'on', lamp: id });
        if (r0.lit[id]) return no({ ctl: 'off', lamp: id });
      }
      for (const p of parts) {
        if (!TYPES[p.type].lamp || goal.on.includes(p.id)) continue;
        if (Boolean(r1.lit[p.id]) !== Boolean(r0.lit[p.id])) return no({ ctl: 'other', lamp: p.id });
        if (!r1.lit[p.id]) return no({ ctl: 'dark', lamp: p.id });
      }
      return { ok: true };
    }
    const r = solveBuild(spec, parts);
    if (r.short) return no({ short: true });
    const missing = ids.find((id) => !has.has(id));
    if (missing) return no({ missing });
    if (goal.type === 'lit') {
      for (const id of goal.on) if (!r.lit[id]) return no({ lamp: id, want: true });
      for (const id of goal.off) if (r.lit[id]) return no({ lamp: id, want: false });
      const burnt = goal.on.find((id) => r.burn.includes(id));
      if (burnt) return no({ burn: burnt });
      if (goal.order) for (let i = 0; i + 1 < goal.order.length; i++) {
        const x = goal.order[i], y = goal.order[i + 1];
        if (!(bright(r, parts, x) > bright(r, parts, y) && differ(bright(r, parts, x), bright(r, parts, y), 0.03))) return no({ order: [x, y] });
      }
      if (goal.equal) for (const id of goal.equal.slice(1)) {
        if (differ(bright(r, parts, goal.equal[0]), bright(r, parts, id), 0.02)) return no({ equal: [goal.equal[0], id] });
      }
      return { ok: true };
    }
    const wrong = goal.meter && r.misplaced.find((m) => m.id === goal.meter);
    if (wrong) return no({ misplaced: goal.meter, across: wrong.across || null });
    const dead = (goal.parts || (goal.type === 'measure' ? [goal.part] : [])).find((id) => !(Math.abs(r.I[id] || 0) > 1e-6));
    if (dead) return no({ nocurrent: dead });
    if (goal.type === 'series' || goal.type === 'parallel') {
      const net = netOf(parts, 'goal');
      const [first, ...rest] = goal.parts;
      for (const id of rest) {
        const s = inSeries(net, first, id), p = inParallel(net, first, id);
        if (goal.type === 'series' && !s) return no({ series: [first, id], par: p });
        if (goal.type === 'parallel' && !p) return no({ parallel: [first, id], ser: s });
      }
      return { ok: true };
    }
    if (goal.type === 'reading') {
      const got = r.read[goal.meter] || 0;
      return Math.abs(got - goal.value) <= goal.tolerance + 1e-12 ? { ok: true } : no({ meter: goal.meter, got });
    }
    if (goal.type === 'measure') {
      const volt = parts.find((p) => p.id === goal.meter).type === 'voltmeter';
      if (volt) return inParallel(netOf(parts, 'volt'), goal.meter, goal.part) ? { ok: true } : no({ across: [goal.meter, goal.part] });
      return inSeries(netOf(parts, 'amm'), goal.meter, goal.part) ? { ok: true } : no({ through: [goal.meter, goal.part] });
    }
    return no({});
  }

  // the ids a goal names
  const goalIds = (g) => new Set([...(g.on || []), ...(g.off || []), ...(g.parts || []), g.meter, g.part, g.switch].filter(Boolean));

  // Parts the palette has more than one of, alike, may be swapped: a goal met with L1 and L2 the other way
  // round is met. Every way of naming the placed ones (with the group's names) is tried, up to 720 in all.
  function namings(spec, goal, parts) {
    const named = goalIds(goal);
    const groups = pools(spec).groups.filter((g) => g.ids.length > 1 && g.ids.some((id) => named.has(id)));
    const sets = [];
    let count = 1;
    for (const g of groups) {
      const placed = g.ids.filter((id) => parts.some((p) => p.id === id));
      if (!placed.length) continue;
      const ways = [];
      const pick = (left, acc) => {
        if (ways.length > 720) return;
        if (acc.length === placed.length) { ways.push(acc.slice()); return; }
        left.forEach((id, i) => pick(left.filter((_, j) => j !== i), acc.concat(id)));
      };
      pick(g.ids, []);
      count *= ways.length;
      if (count > 720) return [];
      sets.push(ways.map((w) => new Map(placed.map((id, i) => [id, w[i]]))));
    }
    let out = [new Map()];
    for (const s of sets) out = out.flatMap((m) => s.map((x) => new Map([...m, ...x])));
    return out.filter((m) => [...m].some(([a, b]) => a !== b));
  }
  function meetsBuild(spec, goal, parts) {
    const first = evalBuild(spec, goal, parts);
    if (first.ok) return first;
    for (const m of namings(spec, goal, parts)) {
      if (evalBuild(spec, goal, parts.map((p) => (m.has(p.id) ? Object.assign({}, p, { id: m.get(p.id) }) : p))).ok) return { ok: true };
    }
    return first;
  }

  // why a build fails its goal, in words for the AI (the page has its own, for the learner)
  function whyBuild(spec, goal, why) {
    const sig3 = (x) => String(Number(Number(x).toPrecision(3)));
    if (!why) return 'it does not meet the goal';
    if (why.short) return 'it is a short circuit' + (why.when ? ` with ${goal.switch} ${why.when}` : '');
    if (why.missing) return `${why.missing} is not placed`;
    if (why.lamp && why.want) return `${why.lamp} is not lit`;
    if (why.lamp) return `${why.lamp} is lit, but should not be`;
    if (why.burn) return `${why.burn} has too much current (an LED needs a resistor in series)`;
    if (why.order) return `${why.order[0]} is not brighter than ${why.order[1]}`;
    if (why.equal) return `${why.equal[0]} and ${why.equal[1]} are not equally bright`;
    if (why.nocurrent) return `no current flows through ${why.nocurrent}`;
    if (why.series) return `${why.series[0]} and ${why.series[1]} are not in series${why.par ? ' (they are in parallel)' : ''}`;
    if (why.parallel) return `${why.parallel[0]} and ${why.parallel[1]} are not in parallel${why.ser ? ' (they are in series)' : ''}`;
    if (why.misplaced) return `${why.misplaced} is in the wrong place (an ammeter goes in series, a voltmeter across a part)`;
    if (why.meter) return `${why.meter} reads ${sig3(why.got)}, not ${goal.value}`;
    if (why.req != null) return why.req === Infinity ? `there is no path between ${goal.between[0]} and ${goal.between[1]}` : `the resistance between ${goal.between[0]} and ${goal.between[1]} is ${sig3(why.req)} ohms, not ${goal.value}`;
    if (why.across) return `${why.across[0]} is not across ${why.across[1]} (its two ends on ${why.across[1]}'s two ends)`;
    if (why.through) return `${why.through[0]} is not in series with ${why.through[1]}`;
    if (why.ctl === 'on') return `with ${goal.switch} closed, ${why.lamp} is not lit`;
    if (why.ctl === 'off') return `with ${goal.switch} open, ${why.lamp} is still lit`;
    if (why.ctl === 'other') return `${goal.switch} also turns ${why.lamp} on and off`;
    if (why.ctl === 'dark') return `${why.lamp} is not lit`;
    return 'it does not meet the goal';
  }

  // the build as the learner's answer would hold it
  const partOut = (p) => {
    const q = { id: p.id, type: p.type, from: p.from.slice(), to: p.to.slice() };
    if (p.value != null) q.value = p.value;
    if (p.closed != null) q.closed = p.closed;
    if (p.color) q.color = p.color;
    if (q.type === 'wire') delete q.id;
    return q;
  };

  /* A build that meets a goal, made by the app when the AI's "answer" is missing or wrong (grids are hard to
     write by hand): the source standing in column 0, rails along its top and bottom rows, the goal's parts in
     a loop along the top rail or in branches between the rails. Tried only on a board that starts empty or
     with one fixed cell or battery in column 0, and for every goal but "equivalent" (its labelled dots are
     where the AI put them). Each try is checked like any answer; null if none meets the goal. */
  function suggestBuild(spec, goal) {
    const W = spec.grid[0], H = spec.grid[1];
    if (goal.type === 'equivalent' || spec.parts.some((p) => !p.locked) || spec.parts.length > 1) return null;
    const fixedSrc = spec.parts[0] || null;
    if (fixedSrc && !(TYPES[fixedSrc.type].source && fixedSrc.from[0] === 0 && fixedSrc.to[0] === 0)) return null;
    const pl = pools(spec);
    const byId = new Map();
    pl.groups.forEach((g) => g.ids.forEach((id) => byId.set(id, g)));
    const srcGroup = fixedSrc ? null : pl.groups.find((g) => TYPES[g.type].source);
    if (!fixedSrc && !srcGroup) return null;
    const src = fixedSrc ? { id: fixedSrc.id, type: fixedSrc.type } : { id: srcGroup.ids[0], type: srcGroup.type, value: srcGroup.values[0] };
    const plusTop = fixedSrc ? fixedSrc.to[1] < fixedSrc.from[1] : true;
    const typeOfId = (id) => (byId.get(id) || {}).type;
    // a part of the answer from a to b; an LED or a cell points the way the current goes: with + on top, along
    // the top rail and down each branch (from a to b), and the other way round with + at the bottom
    const part = (id, a, b, value) => {
      const type = typeOfId(id);
      const [f, t] = !(type === 'led' || (type && TYPES[type].source)) || plusTop ? [a, b] : [b, a];
      const p = { id, type, from: f, to: t };
      if (value != null) p.value = value;
      if (type === 'switch') p.closed = true;
      return p;
    };
    const wire = (a, b) => ({ type: 'wire', from: a, to: b });
    let yt = 0, yb = 0;
    // main: ids in a row along the top rail, from column 0; branches: lists of ids, each a column between the rails
    const layOut = (main, branches, vals) => {
      const out = fixedSrc ? [] : [{ id: src.id, type: src.type, from: [0, yb], to: [0, yt], value: src.value }];
      let x = 0;
      for (const id of main) { if (x + 1 > W) return null; out.push(part(id, [x, yt], [x + 1, yt], vals[id])); x++; }
      if (!branches.length) {
        if (!x) return null;
        out.push(wire([x, yt], [x, yb]), wire([x, yb], [0, yb]));
        return out;
      }
      if (x + branches.length > W) return null;
      out.push(wire([x, yt], [x + branches.length, yt]), wire([0, yb], [x + branches.length, yb]));
      for (let i = 0; i < branches.length; i++) {
        const col = x + 1 + i, br = branches[i];
        if (br.length > yb - yt) return null;
        for (let j = 0; j < br.length; j++) out.push(part(br[j], [col, yt + j], [col, j === br.length - 1 ? yb : yt + j + 1], vals[br[j]]));
      }
      return out;
    };
    const lampIds = pl.groups.filter((g) => TYPES[g.type].lamp).flatMap((g) => g.ids);
    const loads = pl.groups.filter((g) => g.type === 'resistor' || g.type === 'bulb');
    const tries = []; // [main, branches, values]
    const plain = (ids) => ids.filter((id) => id !== src.id);
    if (goal.type === 'series') tries.push([plain(goal.parts), []]);
    else if (goal.type === 'parallel') {
      if (goal.parts.includes(src.id)) return null;
      tries.push([[], goal.parts.map((id) => [id])]);
    } else if (goal.type === 'lit') {
      const spare = loads.filter((g) => g.type === 'resistor').flatMap((g) => g.ids).filter((id) => !goal.on.includes(id));
      tries.push([goal.on, []], [[], goal.on.map((id) => [id])]);
      // an LED needs a resistor in series
      if (spare.length) tries.push([[spare[0], ...goal.on], []], [[spare[0]], goal.on.map((id) => [id])]);
      // brightest first: the others behind a resistor each
      if (goal.order && spare.length >= goal.order.length - 1) tries.push([[], goal.order.map((id, i) => (i ? [spare[i - 1], id] : [id]))]);
    } else if (goal.type === 'control') {
      const others = lampIds.filter((id) => !goal.on.includes(id));
      if (!others.length) tries.push([[goal.switch], goal.on.map((id) => [id])], [[goal.switch, ...goal.on], []]);
      tries.push([[], [[goal.switch, ...goal.on], ...others.map((id) => [id])]]);
    } else if (goal.type === 'measure') {
      const volt = typeOfId(goal.meter) === 'voltmeter';
      const filler = goal.part === src.id ? loads.flatMap((g) => g.ids).concat(lampIds).find((id) => id !== goal.meter) : null;
      if (volt) tries.push([goal.part === src.id ? (filler ? [filler] : []) : [goal.part], [], {}, goal.part]);
      else tries.push([[goal.meter].concat(goal.part === src.id ? (filler ? [filler] : []) : [goal.part]), []]);
    } else if (goal.type === 'reading') {
      // one or two loads in a loop, at each value they can take; a voltmeter across the first
      const opts = loads.flatMap((g) => g.ids.map((id) => ({ id, values: g.values })));
      const volt = typeOfId(goal.meter) === 'voltmeter';
      const combos = [];
      opts.forEach((a) => a.values.forEach((va) => combos.push([[a.id, va]])));
      opts.forEach((a, i) => opts.slice(i + 1).forEach((b) => a.values.forEach((va) => b.values.forEach((vb) => combos.push([[a.id, va], [b.id, vb]])))));
      for (const c of combos.slice(0, 200)) {
        const vals = Object.fromEntries(c);
        const ids = c.map((x) => x[0]);
        tries.push(volt ? [ids, [], vals, ids[0]] : [[goal.meter, ...ids], [], vals]);
      }
    }
    // the rails: the fixed source's two ends, or rows 0 and 2 (all the rows, for a branch that needs more)
    const rails = fixedSrc ? [[Math.min(fixedSrc.from[1], fixedSrc.to[1]), Math.max(fixedSrc.from[1], fixedSrc.to[1])]]
      : [[0, Math.min(H, 2)]].concat(H > 2 ? [[0, H]] : []);
    for (const [top, bottom] of rails) for (const [main, branches, vals = {}, across] of tries) {
      yt = top; yb = bottom;
      const list = layOut(main, branches, vals);
      if (!list) continue;
      if (across) { // a voltmeter on the same two dots as what it measures
        const t = across === src.id ? (fixedSrc || list[0]) : list.find((p) => p.id === across);
        if (!t) continue;
        list.push({ id: goal.meter, type: 'voltmeter', from: t.from, to: t.to });
      }
      let built;
      try { built = readBuild(spec, list, true); } catch (err) { continue; }
      if (meetsBuild(spec, goal, built).ok) return built;
    }
    return null;
  }

  function normBuildTask(rawSpec, rawGoal) {
    const spec = normBuildSpec(rawSpec, {});
    const goal = normBuildGoal(spec, rawGoal);
    const ans = rawGoal.answer != null ? rawGoal.answer : rawGoal.build != null ? rawGoal.build : rawGoal.reference != null ? rawGoal.reference : rawGoal.solution;
    // the AI's answer, checked; when it's missing or wrong, one the app can make instead (or the reason)
    let built = null, problem = 'a build goal needs "answer": the parts of one correct build, each with "from" and "to" dots';
    if (ans != null) {
      try {
        built = readBuild(spec, ans, true);
        const m = meetsBuild(spec, goal, built);
        if (!m.ok) { problem = `the goal's "answer" does not meet it: ${whyBuild(spec, goal, m.why)}`; built = null; }
      } catch (err) {
        if (!(err instanceof CircuitError)) throw err;
        problem = err.message;
      }
    }
    const made = !built;
    if (!built) built = suggestBuild(spec, goal);
    if (!built) fail(problem);
    if (meetsBuild(spec, goal, startBuild(spec)).ok) fail('the circuit already meets the goal as it starts: leave something for the learner to build');
    goal.answer = built.map(partOut);
    const out = { spec, goal };
    // for the server's log: the app made the answer, and why the AI's wasn't used (not part of the task itself)
    if (made) Object.defineProperty(out, 'made', { value: problem, enumerable: false });
    return out;
  }

  // the learner's build, checked: { correct, invalid?, why? }
  function checkBuild(spec, goal, value) {
    const parts = value == null ? null : readBuild(spec, value, false);
    if (!parts) return { correct: false, invalid: true };
    const m = meetsBuild(spec, goal, parts);
    return { correct: m.ok, why: m.ok ? null : m.why || null };
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
    lampsOf, metersOf, hasValue, fmtValue, unitOf, parseNum, text: txt,
    // build mode
    BUILD, ID_PREFIX, PLACE_WHY, isBuild, startBuild, pools, readBuild, placeWhy, wireRoute, along, compileBuild, solveBuild,
    netOf, inSeries, inParallel, meterProblems, resistanceBetween, seriesParallel, evalBuild, whyBuild, suggestBuild
  };
});
