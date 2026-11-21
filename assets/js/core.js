/* =====================================================================
   Primer core: helpers, storage, mock auth, toast.
   Loaded first on every page. Everything hangs off window.Primer.

   NOTE: auth here is a front-end mock (accounts live in localStorage).
   Swap P.auth for real API calls when the backend is ready.
   ===================================================================== */
(function () {
  'use strict';
  const P = (window.Primer = window.Primer || {});

  P.config = {
    backdropPhoto: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=2000&q=70',
    ripplePhoto: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1600&q=70',
    inviteCode: 'PRIMER',
    otpMinutes: 10
  };

  /* ---------- small helpers ---------- */
  P.$ = (s, r = document) => r.querySelector(s);
  P.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  P.rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  P.randInt = (n) => (Math.random() * n) | 0;
  P.pick = (arr) => arr[P.randInt(arr.length)];
  P.delay = (ms) => new Promise((r) => setTimeout(r, ms));
  P.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  P.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  P.clean = (s, max = 120) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  P.cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  P.roman = (n) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n - 1] || String(n);
  P.hashStr = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  P.mulberry32 = (a) => function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  P.shuffle = (arr, rng = Math.random) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  /* ---------- reduced motion ---------- */
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const motionFns = [];
  P.motion = { reduce: mq.matches, on: (fn) => motionFns.push(fn) };
  const onMq = (e) => { P.motion.reduce = e.matches; motionFns.forEach((fn) => fn(e.matches)); };
  if (mq.addEventListener) mq.addEventListener('change', onMq);
  else if (mq.addListener) mq.addListener(onMq);

  P.fontsReady = (document.fonts && document.fonts.load)
    ? Promise.race([
        Promise.all([document.fonts.load('32px "IM Fell English"'), document.fonts.load('500 19px "Cormorant Garamond"')]),
        new Promise((r) => setTimeout(r, 3000))
      ]).catch(() => {})
    : Promise.resolve();

  /* ---------- storage ---------- */
  const wrapStore = (area) => ({
    get(key, fallback = null) {
      try { const v = area.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, val) {
      try { area.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
    },
    remove(key) { try { area.removeItem(key); } catch (e) { /* noop */ } }
  });
  let local, sess;
  try { local = window.localStorage; sess = window.sessionStorage; } catch (e) { /* blocked */ }
  const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  P.store = wrapStore(local || memory());
  P.session = wrapStore(sess || memory());

  P.params = new URLSearchParams(location.search);

  // only allow redirects back into our own pages
  P.safeNext = (raw, fallback = 'app.html') => {
    if (!raw) return fallback;
    return /^[a-z]+\.html(\?[\w=&%.\-+~!*'()]*)?$/.test(raw) && raw.split('?')[0] !== 'auth.html' ? raw : fallback;
  };

  /* ---------- what the server told this page (user, settings) ---------- */
  P.boot = window.__PRIMER__ || { user: null, invite: true, ai: false };

  /* ---------- talking to the Primer server ---------- */
  // Every call goes through here: JSON in and out, the session cookie rides along,
  // and errors come back as plain sentences the page can show.
  P.request = async (method, url, body, opts = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
    try {
      const res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        keepalive: Boolean(opts.keepalive),
        signal: ctrl.signal
      });
      let data = null;
      try { data = await res.json(); } catch (e) { /* not JSON */ }
      if (res.status === 401 && P.boot.user && !opts.allow401) {
        location.href = 'auth.html?next=' + encodeURIComponent(location.pathname.replace(/^\//, '') + location.search) + '#signin';
        throw Object.assign(new Error('Your session has ended. Sign in again.'), { status: 401 });
      }
      if (!res.ok || !data || data.ok === false) {
        const msg = (data && data.error) || (res.status === 404 || res.status === 405
          ? 'The Primer server isn’t running. Start it with npm start.'
          : `The server answered with an error (${res.status}).`);
        throw Object.assign(new Error(msg), { status: res.status, fields: data && data.fields });
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(opts.timeoutMessage || 'The server took too long to answer. Try again.');
      if (err instanceof TypeError) throw new Error('Can’t reach the Primer server. Start it with npm start.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
  P.get = (url, o) => P.request('GET', url, undefined, o);
  P.post = (url, body, o) => P.request('POST', url, body || {}, o);
  P.put = (url, body, o) => P.request('PUT', url, body || {}, o);
  P.patch = (url, body, o) => P.request('PATCH', url, body || {}, o);
  P.del = (url, o) => P.request('DELETE', url, undefined, o);

  /* ---------- accounts (real ones, kept by the server) ---------- */
  P.auth = {
    normalize: (email) => String(email || '').trim().toLowerCase(),
    validEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim()),
    current: () => P.boot.user,
    inviteRequired: () => P.boot.invite !== false,
    checkInvite: (code) => P.post('/api/auth/invite', { code }),
    signUp: (d) => P.post('/api/auth/signup', d),
    signIn: (email, password) => P.post('/api/auth/signin', { email, password }, { allow401: true }),
    async signOut() {
      try { await P.post('/api/auth/signout', {}); } catch (e) { /* the cookie is cleared server-side either way */ }
      location.href = 'index.html';
    }
  };

  // Courses saved by the old browser-only version, so they can be moved into the account once.
  P.legacyCourses = () => {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^primer\.courses:/.test(k)) continue;
        const all = P.store.get(k, {}) || {};
        Object.values(all).forEach((c) => { if (c && Array.isArray(c.units)) out.push(c); });
      }
    } catch (e) { /* storage blocked */ }
    return out;
  };
  P.clearLegacy = () => {
    try {
      Object.keys(localStorage).filter((k) => /^primer\.(courses|doubts|users|session)/.test(k)).forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* storage blocked */ }
  };

  P.mountUserNav = () => {
    const u = P.auth.current();
    P.$$('[data-user-name]').forEach((el) => { el.textContent = u ? u.name.split(' ')[0] : ''; });
    P.$$('[data-signout]').forEach((b) => b.addEventListener('click', () => P.auth.signOut()));
  };

  /* ---------- toast ---------- */
  P.toast = (msg, kind = '') => {
    let el = P.$('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast' + (kind ? ` is-${kind}` : '');
    void el.offsetWidth;
    el.classList.add('is-on');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('is-on'), 3400);
  };

  P.shake = (el) => {
    el.classList.remove('is-shake');
    void el.offsetWidth;
    el.classList.add('is-shake');
    el.addEventListener('animationend', () => el.classList.remove('is-shake'), { once: true });
  };

  /* ---------- procedural bookshelf (offline fallback image) ---------- */
  P.paintShelves = function (w, h, seed = 11) {
    const rnd = P.mulberry32(seed);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    let g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#26160b'); g.addColorStop(1, '#130a04');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const rows = Math.max(3, Math.round(h / 180));
    const rowH = h / rows;
    const plank = Math.max(10, rowH * 0.085);
    const palette = ['#5b2318', '#3d2a17', '#2e3a24', '#6a4424', '#2b2c3c', '#4b1c1a', '#7a5a2e', '#24322b', '#5e3b1f', '#3a1f2a', '#6e2a1c', '#463018'];
    for (let r = 0; r < rows; r++) {
      const top = r * rowH;
      const base = top + rowH - plank;
      let bx = 4;
      while (bx < w) {
        const bw = 11 + rnd() * 26;
        if (rnd() < 0.035) { bx += bw * 1.6; continue; }
        const bh = (rowH - plank) * (0.6 + rnd() * 0.34);
        const y = base - bh;
        x.fillStyle = palette[Math.floor(rnd() * palette.length)];
        x.fillRect(bx, y, bw - 1, bh);
        const sg = x.createLinearGradient(bx, 0, bx + bw, 0);
        sg.addColorStop(0, 'rgba(0,0,0,.55)'); sg.addColorStop(0.32, 'rgba(255,228,186,.12)');
        sg.addColorStop(0.7, 'rgba(0,0,0,.06)'); sg.addColorStop(1, 'rgba(0,0,0,.62)');
        x.fillStyle = sg; x.fillRect(bx, y, bw - 1, bh);
        if (rnd() < 0.75) {
          x.fillStyle = 'rgba(214,165,84,.55)';
          const by = y + bh * 0.1;
          x.fillRect(bx + 1, by, bw - 3, 2); x.fillRect(bx + 1, by + 5, bw - 3, 1); x.fillRect(bx + 1, y + bh * 0.84, bw - 3, 2);
        }
        if (rnd() < 0.4) { x.fillStyle = 'rgba(18,9,3,.55)'; x.fillRect(bx + 3, y + bh * 0.3, bw - 7, bh * 0.17); }
        bx += bw;
      }
      const pg = x.createLinearGradient(0, base, 0, base + plank);
      pg.addColorStop(0, '#6f4927'); pg.addColorStop(0.3, '#4a2f18'); pg.addColorStop(1, '#1a0f06');
      x.fillStyle = pg; x.fillRect(0, base, w, plank);
      const sh = x.createLinearGradient(0, top, 0, top + rowH * 0.28);
      sh.addColorStop(0, 'rgba(0,0,0,.6)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = sh; x.fillRect(0, top, w, rowH * 0.28);
    }
    x.globalCompositeOperation = 'lighter';
    [[0.2, 0.28, 0.5], [0.8, 0.66, 0.42]].forEach(([px, py, rr]) => {
      const rg = x.createRadialGradient(w * px, h * py, 0, w * px, h * py, Math.max(w, h) * rr);
      rg.addColorStop(0, 'rgba(255,176,86,.22)'); rg.addColorStop(1, 'rgba(255,176,86,0)');
      x.fillStyle = rg; x.fillRect(0, 0, w, h);
    });
    x.globalCompositeOperation = 'source-over';
    return c;
  };

  /* ---------- WebGL helpers (shared by backdrop + ripple) ---------- */
  P.gl = {
    program(gl, vs, fs) {
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log); }
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    },
    uniforms(gl, p, names) {
      const u = {};
      names.forEach((n) => { u[n] = gl.getUniformLocation(p, n); });
      return u;
    },
    texture(gl, filter) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
  };

  /* ---------- the page enters once ---------- */
  // The main content rises into place the first time it appears, never again on a re-render.
  // A part holding something fixed (the tutor, the notebook) only fades: a moving parent
  // would carry the fixed thing with it for that moment. The landing page has its own.
  function enter() {
    if (P.motion.reduce || !Element.prototype.animate || document.querySelector('[data-split]')) return;
    const main = document.querySelector('main');
    if (!main) return;
    const hasFixed = (el) => {
      const all = el.getElementsByTagName('*');
      if (all.length > 1500) return true; // a long page: don't look, just fade
      for (let i = 0; i < all.length; i++) if (getComputedStyle(all[i]).position === 'fixed') return true;
      return false;
    };
    const run = () => {
      Array.from(main.children).filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed').slice(0, 6).forEach((el, i) => {
        const still = getComputedStyle(el).position === 'fixed' || hasFixed(el);
        el.animate(
          still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
          { duration: 560, delay: 30 + i * 70, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }
        );
      });
    };
    if (main.textContent.trim()) { run(); return; }
    // content that arrives after a fetch enters when it arrives (once)
    const mo = new MutationObserver(() => { if (main.textContent.trim()) { mo.disconnect(); run(); } });
    mo.observe(main, { childList: true, subtree: true, characterData: true });
    setTimeout(() => mo.disconnect(), 6000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enter, { once: true });
  else enter();
})();
