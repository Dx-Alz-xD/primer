/* =====================================================================
   The swarm: the library's letters gather into a word.

   Small gold letters (A to Z, numerals, & § ¶) fly together to spell a
   topic, hold its shape while they shimmer and change, and scatter to
   re-form when the topic changes. The ones not needed drift faintly
   behind. The pointer pushes them aside.

     const s = P.swarm(canvas, { max: 1500 });
     s.say('Black holes')    gather into a word ('' lets them all drift)
     s.start() / s.stop()

   Canvas 2D with a glyph atlas drawn once. It pauses off screen and in a
   hidden tab; with reduced motion the word is drawn once and stays still.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer = window.Primer || {};
  const LATIN = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&§¶');
  // a word in another script gathers from that script's own letters (its consonants)
  // [first and last code point of the script's block, then of its consonants]
  const SCRIPTS = [
    [0x0900, 0x097F, 0x0915, 0x0939], // Devanagari: Hindi, Marathi, Bhojpuri, Maithili, Nepali
    [0x0980, 0x09FF, 0x0995, 0x09B9], // Bengali, Assamese
    [0x0A00, 0x0A7F, 0x0A15, 0x0A39], // Gurmukhi
    [0x0A80, 0x0AFF, 0x0A95, 0x0AB9], // Gujarati
    [0x0B00, 0x0B7F, 0x0B15, 0x0B39], // Odia
    [0x0B80, 0x0BFF, 0x0B95, 0x0BB9], // Tamil
    [0x0C00, 0x0C7F, 0x0C15, 0x0C39], // Telugu
    [0x0C80, 0x0CFF, 0x0C95, 0x0CB9], // Kannada
    [0x0D00, 0x0D7F, 0x0D15, 0x0D39], // Malayalam
    [0x0600, 0x06FF, 0x0628, 0x064A], // Arabic, Urdu
    [0x0400, 0x04FF, 0x0410, 0x042F]  // Cyrillic
  ];
  const LETTER = new RegExp(String.fromCharCode(92) + 'p{L}', 'u'); // any letter (skips the block's unassigned places)
  const inBlock = (text, lo, hi) => Array.from(text).some((ch) => { const c = ch.codePointAt(0); return c >= lo && c <= hi; });
  function glyphsFor(text) {
    for (const [lo, hi, a, b] of SCRIPTS) {
      if (!inBlock(text, lo, hi)) continue;
      const out = [];
      for (let c = a; c <= b; c++) { const ch = String.fromCodePoint(c); if (LETTER.test(ch)) out.push(ch); }
      if (out.length > 8) return out;
    }
    return LATIN;
  }
  const C = 48; // atlas cell, in device pixels
  const FONT = '"IM Fell English", "Nirmala UI", "Noto Sans Devanagari", "Noto Sans", Georgia, serif';
  const TONES = ['#c9964a', '#f1cd84', '#8a6128']; // gold, bright gold, old gold

  function atlas(glyphs) {
    const cv = document.createElement('canvas');
    cv.width = glyphs.length * C; cv.height = TONES.length * C;
    const x = cv.getContext('2d');
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `${Math.round(C * (glyphs === LATIN ? 0.78 : 0.62))}px ${FONT}`;
    TONES.forEach((tone, r) => {
      x.fillStyle = tone;
      glyphs.forEach((g, i) => x.fillText(g, i * C + C / 2, r * C + C / 2 + C * 0.04));
    });
    return cv;
  }

  P.swarm = function (canvas, opts) {
    const o = Object.assign({ max: 1500 }, opts || {});
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const reduce = () => Boolean(P.motion && P.motion.reduce);
    let glyphs = LATIN, NG = glyphs.length;
    let sheet = atlas(glyphs);
    let W = 0, H = 0, dpr = 1, max = o.max;
    let n = 0;
    // particles, as parallel typed arrays
    let x, y, vx, vy, tx, ty, sz, al, ta, gl, tn, k, formed, flash;
    let word = '';
    let running = false, raf = 0, visible = true, last = 0, t0 = performance.now();
    const ptr = { x: -1e5, y: -1e5 };

    function alloc(m) {
      const F = (a) => { const b = new Float32Array(m); if (a) b.set(a.subarray(0, Math.min(a.length, m))); return b; };
      x = F(x); y = F(y); vx = F(vx); vy = F(vy); tx = F(tx); ty = F(ty); sz = F(sz); al = F(al); ta = F(ta); k = F(k); flash = F(flash);
      const U = (a) => { const b = new Uint8Array(m); if (a) b.set(a.subarray(0, Math.min(a.length, m))); return b; };
      gl = U(gl); tn = U(tn); formed = U(formed);
    }

    // where the letters of a word should sit, in CSS pixels
    function pointsFor(text) {
      if (!text || !W || !H) return [];
      const off = document.createElement('canvas');
      off.width = Math.ceil(W); off.height = Math.ceil(H);
      const c = off.getContext('2d', { willReadFrequently: true });
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
      // one line if it fits large enough, else two, as big as the box allows
      const words = text.split(/\s+/).filter(Boolean);
      let lines = [text], size = H * 0.7;
      c.font = `${size}px ${FONT}`;
      const fit = (ls) => { let s = H * (ls.length > 1 ? 0.42 : 0.7); c.font = `${s}px ${FONT}`; const w = Math.max(...ls.map((l) => c.measureText(l).width)); if (w > W * 0.94) s *= (W * 0.94) / w; return s; };
      size = fit(lines);
      if (size < H * 0.38 && words.length > 1) {
        let best = null;
        for (let i = 1; i < words.length; i++) {
          const ls = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
          const s = fit(ls);
          if (!best || s > best.s) best = { ls, s };
        }
        if (best && best.s > size) { lines = best.ls; size = best.s; }
      }
      c.font = `${size}px ${FONT}`;
      const lh = size * 1.02;
      // the face's strokes are fine: thicken them, so the letters have room to gather
      c.strokeStyle = '#fff'; c.lineWidth = size * 0.055; c.lineJoin = 'round';
      lines.forEach((l, i) => { const yy = H / 2 + (i - (lines.length - 1) / 2) * lh; c.fillText(l, W / 2, yy); c.strokeText(l, W / 2, yy); });
      const img = c.getImageData(0, 0, off.width, off.height).data;
      // sample on a grid; widen the grid until the word fits the letters there are
      let gap = Math.max(4, Math.round(size / 24));
      let pts;
      for (;;) {
        pts = [];
        for (let yy = gap / 2; yy < off.height; yy += gap) {
          for (let xx = gap / 2; xx < off.width; xx += gap) {
            if (img[((yy | 0) * off.width + (xx | 0)) * 4 + 3] > 140) pts.push([xx + (Math.random() - 0.5) * gap * 0.5, yy + (Math.random() - 0.5) * gap * 0.5]);
          }
        }
        if (pts.length <= max * 0.86 || gap > 40) break;
        gap += 1;
      }
      pts.gap = gap;
      return pts;
    }

    const rand = (a, b) => a + Math.random() * (b - a);

    function assign() {
      const want = glyphsFor(word);
      if (want[0] !== glyphs[0]) {
        glyphs = want; NG = glyphs.length; sheet = atlas(glyphs);
        for (let i = 0; i < n; i++) gl[i] = (Math.random() * NG) | 0;
      }
      const pts = pointsFor(word);
      const gap = pts.gap || 8;
      const need = Math.min(max, Math.max(pts.length + Math.round(max * 0.12), Math.round(max * 0.35)));
      if (need > n) {
        alloc(need);
        for (let i = n; i < need; i++) {
          x[i] = rand(0, W); y[i] = rand(0, H); vx[i] = vy[i] = 0; al[i] = 0;
          gl[i] = (Math.random() * NG) | 0; tn[i] = 0; k[i] = rand(0.035, 0.075);
        }
        n = need;
      }
      // a shuffled order, so letters fly across the word rather than slide
      const order = Array.from({ length: n }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
      order.forEach((p, i) => {
        if (i < pts.length) {
          tx[p] = pts[i][0]; ty[p] = pts[i][1]; ta[p] = rand(0.85, 1); sz[p] = gap * rand(1.7, 2.2); formed[p] = 1;
          tn[p] = Math.random() < 0.38 ? 1 : 0;
        } else {
          tx[p] = rand(0, W); ty[p] = rand(0, H); ta[p] = rand(0.06, 0.2); sz[p] = rand(7, 12); formed[p] = 0; tn[p] = 2;
        }
      });
      if (reduce()) { for (let i = 0; i < n; i++) { x[i] = tx[i]; y[i] = ty[i]; al[i] = ta[i]; } draw(); }
    }

    function step(dt, now) {
      const f = Math.min(2.2, dt / 16.7);
      const R = Math.min(110, W * 0.12), R2 = R * R;
      const time = (now - t0) / 1000;
      for (let i = 0; i < n; i++) {
        let fx = (tx[i] - x[i]) * k[i], fy = (ty[i] - y[i]) * k[i];
        if (formed[i]) {
          // a slow breath while holding the shape
          fx += Math.sin(time * 1.7 + i) * 0.04; fy += Math.cos(time * 1.3 + i * 0.7) * 0.04;
        } else if (Math.random() < 0.004) {
          tx[i] = Math.min(W, Math.max(0, tx[i] + rand(-60, 60))); ty[i] = Math.min(H, Math.max(0, ty[i] + rand(-40, 40)));
        }
        const dx = x[i] - ptr.x, dy = y[i] - ptr.y, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.01) { const d = Math.sqrt(d2), push = (1 - d / R) * 2.4; fx += (dx / d) * push; fy += (dy / d) * push; }
        vx[i] = (vx[i] + fx * f) * Math.pow(0.84, f);
        vy[i] = (vy[i] + fy * f) * Math.pow(0.84, f);
        x[i] += vx[i] * f; y[i] += vy[i] * f;
        al[i] += (ta[i] - al[i]) * Math.min(1, 0.06 * f);
        if (flash[i] > 0) flash[i] = Math.max(0, flash[i] - dt / 420);
      }
      // a few letters change while the word holds, and catch the light
      const swaps = Math.max(1, (n / 260) | 0);
      for (let s = 0; s < swaps; s++) {
        const i = (Math.random() * n) | 0;
        if (formed[i]) { gl[i] = (Math.random() * NG) | 0; flash[i] = 1; }
      }
    }

    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let i = 0; i < n; i++) {
        const a = Math.min(1, al[i] + flash[i] * 0.5);
        if (a < 0.01) continue;
        ctx.globalAlpha = a;
        const s = sz[i] * (1 + flash[i] * 0.25);
        ctx.drawImage(sheet, gl[i] * C, (flash[i] > 0.3 ? 1 : tn[i]) * C, C, C, x[i] - s / 2, y[i] - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      if (!running) return;
      const dt = Math.min(64, now - (last || now));
      last = now;
      step(dt, now);
      draw();
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || reduce() || !visible || document.hidden) return;
      running = true; last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }

    function resize() {
      const r = canvas.getBoundingClientRect();
      const nw = Math.max(1, r.width), nh = Math.max(1, r.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      max = Math.round(o.max * Math.min(1, Math.max(0.6, nw / 1100))); // a phone still gets enough letters to read
      if (Math.abs(nw - W) < 1 && Math.abs(nh - H) < 1 && canvas.width === Math.round(nw * dpr)) return;
      const sx = W ? nw / W : 1, sy = H ? nh / H : 1;
      W = nw; H = nh;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      if (n && Math.abs(sx - 1) < 0.15 && Math.abs(sy - 1) < 0.15) {
        // a small change (a scrollbar, a phone's address bar): the word just scales, nothing flies off
        for (let i = 0; i < n; i++) { x[i] *= sx; tx[i] *= sx; y[i] *= sy; ty[i] *= sy; }
      } else assign();
      if (!running) draw();
    }

    // the pointer, in the canvas's own pixels
    window.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top;
    }, { passive: true });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) ptr.x = ptr.y = -1e5; });
    window.addEventListener('blur', () => { ptr.x = ptr.y = -1e5; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) start(); else stop(); }).observe(canvas);
    }
    if ('ResizeObserver' in window) new ResizeObserver(() => resize()).observe(canvas);
    else window.addEventListener('resize', resize);
    if (P.motion && P.motion.on) P.motion.on((r) => { if (r) { stop(); assign(); } else start(); });

    const api = {
      say(text) {
        const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (t === word) return;
        word = t;
        assign();
        // a scatter before gathering, so a new word arrives rather than morphs
        if (!reduce()) for (let i = 0; i < n; i++) if (formed[i]) { vx[i] += rand(-6, 6); vy[i] += rand(-6, 6); }
        start();
      },
      start, stop,
      // runs the motion forward at once (a still picture of where it is heading; used by tests)
      settle(frames) { for (let i = 0; i < (frames || 240); i++) step(16.7, performance.now() + i * 16.7); draw(); },
      get word() { return word; },
      // what the letters are aiming at (for checking by hand)
      stats() {
        let f = 0, y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9, off = 0;
        for (let i = 0; i < n; i++) if (formed[i]) { f++; y0 = Math.min(y0, ty[i]); y1 = Math.max(y1, ty[i]); x0 = Math.min(x0, tx[i]); x1 = Math.max(x1, tx[i]); off += Math.hypot(x[i] - tx[i], y[i] - ty[i]); }
        return { n, formed: f, W, H, max, running, box: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)], off: f ? Math.round(off / f) : 0, ptr: [Math.round(ptr.x), Math.round(ptr.y)] };
      }
    };

    // the glyphs need the library's face: redraw the atlas once it has loaded
    const ready = document.fonts && document.fonts.load ? document.fonts.load(`40px ${FONT}`).catch(() => null) : Promise.resolve();
    Promise.resolve(ready).then(() => { sheet = atlas(glyphs); resize(); assign(); draw(); start(); });
    resize();
    return api;
  };
})();
