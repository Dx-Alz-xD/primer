/* =====================================================================
   Voice on the lesson page.
   - P.sfx.play('correct' | 'wrong' | 'unlock' | 'complete'): ElevenLabs
     sound effects when the server has a key, quiet built-in tones when
     it doesn't. A speaker button in the toolbar turns sound on or off.
   - P.voice: "Listen" on every part of a lesson, read aloud by
     ElevenLabs, with a small player that can keep reading on.
   - P.voice.micButton(textarea, where): speak a doubt instead of typing.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, esc = P.esc;

  /* ---------------- sound effects ---------------- */
  let actx = null;
  const ctx = () => (actx = actx || new (window.AudioContext || window.webkitAudioContext)());
  function tone(freqs, { type = 'sine', dur = 0.35, gap = 0.09, vol = 0.12 } = {}) {
    try {
      const c = ctx();
      freqs.forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        const t = c.currentTime + i * gap;
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(c.destination);
        o.start(t); o.stop(t + dur + 0.05);
      });
    } catch (e) { /* no audio */ }
  }
  function rustle() {
    try {
      const c = ctx(), len = Math.floor(c.sampleRate * 0.28);
      const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.7; g.gain.value = 0.08;
      src.buffer = buf; src.connect(f).connect(g).connect(c.destination); src.start();
    } catch (e) { /* no audio */ }
  }
  const FALLBACK = {
    correct: () => tone([659.3, 880], { dur: 0.5 }),
    wrong: () => tone([196, 174.6], { type: 'triangle', dur: 0.32, gap: 0.12, vol: 0.09 }),
    unlock: rustle,
    complete: () => tone([523.3, 659.3, 784, 1046.5], { dur: 0.7, gap: 0.11, vol: 0.1 })
  };
  const clips = {};
  let muted = false;
  try { muted = P.store.get('primer.sound.off', false) === true; } catch (e) { muted = false; }
  P.sfx = {
    get muted() { return muted; },
    play(name) {
      if (muted || P.motion.reduce && name === 'unlock') return;
      if (P.boot.voice) {
        let a = clips[name];
        if (!a) { a = clips[name] = new Audio(`/audio/sfx/${name}.mp3`); a.volume = 0.45; a.addEventListener('error', () => { clips[name] = 'fallback'; }); }
        if (a !== 'fallback') {
          a.currentTime = 0;
          a.play().catch(() => { clips[name] = 'fallback'; FALLBACK[name](); });
          return;
        }
      }
      if (FALLBACK[name]) FALLBACK[name]();
    },
    setMuted(on) { muted = on; P.store.set('primer.sound.off', on); }
  };

  /* ---------------- narration ---------------- */
  const SPEAKER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const MUTED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>';
  const PLAY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

  let state = null; // { course, n, sections, sectionEl(i), unlocked() }
  let audio = null, playing = -1, player = null;

  function plainOf(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll('.katex').forEach((k) => {
      const ann = k.querySelector('annotation[encoding="application/x-tex"]');
      k.replaceWith(document.createTextNode(ann ? ` \\(${ann.textContent}\\) ` : k.textContent));
    });
    c.querySelectorAll('.vlisten, .checkpoint, svg').forEach((x) => x.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  }

  function ensurePlayer() {
    if (player) return player;
    player = document.createElement('div');
    player.className = 'vplayer';
    player.hidden = true;
    player.setAttribute('role', 'region');
    player.setAttribute('aria-label', 'Reading aloud');
    player.innerHTML = `
      <button class="vplayer__play" type="button" aria-label="Pause">${PAUSE}</button>
      <div class="vplayer__info"><span class="vplayer__label">Reading aloud</span><span class="vplayer__title"></span></div>
      <div class="vplayer__bar" aria-hidden="true"><span></span></div>
      <label class="vplayer__on"><input type="checkbox" checked> Keep reading</label>
      <button class="vplayer__x" type="button" aria-label="Stop reading">&times;</button>`;
    document.body.appendChild(player);
    player.querySelector('.vplayer__play').addEventListener('click', () => {
      if (!audio) return;
      if (audio.paused) audio.play(); else audio.pause();
    });
    player.querySelector('.vplayer__x').addEventListener('click', stop);
    return player;
  }
  function setButtons() {
    document.querySelectorAll('.vlisten').forEach((b) => {
      const on = Number(b.dataset.sec) === playing;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('span').textContent = on ? 'Reading' : 'Listen';
    });
  }
  function stop() {
    if (audio) { audio.pause(); audio = null; }
    playing = -1;
    if (player) player.hidden = true;
    setButtons();
  }
  async function play(i) {
    if (!state) return;
    const s = state.sections[i];
    if (!s) return;
    stop();
    playing = i;
    const p = ensurePlayer();
    p.hidden = false;
    p.querySelector('.vplayer__title').textContent = s.title;
    p.querySelector('.vplayer__label').textContent = 'Getting the voice ready…';
    p.querySelector('.vplayer__bar span').style.width = '0%';
    setButtons();
    try {
      const d = state.course.source === 'sample'
        ? await P.post('/api/voice/text', { script: plainOf(state.sectionEl(i)).slice(0, 4400) }, { timeout: 90000 })
        : await P.post('/api/voice', { courseId: state.course.id, n: state.n, section: i }, { timeout: 90000 });
      if (playing !== i) return;
      audio = new Audio(d.url);
      audio.addEventListener('timeupdate', () => { if (audio && audio.duration) p.querySelector('.vplayer__bar span').style.width = (audio.currentTime / audio.duration * 100) + '%'; });
      audio.addEventListener('play', () => { const b = p.querySelector('.vplayer__play'); b.innerHTML = PAUSE; b.setAttribute('aria-label', 'Pause'); });
      audio.addEventListener('pause', () => { const b = p.querySelector('.vplayer__play'); b.innerHTML = PLAY; b.setAttribute('aria-label', 'Play'); });
      audio.addEventListener('ended', () => {
        const next = i + 1;
        if (p.querySelector('.vplayer__on input').checked && next <= state.unlocked() && state.sections[next]) {
          state.sectionEl(next).scrollIntoView({ behavior: P.motion.reduce ? 'auto' : 'smooth', block: 'start' });
          play(next);
        } else stop();
      });
      p.querySelector('.vplayer__label').textContent = 'Reading aloud';
      await audio.play();
    } catch (err) {
      if (playing === i) stop();
      P.toast(err.message || 'This part couldn’t be read aloud.', 'error');
    }
  }

  P.voice = {
    init(opts) { state = opts; },
    // adds "Listen" next to a part's title
    decorate(sectionEl, i) {
      if (!P.boot.voice) return;
      const title = sectionEl.querySelector('.lsec__title');
      if (!title || title.querySelector('.vlisten')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vlisten';
      b.dataset.sec = String(i);
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', 'Listen to this part');
      b.innerHTML = `${SPEAKER}<span>Listen</span>`;
      b.addEventListener('click', () => (playing === i ? stop() : play(i)));
      title.appendChild(b);
    },
    stop,

    // a microphone button for the doubt box: hold or click to record, the words land in the textarea
    micButton(textarea, where) {
      if (!P.boot.voice || !window.MediaRecorder || !navigator.mediaDevices) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'textlink doubt__mic';
      b.textContent = 'Speak instead';
      where.prepend(b);
      let rec = null, chunks = [], timer = 0;
      const finish = () => { if (rec && rec.state === 'recording') rec.stop(); };
      b.addEventListener('click', async () => {
        if (rec && rec.state === 'recording') { finish(); return; }
        let stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch (e) { P.toast('Primer needs your microphone to hear the doubt. Allow it in the browser, or type instead.', 'error'); return; }
        const type = ['audio/webm', 'audio/ogg', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
        rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        chunks = [];
        rec.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
        rec.addEventListener('stop', async () => {
          clearTimeout(timer);
          stream.getTracks().forEach((t) => t.stop());
          b.textContent = 'Listening…';
          b.disabled = true;
          try {
            const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
            const res = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, credentials: 'same-origin' });
            const d = await res.json().catch(() => ({}));
            if (!res.ok || !d.ok) throw new Error(d.error || 'That recording couldn’t be turned into words.');
            textarea.value = (textarea.value.trim() ? textarea.value.trim() + ' ' : '') + d.text;
            textarea.focus();
          } catch (err) {
            P.toast(err.message, 'error');
          } finally {
            b.disabled = false;
            b.textContent = 'Speak instead';
            b.classList.remove('is-rec');
          }
        });
        rec.start();
        b.classList.add('is-rec');
        b.textContent = 'Stop recording';
        timer = setTimeout(finish, 45000);
      });
    }
  };

  /* ---------------- the sound switch in the lesson toolbar ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    const tools = $('.lbar__tools');
    if (!tools) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool tool--icon';
    const sync = () => {
      b.innerHTML = muted ? MUTED : SPEAKER;
      b.setAttribute('aria-pressed', String(!muted));
      b.setAttribute('aria-label', muted ? 'Sound is off. Turn it on' : 'Sound is on. Turn it off');
      b.title = muted ? 'Sound off' : 'Sound on';
    };
    b.addEventListener('click', () => { P.sfx.setMuted(!muted); sync(); if (!muted) P.sfx.play('correct'); });
    sync();
    tools.prepend(b);
  });
})();
