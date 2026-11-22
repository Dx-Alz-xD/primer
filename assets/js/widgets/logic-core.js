/* =====================================================================
   Logic gates in lessons: the circuit model, the Boolean expression
   reader, truth tables, the goal checks and a small circuit maker,
   shared by the server (server/widgets/logic.mjs checks every circuit the
   AI writes, and that each task can be done) and the page
   (assets/js/widgets/logic.js draws it, runs it live and checks the
   learner's work). The server imports this file; the page loads it with
   a script element (window.PrimerLogic).

   A circuit (the "spec"), after normSpec:
     inputs   [{ name: 'A', on: 0, label?, clock? }]   switches; clock: ms
              between ticks, for an input that ticks by itself
     outputs  [{ name: 'Y', from: 'G2' | null, label? }]   lamps
     gates    [{ id: 'G1', type: 'NAND', in: ['A', 'B'], init?, at? }]
              in: what drives each input pin, in order: an input's name,
              a gate's id, or a ready block's output ("U1.S"); null for a
              pin with no wire yet
              AND OR NAND NOR XOR XNOR take 2 or 3 inputs, NOT takes 1;
              ready blocks: HA (A B -> S C), FA (A B Cin -> S Cout),
              SR latch (S R -> Q Qn), D flip-flop (D CLK -> Q Qn, taking
              D as CLK rises)
     palette  [{ type, n, count }] | null   what the learner may place
              (n inputs; count null: as many as they like)
     edit     the learner may place, move, delete and wire gates
     latch    the learner may make loops (latches); a circuit written
              with a loop gets it too
     seq      (worked out) it has a loop or a latch block: it remembers
     seg7     null | 'hex' (the outputs as a binary number, first highest,
              on a seven-segment digit) | 'segments' (outputs a to g)
     names    false hides the gates' type names (to tell them by shape)
   A task's goal, after normTask:
     { type: 'build', out: { Y: '0110' }, expr?, only?, max?, solution }
     { type: 'fill', outputs: ['Y'], out, live }
     { type: 'find', want: { Y: 1 }, inputs?, solution: { set } | { path } }
     { type: 'fix', out, expr?, choices, solution: { G2: 'AND' } }
   out is a truth-table column per lamp, a 0 or 1 for each row: row r sets
   the inputs to r in binary, the first input highest (A B: 00 01 10 11).
   solution: a circuit { gates, outputs: { Y: 'G3' } } for build, made by
   the server when the AI gives none (or a wrong one).

   The learner's attempt ("value"):
     build  { gates: [{ id, type, in }], outputs: { Y: 'G3' } }
     fill   { cells: { Y: [0, 1, null, ...] } }
     find   { set: { A: 1, B: 0 } }, and for a circuit that remembers,
            path: ['10', '00'], the switch settings from the start
     fix    { types: { G2: 'AND' } }

   Evaluation: the gates are worked out in order, again and again, each
   with the newest values, until nothing changes. A combinational circuit
   settles at once; a latch (two gates feeding each other) settles into
   one of its two states and keeps it; a loop that never settles (an odd
   ring of NOT gates) is flagged as oscillating, and a circuit written so
   is refused.
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerLogic = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const LIMITS = { inputs: 6, outputs: 8, gates: 20, fill: 4, count: 12, path: 400, states: 4096, label: 24, search: 400000 };
  const TYPES = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR'];
  const GATE = {
    AND: { min: 2, max: 3 }, OR: { min: 2, max: 3 }, NOT: { min: 1, max: 1 }, NAND: { min: 2, max: 3 },
    NOR: { min: 2, max: 3 }, XOR: { min: 2, max: 3 }, XNOR: { min: 2, max: 3 }
  };
  const CHIPS = {
    HA: { ins: ['A', 'B'], outs: ['S', 'C'], name: 'half adder' },
    FA: { ins: ['A', 'B', 'Cin'], outs: ['S', 'Cout'], name: 'full adder' },
    SR: { ins: ['S', 'R'], outs: ['Q', 'Qn'], state: true, name: 'SR latch' },
    D: { ins: ['D', 'CLK'], outs: ['Q', 'Qn'], state: true, name: 'D flip-flop' }
  };
  const KINDS = TYPES.concat(Object.keys(CHIPS));
  const TYPE_ALIAS = {
    INV: 'NOT', INVERTER: 'NOT', NEGATION: 'NOT', EXOR: 'XOR', XOR: 'XOR', EOR: 'XOR', EXCLUSIVEOR: 'XOR', EXNOR: 'XNOR', ENOR: 'XNOR', XNOR: 'XNOR',
    EXCLUSIVENOR: 'XNOR', HALFADDER: 'HA', HADDER: 'HA', FULLADDER: 'FA', FADDER: 'FA', SRLATCH: 'SR', RSLATCH: 'SR', LATCH: 'SR', RS: 'SR',
    DFF: 'D', DFLIPFLOP: 'D', FLIPFLOP: 'D', DTYPE: 'D', DTYPEFLIPFLOP: 'D'
  };
  // a block's output pins by other names
  const PIN_ALIAS = {
    S: ['S', 'SUM'], C: ['C', 'CARRY', 'CO', 'COUT', 'CY'], Cout: ['COUT', 'CO', 'C', 'CARRY', 'CY', 'CARRYOUT'],
    Q: ['Q'], Qn: ['QN', "Q'", 'QB', 'QBAR', 'NQ', 'NOTQ', 'Q_BAR', 'QNOT', 'NQ']
  };
  const KEYWORDS = { AND: 'and', OR: 'or', NOT: 'not', XOR: 'xor', EXOR: 'xor', XNOR: 'xnor', EXNOR: 'xnor', NAND: 'nand', NOR: 'nor', TRUE: '1', FALSE: '0' };
  const NAME = /^[A-Za-z][A-Za-z0-9_]{0,5}$/;
  const OUT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,5}'?$/;
  const CC = String.fromCharCode;
  const CTRL = new RegExp('[' + CC(0) + '-' + CC(31) + CC(127) + ']', 'g');
  const BAR = CC(0x305) + CC(0x304);        // combining overline and macron: A̅ is NOT A
  const POST = "'’′" + BAR;                  // NOT, written after: A', A’, A′, A̅

  class LogicError extends Error {}
  class ParseError extends Error {}
  const fail = (msg) => { throw new LogicError(msg); };
  const known = (e) => e instanceof LogicError || e instanceof ParseError;
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
  const txt = (v, max) => (typeof v === 'string' ? v.replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return String(s).replace(CTRL, ' ').slice(0, 60); };
  const bit = (v) => (v === 1 || v === true || (typeof v === 'string' && /^\s*(1|on|high|true|yes)\s*$/i.test(v)) ? 1 : 0);
  const isBit = (v) => v === 0 || v === 1 || v === true || v === false || v === '0' || v === '1';
  const clampInt = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
  const listOf = (xs) => xs.join(', ');
  const squash = (s) => String(s || '').toUpperCase().replace(/[\s_\-.]+/g, '');

  // a gate or block type, by any of its names; null if it is none
  function typeOf(v) {
    if (typeof v !== 'string') return null;
    const k = squash(v.replace(/gates?$/i, '').replace(/\s*\(.*\)$/, ''));
    if (GATE[k] || CHIPS[k]) return k;
    return TYPE_ALIAS[k] || null;
  }
  // a palette key: "AND", "AND3", "nand gate"
  function paletteKey(k) {
    const m = /^(.*?)([23])$/.exec(squash(k));
    if (m) { const t = typeOf(m[1]); if (t && GATE[t] && t !== 'NOT') return { type: t, n: Number(m[2]) }; }
    const t = typeOf(k);
    if (!t) return null;
    return { type: t, n: CHIPS[t] ? CHIPS[t].ins.length : GATE[t].min };
  }
  function listTypes(v) {
    if (v == null) return null;
    const filler = ['and', 'or', 'only', 'gate', 'gates', 'just', 'the', 'use', 'using', 'with'];
    const xs = (Array.isArray(v) ? v : String(v).split(/[\s,/&+]+/)).filter((x) => typeof x === 'string' && x.trim() && !filler.includes(x.trim()));
    const out = [];
    xs.forEach((x) => {
      const t = typeOf(x);
      if (!t) fail(`"${short(x)}" is not a gate; use AND, OR, NOT, NAND, NOR, XOR or XNOR`);
      if (!out.includes(t)) out.push(t);
    });
    return out;
  }
  const arity = (type) => (CHIPS[type] ? CHIPS[type].ins.length : GATE[type].min);
  const keyOf = (type, n) => type + (CHIPS[type] || type === 'NOT' ? '' : String(n));

  /* ---------------- Boolean expressions ---------------- */

  const SYM = {
    '·': 'and', '.': 'and', '*': 'and', '&': 'and', '∧': 'and', '⋅': 'and', '∙': 'and', '×': 'and',
    '+': 'or', '|': 'or', '∨': 'or', '⊕': 'xor', '^': 'xor', '⊻': 'xor', '⊙': 'xnor', '↑': 'nand', '↓': 'nor',
    '¬': 'not', '~': 'not', '!': 'not', '∼': 'not'
  };
  function tokens(src) {
    const s = String(src).normalize('NFD');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if ('([{'.includes(ch)) { out.push({ t: '(' }); i++; continue; }
      if (')]}'.includes(ch)) { out.push({ t: ')' }); i++; continue; }
      if (ch === ',') { out.push({ t: ',' }); i++; continue; }
      if (POST.includes(ch)) { out.push({ t: 'post' }); i++; continue; }
      if ((ch === '&' || ch === '|') && s[i + 1] === ch) { out.push({ t: 'op', op: SYM[ch] }); i += 2; continue; }
      if (SYM[ch]) { out.push(SYM[ch] === 'not' ? { t: 'not' } : { t: 'op', op: SYM[ch] }); i++; continue; }
      if (ch === '0' || ch === '1') { out.push({ t: 'const', v: ch === '1' ? 1 : 0 }); i++; continue; }
      const m = /^[A-Za-z][A-Za-z0-9_]*/.exec(s.slice(i));
      if (m) {
        const w = m[0];
        const kw = KEYWORDS[w.toUpperCase()];
        if (kw === 'not') out.push({ t: 'not', word: true });
        else if (kw === '0' || kw === '1') out.push({ t: 'const', v: Number(kw) });
        else if (kw) out.push({ t: 'op', op: kw, word: true });
        else out.push({ t: 'id', w });
        i += w.length;
        continue;
      }
      throw new ParseError(`can't read "${ch}" in "${short(src)}"`);
    }
    return out;
  }
  // a run of letters as the inputs it names: "AB" is A·B when A and B are inputs; "Cin" is Cin
  function splitId(w, names) {
    if (!names) return /^[A-Z]{2,6}$/.test(w) ? w.split('') : [w];
    const exact = names.find((n) => n === w) || names.find((n) => n.toLowerCase() === w.toLowerCase());
    if (exact) return [exact];
    const seg = (str, ci) => {
      if (!str) return [];
      const opts = names.filter((n) => (ci ? str.toLowerCase().startsWith(n.toLowerCase()) : str.startsWith(n))).sort((a, b) => b.length - a.length);
      for (const n of opts) { const rest = seg(str.slice(n.length), ci); if (rest) return [n].concat(rest); }
      return null;
    };
    return seg(w, false) || seg(w, true);
  }
  // text -> a tree: { op: 'var', name } | { op: 'const', v } | { op: 'not', a } | { op: 'and' | 'or' | 'xor' | 'xnor' | 'nand' | 'nor', a, b }
  //   | { op: 'call', fn, args } (a gate written as a call: NAND(A, B)). NOT binds tightest, then AND, XOR, OR.
  function parse(src, names) {
    if (typeof src !== 'string' || !src.trim()) throw new ParseError('the expression is empty');
    if (src.length > 400) throw new ParseError('the expression is too long');
    const ts = [];
    for (const tk of tokens(src)) {
      if (tk.t !== 'id') { ts.push(tk); continue; }
      const parts = splitId(tk.w, names);
      if (!parts) throw new ParseError(`"${tk.w}" is not one of the inputs (${listOf(names)})`);
      parts.forEach((p, j) => { if (j) ts.push({ t: 'op', op: 'and' }); ts.push({ t: 'var', name: p }); });
    }
    let p = 0;
    const peek = () => ts[p];
    const isOp = (tk, ...ops) => tk && tk.t === 'op' && ops.includes(tk.op);
    const what = (tk) => (!tk ? 'the end' : tk.t === 'op' ? tk.op.toUpperCase() : tk.t === 'var' ? tk.name : tk.t === 'const' ? String(tk.v) : tk.t);
    const expect = (t) => { if (!peek() || peek().t !== t) throw new ParseError(`expected "${t}" in "${short(src)}"`); p++; };
    const starts = (tk) => tk && (tk.t === 'var' || tk.t === 'const' || tk.t === '(' || tk.t === 'not');
    function orE() { let a = xorE(); while (isOp(peek(), 'or', 'nor')) { const op = ts[p++].op; a = { op, a, b: xorE() }; } return a; }
    function xorE() { let a = andE(); while (isOp(peek(), 'xor', 'xnor')) { const op = ts[p++].op; a = { op, a, b: andE() }; } return a; }
    function andE() {
      let a = unary();
      for (;;) {
        if (isOp(peek(), 'and', 'nand')) { const op = ts[p++].op; a = { op, a, b: unary() }; } else if (starts(peek())) a = { op: 'and', a, b: unary() };
        else break;
      }
      return a;
    }
    function unary() {
      const tk = peek();
      if (!tk) throw new ParseError(`"${short(src)}" ends too soon`);
      if (tk.t === 'not') { p++; return { op: 'not', a: unary() }; }
      if (tk.t === 'op' && tk.word && ts[p + 1] && ts[p + 1].t === '(') {
        p += 2;
        const args = [orE()];
        while (peek() && peek().t === ',') { p++; args.push(orE()); }
        expect(')');
        return postfix({ op: 'call', fn: tk.op, args });
      }
      return postfix(atom());
    }
    function atom() {
      const tk = ts[p++];
      if (tk && tk.t === 'var') return { op: 'var', name: tk.name };
      if (tk && tk.t === 'const') return { op: 'const', v: tk.v };
      if (tk && tk.t === '(') { const e = orE(); expect(')'); return e; }
      throw new ParseError(`${what(tk)} is out of place in "${short(src)}"`);
    }
    function postfix(e) { while (peek() && peek().t === 'post') { p++; e = { op: 'not', a: e }; } return e; }
    const e = orE();
    if (p < ts.length) throw new ParseError(`${what(ts[p])} is out of place in "${short(src)}"`);
    return e;
  }
  const FOLD = { and: (a, b) => a & b, or: (a, b) => a | b, xor: (a, b) => a ^ b };
  const BASE = { and: 'and', or: 'or', xor: 'xor', nand: 'and', nor: 'or', xnor: 'xor' };
  function evalAst(e, env) {
    switch (e.op) {
      case 'var': return env[e.name] ? 1 : 0;
      case 'const': return e.v;
      case 'not': return 1 - evalAst(e.a, env);
      case 'call': {
        if (e.fn === 'not') return 1 - evalAst(e.args[0], env);
        const v = e.args.map((x) => evalAst(x, env)).reduce(FOLD[BASE[e.fn]]);
        return e.fn === BASE[e.fn] ? v : 1 - v;
      }
      default: {
        const v = FOLD[BASE[e.op]](evalAst(e.a, env), evalAst(e.b, env));
        return e.op === BASE[e.op] ? v : 1 - v;
      }
    }
  }
  function varsOf(e, out) {
    out = out || [];
    if (e.op === 'var') { if (!out.includes(e.name)) out.push(e.name); } else if (e.op === 'not') varsOf(e.a, out);
    else if (e.op === 'call') e.args.forEach((x) => varsOf(x, out));
    else if (e.a) { varsOf(e.a, out); varsOf(e.b, out); }
    return out;
  }
  const rowBits = (r, n) => { const b = []; for (let i = 0; i < n; i++) b.push((r >> (n - 1 - i)) & 1); return b; };
  // the expression's truth-table column over these inputs, as '0110'
  function astTable(e, names) {
    const n = names.length;
    let s = '';
    for (let r = 0; r < 1 << n; r++) {
      const env = {};
      rowBits(r, n).forEach((b, i) => { env[names[i]] = b; });
      s += evalAst(e, env);
    }
    return s;
  }
  // the tree written as a textbook does: A·B' + C, (A + B)', A ⊕ B
  const LV = { or: 1, nor: 1, xor: 2, xnor: 2, and: 3, nand: 3 };
  function show(e) {
    const wrap = (x, lv) => { const r = show1(x); return r.lv < lv ? '(' + r.s + ')' : r.s; };
    function join(fn, xs) {
      const base = BASE[fn];
      const sep = base === 'and' ? '·' : base === 'or' ? ' + ' : ' ⊕ ';
      const s = xs.map((x) => wrap(x, LV[base])).join(sep);
      return fn === base ? { s, lv: LV[base] } : { s: '(' + s + ")'", lv: 4 };
    }
    function show1(x) {
      if (x.op === 'var') return { s: x.name, lv: 5 };
      if (x.op === 'const') return { s: String(x.v), lv: 5 };
      if (x.op === 'not' || (x.op === 'call' && x.fn === 'not')) { const a = x.op === 'not' ? x.a : x.args[0]; return { s: wrap(a, 4) + "'", lv: 4 }; }
      if (x.op === 'call') return join(x.fn, x.args);
      return join(x.op, [x.a, x.b]);
    }
    return show1(e).s;
  }

  /* ---------------- circuits ---------------- */

  // a name; a lamp's may be an operator's ("the AND lamp"), as lamps never appear in expressions
  function nameOf(v, what, re, lamp) {
    const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.normalize('NFD').replace(new RegExp('[' + BAR + ']', 'g'), "'").trim() : '';
    if (!(re || NAME).test(s)) fail(`${what} "${short(v)}" needs a short name: a letter, then up to 5 letters or digits (like A, B, Cin, Y)`);
    if (!lamp && KEYWORDS[s.toUpperCase()]) fail(`"${s}" can't be the name of ${what}: it is an operator`);
    return s;
  }
  function normPalette(p) {
    if (p == null || p === false) return null;
    const out = [];
    const add = (k, count) => {
      const pk = paletteKey(k);
      if (!pk) fail(`the palette has "${short(k)}"; use AND, OR, NOT, NAND, NOR, XOR, XNOR (AND3 for 3 inputs) or a block HA, FA, SR, D`);
      if (count === 0 || count === false) return;
      const c = count == null || count === true || count === 'any' ? null : clampInt(count, 1, LIMITS.count);
      const was = out.find((x) => x.type === pk.type && x.n === pk.n);
      if (was) { was.count = was.count == null || c == null ? null : Math.min(LIMITS.count, was.count + c); return; }
      out.push({ type: pk.type, n: pk.n, count: c });
    };
    if (p === true || p === 'all' || p === 'any') TYPES.forEach((t) => add(t, null));
    else if (typeof p === 'string') p.split(/[\s,]+/).filter(Boolean).forEach((k) => add(k, null));
    else if (Array.isArray(p)) p.forEach((x) => (isObj(x) ? add(String(x.type || x.gate || '') + (x.n === 3 ? '3' : ''), has(x, 'count') ? x.count : null) : add(x, null)));
    else if (isObj(p)) Object.keys(p).forEach((k) => add(k, p[k]));
    else fail('"palette" must say which gates the learner may place, like {"AND": 2, "NOT": 1}');
    if (!out.length) return null;
    const rank = (x) => KINDS.indexOf(x.type) * 4 + x.n;
    return out.sort((a, b) => rank(a) - rank(b));
  }
  const defaultPalette = () => TYPES.map((t) => ({ type: t, n: GATE[t].min, count: null }));

  // a lamp by its name, or by the description it was given as a label; null if there is none
  function lampName(outputs, k) {
    const key = txt(String(k == null ? '' : k), 40), low = key.toLowerCase();
    const o = outputs.find((x) => x.name === key) || outputs.find((x) => x.name.toLowerCase() === low) || outputs.find((x) => x.label && x.label.toLowerCase() === low);
    return o ? o.name : null;
  }

  // a spec from the AI (or a course file, or the learner's own build), checked; throws LogicError with a reason
  //   opts.loose: gate inputs and lamps may be left without wires (the learner finishes them)
  //   opts.quick: skip the search for a loop that never settles
  //   opts.binary: an expression's gates take two inputs each (A·B·C is two ANDs, not one with 3)
  function normSpec(spec, opts) {
    opts = opts || {};
    if (!isObj(spec)) fail('"spec" must be a JSON object');
    const taken = new Map();
    const claim = (name, what) => {
      const k = name.toLowerCase();
      if (taken.has(k)) fail(`the name "${name}" is used twice (${taken.get(k)} and ${what}); give each its own`);
      taken.set(k, what);
    };

    // the switches
    let rawIn = spec.inputs != null ? spec.inputs : spec.switches;
    if (typeof rawIn === 'number') rawIn = 'ABCDEF'.slice(0, clampInt(rawIn, 1, 6)).split('');
    if (typeof rawIn === 'string') rawIn = /^[A-Z]{2,6}$/.test(rawIn.trim()) ? rawIn.trim().split('') : rawIn.split(/[\s,]+/).filter(Boolean);
    if (rawIn == null && spec.clock) rawIn = [];
    if (!Array.isArray(rawIn) || (!rawIn.length && !spec.clock)) fail('"inputs" must list 1 to 6 switch names, like ["A", "B"]');
    const start = isObj(spec.set) ? spec.set : isObj(spec.start) ? spec.start : {};
    const startOf = (name) => { const k = Object.keys(start).find((x) => x === name) || Object.keys(start).find((x) => x.toLowerCase() === name.toLowerCase()); return k ? start[k] : 0; };
    const inputs = rawIn.map((x) => {
      const o = isObj(x) ? x : { name: x };
      const name = nameOf(o.name != null ? o.name : o.id, 'the input');
      claim(name, 'an input');
      const inp = { name, on: bit(o.on != null ? o.on : o.value != null ? o.value : o.state != null ? o.state : startOf(name)) };
      const label = txt(o.label, LIMITS.label);
      if (label) inp.label = label;
      if (o.clock) inp.clock = clampInt(isObj(o.clock) ? o.clock.ms : typeof o.clock === 'number' ? o.clock : 1000, 250, 5000) || 1000;
      return inp;
    });
    if (spec.clock) {
      const c = isObj(spec.clock) ? spec.clock : { name: typeof spec.clock === 'string' ? spec.clock : 'CLK' };
      const name = nameOf(c.name != null ? c.name : 'CLK', 'the clock');
      const ms = clampInt(c.ms != null ? c.ms : c.period != null ? c.period : 1000, 250, 5000) || 1000;
      const was = inputs.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (was) was.clock = ms;
      else { claim(name, 'the clock'); inputs.push({ name, on: bit(startOf(name)), clock: ms }); }
    }
    if (inputs.length > LIMITS.inputs) fail(`at most ${LIMITS.inputs} inputs (switches and the clock)`);

    // the lamps
    let rawOut = spec.outputs != null ? spec.outputs : spec.lamps != null ? spec.lamps : spec.output;
    if (typeof rawOut === 'string') rawOut = rawOut.split(/[\s,]+/).filter(Boolean);
    if (isObj(rawOut)) rawOut = Object.keys(rawOut).map((k) => ({ name: k, from: rawOut[k] }));
    if (!Array.isArray(rawOut) || !rawOut.length) fail('"outputs" must list 1 to 8 lamps, like ["Y"] or [{"name": "Y", "from": "G1"}]');
    if (rawOut.length > LIMITS.outputs) fail(`at most ${LIMITS.outputs} lamps`);
    // a lamp written with a description for a name ("Original", "A + A'") keeps it as its label, under a short name
    const auto = [];
    const outputs = rawOut.map((x, i) => {
      const o = isObj(x) ? x : { name: x };
      const given = o.name != null ? o.name : o.id;
      let name, label = txt(o.label, LIMITS.label);
      try { name = nameOf(given, 'the lamp', OUT_NAME, true); } catch (e) {
        if (!(e instanceof LogicError) || !txt(String(given == null ? '' : given), LIMITS.label)) throw e;
        if (!label) label = txt(String(given), LIMITS.label);
        auto.push(i);
      }
      if (name) claim(name, 'a lamp');
      const out = { name, from: null, raw: o.from != null ? o.from : o.in != null ? o.in : o.expr != null ? o.expr : o.source };
      if (label) out.label = label;
      return out;
    });
    auto.forEach((i) => {
      const name = ['Y', 'Z', 'X', 'W', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'].find((n) => !taken.has(n.toLowerCase()));
      claim(name, 'a lamp');
      outputs[i].name = name;
    });

    // the gates
    let rawGates = spec.gates != null ? spec.gates : [];
    if (!Array.isArray(rawGates)) fail('"gates" must be a list like [{"id": "G1", "type": "AND", "in": ["A", "B"]}]');
    if (rawGates.length > LIMITS.gates) fail(`at most ${LIMITS.gates} gates`);
    const gates = [];
    const pending = [];
    rawGates.forEach((g, i) => {
      if (!isObj(g)) fail(`gate ${i + 1} must be an object like {"id": "G1", "type": "AND", "in": ["A", "B"]}`);
      const type = typeOf(g.type != null ? g.type : g.gate);
      if (!type) fail(`gate ${txt(String(g.id || i + 1), 8)} has type "${short(g.type)}"; use AND, OR, NOT, NAND, NOR, XOR, XNOR, or a block HA, FA, SR, D`);
      const id = g.id != null ? nameOf(g.id, 'the gate') : null;
      if (id) claim(id, 'a gate');
      let ins = g.in != null ? g.in : g.inputs != null ? g.inputs : g.from;
      if (typeof ins === 'string') ins = ins.split(/\s*,\s*|\s+/).filter(Boolean);
      if (CHIPS[type] && isObj(ins)) {
        const o = ins;
        ins = CHIPS[type].ins.map((pin) => { const k = Object.keys(o).find((x) => x.toLowerCase() === pin.toLowerCase()); return k ? o[k] : null; });
      }
      if (ins == null) ins = [];
      if (!Array.isArray(ins)) fail(`${id || 'gate ' + (i + 1)}: "in" must list what drives each input, like ["A", "B"]`);
      let n = ins.length;
      if (CHIPS[type]) {
        if (n > CHIPS[type].ins.length) fail(`${id || type}: a ${CHIPS[type].name} has ${CHIPS[type].ins.length} inputs (${listOf(CHIPS[type].ins)})`);
        n = CHIPS[type].ins.length;
      } else {
        if (!n) n = GATE[type].min;
        if (n < GATE[type].min || n > GATE[type].max) fail(`${id || type} is a ${type} gate with ${n} input${n === 1 ? '' : 's'}; ${type === 'NOT' ? 'a NOT gate takes 1' : `it takes ${GATE[type].min} or ${GATE[type].max}`}`);
      }
      const gate = { id, type, in: [] };
      for (let k = 0; k < n; k++) {
        const r = ins[k];
        gate.in.push(r == null || r === '' ? null : typeof r === 'string' || typeof r === 'number' ? String(r).trim() : (fail(`${id || type}'s input ${k + 1} must name what drives it`)));
      }
      if (g.init != null || g.q != null) gate.init = bit(g.init != null ? g.init : g.q);
      if (Array.isArray(g.at) && g.at.length === 2) {
        const c = clampInt(g.at[0], 0, 7), r = clampInt(g.at[1], 0, 7);
        if (c != null && r != null) gate.at = [c, r];
      }
      gates.push(gate);
      const drives = g.out != null ? g.out : g.output != null ? g.output : g.to;
      if (drives != null) pending.push([gate, drives]);
    });
    let k = 0;
    const freshId = (type) => { let id; do { id = (CHIPS[type] ? 'U' : 'G') + (++k); } while (taken.has(id.toLowerCase())); return id; };
    gates.forEach((g) => { if (!g.id) { g.id = freshId(g.type); claim(g.id, 'a gate'); } });
    k = 0; // gates made from expressions are numbered from G1 again, past the names already taken

    // what each name means as a source of a signal
    const byId = new Map(gates.map((g) => [g.id, g]));
    const inByName = new Map(inputs.map((x) => [x.name, x]));
    function ref(r) {
      if (typeof r !== 'string') return null;
      const s = r.trim();
      const ci = (list, x) => list.find((n) => n === x) || list.find((n) => n.toLowerCase() === x.toLowerCase());
      const inName = ci([...inByName.keys()], s);
      if (inName) return inName;
      const m = /^([A-Za-z][A-Za-z0-9_]*)(?:\s*[.:]\s*(.+))?$/.exec(s);
      if (!m) return null;
      const gid = ci([...byId.keys()], m[1]);
      if (!gid) return null;
      const g = byId.get(gid);
      const chip = CHIPS[g.type];
      if (!m[2]) return chip ? gid + '.' + chip.outs[0] : gid;
      const pin = squash(m[2]);
      if (!chip) return ['OUT', 'Y', 'O', 'OUTPUT', 'Q', '0', '1'].includes(pin) ? gid : null;
      const found = chip.outs.find((o) => squash(o) === pin) || chip.outs.find((o) => (PIN_ALIAS[o] || []).includes(pin));
      return found ? gid + '.' + found : null;
    }
    // an expression where a wire was expected: build its gates (A·B + C is an AND and an OR)
    const memo = new Map();
    function build(src, where) {
      const names = [...inByName.keys()].concat([...byId.keys()]);
      let ast;
      try { ast = parse(String(src), names); } catch (e) {
        if (e instanceof ParseError) fail(`${where} comes from "${short(src)}", which is not an input or a gate (${e.message})`);
        throw e;
      }
      function rec(e) {
        if (e.op === 'var') return ref(e.name);
        if (e.op === 'const') fail(`${where}: a wire can't come from 0 or 1; use the inputs`);
        let type, args;
        if (e.op === 'not' || (e.op === 'call' && e.fn === 'not')) { type = 'NOT'; args = [e.op === 'not' ? e.a : e.args[0]]; } else if (e.op === 'call') {
          type = e.fn.toUpperCase(); args = e.args;
          if (args.length === 1 && (type === 'AND' || type === 'OR' || type === 'XOR')) return rec(args[0]);
        } else {
          type = e.op.toUpperCase();
          args = [e.a, e.b];
          if (FOLD[e.op] && !opts.binary) { // A·B·C: one 3-input gate
            const flat = [];
            const walk = (x) => { if (x.op === e.op) { walk(x.a); walk(x.b); } else flat.push(x); };
            walk(e);
            args = flat;
          }
        }
        let refs = args.map(rec);
        while (refs.length > 3 && FOLD[type.toLowerCase()]) refs = [gate(type, refs.slice(0, 3))].concat(refs.slice(3));
        if (refs.length < GATE[type].min || refs.length > GATE[type].max) fail(`${where}: ${type} takes ${GATE[type].min === GATE[type].max ? GATE[type].min : GATE[type].min + ' or ' + GATE[type].max} inputs`);
        return gate(type, refs);
      }
      function gate(type, refs) {
        const key = type + '(' + refs.join(',') + ')';
        if (memo.has(key)) return memo.get(key);
        if (gates.length >= LIMITS.gates) fail(`at most ${LIMITS.gates} gates`);
        const id = freshId(type);
        claim(id, 'a gate');
        const g = { id, type, in: refs };
        gates.push(g);
        byId.set(id, g);
        memo.set(key, id);
        return id;
      }
      return rec(ast);
    }

    // the wires, written as a list (instead of, or as well as, each gate's "in")
    if (spec.wires != null) {
      if (!Array.isArray(spec.wires)) fail('"wires" must be a list like [{"from": "A", "to": "G1"}]');
      spec.wires.forEach((w, i) => {
        if (!isObj(w)) fail(`wire ${i + 1} must be {"from": ..., "to": ...}`);
        const from = typeof w.from === 'string' ? w.from.trim() : '';
        const to = typeof w.to === 'string' ? w.to.trim() : '';
        if (!from || !to) fail(`wire ${i + 1} needs "from" and "to"`);
        const lamp = outputs.find((o) => o.name === lampName(outputs, to));
        if (lamp) {
          if (lamp.raw != null && String(lamp.raw).trim().toLowerCase() !== from.toLowerCase()) fail(`two wires go into the lamp ${lamp.name}; a lamp takes one`);
          lamp.raw = from;
          return;
        }
        const m = /^([A-Za-z][A-Za-z0-9_]*)(?:\s*[.:]\s*(?:in(?:put)?\s*)?(.+))?$/i.exec(to);
        const g = m && (byId.get(m[1]) || gates.find((x) => x.id.toLowerCase() === m[1].toLowerCase()));
        if (!g) fail(`wire ${i + 1} goes to "${short(to)}", which is not a gate or a lamp`);
        let pin;
        if (m[2] == null) {
          pin = g.in.findIndex((x) => x == null);
          if (pin < 0) fail(`${g.id} has no free input for the wire from ${short(from)}; each input takes one wire`);
        } else if (/^\d$/.test(m[2])) pin = Number(m[2]) - 1;
        else if (CHIPS[g.type]) pin = CHIPS[g.type].ins.findIndex((x) => x.toLowerCase() === m[2].trim().toLowerCase());
        else pin = 'ABC'.indexOf(m[2].trim().toUpperCase());
        if (!(pin >= 0 && pin < g.in.length)) fail(`wire ${i + 1} goes to "${short(to)}", which is not an input of ${g.id}`);
        if (g.in[pin] != null) fail(`two wires go into ${g.id}'s input ${pin + 1}; each input takes one wire`);
        g.in[pin] = from;
      });
    }
    // gates that say which lamp they drive
    pending.forEach(([g, d]) => {
      (Array.isArray(d) ? d : [d]).forEach((name) => {
        const lamp = outputs.find((o) => o.name === lampName(outputs, name));
        if (!lamp) fail(`${g.id} drives "${short(name)}", which is not a lamp`);
        if (lamp.raw != null && lamp.raw !== g.id) fail(`two things drive the lamp ${lamp.name}; a lamp takes one wire`);
        lamp.raw = g.id;
      });
    });

    // every wire comes from something that exists
    const loose = Boolean(opts.loose);
    const nGiven = gates.length;
    for (let gi = 0; gi < nGiven; gi++) {
      const g = gates[gi];
      g.in = g.in.map((r, i) => {
        if (r == null) return null;
        const x = ref(r);
        if (x) return x;
        return build(r, `${g.id}'s input ${i + 1}`);
      });
    }
    outputs.forEach((o) => {
      if (o.raw == null || o.raw === '') { delete o.raw; return; }
      if (typeof o.raw !== 'string') fail(`the lamp ${o.name}: "from" must name a gate or an input`);
      o.from = ref(o.raw) || build(o.raw, `the lamp ${o.name}`);
      delete o.raw;
    });

    // the palette, and whether the learner may build
    const palette = normPalette(spec.palette != null ? spec.palette : spec.bin);
    // editable when it says so, when it has a palette, or when there is nothing built yet to look at
    const edit = spec.edit != null ? Boolean(spec.edit) : Boolean(palette) || (!gates.length && outputs.every((o) => o.from == null));
    if (!loose && !edit) {
      gates.forEach((g) => g.in.forEach((r, i) => { if (r == null) fail(`${g.id}'s input ${i + 1} has no wire; say what drives it`); }));
      outputs.forEach((o) => { if (o.from == null) fail(`the lamp ${o.name} has no wire; give it "from" (a gate's id or an input)`); });
    }

    const out = { inputs, outputs, gates, palette: edit ? palette || defaultPalette() : null, edit, latch: Boolean(spec.latch || spec.sequential || spec.memory), seq: false, seg7: null, names: !(spec.names === false || spec.labels === false) };
    // loops: allowed when they settle (a latch); one that never settles is refused
    const loop = loopOf(out);
    out.seq = Boolean(loop) || gates.some((g) => CHIPS[g.type] && CHIPS[g.type].state);
    if (loop) out.latch = true;
    if (out.seq && !opts.quick) {
      const r = reach(out, compile(out), LIMITS.states);
      if (r.osc) fail(`the loop through ${listOf(loop || [])} never settles: it keeps switching (like an odd ring of NOT gates); make it a latch, or take the loop out`);
    }

    // a seven-segment digit
    const seg = spec.seg7 != null ? spec.seg7 : spec.display != null ? spec.display : spec.digit;
    if (seg) {
      const w = String(seg).toLowerCase();
      if (/seg|a-?g/.test(w) && w !== '7seg' && w !== 'seg7') {
        if (outputs.length !== 7) fail('"seg7": "segments" needs 7 lamps, a to g');
        out.seg7 = 'segments';
      } else {
        if (outputs.length > 4) fail('"seg7" shows up to 4 lamps as a binary number (the first is the highest bit)');
        out.seg7 = 'hex';
      }
    }
    return out;
  }

  // the gates on a loop (a gate whose output comes back to its own input), or null
  function loopOf(s) {
    const byId = new Map(s.gates.map((g) => [g.id, g]));
    const src = (r) => (r == null ? null : byId.get(r.split('.')[0]) || null);
    const mark = new Map();
    const stack = [];
    let found = null;
    function visit(g) {
      if (found) return;
      mark.set(g.id, 1);
      stack.push(g.id);
      for (const r of g.in) {
        const h = src(r);
        if (!h) continue;
        if (mark.get(h.id) === 1) { found = stack.slice(stack.indexOf(h.id)); return; }
        if (!mark.has(h.id)) visit(h);
        if (found) return;
      }
      stack.pop();
      mark.set(g.id, 2);
    }
    for (const g of s.gates) if (!mark.has(g.id)) visit(g);
    return found;
  }

  /* ---------------- running a circuit ---------------- */

  // signals: the inputs first, then each gate's output (a block's outputs, in order)
  function compile(s) {
    const idx = new Map();
    let n = 0;
    s.inputs.forEach((x) => idx.set(x.name, n++));
    const gs = s.gates.map((g) => {
      const chip = CHIPS[g.type] || null;
      let outs;
      if (chip) { outs = chip.outs.map((p) => { idx.set(g.id + '.' + p, n); return n++; }); idx.set(g.id, outs[0]); } else { idx.set(g.id, n); outs = [n++]; }
      return { id: g.id, type: g.type, chip, outs, init: g.init };
    });
    gs.forEach((g, i) => { g.ins = s.gates[i].in.map((r) => (r != null && idx.has(r) ? idx.get(r) : -1)); });
    const driver = new Map();
    gs.forEach((g, i) => g.outs.forEach((k) => driver.set(k, i)));
    // in order: each gate after the gates that feed it (loops are cut where they close)
    const order = [];
    const mark = new Array(gs.length).fill(0);
    const visit = (i) => {
      mark[i] = 1;
      gs[i].ins.forEach((k) => { const j = driver.get(k); if (j != null && !mark[j]) visit(j); });
      mark[i] = 2;
      order.push(i);
    };
    gs.forEach((g, i) => { if (!mark[i]) visit(i); });
    const outs = s.outputs.map((o) => (o.from != null && idx.has(o.from) ? idx.get(o.from) : -1));
    return { n, ni: s.inputs.length, gs, order, idx, outs };
  }
  function blank(c) {
    const v = new Array(c.n).fill(0);
    c.gs.forEach((g) => { if (g.init != null && !g.chip) v[g.outs[0]] = g.init; });
    return { v, q: c.gs.map((g) => (g.chip && g.init != null ? g.init : 0)), ck: c.gs.map(() => 1), osc: false, bad: false };
  }
  // the circuit settled with these inputs, from the state before (null: from rest)
  function settle(c, vec, prev) {
    const st = prev || blank(c);
    const v = st.v.slice(), q = st.q.slice(), ck = st.ck.slice();
    for (let i = 0; i < c.ni; i++) v[i] = vec[i] ? 1 : 0;
    let osc = false, bad = false;
    const max = 4 * c.gs.length + 8;
    for (let pass = 0; ; pass++) {
      let changed = false;
      bad = false;
      for (const gi of c.order) {
        const g = c.gs[gi];
        const a = g.ins.map((k) => (k >= 0 ? v[k] : 0));
        let o;
        switch (g.type) {
          case 'AND': o = a.reduce((x, y) => x & y); break;
          case 'OR': o = a.reduce((x, y) => x | y); break;
          case 'XOR': o = a.reduce((x, y) => x ^ y); break;
          case 'NAND': o = 1 - a.reduce((x, y) => x & y); break;
          case 'NOR': o = 1 - a.reduce((x, y) => x | y); break;
          case 'XNOR': o = 1 - a.reduce((x, y) => x ^ y); break;
          case 'NOT': o = 1 - a[0]; break;
          case 'HA': o = [a[0] ^ a[1], a[0] & a[1]]; break;
          case 'FA': o = [a[0] ^ a[1] ^ a[2], (a[0] & a[1]) | (a[2] & (a[0] ^ a[1]))]; break;
          case 'SR':
            if (a[0] && !a[1]) q[gi] = 1; else if (a[1] && !a[0]) q[gi] = 0;
            if (a[0] && a[1]) { o = [0, 0]; bad = true; } else o = [q[gi], 1 - q[gi]];
            break;
          case 'D':
            if (ck[gi] === 0 && a[1] === 1) q[gi] = a[0];
            ck[gi] = a[1];
            o = [q[gi], 1 - q[gi]];
            break;
          default: o = 0;
        }
        if (!Array.isArray(o)) o = [o];
        for (let j = 0; j < g.outs.length; j++) if (v[g.outs[j]] !== o[j]) { v[g.outs[j]] = o[j]; changed = true; }
      }
      if (!changed) break;
      if (pass >= max) { osc = true; break; }
    }
    return { v, q, ck, osc, bad };
  }
  const startVec = (s) => s.inputs.map((x) => x.on);
  const startState = (s, c) => settle(c || compile(s), startVec(s), null);
  // each lamp's value (null: no wire)
  const lampsOf = (c, st) => c.outs.map((k) => (k >= 0 ? st.v[k] : null));
  const vecOf = (s, set) => s.inputs.map((x) => (isObj(set) && has(set, x.name) ? bit(set[x.name]) : x.on));
  const vecStr = (vec) => vec.map((b) => (b ? 1 : 0)).join('');
  const vecFrom = (str, n) => { const s = String(str); if (!new RegExp('^[01]{' + n + '}$').test(s)) return null; return s.split('').map(Number); };

  // every row of the truth table (each lamp's column, as '0110'; '-' where it has no wire), from rest
  function table(s, c) {
    c = c || compile(s);
    const n = s.inputs.length;
    const cols = s.outputs.map(() => '');
    for (let r = 0; r < 1 << n; r++) {
      const st = settle(c, rowBits(r, n), null);
      lampsOf(c, st).forEach((b, i) => { cols[i] += b == null ? '-' : String(b); });
    }
    const out = {};
    s.outputs.forEach((o, i) => { out[o.name] = cols[i]; });
    return out;
  }
  const rowName = (s, r) => s.inputs.map((x, i) => x.name + '=' + rowBits(r, s.inputs.length)[i]).join(', ');

  // every state the circuit can reach, flipping one switch at a time from the start: [{ vec, st, path }]
  function reach(s, c, limit) {
    c = c || compile(s);
    const n = s.inputs.length;
    const key = (vec, st) => vecStr(vec) + '|' + st.v.slice(c.ni).join('') + '|' + st.q.join('') + st.ck.join('');
    const v0 = startVec(s);
    const st0 = settle(c, v0, null);
    if (st0.osc) return { nodes: [], osc: true };
    const first = { vec: v0, st: st0, path: [] };
    const seen = new Map([[key(v0, st0), first]]);
    const queue = [first];
    while (queue.length) {
      const node = queue.shift();
      for (let i = 0; i < n; i++) {
        const vec = node.vec.slice();
        vec[i] = 1 - vec[i];
        const st = settle(c, vec, node.st);
        if (st.osc) return { nodes: [...seen.values()], osc: true };
        const k = key(vec, st);
        if (seen.has(k)) continue;
        const next = { vec, st, path: node.path.concat([vecStr(vec)]) };
        seen.set(k, next);
        if (seen.size >= (limit || LIMITS.states)) return { nodes: [...seen.values()], osc: false, partial: true };
        queue.push(next);
      }
    }
    return { nodes: [...seen.values()], osc: false };
  }
  // the switch settings, one after another from the start, played through; null if they can't be
  function replay(s, c, path) {
    c = c || compile(s);
    if (!Array.isArray(path) || path.length > LIMITS.path) return null;
    let st = startState(s, c), vec = startVec(s);
    for (const p of path) {
      const v = vecFrom(p, s.inputs.length);
      if (!v) return null;
      vec = v;
      st = settle(c, vec, st);
    }
    return { vec, st };
  }

  /* ---------------- making a circuit for a truth table ---------------- */

  // the prime implicants of a column, then a small cover of its 1s (Quine-McCluskey): [[ [input, 1|0], ... ], ...]
  function sop(col, n) {
    const ones = [];
    for (let r = 0; r < col.length; r++) if (col[r] === '1') ones.push(r);
    if (!ones.length) return [];
    const full = (1 << n) - 1;
    let level = ones.map((r) => ({ v: r, m: full, cov: [r] }));
    const primes = [];
    while (level.length) {
      const next = new Map();
      const used = new Set();
      for (let i = 0; i < level.length; i++) {
        for (let j = i + 1; j < level.length; j++) {
          const a = level[i], b = level[j];
          if (a.m !== b.m) continue;
          const d = (a.v ^ b.v) & a.m;
          if (d && !(d & (d - 1))) {
            const m = a.m & ~d, v = a.v & m;
            const k = m + ':' + v;
            if (!next.has(k)) next.set(k, { v, m, cov: [...new Set(a.cov.concat(b.cov))] });
            used.add(i); used.add(j);
          }
        }
      }
      level.forEach((x, i) => { if (!used.has(i) && !primes.some((p) => p.m === x.m && p.v === x.v)) primes.push(x); });
      level = [...next.values()];
    }
    const left = new Set(ones);
    const chosen = [];
    // the essential ones first, then the one that covers most of what is left
    ones.forEach((r) => {
      const by = primes.filter((p) => p.cov.includes(r));
      if (by.length === 1 && !chosen.includes(by[0])) { chosen.push(by[0]); by[0].cov.forEach((x) => left.delete(x)); }
    });
    while (left.size) {
      let best = null, bestN = -1;
      primes.forEach((p) => {
        if (chosen.includes(p)) return;
        const k = p.cov.filter((x) => left.has(x)).length;
        const lits = bitsCount(p.m);
        if (k > bestN || (k === bestN && best && lits < bitsCount(best.m))) { best = p; bestN = k; }
      });
      chosen.push(best);
      best.cov.forEach((x) => left.delete(x));
    }
    return chosen.map((p) => {
      const lits = [];
      for (let i = 0; i < n; i++) { const b = 1 << (n - 1 - i); if (p.m & b) lits.push([i, p.v & b ? 1 : 0]); }
      return lits;
    });
  }
  const bitsCount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

  // a circuit for each column, from AND, OR and NOT or what stands in for them (NAND, NOR), two inputs each
  //   pref: 'AND' (AND, OR, NOT where there are), 'NAND' or 'NOR' (built from those first); form: 'sop' or 'pos'
  function sopCircuit(out, names, have, pref, form) {
    const n = names.length;
    const gates = [];
    const memo = new Map();
    const neg = new Map();
    let k = 0;
    const gate = (type, ins) => {
      const key = type + '(' + (type === 'NOT' ? ins : ins.slice().sort()).join(',') + ')';
      if (memo.has(key)) return memo.get(key);
      const id = '~' + (++k); // tidy() gives the real ids, past the inputs' names
      gates.push({ id, type, in: ins.slice() });
      memo.set(key, id);
      return id;
    };
    const can = (t) => Boolean(have[t]);
    const first = (list) => list.find((t) => can(t)) || null;
    const order = pref === 'NAND' ? ['NAND', 'NOT', 'NOR'] : pref === 'NOR' ? ['NOR', 'NOT', 'NAND'] : ['NOT', 'NAND', 'NOR'];
    const notT = first(order);
    function not(x) {
      if (neg.has(x)) return neg.get(x);
      if (!notT) throw new LogicError('no NOT');
      const r = notT === 'NOT' ? gate('NOT', [x]) : gate(notT, [x, x]);
      neg.set(x, r); neg.set(r, x);
      return r;
    }
    const andT = pref === 'NAND' ? first(['NAND', 'AND', 'NOR']) : pref === 'NOR' ? first(['NOR', 'AND', 'NAND']) : first(['AND', 'NAND', 'NOR']);
    const orT = pref === 'NAND' ? first(['NAND', 'OR', 'NOR']) : pref === 'NOR' ? first(['NOR', 'OR', 'NAND']) : first(['OR', 'NOR', 'NAND']);
    function and(a, b) {
      if (andT === 'AND') return gate('AND', [a, b]);
      if (andT === 'NAND') return not(gate('NAND', [a, b]));
      if (andT === 'NOR') return gate('NOR', [not(a), not(b)]);
      throw new LogicError('no AND');
    }
    function or(a, b) {
      if (orT === 'OR') return gate('OR', [a, b]);
      if (orT === 'NOR') return not(gate('NOR', [a, b]));
      if (orT === 'NAND') return gate('NAND', [not(a), not(b)]);
      throw new LogicError('no OR');
    }
    const outputs = {};
    try {
      Object.keys(out).forEach((name) => {
        const col = form === 'pos' ? out[name].split('').map((b) => (b === '1' ? '0' : '1')).join('') : out[name];
        const terms = sop(col, n);
        if (!terms.length) throw new LogicError('constant');
        const refs = terms.map((lits) => lits.map(([i, pos]) => (pos ? names[i] : not(names[i]))).reduce((a, b) => and(a, b)));
        let r = refs.reduce((a, b) => or(a, b));
        if (form === 'pos') r = not(r);
        outputs[name] = r;
      });
    } catch (e) { if (e instanceof LogicError) return null; throw e; }
    return tidy({ gates, outputs }, names);
  }
  // only the gates that reach a lamp, numbered in order
  function tidy(sol, avoid) {
    const no = new Set((avoid || []).map((x) => String(x).toLowerCase()));
    const fresh = (p, n) => { let id; do { id = p + (++n.k); } while (no.has(id.toLowerCase())); return id; };
    const byId = new Map(sol.gates.map((g) => [g.id, g]));
    const keep = new Set();
    const walk = (r) => { const g = byId.get(String(r).split('.')[0]); if (!g || keep.has(g.id)) return; keep.add(g.id); g.in.forEach(walk); };
    Object.values(sol.outputs).forEach(walk);
    const rename = new Map();
    const gates = [];
    const u = { k: 0 }, k = { k: 0 };
    sol.gates.forEach((g) => { if (keep.has(g.id)) rename.set(g.id, CHIPS[g.type] ? fresh('U', u) : fresh('G', k)); });
    const re = (r) => { if (r == null) return null; const [a, b] = String(r).split('.'); return rename.has(a) ? rename.get(a) + (b ? '.' + b : '') : r; };
    sol.gates.forEach((g) => { if (keep.has(g.id)) gates.push({ id: rename.get(g.id), type: g.type, in: g.in.map(re) }); });
    const outputs = {};
    Object.keys(sol.outputs).forEach((k2) => { outputs[k2] = re(sol.outputs[k2]); });
    return { gates, outputs };
  }

  // the smallest circuit of 2-input gates (and NOT) from these types for one column, tried in full; null if none within the budget
  function search(col, n, avail, maxGates, budget) {
    if (n > 4) return null;
    const R = 1 << n;
    const FULL = (1 << R) - 1;
    let target = 0;
    for (let r = 0; r < R; r++) if (col[r] === '1') target |= 1 << r;
    const sigs = [];
    for (let i = 0; i < n; i++) { let m = 0; for (let r = 0; r < R; r++) if ((r >> (n - 1 - i)) & 1) m |= 1 << r; sigs.push(m); }
    if (sigs.includes(target)) return { gates: [], outputs: null, from: sigs.indexOf(target) };
    const types = Object.keys(avail).filter((t) => TYPES.includes(t) && avail[t] > 0);
    const F = {
      AND: (a, b) => a & b, OR: (a, b) => a | b, XOR: (a, b) => a ^ b, NAND: (a, b) => ~(a & b) & FULL,
      NOR: (a, b) => ~(a | b) & FULL, XNOR: (a, b) => ~(a ^ b) & FULL, NOT: (a) => ~a & FULL
    };
    let nodes = 0;
    const picks = [];
    const left = Object.assign({}, avail);
    let found = null;
    function dfs(depth) {
      if (found || nodes > budget) return;
      const m = sigs.length;
      for (const t of types) {
        if (!left[t]) continue;
        left[t]--;
        if (t === 'NOT') {
          for (let i = 0; i < m && !found; i++) tryOne(t, i, i, F.NOT(sigs[i]), depth);
        } else {
          for (let i = 0; i < m && !found; i++) {
            for (let j = i; j < m && !found; j++) {
              if (i === j && t !== 'NAND' && t !== 'NOR') continue;
              tryOne(t, i, j, F[t](sigs[i], sigs[j]), depth);
            }
          }
        }
        left[t]++;
        if (found || nodes > budget) return;
      }
    }
    function tryOne(t, i, j, v, depth) {
      nodes++;
      if (nodes > budget) return;
      if (v === 0 || v === FULL || sigs.includes(v)) return;
      picks.push([t, i, j]);
      if (v === target) { found = picks.slice(); picks.pop(); return; }
      if (depth > 1) { sigs.push(v); dfs(depth - 1); sigs.pop(); }
      picks.pop();
    }
    for (let k = 1; k <= maxGates && !found && nodes <= budget; k++) dfs(k);
    if (!found) return null;
    return found;
  }
  function searchCircuit(name, col, names, avail, maxGates) {
    const n = names.length;
    const av = {};
    TYPES.forEach((t) => { const c = avail[keyOf(t, 2)] != null ? avail[keyOf(t, 2)] : 0; if (c > 0) av[t] = Math.min(c, maxGates); });
    const r = search(col, n, av, maxGates, LIMITS.search);
    if (!r) return null;
    if (!Array.isArray(r)) return { gates: [], outputs: { [name]: names[r.from] } };
    const refs = names.slice();
    const gates = r.map(([t, i, j], k) => {
      const id = '~' + (k + 1);
      const g = { id, type: t, in: t === 'NOT' ? [refs[i]] : [refs[i], refs[j]] };
      refs.push(id);
      return g;
    });
    return tidy({ gates, outputs: { [name]: gates[gates.length - 1].id } }, names);
  }

  /* ---------------- tasks ---------------- */

  // how many of each gate (type and inputs, "AND2", "NOT", "HA") the learner has: the palette, and the gates already placed
  function available(s) {
    const av = {};
    (s.palette || []).forEach((p) => { const k = keyOf(p.type, p.n); av[k] = p.count == null ? Infinity : (av[k] || 0) + p.count; });
    s.gates.forEach((g) => { const k = keyOf(g.type, g.in.length); av[k] = (av[k] == null ? 0 : av[k]) + 1; });
    return av;
  }
  const goalType = (v) => {
    const t = String(v || '').toLowerCase().trim();
    if (/^(build|make|design|construct|create|draw|implement)/.test(t)) return 'build';
    if (/^(fill|table|truth|complete|tabulate)/.test(t)) return 'fill';
    if (/^(find|set|switch|light|turn|toggle|input)/.test(t)) return 'find';
    if (/^(fix|repair|swap|correct|debug|replace|mend)/.test(t)) return 'fix';
    return null;
  };
  // the columns a goal asks for: { out: { Y: '0110' }, expr: { Y: 'A ⊕ B' } }
  function targetOf(goal, s, need) {
    const names = s.inputs.map((x) => x.name);
    const R = 1 << names.length;
    const outNames = s.outputs.map((o) => o.name);
    const findOut = (k) => lampName(s.outputs, k);
    const out = {}, expr = {}, srcs = {};
    let ex = goal.expr != null ? goal.expr : goal.expression != null ? goal.expression : goal.function;
    if (typeof ex === 'string') {
      const parts = ex.split(/\s*[;\n]\s*/).filter(Boolean);
      ex = {};
      parts.forEach((part, i) => {
        const m = /^\s*([A-Za-z][A-Za-z0-9_]*'?)\s*=(?!=)\s*(.+)$/.exec(part);
        if (m && findOut(m[1])) ex[findOut(m[1])] = m[2];
        else if (m && i === 0 && parts.length === 1) ex[outNames[0]] = m[2];
        else ex[outNames[Math.min(i, outNames.length - 1)]] = part;
      });
    }
    if (isObj(ex)) {
      Object.keys(ex).forEach((k) => {
        const name = findOut(k);
        if (!name) fail(`the goal has an expression for "${short(k)}", which is not a lamp (${listOf(outNames)})`);
        if (typeof ex[k] !== 'string') fail(`the expression for ${name} must be text, like "A·B + C"`);
        const src = ex[k].replace(/^\s*[A-Za-z][A-Za-z0-9_]*'?\s*=(?!=)\s*/, '');
        let ast;
        try { ast = parse(src, names); } catch (e) {
          if (e instanceof ParseError) fail(`the expression for ${name}: ${e.message}`);
          throw e;
        }
        const extra = varsOf(ast).filter((v) => !names.includes(v));
        if (extra.length) fail(`the expression for ${name} uses ${listOf(extra)}, which ${extra.length > 1 ? 'are not inputs' : 'is not an input'} (the inputs are ${listOf(names)})`);
        out[name] = astTable(ast, names);
        expr[name] = show(ast);
        srcs[name] = src;
      });
    }
    // "out" is the checked form ({ Y: '0110' }), read again when the page checks the task for itself
    let tb = goal.table != null ? goal.table : goal.truth_table != null ? goal.truth_table : goal.column != null ? goal.column : isObj(goal.out) ? goal.out : null;
    if (Array.isArray(tb) || typeof tb === 'string') tb = { [outNames[0]]: tb };
    if (isObj(tb)) {
      Object.keys(tb).forEach((k) => {
        const name = findOut(k);
        if (!name) fail(`the goal's table has a column for "${short(k)}", which is not a lamp (${listOf(outNames)})`);
        const v = tb[k];
        const xs = Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/[\s,]+/g, '').split('') : null;
        if (!xs || !xs.every(isBit)) fail(`the table for ${name} must be 0s and 1s, one for each row`);
        if (xs.length !== R) fail(`the table for ${name} has ${xs.length} rows; with ${names.length} input${names.length > 1 ? 's' : ''} it needs ${R} (counting in binary, ${names[0]} highest)`);
        if (out[name] && out[name] !== xs.map(bit).join('')) fail(`the table for ${name} does not match its expression`);
        out[name] = xs.map(bit).join('');
      });
    }
    let mt = goal.minterms != null ? goal.minterms : goal.ones;
    if (Array.isArray(mt)) mt = { [outNames[0]]: mt };
    if (isObj(mt)) {
      Object.keys(mt).forEach((k) => {
        const name = findOut(k);
        if (!name || !Array.isArray(mt[k])) fail(`"minterms" must list, for a lamp, the rows where it is 1`);
        const col = new Array(R).fill('0');
        mt[k].forEach((r) => { const i = clampInt(r, -1, R); if (i == null || i < 0 || i >= R) fail(`row ${short(r)} is not in the table (0 to ${R - 1})`); col[i] = '1'; });
        out[name] = col.join('');
      });
    }
    if (need && !Object.keys(out).length) fail('the goal needs what to make: "expr": "A·B + C", or "table": {"Y": [0, 1, 1, 1]}');
    Object.keys(out).forEach((k) => {
      if (!/0/.test(out[k]) || !/1/.test(out[k])) fail(`the goal for ${k} is always ${out[k][0]}; make it depend on the inputs`);
    });
    return { out, expr, srcs };
  }
  // does this circuit make these columns (every lamp wired, every gate feeding it wired)?
  function meets(s, out) {
    if (looseIn(s, Object.keys(out))) return false;
    const tb = table(s);
    return Object.keys(out).every((k) => tb[k] === out[k]);
  }
  // the first gate input with no wire, in what feeds these lamps
  function looseIn(s, names) {
    const byId = new Map(s.gates.map((g) => [g.id, g]));
    const seen = new Set();
    let found = null;
    const walk = (r) => {
      if (found || r == null) return;
      const g = byId.get(String(r).split('.')[0]);
      if (!g || seen.has(g.id)) return;
      seen.add(g.id);
      g.in.forEach((x, i) => { if (x == null && !found) found = { gate: g.id, pin: i }; else walk(x); });
    };
    s.outputs.filter((o) => names.includes(o.name)).forEach((o) => walk(o.from));
    return found;
  }
  // a solution from the AI: { gates, outputs } or { Y: "NAND(NAND(A, B), ...)" }, as a circuit on this spec's inputs
  function normSolution(s, raw, outNames) {
    const inputs = s.inputs.map((x) => ({ name: x.name }));
    let spec;
    if (typeof raw === 'string') spec = { inputs, outputs: [{ name: outNames[0], from: raw }] };
    else if (isObj(raw) && Array.isArray(raw.gates)) {
      const o = raw.outputs;
      const map = isObj(o) ? o : Array.isArray(o) ? Object.fromEntries(o.filter(isObj).map((x) => [x.name, x.from])) : {};
      spec = { inputs, gates: raw.gates, outputs: s.outputs.map((x) => ({ name: x.name, from: map[x.name] != null ? map[x.name] : null })) };
    } else if (isObj(raw)) spec = { inputs, outputs: s.outputs.map((x) => ({ name: x.name, from: raw[x.name] != null ? raw[x.name] : null })) };
    else fail('"solution" must be a circuit');
    const c = normSpec(Object.assign(spec, { edit: true }), { loose: true, quick: true });
    const outputs = {};
    c.outputs.forEach((x) => { if (x.from != null) outputs[x.name] = x.from; });
    return { gates: c.gates.map((g) => ({ id: g.id, type: g.type, in: g.in })), outputs };
  }
  // why this circuit isn't a fair way to do it ('' when it is): the gates the task allows, how many, and the right columns
  function solutionWhy(s, sol, out, allowed, avail, max) {
    const used = {};
    for (const g of sol.gates) {
      if (allowed && !allowed.includes(g.type)) return `it uses a ${g.type} gate, which the task doesn't allow`;
      const k = keyOf(g.type, g.in.length);
      used[k] = (used[k] || 0) + 1;
      if (!(used[k] <= (avail[k] || 0))) return `it uses more ${g.type} gates${GATE[g.type] && g.type !== 'NOT' ? ` with ${g.in.length} inputs` : ''} than the palette has`;
    }
    if (max != null && sol.gates.length > max) return `it uses ${sol.gates.length} gates; the task allows ${max}`;
    if (sol.gates.length > LIMITS.gates) return `it needs ${sol.gates.length} gates; the board holds ${LIMITS.gates}`;
    const c = { inputs: s.inputs, gates: sol.gates, outputs: s.outputs.map((o) => ({ name: o.name, from: sol.outputs[o.name] != null ? sol.outputs[o.name] : null })) };
    if (loopOf(c)) return 'it has a loop';
    const tb = table(c);
    for (const k of Object.keys(out)) {
      if (tb[k] === out[k]) continue;
      const r = [...out[k]].findIndex((b, i) => tb[k][i] !== b);
      return `it doesn't make ${k}: the row ${rowName(s, r)} gives ${tb[k][r] === '-' ? 'nothing' : tb[k][r]}, not ${out[k][r]}`;
    }
    return '';
  }
  // the smallest circuit from what the learner has that makes these columns, or null; exprs: the goal's own
  // expressions, built as written (a full adder's S = A ⊕ B ⊕ Cin is two XOR gates), tried first
  function synth(s, out, allowed, avail, max, exprs) {
    const names = s.inputs.map((x) => x.name);
    const have = {};
    TYPES.forEach((t) => { if ((!allowed || allowed.includes(t)) && (avail[keyOf(t, 2)] || 0) > 0) have[t] = true; });
    const fits = (sol) => sol && solutionWhy(s, sol, out, allowed, avail, max) === '';
    let best = null;
    if (exprs && Object.keys(out).every((k) => exprs[k])) {
      for (const binary of [true, false]) {
        try {
          const c = normSpec({ inputs: names, outputs: s.outputs.map((o) => ({ name: o.name, from: exprs[o.name] || null })), edit: true }, { loose: true, quick: true, binary });
          const sol = tidy({ gates: c.gates.map((g) => ({ id: g.id, type: g.type, in: g.in })), outputs: Object.fromEntries(c.outputs.filter((o) => o.from != null).map((o) => [o.name, o.from])) }, names);
          if (fits(sol) && (!best || sol.gates.length < best.gates.length)) best = sol;
        } catch (e) { if (!known(e)) throw e; }
      }
    }
    for (const pref of ['AND', 'NAND', 'NOR']) {
      for (const form of ['sop', 'pos']) {
        const sol = sopCircuit(out, names, have, pref, form);
        if (fits(sol) && (!best || sol.gates.length < best.gates.length)) best = sol;
      }
    }
    const keys = Object.keys(out);
    if (keys.length === 1 && names.length <= 4) {
      const cap = Math.min(max != null ? max : 7, best ? best.gates.length - 1 : 7, 7);
      if (cap >= 0) {
        const lim = {};
        Object.keys(avail).forEach((k) => { lim[k] = avail[k]; });
        if (allowed) TYPES.forEach((t) => { if (!allowed.includes(t)) lim[keyOf(t, 2)] = 0; });
        const sol = cap > 0 ? searchCircuit(keys[0], out[keys[0]], names, lim, cap) : null;
        if (fits(sol) && (!best || sol.gates.length < best.gates.length)) best = sol;
      }
    }
    return best;
  }

  function normTask(spec, goal) {
    if (!isObj(goal)) fail('"goal" must be a JSON object');
    // the kind of task written as a key: {"find": {"Y": 1}}, {"build": "A·B + C"}
    if (!goalType(goal.type || goal.task || goal.kind)) {
      const k = ['build', 'fill', 'find', 'fix'].find((x) => has(goal, x));
      if (k) {
        const v = goal[k], g = Object.assign({}, goal, { type: k });
        delete g[k];
        if (k === 'find' && isObj(v) && g.want == null) g.want = v;
        if ((k === 'build' || k === 'fix') && g.expr == null && g.table == null) {
          if (typeof v === 'string' || (isObj(v) && Object.values(v).every((x) => typeof x === 'string' && !/^[01\s,]+$/.test(x)))) g.expr = v;
          else if (Array.isArray(v) || isObj(v)) g.table = v;
        }
        goal = g;
      }
    }
    const type = goalType(goal.type || goal.task || goal.kind);
    if (!type) fail('"goal" needs "type": "build", "fill", "find" or "fix"');
    if (type === 'build') return buildTask(spec, goal);
    if (type === 'fill') return fillTask(spec, goal);
    if (type === 'find') return findTask(spec, goal);
    return fixTask(spec, goal);
  }

  function buildTask(spec, goal) {
    if (!isObj(spec)) fail('"spec" must be a JSON object');
    const s = normSpec(Object.assign({}, spec, { edit: true }), { loose: true });
    if (s.seq) fail('a build task\'s circuit must have no loops or latches');
    s.latch = false;
    const { out, expr, srcs } = targetOf(goal, s, true);
    const only = listTypes(goal.only != null ? goal.only : goal.allowed != null ? goal.allowed : goal.using);
    if (only && only.length) {
      const pal = (s.palette || []).filter((p) => only.includes(p.type));
      s.palette = pal.length ? pal : only.map((t) => ({ type: t, n: arity(t), count: null }));
      const bad = s.gates.find((g) => !only.includes(g.type));
      if (bad) fail(`${bad.id} is a ${bad.type} gate, but the task allows only ${listOf(only)}`);
    }
    const mx = goal.max != null ? goal.max : goal.max_gates != null ? goal.max_gates : goal.limit;
    const max = mx != null ? clampInt(mx, 1, LIMITS.gates) : null;
    if (max != null && s.gates.length > max) fail(`the circuit starts with ${s.gates.length} gates, more than the ${max} allowed`);
    if (max != null) s.palette.forEach((p) => { if (p.count == null || p.count > max) p.count = max; });
    const avail = available(s);
    const allowed = only && only.length ? only : null;
    if (meets(s, out)) fail('the circuit already makes the goal as it starts; leave the building to the learner');
    let solution = null;
    if (goal.solution != null || goal.answer != null) {
      try {
        const sol = normSolution(s, goal.solution != null ? goal.solution : goal.answer, Object.keys(out));
        if (solutionWhy(s, sol, out, allowed, avail, max) === '') solution = sol;
      } catch (e) { if (!known(e)) throw e; }
    }
    if (!solution) solution = synth(s, out, allowed, avail, max, srcs);
    if (!solution) {
      const pal = s.palette.map((p) => p.type + (p.n === 3 ? '3' : '') + (p.count == null ? '' : ' ×' + p.count)).join(', ');
      fail(`no circuit from the palette (${pal})${max != null ? ` with at most ${max} gates` : ''} makes this goal; give more gates, or check the goal`);
    }
    const g = { type: 'build', out };
    if (Object.keys(expr).length) g.expr = expr;
    if (allowed) g.only = allowed;
    if (max != null) g.max = max;
    g.solution = solution;
    return { spec: s, goal: g };
  }

  function fillTask(spec, goal) {
    if (!isObj(spec)) fail('"spec" must be a JSON object');
    const s = normSpec(Object.assign({}, spec, { edit: false }));
    if (s.seq) fail('a fill task needs a circuit with no loops or latches: its truth table must not depend on what came before');
    if (s.inputs.length > LIMITS.fill) fail(`a fill task has at most ${LIMITS.fill} inputs (16 rows to fill)`);
    let names = goal.outputs != null ? goal.outputs : goal.lamps != null ? goal.lamps : goal.fill;
    if (typeof names === 'string') names = [names];
    if (!Array.isArray(names) || !names.length) names = s.outputs.map((o) => o.name);
    const outs = names.map((k) => {
      const name = lampName(s.outputs, k);
      if (!name) fail(`the goal fills in "${short(k)}", which is not a lamp`);
      return name;
    });
    const tb = table(s);
    const out = {};
    outs.forEach((k) => { out[k] = tb[k]; });
    return { spec: s, goal: { type: 'fill', outputs: outs, out, live: Boolean(goal.live) } };
  }

  function wantOf(v, s, what) {
    const res = {};
    if (v == null) return res;
    const list = s[what === 'lamp' ? 'outputs' : 'inputs'];
    const find = (k) => (what === 'lamp' ? lampName(list, k) : (list.find((o) => o.name === k) || list.find((o) => o.name.toLowerCase() === String(k).toLowerCase().trim()) || {}).name);
    if (typeof v === 'string') v = v.split(/[\s,]+/).filter(Boolean);
    if (Array.isArray(v)) v = Object.fromEntries(v.map((k) => [k, 1]));
    if (!isObj(v)) fail(`"${what === 'lamp' ? 'want' : 'inputs'}" must be like {"Y": 1}`);
    Object.keys(v).forEach((k) => {
      const name = find(k);
      if (!name) fail(`the goal names "${short(k)}", which is not ${what === 'lamp' ? 'a lamp' : 'an input'}`);
      if (!isBit(v[k])) fail(`the goal for ${name} must be 0 or 1`);
      res[name] = bit(v[k]);
    });
    return res;
  }
  const meetsFind = (s, c, st, vec, want, keep) => {
    const lamps = lampsOf(c, st);
    return Object.keys(want).every((k) => lamps[s.outputs.findIndex((o) => o.name === k)] === want[k])
      && Object.keys(keep).every((k) => vec[s.inputs.findIndex((x) => x.name === k)] === keep[k]);
  };
  function findTask(spec, goal) {
    if (!isObj(spec)) fail('"spec" must be a JSON object');
    const s = normSpec(Object.assign({}, spec, { edit: false }));
    const want = wantOf(goal.want != null ? goal.want : goal.out != null ? goal.out : goal.outputs != null ? goal.outputs : goal.lamps, s, 'lamp');
    if (!Object.keys(want).length) fail('the goal needs "want": what the lamps should show, like {"Y": 1}');
    const keep = wantOf(goal.inputs != null ? goal.inputs : goal.keep != null ? goal.keep : goal.with, s, 'input');
    const c = compile(s);
    const v0 = startVec(s);
    const st0 = settle(c, v0, null);
    const said = Object.keys(want).map((k) => `${k} = ${want[k]}`).join(', ');
    if (meetsFind(s, c, st0, v0, want, keep)) fail(`the circuit already shows ${said} as it starts; set "set" so the switches start wrong`);
    const g = { type: 'find', want };
    if (Object.keys(keep).length) g.inputs = keep;
    if (!s.seq) {
      const n = s.inputs.length;
      let best = null, bestD = 99;
      for (let r = 0; r < 1 << n; r++) {
        const vec = rowBits(r, n);
        if (!meetsFind(s, c, settle(c, vec, null), vec, want, keep)) continue;
        const d = vec.reduce((a, b, i) => a + (b !== v0[i] ? 1 : 0), 0);
        if (d < bestD) { best = vec; bestD = d; }
      }
      if (!best) {
        // say why, so it can be put right: two lamps that always agree (an identity being shown) can't differ
        const keys = Object.keys(want), tb = table(s, c);
        let why = '';
        for (let i = 0; i < keys.length && !why; i++) {
          if (!tb[keys[i]].includes(String(want[keys[i]]))) why = `: ${keys[i]} is ${tb[keys[i]][0]} in every row`;
          for (let j = i + 1; j < keys.length && !why; j++) {
            if (tb[keys[i]] === tb[keys[j]]) why = `: ${keys[i]} and ${keys[j]} are equal in every row`;
            else if ([...tb[keys[i]]].every((x, r) => x !== tb[keys[j]][r])) why = `: ${keys[i]} and ${keys[j]} are opposite in every row`;
          }
        }
        fail(`no setting of the switches makes ${said}${why}; ask for something a setting can show`);
      }
      g.solution = { set: Object.fromEntries(s.inputs.map((x, i) => [x.name, best[i]])) };
    } else {
      const r = reach(s, c);
      if (r.osc) fail('the circuit never settles');
      const node = r.nodes.find((x) => meetsFind(s, c, x.st, x.vec, want, keep));
      if (!node) fail(`no way of flipping the switches makes ${said}`);
      g.solution = { path: node.path };
    }
    return { spec: s, goal: g };
  }

  function withTypes(s, types) {
    return Object.assign({}, s, { gates: s.gates.map((g) => (has(types, g.id) ? Object.assign({}, g, { type: types[g.id] }) : g)) });
  }
  function fixTask(spec, goal) {
    if (!isObj(spec)) fail('"spec" must be a JSON object');
    const s = normSpec(Object.assign({}, spec, { edit: false }));
    if (s.seq) fail('a fix task needs a circuit with no loops or latches');
    const { out, expr } = targetOf(goal, s, true);
    Object.keys(out).forEach((k) => { if (s.outputs.find((o) => o.name === k).from == null) fail(`the lamp ${k} has no wire`); });
    if (meets(s, out)) fail('the circuit already makes the goal; make exactly one gate the wrong type');
    let choices = listTypes(goal.choices != null ? goal.choices : goal.types);
    choices = (choices && choices.length ? choices : TYPES).filter((t) => t !== 'NOT' && GATE[t]);
    const swaps = [];
    s.gates.forEach((g) => {
      if (!GATE[g.type] || g.type === 'NOT') return;
      choices.forEach((t) => { if (t !== g.type && meets(withTypes(s, { [g.id]: t }), out)) swaps.push({ id: g.id, type: t }); });
    });
    if (!swaps.length) fail('no change of one gate\'s type makes the goal; check the circuit against the goal');
    let pick = swaps[0];
    const ans = isObj(goal.solution) ? goal.solution : isObj(goal.answer) ? goal.answer : null;
    if (ans) { const k = Object.keys(ans)[0]; const t = typeOf(ans[k]); const sw = swaps.find((x) => x.id.toLowerCase() === String(k).toLowerCase() && x.type === t); if (sw) pick = sw; } else if (typeof goal.gate === 'string') {
      const sw = swaps.find((x) => x.id.toLowerCase() === goal.gate.toLowerCase() && (!goal.to || x.type === typeOf(goal.to)));
      if (sw) pick = sw;
    }
    const g = { type: 'fix', out };
    if (Object.keys(expr).length) g.expr = expr;
    g.choices = choices;
    g.solution = { [pick.id]: pick.type };
    return { spec: s, goal: g };
  }

  /* ---------------- checking the learner's attempt ---------------- */

  // { correct, invalid?, why? }  why: { kind, ... } for the page to put in words
  function check(s, goal, value) {
    if (!isObj(value) || !isObj(goal)) return { correct: false, invalid: true };
    if (goal.type === 'build') return checkBuild(s, goal, value);
    if (goal.type === 'fill') return checkFill(s, goal, value);
    if (goal.type === 'find') return checkFind(s, goal, value);
    if (goal.type === 'fix') return checkFix(s, goal, value);
    return { correct: false, invalid: true };
  }
  // the learner's build as a circuit (null if it doesn't hold together)
  function builtOf(s, value) {
    if (!isObj(value) || !Array.isArray(value.gates) || value.gates.length > LIMITS.gates) return null;
    const outs = isObj(value.outputs) ? value.outputs : {};
    try {
      return normSpec({
        inputs: s.inputs.map((x) => ({ name: x.name, on: x.on })),
        outputs: s.outputs.map((o) => ({ name: o.name, from: typeof outs[o.name] === 'string' ? outs[o.name] : null })),
        gates: value.gates.map((g) => (isObj(g) ? { id: g.id, type: g.type, in: Array.isArray(g.in) ? g.in : [] } : g)),
        edit: true, latch: true
      }, { loose: true, quick: true });
    } catch (e) { if (known(e)) return null; throw e; }
  }
  function firstMiss(s, tb, out) {
    const R = 1 << s.inputs.length;
    for (let r = 0; r < R; r++) for (const k of Object.keys(out)) if (tb[k][r] !== out[k][r]) return { row: r, out: k, got: tb[k][r] === '-' ? null : Number(tb[k][r]), want: Number(out[k][r]) };
    return null;
  }
  function checkBuild(s, goal, value) {
    const b = builtOf(s, value);
    if (!b) return { correct: false, invalid: true, why: { kind: 'broken' } };
    const names = Object.keys(goal.out);
    for (const k of names) if (b.outputs.find((o) => o.name === k).from == null) return { correct: false, invalid: true, why: { kind: 'lamp', out: k } };
    if (b.seq) return { correct: false, why: { kind: 'loop' } };
    const lo = looseIn(b, names);
    if (lo) return { correct: false, invalid: true, why: { kind: 'loose', gate: lo.gate, pin: lo.pin } };
    if (goal.only) { const bad = b.gates.find((g) => !goal.only.includes(g.type)); if (bad) return { correct: false, why: { kind: 'only', gate: bad.id, type: bad.type, only: goal.only } }; }
    if (goal.max != null && b.gates.length > goal.max) return { correct: false, why: { kind: 'max', max: goal.max, used: b.gates.length } };
    const miss = firstMiss(s, table(b), goal.out);
    if (miss) return { correct: false, why: Object.assign({ kind: 'row' }, miss) };
    return { correct: true };
  }
  function checkFill(s, goal, value) {
    const cells = isObj(value.cells) ? value.cells : null;
    if (!cells) return { correct: false, invalid: true, why: { kind: 'cells' } };
    const R = 1 << s.inputs.length;
    let wrong = 0, first = null;
    for (const k of goal.outputs) {
      const col = Array.isArray(cells[k]) ? cells[k] : [];
      for (let r = 0; r < R; r++) if (col[r] !== 0 && col[r] !== 1) return { correct: false, invalid: true, why: { kind: 'cells', out: k, row: r } };
    }
    for (let r = 0; r < R; r++) {
      for (const k of goal.outputs) {
        if (String(cells[k][r]) !== goal.out[k][r]) { wrong++; if (!first) first = { row: r, out: k }; }
      }
    }
    if (wrong) return { correct: false, why: { kind: 'fill', row: first.row, out: first.out, wrong } };
    return { correct: true };
  }
  function checkFind(s, goal, value) {
    const c = compile(s);
    let vec, st;
    if (s.seq) {
      const r = replay(s, c, value.path);
      if (!r) return { correct: false, invalid: true };
      vec = r.vec; st = r.st;
    } else {
      vec = vecOf(s, value.set);
      st = settle(c, vec, null);
    }
    const lamps = lampsOf(c, st);
    for (const k of Object.keys(goal.want)) {
      const got = lamps[s.outputs.findIndex((o) => o.name === k)];
      if (got !== goal.want[k]) return { correct: false, why: { kind: 'out', out: k, got, want: goal.want[k] } };
    }
    for (const k of Object.keys(goal.inputs || {})) {
      if (vec[s.inputs.findIndex((x) => x.name === k)] !== goal.inputs[k]) return { correct: false, why: { kind: 'keep', input: k, want: goal.inputs[k] } };
    }
    return { correct: true };
  }
  function checkFix(s, goal, value) {
    const raw = isObj(value.types) ? value.types : {};
    const types = {};
    s.gates.forEach((g) => { const t = typeOf(raw[g.id]); if (t && t !== g.type && GATE[g.type] && g.type !== 'NOT' && goal.choices.includes(t)) types[g.id] = t; });
    if (!Object.keys(types).length) return { correct: false, invalid: true, why: { kind: 'same' } };
    const miss = firstMiss(s, table(withTypes(s, types)), goal.out);
    if (miss) return { correct: false, why: Object.assign({ kind: 'row' }, miss) };
    return { correct: true };
  }

  /* ---------------- in words ---------------- */

  // what a lamp's (or any signal's) wire carries, as an expression: (A·B)' + C; a block's output by its name
  function exprOf(s, r, seen) {
    seen = seen || new Set();
    const byId = new Map(s.gates.map((g) => [g.id, g]));
    function rec(x, depth) {
      if (x == null) return { s: '?', lv: 5 };
      const [id, pin] = String(x).split('.');
      const g = byId.get(id);
      if (!g) return { s: x, lv: 5 };
      if (pin || CHIPS[g.type] || seen.has(id) || depth > 8) return { s: x, lv: 5 };
      seen.add(id);
      const parts = g.in.map((y) => rec(y, depth + 1));
      seen.delete(id);
      const wrap = (p, lv) => (p.lv < lv ? '(' + p.s + ')' : p.s);
      const j = (sep, lv) => parts.map((p) => wrap(p, lv)).join(sep);
      switch (g.type) {
        case 'NOT': return { s: wrap(parts[0], 4) + "'", lv: 4 };
        case 'AND': return { s: j('·', 3), lv: 3 };
        case 'OR': return { s: j(' + ', 1), lv: 1 };
        case 'XOR': return { s: j(' ⊕ ', 2), lv: 2 };
        case 'NAND': return { s: '(' + j('·', 3) + ")'", lv: 4 };
        case 'NOR': return { s: '(' + j(' + ', 1) + ")'", lv: 4 };
        case 'XNOR': return { s: '(' + j(' ⊕ ', 2) + ")'", lv: 4 };
        default: return { s: x, lv: 5 };
      }
    }
    const out = rec(r, 0).s;
    return out.length > 160 ? null : out;
  }
  // a circuit as a list: G1 = NAND(A, B); G2 = NOT(G1); Y = G2
  function gateList(gates, outputs) {
    const bits = gates.map((g) => `${g.id} = ${g.type}(${g.in.map((x) => (x == null ? '?' : x)).join(', ')})`);
    Object.keys(outputs || {}).forEach((k) => { if (outputs[k] != null) bits.push(`${k} = ${outputs[k]}`); });
    return bits.join('; ');
  }

  return {
    LIMITS, TYPES, GATE, CHIPS, KINDS, LogicError, ParseError,
    normSpec, normTask, normPalette, compile, settle, startVec, startState, lampsOf, vecOf, vecStr, vecFrom, table, reach, replay,
    parse, evalAst, astTable, varsOf, show, rowBits, rowName, sop, sopCircuit, search, synth, available, keyOf, arity, typeOf, loopOf,
    targetOf, check, builtOf, exprOf, gateList, withTypes, looseIn, meets, text: txt, isObj
  };
});
