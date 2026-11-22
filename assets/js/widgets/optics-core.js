/* =====================================================================
   Light and optics in lessons: the physics and the checks, shared by the
   server (server/widgets/optics.mjs checks every bench the AI writes, and
   that each task can be done) and the page (assets/js/widgets/optics.js
   draws it live and checks the learner's tasks). The server imports this
   file; the page loads it with a script element (window.PrimerOptics).

   Signs: the New Cartesian convention (NCERT). Light travels from left
   to right; distances are measured from the optical centre O of a lens or
   the pole P of a mirror, positive along the light and negative against
   it; heights are positive above the principal axis. A real object is on
   the left, so u < 0. Distances are in cm, angles in degrees.
     lens    1/v − 1/u = 1/f    m = v/u     convex f > 0, concave f < 0
     mirror  1/v + 1/u = 1/f    m = −v/u    concave f < 0, convex f > 0;
                                            plane: v = −u, m = +1
   An object at F sends the light out parallel: the image is at infinity.

   A bench (the "spec"), after normSpec:
     { mode: "lens" | "mirror", kind: "convex" | "concave" | "plane",
       f (signed; null for a plane mirror),
       object: { u, h, look: "arrow" | "candle" },
       drag: ["object", "height"], sliders: ["u", "f", "h"],
       range: { u: [lo, hi], f?: [lo, hi] (sizes), h?: [lo, hi] },
       step: { u, f?, h? }, record }
     every value the learner can reach is a whole number of steps
   Refraction, after normSpec:
     { mode: "refraction", shape: "boundary" | "slab" | "prism",
       from, to: { key, n, name? }, angle, turn, range: [lo, hi], step,
       media?: [medium...] (the learner picks "to" among them),
       thickness? (slab, cm), apex?, white? (prism: dispersion) }
   A task's goal, after normGoal:
     { type: "image", nature?, orientation?, size?, infinity?,
       u?, v?, f?, m?, h?, hi?, tol? }
     { type: "ray", tir?, critical?, minimum?, i?, r?, e?, deviation?,
       shift?, tol? }
     a number is a value to reach (within tol), [lo, hi] a range.
   The learner's attempt ("value"): { u, f, h } or { i, m? } (m: which of
   the media, by its place in the list).

   Refraction is traced as rays (Snell's law in vector form, Fresnel for
   how much is reflected), through a boundary, a parallel-sided slab or a
   prism; a white beam through a prism is traced once per colour.
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerOptics = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const LIMITS = { u: 200, f: [1, 100], h: [0.1, 50], n: [1, 3], positions: 400, angles: 900, combos: 60000, media: 6, thickness: [1, 20], apex: [20, 90], name: 24 };
  const DEG = Math.PI / 180;

  class OpticsError extends Error {}
  const fail = (msg) => { throw new OpticsError(msg); };
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k) && o[k] != null;
  const fin = Number.isFinite;
  const r6 = (x) => Math.round(x * 1e6) / 1e6 || 0; // never -0
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lc = (v) => (typeof v === 'string' ? v.normalize('NFKC').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() : '');

  // a number from the AI: 25, -25, "−25", "25 cm", "30°"
  function num(v) {
    if (typeof v === 'number') return fin(v) ? v : NaN;
    if (typeof v !== 'string') return NaN;
    const s = v.replace(/[−–—]/g, '-').replace(/\s*(cm|°|deg|degrees?)\s*$/i, '').trim();
    return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? Number(s) : NaN;
  }
  const first = (o, keys) => { for (const k of keys) if (has(o, k)) return o[k]; return undefined; };
  // words from the AI, for the drawing: no control or direction-changing characters, no markup, short
  function txt(v, max) {
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  function bool(v, dflt) {
    if (v == null) return dflt;
    if (typeof v === 'boolean') return v;
    const s = lc(String(v));
    if (['true', 'yes', '1', 'on'].includes(s)) return true;
    if (['false', 'no', '0', 'off', ''].includes(s)) return false;
    return dflt;
  }

  // a number as a textbook writes it: at most d decimals, none trailing; signed: a + before positives
  function fmt(x, d, signed, minus) {
    d = d == null ? 1 : d;
    minus = minus || '−';
    if (x === Infinity) return '∞';
    if (x === -Infinity) return minus + '∞';
    if (!fin(x)) return '';
    let s = Number(x.toFixed(d));
    if (s === 0) s = 0;
    return (s < 0 ? minus : signed && s > 0 ? '+' : '') + String(Math.abs(s));
  }
  const say = (x, d) => fmt(x, d == null ? 2 : d, true, '-');       // for the AI: plain hyphens
  const sayA = (x, d) => fmt(x, d == null ? 1 : d, false, '-') + '°';

  // the grid of values a control reaches: whole numbers of steps
  const ceilTo = (x, s) => r6(Math.ceil(x / s - 1e-9) * s);
  const floorTo = (x, s) => r6(Math.floor(x / s + 1e-9) * s);
  const snapTo = (x, s) => r6(Math.round(x / s) * s);
  const onGrid = (x, s) => Math.abs(x / s - Math.round(x / s)) < 1e-6;
  function grid(range, step) {
    const out = [];
    const n = Math.round((range[1] - range[0]) / step);
    for (let k = 0; k <= n; k++) out.push(r6(range[0] + k * step));
    return out;
  }
  function pair(v, what) {
    if (!Array.isArray(v) || v.length !== 2) fail(`${what} is [low, high], two numbers`);
    const a = num(v[0]), b = num(v[1]);
    if (!fin(a) || !fin(b)) fail(`${what} is [low, high], two numbers`);
    return [a, b];
  }
  function stepOf(v, dflt, lo, hi, what) {
    if (v == null) return dflt;
    const s = num(v);
    if (!(s >= lo && s <= hi)) fail(`${what} must be from ${lo} to ${hi}`);
    return r6(s);
  }

  /* ---------------- media ---------------- */

  // refractive indices, from NCERT's table (air is 1.0003 there; 1 here, as in its sums)
  const MEDIA = {
    air: 1, vacuum: 1, ice: 1.31, water: 1.33, alcohol: 1.36, kerosene: 1.44, quartz: 1.46, turpentine: 1.47, benzene: 1.5,
    glass: 1.5, 'crown glass': 1.52, 'canada balsam': 1.53, 'rock salt': 1.54, 'carbon disulphide': 1.63, 'flint glass': 1.65,
    ruby: 1.71, sapphire: 1.77, diamond: 2.42
  };
  const MEDIUM_ALIASES = {
    'fused quartz': 'quartz', 'turpentine oil': 'turpentine', 'dense flint glass': 'flint glass', flint: 'flint glass', crown: 'crown glass',
    'carbon disulfide': 'carbon disulphide', ethanol: 'alcohol', 'ethyl alcohol': 'alcohol', paraffin: 'kerosene', 'paraffin oil': 'kerosene',
    'glass slab': 'glass', 'glass block': 'glass', 'ordinary glass': 'glass', 'common glass': 'glass', space: 'vacuum', 'free space': 'vacuum'
  };
  const mediumKey = (name) => {
    const s = lc(name).replace(/\s*\(.*\)\s*$/, '');
    return MEDIA[s] != null ? s : MEDIUM_ALIASES[s] || '';
  };
  const NAMES = Object.keys(MEDIA).filter((k) => k !== 'vacuum').join(', ');
  function checkN(n, what) {
    if (!(n >= LIMITS.n[0] && n <= LIMITS.n[1])) fail(`${what}: a refractive index must be from ${LIMITS.n[0]} to ${LIMITS.n[1]} (it is ${n})`);
    return Math.round(n * 1000) / 1000;
  }
  function medium(v, what) {
    if (typeof v === 'number' || (typeof v === 'string' && fin(num(v)))) return { key: 'custom', n: checkN(num(v), what) };
    if (typeof v === 'string') {
      const key = mediumKey(v);
      if (!key) fail(`${what}: unknown medium "${txt(v, 30)}"; use ${NAMES}, or {"n": 1.6, "name": "${txt(v, 20) || 'plastic'}"}`);
      return { key, n: MEDIA[key] };
    }
    if (isObj(v)) {
      const name = txt(first(v, ['name', 'medium', 'label']) || '', LIMITS.name);
      const nRaw = first(v, ['n', 'index', 'mu']);
      // a medium already checked ({"key": "water", "n": 1.33}) keeps its key
      const key = typeof v.key === 'string' && v.key !== 'custom' ? mediumKey(v.key) : mediumKey(name);
      if (nRaw == null) {
        if (key) return { key, n: MEDIA[key] };
        fail(`${what}: give the medium's refractive index, {"n": 1.6, "name": "${name || 'plastic'}"}`);
      }
      const n = checkN(num(nRaw), what);
      if (key) return { key, n };
      return name ? { key: 'custom', n, name } : { key: 'custom', n };
    }
    fail(`${what}: give a medium's name (${NAMES}) or {"n": 1.6, "name": "plastic"}`);
  }
  const sameMedium = (a, b) => a.key === b.key && a.n === b.n && (a.name || '') === (b.name || '');
  const mediumWords = (m) => `${m.key === 'custom' ? m.name || 'a medium' : m.key} (n = ${m.n})`;

  /* ---------------- the bench: a lens or a mirror ---------------- */

  function kindOf(raw) {
    const words = [raw.mode, raw.kind, raw.type, raw.element, raw.lens, raw.mirror].map((v) => lc(typeof v === 'string' ? v : '')).filter(Boolean).join(' ');
    const lens = /\blens/.test(words) || typeof raw.lens === 'string';
    const mirror = /\bmirror/.test(words) || typeof raw.mirror === 'string';
    if (lens && mirror) fail('say "mode": "lens" or "mode": "mirror", not both');
    const mode = lens ? 'lens' : mirror ? 'mirror' : '';
    if (!mode) fail('say what is on the bench: "mode": "lens" or "mirror", with "kind": "convex" or "concave" (or "plane", for a mirror)');
    const seen = new Set();
    if (/\bconvex/.test(words)) seen.add('convex');
    if (/\bconcave/.test(words)) seen.add('concave');
    if (/\bconverg/.test(words)) seen.add(mode === 'lens' ? 'convex' : 'concave');
    if (/\bdiverg/.test(words)) seen.add(mode === 'lens' ? 'concave' : 'convex');
    if (/\b(plane|flat)\b/.test(words)) {
      if (mode === 'lens') fail('a lens is "convex" or "concave"; a plane one would not bend light');
      seen.add('plane');
    }
    if (seen.size > 1) fail(`the kind is unclear (${[...seen].join(' and ')}): say one`);
    return { mode, kind: seen.size ? [...seen][0] : '' };
  }

  const DRAG = { object: 'object', u: 'object', position: 'object', x: 'object', distance: 'object', arrow: 'object', candle: 'object', height: 'height', h: 'height', size: 'height' };
  const SLIDERS = { u: 'u', object: 'u', distance: 'u', 'object distance': 'u', f: 'f', focal: 'f', 'focal length': 'f', focallength: 'f', h: 'h', height: 'h', 'object height': 'h' };
  function listOf(v, map, dflt, what) {
    if (v == null || v === true) return dflt.slice();
    if (v === false) return [];
    const items = Array.isArray(v) ? v : [v];
    const out = [];
    for (const x of items) {
      const k = map[lc(typeof x === 'string' ? x : '')];
      if (!k) fail(`${what} can hold ${[...new Set(Object.values(map))].map((s) => `"${s}"`).join(', ')}, not ${JSON.stringify(x).slice(0, 30)}`);
      if (!out.includes(k)) out.push(k);
    }
    return out;
  }
  const niceUp = (x) => (x > 20 ? Math.ceil(x / 5) * 5 : Math.ceil(x));

  function normBench(raw) {
    let { mode, kind } = kindOf(raw);
    const fIn = num(first(raw, ['f', 'focal', 'focalLength', 'focal_length', 'focal length']));
    if (!kind) {
      if (!fin(fIn) || fIn === 0) fail(`say the kind: "kind": ${mode === 'lens' ? '"convex" or "concave"' : '"concave", "convex" or "plane"'}`);
      kind = mode === 'lens' ? (fIn > 0 ? 'convex' : 'concave') : (fIn < 0 ? 'concave' : 'convex');
    }
    const plane = kind === 'plane';
    // the sign comes from the kind (NCERT): a bare size is read with it
    const sign = mode === 'lens' ? (kind === 'convex' ? 1 : -1) : (kind === 'concave' ? -1 : 1);
    let F0 = 0;
    if (!plane) {
      if (!fin(fIn) || fIn === 0) fail(`give the focal length "f" in cm (for example "f": ${sign * 10})`);
      F0 = Math.abs(fIn);
      if (F0 < LIMITS.f[0] || F0 > LIMITS.f[1]) fail(`the focal length must be from ${LIMITS.f[0]} to ${LIMITS.f[1]} cm (it is ${F0} cm)`);
    }
    const drag = listOf(raw.drag, DRAG, ['object'], '"drag"');
    const sliders = listOf(raw.sliders, SLIDERS, [], '"sliders"');
    if (plane && sliders.includes('f')) fail('a plane mirror has no focal length, so it can\'t have an "f" slider');
    const moveU = drag.includes('object') || sliders.includes('u');
    const moveH = drag.includes('height') || sliders.includes('h');
    const moveF = sliders.includes('f');
    const steps = isObj(raw.step) ? raw.step : { u: raw.step };
    const ranges = isObj(raw.range) ? raw.range : {};
    const range = {}, step = {};

    // the focal length, and its slider
    if (moveF) {
      step.f = stepOf(first(steps, ['f']) != null ? steps.f : first(raw, ['fstep', 'fStep']), F0 < 4 ? 0.5 : 1, 0.1, 10, 'the f step');
      const given = first(ranges, ['f']) != null ? ranges.f : first(raw, ['frange', 'fRange', 'f_range']);
      let lo, hi;
      if (given != null) [lo, hi] = pair(given, 'the f range').map(Math.abs).sort((a, b) => a - b);
      else { lo = Math.max(LIMITS.f[0], Math.round(F0 / 2)); hi = Math.min(LIMITS.f[1], Math.max(Math.round(F0 * 2), lo + 4 * step.f)); }
      lo = ceilTo(lo, step.f); hi = floorTo(hi, step.f);
      if (lo < LIMITS.f[0] || hi > LIMITS.f[1]) fail(`the f slider must stay from ${LIMITS.f[0]} to ${LIMITS.f[1]} cm`);
      if (!(hi > lo)) fail('the f slider needs a range [low, high] with two different ends');
      if ((hi - lo) / step.f > LIMITS.positions) fail(`the f slider has too many steps: use a bigger "step"`);
      F0 = snapTo(F0, step.f);
      if (F0 < lo - 1e-9 || F0 > hi + 1e-9) fail(`f = ${F0} cm is outside the slider's range, ${lo} to ${hi} cm`);
      range.f = [lo, hi];
    }
    const f = plane ? null : r6(sign * F0);

    // the object: where it starts, and where it can go
    const o = isObj(raw.object) ? raw.object : {};
    let u = num(first(o, ['u', 'distance', 'x']) != null ? first(o, ['u', 'distance', 'x']) : first(raw, ['u']));
    if (!fin(u)) u = -(plane ? 10 : niceUp(3 * F0));
    if (u === 0) fail('the object can\'t be at the lens or mirror itself: give "u" in front of it, like -30');
    u = -Math.abs(u); // in front, whichever way the AI wrote it
    if (-u > LIMITS.u) fail(`the object must be within ${LIMITS.u} cm (u = ${u} cm)`);
    step.u = stepOf(first(steps, ['u']) != null ? steps.u : first(raw, ['ustep', 'uStep']), !plane && F0 < 4 ? 0.5 : 1, 0.1, 10, 'the u step');
    if (moveU) {
      const given = first(ranges, ['u']) != null ? ranges.u : first(raw, ['urange', 'uRange', 'u_range']);
      let lo, hi;
      if (given != null) [lo, hi] = pair(given, 'the object\'s range').map((x) => -Math.abs(x)).sort((a, b) => a - b);
      else { lo = -niceUp(Math.max(plane ? 0 : 3.2 * F0, 1.25 * -u, 10)); hi = -step.u; } // room beyond 2F for the focal length it starts with
      lo = ceilTo(lo, step.u); hi = Math.min(floorTo(hi, step.u), -step.u);
      if (lo < -LIMITS.u) fail(`the object's range must stay within ${LIMITS.u} cm of the ${mode}`);
      if (!(hi > lo)) fail('the object\'s range [far, near] needs two different ends, both in front (negative u)');
      if ((hi - lo) / step.u > LIMITS.positions) fail('the object has too many positions: use a bigger "step"');
      u = snapTo(u, step.u);
      if (u < lo - 1e-9 || u > hi + 1e-9) fail(`the object starts at u = ${u} cm, outside its range, ${lo} to ${hi} cm`);
      range.u = [lo, hi];
    }
    u = r6(u);

    // its height
    let h = Math.abs(num(first(o, ['h', 'height', 'size']) != null ? first(o, ['h', 'height', 'size']) : first(raw, ['h'])));
    if (!fin(h) || h === 0) h = Math.max(1, Math.round((plane ? -u / 2 : F0) / 3));
    if (h < LIMITS.h[0] || h > LIMITS.h[1]) fail(`the object's height must be from ${LIMITS.h[0]} to ${LIMITS.h[1]} cm`);
    if (moveH) {
      step.h = stepOf(first(steps, ['h']) != null ? steps.h : first(raw, ['hstep', 'hStep']), 0.5, 0.1, 5, 'the h step');
      const given = first(ranges, ['h']) != null ? ranges.h : first(raw, ['hrange', 'hRange']);
      let lo, hi;
      if (given != null) [lo, hi] = pair(given, 'the height range').map(Math.abs).sort((a, b) => a - b);
      else { lo = step.h; hi = Math.max(1.6 * h, h + 4 * step.h); }
      lo = Math.max(ceilTo(lo, step.h), step.h); hi = floorTo(hi, step.h);
      if (hi > LIMITS.h[1]) fail(`the object's height must stay under ${LIMITS.h[1]} cm`);
      if (!(hi > lo)) fail('the height range needs two different ends');
      if ((hi - lo) / step.h > LIMITS.positions) fail('the height has too many steps: use a bigger "step"');
      h = snapTo(h, step.h);
      if (h < lo - 1e-9 || h > hi + 1e-9) fail(`the object's height ${h} cm is outside its range, ${lo} to ${hi} cm`);
      range.h = [lo, hi];
    }
    h = r6(h);
    const look = /candle|flame/.test(lc(typeof raw.object === 'string' ? raw.object : first(o, ['look', 'shape', 'type', 'kind']) || '')) ? 'candle' : 'arrow';

    const out = { mode, kind, f, object: { u, h, look }, drag, sliders, range, step, record: bool(first(raw, ['record', 'table', 'notebook']), false) };
    return out;
  }

  /* ---------------- refraction: a boundary, a slab, a prism ---------------- */

  function normRefraction(raw) {
    const m = lc(raw.mode), s = lc(typeof raw.shape === 'string' ? raw.shape : '');
    let shape = 'boundary';
    if (/prism/.test(s) || /prism|dispers/.test(m)) shape = 'prism';
    else if (/slab|block|plate/.test(s) || /slab/.test(m)) shape = 'slab';
    else if (s && !/^(boundary|surface|interface|plane|flat|none)$/.test(s)) fail(`"shape" is "boundary", "slab" or "prism", not "${txt(s, 20)}"`);
    const from = raw.from != null ? medium(raw.from, '"from"') : { key: 'air', n: 1 };
    const to = raw.to != null ? medium(raw.to, '"to"') : { key: 'glass', n: 1.5 };
    let media = null;
    if (raw.media != null) {
      if (!Array.isArray(raw.media) || raw.media.length < 2 || raw.media.length > LIMITS.media) fail(`"media" lists 2 to ${LIMITS.media} media the learner can choose for "to"`);
      media = [];
      raw.media.map((x, k) => medium(x, `"media" ${k + 1}`)).forEach((x) => { if (!media.some((y) => sameMedium(x, y))) media.push(x); });
      if (!media.some((x) => sameMedium(x, to))) media.unshift(to);
      if (media.length > LIMITS.media) fail(`"media" lists at most ${LIMITS.media} media, "to" among them`);
      if (media.length < 2) media = null;
    }
    if (!media && from.n === to.n) fail(`the two media have the same refractive index (n = ${from.n}), so the ray doesn't bend: choose two different ones`);
    const turn = raw.turn != null ? bool(raw.turn, true) : raw.drag != null ? !(raw.drag === false || (Array.isArray(raw.drag) && !raw.drag.length)) : true;
    const step = stepOf(raw.step, 1, 0.1, 15, 'the angle step');
    let range = [0, 89];
    if (raw.range != null) range = pair(raw.range, 'the angle range').sort((a, b) => a - b);
    if (range[0] < 0 || range[1] > 89) fail('the angle of incidence must be from 0 to 89 degrees');
    range = [ceilTo(range[0], step), floorTo(range[1], step)];
    if (!(range[1] > range[0])) fail('the angle range [low, high] needs two different ends');
    if ((range[1] - range[0]) / step > LIMITS.angles) fail('the laser has too many angles: use a bigger "step"');
    let angle = num(first(raw, ['angle', 'i', 'incidence']));
    if (!fin(angle)) angle = 30;
    if (angle < 0 || angle > 89) fail('the angle of incidence must be from 0 to 89 degrees');
    angle = snapTo(angle, step);
    if (angle < range[0] - 1e-9 || angle > range[1] + 1e-9) fail(`the laser starts at ${angle}°, outside its range, ${range[0]} to ${range[1]}°`);
    const out = { mode: 'refraction', shape, from, to, angle, turn, range, step };
    if (media) out.media = media;
    if (shape === 'slab') {
      const t = num(first(raw, ['thickness', 't', 'width']));
      const T = fin(t) ? Math.abs(t) : 5;
      if (T < LIMITS.thickness[0] || T > LIMITS.thickness[1]) fail(`the slab's thickness must be from ${LIMITS.thickness[0]} to ${LIMITS.thickness[1]} cm`);
      out.thickness = r6(T);
    }
    if (shape === 'prism') {
      const a = num(first(raw, ['apex', 'A', 'prismAngle', 'angleOfPrism']) != null ? first(raw, ['apex', 'A', 'prismAngle', 'angleOfPrism']) : isObj(raw.prism) ? first(raw.prism, ['apex', 'angle', 'A']) : undefined);
      const A = fin(a) ? a : 60;
      if (A < LIMITS.apex[0] || A > LIMITS.apex[1]) fail(`the prism's angle must be from ${LIMITS.apex[0]} to ${LIMITS.apex[1]} degrees`);
      out.apex = r6(A);
      out.white = bool(first(raw, ['white', 'dispersion', 'spectrum']), false);
    }
    return out;
  }

  function normSpec(raw) {
    if (!isObj(raw)) fail('the spec must be an object');
    const m = lc(raw.mode);
    const refr = /^(refraction|refract|snell|laser|rays?|boundary|slab|prism|dispersion|tir|total internal reflection)/.test(m)
      || (!m && !raw.kind && (has(raw, 'from') || has(raw, 'to') || has(raw, 'angle') || has(raw, 'shape')));
    return refr ? normRefraction(raw) : normBench(raw);
  }
  // something the learner can change
  const canChange = (spec) => (spec.mode === 'refraction' ? spec.turn || Boolean(spec.media) : spec.drag.length > 0 || spec.sliders.length > 0);
  const nothingToChange = (spec) => (spec.mode === 'refraction'
    ? 'nothing for the learner to change: let them turn the laser ("turn": true) or choose the medium ("media": [...])'
    : 'nothing for the learner to change: let them drag the object ("drag": ["object"]) or set f ("sliders": ["f"])');

  /* ---------------- image formation ---------------- */

  // the image of an object at u (h high) by a lens or mirror of focal length f; u = -Infinity: from far away
  function image(mode, kind, f, u, h) {
    h = h == null ? 1 : h;
    const lens = mode === 'lens';
    const done = (v, m) => {
      const real = lens ? v > 0 : v < 0;
      const a = Math.abs(m);
      return { u, f, h, v, m, hi: m * h, infinite: false, real, inverted: m < 0 || (m === 0 && real), size: Math.abs(a - 1) < 1e-6 ? 'same' : a > 1 ? 'magnified' : 'diminished' };
    };
    if (mode === 'mirror' && kind === 'plane') return done(-u, 1);
    if (u === -Infinity) return done(f, 0);
    const d = lens ? u + f : u - f;
    if (Math.abs(d) <= 1e-9 * Math.max(1, Math.abs(f))) return { u, f, h, v: Infinity, m: Infinity, hi: Infinity, infinite: true, real: null, inverted: null, size: null };
    const v = u * f / d;
    return done(v, lens ? v / u : -v / u);
  }

  // where a point on the axis is, in words a textbook uses (see the browser half for the words themselves)
  function zone(mode, kind, f, x) {
    if (!fin(x)) return 'infinity';
    if (Math.abs(x) < 1e-9) return 'atO';
    if (mode === 'mirror' && kind === 'plane') return x < 0 ? 'front' : 'behind';
    const marked = mode === 'lens' || (kind === 'concave' ? x < 0 : x > 0); // the side with F and C (2F) on it
    if (!marked) return x < 0 ? 'front' : 'behind';
    const q = Math.abs(x) / Math.abs(f), e = 1e-6;
    return q > 2 + e ? 'beyond2F' : q > 2 - e ? 'at2F' : q > 1 + e ? 'between' : q > 1 - e ? 'atF' : 'inside';
  }

  // The principal rays from the top of the object, as textbooks draw them: where each meets the lens or
  // mirror (x = 0), the way it goes on (a unit direction), and the dashed lines behind a virtual image.
  //   lens:   parallel, then through F2 (or as if from F1); through O, undeviated; through (or towards) F, then parallel
  //   mirror: parallel, then through (or as if from) F; through (or towards) C, back along itself; through (or towards) F,
  //           then parallel; to P, reflected at the same angle (when one of the others can't be drawn)
  //   plane:  to P, and along the normal, back on itself
  function principalRays(mode, kind, f, u, h) {
    const img = image(mode, kind, f, u, h);
    const tip = [u, h];
    const lens = mode === 'lens';
    const out = lens ? 1 : -1; // the way the light goes on: on through a lens, back from a mirror
    const hits = [];
    const tiny = 1e-9 * Math.max(1, Math.abs(f || 1));
    if (lens) {
      hits.push({ id: 'parallel', y: h, aim: null });
      hits.push({ id: 'centre', y: 0, aim: null });
      if (Math.abs(f + u) > tiny) hits.push({ id: 'focus', y: h * f / (f + u), aim: f < 0 ? [-f, 0] : null }); // a concave lens: aimed at F2
    } else if (kind === 'plane') {
      hits.push({ id: 'pole', y: 0, aim: null });
      hits.push({ id: 'normal', y: h, aim: null });
    } else {
      hits.push({ id: 'parallel', y: h, aim: null });
      if (Math.abs(2 * f - u) > tiny) hits.push({ id: 'centre', y: 2 * f * h / (2 * f - u), aim: f > 0 ? [2 * f, 0] : null }); // convex: aimed at C behind
      if (Math.abs(f - u) > tiny) hits.push({ id: 'focus', y: f * h / (f - u), aim: f > 0 ? [f, 0] : null });
      if (hits.length < 3) hits.push({ id: 'pole', y: 0, aim: null });
    }
    // every ray from the tip goes on towards the image (real), away from it (virtual), or parallel to the others (at infinity)
    const chief = lens ? [-u, -h] : [u, -h];
    const unit = (v) => { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; };
    return hits.map((hit) => {
      const at = [0, hit.y];
      let dir, back = null;
      if (img.infinite) dir = unit(chief);
      else if (img.real) dir = unit([img.v - at[0], img.hi - at[1]]);
      else {
        dir = unit([at[0] - img.v, at[1] - img.hi]);
        back = [img.v, img.hi];
        // a diverging lens or mirror: the parallel ray seems to come from F, past the image
        if (hit.id === 'parallel' && ((lens && f < 0) || (!lens && f > 0))) back = [f, 0];
      }
      if (dir[0] * out < 0) dir = [-dir[0], -dir[1]]; // numerical safety: light never turns back through a lens
      return { id: hit.id, tip, hit: at, dir, back, aim: hit.aim };
    });
  }

  /* ---------------- refraction ---------------- */

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const rot = (v, deg) => { const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [c * v[0] - s * v[1], s * v[0] + c * v[1]]; };
  const angleBetween = (a, b) => Math.acos(clamp(dot(a, b) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1])), -1, 1)) / DEG;
  const criticalAngle = (n1, n2) => (n1 > n2 ? Math.asin(n2 / n1) / DEG : null);

  // Snell's law for a direction d (unit) meeting a surface whose unit normal nrm faces the incident side
  function refractDir(d, nrm, n1, n2) {
    const ci = clamp(-dot(d, nrm), -1, 1);
    const refl = [d[0] + 2 * ci * nrm[0], d[1] + 2 * ci * nrm[1]];
    const eta = n1 / n2, k = 1 - eta * eta * (1 - ci * ci);
    const i = Math.acos(ci) / DEG;
    if (k < 0) return { tir: true, d: refl, refl, i, r: null, R: 1 };
    const ct = Math.sqrt(k);
    const t = [eta * d[0] + (eta * ci - ct) * nrm[0], eta * d[1] + (eta * ci - ct) * nrm[1]];
    const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct), rp = (n1 * ct - n2 * ci) / (n1 * ct + n2 * ci);
    return { tir: false, d: t, refl, i, r: Math.acos(ct) / DEG, R: (rs * rs + rp * rp) / 2 };
  }
  function snell(n1, n2, i) {
    const res = refractDir(rot([0, -1], -i), [0, 1], n1, n2);
    return { i, r: res.r, tir: res.tir, R: res.R, critical: criticalAngle(n1, n2) };
  }

  // a ray through a convex polygon (counter-clockwise) of index nIn in a medium of index nOut
  function segHit(p, d, a, b) {
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) return null;
    const wx = a[0] - p[0], wy = a[1] - p[1];
    const t = (wx * ey - wy * ex) / den, s = (wx * d[1] - wy * d[0]) / den;
    return s >= -1e-9 && s <= 1 + 1e-9 ? { t } : null;
  }
  function tracePoly(poly, nIn, nOut, p0, d0) {
    const pts = [p0], events = [];
    let p = p0, d = d0, inside = false;
    for (let guard = 0; guard < 8; guard++) {
      let best = null;
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const hit = segHit(p, d, a, b);
        if (hit && hit.t > 1e-7 && (!best || hit.t < best.t)) best = { t: hit.t, k, a, b };
      }
      if (!best) break;
      const q = [p[0] + best.t * d[0], p[1] + best.t * d[1]];
      const ex = best.b[0] - best.a[0], ey = best.b[1] - best.a[1], L = Math.hypot(ex, ey);
      const no = [ey / L, -ex / L]; // outward
      const entering = dot(d, no) < 0;
      const nn = entering ? no : [-no[0], -no[1]];
      const res = refractDir(d, nn, entering ? nOut : nIn, entering ? nIn : nOut);
      events.push({ at: q, nrm: nn, face: best.k, entering, i: res.i, r: res.r, tir: res.tir, R: res.R, refl: res.refl, d: res.d });
      pts.push(q);
      d = res.d; p = q;
      inside = res.tir ? inside : !inside;
      if (!inside) break;
    }
    return { pts, events, dOut: d, end: p };
  }

  // the slab's and the prism's places in the drawing (world units; y grows upward)
  const SLAB = { half: 2, x: -1.6, y: -0.8, laser: 4.6 };
  const PRISM = { side: 8.8, at: 0.45, laser: 5, lift: -0.2 };
  // dispersion: how much more each colour's index is, red to violet (a crown glass's spread, scaled by how dense it is)
  const SPECTRUM = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'];
  const DISP = [-0.009, -0.006, -0.003, 0, 0.004, 0.008, 0.012];
  function prismShape(A) {
    const hgt = PRISM.side * Math.cos(A / 2 * DEG), b = PRISM.side * Math.sin(A / 2 * DEG);
    const top = [0, hgt / 2 + PRISM.lift], left = [-b, -hgt / 2 + PRISM.lift], right = [b, -hgt / 2 + PRISM.lift];
    const poly = [top, left, right];
    const E = [top[0] + PRISM.at * (left[0] - top[0]), top[1] + PRISM.at * (left[1] - top[1])];
    const ex = left[0] - top[0], ey = left[1] - top[1], L = Math.hypot(ex, ey);
    return { poly, E, nOut: [ey / L, -ex / L], top, left, right };
  }

  // Everything about a laser at angle i: readouts and the drawing's geometry (world units)
  function rayState(spec, value) {
    const val = rayValue(spec, value);
    if (!val) return null;
    const i = val.i;
    const to = spec.media ? spec.media[val.m] : spec.to;
    const n1 = spec.from.n, n2 = to.n;
    const st = { i, m: val.m, to, n1, n2, r: null, e: null, deviation: null, shift: null, tir: false, critical: criticalAngle(n1, n2), R: 0, min: null, geo: null };
    if (spec.shape === 'boundary') {
      const E = [0, 0], nOut = [0, 1];
      const dl = rot(nOut, i), d0 = [-dl[0], -dl[1]];
      const res = refractDir(d0, nOut, n1, n2);
      st.tir = res.tir; st.R = res.R;
      st.r = res.tir ? null : res.r;
      st.deviation = res.tir ? 180 - 2 * i : Math.abs(i - res.r);
      st.geo = { E, nOut, laser: [E[0] + 5.6 * dl[0], E[1] + 5.6 * dl[1]], d0, main: [[E[0] + 5.6 * dl[0], E[1] + 5.6 * dl[1]], E, [E[0] + 40 * res.d[0], E[1] + 40 * res.d[1]]],
        events: [{ at: E, nrm: nOut, i, r: st.r, tir: res.tir, R: res.R, refl: res.refl, d: res.d }], partial: res.tir ? null : { at: E, d: res.refl, R: res.R } };
      return st;
    }
    let shape;
    if (spec.shape === 'slab') {
      const top = SLAB.y + SLAB.half, bot = SLAB.y - SLAB.half;
      shape = { poly: [[-80, top], [-80, bot], [80, bot], [80, top]], E: [SLAB.x, top], nOut: [0, 1] };
    } else shape = prismShape(spec.apex);
    const dl = rot(shape.nOut, i), d0 = [-dl[0], -dl[1]];
    const laser = [shape.E[0] + (spec.shape === 'slab' ? SLAB.laser : PRISM.laser) * dl[0], shape.E[1] + (spec.shape === 'slab' ? SLAB.laser : PRISM.laser) * dl[1]];
    const tr = tracePoly(shape.poly, n2, n1, laser, d0);
    const main = tr.pts.concat([[tr.end[0] + 40 * tr.dOut[0], tr.end[1] + 40 * tr.dOut[1]]]);
    const ev = tr.events;
    const e0 = ev[0];
    const last = ev[ev.length - 1];
    const out = last && !last.entering && !last.tir ? last : null; // where it comes out
    st.tir = ev.some((x) => x.tir);
    st.R = e0 ? e0.R : 0;
    st.r = e0 && e0.entering && !e0.tir ? e0.r : null;
    st.e = out ? out.r : null;
    st.deviation = out ? angleBetween(d0, tr.dOut) : e0 && e0.tir ? 180 - 2 * i : null;
    st.geo = { E: shape.E, nOut: shape.nOut, poly: shape.poly, laser, d0, main, events: ev, partial: e0 && !e0.tir ? { at: e0.at, d: e0.refl, R: e0.R } : null };
    if (spec.shape === 'slab') {
      if (out) st.shift = Math.abs(d0[0] * (out.at[1] - shape.E[1]) - d0[1] * (out.at[0] - shape.E[0])) * spec.thickness / (2 * SLAB.half);
      st.geo.top = SLAB.y + SLAB.half;
    } else {
      st.critical = criticalAngle(n2, n1); // inside the prism, going out
      const s = n2 / n1 * Math.sin(spec.apex / 2 * DEG);
      st.min = s <= 1 ? 2 * Math.asin(s) / DEG - spec.apex : null;
      if (spec.white && e0 && !e0.tir) {
        const k = Math.max(1, (n2 - 1) / 0.5) * 2.5; // the colours spread a little wider than in life, so they can be seen
        st.geo.colours = SPECTRUM.map((c, j) => {
          const t2 = tracePoly(shape.poly, n2 + DISP[j] * k, n1, laser, d0);
          return { colour: c, pts: t2.pts.slice(1).concat([[t2.end[0] + 40 * t2.dOut[0], t2.end[1] + 40 * t2.dOut[1]]]) };
        });
      }
    }
    return st;
  }

  /* ---------------- values, goals, checks ---------------- */

  const benchControls = (spec) => ({ u: spec.drag.includes('object') || spec.sliders.includes('u'), h: spec.drag.includes('height') || spec.sliders.includes('h'), f: spec.sliders.includes('f') });

  function startValue(spec) {
    if (spec.mode === 'refraction') return spec.media ? { i: spec.angle, m: spec.media.findIndex((x) => sameMedium(x, spec.to)) } : { i: spec.angle };
    return spec.kind === 'plane' ? { u: spec.object.u, h: spec.object.h } : { u: spec.object.u, f: spec.f, h: spec.object.h };
  }
  // a control's value from the learner: on its grid and in its range, or the start where it can't move; null: not a real one
  function control(x, start, range, step, moves) {
    if (x == null) return start;
    const v = num(x);
    if (!fin(v)) return null;
    if (!moves) return Math.abs(v - start) < 1e-6 ? start : null;
    if (v < range[0] - 1e-6 || v > range[1] + 1e-6 || !onGrid(v, step)) return null;
    return snapTo(v, step);
  }
  function benchValue(spec, value) {
    if (!isObj(value)) return null;
    const c = benchControls(spec);
    const u = control(value.u, spec.object.u, spec.range.u, spec.step.u, c.u);
    const h = control(value.h, spec.object.h, spec.range.h, spec.step.h, c.h);
    let f = spec.f;
    if (spec.kind !== 'plane' && value.f != null) {
      const x = num(value.f);
      if (!fin(x) || Math.sign(x) !== Math.sign(spec.f)) return null;
      const F = control(Math.abs(x), Math.abs(spec.f), spec.range.f, spec.step.f, c.f);
      if (F == null) return null;
      f = Math.sign(spec.f) * F;
    }
    return u == null || h == null ? null : { u, f, h };
  }
  function rayValue(spec, value) {
    if (!isObj(value)) return null;
    const i = control(value.i, spec.angle, spec.range, spec.step, spec.turn);
    if (i == null) return null;
    if (!spec.media) return value.m == null || value.m === 0 ? { i, m: 0 } : null;
    const m = value.m == null ? startValue(spec).m : num(value.m);
    return Number.isInteger(m) && m >= 0 && m < spec.media.length ? { i, m } : null;
  }
  function benchState(spec, value) {
    const val = benchValue(spec, value);
    if (!val) return null;
    const img = image(spec.mode, spec.kind, val.f, val.u, val.h);
    return Object.assign(img, { zoneU: zone(spec.mode, spec.kind, val.f, val.u), zoneV: img.infinite ? 'infinity' : zone(spec.mode, spec.kind, val.f, img.v) });
  }
  const state = (spec, value) => (spec.mode === 'refraction' ? rayState(spec, value) : benchState(spec, value));

  const IMAGE_KEYS = { u: ['u'], v: ['v'], f: ['f', 'focal'], m: ['m', 'magnification'], h: ['h', 'height'], hi: ['hi', 'h\'', 'h′', 'imageHeight', 'image height', 'himage'] };
  const RAY_KEYS = { i: ['i', 'incidence', 'angle'], r: ['r', 'refraction', 'refracted'], e: ['e', 'emergence'], deviation: ['deviation', 'delta', 'δ', 'd'], shift: ['shift', 'lateralShift', 'lateral shift', 'lateral_shift'] };
  const WORDS = [
    ['nature', /\breal\b/, 'real'], ['nature', /\bvirtual\b/, 'virtual'],
    ['orientation', /\binverted\b|\bupside down\b/, 'inverted'], ['orientation', /\berect\b|\bupright\b/, 'erect'],
    ['size', /\bmagnified\b|\benlarged\b|\blarger\b|\bbigger\b/, 'magnified'], ['size', /\bdiminished\b|\bsmaller\b|\breduced\b|\bpoint sized\b/, 'diminished'],
    ['size', /\bsame\b|\bequal\b/, 'same']
  ];
  function cond(v, what) {
    if (Array.isArray(v)) { const p = pair(v, what).sort((a, b) => a - b); return [r6(p[0]), r6(p[1])]; }
    const x = num(v);
    if (!fin(x)) fail(`${what} is a number, or [low, high]`);
    return r6(x);
  }

  function normGoal(raw, spec) {
    if (!isObj(raw)) fail('the goal must be an object');
    const bench = spec.mode !== 'refraction';
    const type = lc(raw.type);
    if (type && bench && type !== 'image') fail(`a ${spec.mode} task's goal is {"type": "image", ...}, not "${txt(type, 20)}"`);
    if (type && !bench && type !== 'ray') fail(`a refraction task's goal is {"type": "ray", ...}, not "${txt(type, 20)}"`);
    const g = { type: bench ? 'image' : 'ray' };
    if (raw.tol != null) {
      const t = num(raw.tol);
      if (!(t > 0 && t <= 10)) fail('"tol" is how close counts: a small positive number');
      g.tol = r6(t);
    }
    if (bench) {
      // the image's nature, in words ("real", "virtual and magnified", "the same size")
      const words = ['nature', 'orientation', 'size', 'image'].map((k) => lc(typeof raw[k] === 'string' ? raw[k] : '')).join(' | ');
      for (const [key, re, val] of WORDS) {
        if (!re.test(words)) continue;
        if (g[key] && g[key] !== val) fail(`the goal asks for an image that is both ${g[key]} and ${val}`);
        g[key] = val;
      }
      if (raw.infinity === true || /infinit|∞/.test(words) || /infinit|∞/.test(lc(typeof raw.v === 'string' ? raw.v : ''))) g.infinity = true;
      for (const [k, names] of Object.entries(IMAGE_KEYS)) {
        const v = first(raw, names);
        if (v == null || (k === 'v' && g.infinity && typeof v === 'string')) continue;
        let c = cond(v, `"${k}"`);
        if (k === 'u') c = Array.isArray(c) ? c.map((x) => -Math.abs(x)).sort((a, b) => a - b) : -Math.abs(c);
        if (k === 'f') {
          if (spec.kind === 'plane') fail('a plane mirror has no focal length to set');
          const s = Math.sign(spec.f);
          c = Array.isArray(c) ? c.map((x) => s * Math.abs(x)).sort((a, b) => a - b) : s * Math.abs(c);
        }
        if (k === 'h') c = Array.isArray(c) ? c.map(Math.abs).sort((a, b) => a - b) : Math.abs(c);
        g[k] = c;
      }
      if (g.infinity && (g.nature || g.orientation || g.size || g.v != null || g.m != null || g.hi != null)) fail('an image at infinity has no nature, size or place to ask for besides being at infinity');
      if (!g.nature && !g.orientation && !g.size && !g.infinity && !Object.keys(IMAGE_KEYS).some((k) => g[k] != null)) {
        fail('the goal needs something to reach: "nature", "orientation", "size", "infinity", or a value of u, v, f, m, h or hi');
      }
    } else {
      const tir = first(raw, ['tir', 'totalInternalReflection', 'total internal reflection']);
      if (tir != null) g.tir = bool(tir, true);
      if (bool(raw.critical, false)) g.critical = true;
      if (bool(raw.minimum, false) || /^min/.test(lc(typeof raw.deviation === 'string' ? raw.deviation : ''))) g.minimum = true;
      for (const [k, names] of Object.entries(RAY_KEYS)) {
        const v = first(raw, names);
        if (v == null || (k === 'deviation' && g.minimum && typeof v === 'string')) continue;
        g[k] = cond(v, `"${k}"`);
      }
      if (g.shift != null && spec.shape !== 'slab') fail('"shift" is the sideways shift through a slab: use "shape": "slab"');
      if ((g.minimum || g.e != null) && spec.shape !== 'prism') fail(`"${g.minimum ? 'minimum' : 'e'}" is for a prism: use "shape": "prism"`);
      if (g.critical && spec.shape === 'prism') fail('"critical" is for a boundary or a slab, not a prism');
      if (g.tir == null && !g.critical && !g.minimum && !Object.keys(RAY_KEYS).some((k) => g[k] != null)) {
        fail('the goal needs something to reach: "tir", "critical", "minimum", or a value of i, r, e, deviation or shift');
      }
    }
    return g;
  }

  // how close counts, for each readout
  function tolFor(k, g, spec) {
    if (g.tol != null) return g.tol;
    const c = g[k];
    if (Array.isArray(c)) return 1e-6;
    switch (k) {
      case 'v': return Math.max(0.25, 0.01 * Math.abs(c));
      case 'm': return 0.02;
      case 'hi': return Math.max(0.1, 0.02 * Math.abs(c));
      case 'r': case 'e': case 'deviation': return 0.5;
      case 'shift': return Math.max(0.05, 0.03 * Math.abs(c));
      case 'critical': return Math.max(0.5, spec.step / 2 + 0.01);
      case 'minimum': return Math.max(0.5, spec.step + 0.01); // how far i and e may differ (at the minimum they are equal)
      default: return 1e-6; // u, f, h, i: the controls themselves
    }
  }
  const within = (x, c, tol) => (Array.isArray(c) ? x >= c[0] - tol && x <= c[1] + tol : Math.abs(x - c) <= tol);
  // a prism at minimum deviation: the ray goes through symmetrically, i = e (to the nearest step of the laser)
  const atMinimum = (spec, st, g) => spec.shape === 'prism' && st.e != null && st.min != null && !st.tir
    && Math.abs(st.i - st.e) <= tolFor('minimum', g || {}, spec) && st.deviation - st.min <= 0.5;

  function meets(spec, g, st) {
    if (!st) return { ok: false, why: { invalid: true } };
    const no = (why) => ({ ok: false, why });
    if (g.type === 'image') {
      if (g.infinity) { if (!st.infinite) return no({ key: 'infinity', want: true, got: st.v }); }
      else if (st.infinite && (g.nature || g.orientation || g.size || g.v != null || g.m != null || g.hi != null)) return no({ key: 'infinity', got: true });
      if (g.nature && (st.real ? 'real' : 'virtual') !== g.nature) return no({ key: 'nature', want: g.nature });
      if (g.orientation && (st.inverted ? 'inverted' : 'erect') !== g.orientation) return no({ key: 'orientation', want: g.orientation });
      if (g.size && st.size !== g.size) return no({ key: 'size', want: g.size });
      for (const k of Object.keys(IMAGE_KEYS)) {
        if (g[k] == null) continue;
        if (!within(st[k], g[k], tolFor(k, g, spec))) return no({ key: k, got: st[k], want: g[k] });
      }
      return { ok: true };
    }
    if (g.tir === true && !st.tir) return no({ key: 'tir', want: true });
    if (g.tir === false && st.tir) return no({ key: 'tir', want: false });
    if (g.critical && (st.critical == null || Math.abs(st.i - st.critical) > tolFor('critical', g, spec))) return no({ key: 'critical', got: st.i });
    if (g.minimum && !atMinimum(spec, st, g)) return no({ key: 'minimum', got: st.deviation, tir: st.tir });
    for (const k of Object.keys(RAY_KEYS)) {
      if (g[k] == null) continue;
      if (st[k] == null) return no({ key: k, missing: true, tir: st.tir });
      if (!within(st[k], g[k], tolFor(k, g, spec))) return no({ key: k, got: st[k], want: g[k] });
    }
    return { ok: true };
  }

  // every setting the learner can reach (that matters for this goal)
  function settings(spec, g) {
    let out;
    if (spec.mode === 'refraction') {
      const is = spec.turn ? grid(spec.range, spec.step) : [spec.angle];
      const ms = spec.media ? spec.media.map((x, k) => k) : [0];
      out = [];
      for (const m of ms) for (const i of is) out.push(spec.media ? { i, m } : { i });
    } else {
      const c = benchControls(spec);
      const us = c.u ? grid(spec.range.u, spec.step.u) : [spec.object.u];
      const fs = spec.kind === 'plane' ? [null] : c.f ? grid(spec.range.f, spec.step.f).map((x) => r6(Math.sign(spec.f) * x)) : [spec.f];
      const hs = c.h && (!g || g.h != null || g.hi != null) ? grid(spec.range.h, spec.step.h) : [spec.object.h];
      if (us.length * fs.length * hs.length > LIMITS.combos) fail('there are too many settings to check: use bigger steps or fewer sliders');
      out = [];
      for (const f of fs) for (const h of hs) for (const u of us) out.push(f == null ? { u, h } : { u, f, h });
    }
    return out;
  }
  // how far a setting is from another, in steps
  function distance(spec, a, b) {
    if (spec.mode === 'refraction') return Math.abs(a.i - b.i) / spec.step + (a.m !== b.m ? 1000 : 0);
    return Math.abs(a.u - b.u) / spec.step.u + (a.f != null && b.f != null && spec.step.f ? Math.abs(a.f - b.f) / spec.step.f : 0) + (spec.step.h ? Math.abs(a.h - b.h) / spec.step.h : 0);
  }
  // the settings that meet the goal, nearest to `near` (the start, unless given) first
  function solutions(spec, g, near) {
    const from = near && (spec.mode === 'refraction' ? rayValue(spec, near) : benchValue(spec, near)) || startValue(spec);
    const ok = settings(spec, g).filter((v) => meets(spec, g, state(spec, v)).ok);
    return ok.map((v) => [distance(spec, v, from), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }
  const solution = (spec, g, near) => solutions(spec, g, near)[0] || null;

  /* ---------------- why a task is left out (for the AI to repair it) ---------------- */

  function sayState(spec, st) {
    if (spec.mode === 'refraction') {
      const m = spec.media ? `, ${mediumWords(st.to)}` : '';
      if (spec.shape === 'prism') return `i = ${sayA(st.i)}${m}: ${st.e == null ? 'total internal reflection inside the prism' : `e = ${sayA(st.e)}, deviation ${sayA(st.deviation)}`}`;
      return `i = ${sayA(st.i)}${m}: ${st.tir ? 'total internal reflection' : `r = ${sayA(st.r)}`}${st.shift != null ? `, shift ${fmt(st.shift, 2)} cm` : ''}`;
    }
    const f = benchControls(spec).f ? `f = ${say(st.f, 1)} cm, ` : '';
    if (st.infinite) return `${f}u = ${say(st.u, 1)} cm puts the object at F, so the image is at infinity`;
    return `${f}u = ${say(st.u, 1)} cm gives v = ${say(st.v, 1)} cm, m = ${say(st.m)} (${st.real ? 'real' : 'virtual'}, ${st.inverted ? 'inverted' : 'erect'}, ${st.size === 'same' ? 'same size' : st.size})`;
  }
  function alreadyMet(spec, g, st) {
    const all = settings(spec, g);
    const start = startValue(spec);
    const not = all.filter((v) => !meets(spec, g, state(spec, v)).ok).map((v) => [distance(spec, v, start), v]).sort((a, b) => a[0] - b[0]);
    const what = spec.mode === 'refraction' ? 'the laser' : 'the object';
    if (!not.length) return `every setting meets the goal (at the start: ${sayState(spec, st)}), so there is nothing to find: ask for a value or a range that only some settings reach, or make an open question a block's caption`;
    const pick = (not.find((x) => x[0] >= 3) || not[0])[1];
    let eg = '';
    if (pick) eg = spec.mode === 'refraction' ? `, e.g. "angle": ${pick.i}` : pick.u !== start.u ? `, e.g. "u": ${pick.u}` : pick.f !== start.f ? `, e.g. "f": ${pick.f}` : '';
    return `the goal is already met at the start (${sayState(spec, st)}); start ${what} where it isn't${eg}`;
  }
  const positions = (spec) => {
    const c = benchControls(spec);
    return c.u ? `the object's positions (${spec.range.u[0]} to ${spec.range.u[1]} cm in steps of ${spec.step.u} cm)` : `the object's place (u = ${spec.object.u} cm, fixed)`;
  };
  function unreachableImage(spec, g) {
    const lens = spec.mode === 'lens', name = lens ? `a ${spec.kind} lens` : `a ${spec.kind} mirror`;
    const c = benchControls(spec);
    const O = lens ? 'O' : 'P', F1 = lens ? 'F1' : 'F', C1 = lens ? '2F1' : 'C';
    const diverging = (lens && spec.kind === 'concave') || (!lens && spec.kind === 'convex');
    const an = (w) => (/^[aeiu]/.test(w) ? 'an ' : 'a ') + w;
    if (diverging || spec.kind === 'plane') {
      const always = diverging ? ['virtual', 'erect', 'diminished'] : ['virtual', 'erect', 'same'];
      const bad = g.infinity ? 'at infinity' : g.nature && g.nature !== 'virtual' ? g.nature : g.orientation && g.orientation !== 'erect' ? g.orientation
        : g.size && g.size !== always[2] ? (g.size === 'same' ? 'same-size' : g.size) : '';
      if (bad) {
        const facts = diverging ? 'always virtual, erect and diminished' : 'always virtual, erect and the same size, as far behind the mirror as the object is in front (v = -u)';
        return `with ${name} the image is ${facts}, so no object position gives ${bad === 'at infinity' ? 'an image at infinity' : an(bad) + ' image'}`;
      }
    } else {
      if (g.nature === 'real' && g.orientation === 'erect') return `a real image from ${name} is always inverted, so "real" and "erect" can't both be met`;
      if (g.nature === 'virtual' && g.orientation === 'inverted') return `a virtual image from ${name} is always erect, so "virtual" and "inverted" can't both be met`;
      if (g.nature === 'virtual' && (g.size === 'diminished' || g.size === 'same')) return `a virtual image from ${name} is always magnified (the object between ${F1} and ${O}), so it can't be ${g.size === 'same' ? 'the same size' : 'diminished'}`;
      if (g.orientation === 'erect' && (g.size === 'diminished' || g.size === 'same')) return `an erect image from ${name} is virtual and always magnified, so it can't be ${g.size === 'same' ? 'the same size' : 'diminished'}`;
    }
    const f = spec.f;
    const fixedF = !c.f && spec.kind !== 'plane';
    const onU = (u) => c.u ? u >= spec.range.u[0] - 1e-6 && u <= spec.range.u[1] + 1e-6 && onGrid(u, spec.step.u) : Math.abs(u - spec.object.u) < 1e-6;
    if (fixedF && g.infinity) {
      const need = lens ? -Math.abs(f) : f;
      return `an image at infinity needs the object exactly at ${F1} (u = ${say(need, 2)} cm), which is not one of ${positions(spec)}`;
    }
    if (fixedF && g.size === 'same' && !diverging) {
      const need = lens ? -2 * Math.abs(f) : 2 * f;
      if (!onU(need)) return `a same-size image needs the object exactly at ${C1} (u = ${say(need, 2)} cm), which is not one of ${positions(spec)}`;
    }
    // a value of v or m: the place the object would need, for the focal length it has
    const needU = (k, x) => {
      if (k === 'v') return lens ? x * f / (f - x) : x * f / (x - f);
      return lens ? f * (1 - x) / x : f * (x - 1) / x;
    };
    for (const k of ['v', 'm']) {
      if (typeof g[k] !== 'number' || !fixedF) continue;
      const x = g[k];
      const u = needU(k, x);
      const what = `${k} = ${say(x, 2)}${k === 'v' ? ' cm' : ''}`;
      if (!fin(u) || u >= 0) return `no real object (u < 0) gives ${what} with ${name} of f = ${say(f, 1)} cm${lens && spec.kind === 'convex' && k === 'v' ? ': a real image forms beyond F2 (v > ' + say(f, 1) + ' cm) and a virtual one on the object\'s side (v < 0)' : ''}`;
      if (!onU(u)) {
        let eg = '';
        if (c.u) {
          const near = snapTo(clamp(u, spec.range.u[0], spec.range.u[1]), spec.step.u);
          const st = image(spec.mode, spec.kind, f, near, spec.object.h);
          if (!st.infinite && near < 0) eg = `; choose ${k} so u is one of them, e.g. ${k} = ${say(k === 'v' ? st.v : st.m, 2)}${k === 'v' ? ' cm' : ''} (u = ${near} cm)`;
        }
        return `${what} needs u = ${say(u, 2)} cm, which is not one of ${positions(spec)}${eg}`;
      }
    }
    if (c.f && !c.u && typeof g.v === 'number') {
      const u = spec.object.u, v = g.v;
      const need = lens ? u * v / (u - v) : u * v / (u + v);
      if (!fin(need) || Math.sign(need) !== Math.sign(f)) return `v = ${say(v, 2)} cm with u = ${u} cm needs f = ${say(need, 2)} cm, which ${name} can't have`;
      return `v = ${say(v, 2)} cm with u = ${u} cm needs f = ${say(need, 2)} cm, which is not one of the slider's values (${spec.range.f[0]} to ${spec.range.f[1]} cm in steps of ${spec.step.f} cm)`;
    }
    let facts = '';
    if (fixedF && !diverging) {
      const F = Math.abs(f), s = lens ? -1 : 1;
      facts = `; with f = ${say(f, 1)} cm: beyond ${C1} (u < ${say(s * 2 * F, 1)}) real, inverted, diminished; at ${C1} same size; between ${F1} and ${C1} magnified; at ${F1} at infinity; between ${F1} and ${O} virtual, erect, magnified`;
    }
    return `no setting the learner can reach (${positions(spec)}${c.f ? `, f from ${spec.range.f[0]} to ${spec.range.f[1]} cm` : ''}) meets the goal${facts}`;
  }
  function unreachableRay(spec, g) {
    const list = spec.media || [spec.to];
    const from = spec.from, n1 = from.n;
    const [lo, hi] = spec.turn ? spec.range : [spec.angle, spec.angle];
    const turns = spec.turn ? `${lo} to ${hi}° in steps of ${spec.step}°` : `fixed at ${spec.angle}°`;
    if ((g.tir === true || g.critical) && spec.shape !== 'prism') {
      const what = g.critical ? 'a critical angle' : 'total internal reflection';
      if (list.every((m) => n1 <= m.n)) {
        const to = list[0];
        return `${what} needs light going from a denser into a rarer medium (n1 > n2); from ${mediumWords(from)} into ${mediumWords(to)} it never happens: put the laser in the denser one ("from": "${to.key === 'custom' ? to.n : to.key}", "to": "${from.key === 'custom' ? from.n : from.key}")`;
      }
      const C = Math.min(...list.filter((m) => n1 > m.n).map((m) => criticalAngle(n1, m.n)));
      if (hi < C - 1e-9 && !g.critical) return `total internal reflection starts at the critical angle, ${sayA(C)}, but the laser ${spec.turn ? `turns only up to ${hi}°` : `is fixed at ${spec.angle}°`}; let it turn further ("range": [0, 89])`;
      if (g.critical) return `the critical angle is ${sayA(C)}, and no angle of the laser (${turns}) is within ${tolFor('critical', g, spec)}° of it`;
    }
    if (typeof g.r === 'number' && spec.shape !== 'prism') {
      const r = g.r;
      const reach = list.map((m) => ({ m, s: m.n * Math.sin(r * DEG) / n1 }));
      if (reach.every((x) => x.s > 1)) {
        const m = list[0], rmax = Math.asin(n1 / m.n) / DEG;
        return `going from ${mediumWords(from)} into ${mediumWords(m)} the refracted ray is never more than ${sayA(rmax)} from the normal, so r = ${r}° can't happen; choose a smaller r`;
      }
      if (!spec.media) {
        const need = Math.asin(reach[0].s) / DEG;
        let eg = '';
        if (spec.turn) {
          const near = snapTo(clamp(need, lo, hi), spec.step);
          const s2 = snell(n1, spec.to.n, near);
          if (!s2.tir) eg = `; choose r so i is one of them, e.g. r = ${sayA(s2.r)} (i = ${near}°)`;
        }
        return `r = ${r}° needs i = ${sayA(need, 2)}, which is not an angle of the laser (${turns})${eg}`;
      }
    }
    return numberReason(spec, g) || `no ${spec.media ? 'medium and ' : ''}angle of the laser (${turns}) meets the goal`;
  }
  // one number asked of the ray (r, e, deviation, shift): the values it really takes, or the nearest one
  function numberReason(spec, g) {
    const keys = Object.keys(RAY_KEYS).filter((k) => g[k] != null);
    if (keys.length !== 1 || g.tir != null || g.critical || g.minimum) return '';
    const k = keys[0], want = g[k], tol = tolFor(k, g, spec);
    const all = settings(spec, g).map((v) => [v, rayState(spec, v)]).filter(([, st]) => st && fin(st[k]));
    if (!all.length) return '';
    const show = (x) => (k === 'shift' ? `${fmt(x, 2)} cm` : sayA(x));
    const name = k === 'deviation' ? 'the deviation' : k === 'shift' ? 'the shift' : k;
    const asked = Array.isArray(want) ? `${name} from ${show(want[0])} to ${show(want[1])}` : `${name} = ${show(want)}`;
    const xs = all.map(([, st]) => st[k]);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const [a, b] = Array.isArray(want) ? want : [want, want];
    const min = k === 'deviation' && spec.shape === 'prism' && all[0][1].min != null ? ` (its minimum deviation is ${sayA(all[0][1].min)})` : '';
    if (b < lo - tol || a > hi + tol) return `${asked} can't happen here: it only goes from ${show(lo)} to ${show(hi)}${min}`;
    const [v, st] = all.reduce((p, q) => (Math.abs(q[1][k] - a) < Math.abs(p[1][k] - a) ? q : p));
    return `no angle of the laser gives ${asked} within ${tol}; the nearest is ${show(st[k])} at i = ${v.i}°${spec.media ? ` in ${mediumWords(st.to)}` : ''}: ask for that, or a range`;
  }
  const unreachable = (spec, g) => (spec.mode === 'refraction' ? unreachableRay(spec, g) : unreachableImage(spec, g));

  // A task's spec and goal, checked: something to change, a goal that is not met at the start and that some setting meets
  function normTask(rawSpec, rawGoal) {
    const spec = normSpec(rawSpec);
    if (!canChange(spec)) fail(nothingToChange(spec));
    const goal = normGoal(rawGoal == null ? {} : rawGoal, spec);
    const st0 = state(spec, startValue(spec));
    if (meets(spec, goal, st0).ok) fail(alreadyMet(spec, goal, st0));
    if (!solution(spec, goal)) fail(unreachable(spec, goal));
    return { spec, goal };
  }

  // the learner's attempt, checked: { correct, invalid?, why? }
  function check(spec, goal, value) {
    const st = isObj(value) ? state(spec, value) : null;
    if (!st) return { correct: false, invalid: true };
    const m = meets(spec, goal, st);
    return { correct: m.ok, why: m.why || null, state: st };
  }

  return {
    LIMITS, MEDIA, SPECTRUM, OpticsError,
    normSpec, normGoal, normTask, canChange, nothingToChange,
    image, zone, principalRays, snell, criticalAngle, refractDir, tracePoly, rayState, benchState, state,
    startValue, benchControls, settings, solutions, solution, meets, check, tolFor, atMinimum,
    fmt, num, text: txt, sameMedium
  };
});
