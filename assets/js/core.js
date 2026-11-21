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

  // only allow redirects back into our own app pages
  P.safeNext = (raw, fallback = 'app.html') => {
    if (!raw) return fallback;
    return /^(app|lesson)\.html(\?[\w=&%.\-+~!*'()]*)?$/.test(raw) ? raw : fallback;
  };

  /* ---------- mock auth ---------- */
  const USERS = 'primer.users';
  const SESSION = 'primer.session';

  async function hashPassword(password, salt) {
    const input = `${salt}:${password}`;
    if (window.crypto && crypto.subtle && window.isSecureContext) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return 'fnv-' + P.hashStr(input).toString(16); // insecure fallback, mock only
  }

  P.auth = {
    normalize: (email) => String(email || '').trim().toLowerCase(),
    validEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim()),
    user(email) { return (P.store.get(USERS, {}) || {})[P.auth.normalize(email)] || null; },
    current() { return P.store.get(SESSION, null); },
    async prepare({ name, email, password }) {
      const salt = P.uid();
      return { name: P.clean(name, 60), email: P.auth.normalize(email), salt, hash: await hashPassword(password, salt) };
    },
    create(record) {
      const users = P.store.get(USERS, {}) || {};
      users[record.email] = { name: record.name, email: record.email, salt: record.salt, hash: record.hash, createdAt: Date.now() };
      P.store.set(USERS, users);
      return users[record.email];
    },
    startSession(user) { P.store.set(SESSION, { email: user.email, name: user.name, at: Date.now() }); },
    async signIn(email, password) {
      const u = P.auth.user(email);
      if (!u) return { ok: false, reason: 'no-account' };
      if ((await hashPassword(password, u.salt)) !== u.hash) return { ok: false, reason: 'wrong-password' };
      P.auth.startSession(u);
      return { ok: true, user: u };
    },
    signOut() {
      P.store.remove(SESSION);
      location.href = 'index.html';
    }
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
})();
