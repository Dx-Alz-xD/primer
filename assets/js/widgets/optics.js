/* =====================================================================
   The optics bench (assets/js/widgets.js), for lessons on light, drawn
   as school books draw it (NCERT's too).

   - A lens or a mirror on its principal axis, with F and 2F (F and C for
     a mirror) and O or P marked, and a cm scale like an optical bench.
     The learner drags the object (an arrow or a candle) along the axis,
     and its height if the spec allows; sliders do the same, and set the
     focal length. The principal rays are drawn with arrows, their
     virtual parts dashed; the image is solid when real and dashed when
     virtual. Readouts follow at once: u, v, f, m, the image height and
     its nature, the lens or mirror formula with the numbers in it, and
     where the object and the image are. A table can note readings, like
     a lab notebook.
   - Refraction: a laser the learner turns (drag it, tap where it should
     be, or use the slider) shining from one medium into another, with the
     normal, the angles i and r, the partly reflected ray (as bright as
     Fresnel says), Snell's law with its numbers, the critical angle and
     total internal reflection; a glass slab and its lateral shift; a
     prism, its deviation, and white light split into colours.

   The physics and the checks are optics-core.js, shared with the server
   and loaded first (document.currentScript.ready, in widgets.js). The
   SVG is drawn at the stage's own pixel size, so its text is readable at
   340 px, and redrawn when the stage resizes. The object and the laser
   take the arrow keys when focused (Shift: five steps). Every spec is
   checked again here, and everything from it goes into the page as text.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;
  const doc = typeof document !== 'undefined' ? document : null;

  /* ---------------- the physics, shared with the server ---------------- */

  let O = window.PrimerOptics || null;
  const ready = O ? Promise.resolve(O) : new Promise((resolve, reject) => {
    let s = doc.querySelector('script[data-optics-core]');
    if (!s) {
      s = doc.createElement('script');
      s.src = '/assets/js/widgets/optics-core.js';
      s.async = true;
      s.setAttribute('data-optics-core', '');
      doc.head.appendChild(s);
    }
    s.addEventListener('load', () => { O = window.PrimerOptics || null; if (O) resolve(O); else reject(new Error('the optics core did not load')); });
    s.addEventListener('error', () => reject(new Error('the optics core could not be loaded')));
  });
  ready.catch(() => {});
  if (doc && doc.currentScript) doc.currentScript.ready = ready;

  /* ---------------- words ---------------- */

  const T = (s) => (P.t ? P.t(s) : s);
  const F = (s, v) => T(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m));
  function andList(items) {
    try { return new Intl.ListFormat(P.lang || 'en', { type: 'conjunction' }).format(items); } catch (e) { return items.join(', '); }
  }
  const MINUS = '−';
  const nf = (x, d) => O.fmt(x, d == null ? 1 : d, false, MINUS);
  const sg = (x, d) => O.fmt(x, d == null ? 1 : d, true, MINUS);
  const cm = (x, d) => sg(x, d) + ' cm';
  const dg = (x, d) => nf(x, d) + '°';
  // a fixed number of decimals, as in a sum or a table (+0.100, 1.50)
  const fx = (x, d, signed) => { const s = Math.abs(x).toFixed(d); return (x < 0 && Number(s) !== 0 ? MINUS : signed ? '+' : '') + s; };
  const nIdx = (n) => fx(n, 2);

  // the media's names (a made-up one keeps its own, which the translator has seen: server texts())
  function mediumName(t, m) {
    if (!m) return '';
    switch (m.key) {
      case 'air': return t('air');
      case 'vacuum': return t('vacuum');
      case 'ice': return t('ice');
      case 'water': return t('water');
      case 'alcohol': return t('alcohol');
      case 'kerosene': return t('kerosene');
      case 'quartz': return t('quartz');
      case 'turpentine': return t('turpentine oil');
      case 'benzene': return t('benzene');
      case 'glass': return t('glass');
      case 'crown glass': return t('crown glass');
      case 'canada balsam': return t('Canada balsam');
      case 'rock salt': return t('rock salt');
      case 'carbon disulphide': return t('carbon disulphide');
      case 'flint glass': return t('flint glass');
      case 'ruby': return t('ruby');
      case 'sapphire': return t('sapphire');
      case 'diamond': return t('diamond');
      default: return m.name || t('a medium');
    }
  }
  const withN = (t, m) => `${mediumName(t, m)} (n = ${nIdx(m.n)})`;

  // an image's nature, in words
  function natureWords(st, t) {
    if (!st || st.infinite) return [];
    return [st.real ? t('real') : t('virtual'), st.inverted ? t('inverted') : t('erect'),
      st.size === 'magnified' ? t('magnified') : st.size === 'diminished' ? t('diminished') : t('the same size')];
  }
  function wantWord(key, val, t) {
    if (key === 'nature') return val === 'real' ? t('real') : t('virtual');
    if (key === 'orientation') return val === 'inverted' ? t('inverted') : t('erect');
    return val === 'magnified' ? t('magnified') : val === 'diminished' ? t('diminished') : t('the same size');
  }
  // the marks on the axis, as textbooks letter them
  function markNames(spec, x) {
    const lens = spec.mode === 'lens', right = x > 0;
    return lens ? { F: right ? 'F₂' : 'F₁', C: right ? '2F₂' : '2F₁', O: 'O' } : { F: 'F', C: 'C', O: 'P' };
  }
  // where a point on the axis is ("between F₁ and 2F₁")
  function where(spec, f, x, t, fill) {
    const z = O.zone(spec.mode, spec.kind, f, x);
    const n = markNames(spec, x);
    switch (z) {
      case 'beyond2F': return fill('beyond {a}', { a: n.C });
      case 'at2F': return fill('at {a}', { a: n.C });
      case 'between': return fill('between {a} and {b}', { a: n.F, b: n.C });
      case 'atF': return fill('at {a}', { a: n.F });
      case 'inside': return fill('between {a} and {b}', { a: n.F, b: n.O });
      case 'front': return t('in front of the mirror');
      case 'behind': return t('behind the mirror');
      case 'infinity': return t('at infinity');
      default: return fill('at {a}', { a: n.O });
    }
  }
  // the controls' values, in symbols ("u = −20 cm, f = +12 cm")
  function settingText(spec, v) {
    if (spec.mode === 'refraction') return 'i = ' + dg(v.i) + (spec.media ? ', ' + mediumName(T, spec.media[v.m]) : '');
    const c = O.benchControls(spec), bits = ['u = ' + cm(v.u)];
    if (c.f) bits.push('f = ' + cm(v.f));
    if (c.h) bits.push('h = ' + nf(v.h) + ' cm');
    return bits.join(', ');
  }
  // what a setting does, in a sentence
  function result(spec, st, t, fill) {
    const set = settingText(spec, spec.mode === 'refraction' ? { i: st.i, m: st.m } : { u: st.u, f: st.f, h: st.h });
    if (spec.mode === 'refraction') {
      if (spec.shape === 'prism') {
        if (st.e == null) return fill('{set}: total internal reflection inside the prism', { set });
        return fill('{set}: e = {e}, deviation δ = {d}', { set, e: dg(st.e), d: dg(st.deviation) });
      }
      if (st.tir) return fill('{set}: total internal reflection', { set });
      return st.shift != null ? fill('{set}: r = {r}, lateral shift {d}', { set, r: dg(st.r), d: nf(st.shift, 2) + ' cm' }) : fill('{set}: r = {r}', { set, r: dg(st.r) });
    }
    if (st.infinite) return fill('{set}: the image is at infinity', { set });
    return fill('{set}: v = {v}, m = {m} ({what})', { set, v: cm(st.v), m: sg(st.m, 2), what: andList(natureWords(st, t)) });
  }

  /* ---------------- drawing: a tiny tree of SVG nodes, made into markup (the book) or DOM (the page) ---------------- */

  const SVGNS = 'http://www.w3.org/2000/svg';
  const INK = '#2b1d11', SOFT = '#5b4730', GOLD = '#8a6128', RED = '#9a3324', PAPER = '#f6eedb', EDGE = '#c9b48a';
  const GLASS = '#7fb2c9', GLASS_EDGE = '#4f7f93', WOOD = '#e8d7ae';
  const RAY = { parallel: '#c4561a', centre: '#a3321c', focus: '#b07a10', pole: '#8f5a24', normal: '#c4561a' };
  const GLOW = '#f2b552';
  const LASER = '#d03a22', LASER_GLOW = '#ff9c70';
  const HUES = { red: '#d42a1e', orange: '#e8771b', yellow: '#cfa50c', green: '#3f9a3a', blue: '#2f6fd0', indigo: '#4b3aa8', violet: '#8a3ab8' };
  let uid = 0;

  const el = (tag, attrs, kids) => ({ tag, attrs: attrs || {}, kids: (kids || []).filter((k) => k != null && k !== false) });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toStr(n) {
    if (n == null) return '';
    if (typeof n === 'string') return esc(n);
    const a = Object.keys(n.attrs).filter((k) => n.attrs[k] != null && n.attrs[k] !== false).map((k) => ` ${k}="${esc(n.attrs[k])}"`).join('');
    return `<${n.tag}${a}>${n.kids.map(toStr).join('')}</${n.tag}>`;
  }
  function toDom(n) {
    if (typeof n === 'string') return doc.createTextNode(n);
    const d = doc.createElementNS(SVGNS, n.tag);
    Object.keys(n.attrs).forEach((k) => { if (n.attrs[k] != null && n.attrs[k] !== false) d.setAttribute(k, String(n.attrs[k])); });
    n.kids.forEach((k) => d.appendChild(toDom(k)));
    return d;
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const unit = (v) => { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; };
  const line = (a, b, attrs) => el('line', Object.assign({ x1: r1(a[0]), y1: r1(a[1]), x2: r1(b[0]), y2: r1(b[1]) }, attrs || {}));
  const poly = (pts, attrs) => el('polyline', Object.assign({ points: pts.map((p) => r1(p[0]) + ',' + r1(p[1])).join(' '), fill: 'none' }, attrs || {}));
  const words = (x, y, s, attrs) => el('text', Object.assign({ x: r1(x), y: r1(y) }, attrs || {}), [s]);
  const HALO = { 'paint-order': 'stroke', stroke: PAPER, 'stroke-width': 3.5, 'stroke-linejoin': 'round' };
  // a small arrowhead at p, pointing along d (screen units)
  function arrowAt(p, d, colour, size) {
    const s = size || 6.5, u = unit(d), n = [-u[1], u[0]];
    const tip = [p[0] + u[0] * s, p[1] + u[1] * s], a = [p[0] - u[0] * s * 0.6 + n[0] * s * 0.75, p[1] - u[1] * s * 0.6 + n[1] * s * 0.75], b = [p[0] - u[0] * s * 0.6 - n[0] * s * 0.75, p[1] - u[1] * s * 0.6 - n[1] * s * 0.75];
    return el('polygon', { points: [tip, a, b].map((q) => r1(q[0]) + ',' + r1(q[1])).join(' '), fill: colour, stroke: 'none' });
  }
  // how far along d from p the ray stays inside the box [0, W] x [0, H]
  function exitT(p, d, W, H) {
    let t = 1e6;
    if (d[0] > 1e-9) t = Math.min(t, (W - p[0]) / d[0]); else if (d[0] < -1e-9) t = Math.min(t, -p[0] / d[0]);
    if (d[1] > 1e-9) t = Math.min(t, (H - p[1]) / d[1]); else if (d[1] < -1e-9) t = Math.min(t, -p[1] / d[1]);
    return Math.max(0, t);
  }

  /* ---------------- the bench ---------------- */

  function benchFrame(spec, width) {
    const W = Math.round(clamp(width || 600, 300, 760));
    const H = Math.round(clamp(W * 0.6, 236, 400));
    const RULER = 28, TOP = 8;
    const bottom = H - RULER;
    const y0 = Math.round((bottom + TOP) / 2);
    const lens = spec.mode === 'lens', plane = spec.kind === 'plane';
    // wide enough for the object's range and 2F (or C) at the focal length it starts with; with a slider, F
    // stays in view as f grows, and 2F may go past the edge
    const f0 = plane ? 0 : Math.abs(spec.f), fMax = plane ? 0 : spec.range.f ? spec.range.f[1] : f0;
    const fSee = Math.max(2.3 * f0, 1.3 * fMax);
    const uFar = Math.abs(spec.range.u ? spec.range.u[0] : spec.object.u);
    let L, R;
    if (lens) { L = Math.max(uFar, fSee) * 1.06; R = L; }
    else if (plane) { L = uFar * 1.08; R = L; }
    else if (spec.kind === 'concave') { L = Math.max(uFar, fSee) * 1.06; R = Math.max(0.5 * L, 1.25 * f0); }
    else { L = Math.max(uFar, 1.5 * f0) * 1.06; R = fSee * 1.06; }
    const padX = 10;
    const sx = (W - 2 * padX) / (L + R);
    const cx = padX + L * sx;
    const hMax = spec.range.h ? spec.range.h[1] : spec.object.h;
    const sy = (y0 - TOP - 8) / (hMax * 2.1);
    const ap = Math.min(y0 - TOP - 2, bottom - y0 - 2); // the lens's or mirror's half-height
    return { W, H, y0, cx, sx, sy, L, R, top: TOP, bottom, ap, X: (c) => cx + c * sx, Y: (c) => y0 - c * sy, cmX: (px) => (px - cx) / sx, cmY: (py) => (y0 - py) / sy };
  }

  // the optical bench's scale along the bottom
  function ruler(fr, t) {
    const kids = [el('rect', { x: 0, y: fr.bottom + 3, width: fr.W, height: fr.H - fr.bottom - 3, fill: WOOD, stroke: EDGE, 'stroke-width': 1 })];
    const minor = [0.5, 1, 2, 5, 10, 20, 50].find((s) => s * fr.sx >= 5) || 50;
    const major = [1, 2, 5, 10, 20, 50, 100, 200].find((s) => s >= minor && Math.round(s / minor) * minor === s && s * fr.sx >= 38) || 200;
    const y = fr.bottom + 3;
    for (let k = Math.ceil(-fr.L / minor); k * minor <= fr.R; k++) {
      const c = Math.round(k * minor * 1e6) / 1e6, x = fr.X(c);
      if (x < 2 || x > fr.W - 2) continue;
      const big = Math.abs(c / major - Math.round(c / major)) < 1e-6;
      kids.push(line([x, y], [x, y + (big ? 8 : 4)], { stroke: SOFT, 'stroke-width': big ? 1.1 : 0.8 }));
      if (big && x > 14 && x < fr.W - 30) kids.push(words(x, y + 19, c === 0 ? '0' : nf(c, 1), { 'text-anchor': 'middle', 'font-size': 11, fill: SOFT, class: 'opt-scale' }));
    }
    kids.push(words(fr.W - 6, y + 19, 'cm', { 'text-anchor': 'end', 'font-size': 11, fill: SOFT, 'font-style': 'italic' }));
    return el('g', { class: 'opt-ruler', 'aria-hidden': 'true' }, kids);
  }

  // the lens (thicker in the middle, or at the edges), or the mirror with its silvered back hatched
  function element(spec, f, fr) {
    const x = fr.cx, y0 = fr.y0, a = fr.ap;
    if (spec.mode === 'lens') {
      if (spec.kind === 'convex') {
        const k = clamp(9 + 70 / Math.max(1, Math.abs(f)), 8, 15) * clamp(fr.W / 640, 0.6, 1); // more curved for a shorter f
        return el('path', { d: `M ${r1(x)} ${r1(y0 - a)} Q ${r1(x + 2 * k)} ${y0} ${r1(x)} ${r1(y0 + a)} Q ${r1(x - 2 * k)} ${y0} ${r1(x)} ${r1(y0 - a)} Z`, fill: GLASS, 'fill-opacity': 0.3, stroke: GLASS_EDGE, 'stroke-width': 1.5, class: 'opt-glass' });
      }
      const w = 9, n = 2.2;
      return el('path', { d: `M ${r1(x - w)} ${r1(y0 - a)} L ${r1(x + w)} ${r1(y0 - a)} Q ${r1(x + 2 * n - w)} ${y0} ${r1(x + w)} ${r1(y0 + a)} L ${r1(x - w)} ${r1(y0 + a)} Q ${r1(x - 2 * n + w)} ${y0} ${r1(x - w)} ${r1(y0 - a)} Z`, fill: GLASS, 'fill-opacity': 0.3, stroke: GLASS_EDGE, 'stroke-width': 1.5, class: 'opt-glass' });
    }
    const s = spec.kind === 'plane' ? 0 : 7, bend = spec.kind === 'concave' ? -1 : 1;
    const xAt = (y) => x + bend * s * ((y - y0) / a) * ((y - y0) / a);
    const d = spec.kind === 'plane' ? `M ${x} ${r1(y0 - a)} L ${x} ${r1(y0 + a)}` : `M ${r1(x + bend * s)} ${r1(y0 - a)} Q ${r1(x - bend * s)} ${y0} ${r1(x + bend * s)} ${r1(y0 + a)}`;
    const hatch = [];
    for (let y = y0 - a + 7; y <= y0 + a; y += 9) hatch.push(line([xAt(y) + 2, y], [xAt(y) + 9, y - 7], { stroke: SOFT, 'stroke-width': 1 }));
    return el('g', { class: 'opt-mirror' }, [el('g', {}, hatch), el('path', { d, fill: 'none', stroke: INK, 'stroke-width': 2.8, 'stroke-linecap': 'round' }),
      el('path', { d, fill: 'none', stroke: '#c9dbe3', 'stroke-width': 1, transform: 'translate(-1.6 0)', 'stroke-linecap': 'round' })]);
  }

  // F, 2F, O (or F, C, P) on the axis
  function marks(spec, f, fr) {
    const items = [];
    if (spec.mode === 'lens') {
      const A = Math.abs(f);
      items.push(['O', 0], ['F₁', -A], ['F₂', A], ['2F₁', -2 * A], ['2F₂', 2 * A]);
    } else if (spec.kind !== 'plane') items.push(['P', 0], ['F', f], ['C', 2 * f]);
    else items.push(['P', 0]);
    const placed = [], kids = [];
    for (const [name, c] of items) {
      const x = fr.X(c);
      if (x < 8 || x > fr.W - 8) continue;
      const lx = c === 0 ? x + 7 : x;
      if (placed.some((p) => Math.abs(p - lx) < 20)) continue;
      placed.push(lx);
      if (c !== 0) kids.push(el('circle', { cx: r1(x), cy: fr.y0, r: 2.8, fill: INK }));
      kids.push(words(lx, fr.y0 + 17, name, Object.assign({ 'text-anchor': c === 0 ? 'start' : 'middle', 'font-size': 14, 'font-style': 'italic', fill: INK, class: 'opt-mark' }, HALO)));
    }
    return el('g', { class: 'opt-marks' }, kids);
  }

  // an arrow or a candle standing on the axis at x, its tip at yTip (an image: red; dashed when virtual)
  function figure(look, x, y0, yTip, o) {
    const colour = o.image ? RED : INK;
    const dash = o.image && !o.real ? '5 4' : null;
    const len = Math.abs(yTip - y0), up = yTip < y0 ? 1 : -1;
    if (len < 0.8) return el('circle', { cx: r1(x), cy: y0, r: 2.6, fill: colour });
    if (look === 'candle') {
      const w = clamp(len * 0.2, 4, 11), body = y0 - up * len * 0.68;
      const flameH = len * 0.32;
      const fy = body - up * flameH; // the flame's tip
      const fw = w * 0.62;
      const flame = `M ${r1(x)} ${r1(fy)} Q ${r1(x + fw * 1.35)} ${r1(body - up * flameH * 0.25)} ${r1(x)} ${r1(body)} Q ${r1(x - fw * 1.35)} ${r1(body - up * flameH * 0.25)} ${r1(x)} ${r1(fy)} Z`;
      return el('g', { class: o.image ? 'opt-image' : 'opt-object', opacity: o.image && !o.real ? 0.78 : null }, [
        el('rect', { x: r1(x - w / 2), y: r1(Math.min(y0, body)), width: r1(w), height: r1(Math.abs(body - y0)), rx: 1.5, fill: o.image ? (o.real ? '#e7c9b8' : 'none') : '#f3e7c8', stroke: colour, 'stroke-width': 1.8, 'stroke-dasharray': dash }),
        el('path', { d: flame, fill: o.image && !o.real ? 'none' : '#f4a92a', stroke: o.image ? colour : '#c4561a', 'stroke-width': 1.4, 'stroke-dasharray': dash }),
        el('path', { d: `M ${r1(x)} ${r1(body - up * flameH * 0.15)} Q ${r1(x + fw * 0.5)} ${r1(body - up * flameH * 0.45)} ${r1(x)} ${r1(body - up * flameH * 0.75)} Q ${r1(x - fw * 0.5)} ${r1(body - up * flameH * 0.45)} ${r1(x)} ${r1(body - up * flameH * 0.15)} Z`, fill: o.image && !o.real ? 'none' : '#fff2b8', stroke: 'none' })
      ]);
    }
    const head = Math.min(11, len * 0.45);
    return el('g', { class: o.image ? 'opt-image' : 'opt-object', opacity: o.image && !o.real ? 0.85 : null }, [
      line([x, y0], [x, yTip + up * head * 0.8], { stroke: colour, 'stroke-width': 3, 'stroke-dasharray': dash, 'stroke-linecap': 'butt' }),
      el('polygon', { points: `${r1(x)},${r1(yTip)} ${r1(x - 6.5)},${r1(yTip + up * head)} ${r1(x + 6.5)},${r1(yTip + up * head)}`, fill: o.image && !o.real ? PAPER : colour, stroke: colour, 'stroke-width': 1.6, 'stroke-dasharray': dash ? '3 2' : null, 'stroke-linejoin': 'round' })
    ]);
  }

  // the principal rays, with arrows; virtual parts dashed
  function benchRays(spec, st, fr) {
    const glows = [], lines = [], heads = [];
    const box = [fr.W, fr.bottom];
    const list = O.principalRays(spec.mode, spec.kind, st.f, st.u, st.h);
    for (const ray of list) {
      const hp = [fr.X(0), fr.Y(ray.hit[1])];
      if (Math.abs(hp[1] - fr.y0) > fr.ap + 0.5) continue; // it would miss the lens or mirror as drawn
      const tp = [fr.X(ray.tip[0]), fr.Y(ray.tip[1])];
      const col = RAY[ray.id] || RAY.parallel;
      const dp = unit([ray.dir[0] * fr.sx, -ray.dir[1] * fr.sy]);
      const ep = [hp[0] + dp[0] * exitT(hp, dp, box[0], box[1]), hp[1] + dp[1] * exitT(hp, dp, box[0], box[1])];
      glows.push(poly([tp, hp, ep], { stroke: GLOW, 'stroke-width': 6, 'stroke-opacity': 0.32, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      lines.push(poly([tp, hp, ep], { stroke: col, 'stroke-width': 1.9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const inc = [hp[0] - tp[0], hp[1] - tp[1]];
      if (Math.hypot(inc[0], inc[1]) > 24) heads.push(arrowAt([tp[0] + inc[0] * 0.55, tp[1] + inc[1] * 0.55], inc, col));
      const outLen = Math.hypot(ep[0] - hp[0], ep[1] - hp[1]);
      if (outLen > 30) { const k = Math.min(70, outLen * 0.45); heads.push(arrowAt([hp[0] + dp[0] * k, hp[1] + dp[1] * k], dp, col)); }
      if (ray.back) lines.push(line(hp, [fr.X(ray.back[0]), fr.Y(ray.back[1])], { stroke: col, 'stroke-width': 1.4, 'stroke-dasharray': '5 4', 'stroke-opacity': 0.8 }));
      if (ray.aim) lines.push(line(hp, [fr.X(ray.aim[0]), fr.Y(ray.aim[1])], { stroke: col, 'stroke-width': 1.2, 'stroke-dasharray': '1.5 3.5', 'stroke-opacity': 0.75 }));
    }
    return el('g', { class: 'opt-rays' }, [el('g', {}, glows), el('g', { fill: 'none' }, lines), el('g', {}, heads)]);
  }

  // the whole bench, for a state; o.t, o.fill: words; o.still: a picture for the book
  function benchScene(spec, st, fr, o) {
    const id = 'opt' + (++uid);
    const t = o.t, fill = o.fill;
    const kids = [el('defs', {}, [el('clipPath', { id: id + 'c' }, [el('rect', { x: 0, y: 0, width: fr.W, height: fr.bottom })])])];
    if (o.still) kids.push(el('rect', { x: 0.5, y: 0.5, width: fr.W - 1, height: fr.H - 1, rx: 4, fill: PAPER, stroke: EDGE }));
    kids.push(ruler(fr, t));
    kids.push(line([0, fr.y0], [fr.W, fr.y0], { stroke: SOFT, 'stroke-width': 1.2, class: 'opt-axis' }));
    kids.push(element(spec, st.f, fr));
    kids.push(marks(spec, st.f, fr));
    const drawn = [benchRays(spec, st, fr)];
    // the image, or where it went
    let note = null;
    if (!st.infinite) {
      const x = fr.X(st.v);
      if (x >= 4 && x <= fr.W - 4) drawn.push(figure(spec.object.look, x, fr.y0, fr.Y(st.hi), { image: true, real: st.real }));
      else {
        const right = x > fr.W;
        note = words(right ? fr.W - 8 : 8, fr.y0 - 8, (right ? '' : '← ') + fill('image at v = {v}', { v: cm(st.v) }) + (right ? ' →' : ''), Object.assign({ 'text-anchor': right ? 'end' : 'start', 'font-size': 13, fill: RED, 'font-style': 'italic', class: 'opt-note' }, HALO));
      }
    }
    drawn.push(figure(spec.object.look, fr.X(st.u), fr.y0, fr.Y(st.h), { image: false }));
    kids.push(el('g', { 'clip-path': `url(#${id}c)` }, drawn));
    if (note) kids.push(note);
    return el('g', {}, kids);
  }

  /* ---------------- refraction ---------------- */

  function rayFrame(spec, width) {
    const W = Math.round(clamp(width || 600, 300, 760));
    const H = Math.round(clamp(W * 0.66, 240, 400));
    const k = H / 14, cx = W / 2 + (spec.shape === 'prism' ? -0.6 * k : 0), cy = H / 2;
    return { W, H, k, X: (x) => cx + x * k, Y: (y) => cy - y * k, wx: (px) => (px - cx) / k, wy: (py) => (cy - py) / k, P: (p) => [cx + p[0] * k, cy - p[1] * k] };
  }
  const tint = (n) => clamp((n - 1) * 0.3, 0, 0.5);

  // an arc for the angle between two screen directions a and b at c, with its letter
  function angleMark(c, a, b, rad, letter, colour) {
    const ua = unit(a), ub = unit(b);
    const cross = ua[0] * ub[1] - ua[1] * ub[0], ang = Math.acos(clamp(ua[0] * ub[0] + ua[1] * ub[1], -1, 1));
    if (ang < 0.03) return null;
    const p1 = [c[0] + ua[0] * rad, c[1] + ua[1] * rad], p2 = [c[0] + ub[0] * rad, c[1] + ub[1] * rad];
    const mid = unit([ua[0] + ub[0], ua[1] + ub[1]]);
    const lp = [c[0] + mid[0] * (rad + 11), c[1] + mid[1] * (rad + 11)];
    return el('g', { class: 'opt-angle' }, [
      el('path', { d: `M ${r1(p1[0])} ${r1(p1[1])} A ${rad} ${rad} 0 0 ${cross > 0 ? 1 : 0} ${r1(p2[0])} ${r1(p2[1])}`, fill: 'none', stroke: colour, 'stroke-width': 1.3 }),
      words(lp[0], lp[1] + 4.5, letter, Object.assign({ 'text-anchor': 'middle', 'font-size': 14, 'font-style': 'italic', fill: colour }, HALO))
    ]);
  }

  function rayScene(spec, st, fr, o) {
    const t = o.t;
    const g = st.geo, P2 = fr.P;
    const kids = [];
    const toN = st.to;
    // the media
    if (o.still) kids.push(el('rect', { x: 0.5, y: 0.5, width: fr.W - 1, height: fr.H - 1, rx: 4, fill: PAPER, stroke: EDGE }));
    kids.push(el('rect', { x: 0, y: 0, width: fr.W, height: fr.H, fill: GLASS, 'fill-opacity': tint(st.n1) }));
    if (spec.shape === 'boundary') {
      const yb = r1(fr.Y(0));
      kids.push(el('rect', { x: 0, y: yb, width: fr.W, height: r1(fr.H - yb), fill: PAPER }));
      kids.push(el('rect', { x: 0, y: yb, width: fr.W, height: r1(fr.H - yb), fill: GLASS, 'fill-opacity': tint(st.n2), class: 'opt-medium' }));
      kids.push(line([0, yb], [fr.W, yb], { stroke: GLASS_EDGE, 'stroke-width': 1.6 }));
    } else {
      const pts = g.poly.map(P2);
      kids.push(el('polygon', { points: pts.map((p) => r1(p[0]) + ',' + r1(p[1])).join(' '), fill: PAPER }));
      kids.push(el('polygon', { points: pts.map((p) => r1(p[0]) + ',' + r1(p[1])).join(' '), fill: GLASS, 'fill-opacity': tint(st.n2), stroke: GLASS_EDGE, 'stroke-width': 1.6, 'stroke-linejoin': 'round', class: 'opt-medium' }));
    }
    // the names of the media
    const lab = (x, y, s, anchor) => words(x, y, s, Object.assign({ 'text-anchor': anchor || 'start', 'font-size': 13.5, fill: INK, class: 'opt-mlabel' }, HALO));
    // (the upper medium's name at the top right: the laser turns through the top left)
    if (spec.shape === 'boundary') {
      kids.push(lab(fr.W - 8, 18, withN(t, spec.from), 'end'));
      kids.push(lab(8, fr.H - 9, withN(t, toN)));
    } else if (spec.shape === 'slab') {
      kids.push(lab(fr.W - 8, 18, withN(t, spec.from), 'end'));
      kids.push(lab(8, fr.Y(g.top) + 18, withN(t, toN)));
    } else {
      kids.push(lab(8, 18, withN(t, spec.from)));
      const base = P2(g.poly[1]);
      kids.push(lab(P2([0, 0])[0], base[1] + 18, withN(t, toN), 'middle'));
      const apex = P2(g.poly[0]);
      kids.push(words(apex[0], apex[1] - 7, 'A = ' + dg(spec.apex, 0), Object.assign({ 'text-anchor': 'middle', 'font-size': 13, 'font-style': 'italic', fill: SOFT }, HALO)));
    }
    // the normals where the light meets a surface
    const norms = [];
    g.events.forEach((ev, k) => {
      if (k > 2) return;
      const L = spec.shape === 'boundary' ? 6.2 : 2.2;
      const a = P2([ev.at[0] + ev.nrm[0] * L, ev.at[1] + ev.nrm[1] * L]), b = P2([ev.at[0] - ev.nrm[0] * L, ev.at[1] - ev.nrm[1] * L]);
      norms.push(line(a, b, { stroke: SOFT, 'stroke-width': 1.1, 'stroke-dasharray': '5 4' }));
    });
    kids.push(el('g', { class: 'opt-normals' }, norms));
    // the light
    const beams = [], heads = [];
    const E = P2(g.E), Lp = P2(g.laser);
    const d0 = unit([g.d0[0], -g.d0[1]]);
    const white = spec.shape === 'prism' && spec.white && g.colours;
    const main = g.main.map(P2);
    const beamCol = white ? '#fffaf0' : LASER;
    // the incident part, from the laser's front
    const front = [Lp[0] + d0[0] * 18, Lp[1] + d0[1] * 18];
    const path = [front].concat(main.slice(1));
    if (white) {
      beams.push(line(front, E, { stroke: SOFT, 'stroke-width': 5.5, 'stroke-opacity': 0.55, 'stroke-linecap': 'round' }));
      beams.push(line(front, E, { stroke: beamCol, 'stroke-width': 3.2, 'stroke-linecap': 'round' }));
      g.colours.forEach((c) => {
        const pts = c.pts.map(P2);
        beams.push(poly(pts, { stroke: HUES[c.colour], 'stroke-width': 1.7, 'stroke-opacity': 0.95, 'stroke-linejoin': 'round' }));
      });
    } else {
      // the partly reflected ray: as bright as the share it gets
      if (g.partial && g.partial.R > 0.001) {
        const pa = P2(g.partial.at), pd = unit([g.partial.d[0], -g.partial.d[1]]);
        const pe = [pa[0] + pd[0] * 9 * fr.k, pa[1] + pd[1] * 9 * fr.k];
        const op = r1(clamp(0.22 + 1.6 * g.partial.R, 0.22, 0.9) * 100) / 100;
        beams.push(line(pa, pe, { stroke: LASER, 'stroke-width': 1.5, 'stroke-opacity': op, class: 'opt-partial' }));
        heads.push(arrowAt([pa[0] + pd[0] * 52, pa[1] + pd[1] * 52], pd, LASER, 5));
      }
      // the slab: where the ray would have gone, to see the lateral shift
      if (spec.shape === 'slab' || spec.shape === 'prism') {
        beams.push(line(E, [E[0] + d0[0] * 7 * fr.k, E[1] + d0[1] * 7 * fr.k], { stroke: SOFT, 'stroke-width': 1.1, 'stroke-dasharray': '3 4' }));
      }
      beams.push(poly(path, { stroke: LASER_GLOW, 'stroke-width': 7, 'stroke-opacity': 0.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      beams.push(poly(path, { stroke: LASER, 'stroke-width': 2.3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'opt-beam' }));
    }
    // arrows along each part of the path
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k], b = path[k + 1];
      const seg = [b[0] - a[0], b[1] - a[1]], len = Math.hypot(seg[0], seg[1]);
      if (len < 26) continue;
      const along = k === path.length - 2 ? Math.min(60, len * 0.5) : len * 0.5;
      const u = unit(seg);
      heads.push(arrowAt([a[0] + u[0] * along, a[1] + u[1] * along], seg, white ? SOFT : LASER, 6));
    }
    kids.push(el('g', { class: 'opt-beams', fill: 'none' }, beams));
    kids.push(el('g', {}, heads));
    // the angles: i and r where it goes in, e where it comes out
    const ev0 = g.events[0];
    if (ev0) {
      const n = unit([ev0.nrm[0], -ev0.nrm[1]]);
      kids.push(angleMark(E, n, [-d0[0], -d0[1]], 30, 'i', GOLD));
      if (!ev0.tir && ev0.r != null) kids.push(angleMark(E, [-n[0], -n[1]], unit([ev0.d[0], -ev0.d[1]]), 40, 'r', GOLD));
    }
    const outEv = g.events.length > 1 ? g.events[g.events.length - 1] : null;
    if (outEv && !outEv.entering && !outEv.tir && spec.shape !== 'boundary') {
      const X = P2(outEv.at), n = unit([-outEv.nrm[0], outEv.nrm[1]]);
      kids.push(angleMark(X, n, unit([outEv.d[0], -outEv.d[1]]), 30, 'e', GOLD));
      if (spec.shape === 'slab' && st.shift != null && st.shift > 0.02) {
        // the shift d: from where it comes out, square to the line it would have gone along
        const w = [X[0] - E[0], X[1] - E[1]], s = w[0] * d0[0] + w[1] * d0[1];
        const foot = [E[0] + d0[0] * s, E[1] + d0[1] * s];
        kids.push(line(X, foot, { stroke: GOLD, 'stroke-width': 1.4 }));
        kids.push(words((X[0] + foot[0]) / 2 + 8, (X[1] + foot[1]) / 2 + 12, 'd', Object.assign({ 'font-size': 14, 'font-style': 'italic', fill: GOLD }, HALO)));
      }
    }
    // the laser itself: a little box along the beam, its window red
    const ang = Math.atan2(d0[1], d0[0]) * 180 / Math.PI;
    kids.push(el('g', { transform: `translate(${r1(Lp[0])} ${r1(Lp[1])}) rotate(${r1(ang)})`, class: 'opt-laser' }, [
      el('rect', { x: -19, y: -7, width: 34, height: 14, rx: 3, fill: INK, stroke: '#140c05', 'stroke-width': 1 }),
      el('rect', { x: 13, y: -4.5, width: 5, height: 9, rx: 1.2, fill: white ? '#fff6d8' : LASER }),
      el('rect', { x: -14, y: -4, width: 12, height: 3, rx: 1, fill: '#5b4730' })
    ]));
    return el('g', {}, kids);
  }

  /* ---------------- the readouts ---------------- */

  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function chip(sym, value) {
    const c = h('span', 'opt-chip');
    c.append(h('i', 'opt-sym', sym), ' = ', h('span', 'opt-val', value));
    return c;
  }
  // (readouts are plain data, [symbol, value] and { cls, text }: the page makes them into elements, the book into text)

  // the bench's numbers and words
  function benchReadout(spec, st, t, fill) {
    const lens = spec.mode === 'lens', plane = spec.kind === 'plane';
    const chips = [['u', cm(st.u)], ['v', st.infinite ? '∞' : cm(st.v)], ['f', plane ? '∞' : cm(st.f)],
      ['m', st.infinite ? '∞' : sg(st.m, 2)], ['h', nf(st.h) + ' cm'], ['h′', st.infinite ? '∞' : cm(st.hi)]];
    const rows = [];
    // the formula, with its numbers
    const inv = (x) => fx(1 / x, 3, true);
    if (plane) rows.push({ cls: 'opt-formula', text: `v = −u = ${cm(st.v)},  m = +1` });
    else if (lens) rows.push({ cls: 'opt-formula', text: `1/v − 1/u = 1/f:  ${st.infinite ? '0' : `(${inv(st.v)})`} − (${inv(st.u)}) = ${inv(st.f)}` });
    else rows.push({ cls: 'opt-formula', text: `1/v + 1/u = 1/f:  ${st.infinite ? '0' : `(${inv(st.v)})`} + (${inv(st.u)}) = ${inv(st.f)}` });
    if (st.infinite) {
      rows.push({ cls: 'opt-say is-key', text: lens ? t('The object is at F₁: the light comes out of the lens parallel, so the image is at infinity.') : t('The object is at F: the reflected light is parallel, so the image is at infinity.') });
    } else {
      rows.push({ cls: 'opt-say is-key', text: fill('Image: {what}', { what: andList(natureWords(st, t)) }) });
      rows.push({ cls: 'opt-say', text: fill('Object {a}; image {b}.', { a: where(spec, st.f, st.u, t, fill), b: where(spec, st.f, st.v, t, fill) }) });
    }
    return { chips, rows };
  }

  function rayReadout(spec, st, t, fill) {
    const chips = [['i', dg(st.i)], ['r', st.r == null ? '—' : dg(st.r)]];
    if (spec.shape !== 'boundary') chips.push(['e', st.e == null ? '—' : dg(st.e)]);
    if (spec.shape === 'prism') chips.push(['δ', st.deviation == null ? '—' : dg(st.deviation)]);
    if (spec.shape === 'slab') chips.push(['d', st.shift == null ? '—' : nf(st.shift, 2) + ' cm']);
    chips.push(['n₁', nIdx(st.n1)], ['n₂', nIdx(st.n2)]);
    const rows = [];
    const s1 = st.n1 * Math.sin(st.i * Math.PI / 180);
    const n1 = nIdx(st.n1), n2 = nIdx(st.n2);
    const ev0 = st.geo.events[0];
    if (ev0 && ev0.tir) rows.push({ cls: 'opt-formula', text: fill('n₁ sin i = {a} × sin {i} = {s}, more than n₂ = {b}: no refracted ray', { a: n1, i: dg(st.i), s: fx(s1, 3), b: n2 }) });
    else if (st.r != null) rows.push({ cls: 'opt-formula', text: `n₁ sin i = n₂ sin r:  ${n1} × sin ${dg(st.i)} = ${n2} × sin ${dg(st.r)} = ${fx(s1, 3)}` });
    // the critical angle, and what happens
    if (spec.shape === 'prism') {
      if (st.critical != null) rows.push({ cls: 'opt-say', text: fill('Critical angle from {a} to {b}: {c}', { a: mediumName(t, st.to), b: mediumName(t, spec.from), c: dg(st.critical) }) });
      if (st.tir) rows.push({ cls: 'opt-say is-key is-tir', text: t('Total internal reflection inside the prism: the ray meets a face at more than the critical angle.') });
      else if (st.deviation != null) {
        rows.push({ cls: 'opt-say is-key', text: fill('Deviation δ = i + e − A = {i} + {e} − {A} = {d}', { i: dg(st.i), e: dg(st.e), A: dg(spec.apex, 0), d: dg(st.deviation) }) });
        if (O.atMinimum(spec, st)) rows.push({ cls: 'opt-say is-good', text: fill('Minimum deviation, {d}: the ray passes through the prism symmetrically (i = e).', { d: dg(st.min) }) });
      }
      if (spec.white && !st.tir) rows.push({ cls: 'opt-say', text: t('White light splits into its colours: violet bends the most, red the least.') });
      return { chips, rows };
    }
    if (st.critical != null) {
      rows.push({ cls: 'opt-say', text: fill('Critical angle from {a} to {b}: {c}', { a: mediumName(t, spec.from), b: mediumName(t, st.to), c: dg(st.critical) }) });
    } else rows.push({ cls: 'opt-say', text: t('No critical angle: going into a denser medium, the ray bends towards the normal.') });
    if (st.tir) rows.push({ cls: 'opt-say is-key is-tir', text: fill('Total internal reflection: i = {i} is more than the critical angle, so all the light is reflected.', { i: dg(st.i) }) });
    else if (st.i === 0) rows.push({ cls: 'opt-say is-key', text: t('Along the normal (i = 0°) the ray goes straight on, without bending.') });
    else if (spec.shape === 'slab' && st.shift != null) rows.push({ cls: 'opt-say is-key', text: fill('The ray comes out parallel to the one that went in, shifted sideways by d = {d}.', { d: nf(st.shift, 2) + ' cm' }) });
    else rows.push({ cls: 'opt-say is-key', text: st.n2 > st.n1 ? t('Into a denser medium the ray bends towards the normal (r < i).') : t('Into a rarer medium the ray bends away from the normal (r > i).') });
    return { chips, rows };
  }

  /* ---------------- the live widget ---------------- */

  function mount(host, spec, goal, ctx, isTask) {
    const t = ctx.t || T, fill = ctx.fill || F;
    const bench = spec.mode !== 'refraction';
    const c = bench ? O.benchControls(spec) : null;
    const canDrag = bench ? c.u || c.h : spec.turn;
    const start = O.startValue(spec);
    let val = Object.assign({}, start);
    let touched = false, locked = false, dead = false, fr = null, mraf = 0, sayTimer = 0, animTimer = 0, focused = false;
    const log = [];

    const root = h('div', 'opt' + (isTask ? ' opt--task' : '') + (bench ? ' opt--bench' : ' opt--ray'));
    root.setAttribute('data-no-i18n', '');
    const stage = h('div', 'opt-stage');
    stage.dir = 'ltr';
    const svg = doc.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'opt-svg');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', bench ? (spec.mode === 'lens' ? (spec.kind === 'convex' ? t('Ray diagram of a convex lens') : t('Ray diagram of a concave lens'))
      : spec.kind === 'concave' ? t('Ray diagram of a concave mirror') : spec.kind === 'convex' ? t('Ray diagram of a convex mirror') : t('Ray diagram of a plane mirror'))
      : spec.shape === 'prism' ? t('A laser beam through a prism') : spec.shape === 'slab' ? t('A laser beam through a glass slab') : t('A laser beam crossing from one medium into another'));
    const scene = doc.createElementNS(SVGNS, 'g');
    const handles = doc.createElementNS(SVGNS, 'g');
    svg.append(scene, handles);
    stage.appendChild(svg);
    root.appendChild(stage);

    // the handle: the object, or the laser
    let hit = null, hitShape = null, ring = null;
    if (canDrag) {
      hit = doc.createElementNS(SVGNS, 'g');
      hit.setAttribute('class', 'opt-handle');
      hit.setAttribute('tabindex', '0');
      hit.setAttribute('role', 'slider');
      hit.setAttribute('aria-label', bench ? t('Object: drag it along the axis') : t('Laser: drag it to turn it'));
      ring = doc.createElementNS(SVGNS, bench ? 'rect' : 'circle');
      ring.setAttribute('class', 'opt-ring');
      hitShape = doc.createElementNS(SVGNS, bench ? 'rect' : 'circle');
      hitShape.setAttribute('class', 'opt-hit');
      hit.append(ring, hitShape);
      handles.appendChild(hit);
    }

    const read = h('div', 'opt-read');
    const rowsBox = h('div', 'opt-rows');
    root.append(read, rowsBox);

    // sliders (and a choice of medium)
    const sliders = [];
    const box = h('div', 'opt-sliders');
    function slider(name, sym, min, max, step, get, set, show) {
      const lab = h('label', 'opt-slider');
      const nm = h('span', 'opt-slider__name');
      nm.append(name + ' ', h('i', 'opt-sym', sym));
      const input = doc.createElement('input');
      input.type = 'range';
      input.min = String(min); input.max = String(max); input.step = String(step);
      input.className = 'opt-range';
      const out = h('output', 'opt-slider__out');
      lab.append(nm, input, out);
      box.appendChild(lab);
      input.addEventListener('input', () => {
        if (locked) { input.value = String(get()); return; }
        set(Number(input.value));
      });
      sliders.push({ input, out, get, show });
    }
    if (bench) {
      if (c.u) slider(t('Object distance'), 'u', spec.range.u[0], spec.range.u[1], spec.step.u, () => val.u, (x) => change({ u: x }), (x) => cm(x));
      if (c.h) slider(t('Object height'), 'h', spec.range.h[0], spec.range.h[1], spec.step.h, () => val.h, (x) => change({ h: x }), (x) => nf(x) + ' cm');
      if (c.f) slider(t('Focal length'), 'f', spec.range.f[0], spec.range.f[1], spec.step.f, () => Math.abs(val.f), (x) => change({ f: Math.sign(spec.f) * x }), (x) => cm(Math.sign(spec.f) * x));
    } else if (spec.turn) slider(t('Angle of incidence'), 'i', spec.range[0], spec.range[1], spec.step, () => val.i, (x) => change({ i: x }), (x) => dg(x));
    let select = null;
    if (!bench && spec.media) {
      const lab = h('label', 'opt-slider opt-choose');
      const nm = h('span', 'opt-slider__name', t('Second medium'));
      select = doc.createElement('select');
      select.className = 'opt-select';
      spec.media.forEach((m, k) => { const op = doc.createElement('option'); op.value = String(k); op.textContent = withN(t, m); select.appendChild(op); });
      select.value = String(val.m);
      select.addEventListener('change', () => { if (locked) { select.value = String(val.m); return; } change({ m: Number(select.value) }); });
      lab.append(nm, select);
      box.appendChild(lab);
    }
    if (box.childNodes.length) root.appendChild(box);

    // the hint, and Reset and Record
    const foot = h('div', 'opt-foot');
    const hintText = bench ? (c.u ? t('Drag the object along the axis, or use the sliders.') : t('Use the sliders.'))
      : spec.turn ? t('Drag the laser to turn it, tap where it should shine from, or use the slider.') : t('Choose the second medium.');
    foot.appendChild(h('span', 'opt-hint', hintText));
    let resetBtn = null, recBtn = null, clearBtn = null;
    if (!isTask) {
      resetBtn = h('button', 'opt-btn', t('Reset'));
      resetBtn.type = 'button';
      resetBtn.addEventListener('click', () => { if (!locked) { val = Object.assign({}, start); touched = false; paint(); } });
      foot.appendChild(resetBtn);
    }
    let table = null, tbody = null;
    if (bench && spec.record) {
      recBtn = h('button', 'opt-btn opt-btn--rec', t('Record this reading'));
      recBtn.type = 'button';
      recBtn.addEventListener('click', record);
      foot.appendChild(recBtn);
    }
    root.appendChild(foot);
    if (bench && spec.record) {
      table = h('table', 'opt-log');
      const cap = h('caption', null, t('Readings'));
      const head = h('tr');
      const cols = ['u (cm)', 'v (cm)'].concat(c.f ? ['f (cm)'] : [], ['m', spec.mode === 'lens' ? '1/v − 1/u' : '1/v + 1/u']);
      cols.forEach((s) => head.appendChild(h('th', null, s)));
      const thead = h('thead'); thead.appendChild(head);
      tbody = h('tbody');
      table.append(cap, thead, tbody);
      clearBtn = h('button', 'opt-btn', t('Clear the readings'));
      clearBtn.type = 'button';
      clearBtn.hidden = true;
      clearBtn.addEventListener('click', () => { log.length = 0; drawLog(); });
      const wrap = h('div', 'opt-logbox');
      wrap.append(table, clearBtn);
      root.appendChild(wrap);
    }
    const live = h('p', 'sr-only');
    live.setAttribute('aria-live', 'polite');
    root.appendChild(live);

    host.textContent = '';
    host.appendChild(root);

    function record() {
      if (locked) return;
      const st = O.state(spec, val);
      if (!st || st.infinite) return;
      log.push({ u: st.u, v: st.v, f: st.f, m: st.m, sum: spec.mode === 'lens' ? 1 / st.v - 1 / st.u : 1 / st.v + 1 / st.u });
      if (log.length > 8) log.shift();
      drawLog();
    }
    function drawLog() {
      if (!tbody) return;
      tbody.textContent = '';
      log.forEach((r) => {
        const tr = h('tr');
        [sg(r.u), sg(r.v)].concat(c.f ? [sg(r.f)] : [], [sg(r.m, 2), fx(r.sum, 3, true)]).forEach((s) => tr.appendChild(h('td', null, s)));
        tbody.appendChild(tr);
      });
      table.classList.toggle('is-empty', !log.length);
      clearBtn.hidden = !log.length;
    }
    if (table) drawLog();

    /* changing things */
    function change(part) {
      if (locked || dead) return;
      const next = Object.assign({}, val, part);
      if (bench) {
        if (c.u) next.u = snap(next.u, spec.range.u, spec.step.u);
        if (c.h) next.h = snap(next.h, spec.range.h, spec.step.h);
        if (c.f) next.f = Math.sign(spec.f) * snap(Math.abs(next.f), spec.range.f, spec.step.f);
        if (next.u === val.u && next.h === val.h && next.f === val.f) return;
      } else {
        if (spec.turn) next.i = snap(next.i, spec.range, spec.step);
        if (next.i === val.i && next.m === val.m) return;
      }
      val = next;
      touched = true;
      paint();
      try { if (ctx.onChange) ctx.onChange(value()); } catch (err) { /* the page's own handler */ }
    }
    const snap = (x, range, step) => Math.round(clamp(Math.round(x / step) * step, range[0], range[1]) * 1e6) / 1e6;

    /* pointer and keys */
    function toSvg(e) {
      const r = svg.getBoundingClientRect(), k = fr.W / (r.width || fr.W);
      return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
    }
    function dragTo(p, off) {
      if (bench) {
        const part = {};
        if (c.u) part.u = Math.min(fr.cmX(p[0] + off[0]), -spec.step.u);
        if (c.h) part.h = fr.cmY(p[1] + off[1]);
        change(part);
      } else change({ i: laserAngle(p) });
    }
    // the angle of incidence for a laser placed towards p
    function laserAngle(p) {
      const g = O.state(spec, val).geo;
      const w = [fr.wx(p[0]) - g.E[0], fr.wy(p[1]) - g.E[1]], n = g.nOut;
      const a = Math.atan2(n[0] * w[1] - n[1] * w[0], n[0] * w[0] + n[1] * w[1]) * 180 / Math.PI;
      return a < -45 ? spec.range[0] : clamp(a, spec.range[0], spec.range[1]); // past the surface: as far as it goes
    }
    let dragging = false;
    if (hit) {
      hit.addEventListener('touchstart', (e) => { if (!locked) e.preventDefault(); }, { passive: false });
      hit.addEventListener('pointerdown', (e) => {
        if (locked || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        e.stopPropagation();
        try { hit.setPointerCapture(e.pointerId); } catch (err) { /* moves still arrive while over it */ }
        try { hit.focus({ preventScroll: true }); } catch (err) { hit.focus(); }
        dragging = true;
        const p0 = toSvg(e);
        const off = bench ? [fr.X(val.u) - p0[0], fr.Y(val.h) - p0[1]] : [0, 0];
        let last = p0;
        const move = (ev) => {
          last = toSvg(ev);
          if (!mraf) mraf = requestAnimationFrame(() => { mraf = 0; if (dragging) dragTo(last, off); });
        };
        const up = () => {
          dragging = false;
          hit.removeEventListener('pointermove', move);
          hit.removeEventListener('pointerup', up);
          hit.removeEventListener('pointercancel', up);
          dragTo(last, off);
        };
        hit.addEventListener('pointermove', move);
        hit.addEventListener('pointerup', up);
        hit.addEventListener('pointercancel', up);
      });
      hit.addEventListener('keydown', (e) => {
        if (locked) return;
        const n = e.shiftKey ? 5 : 1;
        let part = null;
        if (bench) {
          if (c.u && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) part = { u: val.u + (e.key === 'ArrowRight' ? 1 : -1) * n * spec.step.u };
          else if (c.h && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) part = { h: val.h + (e.key === 'ArrowUp' ? 1 : -1) * n * spec.step.h };
          else if (c.u && e.key === 'Home') part = { u: spec.range.u[0] };
          else if (c.u && e.key === 'End') part = { u: spec.range.u[1] };
        } else {
          const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
          if (d) part = { i: val.i + d * n * spec.step };
          else if (e.key === 'Home') part = { i: spec.range[0] };
          else if (e.key === 'End') part = { i: spec.range[1] };
        }
        if (!part) return;
        e.preventDefault();
        change(part);
      });
      hit.addEventListener('focus', () => { focused = true; root.classList.add('is-focus'); });
      hit.addEventListener('blur', () => { focused = false; root.classList.remove('is-focus'); });
    }
    // a tap on the drawing: the object goes there along the axis, or the laser turns to shine from there
    let down = null;
    const onDown = (e) => { down = [e.clientX, e.clientY]; };
    const onClick = (e) => {
      if (locked || !canDrag || !fr || (hit && hit.contains(e.target))) return;
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 10) return;
      const p = toSvg(e);
      if (bench) { if (c.u && p[0] < fr.cx - 4 && p[1] < fr.bottom) change({ u: fr.cmX(p[0]) }); return; }
      const g = O.state(spec, val).geo;
      const w = [fr.wx(p[0]) - g.E[0], fr.wy(p[1]) - g.E[1]];
      if (w[0] * g.nOut[0] + w[1] * g.nOut[1] > 0) change({ i: laserAngle(p) });
    };
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('click', onClick);

    /* drawing */
    function layout() {
      const W = Math.round(stage.clientWidth || 600);
      if (fr && fr.cw === W) return;
      fr = bench ? benchFrame(spec, W) : rayFrame(spec, W);
      fr.cw = W;
      svg.setAttribute('viewBox', `0 0 ${fr.W} ${fr.H}`);
      svg.setAttribute('width', String(fr.W));
      svg.setAttribute('height', String(fr.H));
    }
    function paint() {
      if (dead) return;
      layout();
      const st = O.state(spec, val);
      if (!st) return;
      const tree = bench ? benchScene(spec, st, fr, { t, fill }) : rayScene(spec, st, fr, { t, fill });
      while (scene.firstChild) scene.removeChild(scene.firstChild);
      scene.appendChild(toDom(tree));
      // the handle, over the object or the laser
      if (hit) {
        if (bench) {
          const x = fr.X(st.u), yt = fr.Y(st.h);
          const top = Math.min(yt, fr.y0) - 16, bot = Math.max(yt, fr.y0) + 12;
          const attrs = { x: r1(x - 22), y: r1(top), width: 44, height: r1(Math.max(44, bot - top)), rx: 8 };
          Object.keys(attrs).forEach((k) => { hitShape.setAttribute(k, attrs[k]); ring.setAttribute(k, attrs[k]); });
          hit.setAttribute('aria-valuetext', `u = ${cm(st.u)}` + (c.h ? `, h = ${nf(st.h)} cm` : ''));
          hit.setAttribute('aria-valuemin', String(spec.range.u ? spec.range.u[0] : st.u));
          hit.setAttribute('aria-valuemax', String(spec.range.u ? spec.range.u[1] : st.u));
          hit.setAttribute('aria-valuenow', String(st.u));
        } else {
          const L = fr.P(st.geo.laser);
          [hitShape, ring].forEach((n, k) => { n.setAttribute('cx', r1(L[0])); n.setAttribute('cy', r1(L[1])); n.setAttribute('r', k ? 26 : 24); });
          hit.setAttribute('aria-valuetext', `i = ${dg(st.i)}`);
          hit.setAttribute('aria-valuemin', String(spec.range[0]));
          hit.setAttribute('aria-valuemax', String(spec.range[1]));
          hit.setAttribute('aria-valuenow', String(st.i));
        }
      }
      // the readouts
      const said = bench ? benchReadout(spec, st, t, fill) : rayReadout(spec, st, t, fill);
      read.textContent = '';
      said.chips.forEach(([sym, v]) => read.appendChild(chip(sym, v)));
      rowsBox.textContent = '';
      said.rows.forEach((r) => rowsBox.appendChild(h('p', r.cls, r.text)));
      sliders.forEach((s) => {
        const x = s.get();
        if (Number(s.input.value) !== x) s.input.value = String(x);
        s.out.textContent = s.show(x);
        s.input.setAttribute('aria-valuetext', s.show(x));
      });
      if (select && Number(select.value) !== val.m) select.value = String(val.m);
      if (recBtn) recBtn.disabled = locked || st.infinite;
      // for screen readers, once things settle
      clearTimeout(sayTimer);
      sayTimer = setTimeout(() => { if (!dead) live.textContent = result(spec, st, t, fill) + '.'; }, 700);
    }
    layout();
    paint();
    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => requestAnimationFrame(() => { if (dead || !fr) return; const W = Math.round(stage.clientWidth || 600); if (W !== fr.cw) { fr = null; paint(); } })) : null;
    if (ro) ro.observe(stage);

    function value() {
      if (!touched) return null;
      if (bench) return spec.kind === 'plane' ? { u: val.u, h: val.h } : { u: val.u, f: val.f, h: val.h };
      return spec.media ? { i: val.i, m: val.m } : { i: val.i };
    }
    function setLocked(on) {
      locked = Boolean(on);
      root.classList.toggle('is-locked', locked);
      if (hit) { hit.setAttribute('tabindex', locked ? '-1' : '0'); if (locked) hit.setAttribute('aria-disabled', 'true'); else hit.removeAttribute('aria-disabled'); }
      sliders.forEach((s) => { s.input.disabled = locked; });
      if (select) select.disabled = locked;
      [resetBtn, clearBtn].forEach((b) => { if (b) b.disabled = locked; });
      if (recBtn) recBtn.disabled = locked;
    }

    return {
      value,
      reset() { clearTimeout(animTimer); val = Object.assign({}, start); touched = false; paint(); },
      // to a right answer, the one nearest where the learner is, through the steps in between
      reveal() {
        if (!goal) return;
        const sol = O.solution(spec, goal, val);
        if (!sol) return;
        clearTimeout(animTimer);
        const from = Object.assign({}, val);
        const keys = bench ? ['u', 'f', 'h'].filter((k) => sol[k] != null && from[k] !== sol[k]) : ['i'].filter((k) => from[k] !== sol[k]);
        const stepOf = (k) => (bench ? spec.step[k] || 1 : spec.step);
        const n = Math.min(28, Math.max(0, ...keys.map((k) => Math.round(Math.abs(sol[k] - from[k]) / stepOf(k)))));
        touched = true;
        const done = () => { val = Object.assign({}, sol); paint(); };
        if (ctx.reduce || n < 2) { done(); return; }
        let k = 0;
        const tick = () => {
          if (dead) return;
          k++;
          if (k >= n) { done(); return; }
          const q = k / n, e = 0.5 - Math.cos(Math.PI * q) / 2;
          const next = Object.assign({}, sol);
          keys.forEach((key) => {
            const x = from[key] + (sol[key] - from[key]) * e;
            next[key] = Math.round(Math.round(x / stepOf(key)) * stepOf(key) * 1e6) / 1e6;
          });
          if (!bench && sol.m != null) next.m = sol.m;
          val = next;
          paint();
          animTimer = setTimeout(tick, 22);
        };
        if (!bench && sol.m != null && from.m !== sol.m) val = Object.assign({}, val, { m: sol.m });
        tick();
      },
      lock: setLocked,
      destroy() {
        dead = true;
        clearTimeout(sayTimer);
        clearTimeout(animTimer);
        if (mraf) cancelAnimationFrame(mraf);
        if (ro) ro.disconnect();
        svg.removeEventListener('pointerdown', onDown);
        svg.removeEventListener('click', onClick);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  /* ---------------- checked once, kept ---------------- */

  const checked = new WeakMap(); // spec -> { spec } and goal -> { spec, goal } (or null)
  function cleanSpec(spec) {
    if (!O || !spec || typeof spec !== 'object') return null;
    let m = checked.get(spec);
    if (!m) { m = { goals: new WeakMap() }; checked.set(spec, m); }
    if (!('spec' in m)) { try { m.spec = O.normSpec(spec); } catch (e) { m.spec = null; } }
    return m.spec;
  }
  function cleanTask(spec, goal) {
    if (!O || !spec || typeof spec !== 'object' || !goal || typeof goal !== 'object') return null;
    if (!cleanSpec(spec)) return null;
    const m = checked.get(spec);
    if (!m.goals.has(goal)) { let v = null; try { v = O.normTask(spec, goal); } catch (e) { v = null; } m.goals.set(goal, v); }
    return m.goals.get(goal);
  }

  // until the core has loaded (it is usually there first: widgets.js waits for "ready"), a handle that waits
  function later(host, begin) {
    let hd = null, gone = false;
    const queue = [];
    host.classList.add('is-loading');
    ready.then(() => {
      host.classList.remove('is-loading');
      if (gone) return;
      hd = begin();
      queue.forEach((fn) => fn(hd));
    }).catch((err) => failed(host, err));
    const call = (name) => (...args) => { if (hd) return hd[name](...args); if (name !== 'value') queue.push((x) => x && x[name](...args)); return null; };
    return { value: () => (hd ? hd.value() : null), reset: call('reset'), reveal: call('reveal'), lock: call('lock'), destroy() { gone = true; if (hd) hd.destroy(); } };
  }
  function failed(host, err) {
    host.classList.remove('is-loading');
    host.classList.add('is-failed');
    host.textContent = T('This interactive part couldn’t be shown here.');
    if (err) console.warn('[Primer] optics:', err.message || err);
  }

  // the note with a wrong attempt: what it does, and what it needed
  function note(tk, r) {
    const why = r.why || {}, st = r.state, g = tk.goal;
    if (!st) return '';
    if (g.type === 'image') {
      const now = st.infinite ? '' : andList(natureWords(st, T));
      switch (why.key) {
        case 'infinity':
          return why.want ? F('The image is at v = {v}, not at infinity.', { v: cm(st.v) }) : T('The image is at infinity: the light comes out parallel and never meets.');
        case 'nature': case 'orientation': case 'size':
          return F('The image is {now} (m = {m}); it needs to be {want}.', { now, m: sg(st.m, 2), want: wantWord(why.key, why.want, T) });
        case 'v': case 'm': case 'hi': {
          const show = (x) => (why.key === 'm' ? sg(x, 2) : cm(x));
          const want = Array.isArray(why.want) ? F('between {a} and {b}', { a: show(why.want[0]), b: show(why.want[1]) }) : show(why.want);
          const sym = why.key === 'hi' ? 'h′' : why.key;
          return F('{name} = {got}; it needs to be {want}.', { name: sym, got: show(why.got), want });
        }
        default:
          return F('Not yet: {what}.', { what: result(tk.spec, st, T, F) });
      }
    }
    switch (why.key) {
      case 'tir':
        return why.want ? T('The ray still gets out: no total internal reflection yet.') : T('All the light is reflected (total internal reflection), so there is no refracted ray.');
      case 'critical':
        return F('i = {i}: not at the critical angle yet.', { i: dg(st.i) });
      case 'minimum':
        return st.deviation == null ? T('The ray doesn’t get out of the prism here.') : F('δ = {d}: not the smallest deviation yet.', { d: dg(st.deviation) });
      default:
        if (why.missing) return st.tir ? T('There is no refracted ray: the light is totally internally reflected.') : T('The ray doesn’t come out there.');
        if (why.key && why.got != null) {
          const show = (x) => (why.key === 'shift' ? nf(x, 2) + ' cm' : dg(x));
          const want = Array.isArray(why.want) ? F('between {a} and {b}', { a: show(why.want[0]), b: show(why.want[1]) }) : show(why.want);
          const sym = why.key === 'deviation' ? 'δ' : why.key === 'shift' ? 'd' : why.key;
          return why.key === 'i' ? F('Not yet: {what}.', { what: result(tk.spec, st, T, F) }) : F('{name} = {got}; it needs to be {want}.', { name: sym, got: show(why.got), want });
        }
        return '';
    }
  }

  // a still picture's words under the drawing
  function stillLines(spec, st) {
    const ro = spec.mode === 'refraction' ? rayReadout(spec, st, T, F) : benchReadout(spec, st, T, F);
    return [ro.chips.map(([sym, v]) => `${sym} = ${v}`).join('  ·  ')].concat(ro.rows.filter((r) => /is-key|opt-formula/.test(r.cls)).map((r) => r.text));
  }

  P.widgets.register('optics', {
    ready, // see above

    block(host, spec, ctx) {
      return later(host, () => {
        const s = cleanSpec(spec);
        if (!s) { failed(host, new Error('this bench does not hold together')); return null; }
        return mount(host, s, null, ctx || {}, false);
      });
    },

    task(host, spec, goal, ctx) {
      return later(host, () => {
        const tk = cleanTask(spec, goal);
        if (!tk) { failed(host, new Error('this optics task does not hold together')); return null; }
        return mount(host, tk.spec, tk.goal, ctx || {}, true);
      });
    },

    check(goal, value, spec) {
      const tk = cleanTask(spec, goal);
      if (!tk) return { correct: false, invalid: true };
      const r = O.check(tk.spec, tk.goal, value);
      if (r.invalid) return { correct: false, invalid: true, note: T('Move something first, then press Check.') };
      return r.correct ? { correct: true } : { correct: false, note: note(tk, r) };
    },

    describe(value, spec) {
      const s = cleanSpec(spec);
      if (!s || !value || typeof value !== 'object') return '';
      const st = O.state(s, value);
      return st ? result(s, st, T, F) : '';
    },

    answer(goal, spec) {
      const tk = cleanTask(spec, goal);
      if (!tk) return '';
      const sols = O.solutions(tk.spec, tk.goal);
      if (!sols.length) return '';
      // the right answers along one control, as a run ("any u from −9 cm to −1 cm")
      const key = tk.spec.mode === 'refraction' ? 'i' : 'u';
      const rest = (v) => JSON.stringify(Object.assign({}, v, { [key]: 0 }));
      const same = sols.filter((v) => rest(v) === rest(sols[0])).map((v) => v[key]).sort((a, b) => a - b);
      const step = tk.spec.mode === 'refraction' ? tk.spec.step : tk.spec.step.u;
      const run = same.length >= 3 && same.every((x, k) => !k || Math.abs(x - same[k - 1] - step) < 1e-6);
      if (run) {
        const mid = sols.find((v) => v[key] === same[Math.floor(same.length / 2)]);
        const show = key === 'i' ? dg : cm;
        return F('Any {name} from {a} to {b}; for example {eg}', { name: key, a: show(same[0]), b: show(same[same.length - 1]), eg: result(tk.spec, O.state(tk.spec, mid), T, F) });
      }
      return result(tk.spec, O.state(tk.spec, sols[0]), T, F);
    },

    still(spec, goal) {
      if (!O) return '';
      const tk = goal ? cleanTask(spec, goal) : null;
      const s = tk ? tk.spec : cleanSpec(spec);
      if (!s) return '';
      const st = O.state(s, O.startValue(s));
      if (!st) return '';
      const fr = s.mode === 'refraction' ? rayFrame(s, 600) : benchFrame(s, 600);
      const pic = s.mode === 'refraction' ? rayScene(s, st, fr, { t: T, fill: F, still: true }) : benchScene(s, st, fr, { t: T, fill: F, still: true });
      const textLines = stillLines(s, st);
      const H = fr.H + 12 + textLines.length * 21;
      const said = textLines.map((x, k) => words(8, fr.H + 24 + k * 21, x, { 'font-size': 15, fill: k ? SOFT : INK }));
      const svgTree = el('svg', {
        xmlns: SVGNS, viewBox: `0 0 ${fr.W} ${H}`, width: fr.W, height: H, role: 'img',
        'aria-label': textLines.join('. '), 'font-family': '\'Cormorant Garamond\', Georgia, serif', style: 'font-variant-numeric:lining-nums'
      }, [pic].concat(said));
      return toStr(svgTree);
    }
  });
})();
