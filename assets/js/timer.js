/* =====================================================================
   The study timer, in the top bar of every signed-in page.

   - Pomodoro (25 minutes of focus, 5 of break, 15 after every fourth),
     deep work (50 and 10), custom lengths, and a stopwatch.
   - Start, pause, skip and reset. The state lives in localStorage, so the
     timer keeps running from page to page and tab to tab; whichever tab
     is open when a block ends moves it on, plays a soft sound (P.sfx when
     the page has it) and, with permission, shows a notification through
     the service worker. Finished focus blocks are counted for today and
     saved (POST /api/study/session).
   - The study clock: time a lesson page is open and in use (reading,
     scrolling, typing, a video playing; it stops after 3 minutes with
     no sign of the learner), plus time the timer runs a focus block or
     the stopwatch on any page, counted once even with several tabs open.
     It is sent a minute at a time (POST /api/study/time) per course,
     lesson and day, with a beacon when the page closes, and kept on the
     device while it can't be sent.

   P.timer.state(), .start({ mode, course }), .pause(), .on(fn) -> off,
   P.timer.describe(state)   "Focus: 12:30 left"
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  const T = (s) => esc(t(s));
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const user = P.auth.current();
  const KEY = 'primer.timer.' + user.id;
  // A testing aid: primer.timer.speed > 1 in localStorage makes every minute that many times shorter.
  const SPEED = Math.min(600, Math.max(1, Number(P.store.get('primer.timer.speed', 1)) || 1));
  const MIN = 60000 / SPEED;
  const PRESETS = { pomodoro: { work: 25, brk: 5, long: 15, every: 4 }, deep: { work: 50, brk: 10, long: 10, every: 0 } };
  const MODES = [['pomodoro', 'Pomodoro'], ['deep', 'Deep work'], ['custom', 'Custom'], ['stopwatch', 'Stopwatch']];
  const DEFAULT = {
    v: 1, mode: 'pomodoro', custom: { work: 25, brk: 5, long: 15, every: 4 }, auto: false, sound: true, notify: false,
    phase: 'work', status: 'idle', endsAt: 0, left: null, watchFrom: 0, watchAcc: 0,
    cycle: 0, day: '', sessions: 0, block: '', blockStart: 0, course: null
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

  /* ---------------- the state, shared by every tab ---------------- */
  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    s = Object.assign({}, DEFAULT, s && s.v === 1 ? s : {});
    s.custom = Object.assign({}, DEFAULT.custom, s.custom || {});
    if (!MODES.some(([m]) => m === s.mode)) s.mode = 'pomodoro';
    if (!['work', 'break', 'long'].includes(s.phase)) s.phase = 'work';
    if (!['idle', 'running', 'paused'].includes(s.status)) s.status = 'idle';
    if (s.day !== dayOf(Date.now())) { s.day = dayOf(Date.now()); s.sessions = 0; }
    return s;
  }
  let S = load();
  const listeners = new Set();
  function save(s) {
    S = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage full or blocked: this tab still works */ }
    emit();
  }
  function emit() { listeners.forEach((fn) => { try { fn(S); } catch (e) { console.warn('[Primer] timer', e); } }); render(); }
  addEventListener('storage', (e) => { if (e.key === KEY) { S = load(); emit(); } });

  const lengths = (s) => (s.mode === 'custom' ? s.custom : PRESETS[s.mode] || PRESETS.pomodoro);
  const phaseLen = (s, phase) => { const L = lengths(s); return (phase === 'work' ? L.work : phase === 'long' ? L.long : L.brk) * MIN; };
  const remaining = (s) => (s.status === 'running' ? Math.max(0, s.endsAt - Date.now()) : s.left != null ? s.left : phaseLen(s, s.phase));
  const left = (s) => remaining(s) * SPEED; // what the clock shows (the same, unless sped up for testing)
  const watchTime = (s) => s.watchAcc + (s.status === 'running' ? Date.now() - s.watchFrom : 0);
  const clock = (ms) => {
    const x = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), r = x % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')) + ':' + String(r).padStart(2, '0');
  };
  const PHASE = { work: 'Focus', break: 'Short break', long: 'Long break' };

  function describe(s) {
    s = s || S;
    if (s.mode === 'stopwatch') return fill(s.status === 'paused' ? 'Stopwatch paused at {time}' : 'Stopwatch: {time}', { time: clock(watchTime(s)) });
    const what = t(s.phase === 'work' ? 'Focus' : 'Break');
    if (s.status === 'paused') return fill('{what} paused, {time} left', { what, time: clock(left(s)) });
    return fill('{what}: {time} left', { what, time: clock(left(s)) });
  }

  // the course this page is about, if any
  function pageCourse() {
    const id = P.params.get('course');
    if (!id || !/^[A-Za-z0-9_-]{4,64}$/.test(id)) return null;
    const c = P.courses && P.courses.get && P.courses.get(id);
    return { id, title: c ? c.title : (S.course && S.course.id === id ? S.course.title : '') };
  }

  /* ---------------- actions ---------------- */
  function start(opts = {}) {
    let s = load();
    if (opts.mode && opts.mode !== s.mode && MODES.some(([m]) => m === opts.mode)) {
      s = Object.assign(s, { mode: opts.mode, phase: 'work', status: 'idle', left: null, watchAcc: 0, cycle: 0 });
    }
    const course = opts.course || pageCourse() || s.course;
    if (course) s.course = { id: course.id, title: course.title || '' };
    const now = Date.now();
    if (s.mode === 'stopwatch') {
      if (s.status !== 'running') { s.status = 'running'; s.watchFrom = now; if (!s.block) s.block = uid(); }
    } else if (s.status !== 'running') {
      if (s.status === 'idle') { s.block = uid(); s.blockStart = now; }
      s.endsAt = now + remaining(s);
      s.status = 'running';
      s.left = null;
    }
    save(s);
    say(describe(s));
  }
  function pause() {
    const s = load();
    if (s.status !== 'running') return;
    if (s.mode === 'stopwatch') { s.watchAcc += Date.now() - s.watchFrom; } else { s.left = Math.max(0, s.endsAt - Date.now()); }
    s.status = 'paused';
    save(s);
    say(describe(s));
  }
  function reset() {
    const s = load();
    Object.assign(s, { status: 'idle', phase: 'work', left: null, watchAcc: 0, watchFrom: 0, cycle: 0, block: '' });
    save(s);
    say(t('Timer reset.'));
  }
  function skip() {
    const s = load();
    if (s.mode === 'stopwatch') return;
    const was = s.status;
    advance(s, true);
    if (was === 'running') { s.status = 'running'; s.endsAt = Date.now() + phaseLen(s, s.phase); s.blockStart = Date.now(); }
    save(s);
    say(describe(s));
  }
  // the block after this one (a skipped focus block doesn't count as a session)
  function advance(s, skipped) {
    const L = lengths(s);
    if (s.phase === 'work') {
      if (!skipped) s.cycle += 1;
      s.phase = !skipped && L.every && s.cycle % L.every === 0 ? 'long' : 'break';
    } else {
      s.phase = 'work';
    }
    s.block = uid();
    s.left = null;
    s.status = 'idle';
  }

  /* ---------------- a block ends ---------------- */
  function tick() {
    if (S.status === 'running' && S.mode !== 'stopwatch' && Date.now() >= S.endsAt) {
      const s = load(); // another tab may have moved it on already
      if (s.status === 'running' && s.mode !== 'stopwatch' && Date.now() >= s.endsAt) finishBlock(s);
      else { S = s; emit(); }
    }
    renderTime();
  }

  function finishBlock(s) {
    const late = Date.now() - s.endsAt;
    let from = s.phase, guard = 0;
    while (s.status === 'running' && Date.now() >= s.endsAt && guard++ < 60) {
      from = s.phase;
      const endedAt = s.endsAt;
      if (s.phase === 'work') {
        if (s.day !== dayOf(endedAt)) { s.day = dayOf(endedAt); s.sessions = 0; }
        s.sessions += 1;
        logSession({ key: s.block, courseId: s.course ? s.course.id : null, kind: s.mode, ms: phaseLen(s, 'work') * SPEED });
      }
      advance(s, false);
      if (s.auto) { s.status = 'running'; s.blockStart = endedAt; s.endsAt = endedAt + phaseLen(s, s.phase); }
    }
    save(s);
    if (late < 120000) announce(from, s); // a block that ended while Primer was closed isn't announced late
  }

  function announce(from, s) {
    const mins = Math.round(phaseLen(s, s.phase) / MIN);
    const title = t(from === 'work' ? 'Focus block done' : 'Break over');
    const body = from === 'work'
      ? (s.phase === 'long' ? fill('Take a {m}-minute break. You’ve earned a long one.', { m: mins }) : fill('Time for a {m}-minute break.', { m: mins }))
      : (s.auto ? t('The next focus block has started.') : t('Ready for the next focus block? Start it when you are.'));
    if (s.sound) chime();
    notify(title, body);
    if (document.visibilityState === 'visible') P.toast(`${title}. ${body}`);
    say(`${title}. ${body}`);
  }

  function chime() {
    if (P.sfx && P.sfx.play) { P.sfx.play('complete'); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      const c = chime.ctx || (chime.ctx = new C());
      [523.3, 784].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        const at = c.currentTime + i * 0.18;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.09, at + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
        o.connect(g).connect(c.destination);
        o.start(at); o.stop(at + 1);
      });
    } catch (e) { /* no audio */ }
  }

  async function notify(title, body) {
    if (!S.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = {
      body, tag: 'primer-timer', renotify: true, icon: '/assets/icons/icon-192.png', badge: '/assets/icons/icon-192.png',
      data: { primer: 'timer', url: location.pathname + location.search, focus: true }
    };
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg && reg.active) { await reg.showNotification(title, opts); return; }
    } catch (e) { /* fall back to a page notification */ }
    try { new Notification(title, opts); } catch (e) { /* not allowed here */ }
  }

  /* ---------------- sessions and the study clock, sent to the account ---------------- */
  const PENDING = 'primer.clock.pending.' + user.id; // what couldn't be sent yet: { time: { key: entry }, sessions: [] }
  const SHARED = 'primer.clock.last.' + user.id;     // when any tab last counted a moment
  const readPending = () => { try { return JSON.parse(localStorage.getItem(PENDING) || 'null') || { time: {}, sessions: [] }; } catch (e) { return { time: {}, sessions: [] }; } };
  const writePending = (p) => { try { localStorage.setItem(PENDING, JSON.stringify(p)); } catch (e) { /* noop */ } };

  function logSession(sess) {
    P.post('/api/study/session', sess, { keepalive: true }).catch(() => {
      const p = readPending();
      if (!p.sessions.some((x) => x.key === sess.key)) p.sessions.push(sess);
      writePending(p);
    });
  }

  let counts = {};             // "course|lesson|day" -> { c, n, d, ms, tms }, not yet sent
  let myLast = 0;              // when this tab last counted
  let lastActive = Date.now(); // the learner's last sign of life on this page
  const onLesson = /\/lesson\.html$/.test(location.pathname);
  const here = { c: P.params.get('course') || '', n: onLesson ? Number(P.params.get('lesson')) || 0 : 0 };
  if (here.c && !/^[A-Za-z0-9_-]{4,64}$/.test(here.c)) { here.c = ''; here.n = 0; }
  const active = () => { lastActive = Date.now(); };
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'].forEach((ev) => addEventListener(ev, active, { capture: true, passive: true }));
  addEventListener('scroll', active, { capture: true, passive: true });
  let moveAt = 0;
  addEventListener('pointermove', () => { const n = Date.now(); if (n - moveAt > 5000) { moveAt = n; active(); } }, { passive: true });
  const playing = () => Array.from(document.querySelectorAll('video, audio')).some((m) => !m.paused && !m.ended) || (document.activeElement && document.activeElement.tagName === 'IFRAME');

  function clockTick() {
    const now = Date.now();
    const timerOn = S.status === 'running' && (S.mode === 'stopwatch' || S.phase === 'work');
    const lessonOn = onLesson && here.c && document.visibilityState === 'visible' && (now - lastActive < 180000 || playing());
    if (!timerOn && !lessonOn) { myLast = 0; return; }
    let shared = 0;
    try { shared = Number(localStorage.getItem(SHARED)) || 0; } catch (e) { shared = 0; }
    try { localStorage.setItem(SHARED, String(now)); } catch (e) { /* noop */ }
    if (!myLast) { myLast = now; return; }
    const delta = Math.min(now - Math.max(myLast, shared), 65000); // a background tab ticks about once a minute
    myLast = now;
    if (delta <= 0) return;
    const c = here.c || (timerOn && S.course ? S.course.id : '');
    const n = here.c ? here.n : 0;
    const d = dayOf(now);
    const k = `${c}|${n}|${d}`;
    const e = counts[k] || (counts[k] = { c, n, d, ms: 0, tms: 0 });
    e.ms += delta * (timerOn ? SPEED : 1);
    if (timerOn) e.tms += delta * SPEED;
  }

  // everything not yet sent (this tab's counts and what was left on the device), taken out of storage
  function takeAll() {
    const p = readPending();
    const mine = counts;
    counts = {};
    Object.values(mine).forEach((e) => {
      const k = `${e.c}|${e.n}|${e.d}`;
      const cur = p.time[k] || (p.time[k] = { c: e.c, n: e.n, d: e.d, ms: 0, tms: 0 });
      cur.ms += Math.round(e.ms); cur.tms += Math.round(e.tms);
    });
    writePending({ time: {}, sessions: [] });
    return { entries: Object.values(p.time).filter((e) => e.ms > 0), sessions: p.sessions.slice() };
  }
  function putBack({ entries, sessions }) {
    const back = readPending();
    entries.forEach((e) => {
      const k = `${e.c}|${e.n}|${e.d}`;
      const cur = back.time[k] || (back.time[k] = { c: e.c, n: e.n, d: e.d, ms: 0, tms: 0 });
      cur.ms += e.ms; cur.tms += e.tms;
    });
    sessions.forEach((x) => { if (!back.sessions.some((y) => y.key === x.key)) back.sessions.push(x); });
    writePending(back);
  }

  let sending = false;
  async function flush() {
    if (sending) return;
    const all = takeAll();
    if (!all.entries.length && !all.sessions.length) return;
    sending = true;
    try {
      if (all.entries.length) await P.post('/api/study/time', { entries: all.entries }, { timeout: 20000 });
    } catch (err) {
      putBack(all);
      sending = false;
      return;
    }
    sending = false;
    all.sessions.forEach(logSession);
  }
  // Leaving the page (or hiding it): a beacon, which the browser delivers after the page has gone.
  // Whatever can't be sent that way waits on the device for the next page.
  function leaving() {
    clockTick();
    const all = takeAll(); // (a save already on its way has its own entries)
    let sent = false;
    if (all.entries.length && navigator.sendBeacon) {
      try { sent = navigator.sendBeacon('/api/study/time', new Blob([JSON.stringify({ entries: all.entries })], { type: 'application/json' })); } catch (e) { sent = false; }
    }
    putBack(sent ? { entries: [], sessions: all.sessions } : all);
  }
  setInterval(clockTick, 1000);
  setInterval(flush, 60000);
  setTimeout(flush, 4000); // anything left from last time
  addEventListener('pagehide', leaving);
  document.addEventListener('visibilitychange', () => { if (document.hidden) leaving(); else active(); });

  /* ---------------- the button and its panel ---------------- */
  P.studyBar = P.studyBar || function () {
    let bar = $('.sbar');
    if (bar) return bar;
    bar = document.createElement('span');
    bar.className = 'sbar';
    const tools = $('.lbar__tools'), links = $('.nav__links');
    if (tools) tools.prepend(bar);
    else if (links) links.insertBefore(bar, links.querySelector('.user') || null);
    else { bar.classList.add('sbar--float'); document.body.appendChild(bar); }
    return bar;
  };
  P.studyPop = P.studyPop || (() => {
    let open = null;
    const place = (btn, pop) => {
      const r = btn.getBoundingClientRect();
      pop.style.setProperty('--sp-top', Math.round(r.bottom + 8) + 'px');
      pop.style.setProperty('--sp-right', Math.max(8, Math.round(window.innerWidth - r.right)) + 'px');
    };
    const api = {
      toggle(btn, pop, on) {
        const show = on == null ? pop.hidden : on;
        if (show && open && open.pop !== pop) api.toggle(open.btn, open.pop, false);
        pop.hidden = !show;
        btn.setAttribute('aria-expanded', String(show));
        if (show) { place(btn, pop); open = { btn, pop }; pop.dispatchEvent(new CustomEvent('sp:open')); } else if (open && open.pop === pop) open = null;
      },
      close(focus) { if (!open) return; const o = open; api.toggle(o.btn, o.pop, false); if (focus) o.btn.focus(); },
      get open() { return open; }
    };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && !document.querySelector('dialog[open]')) { e.stopPropagation(); api.close(true); } });
    document.addEventListener('pointerdown', (e) => { if (open && !open.pop.contains(e.target) && !open.btn.contains(e.target)) api.close(false); });
    addEventListener('resize', () => { if (open) place(open.btn, open.pop); });
    return api;
  })();

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.8"/><path d="M12 13.5l2.6 1.6"/><path d="M9.5 3h5"/></svg>';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sbtn sbtn--timer';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'sb-timer');
  btn.innerHTML = `${ICON}<span class="sbtn__time" hidden></span><span class="sbtn__label">${T('Timer')}</span>`;
  const pop = document.createElement('section');
  pop.className = 'spop stimer';
  pop.id = 'sb-timer';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-labelledby', 'sb-timer-title');
  const R = 52, CIRC = 2 * Math.PI * R;
  pop.innerHTML = `
    <header class="spop__head">
      <h2 id="sb-timer-title">${T('Study timer')}</h2>
      <button class="spop__x" type="button" aria-label="${T('Close the timer')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </header>
    <div class="stimer__modes" role="radiogroup" aria-label="${T('Kind of timer')}">
      ${MODES.map(([m, label]) => `<button class="stimer__mode" type="button" role="radio" data-mode="${m}" aria-checked="false">${T(label)}</button>`).join('')}
    </div>
    <div class="stimer__face">
      <svg class="stimer__ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="stimer__track" cx="60" cy="60" r="${R}"/><circle class="stimer__arc" cx="60" cy="60" r="${R}" stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="0"/></svg>
      <div class="stimer__read">
        <span class="stimer__phase"></span>
        <span class="stimer__clock" role="timer" aria-live="off"></span>
        <span class="stimer__sub"></span>
      </div>
    </div>
    <div class="stimer__controls">
      <button class="btn stimer__go" type="button" data-act="go"></button>
      <button class="btn btn--ghost btn--small" type="button" data-act="skip">${T('Skip')}</button>
      <button class="textlink" type="button" data-act="reset">${T('Reset')}</button>
    </div>
    <p class="sr-only" aria-live="polite" data-say></p>
    <fieldset class="stimer__custom" hidden>
      <legend class="sr-only">${T('Custom lengths')}</legend>
      <label>${T('Focus')} <input class="input" type="number" inputmode="numeric" min="1" max="180" data-len="work"> <span>${T('min')}</span></label>
      <label>${T('Break')} <input class="input" type="number" inputmode="numeric" min="1" max="60" data-len="brk"> <span>${T('min')}</span></label>
      <label>${T('Long break')} <input class="input" type="number" inputmode="numeric" min="1" max="90" data-len="long"> <span>${T('min')}</span></label>
      <label>${T('Long break every')} <input class="input" type="number" inputmode="numeric" min="0" max="12" data-len="every"> <span>${T('sessions')}</span></label>
    </fieldset>
    <div class="stimer__opts">
      <label><input type="checkbox" data-opt="auto"> ${T('Start the next block on its own')}</label>
      <label><input type="checkbox" data-opt="sound"> ${T('Play a soft sound when a block ends')}</label>
      <label><input type="checkbox" data-opt="notify"> ${T('Notify me when a block ends')}</label>
      <p class="stimer__perm" data-perm></p>
    </div>
    <p class="stimer__today" data-today></p>
    <p class="stimer__course" data-course></p>
    <p class="stimer__note">${T('The timer keeps running as you move between pages. Notifications show while Primer is open in a tab, even in the background.')}</p>`;
  P.studyBar().appendChild(btn);
  document.body.appendChild(pop);
  const sayEl = pop.querySelector('[data-say]');
  function say(msg) { sayEl.textContent = ''; setTimeout(() => { sayEl.textContent = msg; }, 30); }

  btn.addEventListener('click', () => P.studyPop.toggle(btn, pop));
  pop.querySelector('.spop__x').addEventListener('click', () => P.studyPop.close(true));
  pop.addEventListener('sp:open', () => { render(); loadToday(); const c = pop.querySelector('.stimer__go'); if (c) c.focus({ preventScroll: true }); });

  pop.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    const s = load();
    if (b.dataset.mode === s.mode) return;
    if (s.status !== 'idle' && !window.confirm(t('Stop the running timer and switch?'))) return;
    Object.assign(s, { mode: b.dataset.mode, phase: 'work', status: 'idle', left: null, watchAcc: 0, watchFrom: 0, cycle: 0, block: '' });
    save(s);
  }));
  pop.querySelector('.stimer__modes').addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const list = $$('[data-mode]', pop);
    const i = list.indexOf(document.activeElement);
    const next = list[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length];
    next.focus();
    next.click();
  });
  pop.querySelector('[data-act="go"]').addEventListener('click', () => (S.status === 'running' ? pause() : start()));
  pop.querySelector('[data-act="skip"]').addEventListener('click', skip);
  pop.querySelector('[data-act="reset"]').addEventListener('click', reset);
  pop.querySelectorAll('[data-len]').forEach((inp) => inp.addEventListener('change', () => {
    const s = load();
    const k = inp.dataset.len;
    const lim = { work: [1, 180, 25], brk: [1, 60, 5], long: [1, 90, 15], every: [0, 12, 4] }[k];
    s.custom[k] = num(inp.value, lim[0], lim[1], lim[2]);
    inp.value = s.custom[k];
    if (s.mode === 'custom' && s.status === 'idle') s.left = null;
    save(s);
  }));
  pop.querySelectorAll('[data-opt]').forEach((box) => box.addEventListener('change', async () => {
    const s = load();
    const k = box.dataset.opt;
    if (k === 'notify' && box.checked) {
      if (!('Notification' in window)) { box.checked = false; permNote(t('This browser can’t show notifications.')); return; }
      let perm = Notification.permission;
      if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; } }
      if (perm !== 'granted') { box.checked = false; permNote(t('Notifications are blocked for Primer. Allow them in your browser’s site settings, then try again.')); return; }
    }
    s[k] = box.checked;
    save(s);
  }));
  function permNote(msg) { pop.querySelector('[data-perm]').textContent = msg; }

  async function loadToday() {
    const el = pop.querySelector('[data-today]');
    try {
      await flush();
      const d = await P.get(`/api/study/today?day=${dayOf(Date.now())}&since=${startOfDay()}`);
      const parts = [fill('Today: {time} studied', { time: P.study ? P.study.duration(d.ms) : clock(d.ms) })];
      parts.push(d.sessions === 1 ? t('1 focus session') : fill('{n} focus sessions', { n: d.sessions }));
      el.textContent = parts.join(' · ');
    } catch (e) {
      el.textContent = S.sessions ? (S.sessions === 1 ? t('1 focus session today') : fill('{n} focus sessions today', { n: S.sessions })) : '';
    }
  }

  let lastLabel = '';
  function renderTime() {
    const s = S;
    const busy = s.status !== 'idle';
    const ms = s.mode === 'stopwatch' ? watchTime(s) : left(s);
    const tm = btn.querySelector('.sbtn__time');
    tm.hidden = !busy;
    if (busy) tm.textContent = clock(ms);
    btn.classList.toggle('is-running', s.status === 'running');
    btn.classList.toggle('is-break', s.mode !== 'stopwatch' && s.phase !== 'work');
    const label = busy ? `${t('Study timer')}, ${describe(s)}` : t('Study timer');
    const coarse = label.replace(/:\d\d left$/, '');
    if (coarse !== lastLabel) { btn.setAttribute('aria-label', label); lastLabel = coarse; }
    if (pop.hidden) return;
    pop.querySelector('.stimer__clock').textContent = clock(ms);
    const total = s.mode === 'stopwatch' ? 0 : phaseLen(s, s.phase) * SPEED;
    const frac = s.mode === 'stopwatch' ? ((watchTime(s) / 60000) % 60) / 60 : total ? 1 - ms / total : 0;
    pop.querySelector('.stimer__arc').setAttribute('stroke-dashoffset', (CIRC * (1 - frac)).toFixed(2));
  }

  function render() {
    renderTime();
    if (pop.hidden) return;
    const s = S;
    const L = lengths(s);
    pop.classList.toggle('is-break', s.mode !== 'stopwatch' && s.phase !== 'work');
    pop.querySelectorAll('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === s.mode;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    pop.querySelector('.stimer__phase').textContent = s.mode === 'stopwatch' ? t('Stopwatch') : t(PHASE[s.phase]);
    let sub = '';
    if (s.mode !== 'stopwatch') {
      if (L.every) sub = fill('Session {k} of {n} before a long break', { k: (s.cycle % L.every) + (s.phase === 'work' ? 1 : 0) || L.every, n: L.every });
      else sub = s.sessions ? (s.sessions === 1 ? t('1 focus session today') : fill('{n} focus sessions today', { n: s.sessions })) : t('No long breaks in this mode');
    } else sub = t('Counts up until you stop it');
    pop.querySelector('.stimer__sub').textContent = sub;
    const go = pop.querySelector('[data-act="go"]');
    go.textContent = t(s.status === 'running' ? 'Pause' : s.status === 'paused' ? 'Resume' : 'Start');
    pop.querySelector('[data-act="skip"]').hidden = s.mode === 'stopwatch';
    pop.querySelector('[data-act="reset"]').textContent = t(s.mode === 'stopwatch' ? 'Stop' : 'Reset');
    const custom = pop.querySelector('.stimer__custom');
    custom.hidden = s.mode !== 'custom';
    custom.querySelectorAll('[data-len]').forEach((inp) => { if (document.activeElement !== inp) inp.value = s.custom[inp.dataset.len]; });
    pop.querySelectorAll('[data-opt]').forEach((box) => { box.checked = Boolean(s[box.dataset.opt]); });
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    if (s.notify && perm !== 'granted') permNote(t('Notifications are blocked for Primer. Allow them in your browser’s site settings, then try again.'));
    else if (!pop.querySelector('[data-perm]').textContent || s.notify) permNote('');
    const c = pageCourse() || s.course;
    pop.querySelector('[data-course]').innerHTML = c && c.title
      ? `${T('Time counts toward:')} <strong class="ugc">${esc(c.title)}</strong>`
      : T('Time counts toward your total. Start the timer on a course’s page to count it for that course.');
  }

  setInterval(tick, 250);
  tick();
  render();

  P.timer = {
    state: () => S,
    start, pause, reset, skip, describe,
    on(fn) { listeners.add(fn); try { fn(S); } catch (e) { /* noop */ } return () => listeners.delete(fn); },
    flush
  };
})();
