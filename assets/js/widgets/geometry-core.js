/* =====================================================================
   The geometry board's logic, shared by its two halves so both read a
   figure the same way: the server (server/widgets/geometry.mjs checks
   every board the AI writes, and that each task can be done) and the
   page (assets/js/widgets/geometry.js draws it, moves it and checks the
   learner's tasks). The server imports this file; the page loads it
   with a script element (window.PrimerGeometry).

   A board (the "spec"), after cleanSpec:
     x, y      [min, max]: the view, in the figure's own units, with the
               same scale both ways (one is widened to keep the board's
               shape sensible on a phone)
     grid      0, or the step of the squared paper; axes: true or false
     snap      0 (free), or the step dragged points move in
     unit      '' or a short unit ("cm") shown after lengths and areas
     points    { "A": [x, y], "P": { at: [x, y], on: "c", hidden } }
               free points, and points kept on a segment, ray, line,
               circle or axis ("gliders")
     objects   [{ type, ... }]: segment, ray, line, polygon, circle,
               angle (a marked angle and its size); and objects made from
               others: midpoint, intersection, foot, perpendicular,
               parallel, perpendicular bisector, angle bisector, tangent,
               centroid, circumcentre, incentre, orthocentre, and the
               images of points under reflect, rotate, translate, enlarge
     drag      [names]: the points the learner may drag
     measure   ["AB", "angle ACB", { of: "area ABC", label }]: shown live

   The construction is a graph of named objects, each made from others;
   it is put in order (a loop is an error) and recomputed in that order
   whenever a point moves. Something that stops existing (two lines
   become parallel, a point goes inside the circle it should touch) is
   null, and so is everything made from it: it is simply not drawn.

   Measurements and conditions are short texts, read here (never eval):
   "AB", "angle ACB", "angle A" (a polygon's angle), "area ABC",
   "perimeter ABCD", "radius c", "x A", and + - * / ^ of them;
   conditions compare two of them ("angle ACB = 90", "AB = AC") or name
   a property ("P on c", "AB parallel CD", "ABC isosceles",
   "ABCD parallelogram", "ABC congruent DEF").

   A task's goal, after cleanGoal:
     { all: ["angle ACB = 90"], solution: { C: [3, 3] }, tol? }
   every condition must hold (angles within 1 degree, lengths and areas
   within 1.5%) after the learner drags; the solution must meet them and
   the start must not. The learner's attempt ("value"): { C: [x, y] }.
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerGeometry = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const LIMITS = Object.freeze({
    points: 16, objects: 30, nodes: 80, drag: 8, measures: 8, conditions: 4, polygon: 10,
    label: 40, coord: 1000, minSpan: 2, maxSpan: 400
  });
  const ANG = 1;      // degrees: how close an angle must be
  const REL = 0.015;  // lengths, areas and ratios: this fraction of their size
  const PALETTE = Object.freeze({ ink: '#2b1d11', red: '#9a3324', blue: '#2c5a8a', green: '#3d6a2c', gold: '#8a6128', purple: '#6b3d7a' });
  const COLOR_ALIAS = { black: 'ink', grey: 'ink', gray: 'ink', brown: 'gold', orange: 'gold', yellow: 'gold', amber: 'gold', violet: 'purple', navy: 'blue', teal: 'green' };
  const DEG = Math.PI / 180;

  class GeoError extends Error {}
  const fail = (m) => { throw new GeoError(m); };
  const fin = Number.isFinite;
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
  const txt = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const r6 = (v) => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };
  // a number in a sentence to the AI (and in tests): at most 2 places
  const num = (v) => (fin(v) ? String(Number(v.toFixed(2))).replace(/^-0$/, '0') : 'nothing');
  const pairText = (p) => `(${num(p.x)}, ${num(p.y)})`;
  const quote = (s) => `"${String(s).slice(0, 60)}"`;

  /* ---------------- names ---------------- */

  const primes = (s) => String(s).replace(/[′’‘`´ʹ]/g, "'").replace(/[″ʺ]/g, "''");
  const PT = /^[A-Z][0-9]{0,2}'{0,2}$/;
  const PT_ALL = /^(?:[A-Z][0-9]{0,2}'{0,2})+$/;
  const PT_EACH = /[A-Z][0-9]{0,2}'{0,2}/g;
  const OBJ = /^[a-z][a-z0-9_]{0,7}$/;
  const RESERVED = new Set(['x', 'y', 'pi', 'angle', 'area', 'perimeter', 'radius', 'diameter', 'circumference', 'length', 'distance',
    'on', 'of', 'the', 'is', 'a', 'an', 'to', 'and', 'at', 'circle', 'triangle', 'parallel', 'perpendicular', 'xaxis', 'yaxis', 'axis']);
  const pointName = (v) => { if (typeof v !== 'string') return null; const s = primes(v).trim(); return PT.test(s) ? s : null; };
  // "ABC", "A, B, C" or ["A", "B", "C"] -> ["A", "B", "C"] (or null)
  function splitPoints(v) {
    if (Array.isArray(v)) { const out = v.map(pointName); return out.length && out.every(Boolean) ? out : null; }
    if (typeof v !== 'string') return null;
    const s = primes(v).replace(/[\s,;-]+/g, '');
    return PT_ALL.test(s) ? s.match(PT_EACH) : null;
  }
  function objName(v, what) {
    if (v == null || v === '' || v === false) return null;
    if (typeof v !== 'string') fail(`${what}: "name" must be a short word, like "l" or "c1"`);
    const s = primes(v).trim().toLowerCase();
    if (!OBJ.test(s) || RESERVED.has(s)) fail(`${what}: ${quote(v)} can't be a line's or circle's name; use a small letter, maybe with a digit (l, m, c, c1)`);
    return s;
  }
  const colorOf = (v) => {
    if (typeof v !== 'string') return null;
    const c = v.toLowerCase().trim();
    return PALETTE[c] ? c : COLOR_ALIAS[c] || null;
  };

  /* ---------------- vectors and the shapes' sums ---------------- */

  const P2 = (x, y) => ({ x, y });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => P2((a.x + b.x) / 2, (a.y + b.y) / 2);
  function angleAt(v, a, b) {
    const ux = a.x - v.x, uy = a.y - v.y, wx = b.x - v.x, wy = b.y - v.y;
    const la = Math.hypot(ux, uy), lb = Math.hypot(wx, wy);
    if (la < 1e-9 || lb < 1e-9) return NaN;
    return Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / (la * lb)))) / DEG;
  }
  function signedArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; }
    return s / 2;
  }
  const areaOf = (pts) => Math.abs(signedArea(pts));
  const perimeterOf = (pts) => pts.reduce((s, p, i) => s + dist(p, pts[(i + 1) % pts.length]), 0);
  // a line, ray or segment: p(t) = (x, y) + t (dx, dy) for t in [lo, hi]
  function lineOf(a, b, lo, hi) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return Math.hypot(dx, dy) < 1e-9 ? null : { x: a.x, y: a.y, dx, dy, lo, hi };
  }
  const INF = Infinity;
  const along = (l, t) => P2(l.x + t * l.dx, l.y + t * l.dy);
  const within = (l, t) => t >= l.lo - 1e-7 && t <= l.hi + 1e-7;
  const X_AXIS = Object.freeze({ x: 0, y: 0, dx: 1, dy: 0, lo: -INF, hi: INF });
  const Y_AXIS = Object.freeze({ x: 0, y: 0, dx: 0, dy: 1, lo: -INF, hi: INF });
  const projT = (l, p) => ((p.x - l.x) * l.dx + (p.y - l.y) * l.dy) / (l.dx * l.dx + l.dy * l.dy);
  const clampT = (l, t) => Math.max(l.lo, Math.min(l.hi, t));
  // how far a point is from a line (within its ends) or a circle
  function distTo(p, o) {
    if (!o || !p) return NaN;
    if (o.r != null) return Math.abs(dist(p, o) - o.r);
    return dist(p, along(o, clampT(o, projT(o, p))));
  }
  // the angle between two lines' directions, 0 to 90 degrees
  function between(l1, l2) {
    const c = Math.abs(l1.dx * l2.dx + l1.dy * l2.dy) / (Math.hypot(l1.dx, l1.dy) * Math.hypot(l2.dx, l2.dy));
    return Math.acos(Math.min(1, c)) / DEG;
  }

  function meetLL(l1, l2) {
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 1e-10 * Math.hypot(l1.dx, l1.dy) * Math.hypot(l2.dx, l2.dy)) return [null];
    const ex = l2.x - l1.x, ey = l2.y - l1.y;
    const t = (ex * l2.dy - ey * l2.dx) / den, u = (ex * l1.dy - ey * l1.dx) / den;
    return [within(l1, t) && within(l2, u) ? along(l1, t) : null];
  }
  // a line and a circle: two places in the line's own direction (either may be off a segment's ends)
  function meetLC(l, c) {
    const fx = l.x - c.x, fy = l.y - c.y;
    const a = l.dx * l.dx + l.dy * l.dy, b = 2 * (fx * l.dx + fy * l.dy), q = fx * fx + fy * fy - c.r * c.r;
    let disc = b * b - 4 * a * q;
    if (disc < -1e-9 * Math.max(1, b * b, Math.abs(4 * a * q))) return [null, null];
    disc = Math.max(0, disc);
    const s = Math.sqrt(disc), t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
    return [within(l, t1) ? along(l, t1) : null, within(l, t2) ? along(l, t2) : null];
  }
  // two circles: the place to the left of the line from the first centre to the second, then the right
  function meetCC(c1, c2) {
    const dx = c2.x - c1.x, dy = c2.y - c1.y, d = Math.hypot(dx, dy);
    if (d < 1e-9) return [null, null];
    const tol = 1e-9 * Math.max(1, c1.r + c2.r);
    if (d > c1.r + c2.r + tol || d < Math.abs(c1.r - c2.r) - tol) return [null, null];
    const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
    const bx = c1.x + a * dx / d, by = c1.y + a * dy / d;
    return [P2(bx - h * dy / d, by + h * dx / d), P2(bx + h * dy / d, by - h * dx / d)];
  }
  function meet(a, b) {
    if (a.r == null && b.r == null) return meetLL(a, b);
    if (a.r == null) return meetLC(a, b);
    if (b.r == null) return meetLC(b, a);
    return meetCC(a, b);
  }
  function circumcentre(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    const scale = Math.max(dist(a, b), dist(b, c), dist(c, a));
    if (Math.abs(d) < 1e-9 * Math.max(1, scale * scale)) return null;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    return P2((a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d);
  }
  const foot = (p, l) => along(l, projT(l, p));
  // the points where tangents from p touch circle c (k = 0: counterclockwise from the line c -> p)
  function touch(p, c, k) {
    const d = dist(p, c);
    if (d < c.r * (1 - 1e-9)) return null;
    const al = Math.acos(Math.min(1, c.r / d)), th = Math.atan2(p.y - c.y, p.x - c.x) + (k ? -al : al);
    return P2(c.x + c.r * Math.cos(th), c.y + c.r * Math.sin(th));
  }

  /* ---------------- reading the AI's spec ---------------- */

  function xy(v, what) {
    let x, y;
    if (Array.isArray(v) && v.length === 2) [x, y] = v;
    else if (isObj(v) && 'x' in v && 'y' in v) ({ x, y } = v);
    else fail(`${what} must be [x, y], two numbers`);
    const toNum = (n) => (typeof n === 'string' && n.trim() !== '' ? Number(n) : n);
    x = toNum(x); y = toNum(y);
    if (typeof x !== 'number' || typeof y !== 'number' || !fin(x) || !fin(y)) fail(`${what} must be [x, y], two numbers`);
    if (Math.abs(x) > LIMITS.coord || Math.abs(y) > LIMITS.coord) fail(`${what} is too far out (keep coordinates within ±${LIMITS.coord})`);
    return [r6(x), r6(y)];
  }
  function numberIn(v, lo, hi, what) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !fin(n) || n < lo || n > hi) fail(`${what} must be a number from ${lo} to ${hi}`);
    return r6(n);
  }
  const typeKey = (v) => String(v == null ? '' : v).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const TYPES = {};
  [
    ['segment', 'segment', 'line segment', 'seg', 'side', 'edge'],
    ['ray', 'ray', 'half line', 'halfline'],
    ['line', 'line', 'straight line', 'infinite line'],
    ['polygon', 'polygon', 'triangle', 'quadrilateral', 'quad', 'pentagon', 'hexagon', 'octagon', 'shape', 'square', 'rectangle', 'parallelogram', 'rhombus', 'trapezium', 'trapezoid', 'kite'],
    ['circle', 'circle'],
    ['circumcircle', 'circumcircle', 'circle through'],
    ['angle', 'angle', 'angle mark', 'angle marker', 'mark angle', 'marked angle'],
    ['midpoint', 'midpoint', 'mid point', 'middle'],
    ['intersection', 'intersection', 'intersect', 'meet', 'point of intersection', 'intersection point'],
    ['foot', 'foot', 'foot of perpendicular', 'foot of the perpendicular', 'perpendicular foot', 'projection'],
    ['perpendicular', 'perpendicular', 'perpendicular line', 'perp'],
    ['parallel', 'parallel', 'parallel line'],
    ['perpendicular bisector', 'perpendicular bisector', 'perp bisector', 'right bisector', 'mediator'],
    ['angle bisector', 'angle bisector', 'bisector of angle', 'internal bisector'],
    ['bisector', 'bisector'],
    ['tangent', 'tangent', 'tangent line', 'tangents'],
    ['centroid', 'centroid'],
    ['circumcentre', 'circumcentre', 'circumcenter'],
    ['incentre', 'incentre', 'incenter'],
    ['orthocentre', 'orthocentre', 'orthocenter'],
    ['reflect', 'reflect', 'reflection', 'mirror'],
    ['rotate', 'rotate', 'rotation', 'turn'],
    ['translate', 'translate', 'translation', 'shift'],
    ['enlarge', 'enlarge', 'enlargement', 'dilation', 'dilate', 'scale', 'scaling'],
    ['point', 'point']
  ].forEach(([k, ...names]) => names.forEach((n) => { TYPES[n] = k; }));
  const LINES = new Set(['segment', 'ray', 'line']);
  const CENTRES = new Set(['centroid', 'circumcentre', 'incentre', 'orthocentre']);
  const TRANSFORMS = new Set(['reflect', 'rotate', 'translate', 'enlarge']);

  function style(o, extra) {
    const st = {};
    const c = colorOf(o.color || o.colour);
    if (c) st.color = c;
    if (o.dashed === true || o.dash === true || o.style === 'dashed') st.dashed = true;
    const lab = txt(o.label, LIMITS.label);
    if (lab) st.label = lab;
    return Object.assign(st, extra || {});
  }

  // The spec, read and checked: { spec (clean JSON), M (the model) }. Throws GeoError with a sentence the
  // AI can act on. opts.drag: the dragged points if the spec doesn't say; opts.include: places the view
  // must hold (a task's solution).
  function build(raw, opts) {
    opts = opts || {};
    if (!isObj(raw)) fail('the spec must be an object like {"points": {...}, "objects": [...]}');
    const nodes = [];
    const names = new Map(); // name -> node id
    const add = (n) => {
      n.id = nodes.length;
      nodes.push(n);
      if (nodes.length > LIMITS.nodes) fail(`too many objects (at most ${LIMITS.nodes} with every point made from others)`);
      return n;
    };
    const claim = (name, n) => {
      if (names.has(name)) fail(`${name} is named twice: ${nodes[names.get(name)].what} and ${n.what || "another object"}; give each its own name (a point made from others is not listed in \"points\" too)`);
      names.set(name, n.id);
      n.name = name;
    };

    /* the points */
    // a point made from others, written among the points ("D": {"type": "translate", ...}, "O": {"type":
    // "intersection", ...}), is that object, named by its key
    if (isObj(raw.points) && (raw.objects == null || Array.isArray(raw.objects))) {
      const made = Object.entries(raw.points).filter(([, v]) => isObj(v) && (v.type || v.kind) && TYPES[typeKey(v.type || v.kind)] && TYPES[typeKey(v.type || v.kind)] !== 'point');
      if (made.length) {
        const points = Object.assign({}, raw.points), objects = (raw.objects || []).slice();
        made.forEach(([k, v]) => {
          delete points[k];
          objects.push(TRANSFORMS.has(TYPES[typeKey(v.type || v.kind)]) ? Object.assign({}, v, v.names ? {} : { names: [k] }) : Object.assign({}, v, { name: k }));
        });
        return build(Object.assign({}, raw, { points, objects }), opts);
      }
    }
    let list;
    if (Array.isArray(raw.points)) list = raw.points.map((p, i) => { if (!isObj(p)) fail(`points: item ${i + 1} must be like {"name": "A", "at": [0, 0]}`); return [String(p.name || p.id || ''), p]; });
    else if (isObj(raw.points)) list = Object.entries(raw.points);
    else fail('"points" must name the points, like {"A": [0, 0], "B": [6, 0], "C": [2, 4]}');
    if (!list.length) fail('"points" must name at least one point, like {"A": [0, 0]}');
    if (list.length > LIMITS.points) fail(`too many points (at most ${LIMITS.points})`);
    const readPoint = (k, v) => {
      const name = pointName(k);
      if (!name) fail(`${quote(txt(String(k), 20))} can't be a point's name: use a capital letter, maybe with a digit or a prime (A, B1, A')`);
      const n = { kind: 'pt', base: true, what: `point ${name}`, style: {} };
      if (Array.isArray(v)) n.at = xy(v, `point ${name}`);
      else if (isObj(v)) {
        const p = v.at || v.pos || v.position || v.start || ('x' in v || 'y' in v ? [v.x, v.y] : null);
        if (p == null) fail(`point ${name} needs a place: "${name}": [x, y]${v.on ? `, or {"at": [x, y], "on": ${quote(txt(String(v.on), 20))}}` : ''}`);
        n.at = xy(p, `point ${name}`);
        if (v.on != null && v.on !== '') { if (typeof v.on !== 'string') fail(`point ${name}: "on" must name a segment, line or circle ("AB", "c")`); n.on = txt(v.on, 30); }
        if (v.hidden === true || v.hide === true || v.show === false || v.visible === false) n.style.hidden = true;
        const c = colorOf(v.color || v.colour);
        if (c) n.style.color = c;
        if (v.fixed === true || v.drag === false) n.fixed = true;
        if (v.free === true && !v.on) n.free = true; // dragged freely, though it starts on a circle
      } else fail(`point ${name} must be [x, y]`);
      n.op = n.on ? 'glider' : 'free';
      claim(name, add(n));
    };
    list.forEach(([k, v]) => readPoint(k, v));

    /* the objects */
    const objs = raw.objects == null ? [] : raw.objects;
    if (!Array.isArray(objs)) fail('"objects" must be a list, like [{"type": "polygon", "of": ["A", "B", "C"]}]');
    if (objs.length > LIMITS.objects) fail(`too many objects (at most ${LIMITS.objects})`);
    const outObjs = [];
    const ptsOf = (v, min, max, what) => {
      const p = splitPoints(v);
      if (!p) fail(`${what}: "of" must list points, like ["A", "B"]`);
      if (p.length < min || p.length > max) fail(`${what}: give ${min === max ? min : `${min} to ${max}`} points`);
      if (new Set(p).size !== p.length) fail(`${what}: a point appears twice in ${p.join('')}`);
      return p;
    };
    const onePt = (v, key, what) => { const p = pointName(v); if (!p) fail(`${what}: "${key}" must be a point's name, like "A"`); return p; };
    const refText = (v, key, what) => { if (typeof v !== 'string' || !v.trim()) fail(`${what}: "${key}" must name a line or circle ("AB", "l", "c")`); return txt(primes(v), 30); };
    objs.forEach((o0, i) => {
      if (!isObj(o0)) fail(`object ${i + 1} must be like {"type": "segment", "of": ["A", "B"]}`);
      let o = o0;
      let type = TYPES[typeKey(o.type || o.kind || o.t)];
      if (!type && !o.type) { // {"segment": ["A", "B"]}
        const k = Object.keys(o).find((x) => TYPES[typeKey(x)]);
        if (k) { type = TYPES[typeKey(k)]; o = Object.assign({ of: o[k] }, o); }
      }
      if (type === 'bisector') type = o.at || o.vertex ? 'angle bisector' : 'perpendicular bisector';
      if (!type) fail(`object ${i + 1}: unknown type ${quote(txt(String(o.type || ''), 30))}`);
      const what = `object ${i + 1} (${type})`;
      const name = (key) => objName(o[key], what);
      let out;
      if (type === 'point') { // a point among the objects, as in "points"
        readPoint(o.name, o);
        return;
      }
      if (LINES.has(type)) {
        const p = ptsOf(o.of || (o.from && o.to ? [o.from, o.to] : o.points), 2, 2, what);
        const st = style(o, o.length === true || o.showLength === true ? { length: true } : null);
        const n = add({ kind: 'line', op: type, of: p, draw: true, style: st, what: `${type} ${p.join('')}` });
        const nm = name('name');
        if (nm) claim(nm, n);
        out = Object.assign({ type, of: p }, nm ? { name: nm } : {}, st);
      } else if (type === 'polygon') {
        const p = ptsOf(o.of || o.points || o.vertices, 3, LIMITS.polygon, what);
        const st = style(o);
        add({ kind: 'poly', op: 'polygon', of: p, draw: true, style: st, what: `polygon ${p.join('')}` });
        out = Object.assign({ type, of: p }, st);
      } else if (type === 'circle' || type === 'circumcircle') {
        const st = style(o);
        const nm = name('name');
        const n = { kind: 'circle', draw: true, style: st, src: i };
        const thru = splitPoints(type === 'circumcircle' ? o.of || o.through : o.through);
        if (type === 'circumcircle' || (thru && thru.length === 3 && !o.center && !o.centre)) {
          if (!thru || thru.length !== 3) fail(`${what}: a circle through three points needs "through": ["A", "B", "C"]`);
          Object.assign(n, { op: 'c3', of: thru, what: `the circle through ${thru.join(', ')}` });
          out = { type: 'circle', through: thru };
        } else {
          const c = onePt(o.center || o.centre, 'center', what);
          n.center = c;
          if (o.through != null) {
            const t = onePt(Array.isArray(o.through) ? o.through[0] : o.through, 'through', what);
            Object.assign(n, { op: 'ct', through: t, what: `the circle with centre ${c} through ${t}` });
            out = { type: 'circle', center: c, through: t };
          } else if (o.radius != null) {
            const rp = typeof o.radius === 'string' ? splitPoints(o.radius) : null;
            if (rp && rp.length === 2) { Object.assign(n, { op: 'cd', radius: rp, what: `the circle with centre ${c} and radius ${rp.join('')}` }); out = { type: 'circle', center: c, radius: rp.join('') }; }
            else { const r = numberIn(o.radius, 0.01, LIMITS.coord, `${what}: "radius"`); Object.assign(n, { op: 'cr', radius: r, what: `the circle with centre ${c} and radius ${num(r)}` }); out = { type: 'circle', center: c, radius: r }; }
          } else fail(`${what}: give "through": "A" (a point on it) or "radius": 3`);
        }
        add(n);
        if (nm) { claim(nm, n); n.what = `circle ${nm}`; }
        out = Object.assign(out, nm ? { name: nm } : {}, st);
      } else if (type === 'angle') {
        let v = o.at || o.vertex, a = o.from, b = o.to;
        const three = splitPoints(o.of || o.angle || o.points);
        if (!v && three && three.length === 3) [a, v, b] = three;
        v = onePt(v, 'at', what); a = onePt(a, 'from', what); b = onePt(b, 'to', what);
        if (new Set([a, v, b]).size < 3) fail(`${what}: an angle needs three different points`);
        const st = style(o, o.value === false || o.showValue === false ? { value: false } : null);
        add({ kind: 'angle', op: 'angle', at: v, from: a, to: b, draw: true, style: st, what: `angle ${a}${v}${b}` });
        out = Object.assign({ type, at: v, from: a, to: b }, st);
      } else if (type === 'midpoint' || CENTRES.has(type)) {
        const p = ptsOf(o.of || o.points, type === 'midpoint' ? 2 : 3, type === 'midpoint' ? 2 : 3, what);
        const nm = pointName(o.name);
        if (!nm) fail(`${what}: give it a point's "name", like "M"`);
        const st = style(o);
        if (o.hidden === true) st.hidden = true;
        const n = add({ kind: 'pt', op: type, of: p, style: st, what: `${type === 'midpoint' ? 'the midpoint' : 'the ' + type} ${nm}` });
        claim(nm, n);
        out = Object.assign({ type, of: p, name: nm }, st);
      } else if (type === 'intersection') {
        const of = Array.isArray(o.of) ? o.of : o.of == null && o.a && o.b ? [o.a, o.b] : null;
        if (!of || of.length !== 2) fail(`${what}: "of" must name two lines or circles, like ["AB", "c"]`);
        const nm = pointName(o.name);
        if (!nm) fail(`${what}: give it a point's "name", like "P"`);
        const refs = of.map((r) => refText(r, 'of', what));
        const st = style(o);
        if (o.hidden === true) st.hidden = true;
        const n = add({ kind: 'pt', op: 'meet', refs, style: st, what: `the intersection ${nm} of ${refs.join(' and ')}` });
        if (o.not != null) n.not = onePt(o.not, 'not', what);
        if (o.pick === 0 || o.pick === 1) n.pick = o.pick;
        else if (o.near != null) n.near = typeof o.near === 'string' ? onePt(o.near, 'near', what) : xy(o.near, `${what}: "near"`);
        claim(nm, n);
        out = n.out = Object.assign({ type, of: refs, name: nm }, n.not ? { not: n.not } : {}, st);
      } else if (type === 'foot') {
        const p = onePt(o.from || o.of || o.point, 'from', what);
        const nm = pointName(o.name);
        if (!nm) fail(`${what}: give it a point's "name", like "F"`);
        const to = refText(o.to || o.on || o.line, 'to', what);
        const st = style(o);
        const n = add({ kind: 'pt', op: 'foot', from: p, refs: [to], style: st, what: `the foot ${nm} of the perpendicular from ${p} to ${to}` });
        claim(nm, n);
        out = Object.assign({ type, from: p, to, name: nm }, st);
      } else if (type === 'perpendicular' || type === 'parallel') {
        const p = onePt(o.through || o.at || o.from, 'through', what);
        const to = refText(o.to || o.of || o.line, 'to', what);
        const st = style(o);
        const n = add({ kind: 'line', op: type === 'perpendicular' ? 'perp' : 'par', through: p, refs: [to], draw: true, style: st, what: `the ${type} through ${p} to ${to}` });
        const nm = name('name');
        if (nm) claim(nm, n);
        out = Object.assign({ type, through: p, to }, nm ? { name: nm } : {}, st);
      } else if (type === 'perpendicular bisector') {
        const p = ptsOf(o.of || o.points, 2, 2, what);
        const st = style(o);
        const n = add({ kind: 'line', op: 'pbis', of: p, draw: true, style: st, what: `the perpendicular bisector of ${p.join('')}` });
        const nm = name('name');
        if (nm) claim(nm, n);
        out = Object.assign({ type, of: p }, nm ? { name: nm } : {}, st);
      } else if (type === 'angle bisector') {
        let v = o.at || o.vertex, a = o.from, b = o.to;
        const three = splitPoints(o.of || o.angle);
        if (!v && three && three.length === 3) [a, v, b] = three;
        v = onePt(v, 'at', what); a = onePt(a, 'from', what); b = onePt(b, 'to', what);
        const st = style(o);
        const n = add({ kind: 'line', op: 'abis', at: v, from: a, to: b, draw: true, style: st, what: `the bisector of angle ${a}${v}${b}` });
        const nm = name('name');
        if (nm) claim(nm, n);
        out = Object.assign({ type, at: v, from: a, to: b }, nm ? { name: nm } : {}, st);
      } else if (type === 'tangent') {
        const to = refText(o.to || o.circle || o.of, 'to', what);
        const st = style(o);
        if (o.at != null) {
          const p = onePt(o.at, 'at', what);
          const n = add({ kind: 'line', op: 'tanAt', at: p, refs: [to], draw: true, style: st, what: `the tangent at ${p} to ${to}` });
          const nm = name('name');
          if (nm) claim(nm, n);
          out = Object.assign({ type, at: p, to }, nm ? { name: nm } : {}, st);
        } else {
          const p = onePt(o.from || o.through, 'from', what);
          const tp = o.points == null ? [] : splitPoints(o.points);
          if (!tp || tp.length > 2) fail(`${what}: "points" names the two points where the tangents touch, like ["T", "U"]`);
          [0, 1].forEach((k) => {
            const nm = tp[k] || null;
            const tn = add({ kind: 'pt', op: 'touch', from: p, refs: [to], k, style: nm ? {} : { hidden: true }, what: `the point where the tangent from ${p} touches ${to}` });
            if (nm) claim(nm, tn); else tn.name = `~t${tn.id}`, names.set(tn.name, tn.id);
            add({ kind: 'line', op: 'line', of: [p, tn.name], draw: true, made: true, style: st, what: `the tangent from ${p} to ${to}` });
          });
          out = Object.assign({ type, from: p, to }, tp.length ? { points: tp } : {}, st);
        }
      } else if (TRANSFORMS.has(type)) {
        const src = ptsOf(o.of || o.points || o.shape, 1, LIMITS.polygon, what);
        const tf = { type };
        if (type === 'reflect') {
          const m = o.in || o.line || o.mirror || o.across || o.over || o.about;
          if (typeof m !== 'string') fail(`${what}: "in" must name the mirror line ("l", "AB") or a point`);
          tf.in = txt(primes(m), 30);
          out = { type, of: src, in: tf.in };
        } else if (type === 'rotate') {
          tf.about = onePt(o.about || o.center || o.centre, 'about', what);
          tf.by = numberIn(o.by != null ? o.by : o.angle, -360, 360, `${what}: "by" (degrees, counterclockwise)`);
          out = { type, of: src, about: tf.about, by: tf.by };
        } else if (type === 'translate') {
          const by = o.by != null ? o.by : o.vector;
          const vp = typeof by === 'string' ? splitPoints(by) : null;
          if (vp && vp.length === 2) { tf.vec = vp; out = { type, of: src, by: vp.join('') }; }
          else { const d = xy(by, `${what}: "by"`); tf.by = d; out = { type, of: src, by: d }; }
        } else {
          tf.center = onePt(o.center || o.centre || o.about || o.from, 'center', what);
          tf.by = numberIn(o.by != null ? o.by : o.factor != null ? o.factor : o.scale, -10, 10, `${what}: "by" (the scale factor)`);
          if (Math.abs(tf.by) < 0.05) fail(`${what}: the scale factor must not be 0`);
          out = { type, of: src, center: tf.center, by: tf.by };
        }
        let given = o.names == null ? [] : splitPoints(o.names);
        if (!given || given.length > src.length) fail(`${what}: "names" gives the images' names, one for each point, like ["A'", "B'", "C'"]`);
        const st = style(o);
        const img = src.map((s, j) => {
          let nm = given[j];
          if (!nm) { nm = s + "'"; if (names.has(nm) || !PT.test(nm)) nm = s + "''"; if (names.has(nm) || !PT.test(nm)) fail(`${what}: give the images "names"`); }
          const n = add({ kind: 'pt', op: 'image', src: s, tf, style: st.color || src.length > 1 ? { color: st.color || 'green' } : {}, what: `the image ${nm} of ${s}` });
          claim(nm, n);
          return nm;
        });
        if (img.length >= 2) add({ kind: img.length > 2 ? 'poly' : 'line', op: img.length > 2 ? 'polygon' : 'segment', of: img, draw: true, style: Object.assign({ color: 'green' }, st), what: `the image ${img.join('')}` });
        out = Object.assign(out, given.length ? { names: img } : {}, st);
      }
      outObjs.push(out);
    });

    /* references, made into links between nodes */
    const ptId = (p, what) => {
      const id = names.get(p);
      if (id == null) fail(`${what}: there is no point ${p}`);
      if (nodes[id].kind !== 'pt') fail(`${what}: ${p} is not a point`);
      return id;
    };
    // a line or circle named in an object, a condition or a measure: { kind, deps, get(V), text }
    function ref(s, what, want) {
      const t = primes(String(s)).trim();
      const ax = /^([xy])[\s-]?axis$/i.exec(t);
      if (ax) return { kind: 'line', deps: [], get: () => (ax[1].toLowerCase() === 'x' ? X_AXIS : Y_AXIS), text: `${ax[1].toLowerCase()}-axis`, axis: ax[1].toLowerCase() };
      const tryName = (nm) => {
        const id = names.get(nm);
        if (id == null) return null;
        const n = nodes[id];
        if (n.kind !== 'line' && n.kind !== 'circle') return null;
        if (want && want !== n.kind) fail(`${what}: ${nm} is a ${n.kind === 'line' ? 'line' : 'circle'}, and a ${want} is needed here`);
        return { kind: n.kind, deps: [id], get: (V) => V[id], text: nm, node: n };
      };
      const byName = tryName(t);
      if (byName) return byName;
      // "AB" is the line through A and B (before any line named "ab"); "C1" may be a circle named c1
      const pp = splitPoints(t);
      if (!(pp && pp.length === 2 && pp.every((p) => names.has(p)))) { const low = tryName(t.toLowerCase()); if (low) return low; }
      const cm = /^circle\s*([A-Z][0-9]{0,2}'{0,2})$/i.exec(t);
      if (cm) {
        const c = nodes.filter((n) => n.kind === 'circle' && n.center === cm[1].toUpperCase());
        if (c.length === 1) return { kind: 'circle', deps: [c[0].id], get: (V) => V[c[0].id], text: c[0].name || `circle ${c[0].center}`, node: c[0] };
        fail(`${what}: ${c.length ? 'more than one' : 'no'} circle has centre ${cm[1]}; give the circle a "name" and use it`);
      }
      const pts = splitPoints(t);
      if (pts && pts.length === 2) {
        if (want === 'circle') fail(`${what}: ${t} is a line; give the circle a "name" ("c") and use that`);
        const [a, b] = pts.map((p) => ptId(p, what));
        // the segment, ray or line drawn through them, if there is one; else the whole line
        const drawn = nodes.find((n) => n.kind === 'line' && n.of && n.of.length === 2 && ['segment', 'line', 'ray'].includes(n.op)
          && ((n.of[0] === pts[0] && n.of[1] === pts[1]) || (n.op !== 'ray' && n.of[0] === pts[1] && n.of[1] === pts[0])));
        if (drawn) return { kind: 'line', deps: [drawn.id], get: (V) => V[drawn.id], text: pts.join(''), node: drawn };
        return { kind: 'line', deps: [a, b], get: (V) => (V[a] && V[b] ? lineOf(V[a], V[b], -INF, INF) : null), text: pts.join('') };
      }
      fail(`${what}: nothing is called ${quote(t)}; name a line or circle with "name", or use two points like "AB"`);
    }

    nodes.forEach((n) => {
      const what = n.what;
      const P = (p) => ptId(p, what);
      if (n.op === 'free') { n.deps = []; return; }
      if (n.op === 'glider') {
        const r = ref(n.on, `point ${n.name}: "on"`);
        n.ref = r; n.deps = r.deps; n.on = r.text;
        return;
      }
      const ids = (n.of || []).map(P);
      if (n.kind === 'line' && ['segment', 'ray', 'line'].includes(n.op)) {
        const lo = 0, hi = n.op === 'segment' ? 1 : INF, lo2 = n.op === 'line' ? -INF : lo;
        n.deps = ids; n.fn = (V) => lineOf(V[ids[0]], V[ids[1]], lo2, hi);
      } else if (n.kind === 'poly') {
        n.deps = ids; n.fn = (V) => ({ pts: ids.map((i) => V[i]) });
      } else if (n.op === 'c3') {
        n.deps = ids; n.fn = (V) => { const c = circumcentre(V[ids[0]], V[ids[1]], V[ids[2]]); return c ? { x: c.x, y: c.y, r: dist(c, V[ids[0]]) } : null; };
      } else if (n.op === 'ct' || n.op === 'cr' || n.op === 'cd') {
        const c = P(n.center);
        if (n.op === 'ct') { const t = P(n.through); n.deps = [c, t]; n.fn = (V) => ({ x: V[c].x, y: V[c].y, r: dist(V[c], V[t]) }); }
        else if (n.op === 'cd') { const [a, b] = n.radius.map(P); n.deps = [c, a, b]; n.fn = (V) => ({ x: V[c].x, y: V[c].y, r: dist(V[a], V[b]) }); }
        else { n.deps = [c]; n.fn = (V) => ({ x: V[c].x, y: V[c].y, r: n.radius }); }
      } else if (n.op === 'angle') {
        const [v, a, b] = [P(n.at), P(n.from), P(n.to)];
        n.deps = [v, a, b]; n.fn = (V) => { const d = angleAt(V[v], V[a], V[b]); return fin(d) ? { v: V[v], a: V[a], b: V[b], deg: d } : null; };
      } else if (n.op === 'midpoint') {
        n.deps = ids; n.fn = (V) => mid(V[ids[0]], V[ids[1]]);
      } else if (n.op === 'centroid') {
        n.deps = ids; n.fn = (V) => P2((V[ids[0]].x + V[ids[1]].x + V[ids[2]].x) / 3, (V[ids[0]].y + V[ids[1]].y + V[ids[2]].y) / 3);
      } else if (n.op === 'circumcentre') {
        n.deps = ids; n.fn = (V) => circumcentre(V[ids[0]], V[ids[1]], V[ids[2]]);
      } else if (n.op === 'orthocentre') {
        n.deps = ids; n.fn = (V) => { const [a, b, c] = ids.map((i) => V[i]); const o = circumcentre(a, b, c); return o ? P2(a.x + b.x + c.x - 2 * o.x, a.y + b.y + c.y - 2 * o.y) : null; };
      } else if (n.op === 'incentre') {
        n.deps = ids; n.fn = (V) => {
          const [A, B, C] = ids.map((i) => V[i]), a = dist(B, C), b = dist(C, A), c = dist(A, B), s = a + b + c;
          return s > 1e-9 && areaOf([A, B, C]) > 1e-9 * s * s ? P2((a * A.x + b * B.x + c * C.x) / s, (a * A.y + b * B.y + c * C.y) / s) : null;
        };
      } else if (n.op === 'meet') {
        const r = n.refs.map((s) => ref(s, what));
        n.r = r; n.refs = r.map((x) => x.text);
        if (n.out) n.out.of = n.refs;
        const notId = n.not ? P(n.not) : null;
        const nearId = typeof n.near === 'string' ? P(n.near) : null;
        n.deps = [...r[0].deps, ...r[1].deps].concat(notId != null ? [notId] : [], nearId != null ? [nearId] : []);
        n.fn = (V) => {
          const a = r[0].get(V), b = r[1].get(V);
          if (!a || !b) return null;
          const c = meet(a, b);
          if (notId != null) {
            const q = V[notId], ok = c.filter((p) => p && dist(p, q) > 1e-6 * Math.max(1, Math.abs(q.x) + Math.abs(q.y)));
            if (!ok.length) return null;
            return ok.length === 1 ? ok[0] : (dist(ok[0], q) >= dist(ok[1], q) ? ok[0] : ok[1]);
          }
          if (c.length === 1) return c[0];
          if (n.pick === 0 || n.pick === 1) return c[n.pick];
          // the start decides which of two (once, at the start: see init)
          return c[0] || c[1];
        };
        n.cands = (V) => { const a = r[0].get(V), b = r[1].get(V); return a && b ? meet(a, b) : []; };
        n.nearId = nearId;
      } else if (n.op === 'foot') {
        const p = P(n.from), r = ref(n.refs[0], what, 'line');
        n.refs = [r.text]; n.deps = [p, ...r.deps];
        n.fn = (V) => { const l = r.get(V); return l ? foot(V[p], l) : null; };
      } else if (n.op === 'perp' || n.op === 'par') {
        const p = P(n.through), r = ref(n.refs[0], what, 'line');
        n.refs = [r.text]; n.deps = [p, ...r.deps];
        n.fn = (V) => { const l = r.get(V); if (!l) return null; const q = V[p]; return n.op === 'perp' ? { x: q.x, y: q.y, dx: -l.dy, dy: l.dx, lo: -INF, hi: INF } : { x: q.x, y: q.y, dx: l.dx, dy: l.dy, lo: -INF, hi: INF }; };
      } else if (n.op === 'pbis') {
        n.deps = ids; n.fn = (V) => { const a = V[ids[0]], b = V[ids[1]]; if (dist(a, b) < 1e-9) return null; const m = mid(a, b); return { x: m.x, y: m.y, dx: -(b.y - a.y), dy: b.x - a.x, lo: -INF, hi: INF }; };
      } else if (n.op === 'abis') {
        const [v, a, b] = [P(n.at), P(n.from), P(n.to)];
        n.deps = [v, a, b]; n.fn = (V) => {
          const q = V[v], la = dist(V[a], q), lb = dist(V[b], q);
          if (la < 1e-9 || lb < 1e-9) return null;
          let dx = (V[a].x - q.x) / la + (V[b].x - q.x) / lb, dy = (V[a].y - q.y) / la + (V[b].y - q.y) / lb;
          if (Math.hypot(dx, dy) < 1e-9) { dx = -(V[a].y - q.y) / la; dy = (V[a].x - q.x) / la; } // a straight angle: the perpendicular
          return { x: q.x, y: q.y, dx, dy, lo: 0, hi: INF };
        };
      } else if (n.op === 'tanAt') {
        const p = P(n.at), r = ref(n.refs[0], what, 'circle');
        n.refs = [r.text]; n.deps = [p, ...r.deps];
        n.fn = (V) => { const c = r.get(V), q = V[p]; if (!c || dist(q, c) < 1e-9) return null; return { x: q.x, y: q.y, dx: -(q.y - c.y), dy: q.x - c.x, lo: -INF, hi: INF }; };
        n.circle = r;
      } else if (n.op === 'touch') {
        const p = P(n.from), r = ref(n.refs[0], what, 'circle');
        n.refs = [r.text]; n.deps = [p, ...r.deps];
        n.fn = (V) => { const c = r.get(V); return c ? touch(V[p], c, n.k) : null; };
      } else if (n.op === 'image') {
        const s = P(n.src), tf = n.tf;
        if (tf.type === 'reflect') {
          const pt = pointName(tf.in);
          if (pt && names.has(pt)) { const o = P(pt); n.deps = [s, o]; n.fn = (V) => P2(2 * V[o].x - V[s].x, 2 * V[o].y - V[s].y); }
          else { const r = ref(tf.in, what, 'line'); n.deps = [s, ...r.deps]; n.fn = (V) => { const l = r.get(V); if (!l) return null; const f = foot(V[s], l); return P2(2 * f.x - V[s].x, 2 * f.y - V[s].y); }; }
        } else if (tf.type === 'rotate') {
          const o = P(tf.about), c = Math.cos(tf.by * DEG), si = Math.sin(tf.by * DEG);
          n.deps = [s, o]; n.fn = (V) => { const dx = V[s].x - V[o].x, dy = V[s].y - V[o].y; return P2(V[o].x + c * dx - si * dy, V[o].y + si * dx + c * dy); };
        } else if (tf.type === 'translate') {
          if (tf.vec) { const [a, b] = tf.vec.map(P); n.deps = [s, a, b]; n.fn = (V) => P2(V[s].x + V[b].x - V[a].x, V[s].y + V[b].y - V[a].y); }
          else { n.deps = [s]; n.fn = (V) => P2(V[s].x + tf.by[0], V[s].y + tf.by[1]); }
        } else {
          const o = P(tf.center);
          n.deps = [s, o]; n.fn = (V) => P2(V[o].x + tf.by * (V[s].x - V[o].x), V[o].y + tf.by * (V[s].y - V[o].y));
        }
      }
    });
    // the mirror's canonical text, for the clean spec
    outObjs.forEach((o) => { if (o.type === 'reflect' && !pointName(o.in)) { const r = ref(o.in, 'reflect'); o.in = r.text; } });

    /* the order to work them out in: each after what it's made from */
    const order = [], state = new Array(nodes.length).fill(0);
    const visit = (id, path) => {
      if (state[id] === 2) return;
      if (state[id] === 1) {
        const loop = path.slice(path.indexOf(id)).concat(id).map((i) => nodes[i].name && !nodes[i].name.startsWith('~') ? nodes[i].name : nodes[i].what);
        fail(`${loop.join(' -> ')}: each is made from the next, in a loop`);
      }
      state[id] = 1;
      nodes[id].deps.forEach((d) => visit(d, path.concat(id)));
      state[id] = 2;
      order.push(id);
    };
    nodes.forEach((n) => visit(n.id, []));

    /* the start */
    const S0 = { p: {}, t: {} };
    nodes.forEach((n) => { if (n.op === 'free') S0.p[n.name] = n.at; });
    const used = { t: {} };
    compute(S0, used);
    S0.t = used.t;
    const named = nodes.filter((n) => n.kind === 'pt');
    // which of two crossings an intersection is: the one nearest "near", or the one that isn't already a named point
    let Vs = compute(S0);
    for (const id of order) {
      const n = nodes[id];
      if (n.op !== 'meet' || n.not || n.pick != null) continue;
      const c = n.cands(Vs);
      if (c.length < 2) continue;
      const ok2 = [0, 1].filter((k) => c[k]);
      if (!ok2.length) continue; // reported below
      let k;
      if (ok2.length === 1) k = ok2[0];
      else if (n.near) {
        const q = typeof n.near === 'string' ? Vs[n.nearId] : P2(n.near[0], n.near[1]);
        k = dist(c[0], q) <= dist(c[1], q) ? 0 : 1;
      } else if (dist(c[0], c[1]) < 1e-6) k = 0;
      else {
        const taken = (p) => named.some((m) => m.id !== n.id && Vs[m.id] && dist(Vs[m.id], p) < 1e-6);
        const free = ok2.filter((j) => !taken(c[j]));
        if (free.length !== 1) fail(`${n.what}: they meet at two places, ${pairText(c[0])} and ${pairText(c[1])}; add "near": [x, y] to say which`);
        k = free[0];
      }
      n.pick = k;
      if (n.out) n.out.pick = k;
      Vs = compute(S0);
    }
    const V1 = Vs;

    /* everything must be there at the start */
    for (const id of order) {
      const n = nodes[id];
      if (V1[id] != null) continue;
      if (n.deps.some((d) => V1[d] == null)) continue; // its cause is reported first
      fail(`${n.what} ${whyMissing(n, V1)}`);
    }
    function whyMissing(n, V) {
      const at = (p) => V[names.get(p)];
      if (n.op === 'meet') {
        const [a, b] = n.r.map((r) => r.get(V));
        return a && b && a.r == null && b.r == null && between(a, b) < 0.01 ? 'can\'t be found: the two lines are parallel at the start' : `can't be found: ${n.refs.join(' and ')} don't meet at the start${n.not ? ` anywhere but at ${n.not}` : ''}`;
      }
      if (n.op === 'touch') return `can't be found: ${n.from} is inside the circle at the start`;
      if (n.op === 'c3' || n.op === 'circumcentre' || n.op === 'orthocentre' || n.op === 'incentre') return `can't be found: ${n.of.join(', ')} are in a line at the start`;
      if (n.op === 'tanAt') return `can't be drawn: ${n.at} is at the circle's centre`;
      if (n.of && n.of.length === 2 && n.of.every((p) => at(p)) && dist(at(n.of[0]), at(n.of[1])) < 1e-9) return `can't be drawn: ${n.of[0]} and ${n.of[1]} are at the same place`;
      if (n.op === 'ct') return `can't be drawn: ${n.through} is at the centre ${n.center}`;
      if (n.op === 'angle' || n.op === 'abis') return 'can\'t be drawn: two of its points are at the same place';
      return 'can\'t be drawn at the start';
    }
    // a tangent "at" a point must start on its circle
    nodes.forEach((n) => {
      if (n.op !== 'tanAt') return;
      const c = n.circle.get(V1), q = V1[names.get(n.at)];
      if (Math.abs(dist(q, c) - c.r) > 1e-6 * Math.max(1, c.r)) fail(`${n.what}: ${n.at} is not on ${n.refs[0]} (put it there with "on": "${n.refs[0]}")`);
    });

    /* the view: what the spec says, or around every point at the start (and the solution) */
    const extra = (opts.include || []).filter((p) => Array.isArray(p) && fin(p[0]) && fin(p[1])).map(([x, y]) => P2(x, y));
    const spots = named.map((n) => V1[n.id]).filter(Boolean).concat(extra);
    // and whole circles, so a point dragged round one stays in sight
    nodes.forEach((n) => { const c = n.kind === 'circle' && V1[n.id]; if (c && c.r < LIMITS.maxSpan / 2) spots.push(P2(c.x - c.r, c.y - c.r), P2(c.x + c.r, c.y + c.r)); });
    const range = (key) => {
      const v = raw[key];
      if (v == null) return null;
      if (!Array.isArray(v) || v.length !== 2) fail(`"${key}" must be [min, max], like [0, 10]`);
      const lo = numberIn(v[0], -LIMITS.coord, LIMITS.coord, `"${key}"`), hi = numberIn(v[1], -LIMITS.coord, LIMITS.coord, `"${key}"`);
      if (!(hi - lo >= LIMITS.minSpan)) fail(`"${key}" must go from a smaller number to one at least ${LIMITS.minSpan} more`);
      if (hi - lo > LIMITS.maxSpan) fail(`"${key}" is too wide (at most ${LIMITS.maxSpan} across)`);
      return [lo, hi];
    };
    let X = range('x'), Y = range('y');
    if (!X || !Y) {
      const xs = spots.map((p) => p.x), ys = spots.map((p) => p.y);
      const pad = (lo, hi) => { const m = Math.max(1, (hi - lo) * 0.12); return [Math.floor(lo - m), Math.ceil(hi + m)]; };
      if (!X) X = pad(Math.min(...xs), Math.max(...xs));
      if (!Y) Y = pad(Math.min(...ys), Math.max(...ys));
      if (X[1] - X[0] < 4) X = [X[0] - 2, X[1] + 2];
      if (Y[1] - Y[0] < 4) Y = [Y[0] - 2, Y[1] + 2];
    }
    // equal scales: a board taller than about 1.2 times its width, or wider than 2.4 times its height, is widened
    const grow = (r, w) => { const e = (w - (r[1] - r[0])) / 2; return [Math.floor((r[0] - e) * 2) / 2, Math.ceil((r[1] + e) * 2) / 2]; };
    if ((Y[1] - Y[0]) > 1.2 * (X[1] - X[0])) X = grow(X, (Y[1] - Y[0]) / 1.2);
    if ((X[1] - X[0]) > 2.4 * (Y[1] - Y[0])) Y = grow(Y, (X[1] - X[0]) / 2.4);
    const view = { x0: X[0], x1: X[1], y0: Y[0], y1: Y[1] };
    const span = Math.max(X[1] - X[0], Y[1] - Y[0]);
    const inView = (p) => Boolean(p) && p.x >= view.x0 - 1e-6 && p.x <= view.x1 + 1e-6 && p.y >= view.y0 - 1e-6 && p.y <= view.y1 + 1e-6;
    const viewText = `x from ${num(view.x0)} to ${num(view.x1)}, y from ${num(view.y0)} to ${num(view.y1)}`;

    /* every point in the view */
    for (const n of named) if (!n.name.startsWith('~') && !inView(V1[n.id])) fail(`${n.name} is at ${pairText(V1[n.id])}, outside the view (${viewText}); widen "x" and "y" or move it`);

    /* the grid, the snap, the axes */
    const axes = raw.axes === true || raw.coordinates === true;
    let grid = 0;
    if (raw.grid === true || (raw.grid == null && axes)) grid = span <= 5 ? 0.5 : span <= 18 ? 1 : span <= 36 ? 2 : niceStep(span / 14);
    else if (typeof raw.grid === 'number' && raw.grid > 0) {
      grid = numberIn(raw.grid, span / 60, span / 3, '"grid" (the squares\' size)');
    }
    let snap = 0;
    if (raw.snap == null || raw.snap === true) snap = raw.snap === true || grid ? grid || niceStep(span / 14) : 0;
    else if (raw.snap !== false && raw.snap !== 0) snap = numberIn(raw.snap, span / 200, span / 3, '"snap" (the step a dragged point moves in)');
    const unit = /^[a-zA-Z]{1,5}$/.test(txt(raw.unit || raw.units, 6)) ? txt(raw.unit || raw.units, 6) : '';

    /* who may be dragged */
    const bases = nodes.filter((n) => n.base);
    let drag;
    const dragRaw = raw.drag != null ? raw.drag : raw.draggable != null ? raw.draggable : raw.move;
    if (dragRaw === true || dragRaw === 'all') drag = bases.map((n) => n.name);
    else if (dragRaw != null) {
      const d = typeof dragRaw === 'string' ? splitPoints(dragRaw) : splitPoints(dragRaw);
      if (!d && !(Array.isArray(dragRaw) && dragRaw.length === 0)) fail('"drag" must list the points the learner may drag, like ["C"]');
      drag = d || [];
    } else drag = opts.drag ? opts.drag.slice() : bases.filter((n) => !n.fixed && !n.style.hidden).map((n) => n.name);
    drag = [...new Set(drag)];
    if (drag.length > LIMITS.drag) fail(`"drag": at most ${LIMITS.drag} points${dragRaw == null ? " (list the ones the learner may move)" : ""}`);
    drag.forEach((p) => {
      const id = names.get(p);
      if (id == null) fail(`"drag": there is no point ${p}`);
      const n = nodes[id];
      if (!n.base) fail(`"drag": ${p} is made from other points (${n.what}), so it moves with them; drag one of those instead`);
      if (n.style.hidden) fail(`"drag": ${p} is hidden, so it can't be dragged`);
    });

    // A dragged point that starts on a drawn circle (one not made from it) is meant to go round it ("drag C
    // round the circle: the angle stays the same"): it is kept on it, as if it said "on". Exactly on it, or
    // (as the AI writes them: (5, 6.5) on a circle of radius 3 about (5, 4)) within a fifth of the radius
    // when it is plainly an angle in that circle: the vertex of a marked angle, or of two segments, whose
    // other ends are on it. For a task, only exactly, and only if its solution is on that circle too; a
    // point left free is marked so, and every later reading of the clean spec agrees.
    if (!opts.asIs) {
      const madeFrom = (id, seen = new Set()) => { nodes[id].deps.forEach((d) => { if (!seen.has(d)) { seen.add(d); madeFrom(d, seen); } }); return seen; };
      const onIt = (q, c) => Math.abs(dist(q, c) - c.r) <= 1e-6 * Math.max(1, c.r);
      // the points at the other end of the segments (and polygon sides) from p, and of the angles marked at p
      const ends = (p) => {
        const out = [];
        nodes.forEach((m) => {
          if (!m.draw || !m.of) return;
          const k = m.of.indexOf(p);
          if (k < 0) return;
          if (m.op === 'segment') out.push(m.of[1 - k]);
          if (m.kind === 'poly') out.push(m.of[(k + 1) % m.of.length], m.of[(k + m.of.length - 1) % m.of.length]);
        });
        return out;
      };
      const keep = [];
      drag.forEach((p) => {
        const n = nodes[names.get(p)];
        if (n.op !== 'free' || n.free) return;
        const q = V1[n.id];
        const sol = opts.solution && Array.isArray(opts.solution[p]) && fin(opts.solution[p][0]) && fin(opts.solution[p][1]) ? P2(opts.solution[p][0], opts.solution[p][1]) : null;
        const off = (m) => Math.abs(dist(q, V1[m.id]) - V1[m.id].r);
        const on = nodes.filter((m) => m.kind === 'circle' && m.draw && V1[m.id] && off(m) <= 0.2 * V1[m.id].r && !madeFrom(m.id).has(n.id));
        if (on.length !== 1) return;
        const c = V1[on[0].id], exact = onIt(q, c);
        const inscribed = () => {
          const at = (x) => V1[names.get(x)];
          if (nodes.some((m) => m.op === 'angle' && m.at === p && onIt(at(m.from), c) && onIt(at(m.to), c))) return true;
          return new Set(ends(p).filter((x) => at(x) && onIt(at(x), c))).size >= 2;
        };
        if (opts.task) {
          if (!exact && !inscribed()) return; // nothing to say: it is no circle's point
          if (!exact || (sol && Math.abs(dist(sol, c) - c.r) > Math.max(0.05, span * 0.01))) n.free = true; // it stays free, and says so
          else keep.push({ p, m: on[0] });
        } else if (exact || inscribed()) keep.push({ p, m: on[0] });
      });
      if (keep.length) {
        const r2 = Object.assign({}, raw);
        r2.objects = objs.map((o) => (isObj(o) ? Object.assign({}, o) : o));
        const used = new Set(names.keys());
        // a point's entry, rewritten wherever the spec gave it
        const rewrite = (p, extra) => {
          const entry = (v) => Object.assign(isObj(v) ? Object.assign({}, v) : {}, { at: nodes[names.get(p)].at }, extra);
          const named = (v) => isObj(v) && pointName(String(v.name || v.id || '')) === p;
          if (Array.isArray(r2.points)) r2.points = r2.points.map((v) => (named(v) ? entry(v) : v));
          else {
            const key = Object.keys(r2.points).find((k) => pointName(k) === p);
            if (key != null) { r2.points = Object.assign({}, r2.points); r2.points[key] = entry(r2.points[key]); }
            else r2.objects = r2.objects.map((o) => (named(o) && TYPES[typeKey(o.type)] === 'point' ? entry(o) : o)); // a point among the objects
          }
        };
        keep.forEach(({ p, m }) => {
          let ref = m.name;
          if (!ref) { // name the circle, so the point can say which it is on
            const o = r2.objects[m.src];
            ref = ['c', 'c1', 'c2', 'c3', 'c4', 'k', 'k1'].find((x) => !used.has(x)) || 'cc';
            used.add(ref);
            o.name = ref;
            m.name = ref;
          }
          rewrite(p, { on: ref });
        });
        drag.forEach((p) => { const n = nodes[names.get(p)]; if (n.free && n.op === 'free') rewrite(p, { free: true }); });
        return build(r2, Object.assign({}, opts, { asIs: true }));
      }
    }

    const M = {
      nodes, names, order, view, span, snap, grid, axes, unit, drag,
      init: () => ({ p: Object.assign({}, S0.p), t: Object.assign({}, S0.t) }),
      compute: (S) => compute(S),
      inView,
      onTol: Math.max(0.05, span * 0.01),
      point: (V, name) => (names.has(name) ? V[names.get(name)] : null),
      place, fromPositions, positions, ref,
      ptId: (p, what) => ptId(p, what)
    };

    /* measurements */
    const mRaw = raw.measure == null ? (raw.measures == null ? [] : raw.measures) : raw.measure;
    const mList = typeof mRaw === 'string' ? [mRaw] : mRaw;
    if (!Array.isArray(mList)) fail('"measure" must be a list, like ["AB", "angle ACB"]');
    if (mList.length > LIMITS.measures) fail(`"measure": at most ${LIMITS.measures}`);
    const measures = mList.map((m, i) => {
      const src = typeof m === 'string' ? m : isObj(m) ? m.of || m.measure || m.value || m.expr : null;
      if (typeof src !== 'string' || !src.trim()) fail(`"measure" item ${i + 1} must be a text like "angle ACB"`);
      const label = isObj(m) ? txt(m.label, LIMITS.label) : '';
      const ex = expression(txt(src, 80), M, true);
      const v = ex.f(V1);
      if (ex.coords ? !v : !fin(v)) fail(`"measure" ${quote(src)} has no value at the start`);
      return Object.assign(ex, { label, src: txt(src, 80) });
    });
    M.measures = measures;

    function compute(S, used) {
      const V = new Array(nodes.length).fill(null);
      for (const id of order) {
        const n = nodes[id];
        let v = null;
        if (n.deps.every((d) => V[d] != null)) {
          try {
            if (n.op === 'free') { const p = S.p[n.name] || n.at; v = P2(p[0], p[1]); }
            else if (n.op === 'glider') {
              const o = n.ref.get(V);
              if (o) {
                let t = S.t[n.name];
                if (t == null) t = paramOf(o, P2(n.at[0], n.at[1]));
                if (used) used.t[n.name] = t;
                v = pointAt(o, t);
              }
            } else v = n.fn(V);
          } catch (e) { v = null; }
        }
        V[id] = ok(n, v) ? v : null;
      }
      return V;
    }
    function ok(n, v) {
      if (!v) return false;
      if (n.kind === 'pt') return fin(v.x) && fin(v.y) && Math.abs(v.x) < 1e6 && Math.abs(v.y) < 1e6;
      if (n.kind === 'line') return fin(v.x) && fin(v.y) && fin(v.dx) && fin(v.dy) && Math.hypot(v.dx, v.dy) > 1e-12;
      if (n.kind === 'circle') return fin(v.x) && fin(v.y) && fin(v.r) && v.r > 1e-9 && v.r < 1e6;
      if (n.kind === 'poly') return v.pts.every(Boolean);
      return true;
    }
    // a glider's place on its path: t along a line, an angle (radians) on a circle
    function paramOf(o, p) { return o.r != null ? Math.atan2(p.y - o.y, p.x - o.x) : clampT(o, projT(o, p)); }
    function pointAt(o, t) { return o.r != null ? P2(o.x + o.r * Math.cos(t), o.y + o.r * Math.sin(t)) : along(o, clampT(o, t)); }
    const snapTo = (v, s) => r6(Math.round(v / s) * s);
    function clampIn(v, lo, hi, s) {
      if (s) { const a = Math.ceil(lo / s - 1e-9) * s, b = Math.floor(hi / s + 1e-9) * s; return r6(Math.max(a, Math.min(b, v))); }
      return r6(Math.max(lo, Math.min(hi, v)));
    }
    // the part of a line inside the view, as t from .. to
    function tInView(l) {
      let lo = l.lo, hi = l.hi;
      const clip = (p, d, a, b) => {
        if (Math.abs(d) < 1e-12) return p >= a && p <= b;
        let t1 = (a - p) / d, t2 = (b - p) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        lo = Math.max(lo, t1); hi = Math.min(hi, t2);
        return true;
      };
      if (!clip(l.x, l.dx, view.x0, view.x1) || !clip(l.y, l.dy, view.y0, view.y1) || lo > hi) return null;
      return [lo, hi];
    }
    // Put a dragged point at (x, y): on the snap's steps, inside the view; a glider at the nearest place on its path.
    function place(S, name, x, y, snapIt) {
      const id = names.get(name), n = nodes[id];
      if (!n || !n.base) return S;
      const out = { p: Object.assign({}, S.p), t: Object.assign({}, S.t) };
      if (n.op === 'free') {
        let px = x, py = y;
        if (snapIt !== false && snap) { px = snapTo(px, snap); py = snapTo(py, snap); }
        const s = snapIt !== false ? snap : 0;
        out.p[name] = [clampIn(px, view.x0, view.x1, s), clampIn(py, view.y0, view.y1, s)];
        return out;
      }
      const V = compute(S), o = n.ref.get(V);
      if (!o) return S;
      let t = paramOf(o, P2(x, y));
      if (o.r != null) {
        if (snapIt !== false && snap) t = Math.round(t / DEG) * DEG;
      } else {
        if (snapIt !== false && snap) { const step = snap / Math.hypot(o.dx, o.dy); t = Math.round(t / step) * step; }
        const iv = tInView(o);
        t = clampT(o, t);
        if (iv) t = Math.max(iv[0], Math.min(iv[1], t));
      }
      out.t[name] = t;
      return out;
    }
    // The state for these places of the dragged points ({ C: [3, 3] }), each put as a drag would put it.
    // strict (a task's solution): a place the drag can't reach exactly is an error.
    function fromPositions(pos, strict) {
      let S = M.init();
      for (const id of order) {
        const n = nodes[id];
        if (!n.base || !own(pos, n.name)) continue;
        const what = `solution: ${n.name}`;
        if (!drag.includes(n.name)) { if (strict) fail(`${what} is not one of the points the learner drags (${drag.join(', ') || 'none'})`); continue; }
        const p = strict ? xy(pos[n.name], what) : pos[n.name];
        if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) continue;
        const want = P2(p[0], p[1]);
        if (strict && n.op === 'free' && !inView(want)) fail(`${what} at ${pairText(want)} is outside the view (${viewText})`);
        S = place(S, n.name, p[0], p[1], true);
        if (strict) {
          const got = compute(S)[id];
          if (n.op === 'free' && dist(got, want) > 1e-6) fail(`${what} moves in steps of ${num(snap)}, so it can't be at ${pairText(want)}; use a place like ${pairText(got)}`);
          if (n.op === 'glider' && dist(got, want) > M.onTol) fail(`${what} stays on ${n.on}, and ${pairText(want)} is not on it (the nearest place is ${pairText(got)})`);
        }
      }
      return S;
    }
    function positions(S) {
      const V = compute(S), out = {};
      drag.forEach((p) => { const q = V[names.get(p)]; if (q) out[p] = [r6(q.x), r6(q.y)]; });
      return out;
    }

    /* the clean spec */
    const points = {};
    bases.forEach((n) => {
      const extraP = {};
      if (n.on) extraP.on = n.on;
      if (n.style.hidden) extraP.hidden = true;
      if (n.style.color) extraP.color = n.style.color;
      if (n.free && n.op === "free") extraP.free = true;
      points[n.name] = Object.keys(extraP).length ? Object.assign({ at: n.at }, extraP) : n.at;
    });
    const spec = {
      x: [view.x0, view.x1], y: [view.y0, view.y1], grid, axes, snap, unit,
      points, objects: outObjs, drag,
      measure: measures.map((m) => (m.label ? { of: m.src, label: m.label } : m.src))
    };
    return { spec, M };
  }

  function niceStep(raw) {
    if (!(raw > 0) || !fin(raw)) return 1;
    const k = Math.floor(Math.log10(raw)), b = Math.pow(10, k);
    const m = [1, 2, 5, 10].find((q) => raw <= q * b * (1 + 1e-9));
    return r6(m * b);
  }

  /* ---------------- measurements: a little language, read here ---------------- */

  // "angle ACB + AB^2" -> tokens: { t: 'num'|'pts'|'word'|'op', v }
  function lex(src) {
    let s = primes(String(src)).normalize('NFC');
    s = s.replace(/[−–—]/g, '-').replace(/[×·⋅]/g, '*').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3')
      .replace(/m?∠|∡/g, ' angle ').replace(/[△▵]|Δ(?=\s*[A-Z])/g, ' triangle ').replace(/[□▱]/g, ' ')
      .replace(/∥|\|\|/g, ' parallel ').replace(/⊥/g, ' perpendicular ').replace(/≅|≡/g, ' congruent ').replace(/[∼~]/g, ' similar ')
      .replace(/≈|==/g, '=').replace(/≤|=</g, '<=').replace(/≥|=>/g, '>=').replace(/π/g, ' pi ').replace(/°/g, ' ')
      .replace(/\b([xyXY])[\s-]?axis\b/g, (m, a) => ` ${a.toLowerCase()}axis `);
    const out = [];
    const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z][A-Za-z0-9_']*)|(<=|>=|[-+*/^()=<>,]))/y;
    let i = 0;
    while (i < s.length) {
      if (/^\s*$/.test(s.slice(i))) break;
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) fail(`can't read ${quote(src)} at ${quote(s.slice(i).trim().slice(0, 12))}`);
      i = re.lastIndex;
      if (m[1]) out.push({ t: 'num', v: Number(m[1]) });
      else if (m[2]) {
        const w = m[2];
        if (/^[A-Z]/.test(w) && PT_ALL.test(w)) out.push({ t: 'pts', v: w.match(PT_EACH), w });
        else out.push({ t: 'word', v: w.toLowerCase(), w });
      } else out.push({ t: 'op', v: m[3] });
    }
    return out;
  }
  const FILLER = new Set(['the', 'of', 'length', 'distance', 'side', 'segment', 'triangle', 'polygon', 'quadrilateral', 'measure', 'at', 'size']);
  // dimensions: lengths L and angles D, as powers
  const dim = (L, D) => ({ L, D });
  const same = (a, b) => a.L === b.L && a.D === b.D;
  const isNum = (d) => d.L === 0 && d.D === 0;

  // A measurement's expression, read: { f(V) -> number, dim, show(W), coords? }. top: a single point's
  // name means its coordinates.
  function expression(src, M, top) {
    const toks = lex(src);
    if (!toks.length) fail(`measure ${quote(src)} is empty`);
    let i = 0;
    const peek = () => toks[i], next = () => toks[i++];
    const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
    const what = `measure ${quote(src)}`;
    if (top && toks.length === 1 && toks[0].t === 'pts' && toks[0].v.length === 1) {
      const id = M.ptId(toks[0].v[0], what);
      return { coords: true, dim: dim(1, 0), f: (V) => (V[id] ? [V[id].x, V[id].y] : null), show: () => toks[0].v[0], text: toks[0].v[0] };
    }
    const e = sum();
    if (i < toks.length) fail(`${what}: can't read it from ${quote(toks.slice(i).map((t) => t.w || t.v).join(' '))}`);
    return Object.assign(e, { text: src });

    function sum() {
      let a = prod();
      while (isOp('+') || isOp('-')) {
        const op = next().v, b = prod();
        let d = a.dim;
        if (!same(a.dim, b.dim)) { if (b.lit) d = a.dim; else if (a.lit) d = b.dim; else fail(`${what}: can't add or take ${kindOf(b.dim)} and ${kindOf(a.dim)}`); }
        const fa = a.f, fb = b.f, sa = a.show, sb = b.show;
        a = { dim: d, f: op === '+' ? (V) => fa(V) + fb(V) : (V) => fa(V) - fb(V), show: (W) => `${sa(W)} ${op === '+' ? '+' : '−'} ${b.prec < 2 && op === '-' ? `(${sb(W)})` : sb(W)}`, prec: 1 };
      }
      return a;
    }
    function prod() {
      let a = power();
      for (;;) {
        let op;
        if (isOp('*') || isOp('/')) op = next().v;
        else if (a.lit && peek() && (peek().t === 'pts' || peek().t === 'word' || isOp('('))) op = '*'; // 2AB, 2 angle A
        else break;
        const b = power();
        const fa = a.f, fb = b.f, sa = a.show, sb = b.show;
        const d = op === '*' ? dim(a.dim.L + b.dim.L, a.dim.D + b.dim.D) : dim(a.dim.L - b.dim.L, a.dim.D - b.dim.D);
        const wrap = (s, x) => (x.prec < 2 ? `(${s})` : s);
        a = {
          dim: d, lit: a.lit && b.lit,
          f: op === '*' ? (V) => fa(V) * fb(V) : (V) => { const q = fb(V); return Math.abs(q) < 1e-12 ? NaN : fa(V) / q; },
          show: (W) => (op === '*' ? `${wrap(sa(W), a)} × ${wrap(sb(W), b)}` : `${wrap(sa(W), a)}/${b.prec < 3 ? `(${sb(W)})` : sb(W)}`),
          prec: 2
        };
      }
      return a;
    }
    function power() {
      const a = unary();
      if (!isOp('^')) return a;
      next();
      const t = next();
      if (!t || t.t !== 'num' || t.v < 0 || t.v > 3) fail(`${what}: a power must be 2 or 3 (like AB^2)`);
      const k = t.v, fa = a.f, sa = a.show;
      const sup = { 2: '²', 3: '³' }[k] || `^${k}`;
      return { dim: dim(a.dim.L * k, a.dim.D * k), lit: a.lit, f: (V) => Math.pow(fa(V), k), show: (W) => (a.prec < 3 ? `(${sa(W)})${sup}` : `${sa(W)}${sup}`), prec: 3 };
    }
    function unary() {
      if (isOp('-')) { next(); const a = unary(); const fa = a.f, sa = a.show; return { dim: a.dim, lit: a.lit, f: (V) => -fa(V), show: (W) => `−${sa(W)}`, prec: 2 }; }
      if (isOp('+')) { next(); return unary(); }
      return primary();
    }
    function primary() {
      const t = next();
      if (!t) fail(`${what}: something is missing at the end`);
      if (t.t === 'num') { const v = t.v; return { dim: dim(0, 0), lit: true, f: () => v, show: (W) => (W && W.num ? W.num(v) : String(v)), prec: 4 }; }
      if (t.t === 'op' && t.v === '(') { const e = sum(); if (!isOp(')')) fail(`${what}: a bracket is not closed`); next(); return Object.assign({}, e, { prec: 4 }); }
      if (t.t === 'pts') {
        if (t.v.length === 2) {
          const [a, b] = t.v.map((p) => M.ptId(p, what));
          return { dim: dim(1, 0), f: (V) => (V[a] && V[b] ? dist(V[a], V[b]) : NaN), show: () => t.v.join(''), prec: 4 };
        }
        if (t.v.length === 1) fail(`${what}: ${t.v[0]} alone is a point; say "x ${t.v[0]}", or measure a length like "${t.v[0]}B"`);
        fail(`${what}: ${t.w} is ${t.v.length} points; say "angle ${t.w}", "area ${t.w}" or "perimeter ${t.w}"`);
      }
      if (t.t === 'word') {
        const w = t.v;
        if (FILLER.has(w)) return primary();
        if (w === 'pi') return { dim: dim(0, 0), lit: true, f: () => Math.PI, show: () => 'π', prec: 4 };
        if (w === 'angle') return angle();
        if (w === 'area' || w === 'perimeter') return shape(w);
        if (w === 'radius' || w === 'diameter' || w === 'circumference') { const c = circle(); return round(w, c); }
        if (w === 'x' || w === 'y') {
          skip();
          const p = next();
          if (!p || p.t !== 'pts' || p.v.length !== 1) fail(`${what}: "${w}" must be followed by a point, like "${w} A"`);
          const id = M.ptId(p.v[0], what), k = w;
          return { dim: dim(1, 0), f: (V) => (V[id] ? V[id][k] : NaN), show: () => `${k}(${p.v[0]})`, prec: 4 };
        }
        fail(`${what}: can't read ${quote(t.w)}; measure lengths ("AB"), angles ("angle ACB"), "area ABC", "perimeter ABCD" or "radius c"`);
      }
      fail(`${what}: can't read ${quote(t.v)} there`);
    }
    function skip() { while (peek() && peek().t === 'word' && FILLER.has(peek().v)) next(); }
    function angle() {
      skip();
      const p = next();
      if (!p || p.t !== 'pts') fail(`${what}: "angle" must be followed by three points, like "angle ACB"`);
      let three = p.v, short = '';
      if (three.length === 1) {
        // a polygon's angle at that vertex, or a marked angle there
        const v = three[0];
        M.ptId(v, what);
        const poly = M.nodes.find((n) => n.kind === 'poly' && n.of.includes(v) && !n.what.startsWith('the image'));
        const mark = M.nodes.find((n) => n.op === 'angle' && n.at === v);
        if (poly) { const k = poly.of.indexOf(v), m = poly.of.length; three = [poly.of[(k + m - 1) % m], v, poly.of[(k + 1) % m]]; }
        else if (mark) three = [mark.from, v, mark.to];
        else fail(`${what}: say which angle at ${v}, like "angle B${v}C" (${v} is in no polygon)`);
        short = v;
      } else if (three.length !== 3) fail(`${what}: an angle is named by three points, like "angle ACB"`);
      if (new Set(three).size < 3) fail(`${what}: an angle needs three different points`);
      const [a, v, b] = three.map((q) => M.ptId(q, what));
      const label = short || three.join('');
      return { dim: dim(0, 1), f: (V) => (V[v] && V[a] && V[b] ? angleAt(V[v], V[a], V[b]) : NaN), show: () => `∠${label}`, prec: 4, angle: three };
    }
    function circle() {
      skip();
      const p = next();
      if (!p) fail(`${what}: name the circle, like "radius c"`);
      let r;
      if (p.t === 'word' && p.v === 'circle') {
        const q = next();
        if (!q) fail(`${what}: name the circle, like "radius c"`);
        r = M.ref(`circle ${q.w || q.v}`, what, 'circle');
      } else if (p.t === 'pts' && p.v.length === 1) r = M.ref(`circle ${p.v[0]}`, what, 'circle');
      else r = M.ref(p.w || String(p.v), what, 'circle');
      return r;
    }
    function round(w, r) {
      const k = { radius: 1, diameter: 2, circumference: 2 * Math.PI }[w];
      return { dim: dim(1, 0), f: (V) => { const c = r.get(V); return c ? c.r * k : NaN; }, show: (W) => (W && W[w] ? W[w](r.text) : `${w} ${r.text}`), prec: 4 };
    }
    function shape(w) {
      skip();
      const p = peek();
      if (p && p.t === 'pts' && p.v.length >= 3) {
        next();
        const ids = p.v.map((q) => M.ptId(q, what));
        const label = p.v.join('');
        if (w === 'area') return { dim: dim(2, 0), f: (V) => (ids.every((i) => V[i]) ? areaOf(ids.map((i) => V[i])) : NaN), show: (W) => (W && W.area ? W.area(label) : `area ${label}`), prec: 4 };
        return { dim: dim(1, 0), f: (V) => (ids.every((i) => V[i]) ? perimeterOf(ids.map((i) => V[i])) : NaN), show: (W) => (W && W.perimeter ? W.perimeter(label) : `perimeter ${label}`), prec: 4 };
      }
      const r = circle();
      if (w === 'perimeter') return round('circumference', r);
      return { dim: dim(2, 0), f: (V) => { const c = r.get(V); return c ? Math.PI * c.r * c.r : NaN; }, show: (W) => (W && W.area ? W.area(r.text) : `area ${r.text}`), prec: 4 };
    }
  }
  const kindOf = (d) => (d.D === 1 && d.L === 0 ? 'an angle' : d.L === 1 && d.D === 0 ? 'a length' : d.L === 2 && d.D === 0 ? 'an area' : isNum(d) ? 'a number' : 'that');
  // how a value is shown: angles in degrees, lengths with the unit
  function unitOf(d, unit) {
    if (d.D === 1 && d.L === 0) return '°';
    if (d.D === 0 && d.L === 1 && unit) return ' ' + unit;
    if (d.D === 0 && d.L === 2 && unit) return ' ' + unit + '²';
    return '';
  }
  const placesFor = (d) => (d.D === 1 && d.L === 0 ? 1 : 2);
  function fmt(v, d) {
    if (!fin(v)) return '—';
    let r = Number(v.toFixed(d == null ? 2 : d));
    if (r === 0) r = 0;
    return String(r).replace('-', '−');
  }
  const showValue = (v, d, unit) => (fin(v) ? fmt(v, placesFor(d)) + unitOf(d, unit) : '—');

  /* ---------------- conditions ---------------- */

  const SHAPES3 = new Set(['isosceles', 'equilateral', 'right', 'scalene', 'acute', 'obtuse']);
  const SHAPES4 = new Set(['parallelogram', 'rectangle', 'rhombus', 'square', 'trapezium', 'kite', 'cyclic']);
  const SHAPE_ALIAS = { 'right angled': 'right', 'right-angled': 'right', rightangled: 'right', trapezoid: 'trapezium', concyclic: 'concyclic', isoceles: 'isosceles' };
  const SKIP_WORDS = new Set(['is', 'are', 'a', 'an', 'the', 'lies', 'lie', 'must', 'be', 'triangle', 'quadrilateral', 'make', 'so', 'that', 'point', 'line', 'segment', 'and', 'to', 'with', 'now']);

  // A goal's condition, read: { kind, text, test(V, tol) -> { ok, ... }, show(W) }
  function condition(src, M) {
    if (typeof src !== 'string' || !src.trim()) fail('a condition must be a text like "angle ACB = 90"');
    const text = txt(src, 100);
    const toks = lex(text);
    const what = `condition ${quote(text)}`;
    // a comparison: two measurements, or one and a number
    const opAt = toks.findIndex((t) => t.t === 'op' && ['=', '<', '>', '<=', '>='].includes(t.v));
    if (opAt >= 0) {
      const op = toks[opAt].v;
      const left = text.split(/<=|>=|=|<|>|≤|≥|≈/)[0];
      const right = text.slice(left.length).replace(/^\s*(<=|>=|==|=<|=>|=|<|>|≤|≥|≈)/, '');
      const a = expression(left.trim(), M), b = expression(right.trim(), M);
      if (!same(a.dim, b.dim) && !b.lit && !a.lit) fail(`${what}: one side is ${kindOf(a.dim)} and the other ${kindOf(b.dim)}`);
      const d = b.lit ? a.dim : a.dim.L === 0 && a.dim.D === 0 && a.lit ? b.dim : a.dim;
      if (a.lit && b.lit) fail(`${what}: it must measure something in the figure`);
      return {
        kind: 'cmp', text, op, a, b, dim: d,
        test(V, tol) {
          const va = a.f(V), vb = b.f(V);
          if (!fin(va) || !fin(vb)) return { ok: false, missing: true };
          const tl = tol != null ? tol : d.D === 1 && d.L === 0 ? ANG : Math.max(REL * Math.max(Math.abs(va), Math.abs(vb)), 1e-3);
          const ok = op === '=' ? Math.abs(va - vb) <= tl : op === '<' ? va < vb : op === '>' ? va > vb : op === '<=' ? va <= vb + tl : va >= vb - tl;
          return { ok, va, vb };
        },
        show: (W) => `${a.show(W)} ${{ '=': '=', '<': '<', '>': '>', '<=': '≤', '>=': '≥' }[op]} ${b.lit ? showValue(b.f([]), d, M.unit) : b.show(W)}`
      };
    }
    const words = toks.filter((t) => !(t.t === 'word' && SKIP_WORDS.has(t.v)) && !(t.t === 'op' && t.v === ','));
    // merge "A, B, C" into one list of points
    const merged = [];
    words.forEach((t) => { const last = merged[merged.length - 1]; if (t.t === 'pts' && last && last.t === 'pts') merged[merged.length - 1] = { t: 'pts', v: last.v.concat(t.v), w: last.w + t.w }; else merged.push(t); });
    const kw = merged.findIndex((t) => t.t === 'word' && ['on', 'parallel', 'perpendicular', 'congruent', 'similar', 'collinear', 'concyclic'].concat([...SHAPES3, ...SHAPES4], Object.keys(SHAPE_ALIAS)).includes(t.v));
    if (kw < 0) fail(`can't read the ${what}; write it like "angle ACB = 90", "AB = AC", "P on c", "AB parallel CD", "ABC isosceles" or "ABCD parallelogram"`);
    const k = SHAPE_ALIAS[merged[kw].v] || merged[kw].v;
    const before = merged.slice(0, kw), after = merged.slice(kw + 1);
    const refOf = (ts) => {
      if (ts.length === 1) return M.ref(ts[0].w || ts[0].v, what);
      if (ts.length === 2 && ts[0].t === 'word' && ts[0].v === 'circle') return M.ref(`circle ${ts[1].w || ts[1].v}`, what, 'circle');
      if (ts.length === 1 && ts[0].t === 'word') return M.ref(ts[0].w, what);
      fail(`${what}: name a line or circle, like "AB" or "c"`);
    };
    const ptsOf = (ts, n) => {
      if (ts.length !== 1 || ts[0].t !== 'pts' || (n && ts[0].v.length !== n)) fail(`${what}: give ${n ? n + ' ' : ''}points, like "${'ABCD'.slice(0, n || 3)}"`);
      return ts[0].v.map((p) => { M.ptId(p, what); return p; });
    };
    const P = (V, p) => M.point(V, p);
    const onTol = M.onTol;
    if (k === 'on') {
      const [p] = ptsOf(before, 1), r = refOf(after);
      return { kind: 'on', text, p, r, test(V, tol) { const q = P(V, p), o = r.get(V); if (!q || !o) return { ok: false, missing: true }; const d = distTo(q, o); return { ok: d <= (tol != null ? tol : onTol), d }; }, show: () => `${p} ∈ ${r.text}` };
    }
    if (k === 'parallel' || k === 'perpendicular') {
      const r1 = refOf(before), r2 = refOf(after);
      if (r1.kind !== 'line' || r2.kind !== 'line') fail(`${what}: both must be lines, like "AB ${k} CD"`);
      return {
        kind: k, text, r1, r2,
        test(V, tol) { const a = r1.get(V), b = r2.get(V); if (!a || !b) return { ok: false, missing: true }; const deg = between(a, b), tl = tol != null ? tol : ANG; return { ok: k === 'parallel' ? deg <= tl : Math.abs(90 - deg) <= tl, deg }; },
        show: () => `${r1.text} ${k === 'parallel' ? '∥' : '⊥'} ${r2.text}`
      };
    }
    if (k === 'congruent' || k === 'similar') {
      const p1 = ptsOf(before, 0), p2 = ptsOf(after, 0);
      if (p1.length !== p2.length || p1.length < 3 || p1.length > 6) fail(`${what}: name two shapes with the same number of corners, like "ABC ${k} DEF"`);
      return {
        kind: k, text, p1, p2,
        test(V, tol) {
          const a = p1.map((p) => P(V, p)), b = p2.map((p) => P(V, p));
          if (!a.every(Boolean) || !b.every(Boolean)) return { ok: false, missing: true };
          const sides = (q) => q.map((x, i) => dist(x, q[(i + 1) % q.length])), angs = (q) => q.map((x, i) => angleAt(x, q[(i + q.length - 1) % q.length], q[(i + 1) % q.length]));
          const sa = sides(a), sb = sides(b), aa = angs(a), ab = angs(b);
          if (areaOf(a) < 1e-6 || areaOf(b) < 1e-6) return { ok: false, flat: true, sa, sb, aa, ab };
          const tl = tol != null ? tol : ANG;
          const angOk = aa.every((x, i) => Math.abs(x - ab[i]) <= tl);
          if (k === 'similar') { const ratio = sb[0] / sa[0]; return { ok: angOk && sa.every((x, i) => Math.abs(sb[i] - ratio * x) <= REL * sb[i] + 1e-3), sa, sb, aa, ab }; }
          return { ok: angOk && sa.every((x, i) => Math.abs(x - sb[i]) <= REL * Math.max(x, sb[i]) + 1e-3), sa, sb, aa, ab };
        },
        show: () => `${p1.join('')} ${k === 'congruent' ? '≅' : '∼'} ${p2.join('')}`
      };
    }
    if (k === 'collinear' || k === 'concyclic') {
      const pts = ptsOf(before.length ? before : after, 0);
      if (pts.length < (k === 'collinear' ? 3 : 4)) fail(`${what}: give at least ${k === 'collinear' ? 3 : 4} points`);
      return {
        kind: k, text, pts,
        test(V, tol) {
          const q = pts.map((p) => P(V, p));
          if (!q.every(Boolean)) return { ok: false, missing: true };
          const tl = tol != null ? tol : onTol;
          if (k === 'collinear') {
            let a = q[0], b = q[1], far = -1;
            q.forEach((x) => q.forEach((y) => { const d = dist(x, y); if (d > far) { far = d; a = x; b = y; } }));
            const l = lineOf(a, b, -INF, INF);
            if (!l) return { ok: true };
            return { ok: q.every((x) => distTo(x, l) <= tl) };
          }
          const o = circumcentre(q[0], q[1], q[2]);
          if (!o) return { ok: false };
          const r = dist(o, q[0]);
          return { ok: q.every((x) => Math.abs(dist(o, x) - r) <= Math.max(tl, REL * r)) };
        },
        show: () => pts.join(', ')
      };
    }
    // a shape's kind
    const tri = SHAPES3.has(k);
    const pts = ptsOf(before.length ? before : after, tri ? 3 : 4);
    return {
      kind: 'shape', shape: k, text, pts,
      test(V, tol) {
        const q = pts.map((p) => P(V, p));
        if (!q.every(Boolean)) return { ok: false, missing: true };
        const n = q.length, sides = q.map((x, i) => dist(x, q[(i + 1) % n]));
        const angs = q.map((x, i) => angleAt(x, q[(i + n - 1) % n], q[(i + 1) % n]));
        const eq = (a, b) => Math.abs(a - b) <= (tol != null ? tol : REL * Math.max(a, b) + 1e-3);
        const tl = tol != null ? tol : ANG;
        const per = sides.reduce((s, x) => s + x, 0);
        const info = { sides, angs };
        if (areaOf(q) < 1e-3 * per * per / 16 || angs.some((a) => !fin(a))) return Object.assign({ ok: false, flat: true }, info);
        if (tri) {
          const [c, a, b] = [sides[0], sides[1], sides[2]];
          const pairs = [eq(a, b), eq(b, c), eq(c, a)];
          const ok = { isosceles: pairs.some(Boolean), equilateral: pairs.every(Boolean), scalene: !pairs.some(Boolean),
            right: angs.some((x) => Math.abs(x - 90) <= tl), acute: angs.every((x) => x < 90 - tl / 2), obtuse: angs.some((x) => x > 90 + tl / 2) }[k];
          return Object.assign({ ok }, info);
        }
        // a quadrilateral: simple and convex, unless a kite
        const cross = q.map((x, i) => { const y = q[(i + 1) % n], z = q[(i + 2) % n]; return (y.x - x.x) * (z.y - y.y) - (y.y - x.y) * (z.x - y.x); });
        const convex = cross.every((c) => c > 0) || cross.every((c) => c < 0);
        const L = (i, j) => lineOf(q[i], q[j], -INF, INF);
        const par = (i, j, k2, l) => between(L(i, j), L(k2, l)) <= tl;
        const pg = convex && par(0, 1, 3, 2) && par(0, 3, 1, 2);
        const right = Math.abs(angs[0] - 90) <= tl;
        const rh = eq(sides[0], sides[1]);
        let ok;
        if (k === 'parallelogram') ok = pg;
        else if (k === 'rectangle') ok = pg && right;
        else if (k === 'rhombus') ok = pg && rh;
        else if (k === 'square') ok = pg && right && rh;
        else if (k === 'trapezium') ok = convex && (par(0, 1, 3, 2) || par(0, 3, 1, 2));
        else if (k === 'kite') ok = (eq(sides[0], sides[3]) && eq(sides[1], sides[2])) || (eq(sides[0], sides[1]) && eq(sides[2], sides[3]));
        else { const o = circumcentre(q[0], q[1], q[2]); ok = convex && Boolean(o) && Math.abs(dist(o, q[3]) - dist(o, q[0])) <= Math.max(onTol, REL * dist(o, q[0])); }
        return Object.assign({ ok, convex }, info);
      },
      show: () => pts.join('')
    };
  }

  // Why a condition fails, in a sentence for the AI (the page says it in the learner's language)
  function whyNot(c, r, unit) {
    if (r.missing) return `${c.text} can't be measured (part of the figure isn't there)`;
    if (c.kind === 'cmp') {
      const v = (x) => showValue(x, c.dim, unit).replace(/−/g, '-');
      if (c.b.lit) return `${c.a.text} is ${v(r.va)}, not ${c.op === '=' ? '' : c.op + ' '}${v(r.vb)}`;
      return `${c.a.text} is ${v(r.va)} and ${c.b.text} is ${v(r.vb)}${c.op === '=' ? ', not equal' : ''}`;
    }
    if (c.kind === 'on') return `${c.p} is ${num(r.d)} away from ${c.r.text}`;
    if (c.kind === 'parallel') return `${c.r1.text} and ${c.r2.text} meet at ${num(r.deg)}°`;
    if (c.kind === 'perpendicular') return `${c.r1.text} and ${c.r2.text} meet at ${num(r.deg)}°, not 90°`;
    if (c.kind === 'congruent' || c.kind === 'similar') return `${c.p1.join('')} has sides ${r.sa.map(num).join(', ')} and angles ${r.aa.map((x) => num(x) + '°').join(', ')}; ${c.p2.join('')} has sides ${r.sb.map(num).join(', ')} and angles ${r.ab.map((x) => num(x) + '°').join(', ')}`;
    if (c.kind === 'collinear') return `${c.pts.join(', ')} are not in a line`;
    if (c.kind === 'concyclic') return `${c.pts.join(', ')} are not on one circle`;
    if (r.flat) return `${c.pts.join('')} is flat (its corners are in a line)`;
    return `${c.pts.join('')} is not ${/^[aeiou]/.test(c.shape) ? 'an' : 'a'} ${c.shape} (sides ${r.sides.map(num).join(', ')}; angles ${r.angs.map((x) => num(x) + '°').join(', ')})`;
  }

  /* ---------------- the public face ---------------- */

  function cleanSpec(raw, opts) { return build(raw, opts).spec; }
  // the model for an already clean spec (or any spec: it is checked again)
  const models = typeof WeakMap === 'function' ? new WeakMap() : null;
  function model(spec) {
    if (models && isObj(spec) && models.has(spec)) return models.get(spec);
    const m = build(spec).M;
    if (models && isObj(spec)) models.set(spec, m);
    return m;
  }
  function readGoal(raw, M) {
    if (!isObj(raw)) fail('the goal must be an object like {"all": ["angle ACB = 90"], "solution": {"C": [3, 3]}}');
    let conds = raw.all || raw.conditions || raw.condition || raw.when || raw.check || raw.make;
    if (typeof conds === 'string') conds = [conds];
    if (!Array.isArray(conds) || !conds.length) fail('the goal needs "all": a list of 1 to 4 conditions, like ["angle ACB = 90"]');
    if (conds.length > LIMITS.conditions) fail(`the goal has too many conditions (at most ${LIMITS.conditions})`);
    const C = conds.map((c) => condition(c, M));
    const tol = raw.tol != null ? numberIn(raw.tol, 0.001, 5, 'the goal\'s "tol"') : null;
    return { C, tol };
  }
  const solutionOf = (raw) => raw && (raw.solution || raw.answer || raw.example || raw.at);

  // A task's goal, checked against its (clean) spec: every condition reads, the start doesn't meet them,
  // and the example solution does. Returns the clean goal.
  function cleanGoal(raw, spec) {
    const M = model(spec);
    const { C, tol } = readGoal(raw, M);
    const sol = solutionOf(raw);
    if (!isObj(sol) || !Object.keys(sol).length) fail(`the goal needs "solution": where the dragged points go to meet it, like {"${M.drag[0] || 'C'}": [3, 3]}`);
    if (!M.drag.length) fail('a task needs a point to drag: list it in "drag"');
    Object.keys(sol).forEach((k) => {
      const p = pointName(k);
      if (!p || !M.names.has(p)) fail(`solution: there is no point ${quote(k)}`);
      if (!M.drag.includes(p)) fail(`solution: ${p} is not one of the points the learner drags (${M.drag.join(', ')})`);
    });
    const S1 = M.fromPositions(sol, true);
    const V0 = M.compute(M.init()), V1 = M.compute(S1);
    const r0 = C.map((c) => c.test(V0, tol));
    if (r0.every((r) => r.ok)) fail(`the start already meets the goal (${C.map((c) => c.text).join('; ')}); start the dragged points somewhere else`);
    const r1 = C.map((c) => c.test(V1, tol));
    const bad = r1.findIndex((r) => !r.ok);
    const where = Object.keys(sol).map((p) => { const q = M.point(V1, p); return `${p} at ${q ? pairText(q) : '?'}`; }).join(', ');
    if (bad >= 0) fail(`the example solution puts ${where}, where ${whyNot(C[bad], r1[bad], M.unit)}`);
    for (const p of Object.keys(sol)) if (!M.inView(M.point(V1, p))) fail(`the example solution puts ${p} outside the view`);
    const solution = {};
    M.drag.forEach((p) => { if (own(sol, p)) { const q = M.point(V1, p); solution[p] = [r6(q.x), r6(q.y)]; } });
    return Object.assign({ all: C.map((c) => c.text), solution }, tol != null ? { tol } : {});
  }

  // The learner's attempt, checked: { correct, invalid?, fail?: { cond, r } } (the first condition not met)
  function check(spec, goal, value) {
    if (!isObj(value) || !Object.keys(value).length) return { correct: false, invalid: true };
    const M = model(spec);
    const { C, tol } = readGoal(goal, M);
    const pos = {};
    Object.keys(value).forEach((k) => { const v = value[k]; if (M.drag.includes(k) && Array.isArray(v) && fin(v[0]) && fin(v[1])) pos[k] = [v[0], v[1]]; });
    if (!Object.keys(pos).length) return { correct: false, invalid: true };
    const V = M.compute(M.fromPositions(pos, false));
    for (const c of C) {
      const r = c.test(V, tol);
      if (!r.ok) return { correct: false, fail: { cond: c, r } };
    }
    return { correct: true };
  }
  // the conditions read, for saying them (answer) and checking them live
  const conditions = (goal, spec) => readGoal(goal, model(spec));

  return {
    LIMITS, PALETTE, ANG, REL, GeoError,
    cleanSpec, cleanGoal, model, check, conditions, whyNot, expression,
    fmt, showValue, unitOf, placesFor, kindOf, niceStep,
    // the shapes' sums, for the page's drawing and for tests
    geo: { dist, angleAt, areaOf, perimeterOf, meet, meetLL, meetLC, meetCC, circumcentre, foot, touch, between, distTo, along, X_AXIS, Y_AXIS }
  };
});
