/* =====================================================================
   The garden: a course drawn as a gilded vine, like the tooling on an
   old leather binding, that grows as its lessons are finished.

   - Each lesson has a place on the vine. A finished lesson puts out a
     pair of leaves there, and the vine grows as far as the furthest one.
   - Each unit ends in a bud; when every lesson in the unit is finished,
     the bud opens into a crimson flower.
   - A finished course ends in a full bloom.
   - The part not grown yet shows as a faint dotted line: what's to come.

   The same seed always grows the same plant, so a course keeps its shape.

     const g = P.garden.mount(el, { seed, units: [4, 5, 3], height: 120 });
     g.set(done, { animate })   done: a count (the first n lessons) or a
                                Set / array of lesson numbers (1-based)

   With GSAP (assets/vendor/gsap) the new growth unfolds in order: the
   vine, then the leaves, then a flower. Without it, or with reduced
   motion, the plant is simply drawn as it stands.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer = window.Primer || {};
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000;
  let uid = 0;

  // small, fast, seeded: the same course grows the same plant
  function rng(seed) {
    let h = 1779033703 ^ String(seed).length;
    for (const ch of String(seed)) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const el = (name, attrs, parent) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const f = (n) => Math.round(n * 10) / 10;
  const reduce = () => Boolean(P.motion && P.motion.reduce);
  const gsapOK = () => Boolean(window.gsap) && !reduce();

  // a leaf pointing along +x from (0, 0), length L
  const leafPath = (L) => {
    const w = L * 0.34;
    return `M0 0C${f(L * 0.28)} ${f(-w)} ${f(L * 0.72)} ${f(-w * 0.9)} ${f(L)} 0C${f(L * 0.72)} ${f(w * 0.85)} ${f(L * 0.28)} ${f(w)} 0 0Z`;
  };
  // a petal pointing up from (0, 0)
  const petalPath = (L, w) => `M0 0C${f(-w)} ${f(-L * 0.35)} ${f(-w * 0.8)} ${f(-L)} 0 ${f(-L)}C${f(w * 0.8)} ${f(-L)} ${f(w)} ${f(-L * 0.35)} 0 0Z`;

  function mount(host, opts) {
    const o = Object.assign({ seed: 'primer', units: [6], height: 120, label: '' }, opts || {});
    const units = (o.units || []).map((n) => Math.max(0, Math.round(Number(n) || 0))).filter((n) => n > 0);
    if (!units.length) units.push(1);
    const total = units.reduce((a, b) => a + b, 0);
    const H = Math.max(80, o.height);
    const rnd = rng(o.seed);
    const id = 'gd' + (++uid);
    const PAD = 28 + H * 0.12;
    const S = H / 120; // sizes scale with the band's height

    // the vine: two waves, seeded; sampled densely so lengths are exact
    const mid = H * 0.58;
    const a1 = H * (0.15 + rnd() * 0.06), a2 = H * (0.04 + rnd() * 0.03);
    const k1 = ((1.6 + rnd() * 1.1) * Math.PI * 2) / W, k2 = ((4.5 + rnd() * 2.5) * Math.PI * 2) / W;
    const p1 = rnd() * 6.283, p2 = rnd() * 6.283;
    const yAt = (x) => mid + a1 * Math.sin(x * k1 + p1) + a2 * Math.sin(x * k2 + p2);
    const slope = (x) => a1 * k1 * Math.cos(x * k1 + p1) + a2 * k2 * Math.cos(x * k2 + p2);
    const N = 240;
    const pts = [];
    for (let i = 0; i <= N; i++) { const x = PAD + ((W - 2 * PAD) * i) / N; pts.push([x, yAt(x)]); }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const LEN = cum[cum.length - 1];
    const lenAt = (x) => {
      const t = Math.min(N, Math.max(0, ((x - PAD) / (W - 2 * PAD)) * N));
      const i = Math.floor(t), r = t - i;
      return i >= N ? LEN : cum[i] + (cum[i + 1] - cum[i]) * r;
    };
    const d = 'M' + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L');

    // where each lesson sits on the vine
    const xOf = (n) => PAD + ((W - 2 * PAD) * (n - 0.5)) / total; // n is 1-based
    const node = (n) => { const x = xOf(n); return { x, y: yAt(x), a: (Math.atan(slope(x)) * 180) / Math.PI }; };

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'garden__svg', role: 'img', preserveAspectRatio: 'xMidYMid meet', focusable: 'false' });
    const title = el('title', {}, svg);
    const defs = el('defs', {}, svg);
    // colours come from CSS (garden.css), which only reaches a gradient stop through its style
    const stop = (grad, offset, v) => el('stop', { offset, style: `stop-color:var(${v})` }, grad);
    const gold = el('linearGradient', { id: id + 'g', x1: '0', y1: '0', x2: '1', y2: '0' }, defs);
    stop(gold, '0', '--garden-gold-lo'); stop(gold, '.5', '--garden-gold'); stop(gold, '1', '--garden-gold-hi');
    const leafG = el('linearGradient', { id: id + 'l', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
    stop(leafG, '0', '--garden-gold-hi'); stop(leafG, '1', '--garden-gold-lo');
    const petalG = el('radialGradient', { id: id + 'p', cx: '.5', cy: '1', r: '1' }, defs);
    stop(petalG, '0', '--garden-crimson-hi'); stop(petalG, '1', '--garden-crimson');

    el('path', { d, class: 'garden__ghost' }, svg);
    const stem = el('path', { d, class: 'garden__stem', stroke: `url(#${id}g)`, 'stroke-dasharray': f(LEN), 'stroke-dashoffset': f(LEN) }, svg);

    // tendrils: a few curls along the way, grown with the lesson they belong to
    const tendrils = {};
    for (let n = 2; n <= total; n += 2 + Math.floor(rnd() * 3)) {
      if (rnd() < 0.45) continue;
      const p = node(n - 0.5 < 1 ? n : n - 0.5);
      const up = rnd() < 0.5 ? -1 : 1, r = (6 + rnd() * 5) * S;
      const td = `M0 0c${f(r * 0.6)} ${f(up * -r * 0.9)} ${f(r * 2)} ${f(up * -r * 1.2)} ${f(r * 2.2)} ${f(up * -r * 0.2)}` +
        `c${f(r * 0.15)} ${f(up * r * 0.7)} ${f(-r * 0.75)} ${f(up * r * 0.85)} ${f(-r * 0.8)} ${f(up * r * 0.15)}`;
      const g = el('g', { transform: `translate(${f(p.x)} ${f(p.y)}) rotate(${f(p.a)})` }, svg);
      const path = el('path', { d: td, class: 'garden__tendril', stroke: `url(#${id}g)` }, g);
      tendrils[n] = path;
    }

    // leaves: a pair per lesson, one either side, alternating which is larger
    const leaves = {};
    for (let n = 1; n <= total; n++) {
      const p = node(n);
      const big = (13 + rnd() * 6) * S, small = big * (0.72 + rnd() * 0.12);
      const flip = n % 2 ? 1 : -1;
      const pair = [];
      [[-1, flip > 0 ? big : small], [1, flip > 0 ? small : big]].forEach(([side, L]) => {
        const g = el('g', { transform: `translate(${f(p.x)} ${f(p.y)}) rotate(${f(p.a + side * (52 + rnd() * 18))})` }, svg);
        const inner = el('g', { class: 'garden__leaf' }, g);
        el('path', { d: leafPath(L), fill: `url(#${id}l)` }, inner);
        el('path', { d: `M${f(L * 0.08)} 0L${f(L * 0.82)} 0`, class: 'garden__rib' }, inner);
        pair.push(inner);
      });
      // and a smaller sprig on the way to the next lesson, so the vine reads full
      if (n < total) {
        const q = node(n + 0.3 + rnd() * 0.15); // within the stretch of vine this lesson grows
        const side = n % 2 ? 1 : -1, L = (8 + rnd() * 4) * S;
        const g = el('g', { transform: `translate(${f(q.x)} ${f(q.y)}) rotate(${f(q.a + side * (40 + rnd() * 20))})` }, svg);
        const inner = el('g', { class: 'garden__leaf garden__leaf--sprig' }, g);
        el('path', { d: leafPath(L), fill: `url(#${id}l)` }, inner);
        pair.push(inner);
      }
      leaves[n] = pair;
    }

    // a bud, then a flower, at the end of every unit; the last one is the course's full bloom
    const flowers = [];
    let first = 1;
    units.forEach((count, ui) => {
      const lessons = [];
      for (let k = 0; k < count; k++) lessons.push(first + k);
      const last = first + count - 1;
      const isEnd = ui === units.length - 1;
      const p = node(last);
      const sl = (isEnd ? 30 : 20 + rnd() * 8) * S;
      const room = (isEnd ? 20 : 15) * S; // the flower's own radius, kept inside the band
      // alternate above and below the vine, unless that side has no room
      let up = isEnd ? -1 : ui % 2 ? 1 : -1;
      if (p.y + up * sl - room < 0 || p.y + up * sl + room > H) up = -up;
      const lean = (rnd() - 0.5) * 14 * S;
      const tip = { x: p.x + lean, y: Math.max(room, Math.min(H - room, p.y + up * sl)) };
      const g = el('g', { class: 'garden__flower' + (isEnd ? ' is-end' : '') }, svg);
      const stalk = el('path', {
        d: `M${f(p.x)} ${f(p.y)}C${f(p.x)} ${f(p.y + up * sl * 0.5)} ${f(tip.x - lean * 0.2)} ${f(tip.y - up * sl * 0.35)} ${f(tip.x)} ${f(tip.y)}`,
        class: 'garden__stalk', stroke: `url(#${id}g)`
      }, g);
      const head = el('g', { transform: `translate(${f(tip.x)} ${f(tip.y)})` }, g);
      // what GSAP moves never carries a transform of its own (a reset would lose it): turns sit on wrappers
      const budTurn = el('g', { transform: up > 0 ? 'rotate(180)' : 'rotate(0)' }, head);
      const bud = el('path', { d: petalPath(9 * S, 4.6 * S), class: 'garden__bud' }, budTurn);
      const bloom = el('g', { class: 'garden__bloom' }, head);
      const np = isEnd ? 8 : 6;
      const pl = (isEnd ? 17 : 12) * S, pw = (isEnd ? 7.5 : 6) * S;
      const petals = [];
      for (let k = 0; k < np; k++) {
        const turn = el('g', { transform: `rotate(${f((360 / np) * k + rnd() * 8)})` }, bloom);
        petals.push(el('path', { d: petalPath(pl, pw), fill: `url(#${id}p)`, class: 'garden__petal' }, turn));
      }
      const heart = el('circle', { r: f((isEnd ? 4.6 : 3.4) * S), class: 'garden__heart' }, bloom);
      flowers.push({ lessons, stalk, bud, bloom, petals, heart, last, box: g });
      first = last + 1;
    });

    host.classList.add('garden');
    host.textContent = '';
    host.appendChild(svg);

    let state = new Set();
    const norm = (done) => {
      if (done instanceof Set) return new Set([...done].map(Number).filter((n) => n >= 1 && n <= total));
      if (Array.isArray(done)) return new Set(done.map(Number).filter((n) => n >= 1 && n <= total));
      const c = Math.max(0, Math.min(total, Math.round(Number(done) || 0)));
      return new Set(Array.from({ length: c }, (_, i) => i + 1));
    };
    const reach = (set) => (set.size ? lenAt(xOf(Math.max(...set)) + (W - 2 * PAD) / total / 2) : 0);
    const isOpen = (fl, set) => fl.lessons.every((n) => set.has(n));
    const label = (set) => {
      const t = (s, v) => (P.t ? P.t(s) : s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
      title.textContent = o.label || t('{done} of {total} lessons finished', { done: set.size, total });
    };

    // draws the plant as it stands, with no motion
    function paint(set) {
      stem.setAttribute('stroke-dashoffset', f(LEN - reach(set)));
      for (let n = 1; n <= total; n++) leaves[n].forEach((l) => l.classList.toggle('is-on', set.has(n)));
      Object.keys(tendrils).forEach((n) => tendrils[n].classList.toggle('is-on', set.has(Number(n))));
      const r = reach(set);
      flowers.forEach((fl) => {
        fl.box.classList.toggle('is-open', isOpen(fl, set));
        fl.box.classList.toggle('is-reached', r >= lenAt(xOf(fl.last)) - 0.5);
      });
      if (window.gsap) {
        // clear anything GSAP left mid-way, so the classes decide
        window.gsap.killTweensOf([stem, ...Object.values(tendrils), ...Object.values(leaves).flat(), ...flowers.flatMap((x) => [x.bloom, x.bud, x.stalk, ...x.petals])]);
        window.gsap.set([...Object.values(leaves).flat(), ...flowers.flatMap((x) => [x.bloom, x.bud, ...x.petals])], { clearProps: 'transform,opacity' });
        window.gsap.set(Object.values(tendrils), { clearProps: 'strokeDashoffset,strokeDasharray' });
      }
    }

    // grows what is new since the last state (and withers what was undone, at once)
    function grow(set, prev) {
      const g = window.gsap;
      const added = [...set].filter((n) => !prev.has(n)).sort((a, b) => a - b);
      const lost = [...prev].some((n) => !set.has(n));
      if (lost || !added.length) { paint(set); return null; }
      paint(prev); // start from what was there
      const tl = g.timeline({ defaults: { ease: 'power2.out' } });
      const target = LEN - reach(set);
      tl.to(stem, { attr: { 'stroke-dashoffset': f(target) }, duration: Math.min(2.4, 0.6 + added.length * 0.12), ease: 'power1.inOut' }, 0);
      const span = Math.min(2.2, 0.5 + added.length * 0.1);
      added.forEach((n, i) => {
        const at = (span * i) / Math.max(1, added.length);
        flowers.forEach((fl) => { if (fl.last === n) tl.call(() => fl.box.classList.add('is-reached'), null, at + 0.1); });
        leaves[n].forEach((l, s) => {
          l.classList.add('is-on');
          tl.fromTo(l, { scale: 0, transformOrigin: '0% 50%' }, { scale: 1, duration: 0.55, ease: 'back.out(2)' }, at + 0.15 + s * 0.08);
        });
        const td = tendrils[n];
        if (td) {
          td.classList.add('is-on');
          const L = td.getTotalLength ? td.getTotalLength() : 60;
          tl.fromTo(td, { strokeDasharray: L, strokeDashoffset: L }, { strokeDashoffset: 0, duration: 0.7 }, at + 0.2);
        }
      });
      flowers.forEach((fl) => {
        if (!isOpen(fl, set) || isOpen(fl, prev)) return;
        const at = (span * Math.max(0, added.indexOf(fl.last))) / Math.max(1, added.length) + 0.5;
        const box = fl.box;
        tl.call(() => box.classList.add('is-open'), null, at);
        tl.fromTo(fl.bud, { scale: 1, opacity: 1 }, { scale: 0.2, opacity: 0, duration: 0.3, transformOrigin: '50% 100%' }, at);
        tl.fromTo(fl.bloom, { rotation: -40, scale: 0.2, transformOrigin: '50% 50%' }, { rotation: 0, scale: 1, duration: 0.9, ease: 'back.out(1.6)' }, at + 0.1);
        tl.fromTo(fl.petals, { scale: 0, transformOrigin: '50% 100%' }, { scale: 1, duration: 0.6, stagger: 0.06, ease: 'back.out(2.2)' }, at + 0.1);
      });
      return tl;
    }

    const api = {
      total,
      set(done, opt) {
        const next = norm(done);
        const animate = opt && opt.animate && gsapOK();
        const prev = state;
        state = next;
        label(next);
        if (animate) return grow(next, prev);
        paint(next);
        return null;
      },
      get done() { return new Set(state); }
    };
    paint(state);
    label(state);
    return api;
  }

  P.garden = { mount };
})();
