/* =====================================================================
   Numbers in lessons: the maths and the checks behind the number tools
   (assets/js/widgets/numbers.js), shared by the server (server/widgets/
   numbers.mjs checks every spec the AI writes, and that each task can be
   done) and the page (numbers.js loads it first: window.PrimerNumbers).

   Exact fractions throughout: { n, d }, whole numbers, d > 0, in lowest
   terms. Values are written as numbers or strings: 3, -2.5, "3/5",
   "1 1/2", "1,23,456"; a clean spec keeps them as "n/d" strings.

   Three modes (the spec, after cleanSpec):
     fraction  { mode, shapes: [{ shape: "bar"|"circle"|"grid", parts,
                 rows?, cols?, shaded: [part numbers], fixed?, label? }],
                 join?: "compare"|"add", labels?: true, readout?: false }
     line      { mode, from, to, step, labels: "all"|"ends"|"whole"|
                 "none"|k, format: "fraction"|"decimal"|"mixed",
                 marks?: [{ at, label }], start?, hops?: [sizes],
                 unit?, grouping?, readout?: false }
     blocks    { mode, places: 1..8, start: [count of ones, tens, ...],
                 edit, trade, grouping?: "indian"|"international",
                 words?: false }
   Goals (after cleanGoal):
     fraction  { type: "shade", value, shape, as? }   one shape shows it
               { type: "shade", values: [v | null, ...] }  each shape
               { type: "shade", value, sum: true, as? }    both together
               { type: "equal" }                           equal fractions
     line      { type: "place", at: [values] }             the marker there
               { type: "jumps", start, by, hop? }          jumps from start
     blocks    { type: "build", value, fewest? }           make the number
               { type: "build", value, counts: [...] }     with these blocks
   The learner's attempt ("value", plain JSON):
     fraction  { shaded: [[parts of shape 0], [parts of shape 1]] }
     line      { at: "3/5", hops: ["1", "-1/2", ...] }
     blocks    { counts: [ones, tens, ...] }

   Everything a spec says is checked strictly, and a reason is given for
   what fails (NumError), worded so the AI can fix it.
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerNumbers = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  class NumError extends Error { constructor(message) { super(message); this.name = 'NumError'; } }
  const fail = (m) => { throw new NumError(m); };
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k) && o[k] != null;
  const first = (...vs) => vs.find((v) => v != null);
  const quote = (v) => { try { return JSON.stringify(v).slice(0, 40); } catch (e) { return String(v).slice(0, 40); } };
  const range = (k) => Array.from({ length: k }, (_, i) => i);
  const MINUS = '−';

  /* ---------------- exact fractions ---------------- */

  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
  function Q(n, d) {
    if (d === undefined) d = 1;
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0) fail('a number there is too big to work with exactly');
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d) || 1;
    return Object.freeze({ n: n / g + 0, d: d / g });
  }
  const ZERO = Q(0), ONE = Q(1);
  const add = (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => Q(a.n * b.n, a.d * b.d);
  const div = (a, b) => (b.n === 0 ? fail('division by zero') : Q(a.n * b.d, a.d * b.n));
  const cmp = (a, b) => Math.sign(a.n * b.d - b.n * a.d);
  const eq = (a, b) => a.n === b.n && a.d === b.d;
  const isInt = (a) => a.d === 1;
  const toNum = (a) => a.n / a.d;
  const sum = (list) => list.reduce(add, ZERO);
  // the biggest fraction that both are whole numbers of (1/4 and 2/5: 1/20)
  const gcdQ = (a, b) => Q(gcd(a.n * b.d, b.n * a.d), a.d * b.d);
  // "n/d" or "n": how a clean spec and a saved attempt write it
  const key = (q) => (q.d === 1 ? String(q.n) : q.n + '/' + q.d);

  const VULGAR = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
  const tidy = (s) => s.trim()
    .replace(/[−‒–﹣－]/g, '-')
    .replace(/[⁄∕÷]/g, '/')
    .replace(/(\d)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (m, w, f) => (w ? w + ' ' : '') + VULGAR[f])
    .replace(/\s*\/\s*/g, '/');

  // A number as the AI or a course file writes it: { q, dec } (dec: written as a decimal), or null.
  function parse(v) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return null;
      if (Number.isInteger(v)) return Math.abs(v) <= 1e12 ? { q: Q(v), dec: false } : null;
      v = String(v);
      if (/e/i.test(v)) return null;
    }
    if (typeof v !== 'string' || v.length > 40) return null;
    let s = tidy(v).replace(/^\+/, '');
    let m = /^(-?)(\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)$/.exec(s); // 1,23,456 or 123,456
    if (m) s = m[1] + m[2].replace(/,/g, '');
    const big = (x) => x.length > 12;
    if ((m = /^(-?)(\d+)$/.exec(s))) return big(m[2]) ? null : { q: Q(Number(m[1] + m[2])), dec: false };
    if ((m = /^(-?)(\d*)\.(\d{1,6})$/.exec(s))) {
      if (big(m[2] || '0')) return null;
      const k = m[3].length;
      return { q: Q(Number(m[1] + (m[2] || '0') + m[3]), 10 ** k), dec: true };
    }
    if ((m = /^(-?)(\d+)\/(\d+)$/.exec(s))) {
      const n = Number(m[2]), d = Number(m[3]);
      return d === 0 || big(m[2]) || d > 1e6 ? null : { q: Q(m[1] ? -n : n, d), dec: false };
    }
    if ((m = /^(-?)(\d+)\s+(\d+)\/(\d+)$/.exec(s))) { // a mixed number: 1 1/2
      const w = Number(m[2]), n = Number(m[3]), d = Number(m[4]);
      if (d === 0 || n >= d || big(m[2]) || d > 1e6) return null;
      const q = Q(w * d + n, d);
      return { q: m[1] ? Q(-q.n, q.d) : q, dec: false };
    }
    return null;
  }
  const value = (v) => { const p = parse(v); return p ? p.q : null; };

  // "1/2 + 1/4", "3 - 5", or a single number: { q, terms: [q], signs: [1|-1] }, or null
  function parseSum(v) {
    if (typeof v === 'number') { const p = parse(v); return p && { q: p.q, terms: [Q(Math.abs(p.q.n), p.q.d)], signs: [p.q.n < 0 ? -1 : 1], dec: p.dec }; }
    if (typeof v !== 'string' || v.length > 80) return null;
    let s = tidy(v), sign0 = 1;
    if (/^[-+]/.test(s)) { sign0 = s[0] === '-' ? -1 : 1; s = s.slice(1).trim(); }
    const bits = s.split(/\s*([+-])\s*/);
    if (bits.length > 11) return null;
    const terms = [], signs = [];
    let dec = false;
    for (let i = 0; i < bits.length; i += 2) {
      const p = parse(bits[i]);
      if (!p || p.q.n < 0) return null;
      dec = dec || p.dec;
      terms.push(p.q);
      signs.push(i === 0 ? sign0 : bits[i - 1] === '-' ? -1 : 1);
    }
    return { q: sum(terms.map((t, i) => (signs[i] < 0 ? Q(-t.n, t.d) : t))), terms, signs, dec };
  }

  // An exact decimal ("-2.5"), or null when it doesn't end (1/3).
  function decimal(q) {
    let d = q.d, k2 = 0, k5 = 0;
    while (d % 2 === 0) { d /= 2; k2++; }
    while (d % 5 === 0) { d /= 5; k5++; }
    const k = Math.max(k2, k5);
    if (d !== 1 || k > 9) return null;
    const scaled = Math.abs(q.n) * (10 ** k / q.d);
    if (!Number.isSafeInteger(scaled)) return null;
    let s = String(scaled);
    if (k) { s = s.padStart(k + 1, '0'); s = s.slice(0, -k) + '.' + s.slice(-k); }
    return (q.n < 0 ? '-' : '') + s;
  }

  // The pieces of a number as it is shown: { sign, whole, num, den } (a fraction or a mixed
  // number) or { sign, text } (a whole number or a decimal), for drawing a stacked fraction.
  function pieces(q, format, grouping) {
    const sign = q.n < 0 ? MINUS : '';
    const a = Math.abs(q.n);
    if (q.d === 1) return { sign, text: grouping ? group(a, grouping) : String(a) };
    if (format === 'decimal') { const s = decimal(q); if (s) return { sign, text: s.replace(/^-/, '') }; }
    if (format === 'mixed' && a > q.d) return { sign, whole: String(Math.floor(a / q.d)), num: String(a % q.d), den: String(q.d) };
    return { sign, num: String(a), den: String(q.d) };
  }
  // The same as one line of text: "3/4", "−2 1/2", "0.25" (a typographic minus)
  function show(q, format, grouping) {
    const p = pieces(q, format, grouping);
    if (p.text != null) return p.sign + p.text;
    return p.sign + (p.whole ? p.whole + ' ' : '') + p.num + '/' + p.den;
  }
  // a sum as written: "1/2 + 1/4", "5 − 3"
  function showSum(terms, signs, format) {
    return terms.map((t, i) => (i === 0 ? (signs[0] < 0 ? MINUS : '') : signs[i] < 0 ? ' ' + MINUS + ' ' : ' + ') + show(t, format)).join('');
  }

  /* ---------------- big numbers: grouping and words ---------------- */

  // 1,23,456 (Indian: lakh, crore) or 123,456 (international)
  function group(n, system) {
    if (!Number.isSafeInteger(n)) return String(n);
    const s = String(Math.abs(n));
    let out = s;
    if (system === 'indian' && s.length > 3) {
      let rest = s.slice(0, -3);
      const bits = [];
      while (rest.length > 2) { bits.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
      if (rest) bits.unshift(rest);
      out = bits.join(',') + ',' + s.slice(-3);
    } else if (s.length > 3) out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? MINUS : '') + out;
  }

  const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const upTo99 = (n) => (n < 20 ? SMALL[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + SMALL[n % 10] : ''));
  const upTo999 = (n) => [n >= 100 ? SMALL[Math.floor(n / 100)] + ' hundred' : '', n % 100 ? upTo99(n % 100) : ''].filter(Boolean).join(' ');
  // A whole number in English words: "one lakh twenty-three thousand four hundred fifty-six"
  // (Indian) or "one hundred twenty-three thousand four hundred fifty-six" (international).
  function words(n, system) {
    if (!Number.isSafeInteger(n) || Math.abs(n) >= 1e15) return '';
    if (n < 0) return 'minus ' + words(-n, system);
    if (n === 0) return 'zero';
    const scales = system === 'indian' ? [[1e7, 'crore'], [1e5, 'lakh'], [1e3, 'thousand']] : [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
    const out = [];
    let rest = n;
    for (const [size, name] of scales) {
      if (rest >= size) {
        const k = Math.floor(rest / size);
        out.push((k >= 1000 || (system === 'indian' && k >= 100) ? words(k, system) : upTo999(k)) + ' ' + name);
        rest %= size;
      }
    }
    if (rest) out.push(upTo999(rest));
    return out.join(' ');
  }

  /* ---------------- fraction shapes ---------------- */

  const SHAPE_NAMES = { bar: 'bar', strip: 'bar', rectangle: 'grid', rect: 'grid', grid: 'grid', square: 'grid', array: 'grid', circle: 'circle', pie: 'circle', disc: 'circle', disk: 'circle', round: 'circle', pizza: 'circle' };
  const MAX_PARTS = { bar: 12, circle: 12, grid: 100 };
  const MAX_SIDE = 10;

  // rows and columns for a grid of this many parts, as near square as can be (10 by 10 at most)
  function gridSides(parts) {
    for (let r = Math.floor(Math.sqrt(parts)); r >= 1; r--) if (parts % r === 0 && parts / r <= MAX_SIDE) return [r, parts / r];
    return null;
  }
  const wholeIn = (v, lo, hi) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const text = (v, max) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

  function cleanShape(raw, where) {
    if (!isObj(raw)) fail(`${where} must be an object like {"shape": "bar", "parts": 4}`);
    const name = String(raw.shape || raw.kind || 'bar').toLowerCase().trim();
    const shape = SHAPE_NAMES[name];
    if (!shape) fail(`${where}: "shape" is "bar", "circle" or "grid", not ${quote(raw.shape)}`);
    let parts = typeof raw.parts === 'string' && /^\s*\d+\s*$/.test(raw.parts) ? Number(raw.parts) : raw.parts, rows = null, cols = null;
    if (shape === 'grid' && (raw.rows != null || raw.cols != null || raw.columns != null)) {
      rows = wholeIn(raw.rows, 1, MAX_SIDE);
      cols = wholeIn(first(raw.cols, raw.columns), 1, MAX_SIDE);
      if (raw.rows != null && rows == null) fail(`${where}: "rows" is a whole number from 1 to ${MAX_SIDE}`);
      if (first(raw.cols, raw.columns) != null && cols == null) fail(`${where}: "cols" is a whole number from 1 to ${MAX_SIDE}`);
      if (rows == null || cols == null) {
        const p = wholeIn(parts, 2, MAX_PARTS.grid);
        const one = rows || cols;
        if (p == null || p % one || p / one > MAX_SIDE) fail(`${where}: give a grid both "rows" and "cols" (each 1 to ${MAX_SIDE})`);
        if (rows == null) rows = p / one; else cols = p / one;
      }
      if (parts != null && parts !== rows * cols) fail(`${where}: ${rows} rows of ${cols} make ${rows * cols} parts, but "parts" is ${quote(parts)}; leave "parts" out or make it ${rows * cols}`);
      parts = rows * cols;
    }
    if (wholeIn(parts, 1, 1e9) == null) fail(`${where} needs "parts": how many equal parts it is cut into, a whole number from 2 to ${MAX_PARTS[shape]}`);
    if (parts < 2) fail(`${where} has ${parts} part; cut it into 2 or more`);
    if (parts > MAX_PARTS[shape]) {
      fail(shape === 'grid'
        ? `a grid has at most ${MAX_PARTS.grid} parts (10 rows of 10); it has ${parts}`
        : `a ${shape} has at most ${MAX_PARTS[shape]} parts (it has ${parts}); for more, use a "grid" with "rows" and "cols"`);
    }
    if (shape === 'grid' && rows == null) {
      const rc = gridSides(parts);
      if (!rc) fail(`${parts} parts can't be laid out as a grid of rows of 10 or fewer; give "rows" and "cols", or use a "bar" (up to 12 parts)`);
      [rows, cols] = rc;
    }
    const out = { shape, parts };
    if (shape === 'grid') { out.rows = rows; out.cols = cols; }
    out.shaded = shadedOf(first(raw.shaded, raw.shade, raw.start), parts, where);
    if (raw.fixed === true || raw.locked === true) out.fixed = true;
    const label = text(raw.label, 40);
    if (label) out.label = label;
    return out;
  }

  function shadedOf(raw, parts, where) {
    if (raw == null || raw === false) return [];
    if (Array.isArray(raw)) {
      const out = [...new Set(raw)];
      if (out.some((i) => !Number.isInteger(i) || i < 0 || i >= parts)) fail(`${where}: "shaded" is how many of its ${parts} parts start shaded, or a list of part numbers from 0 to ${parts - 1}`);
      return out.sort((a, b) => a - b);
    }
    let k = null;
    if (typeof raw === 'number' && Number.isInteger(raw)) k = raw;
    else {
      const q = value(raw);
      if (q) { const x = mul(q, Q(parts)); if (isInt(x)) k = x.n; }
    }
    if (k == null || k < 0 || k > parts) fail(`${where}: "shaded" is how many of its ${parts} parts start shaded (0 to ${parts}), not ${quote(raw)}`);
    return range(k);
  }

  function cleanFraction(spec) {
    const list = Array.isArray(spec.shapes) ? spec.shapes : [spec];
    if (!list.length || list.length > 2) fail('"shapes" holds one or two shapes');
    const shapes = list.map((s, i) => cleanShape(s, list.length > 1 ? `shapes[${i}]` : 'the shape'));
    const out = { mode: 'fraction', shapes };
    if (shapes.length === 2) out.join = /add|plus|sum|\+/i.test(String(spec.join || spec.sign || '')) ? 'add' : 'compare';
    if (spec.labels === true) out.labels = true;
    if (spec.readout === false) out.readout = false;
    return out;
  }

  const frOf = (shape, k) => Q(k, shape.parts);
  // the parts each shape has shaded in an attempt (fixed shapes keep the spec's), or null if it doesn't fit
  function shadingOf(spec, val) {
    const lists = isObj(val) && Array.isArray(val.shaded) ? val.shaded : null;
    if (!lists) return null;
    const out = [];
    for (let i = 0; i < spec.shapes.length; i++) {
      const s = spec.shapes[i];
      if (s.fixed) { out.push(s.shaded.slice()); continue; }
      const l = lists[i] == null ? [] : lists[i];
      if (!Array.isArray(l) || l.length > s.parts || l.some((p) => !Number.isInteger(p) || p < 0 || p >= s.parts) || new Set(l).size !== l.length) return null;
      out.push(l.slice().sort((a, b) => a - b));
    }
    return out;
  }
  const startShading = (spec) => spec.shapes.map((s) => s.shaded.slice());

  // how many parts of each size could show q: "4, 8 or 12"
  function partsFor(q, shape) {
    const opts = [];
    for (let m = q.d; m <= MAX_PARTS[shape] && opts.length < 3; m += q.d) if (m >= 2) opts.push(m);
    if (!opts.length) return shape !== 'grid' && q.d <= MAX_PARTS.grid && gridSides(q.d) ? `use a "grid" of ${q.d} parts` : 'use a fraction with a smaller denominator';
    return `cut it into ${opts.length > 1 ? opts.slice(0, -1).join(', ') + ' or ' + opts[opts.length - 1] : opts[0]} parts`;
  }
  const SHAPE_WORD = { bar: 'bar', circle: 'circle', grid: 'grid' };

  function cleanFractionGoal(goal, spec) {
    const n = spec.shapes.length;
    const name = (i) => (n > 1 ? `shapes[${i}]` : 'the shape');
    const type = String(goal.type || (goal.equal || goal.equivalent ? 'equal' : 'shade')).toLowerCase();
    const mustChange = (i) => { if (spec.shapes[i].fixed) fail(`${name(i)} is "fixed", so the learner can't shade it; leave "fixed" off the shape the task is done on`); };
    const fits = (i, q, what) => {
      const s = spec.shapes[i];
      if (q.n <= 0) fail(`the fraction to shade must be more than 0 (it is ${show(q)})`);
      if (cmp(q, ONE) > 0) fail(`a shape holds at most 1 whole, and ${what} is more; use two shapes with "sum": true, or a smaller fraction`);
      const k = mul(q, Q(s.parts));
      if (!isInt(k)) fail(`the ${SHAPE_WORD[s.shape]} is cut into ${s.parts} equal parts, so ${what} can't be shaded on it (it would be ${show(k, 'decimal')} parts); ${partsFor(q, s.shape)}`);
      return k.n;
    };
    let out;
    if (type === 'equal' || type === 'equivalent') {
      if (n !== 2) fail('an "equal" goal needs two shapes: the learner shades both to show equal fractions');
      const [a, b] = spec.shapes;
      if (a.fixed && b.fixed) fail('both shapes are "fixed", so the learner can\'t shade either');
      const ks = (s) => (s.fixed ? [s.shaded.length] : range(s.parts - 1).map((i) => i + 1));
      const ok = ks(a).some((k1) => k1 > 0 && k1 < a.parts && ks(b).some((k2) => k2 > 0 && k2 < b.parts && k1 * b.parts === k2 * a.parts));
      if (!ok) {
        const f = a.fixed ? a : b.fixed ? b : null;
        if (f) {
          const q = frOf(f, f.shaded.length), other = f === a ? b : a;
          fail(`${name(f === a ? 0 : 1)} is fixed at ${show(q)}, which a ${SHAPE_WORD[other.shape]} of ${other.parts} parts can't show (other than none or all of it); ${partsFor(q, other.shape)}`);
        }
        fail(`${a.parts} parts and ${b.parts} parts can't show equal fractions (other than none or all); use parts that share a factor, like 2 and 4, or 3 and 6`);
      }
      out = { type: 'equal' };
    } else if (type === 'shade') {
      const vals = Array.isArray(goal.values) ? goal.values : null;
      if (vals) {
        if (vals.length !== n) fail(`"values" has one fraction for each shape (${n}), or null for a shape that can be anything`);
        const list = vals.map((v, i) => {
          if (v == null) return null;
          const p = parseSum(v);
          if (!p) fail(`"values"[${i}] (${quote(v)}) is not a fraction; write it like "3/4"`);
          mustChange(i);
          fits(i, p.q, show(p.q));
          return key(p.q);
        });
        if (list.every((v) => v == null)) fail('"values" needs at least one fraction');
        out = { type: 'shade', values: list };
      } else {
        const raw = first(goal.value, goal.fraction, goal.target);
        const p = parseSum(raw);
        if (!p) fail(`a "shade" goal needs "value": the fraction to shade, like "3/4" or "1/2 + 1/4" (not ${quote(raw)})`);
        let as = p.terms.length > 1 ? showSum(p.terms, p.signs) : '';
        if (!as && typeof goal.as === 'string') { // a clean goal keeps the sum it was written as
          const a = parseSum(goal.as);
          if (a && a.terms.length > 1 && eq(a.q, p.q)) as = showSum(a.terms, a.signs);
        }
        const what = as ? `${as} = ${show(p.q)}` : show(p.q);
        if (goal.sum === true || goal.total === true || goal.shape === 'all' || goal.shape === 'both') {
          if (n !== 2) fail('"sum": true needs two shapes (their shaded parts are added together)');
          if (p.q.n <= 0) fail(`the fraction to shade must be more than 0 (it is ${show(p.q)})`);
          const [a, b] = spec.shapes;
          const ks = (s) => (s.fixed ? [s.shaded.length] : range(s.parts + 1));
          const ok = ks(a).some((k1) => ks(b).some((k2) => eq(add(frOf(a, k1), frOf(b, k2)), p.q)));
          if (!ok) fail(`a ${SHAPE_WORD[a.shape]} of ${a.parts} parts and a ${SHAPE_WORD[b.shape]} of ${b.parts} parts can't make ${what} together; cut both into ${p.q.d} parts, or a multiple`);
          out = { type: 'shade', value: key(p.q), sum: true };
        } else {
          const i = goal.shape == null ? 0 : wholeIn(goal.shape, 0, n - 1);
          if (i == null) fail(`"shape" is the number of the shape to shade: 0${n > 1 ? ' or 1' : ''}`);
          mustChange(i);
          fits(i, p.q, what);
          out = { type: 'shade', value: key(p.q), shape: i };
        }
        if (as) out.as = as;
      }
    } else fail(`a fraction goal's "type" is "shade" or "equal", not ${quote(goal.type)}`);
    if (fractionMeets(spec, out, startShading(spec)).correct) fail('the shapes already show the answer as they start; start with fewer parts shaded (or none)');
    return out;
  }

  // does this shading meet the goal? { correct, empty?, why }
  function fractionMeets(spec, goal, shading) {
    const fr = shading.map((l, i) => frOf(spec.shapes[i], l.length));
    const info = (i) => ({ shape: i, k: shading[i].length, n: spec.shapes[i].parts, got: key(fr[i]) });
    const empty = spec.shapes.every((s, i) => s.fixed || !shading[i].length);
    if (goal.type === 'equal') {
      const edge = fr.findIndex((f) => f.n === 0 || eq(f, ONE));
      if (edge >= 0) return { correct: false, empty, why: { code: 'equal-edge', ...info(edge) } };
      return eq(fr[0], fr[1]) ? { correct: true } : { correct: false, why: { code: 'equal', a: info(0), b: info(1) } };
    }
    if (goal.sum) {
      const got = sum(fr);
      return eq(got, value(goal.value)) ? { correct: true } : { correct: false, empty, why: { code: 'sum', a: info(0), b: info(1), got: key(got), want: goal.value, as: goal.as || '' } };
    }
    if (goal.values) {
      const bad = goal.values.findIndex((v, i) => v != null && !eq(fr[i], value(v)));
      return bad < 0 ? { correct: true } : { correct: false, empty, why: { code: 'shade', ...info(bad), want: goal.values[bad], as: '', many: true } };
    }
    const i = goal.shape || 0;
    return eq(fr[i], value(goal.value)) ? { correct: true } : { correct: false, empty: !shading[i].length, why: { code: 'shade', ...info(i), want: goal.value, as: goal.as || '' } };
  }

  // a shading that meets the goal (for "show me" and the answer in words)
  function fractionSolution(spec, goal) {
    const sh = startShading(spec);
    const fill = (i, k) => { sh[i] = range(k); };
    if (goal.type === 'equal') {
      const [a, b] = spec.shapes;
      const ks = (s) => (s.fixed ? [s.shaded.length] : range(s.parts - 1).map((i) => i + 1));
      for (const k1 of ks(a)) for (const k2 of ks(b)) {
        if (k1 > 0 && k1 < a.parts && k2 > 0 && k2 < b.parts && k1 * b.parts === k2 * a.parts) {
          if (!a.fixed) fill(0, k1);
          if (!b.fixed) fill(1, k2);
          return sh;
        }
      }
      return null;
    }
    if (goal.sum) {
      const [a, b] = spec.shapes, want = value(goal.value);
      const ks = (s) => (s.fixed ? [s.shaded.length] : range(s.parts + 1).reverse());
      for (const k1 of ks(a)) for (const k2 of ks(b)) {
        if (eq(add(frOf(a, k1), frOf(b, k2)), want)) { if (!a.fixed) fill(0, k1); if (!b.fixed) fill(1, k2); return sh; }
      }
      return null;
    }
    const want = goal.values || spec.shapes.map((_, i) => (i === (goal.shape || 0) ? goal.value : null));
    want.forEach((v, i) => { if (v != null) fill(i, mul(value(v), Q(spec.shapes[i].parts)).n); });
    return sh;
  }

  /* ---------------- the number line ---------------- */

  const LINE_LABELS = ['all', 'ends', 'whole', 'none'];
  const MAX_TICKS = 40;
  const FORMATS = { fraction: 'fraction', fractions: 'fraction', decimal: 'decimal', decimals: 'decimal', mixed: 'mixed' };
  const groupingOf = (v) => {
    const s = String(v || '').toLowerCase();
    if (/indian|india|lakh|lac|crore|^in$/.test(s)) return 'indian';
    if (/international|intl|western|million|^en$|us|uk/.test(s)) return 'international';
    return '';
  };

  const ticksOf = (spec) => { const a = value(spec.from), st = value(spec.step), n = div(sub(value(spec.to), a), st).n; return range(n + 1).map((k) => add(a, mul(st, Q(k)))); };
  // the tick a value is on (0, 1, 2...), or -1
  function tickOf(spec, q) {
    const a = value(spec.from), b = value(spec.to), st = value(spec.step);
    if (!q || cmp(q, a) < 0 || cmp(q, b) > 0) return -1;
    const k = div(sub(q, a), st);
    return isInt(k) ? k.n : -1;
  }
  const lineWhere = (spec) => `the line runs from ${show(value(spec.from), spec.format)} to ${show(value(spec.to), spec.format)} in steps of ${show(value(spec.step), spec.format)}`;
  // why a value is not on a tick, and what to change
  function offTick(spec, q, what) {
    const a = value(spec.from), b = value(spec.to);
    if (cmp(q, a) < 0 || cmp(q, b) > 0) return `${what} is outside the line, which runs from ${show(a, spec.format)} to ${show(b, spec.format)}; make "from" or "to" reach it`;
    const g = gcdQ(sub(b, a), sub(q, a));
    const steps = [g, div(g, Q(2))].filter((s) => div(sub(b, a), s).n <= MAX_TICKS);
    const fix = steps.length ? `use steps of ${steps.map((s) => show(s, spec.format)).join(' or ')}` : 'use a shorter line with smaller steps';
    return `${lineWhere(spec)}, so ${what} is not on any tick; ${fix}`;
  }

  function cleanLine(spec) {
    const rangeOf = Array.isArray(spec.range) ? spec.range : [];
    const read = (v, what) => { const p = parse(v); if (!p) fail(`${what} (${quote(v)}) is not a number; write it like 3, -2.5 or "3/5"`); return p; };
    const A = read(first(spec.from, spec.min, rangeOf[0]), '"from"');
    const B = read(first(spec.to, spec.max, rangeOf[1]), '"to"');
    const a = A.q, b = B.q;
    if (cmp(a, b) >= 0) fail(`"from" (${show(a)}) must be less than "to" (${show(b)})`);
    let S;
    const rawStep = first(spec.step, spec.ticks, spec.interval);
    if (rawStep == null) {
      if (isInt(a) && isInt(b) && b.n - a.n <= 20) S = { q: ONE, dec: false };
      else fail('"step" is missing: the gap between ticks, like 1, "1/4" or 0.1');
    } else S = read(rawStep, '"step"');
    const step = S.q;
    if (step.n <= 0) fail(`"step" must be more than 0 (it is ${show(step)})`);
    const count = div(sub(b, a), step);
    if (!isInt(count)) fail(`from ${show(a)} to ${show(b)} in steps of ${show(step)} doesn't end on a tick ((to − from) ÷ step is ${show(count, 'decimal')}); choose a step that fits a whole number of times, or move "to"`);
    if (count.n < 2) fail(`from ${show(a)} to ${show(b)} in steps of ${show(step)} is only ${count.n} step; use a smaller step`);
    if (count.n > MAX_TICKS) fail(`from ${show(a)} to ${show(b)} in steps of ${show(step)} makes ${count.n} steps; at most ${MAX_TICKS} fit on a phone: use a bigger step or a shorter line`);
    const format = FORMATS[String(spec.format || '').toLowerCase()] || (A.dec || B.dec || S.dec ? 'decimal' : 'fraction');
    if (format === 'decimal' && (decimal(a) == null || decimal(step) == null)) fail(`${show(decimal(step) == null ? step : a)} can't be written as a decimal that ends; use "format": "fraction"`);
    const out = { mode: 'line', from: key(a), to: key(b), step: key(step), labels: 'all', format };
    // which ticks are labelled
    let labels = spec.labels;
    if (typeof labels === 'string') labels = labels.toLowerCase().trim();
    if (labels === 'integers' || labels === 'wholes' || labels === 'whole numbers') labels = 'whole';
    if (labels === true || labels === 'every') labels = 'all';
    if (labels === false) labels = 'none';
    if (labels === 1) labels = 'all';
    if (LINE_LABELS.includes(labels)) out.labels = labels;
    else if (Number.isInteger(labels) && labels >= 2 && labels <= count.n) out.labels = labels;
    else if (labels != null) fail(`"labels" is "all", "ends", "whole", "none" or a number k (every k-th tick), not ${quote(spec.labels)}`);
    else {
      const wholes = ticksOf(out).filter(isInt).length;
      // every tick if they fit; else the whole numbers; else every 2nd, 5th or 10th (friendly counts)
      out.labels = count.n <= 12 ? 'all' : wholes >= 2 && wholes <= 12 ? 'whole' : [2, 5, 10, 20].find((k) => count.n / k <= 10) || Math.ceil(count.n / 10);
    }
    if (Array.isArray(spec.marks) || Array.isArray(spec.points)) {
      const raw = (spec.marks || spec.points).slice(0, 7);
      if (raw.length > 6) fail('"marks" has at most 6 points');
      out.marks = raw.map((m, i) => {
        const at = parse(isObj(m) ? first(m.at, m.value, m.x) : m);
        if (!at) fail(`"marks"[${i}] needs "at": a number on the line`);
        if (cmp(at.q, a) < 0 || cmp(at.q, b) > 0) fail(`"marks"[${i}] (${show(at.q)}) is outside the line, which runs from ${show(a)} to ${show(b)}`);
        const label = isObj(m) ? text(m.label, 14) : '';
        return label ? { at: key(at.q), label } : { at: key(at.q) };
      });
      if (!out.marks.length) delete out.marks;
    }
    if (spec.start != null) {
      const s = parse(spec.start);
      if (!s) fail(`"start" (${quote(spec.start)}) is not a number`);
      if (tickOf(out, s.q) < 0) fail(`"start" (${show(s.q)}) must be on a tick: ${lineWhere(out)}`);
      out.start = key(s.q);
    }
    const hops = first(spec.hops, spec.jumps);
    if (hops != null) {
      const list = (Array.isArray(hops) ? hops : [hops]).map((h) => parse(isObj(h) ? h.size : h));
      if (!list.length || list.length > 3) fail('"hops" lists 1 to 3 jump sizes, like [1] or [1, 2]');
      const seen = new Set();
      out.hops = list.map((h, i) => {
        if (!h || h.q.n <= 0) fail(`"hops"[${i}] must be a jump size more than 0, like 1 or "1/4"`);
        const k = div(h.q, step);
        if (!isInt(k)) fail(`a jump of ${show(h.q, format)} doesn't land on the ticks (steps of ${show(step, format)}); use jumps that are a whole number of steps`);
        if (cmp(h.q, sub(b, a)) >= 0) fail(`a jump of ${show(h.q, format)} is as long as the whole line; use smaller jumps`);
        if (seen.has(key(h.q))) fail('"hops" has the same size twice');
        seen.add(key(h.q));
        return key(h.q);
      }).sort((x, y) => cmp(value(x), value(y)));
    }
    const unit = text(spec.unit, 8);
    if (unit) out.unit = unit;
    const grouping = groupingOf(spec.grouping);
    if (grouping) out.grouping = grouping;
    if (spec.readout === false) out.readout = false;
    return out;
  }

  function cleanLineGoal(goal, spec) {
    const type = String(goal.type || (has(goal, 'sum') || has(goal, 'by') ? 'jumps' : 'place')).toLowerCase();
    const fmt = (q) => show(q, spec.format);
    if (type === 'place' || type === 'point' || type === 'mark') {
      let raw = first(goal.value, goal.values, goal.at);
      if (!Array.isArray(raw)) raw = [raw];
      if (!raw.length || raw.length > 4) fail('a "place" goal needs "value": the number where the marker goes');
      const at = raw.map((v, i) => {
        const p = parseSum(v);
        if (!p) fail(`a "place" goal needs "value": the number where the marker goes, like "3/5" or -2.5 (not ${quote(v)})`);
        if (tickOf(spec, p.q) < 0) fail(offTick(spec, p.q, fmt(p.q)));
        return key(p.q);
      });
      if (spec.start != null && at.includes(spec.start)) fail(`the marker starts at ${fmt(value(spec.start))}, which is already the answer; move "start" or leave it out`);
      return { type: 'place', at: [...new Set(at)] };
    }
    if (type !== 'jumps' && type !== 'jump' && type !== 'hops') fail(`a number line goal's "type" is "place" or "jumps", not ${quote(goal.type)}`);
    if (!spec.hops) fail('a "jumps" task needs "hops" in the spec: the jump sizes the learner may use, like [1] or [1, 2]');
    let start, by;
    if (goal.sum != null) {
      const p = parseSum(goal.sum);
      if (!p || p.terms.length !== 2) fail(`"sum" is two numbers joined by + or −, like "3 + 4" or "5 - 3" (not ${quote(goal.sum)})`);
      start = p.signs[0] < 0 ? Q(-p.terms[0].n, p.terms[0].d) : p.terms[0];
      by = p.signs[1] < 0 ? Q(-p.terms[1].n, p.terms[1].d) : p.terms[1];
    } else {
      start = value(first(goal.start, goal.from));
      if (!start) fail('a "jumps" goal needs "sum", like "3 + 4" (start at 3, jump 4 to the right)');
      by = value(goal.by);
      const end = value(first(goal.end, goal.to));
      if (!by && end) by = sub(end, start);
      if (!by) fail('a "jumps" goal needs "sum", like "3 + 4" (start at 3, jump 4 to the right)');
    }
    if (by.n === 0) fail('the jumps must go somewhere: "sum" adds or takes away more than 0');
    const end = add(start, by);
    if (tickOf(spec, start) < 0) fail(offTick(spec, start, `the start (${fmt(start)})`));
    if (tickOf(spec, end) < 0) fail(offTick(spec, end, `the end, ${fmt(start)} ${by.n < 0 ? MINUS : '+'} ${fmt(Q(Math.abs(by.n), by.d))} = ${fmt(end)},`));
    const size = Q(Math.abs(by.n), by.d), step = value(spec.step);
    const out = { type: 'jumps', start: key(start), by: key(by) };
    if (goal.hop != null) {
      const h = value(goal.hop);
      if (!h || !spec.hops.includes(key(h))) fail(`"hop" must be one of the spec's "hops" (${spec.hops.map((x) => fmt(value(x))).join(', ')})`);
      if (!isInt(div(size, h))) fail(`jumps of ${fmt(h)} can't add up to ${fmt(size)}; use a hop that fits a whole number of times`);
      out.hop = key(h);
    } else if (!fewestHops(spec.hops.map(value), size, step)) {
      fail(`jumps of ${spec.hops.map((x) => fmt(value(x))).join(' and ')} can't add up to exactly ${fmt(size)}; add a hop size that fits`);
    }
    return out;
  }

  // the fewest jumps (each one of the sizes) that add up to total, biggest first; null if none do
  function fewestHops(sizes, total, step) {
    const n = div(total, step);
    if (!isInt(n) || n.n > 400) return null;
    const units = sizes.map((s) => div(s, step).n);
    const best = new Array(n.n + 1).fill(null);
    best[0] = [];
    for (let i = 1; i <= n.n; i++) {
      for (const u of units) if (u <= i && best[i - u] && (!best[i] || best[i - u].length + 1 < best[i].length)) best[i] = best[i - u].concat(u);
    }
    return best[n.n] ? best[n.n].sort((x, y) => y - x).map((u) => mul(Q(u), step)) : null;
  }

  // an attempt, checked against the line: { at (a tick, or null), hops: [q], end } or null if it doesn't fit
  function lineState(spec, val) {
    if (!isObj(val)) return null;
    const at = val.at == null ? null : value(String(val.at));
    if (val.at != null && (!at || tickOf(spec, at) < 0)) return null;
    const sizes = spec.hops ? spec.hops : [];
    const raw = val.hops == null ? [] : val.hops;
    if (!Array.isArray(raw) || raw.length > 80) return null;
    const hops = [];
    let pos = at;
    for (const h of raw) {
      const q = value(String(h));
      if (!q || !pos || !sizes.includes(key(Q(Math.abs(q.n), q.d)))) return null;
      pos = add(pos, q);
      if (tickOf(spec, pos) < 0) return null;
      hops.push(q);
    }
    return { at, hops, end: pos };
  }

  function lineMeets(spec, goal, st) {
    if (goal.type === 'place') {
      if (!st.end) return { correct: false, empty: true, why: { code: 'unplaced' } };
      if (goal.at.some((v) => eq(value(v), st.end))) return { correct: true };
      const why = { code: 'place', got: key(st.end) };
      if (goal.at.length === 1) why.dir = cmp(st.end, value(goal.at[0]));
      return { correct: false, why };
    }
    if (!st.hops.length) return { correct: false, empty: true, why: { code: 'no-hops' } };
    const start = value(goal.start), by = value(goal.by), total = sum(st.hops);
    if (!eq(st.at, start)) return { correct: false, why: { code: 'start', at: key(st.at), start: goal.start, by: goal.by } };
    if (st.hops.some((h) => Math.sign(h.n) !== Math.sign(by.n))) return { correct: false, why: { code: 'direction', by: goal.by, start: goal.start } };
    if (goal.hop && st.hops.some((h) => !eq(Q(Math.abs(h.n), h.d), value(goal.hop)))) return { correct: false, why: { code: 'hop', hop: goal.hop } };
    if (!eq(total, by)) return { correct: false, why: { code: 'total', total: key(total), end: key(st.end), by: goal.by, start: goal.start } };
    return { correct: true };
  }

  function lineSolution(spec, goal) {
    if (goal.type === 'place') return { at: goal.at[0], hops: [] };
    const by = value(goal.by), size = Q(Math.abs(by.n), by.d), sgn = by.n < 0 ? -1 : 1;
    const hops = goal.hop ? range(div(size, value(goal.hop)).n).map(() => value(goal.hop)) : fewestHops(spec.hops.map(value), size, value(spec.step));
    return hops ? { at: goal.start, hops: hops.map((h) => key(Q(sgn * h.n, h.d))) } : null;
  }

  /* ---------------- place-value blocks ---------------- */

  const CAP = 30;            // blocks of one kind at most (52 as 4 tens and 12 ones needs more than 9)
  const MAX_PLACES = 8;      // ones up to crores (or ten millions)
  const PLACE_KEYS = { one: 0, unit: 0, ten: 1, hundred: 2, thousand: 3, ten_thousand: 4, lakh: 5, lac: 5, hundred_thousand: 5, ten_lakh: 6, million: 6, crore: 7, ten_million: 7 };
  const PLACE_NAMES = {
    indian: ['ones', 'tens', 'hundreds', 'thousands', 'ten_thousands', 'lakhs', 'ten_lakhs', 'crores'],
    international: ['ones', 'tens', 'hundreds', 'thousands', 'ten_thousands', 'hundred_thousands', 'millions', 'ten_millions']
  };
  const placeOf = (k) => {
    const s = String(k).toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/s$/, '');
    return Object.prototype.hasOwnProperty.call(PLACE_KEYS, s) ? PLACE_KEYS[s] : -1;
  };
  const totalOf = (counts) => counts.reduce((t, c, i) => t + c * 10 ** i, 0);
  const digitsOf = (n, places) => range(places).map((i) => Math.floor(n / 10 ** i) % 10);
  const needPlaces = (n) => Math.max(1, String(n).length);
  const canonical = (counts) => counts.every((c) => c <= 9);
  const placeName = (i, sys) => PLACE_NAMES[sys === 'indian' ? 'indian' : 'international'][i].replace(/_/g, ' ');

  // a whole number written as a number or with commas ("1,23,456"), or null
  function wholeNumber(v) {
    const q = value(v);
    return q && isInt(q) && q.n >= 0 && q.n < 10 ** MAX_PLACES ? q.n : null;
  }
  // { tens: 4, ones: 12 } -> [12, 4] (a list is already ones first, as a clean spec keeps it), or a message saying what's wrong
  function countsOf(raw, what) {
    if (Array.isArray(raw)) {
      if (raw.length > MAX_PLACES || raw.some((v) => !Number.isInteger(v) || v < 0 || v > CAP)) fail(`${what} as a list is counts of blocks, ones first, each 0 to ${CAP}; better, write {"tens": 4, "ones": 12}`);
      return raw.slice();
    }
    const out = [];
    for (const [k, v] of Object.entries(raw)) {
      const i = placeOf(k);
      if (i < 0) fail(`${what}: "${String(k).slice(0, 20)}" is not a place; use ones, tens, hundreds, thousands, ten_thousands, lakhs, ten_lakhs, crores`);
      if (!Number.isInteger(v) || v < 0 || v > CAP) fail(`${what}: ${String(k).slice(0, 20)} is a count of blocks from 0 to ${CAP}, not ${quote(v)}`);
      while (out.length <= i) out.push(0);
      out[i] += v;
    }
    return out;
  }

  function cleanBlocks(spec, hint) {
    const grouping = groupingOf(first(spec.grouping, spec.system, spec.numbering));
    let start = [];
    const rawStart = first(spec.start, spec.value, spec.number);
    if (isObj(rawStart) || Array.isArray(rawStart)) start = countsOf(rawStart, '"start"');
    else if (rawStart != null) {
      const n = wholeNumber(rawStart);
      if (n == null) fail(`"start" is a whole number from 0 (like 52 or "1,23,456") or counts like {"tens": 5, "ones": 2}, not ${quote(rawStart)}`);
      start = digitsOf(n, needPlaces(n));
    }
    while (start.length && !start[start.length - 1]) start.pop();
    let places = spec.places;
    if (Array.isArray(places)) places = Math.max(...places.map(placeOf)) + 1;
    else if (typeof places === 'string') places = placeOf(places) + 1 || Number(places);
    if (places == null || places === 0) places = Math.max(4, start.length, hint || 0);
    if (!Number.isInteger(places) || places < 1 || places > MAX_PLACES) fail(`"places" is how many columns there are, 1 to ${MAX_PLACES} (4 is ones to thousands, 6 to lakhs), not ${quote(spec.places)}`);
    if (start.length > places) fail(`"start" (${group(totalOf(start), grouping || 'international')}) needs ${start.length} places, but "places" is ${places}`);
    while (start.length < places) start.push(0);
    const out = { mode: 'blocks', places, start, edit: spec.edit !== false, trade: spec.trade !== false };
    if (!out.edit && !out.trade) fail('"edit" and "trade" are both false, so there is nothing to do; allow one');
    if (grouping) out.grouping = grouping;
    if (spec.words === false) out.words = false;
    return out;
  }

  function cleanBlocksGoal(goal, spec) {
    const type = String(goal.type || 'build').toLowerCase();
    if (type !== 'build' && type !== 'make' && type !== 'show') fail(`a blocks goal's "type" is "build", not ${quote(goal.type)}`);
    const sys = spec.grouping || 'international';
    const out = { type: 'build' };
    const raw = first(goal.value, goal.number, goal.target);
    let want = raw == null ? null : wholeNumber(raw);
    if (raw != null && want == null) fail(`"value" is the whole number to build, like 3452 or "1,23,456", not ${quote(raw)}`);
    if (isObj(goal.counts) || Array.isArray(goal.counts)) {
      const c = countsOf(goal.counts, '"counts"');
      if (c.length > spec.places) fail(`"counts" uses the ${placeName(c.length - 1, sys)} place, but the spec has only ${spec.places} places`);
      while (c.length < spec.places) c.push(0);
      const t = totalOf(c);
      if (want != null && want !== t) fail(`"counts" make ${group(t, sys)}, not ${group(want, sys)}`);
      want = t;
      out.counts = c;
    } else if (goal.counts != null) fail('"counts" are blocks of each place, like {"tens": 4, "ones": 12}');
    if (want == null) fail('a "build" goal needs "value": the number to build, like 3452 (or "counts", like {"tens": 4, "ones": 12})');
    if (want <= 0) fail('the number to build must be more than 0');
    if (!out.counts && needPlaces(want) > spec.places) fail(`${group(want, sys)} needs ${needPlaces(want)} places, but the spec has ${spec.places}; make "places" ${needPlaces(want)}`);
    out.value = want;
    if (goal.fewest === true || goal.least === true) {
      if (out.counts && !canonical(out.counts)) fail('"fewest" and "counts" don\'t go together: those counts are not the fewest blocks');
      if (!out.counts) out.fewest = true;
    }
    const st = totalOf(spec.start);
    if (!spec.edit && st !== want) fail(`with "edit": false the learner can only bundle and break, so the number stays ${group(st, sys)}; the goal needs ${group(want, sys)}: set "start" to ${group(want, sys)} or allow "edit"`);
    if (blocksMeets(spec, out, spec.start).correct) fail('the blocks already show the answer as they start; start with something else (often 0)');
    return out;
  }

  function blocksState(spec, val) {
    const c = isObj(val) && Array.isArray(val.counts) ? val.counts : null;
    if (!c || c.length !== spec.places || c.some((x) => !Number.isInteger(x) || x < 0 || x > CAP)) return null;
    return c.slice();
  }

  function blocksMeets(spec, goal, counts) {
    const got = totalOf(counts);
    if (!counts.some(Boolean)) return { correct: false, empty: true, why: { code: 'empty' } };
    if (goal.counts) {
      if (goal.counts.every((c, i) => c === counts[i])) return { correct: true };
      return { correct: false, why: { code: got === goal.value ? 'counts-same' : 'counts', counts: counts.slice(), got, want: goal.value, wantCounts: goal.counts } };
    }
    if (got !== goal.value) return { correct: false, why: { code: 'value', counts: counts.slice(), got, want: goal.value } };
    if (goal.fewest && !canonical(counts)) return { correct: false, why: { code: 'fewest', counts: counts.slice(), got } };
    return { correct: true };
  }

  const blocksSolution = (spec, goal) => (goal.counts ? goal.counts.slice() : digitsOf(goal.value, spec.places));

  /* ---------------- the modes together ---------------- */

  const MODES = { fraction: 'fraction', fractions: 'fraction', shade: 'fraction', shapes: 'fraction', line: 'line', number_line: 'line', numberline: 'line', blocks: 'blocks', place_value: 'blocks', placevalue: 'blocks', base10: 'blocks', base_10: 'blocks', place: 'blocks' };
  function modeOf(spec) {
    const m = MODES[String(spec.mode || '').toLowerCase().trim().replace(/[\s-]+/g, '_')];
    if (m) return m;
    if (spec.mode != null) fail(`"mode" is "fraction", "line" or "blocks", not ${quote(spec.mode)}`);
    if (Array.isArray(spec.shapes) || spec.shape != null || spec.parts != null) return 'fraction';
    if (spec.from != null || spec.to != null || spec.step != null || Array.isArray(spec.range)) return 'line';
    if (spec.places != null) return 'blocks';
    fail('"mode" is missing: "fraction" (shapes to shade), "line" (a number line) or "blocks" (place value)');
  }

  // A spec, checked and made plain; throws NumError with what to fix. hint: places a blocks goal needs.
  function cleanSpec(spec, hint) {
    if (!isObj(spec)) fail('the spec must be an object');
    const mode = modeOf(spec);
    if (mode === 'fraction') return cleanFraction(spec);
    if (mode === 'line') return cleanLine(spec);
    return cleanBlocks(spec, hint);
  }

  // A block's spec: a block must have something to try.
  function cleanBlock(spec) {
    const s = cleanSpec(spec);
    if (s.mode === 'fraction' && s.shapes.every((x) => x.fixed)) fail('every shape is "fixed", so there is nothing to try; leave "fixed" off at least one shape');
    return s;
  }

  // A task's spec and goal, checked: the goal must be reachable and not met as it starts.
  function cleanTask(spec, goal) {
    if (!isObj(goal)) fail('the goal must be an object, like {"type": "shade", "value": "3/4"}');
    let hint = 0;
    if (isObj(spec) && spec.places == null) {
      const v = wholeNumber(first(goal.value, goal.number));
      if (v != null) hint = needPlaces(v);
      if (isObj(goal.counts) || Array.isArray(goal.counts)) { try { hint = Math.max(hint, countsOf(goal.counts, '"counts"').length); } catch (e) { /* reported below */ } }
    }
    const s = cleanSpec(spec, hint);
    // a line's labels follow how the task writes its numbers ("3/5" or 0.6), unless the spec says which
    if (s.mode === 'line' && !FORMATS[String(spec.format || '').toLowerCase()]) {
      const said = [goal.value, goal.values, goal.at, goal.sum].flat().filter((v) => v != null);
      const frac = said.some((v) => typeof v === 'string' && /\d\s*[/⁄]\s*\d/.test(v));
      const dec = said.some((v) => (typeof v === 'number' && !Number.isInteger(v)) || (typeof v === 'string' && /\d?\.\d/.test(v)));
      if (frac && !dec) s.format = 'fraction';
      else if (dec && !frac && decimal(value(s.from)) != null && decimal(value(s.step)) != null) s.format = 'decimal';
    }
    const g = s.mode === 'fraction' ? cleanFractionGoal(goal, s) : s.mode === 'line' ? cleanLineGoal(goal, s) : cleanBlocksGoal(goal, s);
    if (!solution(s, g)) fail('no way to reach the goal was found; check the numbers');
    return { spec: s, goal: g };
  }

  // The learner's attempt, checked: { correct, invalid?, why? } (why: what the page says about it).
  function check(spec, goal, val) {
    if (spec.mode === 'fraction') {
      const sh = shadingOf(spec, val);
      if (!sh) return { correct: false, invalid: true };
      const r = fractionMeets(spec, goal, sh);
      return r.empty ? { correct: false, invalid: true, why: { code: 'empty' } } : r;
    }
    if (spec.mode === 'line') {
      const st = lineState(spec, val);
      if (!st) return { correct: false, invalid: true };
      const r = lineMeets(spec, goal, st);
      return r.empty ? { correct: false, invalid: true, why: r.why } : r;
    }
    const c = blocksState(spec, val);
    if (!c) return { correct: false, invalid: true };
    const r = blocksMeets(spec, goal, c);
    return r.empty ? { correct: false, invalid: true, why: r.why } : r;
  }

  // An attempt that meets the goal (plain JSON, as value() gives it), or null.
  function solution(spec, goal) {
    if (spec.mode === 'fraction') { const sh = fractionSolution(spec, goal); return sh && fractionMeets(spec, goal, sh).correct ? { shaded: sh } : null; }
    if (spec.mode === 'line') { const v = lineSolution(spec, goal); return v && check(spec, goal, v).correct ? v : null; }
    const c = blocksSolution(spec, goal);
    return blocksMeets(spec, goal, c).correct ? { counts: c } : null;
  }

  return {
    NumError, MINUS, CAP, MAX_PLACES, MAX_TICKS, MAX_PARTS, PLACE_NAMES,
    Q, ZERO, ONE, add, sub, mul, div, cmp, eq, isInt, toNum, sum, gcd, gcdQ, key,
    parse, value, parseSum, decimal, pieces, show, showSum,
    group, words, groupingOf, totalOf, digitsOf, canonical, placeName,
    gridSides, ticksOf, tickOf, fewestHops, lineState, shadingOf, blocksState,
    cleanSpec, cleanBlock, cleanTask, check, solution, text
  };
});
