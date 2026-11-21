/* =====================================================================
   Talk: a hands-free, spoken conversation with the tutor, in the tutor
   panel (tutor.js loads this when the server has ElevenLabs; the server
   side is server/talk.mjs).

   The learner taps "Talk" and speaks. Hold the microphone while
   speaking, or tap it and pause: a short silence ends the turn. The
   recording goes to ElevenLabs speech to text (in the learner's
   language), the tutor answers with its memory as in the text chat, and
   the answer is read aloud (ElevenLabs, in the learner's language, maths
   as words; the browser's own voice when ElevenLabs can't), then it
   listens again. What was said and answered stays in the conversation
   above, like typed messages. Tapping the microphone while the tutor
   speaks interrupts it; Stop ends listening and speaking and turns the
   microphone off. The microphone is only on while Talk is open, and
   nothing is recorded unless the button is lit.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const UI = P && P.tutorUI;
  if (!UI || !P.boot.talk || UI.panel.querySelector('.talk')) return;
  const $ = P.$, esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'assets/css/talk.css';
  document.head.appendChild(css);

  const MIC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>';
  const KEYS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>';
  // the browser's voices go by region too
  const BCP47 = {
    en: 'en-IN', hi: 'hi-IN', bho: 'hi-IN', mai: 'hi-IN', bn: 'bn-IN', mr: 'mr-IN', te: 'te-IN', ta: 'ta-IN', gu: 'gu-IN', ur: 'ur-IN',
    kn: 'kn-IN', or: 'or-IN', ml: 'ml-IN', pa: 'pa-IN', as: 'as-IN', es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA', pt: 'pt-BR', ru: 'ru-RU'
  };
  const STICKY = new Set(['quota', 'no-key', 'key']); // the device's voice for the rest of the conversation
  const HOLD_MS = 450;     // pressed longer than this: let go to send
  const SILENCE_MS = 1200; // a pause this long ends the turn
  const WAIT_MS = 8000;    // nothing said for this long: stop listening
  const MAX_MS = 30000;

  const panel = UI.panel;
  const head = panel.querySelector('.tutor__head');
  const form = panel.querySelector('.tutor__form');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'talk-switch';
  toggle.setAttribute('aria-pressed', 'false');
  head.insertBefore(toggle, head.querySelector('.tutor__x'));

  const bar = document.createElement('div');
  bar.className = 'talk';
  bar.hidden = true;
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Talk with the tutor');
  bar.innerHTML = `
    <div class="talk__help" role="note" hidden></div>
    <p class="talk__status" role="status" aria-live="polite"></p>
    <div class="talk__row">
      <button class="talk__mic" type="button" aria-pressed="false"><span class="talk__ring" aria-hidden="true"></span>${MIC}</button>
      <div class="talk__side">
        <div class="talk__meter" aria-hidden="true"><span></span></div>
        <label class="talk__auto"><input type="checkbox" checked> Keep listening after each answer</label>
      </div>
      <button class="talk__stop" type="button" hidden>Stop</button>
    </div>
    <p class="talk__hint">Hold the button while you speak, or tap it and pause when you’re done.</p>
    <p class="talk__note" hidden></p>`;
  form.after(bar);

  const mic = $('.talk__mic', bar), stopBtn = $('.talk__stop', bar), status = $('.talk__status', bar);
  const meter = $('.talk__meter span', bar), autoBox = $('.talk__auto input', bar), note = $('.talk__note', bar), help = $('.talk__help', bar);

  const S = {
    on: false, state: 'idle', turn: 0,
    stream: null, ctx: null, an: null, buf: null,
    rec: null, chunks: [], send: false, timer: 0,
    listenAt: 0, floor: 1, voiced: 0, lastVoice: 0,
    abort: null, audio: null, endAudio: null, endSay: null,
    device: false // reading with the browser's voice
  };
  let pressed = false, downAt = 0;

  /* ---------------- what the panel shows ---------------- */

  const LABEL = { idle: 'Start talking', listening: 'Done speaking', thinking: 'Thinking', speaking: 'Interrupt and speak', asking: 'Start talking' };
  function setState(state, msg, isError) {
    S.state = state;
    bar.dataset.state = state;
    mic.setAttribute('aria-label', t(LABEL[state] || LABEL.idle));
    mic.setAttribute('aria-pressed', String(state === 'listening'));
    mic.disabled = state === 'thinking' || state === 'asking';
    stopBtn.hidden = state === 'idle' || state === 'asking';
    status.classList.toggle('is-error', Boolean(isError));
    status.setAttribute('role', isError ? 'alert' : 'status');
    if (msg != null) status.textContent = t(msg);
    if (state !== 'listening') meter.style.transform = 'scaleX(0)';
  }
  function setNote(msg) { note.hidden = !msg; note.textContent = msg ? t(msg) : ''; }
  function paintToggle() {
    toggle.innerHTML = S.on ? `${KEYS}<span>Type</span>` : `${MIC}<span>Talk</span>`;
    toggle.setAttribute('aria-pressed', String(S.on));
    toggle.setAttribute('aria-label', t(S.on ? 'Type instead of talking' : 'Talk with the tutor'));
  }
  paintToggle();

  function bubble(m) {
    const empty = UI.log.querySelector('.tutor__empty');
    if (empty) empty.remove();
    const li = UI.bubble(m);
    if (m.role === 'learner') li.classList.add('tmsg--spoken');
    UI.scrollEnd();
    return li;
  }
  function thinking() {
    const li = document.createElement('li');
    li.className = 'tmsg tmsg--tutor is-thinking';
    li.innerHTML = `<div class="tmsg__body"><span class="quill" aria-hidden="true"><i></i><i></i><i></i></span> ${esc(t('Thinking…'))}</div>`;
    UI.log.appendChild(li);
    UI.scrollEnd();
    return li;
  }
  function showHelpline(h) {
    if (!h) return;
    help.hidden = false;
    help.innerHTML = `<p>${esc(t('If you’re going through a hard time, you don’t have to face it alone.'))}</p>
      <p><a href="tel:${esc(h.number)}" class="talk__call">${esc(t('Call'))} ${esc(h.name)}: <strong>${esc(h.number)}</strong></a> <span>${esc(t(h.note))}</span></p>
      <p><a href="${esc(h.more)}" target="_blank" rel="noopener">${esc(t('Find a free helpline near you'))}</a></p>`;
  }

  /* ---------------- the microphone ---------------- */

  const BLOCKED = 'Primer isn’t allowed to use your microphone. Allow it for this site (the icon beside the web address), then tap the microphone again.';
  function problem(msg) { release(); setState('idle', msg, true); }

  async function ensureMic() {
    if (S.stream && S.stream.active && S.ctx) return true;
    if (!window.isSecureContext) { problem('Talking needs a secure (https) connection to Primer.'); return false; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { problem('This browser can’t record your voice. Type your question instead.'); return false; }
    setState('asking', 'Allow the microphone when the browser asks. Primer only listens while the button is lit.');
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') problem(BLOCKED);
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') problem('No microphone was found. Connect one, or type your question instead.');
      else if (name === 'NotReadableError' || name === 'AbortError') problem('The microphone is busy in another app. Close that app, then tap the microphone again.');
      else problem('The microphone couldn’t be started. Type your question instead.');
      return false;
    }
    if (!S.on) { release(); return false; }
    const AC = window.AudioContext || window.webkitAudioContext;
    S.ctx = new AC();
    S.an = S.ctx.createAnalyser();
    S.an.fftSize = 1024;
    S.ctx.createMediaStreamSource(S.stream).connect(S.an);
    S.buf = new Float32Array(S.an.fftSize);
    const track = S.stream.getAudioTracks()[0];
    if (track) track.addEventListener('ended', () => { if (S.on) problem('The microphone was turned off.'); });
    setNote('');
    return true;
  }
  function release() {
    clearInterval(S.timer);
    if (S.rec && S.rec.state === 'recording') { S.send = false; try { S.rec.stop(); } catch (e) { /* already stopped */ } }
    if (S.stream) S.stream.getTracks().forEach((tr) => tr.stop());
    if (S.ctx) S.ctx.close().catch(() => {});
    S.stream = null; S.ctx = null; S.an = null;
  }
  // What the browser says about the microphone before asking, so a blocked one is explained at once.
  function checkPermission() {
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve('unknown');
    return navigator.permissions.query({ name: 'microphone' }).then((p) => {
      p.onchange = () => { if (p.state === 'granted' && S.on && S.state === 'idle') setNote(''); };
      return p.state;
    }).catch(() => 'unknown');
  }

  /* ---------------- listening ---------------- */

  const recType = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((x) => MediaRecorder.isTypeSupported(x)) || '';

  async function listen() {
    S.turn++; // an answer still being read or written is dropped
    if (S.abort) S.abort.abort();
    stopSpeaking();
    if (!(await ensureMic())) return;
    if (!S.on) return;
    if (S.ctx.state === 'suspended') await S.ctx.resume().catch(() => {});
    const type = recType();
    S.chunks = [];
    S.send = true;
    try {
      S.rec = new MediaRecorder(S.stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    } catch (e) { problem('This browser can’t record your voice. Type your question instead.'); return; }
    const rec = S.rec;
    rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) S.chunks.push(e.data); });
    rec.addEventListener('stop', () => recorded(rec));
    rec.start(250);
    S.listenAt = performance.now();
    S.floor = 1; S.voiced = 0; S.lastVoice = 0;
    setState('listening', pressed ? 'Listening… let go when you’re done.' : 'Listening… pause when you’re done.');
    clearInterval(S.timer);
    S.timer = setInterval(tick, 50);
  }

  // The level of the microphone: a quiet start sets the room's noise, speech is well above it.
  function tick() {
    if (!S.an || S.state !== 'listening') return;
    S.an.getFloatTimeDomainData(S.buf);
    let sum = 0;
    for (let i = 0; i < S.buf.length; i++) sum += S.buf[i] * S.buf[i];
    const rms = Math.sqrt(sum / S.buf.length);
    meter.style.transform = `scaleX(${Math.min(1, rms * 14).toFixed(3)})`;
    const now = performance.now(), el = now - S.listenAt;
    if (el < 300) { S.floor = Math.min(S.floor, rms); return; }
    const thr = Math.max(0.012, Math.min(S.floor, 0.05) * 3);
    if (rms > thr) { S.voiced += 50; S.lastVoice = now; }
    const holding = pressed && now - downAt > HOLD_MS;
    if (!holding) {
      if (S.voiced >= 250 && now - S.lastVoice > SILENCE_MS) { finish(true); return; }
      if (S.voiced < 250 && el > WAIT_MS) { nothingHeard(); return; }
    }
    if (el > MAX_MS) finish(true);
  }

  function finish(send) {
    clearInterval(S.timer);
    if (!S.rec || S.rec.state !== 'recording') return;
    S.send = send;
    if (send) setState('thinking', 'Thinking…');
    S.rec.stop();
  }
  function nothingHeard() {
    finish(false);
    setState('idle', 'I didn’t hear anything. Tap the microphone when you’re ready.');
  }

  function recorded(rec) {
    const send = S.send && S.on;
    const blob = new Blob(S.chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
    S.chunks = [];
    if (!send) return;
    if (S.voiced < 150 || blob.size < 1200) { setState('idle', 'That was too short to hear. Tap the microphone and try again.'); return; }
    turn(blob);
  }

  /* ---------------- one turn: what was said, the answer, read aloud ---------------- */

  async function readLines(res, onLine) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let rest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (value) rest += dec.decode(value, { stream: !done });
      let i;
      while ((i = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, i).trim();
        rest = rest.slice(i + 1);
        if (line) { let m = null; try { m = JSON.parse(line); } catch (e) { /* not a line of ours */ } if (m) onLine(m); }
      }
      if (done) break;
    }
    if (rest.trim()) { try { onLine(JSON.parse(rest)); } catch (e) { /* ignore */ } }
  }

  // One turn: a recording (blob), or a question tapped from the examples (text).
  async function turn(blob, text) {
    const my = ++S.turn;
    setState('thinking', 'Thinking…');
    const h = UI.here() || {};
    const qs = h.courseId ? `?course=${encodeURIComponent(h.courseId)}${h.lesson ? '&lesson=' + encodeURIComponent(h.lesson) : ''}` : '';
    const ctrl = new AbortController();
    S.abort = ctrl;
    if (text) bubble({ role: 'learner', content: text });
    let wait = thinking();
    let reply = null, failed = null;
    try {
      const res = text
        ? await fetch('/api/talk/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ message: text }, h)), credentials: 'same-origin', signal: ctrl.signal })
        : await fetch('/api/talk' + qs, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob, credentials: 'same-origin', signal: ctrl.signal });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error((d && d.error) || (res.status === 401 ? 'Your session has ended. Sign in again.' : `The server answered with an error (${res.status}).`));
      }
      if (text) reply = await res.json();
      else {
        await readLines(res, (m) => {
          if (my !== S.turn) return;
          if (m.type === 'heard') { wait.remove(); bubble({ role: 'learner', content: m.text }); wait = thinking(); }
          else if (m.type === 'reply') reply = m;
          else if (m.type === 'error') failed = m.error;
        });
      }
    } catch (err) {
      wait.remove();
      if (err.name === 'AbortError' || my !== S.turn) return;
      setState('idle', err instanceof TypeError ? 'Can’t reach the Primer server. Check your connection and try again.' : err.message, true);
      return;
    }
    wait.remove();
    if (my !== S.turn || !S.on) return;
    if (!reply || reply.ok === false) { setState('idle', failed || (reply && reply.error) || 'The tutor didn’t answer. Try again.', true); return; }
    if (reply.reply) bubble(reply.reply);
    showHelpline(reply.helpline);
    const spoken = await speak(reply, my);
    if (!spoken || my !== S.turn || !S.on) return;
    if (autoBox.checked) listen();
    else setState('idle', 'Tap the microphone to answer.');
  }

  /* ---------------- speaking ---------------- */

  async function fetchPart(id, part, signal) {
    const res = await fetch('/api/talk/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, part }), credentials: 'same-origin', signal
    });
    if (res.ok && /^audio\//.test(res.headers.get('Content-Type') || '')) return res.blob();
    const d = await res.json().catch(() => null);
    throw Object.assign(new Error((d && d.error) || 'The voice couldn’t be made just now, so your device’s voice reads this answer.'), { fallback: (d && d.fallback) || 'failed' });
  }

  function playBlob(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      let over = false;
      const end = (ok) => { if (over) return; over = true; URL.revokeObjectURL(url); S.audio = null; S.endAudio = null; resolve(ok); };
      S.audio = a;
      S.endAudio = () => { a.pause(); end(false); };
      a.addEventListener('ended', () => end(true));
      a.addEventListener('error', () => end(false));
      a.play().catch(() => end(false));
    });
  }

  let voices = [];
  const loadVoices = () => { try { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch (e) { voices = []; } };
  if (window.speechSynthesis) { loadVoices(); speechSynthesis.addEventListener('voiceschanged', loadVoices); }
  function deviceSay(text, lang) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth || !window.SpeechSynthesisUtterance) { resolve(true); return; }
      const code = BCP47[lang] || lang || 'en-IN';
      const u = new SpeechSynthesisUtterance(text);
      u.lang = code;
      const base = code.split('-')[0];
      const v = voices.find((x) => x.lang === code) || voices.find((x) => String(x.lang).toLowerCase().startsWith(base));
      if (v) u.voice = v;
      let over = false;
      const end = (ok) => { if (over) return; over = true; clearTimeout(timer); S.endSay = null; resolve(ok); };
      // some browsers never say they've finished: the length of the text sets a limit
      const timer = setTimeout(() => end(true), 2500 + text.length * 90);
      u.addEventListener('end', () => end(true));
      u.addEventListener('error', (e) => end(e.error !== 'interrupted' && e.error !== 'canceled'));
      S.endSay = () => { synth.cancel(); end(false); };
      synth.speak(u);
    });
  }

  function stopSpeaking() {
    if (S.endAudio) S.endAudio();
    if (S.endSay) S.endSay();
    else if (window.speechSynthesis && speechSynthesis.speaking) speechSynthesis.cancel();
  }

  // Reads the reply aloud, part by part: ElevenLabs while it can (the next part is fetched while one
  // plays), then the device's voice. Returns false when it was interrupted or stopped.
  async function speak(reply, my) {
    const parts = reply.speak && reply.speak.parts && reply.speak.parts.length ? reply.speak.parts : [reply.say].filter(Boolean);
    if (!parts.length) return true;
    const lang = reply.lang || P.lang || 'en';
    setState('speaking', 'Speaking… tap the microphone to interrupt.');
    const live = () => my === S.turn && S.on && S.state === 'speaking';
    let i = 0;
    if (!S.device && reply.speak && reply.speak.id) {
      const ctrl = new AbortController();
      S.abort = ctrl;
      const get = (k) => fetchPart(reply.speak.id, k, ctrl.signal);
      let next = get(0);
      next.catch(() => {});
      for (; i < parts.length; i++) {
        let blob = null, err = null;
        try { blob = await next; } catch (e) { err = e; }
        if (!live()) { ctrl.abort(); return false; }
        if (err) {
          if (err.name === 'AbortError') return false;
          if (STICKY.has(err.fallback)) S.device = true;
          setNote(err.message);
          break;
        }
        if (i + 1 < parts.length) { next = get(i + 1); next.catch(() => {}); }
        const ok = await playBlob(blob);
        if (!live()) { ctrl.abort(); return false; }
        if (!ok) { ctrl.abort(); break; } // this part couldn't be played: the device reads it
      }
      if (i >= parts.length) return true;
    }
    for (; i < parts.length; i++) {
      if (!live()) return false;
      await deviceSay(parts[i], lang);
    }
    return live();
  }

  /* ---------------- turning Talk on and off ---------------- */

  async function enter() {
    S.on = true;
    paintToggle();
    panel.classList.add('is-talk');
    form.hidden = true;
    bar.hidden = false;
    UI.load().then(UI.scrollEnd).catch(() => {});
    setNote(S.device ? 'Your device’s voice reads the answers.' : '');
    const perm = await checkPermission();
    if (!S.on) return;
    if (perm === 'denied') { setState('idle', BLOCKED, true); return; }
    if (perm === 'prompt') setNote('Primer will ask to use your microphone. It only listens while the button is lit.');
    listen();
  }
  function stopAll(msg) {
    S.turn++;
    if (S.abort) S.abort.abort();
    stopSpeaking();
    pressed = false;
    release();
    setState('idle', msg == null ? 'Tap the microphone and ask your question.' : msg);
  }
  function leave() {
    if (!S.on) return;
    stopAll('');
    S.on = false;
    paintToggle();
    panel.classList.remove('is-talk');
    bar.hidden = true;
    form.hidden = false;
  }

  // an example question in an empty conversation is asked aloud too
  UI.log.addEventListener('click', (e) => {
    const eg = e.target.closest('.tutor__eg');
    if (!eg || !S.on) return;
    e.stopPropagation();
    if (S.state === 'thinking' || S.state === 'asking') return;
    if (S.state === 'listening') finish(false);
    stopSpeaking();
    turn(null, eg.textContent.trim());
  }, true);

  toggle.addEventListener('click', () => {
    if (S.on) { leave(); const input = panel.querySelector('#tutor-input'); if (input) input.focus(); } else enter();
  });
  stopBtn.addEventListener('click', () => { stopAll('Stopped. Tap the microphone to talk again.'); mic.focus(); });

  // the microphone button: press and hold, or tap
  function tap() {
    if (S.state === 'listening') finish(true);
    else if (S.state === 'speaking' || S.state === 'idle') listen();
  }
  mic.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || mic.disabled) return;
    e.preventDefault();
    pressed = true;
    downAt = performance.now();
    if (S.state === 'listening') { pressed = false; finish(true); return; }
    listen();
  });
  const release1 = () => {
    if (!pressed) return;
    pressed = false;
    if (S.state === 'listening' && performance.now() - downAt > HOLD_MS) finish(true); // held: letting go sends it
    else if (S.state === 'listening') status.textContent = t('Listening… pause when you’re done.');
  };
  mic.addEventListener('pointerup', release1);
  mic.addEventListener('pointercancel', release1);
  mic.addEventListener('contextmenu', (e) => e.preventDefault()); // a long press on a phone isn't a menu
  mic.addEventListener('click', (e) => { if (e.detail === 0) tap(); }); // the keyboard (pointer presses are handled above)

  // closing the panel, or leaving the page, turns the microphone off
  new MutationObserver(() => { if (panel.hidden) leave(); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.on) stopAll('Paused while Primer was in the background. Tap the microphone to talk again.'); });
  addEventListener('pagehide', () => release());

  P.talk = { enter, leave, stop: stopAll, get state() { return S.state; }, get on() { return S.on; } };
})();
