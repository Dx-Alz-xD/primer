/* =====================================================================
   Ripple Distortion: vanilla WebGL2 port of the React Bits component.
   P.createRipple(mountEl, options) -> { burst() } | null
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;

  const waveVertex = `
precision highp float;
attribute vec2 position;
attribute vec2 uv;
attribute vec2 iOffset;
attribute vec2 iScale;
attribute float iOpacity;
varying vec2 vUv;
varying float vOpacity;
void main() {
  vUv = uv;
  vOpacity = iOpacity;
  gl_Position = vec4(iOffset + position * iScale, 0.0, 1.0);
}`;

  const waveFragment = `
precision highp float;
varying vec2 vUv;
varying float vOpacity;
uniform float uRings;
const float PI = 3.141592653589793;
const float EDGE = 0.006737947;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float brush = (exp(-r * 5.0) - EDGE) / (1.0 - EDGE);
  brush *= 0.55 + 0.45 * cos(sqrt(r) * PI * 2.0 * uRings);
  gl_FragColor = vec4(vec3(brush * vOpacity * vOpacity), 1.0);
}`;

  const screenVertex = `
precision highp float;
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

  const compositeFragment = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform sampler2D uDisplacement;
uniform vec2 uResolution;
uniform vec2 uTextureSize;
uniform vec2 uTexel;
uniform vec3 uTint;
uniform vec3 uHighlight;
uniform float uStrength;
uniform float uSwirl;
uniform float uDispersion;
uniform float uGlint;
uniform float uTintAmount;
uniform float uGrayscale;
uniform float uSepia;
uniform float uDim;
const float TAU = 6.283185307179586;

vec2 coverUV(vec2 uv) {
  vec2 safe = max(uTextureSize, vec2(1.0));
  vec2 s = uResolution / safe;
  vec2 scaledSize = safe * max(s.x, s.y);
  vec2 offset = (uResolution - scaledSize) * 0.5;
  return (uv * uResolution - offset) / scaledSize;
}

void main() {
  float amount = texture2D(uDisplacement, vUv).r;
  vec2 base = coverUV(vUv);
  float theta = amount * uSwirl * TAU;
  vec2 dir = vec2(sin(theta), cos(theta));
  vec2 push = dir * amount * uStrength;

  vec3 color;
  if (uDispersion > 0.001) {
    float split = uDispersion * 0.25;
    color.r = texture2D(uTexture, base + push * (1.0 + split)).r;
    color.g = texture2D(uTexture, base + push).g;
    color.b = texture2D(uTexture, base + push * (1.0 - split)).b;
  } else {
    color = texture2D(uTexture, base + push).rgb;
  }
  if (uGrayscale > 0.001) {
    color = mix(color, vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), uGrayscale);
  }
  if (uSepia > 0.001) {
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, lum * vec3(1.12, 0.88, 0.6), uSepia);
  }
  color *= uDim;
  if (uTintAmount > 0.001) {
    float a = clamp(amount * 1.6, 0.0, 1.0) * uTintAmount;
    color = mix(color, color * uTint * 1.9, a);
    color += uTint * a * 0.12;
  }
  if (uGlint > 0.001) {
    float ex = texture2D(uDisplacement, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uDisplacement, vUv - vec2(uTexel.x, 0.0)).r;
    float ey = texture2D(uDisplacement, vUv + vec2(0.0, uTexel.y)).r - texture2D(uDisplacement, vUv - vec2(0.0, uTexel.y)).r;
    vec3 normal = normalize(vec3(-ex * 26.0, -ey * 26.0, 1.0));
    vec3 light = normalize(vec3(-0.35, 0.55, 1.0));
    float raw = pow(max(dot(normal, light), 0.0), 22.0);
    float flatSpec = pow(max(light.z, 0.0), 22.0);
    color += uHighlight * clamp((raw - flatSpec) / max(1.0 - flatSpec, 0.0001), 0.0, 1.0) * uGlint;
  }
  gl_FragColor = vec4(color, 1.0);
}`;

  const hexToRGB = (hex) => {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  P.createRipple = function (mount, options) {
    if (!mount) return null;
    const o = Object.assign({
      src: '', brushSize: 150, strength: 0.2, swirl: 1, rings: 4, spread: 5, fade: 3, spacing: 15,
      dispersion: 0, glint: 0, tint: '#a855f7', tintAmount: 0.1, highlightColor: '#ffffff',
      grayscale: 1, sepia: 0, dim: 1, trigger: 'hover', clickStrength: 2, quality: 'low', idleDrops: false
    }, options);

    const canvas = document.createElement('canvas');
    mount.appendChild(canvas);
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power'
    });
    const goStatic = () => {
      canvas.remove();
      mount.classList.add('is-static');
      mount.style.backgroundImage = `url("${o.src}")`;
      return null;
    };
    if (!gl) return goStatic();

    const MAX_WAVES = 100;
    const QUALITY_SCALE = { low: 0.4, medium: 0.7, high: 1 };
    const START_SCALE = 1.5;
    const LIFE_CONSTANT = Math.log(500);

    let waveProg, compProg, WU, CU, waveVAO, compVAO, offBuf, sclBuf, opBuf, imgTex, dispTex, fbo;
    const offsets = new Float32Array(MAX_WAVES * 2);
    const scales = new Float32Array(MAX_WAVES * 2);
    const opacities = new Float32Array(MAX_WAVES);
    const waves = Array.from({ length: MAX_WAVES }, () => ({ x: 0, y: 0, scale: START_SCALE, target: START_SCALE, size: 1, opacity: 0 }));
    let current = 0;
    let width = 1, height = 1, fieldW = 2, fieldH = 2;
    let texSize = [1, 1];
    let dirty = true, wasAlive = false;
    const tintRGB = hexToRGB(o.tint);
    const highlightRGB = hexToRGB(o.highlightColor);

    function buffer(data, usage) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      return b;
    }
    function attrib(prog, name, buf, size, divisor) {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(loc, divisor);
    }

    function setup() {
      waveProg = P.gl.program(gl, waveVertex, waveFragment);
      compProg = P.gl.program(gl, screenVertex, compositeFragment);
      WU = P.gl.uniforms(gl, waveProg, ['uRings']);
      CU = P.gl.uniforms(gl, compProg, ['uTexture', 'uDisplacement', 'uResolution', 'uTextureSize', 'uTexel', 'uTint', 'uHighlight',
        'uStrength', 'uSwirl', 'uDispersion', 'uGlint', 'uTintAmount', 'uGrayscale', 'uSepia', 'uDim']);

      waveVAO = gl.createVertexArray();
      gl.bindVertexArray(waveVAO);
      attrib(waveProg, 'position', buffer(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW), 2, 0);
      attrib(waveProg, 'uv', buffer(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW), 2, 0);
      offBuf = buffer(offsets, gl.DYNAMIC_DRAW); attrib(waveProg, 'iOffset', offBuf, 2, 1);
      sclBuf = buffer(scales, gl.DYNAMIC_DRAW); attrib(waveProg, 'iScale', sclBuf, 2, 1);
      opBuf = buffer(opacities, gl.DYNAMIC_DRAW); attrib(waveProg, 'iOpacity', opBuf, 1, 1);

      compVAO = gl.createVertexArray();
      gl.bindVertexArray(compVAO);
      attrib(compProg, 'position', buffer(new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW), 2, 0);
      attrib(compProg, 'uv', buffer(new Float32Array([0, 0, 2, 0, 0, 2]), gl.STATIC_DRAW), 2, 0);
      gl.bindVertexArray(null);

      imgTex = P.gl.texture(gl, gl.LINEAR);
      dispTex = P.gl.texture(gl, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dispTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST);
    }

    function setImage(source, w, h) {
      gl.bindTexture(gl.TEXTURE_2D, imgTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        texSize = [w || 1, h || 1];
        dirty = true;
        return true;
      } catch (err) {
        return false;
      } finally {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      }
    }

    function resize() {
      width = Math.max(1, mount.clientWidth);
      height = Math.max(1, mount.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const s = QUALITY_SCALE[o.quality] || 1;
      fieldW = Math.max(2, Math.round(width * s));
      fieldH = Math.max(2, Math.round(height * s));
      gl.bindTexture(gl.TEXTURE_2D, dispTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fieldW, fieldH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      dirty = true;
    }

    function setNewWave(x, y, power) {
      const wave = waves[current];
      current = (current + 1) % MAX_WAVES;
      wave.x = x; wave.y = y;
      wave.scale = START_SCALE * power;
      wave.target = START_SCALE * Math.max(1, o.spread) * power;
      wave.size = Math.max(1, o.brushSize);
      wave.opacity = 1;
    }

    function render() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, fieldW, fieldH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(waveProg);
      gl.uniform1f(WU.uRings, o.rings);
      gl.bindVertexArray(waveVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, offBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, offsets);
      gl.bindBuffer(gl.ARRAY_BUFFER, sclBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, scales);
      gl.bindBuffer(gl.ARRAY_BUFFER, opBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, opacities);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, MAX_WAVES);
      gl.disable(gl.BLEND);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(compProg);
      gl.bindVertexArray(compVAO);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, imgTex); gl.uniform1i(CU.uTexture, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dispTex); gl.uniform1i(CU.uDisplacement, 1);
      gl.uniform2f(CU.uResolution, width, height);
      gl.uniform2f(CU.uTextureSize, texSize[0], texSize[1]);
      gl.uniform2f(CU.uTexel, 1 / fieldW, 1 / fieldH);
      gl.uniform3fv(CU.uTint, tintRGB);
      gl.uniform3fv(CU.uHighlight, highlightRGB);
      gl.uniform1f(CU.uStrength, o.strength);
      gl.uniform1f(CU.uSwirl, o.swirl);
      gl.uniform1f(CU.uDispersion, o.dispersion);
      gl.uniform1f(CU.uGlint, o.glint);
      gl.uniform1f(CU.uTintAmount, o.tintAmount);
      gl.uniform1f(CU.uGrayscale, +o.grayscale);
      gl.uniform1f(CU.uSepia, o.sepia);
      gl.uniform1f(CU.uDim, o.dim);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
    }

    const localPoint = (clientX, clientY) => {
      const rect = mount.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      return [clientX - rect.left, rect.height - (clientY - rect.top)];
    };
    let prevX = -1e5, prevY = -1e5, lastPointer = 0, nextDrop = 0;
    let raf = 0, running = false, prevTime = 0, visible = false, resizePending = false, lost = false;

    window.addEventListener('pointermove', (e) => {
      if (P.motion.reduce || !visible || o.trigger === 'click') return;
      const p = localPoint(e.clientX, e.clientY);
      if (!p) return;
      lastPointer = performance.now();
      const step = Math.max(1, o.spacing);
      if (Math.abs(p[0] - prevX) > step || Math.abs(p[1] - prevY) > step) {
        setNewWave(p[0], p[1], 1);
        prevX = p[0]; prevY = p[1];
      }
    }, { passive: true });
    window.addEventListener('pointerdown', (e) => {
      if (P.motion.reduce || !visible || o.trigger === 'hover') return;
      const p = localPoint(e.clientX, e.clientY);
      if (!p) return;
      lastPointer = performance.now();
      setNewWave(p[0], p[1], Math.max(1, o.clickStrength));
    }, { passive: true });

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (resizePending) { resizePending = false; resize(); }
      const delta = prevTime ? Math.min(0.05, (now - prevTime) / 1000) : 0;
      prevTime = now;
      if (o.idleDrops && now - lastPointer > 2600 && now > nextDrop) {
        setNewWave(P.rand(width * 0.06, width * 0.94), P.rand(height * 0.08, height * 0.92), P.rand(1, 1.5));
        nextDrop = now + P.rand(1100, 2600);
      }
      const growth = 1 - Math.exp(-delta * 1.09);
      const decay = Math.exp((-delta * LIFE_CONSTANT) / Math.max(0.15, o.fade));
      let alive = 0;
      for (let i = 0; i < MAX_WAVES; i++) {
        const w = waves[i];
        if (w.opacity <= 0) { opacities[i] = 0; continue; }
        w.opacity *= decay;
        w.scale += (w.target - w.scale) * growth;
        if (w.opacity < 0.002) { w.opacity = 0; opacities[i] = 0; continue; }
        alive++;
        const half = (w.scale * w.size) / 2;
        offsets[i * 2] = (w.x / width) * 2 - 1;
        offsets[i * 2 + 1] = (w.y / height) * 2 - 1;
        scales[i * 2] = (half / width) * 2;
        scales[i * 2 + 1] = (half / height) * 2;
        opacities[i] = w.opacity;
      }
      if (alive || wasAlive || dirty) { render(); dirty = false; }
      wasAlive = alive > 0;
    }
    function start() {
      if (running || lost || !visible || document.hidden || P.motion.reduce) return;
      running = true; prevTime = 0;
      raf = requestAnimationFrame(loop);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }
    function renderStatic() {
      if (lost) return;
      if (resizePending) { resizePending = false; resize(); }
      opacities.fill(0);
      render();
      dirty = false;
    }
    const refresh = () => { if (P.motion.reduce) renderStatic(); else start(); };

    try {
      setup();
      resize();
    } catch (err) {
      console.warn('[Primer] Ripple disabled:', err);
      return goStatic();
    }

    const shelves = P.paintShelves(1400, 900, 23);
    setImage(shelves, shelves.width, shelves.height);
    if (o.src) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        if (lost) return;
        if (setImage(img, img.naturalWidth, img.naturalHeight) && !running) renderStatic();
      };
      img.src = o.src;
    }

    new ResizeObserver(() => { resizePending = true; if (!running) renderStatic(); }).observe(mount);
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) refresh(); else stop();
    }, { rootMargin: '80px' }).observe(mount);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else refresh(); });
    P.motion.on((rm) => { if (rm) { stop(); renderStatic(); } else refresh(); });
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; stop(); });
    canvas.addEventListener('webglcontextrestored', () => {
      lost = false;
      setup(); resize();
      setImage(shelves, shelves.width, shelves.height);
      refresh();
    });
    renderStatic();

    return {
      burst() {
        if (P.motion.reduce || lost) return;
        const cx = width / 2, cy = height / 2;
        setNewWave(cx, cy, 2.6);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          setNewWave(cx + Math.cos(a) * width * 0.28, cy + Math.sin(a) * height * 0.3, 1.5);
        }
        lastPointer = performance.now();
      }
    };
  };

  // the library preset used across the site
  P.rippleLibrary = (mount) => P.createRipple(mount, {
    src: P.config.ripplePhoto,
    brushSize: 150, strength: 0.2, swirl: 1, rings: 4, spread: 5, fade: 3, spacing: 15,
    dispersion: 0.15, glint: 0.7, tint: '#d6a554', tintAmount: 0.5, highlightColor: '#fff0c8',
    grayscale: 0, sepia: 0.8, dim: 0.5, trigger: 'both', clickStrength: 2, quality: 'medium', idleDrops: true
  });
})();
