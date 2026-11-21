/* =====================================================================
   The graph's maths, shared by its two halves so both read everything
   the same way: the browser (assets/js/widgets/graph.js, as
   window.PrimerGraphExpr) and the server (server/widgets/graph.mjs,
   which imports this file).

   1. Expressions for y = f(x), in plain text: + - * / ^, unary minus,
      brackets, implicit products (2x, 3(x+1), 2sin(x), (x+1)(x-1)), the
      functions in FUNCS, pi and e, x and the sliders' names. Never eval
      or Function: an expression becomes a tree of closures over a fixed
      table of Math functions, and any name that isn't x, a slider, a
      function or a constant is an error.
        compile(src, names) -> f(scope)     f.uses: the names it reads
        throws ExprError, with a short sentence
   2. Specs and goals, checked strictly (cleanSpec, cleanGoal): the
      window, sliders, curves, points, lines, tangent and area; a goal
      that can be met with the sliders' steps and the points' snap (a
      grid search), and isn't met before the learner starts. Anything
      wrong throws GraphError, and the part is left out of the lesson.
   3. What both halves draw and check with: model(spec) (curve values,
      slopes, areas, where points are), meets(goal, value, spec) and
      solve(goal, spec).
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerGraphExpr = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const LIMITS = Object.freeze({
    src: 160,        // characters in one expression
    nodes: 200,      // its size, once read
    depth: 30,       // how deeply its brackets nest
    params: 4,       // sliders
    plots: 4,        // curves
    points: 8,
    lines: 6,
    label: 80,       // characters in a label
    steps: 2000,     // positions on one slider
    targets: 6,      // right places a goal may list
    search: 100000,  // slider settings a goal's grid search may try
    coord: 1e6       // the largest coordinate
  });

  class ExprError extends Error {
    constructor(message, pos) { super(message); this.name = 'ExprError'; this.pos = pos == null ? -1 : pos; }
  }
  class GraphError extends Error {
    constructor(message) { super(message); this.name = 'GraphError'; }
  }
  const bad = (msg) => { throw new GraphError(msg); };

  const fin = Number.isFinite;
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* ------------------------------------------------------------------ */
  /* 1. Expressions                                                      */
  /* ------------------------------------------------------------------ */

  // name -> { arity, f }; arity -2 means two or more values. No prototype, so "constructor" is no function.
  const FUNCS = Object.create(null);
  const def = (names, arity, f) => names.forEach((n) => { FUNCS[n] = { arity, f }; });
  def(['sin'], 1, Math.sin);
  def(['cos'], 1, Math.cos);
  def(['tan'], 1, Math.tan);
  def(['asin', 'arcsin'], 1, Math.asin);
  def(['acos', 'arccos'], 1, Math.acos);
  def(['atan', 'arctan'], 1, Math.atan);
  def(['sec'], 1, (v) => 1 / Math.cos(v));
  def(['csc', 'cosec'], 1, (v) => 1 / Math.sin(v));
  def(['cot'], 1, (v) => 1 / Math.tan(v));
  def(['sinh'], 1, Math.sinh);
  def(['cosh'], 1, Math.cosh);
  def(['tanh'], 1, Math.tanh);
  def(['sqrt'], 1, Math.sqrt);
  def(['cbrt'], 1, Math.cbrt);
  def(['abs'], 1, Math.abs);
  def(['ln'], 1, Math.log);
  def(['log'], 1, Math.log10);
  def(['exp'], 1, Math.exp);
  def(['floor'], 1, Math.floor);
  def(['ceil'], 1, Math.ceil);
  def(['round'], 1, Math.round);
  def(['sign', 'sgn'], 1, Math.sign);
  def(['min'], -2, Math.min);
  def(['max'], -2, Math.max);
  const INVERSE = { sin: 'asin', cos: 'acos', tan: 'atan' }; // sin^-1(x) is arcsin
  const CONSTS = Object.create(null);
  CONSTS.pi = Math.PI;
  CONSTS.e = Math.E;

  // a slider's name: a letter, then up to 7 letters, digits or _; never x, y, a function or a constant
  const NAME = /^[A-Za-z][A-Za-z0-9_]{0,7}$/;
  const reserved = (n) => n === 'x' || n === 'y' || n.toLowerCase() in FUNCS || n.toLowerCase() in CONSTS || n in Object.prototype;

  // b^e, with real odd roots of negative numbers: (-8)^(1/3) is -2
  function pow(b, e) {
    if (b >= 0 || Number.isInteger(e)) return Math.pow(b, e);
    if (!fin(e) || Number.isNaN(b)) return NaN;
    for (let q = 3; q <= 15; q += 2) {
      const p = e * q, r = Math.round(p);
      if (Math.abs(p - r) < 1e-9) return (r % 2 ? -1 : 1) * Math.pow(-b, e);
    }
    return NaN;
  }

  const UNI = { '−': '-', '–': '-', '—': '-', '×': '*', '·': '*', '⋅': '*', '∗': '*', '÷': '/', '∕': '/' };

  function tokenize(src) {
    const out = [];
    for (let i = 0; i < src.length;) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ') { i++; continue; }
      const rest = src.slice(i);
      let m;
      if ((m = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest))) {
        if (src[i + m[0].length] === '.') throw new ExprError(`the number "${m[0]}." has two decimal points`, i);
        out.push({ k: 'num', v: parseFloat(m[0]), s: m[0], p: i });
        i += m[0].length;
        continue;
      }
      if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) { out.push({ k: 'id', v: m[0], p: i }); i += m[0].length; continue; }
      if (c === '*' && src[i + 1] === '*') { out.push({ k: 'op', v: '^', p: i }); i += 2; continue; }
      const ch = UNI[c] || c;
      if ('+-*/^'.includes(ch)) { out.push({ k: 'op', v: ch, p: i }); i++; continue; }
      if (ch === '(' || ch === '[') { out.push({ k: '(', p: i }); i++; continue; }
      if (ch === ')' || ch === ']') { out.push({ k: ')', p: i }); i++; continue; }
      if (ch === ',' || ch === '|') { out.push({ k: ch, p: i }); i++; continue; }
      if (c === '√') { out.push({ k: 'sqrt', p: i }); i++; continue; }
      if (c === '²' || c === '³') { out.push({ k: 'op', v: '^', p: i }, { k: 'num', v: c === '²' ? 2 : 3, s: c, p: i }); i++; continue; }
      if (c === 'π') { out.push({ k: 'id', v: 'pi', p: i }); i++; continue; }
      if (c === '\\') throw new ExprError('a backslash: write plain text like a*x^2, not LaTeX', i);
      if (c === '=') throw new ExprError('an "=": give only the right-hand side, like 2*x + 1', i);
      if (c === '{' || c === '}') throw new ExprError('a brace: use ( and )', i);
      throw new ExprError(`the character "${c}" can't be read`, i);
    }
    return out;
  }

  // What a run of letters may be made of: the variables (exactly), functions and constants (in any case),
  // longest first, so "sinx" is sin x, "2ax" is 2 a x and "exp" is exp, not e x p.
  function vocabulary(vars) {
    const list = vars.map((v) => ({ s: v, k: 'var', ci: false }))
      .concat(Object.keys(FUNCS).map((f) => ({ s: f, k: 'fn', ci: true })), Object.keys(CONSTS).map((c) => ({ s: c, k: 'const', ci: true })));
    return list.sort((a, b) => b.s.length - a.s.length || (a.k === 'var' ? -1 : b.k === 'var' ? 1 : 0));
  }
  function splitId(tok, list) {
    const s = tok.v, out = [];
    for (let i = 0; i < s.length;) {
      let hit = null;
      for (const n of list) {
        const part = s.substr(i, n.s.length);
        if (part.length === n.s.length && (n.ci ? part.toLowerCase() === n.s : part === n.s)) { hit = n; break; }
      }
      if (!hit) throw new ExprError(`unknown name "${s}"`, tok.p);
      out.push({ k: hit.k, v: hit.s, p: tok.p + i });
      i += hit.s.length;
    }
    return out;
  }

  // The expression as a tree: { t: 'n', v } | { t: 'v', name } | { t: 'neg', a } | { t: '+-*/^', a, b } | { t: 'f', f, args }
  function parse(src, vars) {
    if (typeof src !== 'string') throw new ExprError('the expression is not text');
    const text = src.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=/, '');
    if (text.length > LIMITS.src) throw new ExprError(`the expression is longer than ${LIMITS.src} characters`);
    if (!text.trim()) throw new ExprError('the expression is empty');
    const list = vocabulary((vars || []).filter((v) => typeof v === 'string' && v));
    const toks = [];
    for (const tk of tokenize(text)) { if (tk.k === 'id') toks.push(...splitId(tk, list)); else toks.push(tk); }

    let i = 0, depth = 0, count = 0, bars = 0;
    const peek = () => toks[i];
    const isOp = (tk, v) => Boolean(tk) && tk.k === 'op' && tk.v === v;
    const show = (tk) => (tk.k === 'num' ? tk.s : tk.k === 'op' || tk.k === 'var' || tk.k === 'fn' || tk.k === 'const' ? tk.v : tk.k === 'sqrt' ? '√' : tk.k);
    const node = (n) => { if (++count > LIMITS.nodes) throw new ExprError('the expression is too long'); return n; };
    const fail = (tk) => { throw tk ? new ExprError(`unexpected "${show(tk)}"`, tk.p) : new ExprError('the expression ends too soon'); };
    // what can follow a value directly, as a product: a name, a bracket, √, or | opening an absolute value
    const startsFactor = (tk) => Boolean(tk) && (tk.k === 'var' || tk.k === 'const' || tk.k === 'fn' || tk.k === '(' || tk.k === 'sqrt' || (tk.k === '|' && bars === 0));
    const expect = (k) => {
      const tk = peek();
      if (tk && tk.k === k) { i++; return; }
      if (k === ')') throw new ExprError('a "(" without its ")"', tk ? tk.p : -1);
      throw new ExprError('a "|" without its partner', tk ? tk.p : -1);
    };

    function expr() {
      if (++depth > LIMITS.depth) throw new ExprError('the expression is nested too deeply');
      let a = term();
      while (isOp(peek(), '+') || isOp(peek(), '-')) { const op = toks[i++].v; a = node({ t: op, a, b: term() }); }
      depth--;
      return a;
    }
    function term() {
      let a = unary();
      for (;;) {
        const tk = peek();
        if (isOp(tk, '*') || isOp(tk, '/')) { i++; a = node({ t: tk.v, a, b: unary() }); }
        else if (startsFactor(tk)) a = node({ t: '*', a, b: power() });
        else return a;
      }
    }
    function unary() {
      const tk = peek();
      if (isOp(tk, '-')) { i++; return node({ t: 'neg', a: unary() }); }
      if (isOp(tk, '+')) { i++; return unary(); }
      return power();
    }
    function power() { // right to left: 2^3^2 is 2^9; the exponent may have a sign: 2^-x
      const base = primary();
      if (isOp(peek(), '^')) { i++; return node({ t: '^', a: base, b: unary() }); }
      return base;
    }
    function primary() {
      const tk = peek();
      if (!tk) fail(tk);
      if (tk.k === 'num') { i++; return node({ t: 'n', v: tk.v }); }
      if (tk.k === 'var') { i++; return node({ t: 'v', name: tk.v }); }
      if (tk.k === 'const') { i++; return node({ t: 'n', v: CONSTS[tk.v] }); }
      if (tk.k === 'fn') { i++; return call(tk); }
      if (tk.k === '(') { i++; const a = expr(); expect(')'); return a; }
      if (tk.k === '|') { i++; bars++; const a = expr(); expect('|'); bars--; return node({ t: 'f', f: 'abs', args: [a] }); }
      if (tk.k === 'sqrt') { i++; return node({ t: 'f', f: 'sqrt', args: [primary()] }); }
      return fail(tk);
    }
    function call(tk) {
      let name = tk.v, exp = null;
      if (isOp(peek(), '^')) { // sin^2(x); sin^-1(x) is arcsin
        i++;
        const neg = isOp(peek(), '-');
        if (neg) i++;
        const n = peek();
        if (!n || n.k !== 'num') throw new ExprError(`after "${name}^" put a number, or write (${name}(x))^2`, tk.p);
        i++;
        const v = neg ? -n.v : n.v;
        if (v === -1 && INVERSE[name]) name = INVERSE[name];
        else exp = v;
      }
      let args;
      const nx = peek();
      if (nx && nx.k === '(') {
        i++;
        args = [expr()];
        while (peek() && peek().k === ',') { i++; args.push(expr()); }
        expect(')');
      } else if (nx && (nx.k === 'num' || isOp(nx, '-') || startsFactor(nx))) {
        args = [bare()]; // sin x, sin 2x
      } else {
        throw new ExprError(`"${name}" needs a value in brackets, like ${name}(x)`, tk.p);
      }
      const F = FUNCS[name];
      if (F.arity > 0 && args.length !== F.arity) throw new ExprError(`"${name}" takes ${F.arity === 1 ? 'one value' : F.arity + ' values'}`, tk.p);
      if (F.arity === -2 && (args.length < 2 || args.length > 8)) throw new ExprError(`"${name}" takes 2 to 8 values`, tk.p);
      const n = node({ t: 'f', f: name, args });
      return exp == null ? n : node({ t: '^', a: n, b: node({ t: 'n', v: exp }) });
    }
    // a function's value written without brackets runs to the next + or -, or the next function
    function bare() {
      let a = unary();
      while (startsFactor(peek()) && peek().k !== 'fn') a = node({ t: '*', a, b: power() });
      return a;
    }

    const ast = expr();
    if (i < toks.length) {
      const tk = toks[i];
      if (tk.k === 'num') throw new ExprError(`a missing operator before "${tk.s}"`, tk.p);
      if (tk.k === ')') throw new ExprError('a ")" without its "("', tk.p);
      fail(tk);
    }
    return ast;
  }

  function build(n, uses) {
    switch (n.t) {
      case 'n': { const v = n.v; return () => v; }
      case 'v': { const k = n.name; uses.add(k); return (s) => s[k]; }
      case 'neg': { const a = build(n.a, uses); return (s) => -a(s); }
      case '+': { const a = build(n.a, uses), b = build(n.b, uses); return (s) => a(s) + b(s); }
      case '-': { const a = build(n.a, uses), b = build(n.b, uses); return (s) => a(s) - b(s); }
      case '*': { const a = build(n.a, uses), b = build(n.b, uses); return (s) => a(s) * b(s); }
      case '/': { const a = build(n.a, uses), b = build(n.b, uses); return (s) => a(s) / b(s); }
      case '^': { const a = build(n.a, uses), b = build(n.b, uses); return (s) => pow(a(s), b(s)); }
      case 'f': {
        const F = FUNCS[n.f].f, args = n.args.map((x) => build(x, uses));
        if (args.length === 1) { const a = args[0]; return (s) => F(a(s)); }
        return (s) => F(...args.map((g) => g(s)));
      }
      default: throw new ExprError('the expression can\'t be read');
    }
  }

  // The expression as a function of a scope ({ x: 1, a: 2 }); its .uses are the names it reads.
  function compile(src, vars) {
    const uses = new Set();
    const f = build(parse(src, vars), uses);
    f.uses = uses;
    return f;
  }
  // For tests and quick checks: evaluate('2x + a', { x: 1, a: 3 }) -> 5
  function evaluate(src, scope) {
    const s = Object.assign(Object.create(null), scope || {});
    return compile(src, Object.keys(s))(s);
  }

  /* ------------------------------------------------------------------ */
  /* Numbers                                                             */
  /* ------------------------------------------------------------------ */

  // the decimal places v needs (0.25 -> 2), at most 8
  function decimals(v) {
    if (!fin(v)) return 0;
    for (let d = 0; d <= 8; d++) {
      const m = Math.abs(v) * Math.pow(10, d);
      if (Math.abs(m - Math.round(m)) < 1e-9 * Math.max(1, m)) return d;
    }
    return 8;
  }
  const roundTo = (v, d) => Number(v.toFixed(Math.max(0, Math.min(10, d))));
  // v for people: at most d decimals, no trailing zeros, a real minus sign
  function fmt(v, d = 3) {
    if (!fin(v)) return '—';
    let r = roundTo(v, d);
    if (r === 0) r = 0; // no "-0"
    return String(r).replace('-', '−');
  }
  // the first of 1, 2, 5, 10 (times a power of ten) at least raw
  function niceStep(raw) {
    if (!(raw > 0) || !fin(raw)) return 1;
    const k = Math.floor(Math.log10(raw)), b = Math.pow(10, k);
    const m = [1, 2, 5, 10].find((q) => raw <= q * b * (1 + 1e-9));
    return roundTo(m * b, Math.max(0, -k));
  }
  // a slider's positions: min, min + step, ... up to max
  const slots = (p) => Math.floor((p.max - p.min) / p.step + 1e-9);
  const paramDecimals = (p) => Math.min(8, Math.max(decimals(p.step), decimals(p.min)));
  function onSteps(v, min, step, max) {
    const p = { min, step, max };
    const k = Math.max(0, Math.min(slots(p), Math.round((v - min) / step)));
    return roundTo(min + k * step, paramDecimals(p));
  }
  function steps(p) {
    const n = slots(p), d = paramDecimals(p), out = [];
    for (let k = 0; k <= n; k++) out.push(roundTo(p.min + k * p.step, d));
    return out;
  }
  // the nearest multiple of s inside [lo, hi] (a point's snap)
  function onGrid(v, s, lo, hi) {
    const d = decimals(s);
    const k0 = Math.ceil(lo / s - 1e-9), k1 = Math.floor(hi / s + 1e-9);
    if (k0 > k1) return roundTo(Math.max(lo, Math.min(hi, v)), d + 2);
    const k = Math.max(k0, Math.min(k1, Math.round(v / s)));
    return roundTo(k * s, d);
  }
  const near = (a, b, tol) => fin(a) && Math.abs(a - b) <= tol + 1e-9 * Math.max(1, Math.abs(b));

  /* ------------------------------------------------------------------ */
  /* 2. Specs                                                            */
  /* ------------------------------------------------------------------ */

  // The colours a curve or point may have: the lesson's inks (base.css), and a blue and a purple to go with them.
  const PALETTE = Object.freeze(Object.assign(Object.create(null), {
    blue: '#2c5a8a', red: '#9a3324', green: '#3d6a2c', gold: '#8a6128', purple: '#6b3d7a', ink: '#2b1d11'
  }));
  const ALIAS = Object.freeze(Object.assign(Object.create(null), {
    black: 'ink', grey: 'ink', gray: 'ink', brown: 'gold', orange: 'gold', yellow: 'gold', amber: 'gold',
    violet: 'purple', magenta: 'purple', navy: 'blue', teal: 'green', crimson: 'red', maroon: 'red'
  }));
  const ORDER = ['blue', 'red', 'green', 'purple', 'gold'];
  function colour(v, i, fallback) {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (s in PALETTE) return s;
    if (s in ALIAS) return ALIAS[s];
    return fallback || ORDER[i % ORDER.length];
  }

  const text = (v, max) => (typeof v === 'string'
    ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : typeof v === 'number' && fin(v) ? String(v) : '');

  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\s*[-+−]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(v)) return Number(v.replace('−', '-').trim());
    return NaN;
  }
  // a number, or an expression with no names in it ("-2*pi", "sqrt(2)")
  function numConst(v) {
    const n = num(v);
    if (fin(n) || typeof v !== 'string' || !v.trim()) return n;
    try { return compile(v, [])(Object.create(null)); } catch (e) { return NaN; }
  }
  // a number, or an expression in the sliders (a fixed point at "-b/(2*a)", a line at "k")
  function numOrExpr(v, names, what) {
    const n = num(v);
    if (fin(n)) { if (Math.abs(n) > LIMITS.coord) bad(`${what} is too large`); return n; }
    if (typeof v === 'string' && v.trim()) {
      const s = v.trim();
      if (s.length > LIMITS.src) bad(`${what} is too long`);
      try { compile(s, names); } catch (e) { bad(`${what} ("${s.slice(0, 40)}"): ${e.message}`); }
      return s;
    }
    return bad(`${what} is missing`);
  }
  function index(v, n, what) {
    const i = v == null ? 0 : num(v);
    if (!Number.isInteger(i) || i < 0 || i >= n) bad(`${what} names a curve that isn't there`);
    return i;
  }

  function range(v, axis) {
    if (!Array.isArray(v) || v.length !== 2) bad(`the ${axis} window must be [min, max]`);
    const a = numConst(v[0]), b = numConst(v[1]);
    if (!fin(a) || !fin(b)) bad(`the ${axis} window must be two numbers`);
    if (Math.abs(a) > LIMITS.coord || Math.abs(b) > LIMITS.coord) bad(`the ${axis} window is too large`);
    if (!(b - a > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)))) bad(`the ${axis} window must go from smaller to larger`);
    return [a, b];
  }
  const windowOf = (raw, axis) => {
    if (raw[axis] != null) return raw[axis];
    if (isObj(raw.window) && raw.window[axis] != null) return raw.window[axis];
    if (raw[axis + 'min'] != null || raw[axis + 'max'] != null) return [raw[axis + 'min'], raw[axis + 'max']];
    return undefined;
  };

  function cleanParam(p, i, taken) {
    if (!isObj(p)) bad(`slider ${i + 1} must be an object`);
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!NAME.test(name)) bad(`slider ${i + 1} needs a name like "a" or "k1"`);
    if (reserved(name)) bad(`a slider can't be called "${name}"`);
    if (taken.has(name)) bad(`two sliders are called "${name}"`);
    taken.add(name);
    const min = numConst(p.min), max = numConst(p.max);
    if (!fin(min) || !fin(max)) bad(`slider ${name} needs a number min and max`);
    if (Math.abs(min) > LIMITS.coord || Math.abs(max) > LIMITS.coord) bad(`slider ${name} is too large`);
    if (!(max > min)) bad(`slider ${name}: min must be less than max`);
    let step = num(p.step);
    if (p.step == null) step = niceStep((max - min) / 100);
    if (!(step > 0) || !fin(step)) bad(`slider ${name}: step must be a positive number`);
    const n = (max - min) / step;
    if (n > LIMITS.steps) bad(`slider ${name} has more than ${LIMITS.steps} steps`);
    if (n < 1 - 1e-9) bad(`slider ${name}: its step is larger than its range`);
    const given = p.value ?? p.start ?? p.initial ?? p.default;
    let value;
    if (given == null) value = onSteps((min + max) / 2, min, step, max);
    else {
      value = numConst(given);
      if (!fin(value) || value < min - 1e-9 || value > max + 1e-9) bad(`slider ${name}: its start value is outside ${min} to ${max}`);
      value = onSteps(value, min, step, max);
    }
    return { name, min, max, step, value, label: text(p.label, LIMITS.label) };
  }

  // A y window for curves given none: most of their values at the start, with 0 if it's close.
  function autoY(fs, X) {
    const vals = [];
    for (const f of fs) for (let k = 0; k <= 120; k++) { const y = f(X[0] + (X[1] - X[0]) * k / 120); if (fin(y)) vals.push(y); }
    if (vals.length < 10) bad('the curves have no values to show (give a "y" window)');
    vals.sort((a, b) => a - b);
    let lo = vals[Math.floor(vals.length * 0.05)], hi = vals[Math.ceil(vals.length * 0.95) - 1];
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const span = hi - lo;
    if (lo > 0 && lo < span * 0.6) lo = 0;
    if (hi < 0 && -hi < span * 0.6) hi = 0;
    lo -= span * 0.1; hi += span * 0.1;
    const s = niceStep((hi - lo) / 10);
    return [roundTo(Math.floor(lo / s) * s, decimals(s)), roundTo(Math.ceil(hi / s) * s, decimals(s))];
  }

  // Tick marks the spec asks for: a number, or a multiple of pi ("pi", "pi/2", "2pi") for angles.
  function ticks(v, R, allowPi) {
    if (v == null) return null;
    if (allowPi && typeof v === 'string') {
      const m = /^\s*(\d*)\s*(?:pi|π)\s*(?:\/\s*(\d+))?\s*$/i.exec(v);
      if (m) {
        const n = m[1] ? Number(m[1]) : 1, q = m[2] ? Number(m[2]) : 1;
        if (n >= 1 && n <= 4 && q >= 1 && q <= 12 && (R[1] - R[0]) / (n * Math.PI / q) <= 60) return { step: n * Math.PI / q, pi: [n, q] };
        return null;
      }
    }
    const s = num(v);
    return s > 0 && (R[1] - R[0]) / s <= 60 ? { step: s } : null;
  }

  // what a curve looks like at the start: it must have values over much of the window, and be seen in it
  function covers(f, X, Y, what) {
    const N = 200;
    let finite = 0, inside = 0, cross = false, prev = NaN;
    for (let k = 0; k <= N; k++) {
      const y = f(X[0] + (X[1] - X[0]) * k / N);
      if (fin(y)) {
        finite++;
        if (y >= Y[0] && y <= Y[1]) inside++;
        if (fin(prev) && ((prev < Y[0] && y > Y[1]) || (prev > Y[1] && y < Y[0]))) cross = true;
      }
      prev = y;
    }
    if (finite < 0.4 * (N + 1)) bad(`${what} has no value over most of the window`);
    if (inside < 4 && !cross) bad(`${what} is outside the window`);
  }

  function cleanSpec(raw) {
    if (!isObj(raw)) bad('the spec must be an object');
    const X = range(windowOf(raw, 'x'), 'x');

    const rawParams = raw.params ?? raw.sliders ?? [];
    if (!Array.isArray(rawParams)) bad('params must be a list');
    if (rawParams.length > LIMITS.params) bad(`more than ${LIMITS.params} sliders`);
    const taken = new Set();
    const params = rawParams.map((p, i) => cleanParam(p, i, taken));
    const names = params.map((p) => p.name);
    const start = Object.create(null);
    params.forEach((p) => { start[p.name] = p.value; });

    let rawPlots = raw.plots ?? raw.curves ?? raw.functions ?? [];
    if (typeof rawPlots === 'string' || isObj(rawPlots)) rawPlots = [rawPlots];
    if (!Array.isArray(rawPlots)) bad('plots must be a list');
    if (rawPlots.length > LIMITS.plots) bad(`more than ${LIMITS.plots} curves`);
    const fs = [];
    const plots = rawPlots.map((p, i) => {
      const o = typeof p === 'string' ? { expr: p } : isObj(p) ? p : bad(`curve ${i + 1} must be an object`);
      const given = o.expr ?? o.fn ?? o.f ?? o.y;
      const expr = typeof given === 'string' ? given.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/, '').trim() : '';
      if (!expr) bad(`curve ${i + 1} has no expression`);
      if (expr.length > LIMITS.src) bad(`curve ${i + 1}'s expression is longer than ${LIMITS.src} characters`);
      let f;
      try { f = compile(expr, ['x', ...names]); } catch (e) { bad(`curve ${i + 1} ("${expr.slice(0, 40)}"): ${e.message}`); }
      const s = Object.assign(Object.create(null), start);
      fs.push((x) => { s.x = x; return f(s); });
      const out = { expr, color: colour(o.color ?? o.colour, i), label: text(o.label, LIMITS.label) };
      if (o.dashed === true || o.dash === true) out.dashed = true;
      return out;
    });

    const wy = windowOf(raw, 'y');
    const Y = wy === undefined ? (fs.length ? autoY(fs, X) : bad('the y window is missing')) : range(wy, 'y');
    fs.forEach((f, i) => covers(f, X, Y, `curve ${i + 1} ("${plots[i].expr.slice(0, 40)}")`));

    const inX = (v) => fin(v) && v >= X[0] - 1e-9 && v <= X[1] + 1e-9;
    const inY = (v) => fin(v) && v >= Y[0] - 1e-9 && v <= Y[1] + 1e-9;
    const valAt = (v) => (typeof v === 'number' ? v : compile(v, names)(Object.assign(Object.create(null), start)));
    const xr = X[1] - X[0], yr = Y[1] - Y[0];

    const rawPoints = raw.points ?? [];
    if (!Array.isArray(rawPoints)) bad('points must be a list');
    if (rawPoints.length > LIMITS.points) bad(`more than ${LIMITS.points} points`);
    const points = rawPoints.map((p0, i) => {
      const p = Array.isArray(p0) && p0.length === 2 ? { x: p0[0], y: p0[1] } : p0;
      if (!isObj(p)) bad(`point ${i + 1} must be an object`);
      const what = `point ${i + 1}`;
      const onRaw = p.on ?? p.curve;
      const on = onRaw == null ? null : index(onRaw, plots.length, what);
      // A dragged point's x and y are numbers, or a slider's name: dragging it then moves that slider
      // ({"x": "h", "y": "k", "drag": true} is a vertex that sets h and k). One placed by any other
      // expression ("-b/(2*a)") can't be dragged: it follows the sliders.
      const slider = (v) => (typeof v === 'string' ? params.find((q) => q.name === v.trim()) || null : null);
      const dragAxis = (v) => Boolean(slider(v)) || fin(numConst(v));
      const drag = (p.drag === true || p.draggable === true || p.movable === true) && dragAxis(p.x) && (on != null || dragAxis(p.y));
      const out = { label: text(p.label, 40), color: colour(p.color ?? p.colour, 0, drag ? 'red' : 'ink'), drag };
      let x, y;
      if (drag) {
        let sx, sy;
        if (Array.isArray(p.snap)) { sx = num(p.snap[0]); sy = num(p.snap[1]); } else sx = sy = num(p.snap);
        if (!(sx > 0) || sx > xr / 4 || sx < xr / LIMITS.steps) sx = niceStep(xr / 20);
        if (!(sy > 0) || sy > yr / 4 || sy < yr / LIMITS.steps) sy = niceStep(yr / 20);
        const qx = slider(p.x), qy = on == null ? slider(p.y) : null;
        if (qx) sx = qx.step;
        if (qy) sy = qy.step;
        out.snap = [sx, sy];
        if (qx) { out.x = qx.name; x = qx.value; } else {
          x = numConst(p.x);
          if (!inX(x)) bad(`${what} needs an x inside the window`);
          out.x = x = onGrid(x, sx, X[0], X[1]);
        }
        if (on == null) {
          if (qy) { out.y = qy.name; y = qy.value; } else {
            y = numConst(p.y);
            if (!inY(y)) bad(`${what} needs a y inside the window`);
            out.y = y = onGrid(y, sy, Y[0], Y[1]);
          }
        }
      } else {
        out.x = numOrExpr(p.x, names, `${what}'s x`);
        x = valAt(out.x);
        if (on == null) { out.y = numOrExpr(p.y, names, `${what}'s y`); y = valAt(out.y); }
      }
      if (on != null) { out.on = on; y = fs[on](x); }
      if (!inX(x) || !inY(y)) bad(`${what} is outside the window at the start`);
      return out;
    });
    if (!plots.length && !points.length) bad('the graph has nothing to draw');

    const rawLines = raw.lines ?? [];
    if (!Array.isArray(rawLines)) bad('lines must be a list');
    if (rawLines.length > LIMITS.lines) bad(`more than ${LIMITS.lines} lines`);
    const lines = rawLines.map((l, i) => {
      if (!isObj(l)) bad(`line ${i + 1} must be an object`);
      const hasX = l.x != null, hasY = l.y != null;
      if (hasX === hasY) bad(`line ${i + 1} needs x (a vertical line) or y (a horizontal one)`);
      const out = { label: text(l.label, 40), color: colour(l.color ?? l.colour, 0, 'ink') };
      if (hasX) { out.x = numOrExpr(l.x, names, `line ${i + 1}`); if (!inX(valAt(out.x))) bad(`line ${i + 1} is outside the window`); }
      else { out.y = numOrExpr(l.y, names, `line ${i + 1}`); if (!inY(valAt(out.y))) bad(`line ${i + 1} is outside the window`); }
      return out;
    });

    const spec = { x: X, y: Y, params, plots, points, lines };
    const xt = ticks(raw.xstep ?? raw.xStep ?? raw.xticks, X, true);
    if (xt && !xt.pi && Array.isArray(raw.xpi)) { // a spec cleaned before: its ticks in multiples of pi
      const [n, q] = raw.xpi.map(Number);
      if (Number.isInteger(n) && Number.isInteger(q) && n >= 1 && n <= 4 && q >= 1 && q <= 12 && Math.abs(n * Math.PI / q - xt.step) < 1e-9) xt.pi = [n, q];
    }
    if (xt) { spec.xstep = xt.step; if (xt.pi) spec.xpi = xt.pi; }
    const yt = ticks(raw.ystep ?? raw.yStep ?? raw.yticks, Y, false);
    if (yt) spec.ystep = yt.step;

    if (raw.tangent != null && raw.tangent !== false) {
      const tg = raw.tangent === true ? {} : raw.tangent;
      if (!isObj(tg)) bad('the tangent must be an object');
      if (!plots.length) bad('a tangent needs a curve');
      const plot = index(tg.plot ?? tg.curve, plots.length, 'the tangent');
      let snap = num(tg.snap);
      if (!(snap > 0) || snap > xr / 4 || snap < xr / LIMITS.steps) snap = niceStep(xr / 100);
      let x = tg.x == null ? (X[0] + X[1]) / 2 : numConst(tg.x);
      if (!inX(x)) bad('the tangent must start inside the window');
      x = onGrid(x, snap, X[0], X[1]);
      spec.tangent = { plot, x, snap };
      const m = model(spec);
      const y = m.y(plot, x, start), k = m.slope(plot, x, start);
      if (!inY(y) || !fin(k)) bad('the tangent must start where the curve is smooth and in view');
    }

    if (raw.area != null && raw.area !== false) {
      const ar = raw.area;
      if (!isObj(ar)) bad('the area must be an object');
      if (!plots.length) bad('an area needs a curve');
      const plot = index(ar.plot ?? ar.curve, plots.length, 'the area');
      const from = numOrExpr(ar.from ?? ar.a ?? ar.start, names, 'the area\'s "from"');
      const to = numOrExpr(ar.to ?? ar.b ?? ar.end, names, 'the area\'s "to"');
      const a = valAt(from), b = valAt(to);
      if (!inX(a) || !inX(b)) bad('the area must start and end inside the window');
      if (Math.abs(b - a) < xr * 1e-3) bad('the area must be wider');
      spec.area = { plot, from, to };
      if (!fin(model(spec).integral(plot, a, b, start))) bad('the area under the curve has no finite value');
    }
    return spec;
  }

  /* ------------------------------------------------------------------ */
  /* 3. The model: values, slopes, areas, where points are               */
  /* ------------------------------------------------------------------ */

  const models = new WeakMap();
  function model(spec) {
    let m = models.get(spec);
    if (m) return m;
    const names = spec.params.map((p) => p.name);
    const fs = spec.plots.map((p) => compile(p.expr, ['x', ...names]));
    const exprs = new Map();
    const scope = Object.create(null);
    const load = (P) => { for (const k of names) scope[k] = P[k]; };
    const xr = spec.x[1] - spec.x[0];
    m = {
      names,
      start() { const o = {}; spec.params.forEach((p) => { o[p.name] = p.value; }); return o; },
      uses: (i) => fs[i].uses,
      // curve i at x, with the sliders at P
      y(i, x, P) { load(P); scope.x = x; return fs[i](scope); },
      // curve i as a function of x alone, for drawing
      curve(i, P) {
        const s = Object.create(null);
        for (const k of names) s[k] = P[k];
        const f = fs[i];
        return (x) => { s.x = x; return f(s); };
      },
      // a number, or an expression in the sliders
      val(v, P) {
        if (typeof v === 'number') return v;
        let f = exprs.get(v);
        if (!f) { f = compile(v, names); exprs.set(v, f); }
        load(P);
        return f(scope);
      },
      // the slope of curve i at x; NaN where it has a corner, a gap or no value
      slope(i, x, P) {
        const f = m.curve(i, P), h = xr * 1e-6;
        const a = f(x - h), b = f(x), c = f(x + h);
        if (!fin(a) || !fin(b) || !fin(c)) return NaN;
        const l = (b - a) / h, r = (c - b) / h;
        if (Math.abs(l - r) > 1e-3 * (1 + Math.abs(l) + Math.abs(r))) return NaN;
        return (c - a) / (2 * h);
      },
      // the signed area under curve i from a to b (Simpson's rule); NaN if the curve has a gap there
      integral(i, a, b, P) {
        if (!fin(a) || !fin(b)) return NaN;
        if (a === b) return 0;
        const f = m.curve(i, P), n = 600, h = (b - a) / n;
        let s = f(a) + f(b);
        for (let k = 1; k < n; k++) s += f(a + k * h) * (k % 2 ? 4 : 2);
        const v = s * h / 3;
        return fin(v) ? v : NaN;
      },
      // where point pt is: a dragged one at pos (its own state), unless the axis is a slider's; a fixed
      // one where the sliders put it
      pointAt(pt, P, pos) {
        const x = pt.drag && pos && typeof pt.x === 'number' ? pos.x : m.val(pt.x, P);
        const y = pt.on != null ? m.y(pt.on, x, P) : pt.drag && pos && typeof pt.y === 'number' ? pos.y : m.val(pt.y, P);
        return { x, y };
      }
    };
    models.set(spec, m);
    return m;
  }

  /* ------------------------------------------------------------------ */
  /* Goals                                                               */
  /* ------------------------------------------------------------------ */

  const GOALS = Object.freeze(Object.assign(Object.create(null), {
    params: 'params', sliders: 'params', slider: 'params', parameters: 'params', set: 'params',
    point: 'point', drag: 'point', move: 'point',
    x: 'x', tap: 'x', click: 'x', pick: 'x', choose: 'x'
  }));
  // [x, y] or { x, y }
  function pairOf(v) {
    if (Array.isArray(v) && v.length === 2) { const a = numConst(v[0]), b = numConst(v[1]); return fin(a) && fin(b) ? [a, b] : null; }
    if (isObj(v) && v.x != null && v.y != null) { const a = numConst(v.x), b = numConst(v.y); return fin(a) && fin(b) ? [a, b] : null; }
    return null;
  }
  const onePair = (v) => (Array.isArray(v) && v.length === 2 && !Array.isArray(v[0]) && !isObj(v[0])) || (isObj(v) && v.x != null);

  function cleanGoal(raw, spec, opts) {
    if (!isObj(raw)) bad('the goal must be an object');
    const type = GOALS[text(raw.type, 20).toLowerCase()];
    if (!type) bad('the goal\'s type must be "params", "point" or "x"');
    const X = spec.x, Y = spec.y, xr = X[1] - X[0], yr = Y[1] - Y[0];
    const inside = ([x, y]) => x >= X[0] - 1e-9 && x <= X[1] + 1e-9 && y >= Y[0] - 1e-9 && y <= Y[1] + 1e-9;
    let goal;

    if (type === 'params') {
      if (!spec.params.length) bad('a params goal needs sliders');
      goal = { type };
      const vals = raw.values ?? raw.params ?? raw.set;
      if (vals != null) {
        if (!isObj(vals)) bad('"values" must map slider names to numbers');
        const o = {};
        for (const k of Object.keys(vals)) {
          const p = spec.params.find((q) => q.name === k);
          if (!p) bad(`the goal names a slider "${k}" that isn't there`);
          const v = numConst(vals[k]);
          if (!fin(v) || v < p.min - 1e-9 || v > p.max + 1e-9) bad(`the goal's ${k} is outside its slider`);
          o[k] = v;
        }
        if (Object.keys(o).length) goal.values = o;
      }
      // range: any value from lo to hi (inclusive) on a slider, where several are right
      const rng = raw.range ?? raw.between;
      if (rng != null) {
        if (!isObj(rng)) bad('"range" must map slider names to [low, high]');
        const o = {};
        for (const k of Object.keys(rng)) {
          const p = spec.params.find((q) => q.name === k);
          if (!p) bad(`the goal names a slider "${k}" that isn't there`);
          if (goal.values && k in goal.values) bad(`the goal gives ${k} both a value and a range`);
          const r = Array.isArray(rng[k]) && rng[k].length === 2 ? rng[k].map(numConst) : [];
          if (!r.length || !r.every(fin) || r[0] > r[1]) bad(`the range for ${k} must be [low, high]`);
          o[k] = r;
        }
        if (Object.keys(o).length) goal.range = o;
      }
      let thr = raw.through ?? raw.passes ?? raw.points;
      if (thr != null) {
        if (onePair(thr)) thr = [thr];
        if (!Array.isArray(thr)) bad('"through" must list points [x, y]');
        if (thr.length > LIMITS.targets) bad(`"through" lists more than ${LIMITS.targets} points`);
        const pts = thr.map((q) => pairOf(q) || bad('a point in "through" must be [x, y]'));
        if (!pts.every(inside)) bad('a point in "through" is outside the window');
        if (pts.length) {
          if (!spec.plots.length) bad('"through" needs a curve');
          goal.through = pts;
          goal.plot = index(raw.plot ?? raw.curve, spec.plots.length, 'the goal');
        }
      }
      if (!goal.values && !goal.range && !goal.through) bad('a params goal needs "values", "range" or "through"');
      // tol: how far from a "through" point counts (y units); vtol: how far from a slider value (alone, tol is that)
      const tol = num(raw.tol ?? raw.tolerance);
      const vtol = goal.through ? num(raw.vtol) : num(raw.vtol ?? raw.tol ?? raw.tolerance);
      if (goal.through) {
        goal.tol = tol > 0 ? tol : yr * 0.01;
        if (goal.tol > yr / 10) bad('the goal\'s tolerance is too loose');
      }
      if (goal.values && vtol > 0) {
        if (Object.keys(goal.values).some((k) => { const p = spec.params.find((q) => q.name === k); return vtol > (p.max - p.min) / 10; })) bad('the goal\'s tolerance is too loose');
        goal.vtol = vtol;
      }
    } else if (type === 'point') {
      const drags = spec.points.map((p, i) => (p.drag ? i : -1)).filter((i) => i >= 0);
      if (!drags.length) bad('a point goal needs a draggable point');
      const i = raw.point == null ? drags[0] : num(raw.point);
      if (!Number.isInteger(i) || !spec.points[i] || !spec.points[i].drag) bad('the goal\'s point must be a draggable point');
      let at = raw.at ?? raw.to ?? raw.target;
      if (onePair(at)) at = [at];
      if (!Array.isArray(at) || !at.length) bad('a point goal needs "at": [x, y]');
      if (at.length > LIMITS.targets) bad(`"at" lists more than ${LIMITS.targets} places`);
      const targets = at.map((q) => pairOf(q) || bad('each place in "at" must be [x, y]'));
      if (!targets.every(inside)) bad('a place in "at" is outside the window');
      const pt = spec.points[i];
      let tx, ty;
      const tol = raw.tol ?? raw.tolerance;
      if (Array.isArray(tol)) { tx = num(tol[0]); ty = num(tol[1]); } else tx = ty = num(tol);
      if (!(tx > 0)) tx = pt.snap[0] / 2;
      if (!(ty > 0)) ty = pt.on != null ? Math.max(pt.snap[1] / 2, yr * 0.02) : pt.snap[1] / 2;
      if (tx > xr / 10 || ty > yr / 10) bad('the goal\'s tolerance is too loose');
      goal = { type, point: i, at: targets, tol: [tx, ty] };
    } else {
      let at = raw.at ?? raw.x ?? raw.target;
      if (!Array.isArray(at)) at = [at];
      const list = at.map(numConst);
      if (!list.length || list.some((v) => !fin(v))) bad('an x goal needs "at": an x, or a list of them');
      if (list.length > LIMITS.targets) bad(`"at" lists more than ${LIMITS.targets} places`);
      if (list.some((v) => v < X[0] - 1e-9 || v > X[1] + 1e-9)) bad('the goal\'s x is outside the window');
      let snap = spec.tangent ? spec.tangent.snap : num(raw.snap);
      if (!(snap > 0) || snap > xr / 10 || snap < xr / LIMITS.steps) snap = niceStep(xr / 100);
      let tol = num(raw.tol ?? raw.tolerance);
      if (!(tol > 0)) tol = Math.max(snap / 2, xr * 0.02);
      if (tol > xr / 10) bad('the goal\'s tolerance is too loose');
      goal = { type, at: list, tol, snap };
    }

    if (!opts || opts.reach !== false) {
      if (goal.type === 'params' && searched(goal, spec).reduce((n, g) => n * g.length, 1) > LIMITS.search) bad('the sliders have too many settings to check this goal');
      if (!solve(goal, spec)) bad('the goal can\'t be reached with these sliders, steps and snap');
      const st = startValue(goal, spec);
      if (st && meets(goal, st, spec).correct) bad('the goal is already met before the learner starts');
    }
    return goal;
  }

  // what the learner's attempt would be if they changed nothing
  function startValue(goal, spec) {
    const m = model(spec);
    if (goal.type === 'params') return m.start();
    if (goal.type === 'point') { const pt = spec.points[goal.point]; return m.pointAt(pt, m.start(), { x: pt.x, y: pt.y }); }
    return null;
  }

  // Is the learner's attempt (value, as the widget gives it) right?
  //   params: { a: 2, b: -1 }    point: { x, y }    x: { x }
  // -> { correct, invalid?, miss?: [x, y] (a point the curve doesn't pass through) }
  function meets(goal, value, spec) {
    if (!isObj(value) || !isObj(goal)) return { correct: false, invalid: true };
    const m = model(spec);
    if (goal.type === 'params') {
      const P = {};
      for (const p of spec.params) {
        const v = value[p.name];
        if (typeof v !== 'number' || !fin(v)) return { correct: false, invalid: true };
        P[p.name] = v;
      }
      if (goal.values) {
        for (const k of Object.keys(goal.values)) {
          const p = spec.params.find((q) => q.name === k);
          if (!p || !near(P[k], goal.values[k], goal.vtol != null ? goal.vtol : p.step / 100)) return { correct: false }; // a slider's own steps
        }
      }
      if (goal.range) {
        for (const k of Object.keys(goal.range)) {
          const [lo, hi] = goal.range[k], eps = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi));
          if (!(P[k] >= lo - eps && P[k] <= hi + eps)) return { correct: false };
        }
      }
      if (goal.through) {
        for (const [x, y] of goal.through) if (!near(m.y(goal.plot, x, P), y, goal.tol)) return { correct: false, miss: [x, y] };
      }
      return { correct: true };
    }
    if (goal.type === 'point') {
      const { x, y } = value;
      if (typeof x !== 'number' || typeof y !== 'number' || !fin(x) || !fin(y)) return { correct: false, invalid: true };
      return { correct: goal.at.some(([tx, ty]) => near(x, tx, goal.tol[0]) && near(y, ty, goal.tol[1])) };
    }
    if (goal.type === 'x') {
      const { x } = value;
      if (typeof x !== 'number' || !fin(x)) return { correct: false, invalid: true };
      return { correct: goal.at.some((tx) => near(x, tx, goal.tol)) };
    }
    return { correct: false, invalid: true };
  }

  // The sliders a params goal's grid search tries, each with the positions worth trying: a slider with a
  // range, its steps in that range; one the "through" curve uses, all its steps (nearest the start first,
  // whole numbers before others). Sliders with a value, or that nothing asks about, stay put.
  function searched(goal, spec) {
    const uses = goal.through ? model(spec).uses(goal.plot) : new Set();
    return spec.params.filter((p) => !(goal.values && p.name in goal.values) && ((goal.range && p.name in goal.range) || uses.has(p.name)))
      .map((p) => {
        const r = goal.range && goal.range[p.name];
        const list = steps(p).filter((v) => !r || (v >= r[0] - 1e-9 && v <= r[1] + 1e-9));
        list.sort((a, b) => (Number.isInteger(a) ? 0 : 1) - (Number.isInteger(b) ? 0 : 1) || Math.abs(a - p.value) - Math.abs(b - p.value) || a - b);
        list.param = p;
        return list;
      });
  }

  // A right attempt the learner could make (for "show the answer", and to know a goal can be met), or null.
  function solve(goal, spec) {
    const m = model(spec);
    const X = spec.x, Y = spec.y;
    if (goal.type === 'params') {
      const P = m.start();
      if (goal.values) {
        for (const k of Object.keys(goal.values)) {
          const p = spec.params.find((q) => q.name === k);
          P[k] = onSteps(goal.values[k], p.min, p.step, p.max);
        }
      }
      const grids = searched(goal, spec), free = grids.map((g) => g.param);
      const total = grids.reduce((n, g) => n * g.length, 1);
      if (total > LIMITS.search) return null;
      const idx = free.map(() => 0);
      for (let n = 0; n < total; n++) {
        free.forEach((p, j) => { P[p.name] = grids[j][idx[j]]; });
        if (meets(goal, P, spec).correct) return Object.assign({}, P);
        for (let j = free.length - 1; j >= 0; j--) { if (++idx[j] < grids[j].length) break; idx[j] = 0; }
      }
      return null;
    }
    if (goal.type === 'point') {
      const pt = spec.points[goal.point];
      const [sx, sy] = pt.snap;
      // where an axis can be: on the point's snap in the window, or on its slider's steps
      const slider = (v) => (typeof v === 'string' ? spec.params.find((q) => q.name === v) : null);
      const qx = slider(pt.x), qy = pt.on == null ? slider(pt.y) : null;
      const put = (q, v, s, R) => (q ? onSteps(v, q.min, q.step, q.max) : onGrid(v, s, R[0], R[1]));
      for (const [tx, ty] of goal.at) {
        const gx = put(qx, tx, sx, X);
        for (const dx of [0, -1, 1, -2, 2]) {
          const P = m.start();
          const x = put(qx, gx + dx * sx, sx, X);
          if (qx) P[qx.name] = x;
          let y;
          if (pt.on != null) y = m.y(pt.on, x, P);
          else { y = put(qy, ty, sy, Y); if (qy) P[qy.name] = y; }
          const v = { x, y };
          if (meets(goal, v, spec).correct) return v;
        }
      }
      return null;
    }
    if (goal.type === 'x') {
      for (const tx of goal.at) {
        const v = { x: onGrid(tx, goal.snap, X[0], X[1]) };
        if (meets(goal, v, spec).correct) return v;
      }
      return null;
    }
    return null;
  }

  return {
    LIMITS, PALETTE, FUNCTIONS: Object.freeze(Object.keys(FUNCS)),
    ExprError, GraphError,
    parse, compile, evaluate,
    cleanSpec, cleanGoal, model, meets, solve,
    niceStep, decimals, fmt, onGrid, onSteps, paramDecimals
  };
});
