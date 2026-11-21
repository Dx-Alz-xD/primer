/* =====================================================================
   Backdrop: dim library photo + full-screen WebGL2 "Letter Glitch".
   Auto-starts. <body data-backdrop="calm"> gives a quieter version for
   reading pages (fewer flashes, dimmer letters, no click tears).
   Expects this markup:
     <div class="backdrop" aria-hidden="true">
       <div class="backdrop__photo"></div><div class="backdrop__vignette"></div>
       <div class="backdrop__glow"></div><canvas class="backdrop__glitch"></canvas>
     </div>
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;

  function initPhoto(el) {
    if (!el) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      el.style.backgroundImage = `url("${P.config.backdropPhoto}")`;
      el.classList.add('is-loaded');
    };
    img.onerror = () => {
      el.style.backgroundImage = `url(${P.paintShelves(1600, 1000).toDataURL('image/jpeg', 0.82)})`;
      el.classList.add('is-loaded');
    };
    img.src = P.config.backdropPhoto;
  }

  function createLetterGlitch(canvas, { calm = false } = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power'
    });
    if (!gl) { canvas.style.display = 'none'; return null; }

    const GLYPHS = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&§¶†‡');
    const NG = GLYPHS.length;
    const AC = 8;
    const AR = Math.ceil(NG / AC);
    const RADIUS = 150;
    const GAIN = calm ? 0.55 : 1;
    const RATE = calm ? 0.3 : 1;

    const VS = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

    const FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
uniform sampler2D uState;
uniform vec2 uRes;
uniform vec2 uCell;
uniform vec2 uAtlasGrid;
uniform vec2 uMouse;
uniform float uRadius;
uniform float uTime;
uniform float uGain;
out vec4 outColor;

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 cell = floor(frag / uCell);
  vec2 local = (frag - cell * uCell) / uCell;
  vec4 st = texelFetch(uState, ivec2(cell), 0);
  float glyph = floor(st.r * 255.0 + 0.5);
  float flash = st.g;
  float tint = st.b;
  float glitch = st.a;

  float jt = floor(uTime * 24.0);
  vec2 lp = local;
  lp.x += (hash(cell + jt) - 0.5) * glitch * 0.75;
  lp.y += (hash(cell.yx + jt * 1.7) - 0.5) * glitch * 0.2;
  float inside = step(0.0, lp.x) * step(lp.x, 1.0) * step(0.0, lp.y) * step(lp.y, 1.0);

  vec2 g = vec2(mod(glyph, uAtlasGrid.x), floor(glyph / uAtlasGrid.x));
  float a = texture(uAtlas, (g + clamp(lp, 0.0, 1.0)) / uAtlasGrid).a * inside;

  float n = vnoise(cell * vec2(0.07, 0.11) + vec2(uTime * 0.045, -uTime * 0.03));
  n = 0.65 * n + 0.35 * vnoise(cell * 0.23 - vec2(uTime * 0.02, uTime * 0.05));
  float flow = smoothstep(0.3, 0.9, n);
  float base = 0.045 + 0.15 * flow;

  vec2 center = (cell + 0.5) * uCell;
  float m = 1.0 - smoothstep(0.0, uRadius, distance(center, uMouse));
  m *= m;

  float bright = (base + m * 0.6 + flash * 0.95 + glitch * 0.7) * uGain;
  vec3 cream = vec3(0.937, 0.886, 0.776);
  vec3 gold = vec3(0.839, 0.647, 0.329);
  vec3 col = mix(cream, gold, clamp(tint + m * 0.35, 0.0, 1.0));
  col = mix(col, vec3(1.0, 0.9, 0.66), clamp(flash * 0.6 + glitch * 0.4, 0.0, 1.0));
  float alpha = clamp(a * bright, 0.0, 1.0);
  outColor = vec4(col * alpha, alpha);
}`;

    let prog, U, vao, atlasTex, stateTex;
    const atlas = document.createElement('canvas');
    const actx = atlas.getContext('2d');
    let dpr = 1, cellW = 0, cellH = 0, cols = 0, rows = 0;
    let glyph = new Uint8Array(0), flash = new Float32Array(0), glitch = new Float32Array(0), tint = new Uint8Array(0);
    let data = new Uint8ClampedArray(0);
    const mouse = { x: -1e5, y: -1e5 };
    const tears = [];
    let running = false, raf = 0, last = 0, lost = false;
    const t0 = performance.now();
    const randGlyph = () => P.randInt(NG);
    const randTint = () => (Math.random() < 0.2 ? 190 + P.randInt(65) : P.randInt(40));

    function setup() {
      prog = P.gl.program(gl, VS, FS);
      U = P.gl.uniforms(gl, prog, ['uAtlas', 'uState', 'uRes', 'uCell', 'uAtlasGrid', 'uMouse', 'uRadius', 'uTime', 'uGain']);
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      atlasTex = P.gl.texture(gl, gl.LINEAR);
      stateTex = P.gl.texture(gl, gl.NEAREST);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
    }

    function drawAtlas() {
      atlas.width = cellW * AC;
      atlas.height = cellH * AR;
      actx.clearRect(0, 0, atlas.width, atlas.height);
      actx.fillStyle = '#fff';
      actx.textAlign = 'center';
      actx.textBaseline = 'alphabetic';
      actx.font = `${Math.round(cellH * 0.7)}px "IM Fell English", Georgia, serif`;
      GLYPHS.forEach((ch, i) => {
        actx.fillText(ch, (i % AC + 0.5) * cellW, Math.floor(i / AC) * cellH + cellH * 0.76);
      });
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    }

    function resize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const cssCell = w < 640 ? 14 : 17;
      const nCellW = Math.max(6, Math.round(cssCell * dpr));
      const nCellH = Math.max(8, Math.round(cssCell * 1.32 * dpr));
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      if (nCellW !== cellW || nCellH !== cellH) {
        cellW = nCellW; cellH = nCellH;
        drawAtlas();
      }
      const nCols = Math.ceil(canvas.width / cellW);
      const nRows = Math.ceil(canvas.height / cellH);
      if (nCols !== cols || nRows !== rows) {
        const N = nCols * nRows;
        const ng = new Uint8Array(N), nf = new Float32Array(N), nx = new Float32Array(N), nt = new Uint8Array(N);
        for (let r = 0; r < nRows; r++) {
          for (let c = 0; c < nCols; c++) {
            const i = r * nCols + c;
            if (r < rows && c < cols) {
              const j = r * cols + c;
              ng[i] = glyph[j]; nf[i] = flash[j]; nx[i] = glitch[j]; nt[i] = tint[j];
            } else {
              ng[i] = randGlyph(); nt[i] = randTint();
            }
          }
        }
        glyph = ng; flash = nf; glitch = nx; tint = nt;
        cols = nCols; rows = nRows;
        data = new Uint8ClampedArray(N * 4);
        gl.bindTexture(gl.TEXTURE_2D, stateTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function flashCell(i, amount) {
      if (i < 0 || i >= glyph.length) return;
      flash[i] = Math.max(flash[i], amount);
      glyph[i] = randGlyph();
    }

    function step(dt) {
      const N = cols * rows;
      if (!N) return;
      let k = N * 0.018 * dt;
      while (k > 0) {
        if (k < 1 && Math.random() > k) break;
        glyph[P.randInt(N)] = randGlyph();
        k -= 1;
      }
      if (Math.random() < dt * 3.2 * RATE) flashCell(P.randInt(N), P.rand(0.65, 1));
      if (Math.random() < dt * 0.75 * RATE) {
        const len = 3 + P.randInt(8);
        const r = P.randInt(rows);
        const c0 = P.randInt(Math.max(1, cols - len));
        for (let j = 0; j < len; j++) flashCell(r * cols + c0 + j, P.rand(0.5, 0.95) * (1 - (j / len) * 0.35));
      }
      if (mouse.x > -1e4) {
        const radius = RADIUS * dpr;
        const mc = Math.floor(mouse.x / cellW), mr = Math.floor(mouse.y / cellH);
        const rc = Math.ceil(radius / cellW), rr = Math.ceil(radius / cellH);
        const r0 = Math.max(0, mr - rr), r1 = Math.min(rows - 1, mr + rr);
        const c0 = Math.max(0, mc - rc), c1 = Math.min(cols - 1, mc + rc);
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const dx = (c + 0.5) * cellW - mouse.x;
            const dy = (r + 0.5) * cellH - mouse.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < radius) {
              const p = 1 - d / radius;
              if (Math.random() < p * p * dt * 14) glyph[r * cols + c] = randGlyph();
            }
          }
        }
      }
      for (let t = tears.length - 1; t >= 0; t--) {
        const tr = tears[t];
        tr.age += dt;
        if (tr.age < 0) continue;
        const life = tr.age / tr.dur;
        if (life >= 1 || tr.r < 0 || tr.r >= rows) { tears.splice(t, 1); continue; }
        const grow = Math.min(1, tr.age / 0.14);
        const reachL = (tr.cc - tr.c0) * grow, reachR = (tr.c1 - tr.cc) * grow;
        const amp = tr.amp * (1 - life) * (1 - life * 0.3);
        for (let c = Math.max(0, Math.floor(tr.cc - reachL)); c <= Math.min(cols - 1, Math.ceil(tr.cc + reachR)); c++) {
          const i = tr.r * cols + c;
          glitch[i] = Math.max(glitch[i], amp);
          if (Math.random() < 0.55) glyph[i] = randGlyph();
          if (Math.random() < 0.05) flash[i] = Math.max(flash[i], 0.8);
        }
      }
      const fd = Math.exp(-dt * 2.0), gd = Math.exp(-dt * 4.0);
      for (let i = 0; i < N; i++) { flash[i] *= fd; glitch[i] *= gd; }
    }

    function upload() {
      const N = cols * rows;
      for (let i = 0, o = 0; i < N; i++, o += 4) {
        data[o] = glyph[i];
        data[o + 1] = flash[i] * 255;
        data[o + 2] = tint[i];
        data[o + 3] = glitch[i] * 255;
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, stateTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }

    function render(time) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.uniform1i(U.uAtlas, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, stateTex);
      gl.uniform1i(U.uState, 1);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform2f(U.uCell, cellW, cellH);
      gl.uniform2f(U.uAtlasGrid, AC, AR);
      const off = P.motion.reduce;
      gl.uniform2f(U.uMouse, off ? -1e5 : mouse.x, off ? -1e5 : mouse.y);
      gl.uniform1f(U.uRadius, RADIUS * dpr);
      gl.uniform1f(U.uTime, time);
      gl.uniform1f(U.uGain, GAIN);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      step(dt);
      upload();
      render((now - t0) / 1000);
    }
    function start() {
      if (running || lost || P.motion.reduce || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }
    function renderStatic() { if (lost) return; upload(); render(12.0); }

    function tear(clientX, clientY) {
      if (!cols) return;
      const c = Math.floor((clientX * dpr) / cellW);
      const r = Math.floor((clientY * dpr) / cellH);
      const len = 16 + P.randInt(36);
      const left = Math.round(len * P.rand(0.3, 0.7));
      tears.push({ r, c0: c - left, c1: c - left + len, cc: c, age: 0, dur: P.rand(0.9, 1.3), amp: 1 });
      for (let k = 0; k < 2; k++) {
        if (Math.random() < 0.75) {
          const dr = (Math.random() < 0.5 ? -1 : 1) * (1 + P.randInt(2));
          const l2 = 5 + P.randInt(16);
          const cc = Math.round(c + (Math.random() - 0.5) * len);
          tears.push({ r: r + dr, c0: cc - (l2 >> 1), c1: cc + (l2 >> 1), cc, age: -P.rand(0.02, 0.12), dur: P.rand(0.55, 0.85), amp: 0.7 });
        }
      }
    }

    let resizeQueued = false;
    window.addEventListener('resize', () => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        if (lost) return;
        resize();
        if (!running) renderStatic();
      });
    });
    window.addEventListener('pointermove', (e) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; }, { passive: true });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) { mouse.x = -1e5; mouse.y = -1e5; } });
    window.addEventListener('blur', () => { mouse.x = -1e5; mouse.y = -1e5; });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') setTimeout(() => { mouse.x = -1e5; mouse.y = -1e5; }, 450);
    }, { passive: true });
    if (!calm) {
      window.addEventListener('pointerdown', (e) => {
        if (P.motion.reduce) return;
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        tear(e.clientX, e.clientY);
      }, { passive: true });
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    P.motion.on((rm) => { if (rm) { stop(); renderStatic(); } else start(); });
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; stop(); });
    canvas.addEventListener('webglcontextrestored', () => {
      lost = false; cellW = cellH = cols = rows = 0;
      setup(); resize();
      if (P.motion.reduce) renderStatic(); else start();
    });

    try {
      setup();
      resize();
    } catch (err) {
      console.warn('[Primer] Letter glitch disabled:', err);
      canvas.style.display = 'none';
      return null;
    }
    if (P.motion.reduce) renderStatic(); else start();
    P.fontsReady.then(() => { if (lost) return; drawAtlas(); if (!running) renderStatic(); });
    return { tear };
  }

  const root = document.querySelector('.backdrop');
  if (root) {
    initPhoto(root.querySelector('.backdrop__photo'));
    const canvas = root.querySelector('.backdrop__glitch');
    if (canvas) P.glitch = createLetterGlitch(canvas, { calm: document.body.dataset.backdrop === 'calm' });
  }
})();
