/* =====================================================================
   Type garden: a topic typed in gold type, with crimson roses, vines,
   leaves and thorns growing from its letters as they are typed. A space
   cuts the word and puts out a last rose, Backspace withers a letter,
   the roses turn to face the pointer, and a click sends a butterfly to
   settle on one.

   Adapted from Type Garden by Akshat Agarwal (type-garden.vercel.app),
   whose "Copy code" button shares its source: the growth, the roses,
   the weave of stems in front of and behind the letters, the springy
   new letters and the butterflies are his. Here it is plain JavaScript
   (no framework), in Primer's gold and crimson on a clear canvas, sized
   to its box, without the poster, export and multiplayer parts.

     const tg = P.typeGarden(canvas, { colors, font, maxChars })
     tg.typeTo('Black holes')   types it out, letter by letter (after
                                withering what is there that differs)
     tg.mirror(text)            follows a text field: new letters grow,
                                removed ones wither, at once
     tg.settle(ms)              everything this much older (for checks)

   It draws only while on screen and the tab is visible; with reduced
   motion the garden is drawn fully grown and still.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer = window.Primer || {};

  /* ---------------- Type Garden's small maths ---------------- */
  const hsh = (n) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
  const spr = (t, k = 7, w = 16) => (t <= 0 ? 0 : 1 - Math.exp(-t * k) * Math.cos(t * w));
  const eo = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));
  function rng(seed) {
    let s = seed | 0;
    return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function bez(a, b, c, d, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]]);
    }
    return out;
  }
  function at(pts, u) {
    const n = pts.length, i = Math.min(n - 2, Math.max(1, Math.round(u * (n - 1))));
    return [pts[i], Math.atan2(pts[i + 1][1] - pts[i - 1][1], pts[i + 1][0] - pts[i - 1][0])];
  }
  function jit(id, f, amp) {
    if (!amp) return [0, 0, 0];
    return [(hsh(id * 1.37 + f * 7.13) * 2 - 1) * amp, (hsh(id * 2.71 + f * 3.11) * 2 - 1) * amp, (hsh(id * 5.3 + f * 1.7) * 2 - 1) * 0.035];
  }
  function trace(c, p, closed) {
    const n = p.length;
    if (n < 2) return;
    const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (closed) {
      const s = m(p[n - 1], p[0]);
      c.moveTo(s[0], s[1]);
      for (let i = 0; i < n; i++) { const q = m(p[i], p[(i + 1) % n]); c.quadraticCurveTo(p[i][0], p[i][1], q[0], q[1]); }
      c.closePath();
    } else {
      c.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < n - 1; i++) { const q = m(p[i], p[i + 1]); c.quadraticCurveTo(p[i][0], p[i][1], q[0], q[1]); }
      c.lineTo(p[n - 1][0], p[n - 1][1]);
    }
  }
  function vine(base, dir, len, amp, waves, ph, bend, n) {
    n = n || 40;
    const out = [[base[0], base[1]]], step = len / n;
    let x = base[0], y = base[1];
    for (let i = 1; i <= n; i++) {
      const u = i / n, a = dir + bend * u + amp * Math.sin(u * Math.PI * waves + ph) * Math.min(1, u * 3);
      x += Math.cos(a) * step; y += Math.sin(a) * step; out.push([x, y]);
    }
    return out;
  }
  function curl(pts, sign, rad) {
    const n = pts.length, e = pts[n - 1], a = Math.atan2(e[1] - pts[n - 2][1], e[0] - pts[n - 2][0]);
    const c = [e[0] - Math.sin(a) * sign * rad, e[1] + Math.cos(a) * sign * rad];
    const a0 = Math.atan2(e[1] - c[1], e[0] - c[0]);
    for (let i = 1; i <= 14; i++) { const u = i / 14, t = a0 + sign * u * Math.PI * 1.6, rr = rad * (1 - 0.5 * u); pts.push([c[0] + Math.cos(t) * rr, c[1] + Math.sin(t) * rr]); }
    return pts;
  }
  // a stem passes in front of and behind the letters, in turns
  function weave(r, startLayer) {
    const cuts = [], nc = 1 + Math.floor(r() * 3);
    for (let i = 0; i < nc; i++) cuts.push(0.15 + r() * 0.7);
    cuts.sort((a, b) => a - b);
    const segs = [];
    let u0 = 0, layer = startLayer;
    for (const c of cuts) {
      if (c <= u0) continue;
      segs.push({ u0, u1: c, layer });
      if (r() < 0.3) { const gap = 0.02 + r() * 0.03; u0 = Math.min(0.98, c + gap); } else u0 = c;
      layer = 1 - layer;
    }
    segs.push({ u0, u1: 1, layer });
    return segs;
  }
  function layerAt(segs, u) { for (const s of segs) if (u >= s.u0 && u <= s.u1) return s.layer; return segs[segs.length - 1].layer; }
  // letters as a reader sees them: a Hindi or Tamil letter keeps its vowel signs
  const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const graphemes = (s) => (SEG ? Array.from(SEG.segment(s), (x) => x.segment) : Array.from(s));

  P.typeGarden = function (canvas, opts) {
    const o = Object.assign({ density: 1, recoil: 20, boil: true, maxChars: 28 }, opts || {});
    const g = canvas.getContext('2d');
    if (!g) return null;
    const F = o.font || '"Playfair Display", "Tiro Devanagari Hindi", "Noto Serif Devanagari", "Nirmala UI", Georgia, serif';
    // red: the roses; blue: stems and leaves (Type Garden's names); line: a rose's spiral; vein: a leaf's rib
    const C = Object.assign({ red: '#a9142e', blue: '#b98a3e', line: '#f6d690', vein: '#21130a', caret: '#f1cd84',
      text: ['#fff3cf', '#ecc56d', '#c99543', '#8e5f22'], wing: '#f7e7bf', body: '#7a531f' }, o.colors || {});
    const reduce = () => Boolean(P.motion && P.motion.reduce);

    let letters = [], uid = 1, cache = {}, Sd = 0, St = 0, wrapped = false;
    let cx = 0, cy = 0, tcx = 0, tcy = 0, lastKey = 0, t0 = performance.now(), nowRef = 0;
    let W = 0, H = 0, dpr = 1, mx = null, my = null;
    const fa = {};
    let perch = [], flies = [], flt = 0;
    let raf = 0, running = false, visible = true, lt = 0, job = 0;

    /* ---------------- layout ---------------- */
    function mw(ch) {
      if (cache[ch] != null) return cache[ch];
      g.font = `700 100px ${F}`;
      let w = g.measureText(ch).width / 100;
      if (ch === ' ') w *= 1.4;
      return (cache[ch] = w);
    }
    // where each letter goes: one line as large as fits, or wrapped onto lines (with room above and below for the garden)
    function layoutCore(A, prevWrapped) {
      const maxW = W * 0.8, S0 = H * 0.28, LH = 2.0; // room either side for the roses
      const ws = A.map((l) => mw(l.ch));
      const words = [];
      let cur = null;
      A.forEach((l, i) => {
        if (l.ch === ' ') { if (cur) { words.push(cur); cur = null; } words.push({ sp: true, idx: [i] }); } else { if (!cur) cur = { idx: [] }; cur.idx.push(i); }
      });
      if (cur) words.push(cur);
      const lineW = (li, S) => { let e = li.length; while (e > 0 && A[li[e - 1]].ch === ' ') e--; let w = 0; for (let k = 0; k < e; k++) w += ws[li[k]]; return w * S; };
      const wrap = (S) => {
        const lines = [[]];
        let lw = 0;
        for (const w of words) {
          const ww = w.idx.reduce((s, i) => s + ws[i], 0) * S;
          if (!w.sp && lw > 0 && lw + ww > maxW) { lines.push([]); lw = 0; }
          lines[lines.length - 1].push(...w.idx); lw += ww;
        }
        return lines;
      };
      let lines = [A.map((_, i) => i)];
      const unit = lineW(lines[0], 1);
      let S = unit > 0 ? Math.min(S0, maxW / unit) : S0;
      const multi = words.filter((w) => !w.sp).length > 1;
      let wr = multi && (S < H * 0.17 || (prevWrapped && S < H * 0.2));
      if (wr) {
        let lo = H * 0.04, hi = H * 0.24;
        for (let k = 0; k < 22; k++) {
          const mid = (lo + hi) / 2, ls = wrap(mid);
          if (ls.every((li) => lineW(li, mid) <= maxW) && ls.length * LH * mid <= H * 0.86) lo = mid; else hi = mid;
        }
        S = lo; lines = wrap(S);
        if (lines.length < 2) wr = false;
      }
      const n = lines.length, lh = LH * S;
      lines.forEach((li, k) => {
        let x = W / 2 - lineW(li, S) / 2;
        const y = H / 2 + (k - (n - 1) / 2) * lh + 0.33 * S;
        li.forEach((i) => { const l = A[i], w = ws[i] * S; l.tx = x + w / 2; l.ty = y; l.tw = w; x += w; });
      });
      return { S, wrapped: wr };
    }
    function layout(snap) {
      if (!W) return;
      const A = letters.filter((l) => !l.dead);
      const res = layoutCore(A, wrapped);
      wrapped = res.wrapped;
      A.forEach((l) => { if (l.x == null) { l.x = l.tx; l.y = l.ty; } });
      const S = res.S, last = A[A.length - 1];
      St = S;
      tcx = last ? last.tx + last.tw / 2 + 0.07 * S : W / 2;
      tcy = last ? last.ty - 0.33 * S : H / 2;
      if (snap || !Sd) { Sd = S; cx = tcx; cy = tcy; A.forEach((l) => { l.x = l.tx; l.y = l.ty; }); }
    }

    /* ---------------- growing ---------------- */
    function wordParams(ws) {
      const r = rng(ws * 7 + 13), dens = o.density;
      return { roseP: 0.3 + r() * 0.3, leafy: (0.6 + r() * 0.8) * dens, dens, lean: (r() - 0.5) * 0.6, big: 0.85 + r() * 0.45, curvy: 0.8 + r() * 0.6, bridgeP: Math.min(0.95, (0.45 + r() * 0.35) * dens), w: 0.5 };
    }
    function grow(r, E, nid, p, q) {
      const tip = q.tip || (r() < p.roseP ? 'rose' : r() < 0.45 ? 'fan' : r() < 0.6 ? 'leaf' : 'curl');
      let pts = q.pts || vine(q.base, q.dir, q.len, (0.35 + r() * 0.45) * p.curvy, 1 + r() * 1.6, r() * 6.28, (r() - 0.5) * 1.2, 40);
      if (tip === 'curl') pts = curl(pts, r() < 0.5 ? -1 : 1, 0.05 + r() * 0.05);
      const segs = weave(r, q.layer0 != null ? q.layer0 : (r() < 0.5 ? 0 : 1));
      const dur = Math.max(320, (q.len || 0.8) * 620);
      const thorns = [];
      const nt = Math.floor(r() * 2.5);
      for (let i = 0; i < nt; i++) thorns.push({ u: 0.15 + r() * 0.65, s: r() < 0.5 ? -1 : 1 });
      E.push({ t: 'stem', id: nid(), pts, segs, d0: q.d0, dur, w: q.depth ? 0.82 : 1, thorns });
      const nl = Math.floor(r() * 2.8 * p.leafy);
      let sd = r() < 0.5 ? -1 : 1;
      for (let i = 0; i < nl; i++) {
        const u = 0.25 + r() * 0.6, [pt, a] = at(pts, u);
        sd = -sd;
        E.push({ t: 'leaf', id: nid(), x: pt[0], y: pt[1], a: a + sd * (0.55 + r() * 0.5), L: (0.14 + r() * 0.2) * (q.depth ? 0.8 : 1), bend: (r() - 0.5) * 1.2, layer: layerAt(segs, u), d0: q.d0 + dur * u });
      }
      const [tp, ta] = at(pts, 1), td = q.d0 + dur * 0.8, tl = layerAt(segs, 1);
      if (tip === 'rose') {
        const R = (0.13 + r() * 0.15) * p.big * (q.depth ? 0.75 : 1);
        // a rose sitting over the body of a letter mostly goes behind it, so the word stays readable
        const over = tp[1] > -0.78 && tp[1] < 0.05 && Math.abs(tp[0]) < p.w * 0.5;
        const layer = over ? (r() < 0.22 ? 1 : 0) : (r() < 0.6 ? 1 : tl);
        E.push({ t: 'rose', id: nid(), x: tp[0], y: tp[1], R, rot: (r() - 0.5) * 1.0, ph1: r() * 6.28, ph2: r() * 6.28, turns: 1.8 + r() * 1, layer, d0: td });
        if (r() < 0.2) {
          const oo = ta + (r() < 0.5 ? 1 : -1) * 1.3;
          E.push({ t: 'rose', id: nid(), x: tp[0] + Math.cos(oo) * R * 1.4, y: tp[1] + Math.sin(oo) * R * 1.4, R: R * (0.6 + r() * 0.3), rot: (r() - 0.5) * 1.2, ph1: r() * 6.28, ph2: r() * 6.28, turns: 1.8 + r(), layer, d0: td + 120 });
        }
      } else if (tip === 'fan') {
        const spread = 0.6 + r() * 0.3;
        for (let j = 0; j < 2; j++) E.push({ t: 'leaf', id: nid(), x: tp[0], y: tp[1], a: ta + (j - 0.5) * spread, L: 0.2 + r() * 0.2, bend: (j - 0.5) * 0.8, layer: tl, d0: td + j * 60 });
      } else if (tip === 'leaf') {
        E.push({ t: 'leaf', id: nid(), x: tp[0], y: tp[1], a: ta + (r() - 0.5) * 0.3, L: 0.16 + r() * 0.16, bend: r() - 0.5, layer: tl, d0: td });
      }
      if (!q.depth && r() < 0.3) {
        const u = 0.35 + r() * 0.35, [pt, a] = at(pts, u);
        grow(r, E, nid, p, { base: pt, dir: a + (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.4), len: (q.len || 0.8) * (0.35 + r() * 0.2), d0: q.d0 + dur * u, depth: 1, layer0: layerAt(segs, u) });
      }
      return pts;
    }
    function gen(l) {
      const r = rng((l.ws ^ Math.imul(l.wi + 1, 2654435761)) + Math.floor(Math.random() * 1e6));
      const p = wordParams(l.ws), E = [];
      let k0 = 0;
      const nid = () => l.id * 100 + (k0++);
      const w = mw(l.ch), inX = () => (r() - 0.5) * w * 0.7;
      p.w = w;
      const nUp = 1 + (r() < 0.45 * p.dens ? 1 : 0);
      for (let i = 0; i < nUp; i++) {
        grow(r, E, nid, p, { base: [inX(), -r() * 0.3], dir: -Math.PI / 2 + p.lean * 0.5 + (r() - 0.5) * 0.7, len: 0.6 + r() * 0.5, d0: 40 + i * 130, tip: l.wi === 0 && i === 0 ? 'rose' : null });
      }
      if (r() < 0.4 * p.dens) grow(r, E, nid, p, { base: [inX(), -0.1 - r() * 0.35], dir: Math.PI / 2 + (r() - 0.5) * 0.8, len: 0.35 + r() * 0.35, d0: 160 });
      if (l.prev && r() < p.bridgeP) {
        const px = -(mw(l.prev.ch) + w) / 2;
        const a = [inX(), -0.05 - r() * 0.55], b = [px + (r() - 0.5) * 0.25, -0.05 - r() * 0.55];
        const bulge = (r() < 0.55 ? -1 : 1) * (0.4 + r() * 0.4), dx = b[0] - a[0];
        let pts = bez(a, [a[0] + dx * 0.15, a[1] + bulge], [b[0] - dx * 0.15, b[1] + bulge * 0.9], b, 40);
        if (r() < 0.45) pts = pts.slice(0, Math.floor(pts.length * (0.7 + r() * 0.2)));
        grow(r, E, nid, p, { pts, len: Math.abs(dx) + Math.abs(bulge), d0: 90, tip: r() < 0.5 ? 'curl' : r() < 0.5 ? 'leaf' : 'rose' });
      }
      if (l.wi === 0) grow(r, E, nid, p, { base: [-w * 0.3, -0.15 - r() * 0.4], dir: Math.PI + (r() - 0.5) * 1.2, len: 0.45 + r() * 0.3, d0: 120, tip: 'curl' });
      l.els = E;
      l.endEls = null;
      const T = [], tr = rng(l.id * 977 + Math.floor(Math.random() * 1e6));
      grow(tr, T, () => l.id * 100 + 90 + T.length, p, { base: [w * 0.25, -0.1 - tr() * 0.45], dir: (tr() - 0.5) * 1.4, len: 0.45 + tr() * 0.25, d0: 0, tip: 'curl', depth: 1 });
      l.tend = T.filter((e) => e.t === 'stem').slice(0, 1);
    }
    // the end of a word: a few last stems, mostly roses
    function genEnd(l, rel) {
      const r = rng(l.ws + l.wi * 31 + Math.floor(Math.random() * 1e6)), p = wordParams(l.ws), E = [];
      let k0 = 50;
      const nid = () => l.id * 100 + (k0++);
      const w = mw(l.ch), n = 1 + Math.floor(r() * 2.5);
      p.w = w;
      for (let i = 0; i < n; i++) {
        const dir = -Math.PI / 2 + 0.6 + (i - (n - 1) / 2) * 0.9 + (r() - 0.5) * 0.4;
        grow(r, E, nid, p, { base: [(r() - 0.2) * w * 0.6, -r() * 0.5], dir, len: 0.4 + r() * 0.45, d0: rel + 40 + i * 90, depth: 1, tip: i === 0 || r() < 0.5 ? 'rose' : 'fan' });
      }
      l.endEls = E;
    }

    /* ---------------- typing ---------------- */
    const live = () => letters.filter((l) => !l.dead);
    function add(ch, now) {
      const A = live(), last = A[A.length - 1];
      if (ch === ' ') {
        if (!last || last.ch === ' ') return;
        last.cut = now; genEnd(last, now - last.birth);
        letters.push({ ch: ' ', id: uid++, birth: now, els: [] });
        layout(); return;
      }
      const same = last && last.ch !== ' ';
      const l = { ch, id: uid++, birth: now, tb: now, ws: same ? last.ws : Math.floor(Math.random() * 1e9), wi: same ? last.wi + 1 : 0, prev: same ? last : null };
      gen(l);
      letters.push(l);
      layout();
    }
    function wither(now) {
      const A = live(), last = A[A.length - 1];
      if (!last) return;
      last.dead = now;
      const pv = A[A.length - 2];
      if (pv && pv.ch !== ' ') { pv.cut = null; pv.endEls = null; pv.tb = now; }
      layout();
    }
    const clean = (s) => graphemes(String(s || '').replace(/\s+/g, ' ').replace(/^ /, '')).slice(0, o.maxChars);
    const current = () => live().map((l) => l.ch);
    // grown at once (reduced motion): everything as if typed long ago
    const ripen = () => { if (!reduce()) return; letters.forEach((l) => { l.birth -= 1e5; l.tb = (l.tb || l.birth) - 1e5; if (l.cut != null) l.cut -= 1e5; }); };

    /* ---------------- drawing (Type Garden's) ---------------- */
    function backend() {
      return {
        fill: (p, col) => { g.beginPath(); trace(g, p, true); g.fillStyle = col; g.fill(); },
        stroke: (p, col, w) => { g.beginPath(); trace(g, p, false); g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); },
        rect: (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); },
        // gold type: a foil gradient down each letter, and a shadow to lift it off the shelves
        text: (ch, x, y, S) => {
          g.font = `700 ${S}px ${F}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
          const gr = g.createLinearGradient(0, y - S * 0.8, 0, y + S * 0.12);
          gr.addColorStop(0, C.text[0]); gr.addColorStop(0.42, C.text[1]); gr.addColorStop(0.7, C.text[2]); gr.addColorStop(1, C.text[3]);
          g.save();
          g.shadowColor = 'rgba(8,4,1,.8)'; g.shadowBlur = S * 0.08; g.shadowOffsetY = S * 0.03;
          g.fillStyle = gr; g.fillText(ch, x, y);
          g.restore();
        }
      };
    }
    function strokeRange(B, pts, a, b, col, w) {
      const n = pts.length - 1, ia = a * n, ib = b * n;
      const lerp = (t) => { const i = Math.min(n - 1, Math.floor(t)), f = t - i; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]; };
      const out = [lerp(ia)];
      for (let i = Math.floor(ia) + 1; i < ib; i++) out.push(pts[i]);
      out.push(lerp(ib));
      if (out.length >= 2) B.stroke(out, col, w);
    }
    function thorn(B, pts, u, s, S) {
      const [p, a] = at(pts, u), d = a + s * 2.3, L = S * 0.045;
      B.stroke([p, [p[0] + Math.cos(d) * L, p[1] + Math.sin(d) * L]], C.blue, S * 0.022);
    }
    function leaf(B, bx, by, a, L, bend) {
      if (L < 0.5) return;
      const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
      const ax = (u) => { const b = Math.sin(Math.PI * u) * bend * 0.15 * L; return [bx + ca * u * L + px * b, by + sa * u * L + py * b]; };
      const hw = (u) => L * 0.18 * Math.sin(Math.PI * Math.pow(u, 0.8));
      const N = 12, s1 = [], s2 = [];
      for (let i = 0; i <= N; i++) { const u = i / N, c = ax(u), w = hw(u); s1.push([c[0] + px * w, c[1] + py * w]); s2.push([c[0] - px * w, c[1] - py * w]); }
      const tip = ax(1), base = ax(0);
      B.fill([base, ...s1.slice(1, N), tip, tip, ...s2.slice(1, N).reverse(), base], C.blue);
      if (L > 6) { const v = []; for (let i = 0; i <= 8; i++) v.push(ax(0.08 + 0.72 * i / 8)); B.stroke(v, C.vein, Math.max(0.8, L * 0.03)); }
    }
    function rose(B, rcx, rcy, R, rot, e, a, tl) {
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const tm = tl ? Math.hypot(tl[0], tl[1]) : 0, ux = tm ? tl[0] / tm : 0, uy = tm ? tl[1] / tm : 0, sq = -0.28 * tm;
      const T = (x, y, z = 0) => {
        let dx = x * cr - y * sr, dy = x * sr + y * cr;
        if (tm) { const k = (dx * ux + dy * uy) * sq; dx += k * ux + tl[0] * R * z; dy += k * uy + tl[1] * R * z; }
        return [rcx + dx, rcy + dy];
      };
      // petals, back to front: [cx, cy, rx, ry, angle, depth, edge]
      const PET = [
        [0, -0.36, 0.56, 0.54, 0, 0, 0],
        [-0.5, -0.06, 0.6, 0.6, -0.35, 0, 0],
        [0.52, -0.06, 0.6, 0.6, 0.35, 0, 0],
        [-0.42, 0.3, 0.62, 0.48, 0.2, 0.12, 1],
        [0.47, 0.3, 0.62, 0.48, -0.2, 0.12, 1],
        [0.05, 0.42, 0.56, 0.38, 0, 0.14, 0]
      ];
      const ax0 = 0, ay0 = 0.5, lw = Math.max(0.8, R * 0.045), st = 85;
      PET.forEach((q, i) => {
        const s = spr((a - i * st) / 1000, 8, 14);
        if (s <= 0.001) return;
        const open = (1 - Math.min(1, s)) * (q[0] < 0 ? 0.5 : -0.5), ang = q[4] + open, ca = Math.cos(ang), sa = Math.sin(ang);
        const pt = (th) => {
          const rr = 1 + 0.08 * Math.sin(3 * th + e.ph1 + i) + 0.04 * Math.sin(5 * th + e.ph2);
          const lx = Math.cos(th) * q[2] * rr, ly = Math.sin(th) * q[3] * rr;
          const px = q[0] + lx * ca - ly * sa, py = q[1] + lx * sa + ly * ca;
          return T((ax0 + (px - ax0) * s) * R, (ay0 + (py - ay0) * s) * R, q[5]);
        };
        const pts = [];
        for (let k = 0; k < 26; k++) pts.push(pt(k / 26 * Math.PI * 2));
        B.fill(pts, C.red);
        if (q[6] && R >= 12 && s > 0.4) {
          const arc = [];
          for (let k = 0; k <= 14; k++) arc.push(pt(Math.PI * (1.18 + 0.64 * k / 14)));
          strokeRange(B, arc, 0, Math.min(1, (s - 0.4) / 0.5), C.line, lw * 0.8);
        }
      });
      const fr = eo((a - PET.length * st - 80) / 520);
      if (fr > 0 && R > 3) {
        const sp = [], scl = [];
        const turns = R < 20 ? Math.min(e.turns, 1.3) : R < 32 ? e.turns * 0.8 : e.turns;
        for (let i = 0; i <= 70; i++) { const u = i / 70, th = e.ph1 + u * turns * Math.PI * 2, rr = R * (0.08 + 0.57 * u); sp.push(T(Math.cos(th) * rr * 1.05, Math.sin(th) * rr * 0.72 - 0.12 * R, 0.34 - 0.24 * u)); }
        strokeRange(B, sp, 0, fr, C.line, lw);
        if (R >= 14) {
          for (let i = 0; i <= 36; i++) { const u = i / 36; scl.push(T((-0.72 + 1.5 * u) * R, 0.36 * R + 0.16 * R * Math.abs(Math.sin(u * Math.PI * 3)), 0.18)); }
          strokeRange(B, scl, 0, fr, C.line, lw);
        }
      }
    }
    // the nearest pointer: roses and stems lean towards it
    const near = () => (mx != null ? [mx, my] : null);
    function faceTurn(e, x, y) {
      let wx = 0, wy = 0;
      const A = near();
      if (A) {
        const dx = A[0] - x, dy = A[1] - y, d = Math.hypot(dx, dy), reach = 300;
        if (d < reach && d > 0.001) { const w = 1 - d / reach, s = w * w * (3 - 2 * w) * Math.min(1, d / 40); wx = dx / d * s; wy = dy / d * s; }
      }
      const c = fa[e.id] || [0, 0];
      c[0] += (wx - c[0]) * 0.09; c[1] += (wy - c[1]) * 0.09;
      fa[e.id] = c;
      return c;
    }
    function wpt(st, l, x, y) {
      if (l.birth != null) {
        const t = (nowRef - l.birth) / 1000;
        if (t > 0 && t < 2.5) {
          const hh = Math.max(0, (l.y - y) / st.S), dmp = Math.exp(-t * 3.2), dir = l.id % 2 ? 1 : -1;
          x += st.S * 0.07 * hh * dmp * Math.sin(t * 11) * dir;
          y += st.S * 0.035 * hh * dmp * Math.sin(t * 11 + 1.2);
        }
      }
      if (l.lean) {
        const hh = Math.min(2.5, Math.max(0, (l.y - y) / st.S)), f = hh * hh * 0.5 + hh * 0.5;
        x += l.lean[0] * st.S * 0.1 * f;
        y += l.lean[1] * st.S * 0.05 * f;
      }
      return [x, y];
    }
    function drawStem(B, e, l, age, kk, st, f, amp, layer, frO) {
      const S = st.S, fr = frO != null ? frO : eo((age - e.d0) / e.dur) * kk;
      if (fr <= 0) return;
      const j = jit(e.id, f, amp);
      const pts = e.pts.map((p) => wpt(st, l, l.x + p[0] * S + j[0], l.y + p[1] * S + j[1]));
      for (const sg of e.segs) {
        if (sg.layer !== layer) continue;
        const b = Math.min(sg.u1, fr);
        if (b <= sg.u0) continue;
        strokeRange(B, pts, sg.u0, b, C.blue, S * 0.022 * (e.w || 1));
      }
      for (const th of e.thorns) if (fr > th.u && layerAt(e.segs, th.u) === layer) thorn(B, pts, th.u, th.s, S);
    }
    function drawEl(B, e, l, age, kk, st, f, amp) {
      const S = st.S, j = jit(e.id, f, amp), wx = (x, y) => wpt(st, l, l.x + x * S + j[0], l.y + y * S + j[1]);
      if (e.t === 'leaf') {
        const sc = spr((age - e.d0) / 1000, 7, 15) * kk;
        if (sc <= 0) return;
        const p = wx(e.x, e.y);
        leaf(B, p[0], p[1], e.a + j[2], e.L * S * sc, e.bend);
      } else if (e.t === 'rose') {
        const a = age - e.d0;
        if (a < 0 || kk <= 0.001) return;
        const p = wx(e.x, e.y), tl = faceTurn(e, p[0], p[1]);
        if (!l.dead && a > 700) perch.push({ id: e.id, x: p[0], y: p[1], R: e.R * S * kk });
        rose(B, p[0], p[1], e.R * S * kk, e.rot + j[2] + tl[0] * 0.22, e, a, tl);
      }
    }
    function render(B, now) {
      const st = { S: Sd, wither: 260 }, S = st.S, act = live();
      nowRef = now; perch = [];
      for (const l of letters) {
        let tx = 0, ty = 0;
        const A = !l.dead && l.ch !== ' ' ? near() : null;
        if (A) {
          const dx = A[0] - l.x, dy = A[1] - (l.y - S * 0.6), d = Math.hypot(dx, dy), reach = Math.max(260, S * 3.2);
          if (d < reach && d > 1) { const w = 1 - d / reach, s = w * w * (3 - 2 * w); tx = dx / d * s; ty = dy / d * s; }
        }
        const c = l.lean || (l.lean = [0, 0]);
        c[0] += (tx - c[0]) * 0.07; c[1] += (ty - c[1]) * 0.07;
      }
      const boil = o.boil && !reduce();
      const f = boil ? Math.floor(now / 120) : 0, amp = boil ? Math.max(0.8, S * 0.01) : 0;
      const kd = (l) => (l.dead ? 1 - eo((now - l.dead) / st.wither) : 1);
      const draw = (layer) => {
        for (const l of letters) {
          if (l.ch === ' ' || !l.els) continue;
          const age = now - l.birth, kk = kd(l);
          const each = (e) => { if (e.t === 'stem') drawStem(B, e, l, age, kk, st, f, amp, layer); else if (e.layer === layer) drawEl(B, e, l, age, kk, st, f, amp); };
          l.els.forEach(each);
          if (l.endEls) l.endEls.forEach(each);
          const i = act.indexOf(l), nx = i >= 0 ? act[i + 1] : null;
          if (l.tend && (l.dead || !nx || nx.ch === ' ')) {
            let fr = eo((now - l.tb - 150) / 450);
            if (l.cut != null) fr *= 1 - eo((now - l.cut) / 150) * Math.min(0.85, o.recoil / (0.6 * S));
            for (const e of l.tend) drawStem(B, e, l, age, kk, st, f, amp, layer, fr * kk);
          }
        }
      };
      draw(0);
      for (const l of letters) if (l.ch !== ' ' && !l.dead) B.text(l.ch, l.x, l.y, S);
      draw(1);
    }

    /* ---------------- butterflies (Type Garden's) ---------------- */
    function flyOff(fl) { fl.st = 'leave'; fl.pid = null; fl.ex = fl.x < W / 2 ? -80 : W + 80; fl.ey = fl.y - H * 0.3; }
    function spawnFly(x, y) {
      if (flies.length >= 4) { const old = flies.find((fl) => fl.st !== 'leave'); if (old) flyOff(old); }
      const taken = new Set(flies.filter((fl) => fl.st !== 'leave').map((fl) => fl.pid));
      let best = null, bd = 1e9;
      for (const p of perch) { if (taken.has(p.id)) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
      const left = x < W / 2;
      flies.push({ x: left ? -40 : W + 40, y: y + (Math.random() - 0.5) * H * 0.4, vx: 0, vy: 0, st: best ? 'fly' : 'wander', pid: best ? best.id : null,
        hx: x, hy: y, t0: performance.now(), ph: Math.random() * 6, sz: Math.max(9, Sd * 0.09), seed: Math.random() * 100, ang: 0 });
    }
    function butterfly(B, x, y, s, ang, op) {
      const ca = Math.cos(ang), sa = Math.sin(ang), T = (px, py) => [x + (px * ca - py * sa) * s, y + (px * sa + py * ca) * s];
      const wing = (wcx, wcy, rx, ry, a, side) => {
        const pts = [], c = Math.cos(a), sn = Math.sin(a);
        for (let k = 0; k < 22; k++) { const th = k / 22 * Math.PI * 2, r = 1 + 0.08 * Math.sin(th * 3), lx = Math.cos(th) * rx * r, ly = Math.sin(th) * ry * r; pts.push(T(side * (wcx + lx * c - ly * sn) * (0.12 + 0.88 * op), wcy + lx * sn + ly * c)); }
        return pts;
      };
      for (const sd of [-1, 1]) {
        B.fill(wing(0.46, 0.28, 0.36, 0.3, 0.5, sd), C.wing);
        B.fill(wing(0.55, -0.32, 0.55, 0.36, -0.55, sd), C.wing);
        if (op > 0.35) B.fill(wing(0.66, -0.4, 0.13, 0.11, 0, sd), C.red);
      }
      const body = [];
      for (let k = 0; k < 18; k++) { const th = k / 18 * Math.PI * 2; body.push(T(Math.cos(th) * 0.08, Math.sin(th) * 0.48)); }
      B.fill(body, C.body);
      const lw = Math.max(0.8, s * 0.05);
      B.stroke([T(0, -0.42), T(-0.14, -0.72), T(-0.24, -0.86)], C.body, lw);
      B.stroke([T(0, -0.42), T(0.14, -0.72), T(0.24, -0.86)], C.body, lw);
    }
    function drawFlies(B, now) {
      const dt = Math.min(48, now - (flt || now));
      flt = now;
      const byId = {};
      for (const p of perch) byId[p.id] = p;
      flies = flies.filter((fl) => {
        const t = (now - fl.t0) / 1000;
        let tx, ty;
        if (fl.st === 'sit' || fl.st === 'fly') { const p = byId[fl.pid]; if (!p) flyOff(fl); else { tx = p.x + p.R * 0.05; ty = p.y - p.R * 0.55; } }
        if (fl.st === 'wander') { tx = fl.hx + Math.sin(t * 1.3 + fl.seed) * 70; ty = fl.hy + Math.sin(t * 2.1 + fl.seed) * 40; if (t > 3.5) flyOff(fl); }
        if (fl.st === 'leave') { tx = fl.ex; ty = fl.ey; }
        if (fl.st === 'sit') {
          fl.x += (tx - fl.x) * 0.35; fl.y += (ty - fl.y) * 0.35; fl.ang *= 0.85;
          fl.ph += dt * 0.004;
          const burst = Math.sin(now / 1000 * 0.9 + fl.seed) > 0.75;
          fl.open = burst ? 0.2 + 0.8 * Math.abs(Math.cos(now / 1000 * 9 + fl.seed)) : 0.25 + 0.15 * Math.sin(fl.ph);
        } else {
          const dx = tx - fl.x, dy = ty - fl.y, d = Math.hypot(dx, dy) || 1, sp = fl.st === 'leave' ? 0.42 : Math.min(0.34, 0.06 + d * 0.0016);
          const flut = Math.sin(t * 7 + fl.seed) * 0.12, wob = Math.cos(t * 4.3 + fl.seed) * 0.1;
          const ax = (dx / d * sp + wob) - fl.vx, ay = (dy / d * sp + flut) - fl.vy;
          fl.vx += ax * 0.06 * dt / 16; fl.vy += ay * 0.06 * dt / 16;
          fl.x += fl.vx * dt; fl.y += fl.vy * dt + Math.sin(t * 13 + fl.seed) * 0.6;
          fl.ang += (Math.max(-0.5, Math.min(0.5, fl.vx * 1.4)) - fl.ang) * 0.1;
          fl.open = Math.abs(Math.cos(t * 17 + fl.seed));
          if (fl.st === 'fly' && d < 5) { fl.st = 'sit'; fl.ph = 0; }
          if (fl.st === 'leave' && (fl.x < -60 || fl.x > W + 60 || fl.y < -60)) return false;
        }
        butterfly(B, fl.x, fl.y, fl.sz, fl.ang, fl.open);
        return true;
      });
    }

    /* ---------------- the frame ---------------- */
    function paint(now, caret) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const B = backend();
      render(B, now);
      drawFlies(B, now);
      // the typing caret, in gold
      if (caret && !reduce()) {
        const S = Sd, on = now - lastKey < 500 || Math.floor(now / 530) % 2 === 0, hf = eo((now - t0) / 600);
        if (on && hf > 0) { const h = 0.8 * S * hf, w = Math.max(2, S * 0.03); B.rect(cx - w / 2, cy - h / 2, w, h, C.caret); }
      }
    }
    function frame(now) {
      if (!running) return;
      const dt = Math.min(64, now - (lt || now));
      lt = now;
      const k = 1 - Math.exp(-dt / 80);
      Sd += (St - Sd) * k;
      cx += (tcx - cx) * k; cy += (tcy - cy) * k;
      for (const l of letters) if (!l.dead && l.tx != null) { l.x += (l.tx - l.x) * k; l.y += (l.ty - l.y) * k; }
      letters = letters.filter((l) => !(l.dead && now - l.dead > 300));
      paint(now, true);
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running || !visible || document.hidden) return;
      if (reduce()) { layout(true); paint(performance.now(), false); return; }
      running = true; lt = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }
    function still() { if (!running) { layout(true); letters = letters.filter((l) => !l.dead); paint(performance.now(), false); } }

    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      layout(true);
      still();
    }

    // the pointer, in the canvas's own pixels; a click sends a butterfly
    window.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; }, { passive: true });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) mx = null; });
    window.addEventListener('pointerup', (e) => { if (e.pointerType && e.pointerType !== 'mouse') mx = null; });
    canvas.addEventListener('pointerdown', (e) => { if (reduce()) return; const r = canvas.getBoundingClientRect(); spawnFly(e.clientX - r.left, e.clientY - r.top); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) start(); else stop(); }).observe(canvas);
    if ('ResizeObserver' in window) new ResizeObserver(() => resize()).observe(canvas); else window.addEventListener('resize', resize);
    if (P.motion && P.motion.on) P.motion.on((r) => { if (r) { stop(); ripen(); still(); } else start(); });
    // the type's face may arrive after the first letters: measure again once it has
    if (document.fonts && document.fonts.load) document.fonts.load(`700 100px ${F}`).then(() => { cache = {}; layout(true); still(); }).catch(() => {});

    const api = {
      // types a text out, after withering what differs from it, letter by letter
      typeTo(text) {
        const want = clean(text), ticket = ++job;
        const have = current();
        let p = 0;
        while (p < have.length && p < want.length && have[p] === want[p]) p++;
        let cut = have.length - p, i = p;
        const step = () => {
          if (ticket !== job) return;
          const now = performance.now();
          lastKey = now;
          if (cut > 0) { wither(now); cut--; } else if (i < want.length) { add(want[i], now); i++; } else return;
          if (reduce()) { ripen(); still(); }
          setTimeout(step, cut > 0 ? 45 : 90 + Math.random() * 70);
        };
        if (reduce()) { // no typing to watch: the finished garden at once
          job++;
          const now = performance.now();
          for (let k = 0; k < cut; k++) wither(now);
          for (let k = p; k < want.length; k++) add(want[k], now);
          ripen(); letters = letters.filter((l) => !l.dead); still();
          return;
        }
        step();
      },
      // follows a text field at once
      mirror(text) {
        job++;
        const want = clean(text), have = current(), now = performance.now();
        let p = 0;
        while (p < have.length && p < want.length && have[p] === want[p]) p++;
        lastKey = now;
        for (let k = have.length; k > p; k--) wither(now);
        for (let k = p; k < want.length; k++) add(want[k], now);
        if (reduce()) { ripen(); letters = letters.filter((l) => !l.dead); still(); }
      },
      clear() { job++; letters = []; layout(); still(); },
      // everything this much older: a still picture of where the garden is heading (for checks by hand)
      settle(ms) {
        const d = ms || 4000;
        letters.forEach((l) => { l.birth -= d; if (l.tb != null) l.tb -= d; if (l.cut != null) l.cut -= d; if (l.dead) l.dead -= d; });
        letters = letters.filter((l) => !l.dead);
        layout(true);
        paint(performance.now(), false);
      },
      start, stop,
      get text() { return current().join(''); }
    };
    resize();
    start();
    return api;
  };
})();
