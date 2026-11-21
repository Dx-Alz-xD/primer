/* =====================================================================
   Typographic wall ("The reading room").
   P.initWall(wallEl, { words, onPick(label), shuffleButton })
   Faint letters fill the panel; a scan line reveals words that hold,
   dissolve, rest, repeat. Words are real invisible <button>s.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;

  P.initWall = function (wallEl, { words: WORDS, onPick, shuffleButton } = {}) {
    if (!wallEl) return;
    const canvas = wallEl.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const layer = wallEl.querySelector('.wall__words');
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const T = { scan: 1900, settle: 600, hold: 2800, dissolve: 1300, rest: 1300 };

    let W = 0, H = 0, dpr = 1, cw = 15, ch = 24, cols = 0, rows = 0, offX = 0, offY = 0, fontPx = 15;
    let chars = new Uint8Array(0), alphas = new Float32Array(0), occ = new Int32Array(0);
    let words = [];
    let phase = 'scan', phaseStart = 0, hover = -1, frameNo = 0;
    let visible = false, running = false, raf = 0;

    const buttons = WORDS.map((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wall__word';
      b.setAttribute('aria-label', `Build a course on ${label}`);
      b.addEventListener('pointerenter', () => setHover(i));
      b.addEventListener('pointerleave', () => setHover(-1));
      b.addEventListener('focus', () => setHover(i));
      b.addEventListener('blur', () => setHover(-1));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onPick) onPick(label);
      });
      layer.appendChild(b);
      return b;
    });

    function setHover(i) {
      hover = i;
      if (!running) draw(performance.now());
    }

    function layout() {
      W = wallEl.clientWidth;
      H = wallEl.clientHeight;
      if (!W || !H) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const small = W < 520;
      cw = small ? 13 : 15;
      ch = small ? 21 : 24;
      cols = Math.max(1, Math.floor((W - 16) / cw));
      rows = Math.max(1, Math.floor((H - 16) / ch));
      offX = (W - cols * cw) / 2;
      offY = (H - rows * ch) / 2;
      fontPx = Math.round(ch * 0.64);
      const N = cols * rows;
      chars = new Uint8Array(N);
      alphas = new Float32Array(N);
      occ = new Int32Array(N);
      for (let i = 0; i < N; i++) { chars[i] = P.randInt(26); alphas[i] = P.rand(0.05, 0.15); }
      placeWords();
    }

    function placeWords() {
      const usable = [];
      for (let r = 1; r < rows - 1; r++) usable.push(r);
      const order = P.shuffle(usable);
      words = WORDS.map((label, i) => {
        const text = label.toUpperCase();
        const row = order.length ? order[i % order.length] : 0;
        const maxStart = Math.max(1, cols - text.length - 1);
        const col = 1 + P.randInt(maxStart);
        return { label, text, row, col, letters: Array.from(text, () => ({ rev: Infinity, dis: Infinity })) };
      });
      words.forEach((w, i) => {
        const b = buttons[i];
        b.style.left = `${offX + w.col * cw - 4}px`;
        b.style.top = `${offY + w.row * ch}px`;
        b.style.width = `${w.text.length * cw + 8}px`;
        b.style.height = `${ch}px`;
      });
    }

    function startCycle(now) {
      phase = 'scan';
      phaseStart = now;
      words.forEach((w) => {
        const passAt = now + T.scan * ((w.row + 0.5) / rows);
        w.letters.forEach((L, i) => { L.rev = passAt + i * 45; L.dis = Infinity; });
      });
    }

    function tick(now) {
      const el = now - phaseStart;
      if (phase === 'scan' && el > T.scan + T.settle) { phase = 'hold'; phaseStart = now; }
      else if (phase === 'hold' && el > T.hold) {
        phase = 'dissolve'; phaseStart = now;
        words.forEach((w) => w.letters.forEach((L) => { L.dis = now + P.rand(0, 900); }));
      } else if (phase === 'dissolve' && el > T.dissolve) { phase = 'rest'; phaseStart = now; }
      else if (phase === 'rest' && el > T.rest) { placeWords(); startCycle(now); }
    }

    function letterState(L, correct, now, forced) {
      if (forced || P.motion.reduce) return [1, correct];
      if (now < L.rev) return [0, correct];
      const scramble = () => ALPHA[(Math.floor(now / 55) * 7 + correct.charCodeAt(0) * 13 + P.randInt(3)) % 26];
      if (now < L.rev + 260) return [(now - L.rev) / 260, scramble()];
      if (now < L.dis) return [1, correct];
      if (now < L.dis + 320) return [1 - (now - L.dis) / 320, scramble()];
      return [0, correct];
    }

    function draw(now) {
      if (!cols) return;
      frameNo++;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${fontPx}px "IM Fell English", Georgia, serif`;
      const dimming = hover >= 0;
      const scanY = phase === 'scan' && !P.motion.reduce ? offY + ((now - phaseStart) / T.scan) * rows * ch : -999;

      const drawn = [];
      words.forEach((w, wi) => {
        const forced = hover === wi;
        w.letters.forEach((L, li) => {
          const [v, g] = letterState(L, w.text[li], now, forced);
          if (v <= 0.02) return;
          occ[w.row * cols + w.col + li] = frameNo;
          drawn.push([wi, li, v, g]);
        });
      });

      if (!P.motion.reduce && running) {
        const flick = Math.max(1, Math.round(cols * rows * 0.004));
        for (let k = 0; k < flick; k++) chars[P.randInt(chars.length)] = P.randInt(26);
      }
      for (let r = 0; r < rows; r++) {
        const y = offY + (r + 0.5) * ch;
        const dy = Math.abs(y - scanY);
        const boost = dy < ch * 2.4 ? 1 - dy / (ch * 2.4) : 0;
        ctx.fillStyle = boost > 0.05 ? '#f1cd84' : '#efe2c6';
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (occ[i] === frameNo) continue;
          let a = alphas[i] + boost * 0.55;
          if (dimming) a *= 0.4;
          ctx.globalAlpha = a;
          ctx.fillText(ALPHA[chars[i]], offX + (c + 0.5) * cw, y);
        }
      }

      for (const [wi, li, v, g] of drawn) {
        const w = words[wi];
        const hi = hover === wi;
        ctx.globalAlpha = dimming && !hi ? v * 0.28 : v;
        if (hi) {
          ctx.fillStyle = '#f8dc9c';
          ctx.shadowColor = 'rgba(214,165,84,.9)';
          ctx.shadowBlur = 14;
        } else {
          ctx.fillStyle = '#e2b464';
          ctx.shadowColor = 'rgba(214,165,84,.45)';
          ctx.shadowBlur = dimming ? 0 : 6;
        }
        ctx.fillText(g, offX + (w.col + li + 0.5) * cw, offY + (w.row + 0.5) * ch);
      }
      ctx.shadowBlur = 0;

      if (scanY > 0 && scanY < H) {
        ctx.globalAlpha = 1;
        const g = ctx.createLinearGradient(0, scanY - 30, 0, scanY + 1);
        g.addColorStop(0, 'rgba(214,165,84,0)');
        g.addColorStop(1, 'rgba(214,165,84,.16)');
        ctx.fillStyle = g;
        ctx.fillRect(0, scanY - 30, W, 31);
        ctx.fillStyle = 'rgba(241,205,132,.8)';
        ctx.fillRect(0, scanY, W, 1);
      }
      ctx.globalAlpha = 1;
    }

    function loop(now) { raf = requestAnimationFrame(loop); tick(now); draw(now); }
    function start() {
      if (running || !visible || document.hidden || P.motion.reduce) return;
      running = true;
      raf = requestAnimationFrame(loop);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }
    function shuffle() {
      placeWords();
      startCycle(performance.now());
      if (!running) draw(performance.now());
    }

    wallEl.addEventListener('click', shuffle);
    if (shuffleButton) shuffleButton.addEventListener('click', shuffle);

    let roQueued = false;
    new ResizeObserver(() => {
      if (roQueued) return;
      roQueued = true;
      requestAnimationFrame(() => {
        roQueued = false;
        if (wallEl.clientWidth === W && wallEl.clientHeight === H) return;
        layout();
        startCycle(performance.now());
        if (!running) draw(performance.now());
      });
    }).observe(wallEl);
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) start(); else stop();
    }, { rootMargin: '60px' }).observe(wallEl);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    P.motion.on((rm) => { if (rm) { stop(); draw(performance.now()); } else start(); });
    P.fontsReady.then(() => { if (!running) draw(performance.now()); });

    layout();
    startCycle(performance.now());
    draw(performance.now());
  };
})();
