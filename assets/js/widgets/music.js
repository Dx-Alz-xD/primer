/* =====================================================================
   Music for interactive lessons (assets/js/widgets.js): a piano, and
   drum pads with a step sequencer (a tabla pair too), drawn and played
   in the browser with the Web Audio API alone: no samples to download.

   - Piano: the keys of the spec's range, named by letter (C D E), by
     sargam (Sa Re Ga) or not at all, some marked; played with the mouse,
     several fingers at once, or the computer keys (A S D F... the white
     keys, W E T... the black ones, Z and X an octave down or up). A demo
     plays with Play and Pause, each key lighting as it sounds and its
     notes shown in a strip above the keys.
   - Drums: a pad for each sound, and the pattern on a step grid with a
     moving playhead, Play and Stop and a tempo control. A cell is a
     button: the learner can change the pattern and hear it.
   - Tasks: choose the keys of a chord or play a melody (notes), fill in
     the grid's empty rows (pattern), or tap in time with a click (tap).
     Everything is seen as well as heard: lit keys, the playhead, the
     beat light and the count; a learner who can't hear, or a phone on
     silent, can do every task by looking.

   The theory and the checks are in music-core.js, shared with the
   server; this file loads it first, and the loader waits for that
   (document.currentScript.ready, in widgets.js). Every spec is checked
   again here, and everything from it goes into the page as text nodes.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;
  const me = document.currentScript;

  const core = window.PrimerMusic ? Promise.resolve(window.PrimerMusic) : new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/assets/js/widgets/music-core.js';
    s.async = true;
    s.onload = () => (window.PrimerMusic ? resolve(window.PrimerMusic) : reject(new Error('music-core.js did not load')));
    s.onerror = () => reject(new Error('music-core.js could not be loaded'));
    document.head.appendChild(s);
  });
  const ready = core.then(start);
  if (me) me.ready = ready;
  ready.catch((err) => console.warn('[Primer] music:', err && err.message));

  function start(M) {
    const t = (s) => (P.t ? P.t(s) : s);
    const fill = (s, v) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
    const esc = P.esc || ((s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const perf = () => performance.now() / 1000;
    const BEAT = '♩ = '; // a crotchet: "♩ = 90" says the tempo in any language

    const ICON = {
      play: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.8v10.4L12 7z" fill="currentColor"/></svg>',
      pause: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor"/></svg>',
      stop: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 2.5h9v9h-9z" fill="currentColor"/></svg>',
      speaker: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>'
    };

    /* ---------------- elements ---------------- */
    function el(tag, cls, attrs, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (attrs) Object.keys(attrs).forEach((k) => { const v = attrs[k]; if (v != null && v !== false) e.setAttribute(k, v === true ? '' : String(v)); });
      if (text != null) e.textContent = text;
      return e;
    }
    function button(cls, text, onClick, attrs) {
      const b = el('button', 'mu-btn' + (cls ? ' ' + cls : ''), Object.assign({ type: 'button' }, attrs || {}));
      if (text != null) b.appendChild(el('span', 'mu-btn__t', null, text));
      if (onClick) b.addEventListener('click', onClick);
      return b;
    }
    // a button with an icon (static markup) and a label (a text node)
    function iconLabel(b, icon, text) {
      b.textContent = '';
      b.insertAdjacentHTML('afterbegin', ICON[icon]);
      b.appendChild(el('span', 'mu-btn__t', null, text));
    }
    const restart = (e, cls) => { e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); };

    /* ---------------- sound ---------------- */
    // One audio context for the page, made on the first gesture (browsers start it only then), one
    // master volume (kept for next time), and a compressor so chords and drums never clip.
    const Sound = (() => {
      const AC = window.AudioContext || window.webkitAudioContext;
      let ctx = null, bus = null, master = null, noiseBuf = null, failed = !AC, openHat = null;
      let vol = Number(P.store ? P.store.get('primer.music.volume', 0.8) : 0.8);
      vol = Number.isFinite(vol) ? clamp(vol, 0, 1) : 0.8;
      const voices = [];
      const log = []; // what was scheduled, and when: there may be nothing to hear (a test, a phone on silent)
      const mark = (what, at) => { log.push({ what, at: Math.round(at * 1000) / 1000 }); if (log.length > 300) log.shift(); };
      const loud = (v) => v * v;

      function ensure() {
        if (failed) return null;
        if (!ctx) {
          try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { failed = true; return null; }
          master = ctx.createGain();
          master.gain.value = loud(vol);
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.2;
          bus = ctx.createGain();
          bus.gain.value = 0.8;
          bus.connect(comp); comp.connect(master); master.connect(ctx.destination);
          noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
      }
      function setVolume(v) {
        vol = clamp(v, 0, 1);
        if (P.store) P.store.set('primer.music.volume', Math.round(vol * 100) / 100);
        if (master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(loud(vol), ctx.currentTime, 0.03); }
      }
      // the audio time at which a moment on the page's clock (seconds of performance.now) is heard
      function at(p) {
        if (!ctx) return 0;
        const now = ctx.currentTime;
        let ts = null;
        try { ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null; } catch (e) { ts = null; }
        const when = ts && ts.contextTime > 0 && ts.performanceTime > 0 ? ts.contextTime + (p * 1000 - ts.performanceTime) / 1000 : now + (p - perf());
        return Math.max(now, when);
      }

      const gain = (v) => { const g = ctx.createGain(); g.gain.value = v || 0; return g; };
      const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; };
      // rise and fall without a click: from silence, up, and back to silence
      function env(p, t, peak, attack, decay) {
        p.setValueAtTime(0.0001, t);
        p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
        p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      }
      function noise(t, dur, dest) {
        const s = ctx.createBufferSource();
        s.buffer = noiseBuf; s.connect(dest);
        s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.02);
      }
      function tone(type, f, t, dur, dest) {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.setValueAtTime(f, t); o.connect(dest);
        o.start(t); o.stop(t + dur + 0.03);
        return o;
      }
      const hold = (p, s) => { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(s); else p.cancelScheduledValues(s); };

      // A piano-like tone: six slightly stretched partials, a fast attack, a quick drop and a long decay
      // (shorter up high), a lowpass that darkens as it fades, a breath of hammer noise; released on key up.
      const PARTIALS = [[1, 1], [2, 0.55], [3, 0.3], [4, 0.17], [5, 0.1], [6, 0.05]];
      function piano(m, when, dur, vel = 0.8) {
        if (!ensure()) return null;
        const t = Math.max(when || 0, ctx.currentTime);
        const f = M.freq(m);
        const out = gain(0), lp = filt('lowpass', Math.min(18000, f * 9 + 1500), 0.4);
        lp.frequency.setValueAtTime(Math.min(18000, f * 9 + 1500), t);
        lp.frequency.setTargetAtTime(Math.min(14000, f * 2.5 + 700), t + 0.01, 0.35);
        const tau = clamp(1.25 * Math.pow(2, (60 - m) / 24), 0.35, 2.6);
        const end = t + Math.min(12, tau * 8 + 0.3);
        const oscs = PARTIALS.filter(([n]) => f * n < 15000).map(([n, a]) => {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f * n * Math.sqrt(1 + 0.00035 * n * n);
          const g = gain(a);
          o.connect(g); g.connect(lp);
          o.start(t); o.stop(end);
          return o;
        });
        lp.connect(out); out.connect(bus);
        const peak = 0.2 * vel * clamp(1 + (60 - m) * 0.01, 0.7, 1.35);
        out.gain.setValueAtTime(0, t);
        out.gain.linearRampToValueAtTime(peak, t + 0.004);
        out.gain.setTargetAtTime(peak * 0.5, t + 0.004, 0.08);
        out.gain.setTargetAtTime(0, t + 0.12, tau);
        const hg = gain(0), hb = filt('bandpass', Math.min(6000, f * 4), 0.9);
        hb.connect(hg); hg.connect(bus);
        noise(t, 0.04, hb);
        env(hg.gain, t, 0.05 * vel, 0.001, 0.03);
        mark('piano ' + M.noteName(m), t);
        const v = {
          m, done: false,
          stop(when2) {
            if (v.done || !ctx) return;
            v.done = true;
            const s = Math.max(when2 || 0, ctx.currentTime);
            hold(out.gain, s);
            out.gain.setTargetAtTime(0, s, 0.07);
            oscs.forEach((o) => { try { o.stop(s + 0.6); } catch (e) { /* already set */ } });
          }
        };
        voices.push(v);
        if (voices.length > 24) voices.shift().stop();
        if (dur) v.stop(t + dur);
        return v;
      }

      function hat(t, v, decay) {
        const g = gain(0), hp = filt('highpass', 7000), bp = filt('bandpass', 10000, 0.9);
        bp.connect(hp); hp.connect(g); g.connect(bus);
        [2, 3, 4.16, 5.43, 6.79, 8.21].forEach((r) => tone('square', 40 * r, t, decay + 0.08, bp));
        noise(t, decay + 0.05, hp);
        env(g.gain, t, 0.3 * v, 0.001, decay);
        return { g, t, end: t + decay };
      }
      function tom(t, v, f0, f1, decay) {
        const g = gain(0);
        g.connect(bus);
        const o = tone('sine', f0, t, decay, g);
        o.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.8);
        env(g.gain, t, 0.85 * v, 0.002, decay);
        const ng = gain(0), lp = filt('lowpass', 1800);
        lp.connect(ng); ng.connect(bus);
        noise(t, 0.04, lp);
        env(ng.gain, t, 0.18 * v, 0.001, 0.03);
      }
      // the tabla's dayan: the harmonic overtones its black spot (syahi) gives it, tuned near D4
      function dayan(t, v, amps, decays, click) {
        const f = 293.7, sum = gain(1);
        sum.connect(bus);
        amps.forEach((a, i) => {
          const g = gain(0);
          g.connect(sum);
          tone('sine', f * (i + 1), t, decays[i], g);
          env(g.gain, t, a * 0.32 * v, 0.002, decays[i]);
        });
        if (click) {
          const cg = gain(0), bp = filt('bandpass', 3500, 1.2);
          bp.connect(cg); cg.connect(bus);
          noise(t, 0.02, bp);
          env(cg.gain, t, 0.22 * v, 0.001, 0.012);
        }
      }
      // and the bayan: a deep, open stroke whose pitch the palm bends upward
      function bayan(t, v) {
        const g = gain(0);
        g.connect(bus);
        const o = tone('sine', 92, t, 0.85, g);
        o.frequency.exponentialRampToValueAtTime(128, t + 0.18);
        o.frequency.exponentialRampToValueAtTime(118, t + 0.7);
        env(g.gain, t, 0.85 * v, 0.004, 0.75);
        const h = gain(0);
        h.connect(bus);
        const o2 = tone('sine', 184, t, 0.35, h);
        o2.frequency.exponentialRampToValueAtTime(256, t + 0.18);
        env(h.gain, t, 0.14 * v, 0.004, 0.3);
        const ng = gain(0), lp = filt('lowpass', 350);
        lp.connect(ng); ng.connect(bus);
        noise(t, 0.06, lp);
        env(ng.gain, t, 0.3 * v, 0.002, 0.05);
      }
      const DRUM = {
        kick(t, v) {
          const g = gain(0);
          g.connect(bus);
          const o = tone('sine', 155, t, 0.5, g);
          o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
          env(g.gain, t, 1.0 * v, 0.002, 0.45);
          const cg = gain(0), lp = filt('lowpass', 2800);
          lp.connect(cg); cg.connect(bus);
          noise(t, 0.02, lp);
          env(cg.gain, t, 0.3 * v, 0.001, 0.014);
        },
        snare(t, v) {
          const ng = gain(0), hp = filt('highpass', 1300), bp = filt('bandpass', 3200, 0.6);
          hp.connect(bp); bp.connect(ng); ng.connect(bus);
          noise(t, 0.25, hp);
          env(ng.gain, t, 0.7 * v, 0.001, 0.18);
          const tg = gain(0);
          tg.connect(bus);
          const o = tone('triangle', 210, t, 0.15, tg);
          o.frequency.exponentialRampToValueAtTime(165, t + 0.08);
          env(tg.gain, t, 0.5 * v, 0.001, 0.11);
        },
        hihat(t, v) {
          // a closed hi-hat stops an open one
          if (openHat && t >= openHat.t && t < openHat.end) { hold(openHat.g.gain, t); openHat.g.gain.setTargetAtTime(0.0001, t, 0.012); openHat = null; }
          hat(t, v, 0.05);
        },
        openhat(t, v) { openHat = hat(t, v, 0.38); },
        clap(t, v) {
          const g = gain(0), bp = filt('bandpass', 1150, 1.2), hp = filt('highpass', 450);
          bp.connect(hp); hp.connect(g); g.connect(bus);
          noise(t, 0.3, bp);
          const p = g.gain;
          p.setValueAtTime(0.0001, t);
          [0, 0.011, 0.022, 0.033].forEach((d, i) => {
            p.exponentialRampToValueAtTime(0.8 * v, t + d + 0.001);
            p.exponentialRampToValueAtTime(i < 3 ? 0.06 * v : 0.0001, t + d + (i < 3 ? 0.0095 : 0.2));
          });
        },
        tom_low(t, v) { tom(t, v, 120, 80, 0.42); },
        tom_high(t, v) { tom(t, v, 205, 145, 0.32); },
        na(t, v) { dayan(t, v, [0.55, 1, 0.5, 0.3, 0.14], [0.6, 0.45, 0.3, 0.22, 0.16], true); },
        tin(t, v) { dayan(t, v * 0.8, [1, 0.35, 0.14, 0.05], [0.85, 0.5, 0.3, 0.2], false); },
        te(t, v) {
          const g = gain(0), bp = filt('bandpass', 1700, 1.4);
          bp.connect(g); g.connect(bus);
          noise(t, 0.06, bp);
          env(g.gain, t, 0.55 * v, 0.001, 0.045);
          const sg = gain(0);
          sg.connect(bus);
          tone('sine', 587, t, 0.05, sg);
          env(sg.gain, t, 0.15 * v, 0.001, 0.03);
        },
        ge(t, v) { bayan(t, v); },
        ke(t, v) {
          const g = gain(0), lp = filt('lowpass', 800);
          lp.connect(g); g.connect(bus);
          noise(t, 0.08, lp);
          env(g.gain, t, 0.55 * v, 0.001, 0.06);
          const sg = gain(0);
          sg.connect(bus);
          tone('sine', 90, t, 0.08, sg);
          env(sg.gain, t, 0.45 * v, 0.002, 0.07);
        },
        dha(t, v) { DRUM.na(t, v * 0.85); bayan(t, v * 0.9); },
        dhin(t, v) { DRUM.tin(t, v * 0.9); bayan(t, v * 0.9); }
      };
      function drum(name, when, vel = 1) {
        if (!ensure()) return;
        const t = Math.max(when || 0, ctx.currentTime);
        (DRUM[name] || DRUM.clap)(t, vel);
        mark(name, t);
      }
      // the metronome's click: higher on the first beat of a bar
      function click(when, accent) {
        if (!ensure()) return;
        const t = Math.max(when || 0, ctx.currentTime);
        const g = gain(0);
        g.connect(bus);
        tone('sine', accent ? 1760 : 1175, t, 0.05, g);
        env(g.gain, t, accent ? 0.45 : 0.32, 0.001, 0.04);
        mark(accent ? 'click!' : 'click', t);
      }
      const hush = () => voices.splice(0).forEach((v) => v.stop());
      return {
        ensure, at, piano, drum, click, hush, setVolume, log,
        volume: () => vol,
        state: () => (failed ? 'none' : ctx ? ctx.state : 'not started')
      };
    })();
    M.sound = Sound; // for checking what was scheduled (the tests read it)

    // The audio context starts on the first gesture anywhere on the page, so that a later Play can sound.
    let unlockSet = false;
    function unlockOnGesture() {
      if (unlockSet) return;
      unlockSet = true;
      const evs = ['pointerdown', 'keydown', 'touchend'];
      const go = () => { Sound.ensure(); evs.forEach((e) => document.removeEventListener(e, go, true)); };
      evs.forEach((e) => document.addEventListener(e, go, true));
    }

    /* ---------------- time ---------------- */
    // Steps played one after another: sounds scheduled a little ahead on the audio clock, what is
    // seen moved on each frame. Timed by the page's clock, so it runs (silently) with no sound too.
    function Runner(o) {
      let timer = 0, raf = 0, next = 0, i = 0, endAt = null, live = false, shown = -1;
      const queue = [];
      function tick() {
        const horizon = perf() + 0.12;
        while (live && endAt == null && next < horizon) {
          const ii = i;
          o.sound(ii, Sound.at(next));
          queue.push({ i: ii, at: next });
          next += o.dur(ii);
          i++;
          if (i >= o.length()) { if (o.loop) i = 0; else endAt = next; }
        }
      }
      function frame() {
        if (!live) return;
        const now = perf();
        let cur = null;
        while (queue.length && queue[0].at <= now) cur = queue.shift();
        if (cur) { shown = cur.i; o.visual(cur.i); }
        if (endAt != null && now >= endAt) { stop(); if (o.done) o.done(); return; }
        raf = requestAnimationFrame(frame);
      }
      function stop() {
        live = false;
        clearInterval(timer);
        cancelAnimationFrame(raf);
        queue.length = 0;
      }
      return {
        start(from = 0) {
          stop();
          live = true; i = from; endAt = null; shown = -1;
          next = perf() + 0.08;
          const t0 = next;
          tick();
          timer = setInterval(tick, 25);
          raf = requestAnimationFrame(frame);
          return t0;
        },
        stop,
        get playing() { return live; },
        get shown() { return shown; }
      };
    }

    /* ---------------- shared controls ---------------- */
    function volumeControl() {
      const wrap = el('label', 'mu-vol', { title: t('Volume') });
      wrap.insertAdjacentHTML('afterbegin', ICON.speaker);
      const r = el('input', 'mu-range', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': t('Volume') });
      r.value = String(Math.round(Sound.volume() * 100));
      r.addEventListener('input', () => { Sound.ensure(); Sound.setVolume(Number(r.value) / 100); });
      wrap.appendChild(r);
      return wrap;
    }
    function tempoControl(value, onChange) {
      const wrap = el('label', 'mu-tempo');
      const out = el('span', 'mu-tempo__out', { 'aria-hidden': 'true' }, BEAT + value);
      const r = el('input', 'mu-range', { type: 'range', min: 40, max: 200, step: 1, 'aria-label': t('Tempo (beats per minute)') });
      r.value = String(value);
      r.addEventListener('input', () => { out.textContent = BEAT + r.value; onChange(Number(r.value)); });
      wrap.append(out, r);
      return wrap;
    }
    function lockButtons(root, on) {
      root.querySelectorAll('[data-lockable]').forEach((b) => { b.disabled = on; });
    }
    const soundLabel = (k) => (M.BOLS.includes(k) ? M.SOUND_LABEL[k] : t(M.SOUND_LABEL[k] || k));

    /* ---------------- the piano ---------------- */
    const CODES = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];
    const QWERTY = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P', ';', "'"];
    let layoutLetters = null; // the letters on this computer's keys, where the browser can say
    try {
      if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
        navigator.keyboard.getLayoutMap().then((map) => { layoutLetters = CODES.map((c, i) => String(map.get(c) || QWERTY[i]).toUpperCase()); }).catch(() => {});
      }
    } catch (e) { /* not offered */ }
    // where a black key sits between its white neighbours, as on a real keyboard
    const BLACK_OFFSET = { 1: -0.08, 3: 0.08, 6: -0.1, 8: 0, 10: 0.1 };

    // the spelling a spec uses for each key it names, and whether it leans to flats
    function spelling(spec, goal) {
      const names = [].concat(spec.highlight || [], spec.sa ? [spec.sa] : [], goal && goal.notes ? goal.notes : [],
        spec.demo ? spec.demo.steps.flatMap((s) => s.notes) : []);
      const map = new Map();
      let flats = 0, sharps = 0;
      names.forEach((n) => {
        const p = M.parseNote(n);
        if (!p) return;
        if (p.acc < 0) flats++; else if (p.acc > 0) sharps++;
        if (p.midi != null && !map.has(p.midi)) map.set(p.midi, p.name);
      });
      return { map, flats: flats > sharps };
    }

    function piano(host, spec, ctx, goal) {
      const lo = M.toMidi(spec.from), hi = M.toMidi(spec.to);
      if (lo == null || hi == null || hi <= lo) throw new Error('the keyboard has no range');
      const isTask = Boolean(goal), ordered = isTask && goal.in_order;
      const sp = spelling(spec, goal);
      const nameOf = (m) => sp.map.get(m) || M.noteName(m, sp.flats);
      const firstC = lo + M.mod12(-lo) <= hi ? lo + M.mod12(-lo) : lo - M.mod12(lo);
      const sa = spec.sa != null ? M.toMidi(spec.sa) : firstC;
      let labels = spec.labels || 'letters';
      let locked = false, revealed = false;

      const root = el('div', 'mu mu--piano' + (ctx.reduce ? ' is-still' : '') + (isTask ? ' is-task' : ''), { tabindex: '0', role: 'group', 'aria-label': t('Piano keyboard'), 'data-no-i18n': true });
      host.textContent = '';
      host.appendChild(root);

      /* the bar: demo, names, volume */
      const bar = el('div', 'mu-bar');
      let playBtn = null, demoTempo = spec.demo ? spec.demo.tempo : 90;
      if (spec.demo) {
        playBtn = button('mu-btn--play', null, () => (demoRun && demoRun.playing ? pauseDemo() : playDemo()));
        iconLabel(playBtn, 'play', t('Play'));
        bar.append(playBtn, tempoControl(demoTempo, (v) => { demoTempo = v; }));
      }
      if (!isTask || spec.labels !== 'none') {
        const seg = el('div', 'mu-seg', { role: 'group', 'aria-label': t('Key names') });
        (isTask ? ['letters', 'sargam'] : ['letters', 'sargam', 'none']).forEach((k) => {
          const b = button('mu-seg__b', k === 'letters' ? 'C D E' : k === 'sargam' ? 'Sa Re Ga' : t('None'), () => setLabels(k), { 'aria-pressed': String(labels === k), 'data-k': k });
          seg.appendChild(b);
        });
        bar.appendChild(seg);
      }
      bar.appendChild(volumeControl());
      root.appendChild(bar);

      /* the demo's notes, as a strip of chips (wider for longer notes) */
      const chips = [];
      if (spec.demo) {
        const score = el('div', 'mu-score', { dir: 'ltr', role: 'list', 'aria-label': t('The notes of the demo') });
        spec.demo.steps.forEach((st) => {
          const c = el('span', 'mu-chip' + (st.notes.length ? '' : ' is-rest') + (st.notes.length > 1 ? ' is-chord' : ''), { role: 'listitem' });
          c.style.setProperty('--b', String(Math.min(4, st.beats)));
          chips.push(c);
          score.appendChild(c);
        });
        root.appendChild(score);
      }

      /* the keys */
      const scroll = el('div', 'mu-scroll');
      const keys = el('div', 'mu-keys', { dir: 'ltr' });
      const whites = [];
      for (let m = lo; m <= hi; m++) if (!M.isBlack(m)) whites.push(m);
      const W = whites.length;
      keys.style.setProperty('--white', String(W));
      const keyEl = new Map();
      for (let m = lo; m <= hi; m++) {
        const black = M.isBlack(m);
        const k = el('button', 'mu-key ' + (black ? 'mu-key--black' : 'mu-key--white'), { type: 'button', tabindex: '-1', 'data-m': m });
        k.append(el('span', 'mu-key__kb', { 'aria-hidden': 'true' }), el('span', 'mu-key__n', { 'aria-hidden': 'true' }),
          el('span', 'mu-key__mark', { 'aria-hidden': 'true' }), el('span', 'mu-key__lab', { 'aria-hidden': 'true' }));
        if (black) {
          const wi = whites.indexOf(m - 1);
          const w = 100 / W, bw = w * 0.6;
          k.style.left = ((wi + 1 + (BLACK_OFFSET[M.mod12(m)] || 0)) * w - bw / 2) + '%';
          k.style.width = bw + '%';
        } else {
          const wi = whites.indexOf(m);
          k.style.left = (wi * 100 / W) + '%';
          k.style.width = (100 / W) + '%';
        }
        keyEl.set(m, k);
        keys.appendChild(k);
      }
      M.markedKeys(spec).forEach((m) => { const k = keyEl.get(m); if (k) k.classList.add('is-mark'); });
      scroll.appendChild(keys);
      root.appendChild(scroll);
      root.appendChild(el('p', 'mu-hint', null, t('You can also play with the computer keys: A S D F G H J K are white keys, W E T Y U are black keys, and Z and X move an octave.')));

      function setLabels(k) {
        labels = k;
        root.querySelectorAll('.mu-seg__b').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
        paintLabels();
      }
      function labelNode(m) {
        const txt = el('span', 'mu-key__txt');
        if (labels === 'letters') {
          const nm = nameOf(m);
          txt.textContent = M.pretty(nm, false);
          if (M.mod12(m) === 0 || m === lo) txt.appendChild(el('sub', null, null, nm.slice(-1)));
        } else if (labels === 'sargam') {
          const s = M.sargam(m, sa);
          txt.textContent = s.name;
          if (s.komal) txt.classList.add('is-komal');
          if (s.tivra) txt.classList.add('is-tivra');
          if (s.octave < 0) txt.classList.add('is-low');
          if (s.octave > 0) txt.classList.add('is-high');
        }
        return txt;
      }
      const spoken = (m) => M.pretty(nameOf(m)) + (labels === 'sargam' ? ' (' + M.sargamText(m, sa) + ')' : '');
      function paintLabels() {
        keyEl.forEach((k, m) => {
          const lab = k.querySelector('.mu-key__lab');
          lab.textContent = '';
          if (labels !== 'none') lab.appendChild(labelNode(m));
          k.setAttribute('aria-label', spoken(m) + (k.classList.contains('is-mark') ? ', ' + t('marked') : ''));
        });
        chips.forEach((c, i) => {
          c.textContent = '';
          const st = spec.demo.steps[i];
          if (!st.notes.length) c.appendChild(el('span', 'mu-chip__n', null, '·'));
          st.notes.forEach((n) => c.appendChild(el('span', 'mu-chip__n', null, labels === 'sargam' ? M.sargam(M.toMidi(n), sa).name : M.pretty(n, false))));
        });
        paintTask();
      }

      /* the computer keys */
      let base = firstC;
      function paintKb() {
        const letters = layoutLetters || QWERTY;
        keyEl.forEach((k, m) => { const i = m - base; k.querySelector('.mu-key__kb').textContent = i >= 0 && i < CODES.length ? letters[i] : ''; });
      }

      /* sounding and lighting */
      const lit = new Map();
      function lightOn(m) {
        const k = keyEl.get(m);
        lit.set(m, (lit.get(m) || 0) + 1);
        if (k) { k.classList.add('is-on'); if (!ctx.reduce) restart(k, 'is-hit'); }
      }
      function lightOff(m) {
        const n = (lit.get(m) || 0) - 1;
        if (n > 0) { lit.set(m, n); return; }
        lit.delete(m);
        const k = keyEl.get(m);
        if (k) k.classList.remove('is-on');
      }
      const held = new Map(); // a finger, the mouse or a computer key -> the note it holds
      function down(id, m) {
        if (locked || m < lo || m > hi) return;
        if (held.has(id)) up(id);
        if (isTask) act(m);
        held.set(id, { m, v: Sound.piano(m, 0) });
        lightOn(m);
      }
      function up(id) {
        const h = held.get(id);
        if (!h) return;
        held.delete(id);
        if (h.v) h.v.stop();
        lightOff(h.m);
      }
      const upAll = (prefix) => [...held.keys()].forEach((id) => { if (!prefix || String(id).startsWith(prefix)) up(id); });

      const keyAt = (x, y) => { const e = document.elementFromPoint(x, y); const k = e && e.closest ? e.closest('.mu-key') : null; return k && keys.contains(k) ? Number(k.dataset.m) : null; };
      keys.addEventListener('pointerdown', (e) => {
        const k = e.target.closest('.mu-key');
        if (!k || locked || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        try { root.focus({ preventScroll: true, focusVisible: false }); } catch (err) { /* old browser */ }
        try { keys.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
        down('p' + e.pointerId, Number(k.dataset.m));
      });
      keys.addEventListener('pointermove', (e) => {
        const id = 'p' + e.pointerId, h = held.get(id);
        if (!h || isTask) return; // sliding along the keys plays them, outside tasks
        const m = keyAt(e.clientX, e.clientY);
        if (m != null && m !== h.m) down(id, m);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => keys.addEventListener(ev, (e) => up('p' + e.pointerId)));
      keys.addEventListener('contextmenu', (e) => e.preventDefault());

      root.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target !== root && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (e.code === 'KeyZ' || e.code === 'KeyX') {
          e.preventDefault();
          const nb = base + (e.code === 'KeyZ' ? -12 : 12);
          if (nb + CODES.length > lo && nb <= hi) { upAll('k'); base = nb; paintKb(); }
          return;
        }
        const i = CODES.indexOf(e.code);
        if (i < 0) return;
        e.preventDefault();
        if (!e.repeat) down('k' + e.code, base + i);
      });
      root.addEventListener('keyup', (e) => { if (CODES.includes(e.code)) up('k' + e.code); });
      root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) upAll('k'); });

      /* the demo */
      let demoRun = null, demoAt = 0, demoStep = -1;
      const demoVoices = [];
      function showStep(i) {
        if (demoStep >= 0) { spec.demo.steps[demoStep].notes.forEach((n) => lightOff(M.toMidi(n))); chips[demoStep].classList.remove('is-now'); }
        demoStep = i;
        if (i >= 0) {
          spec.demo.steps[i].notes.forEach((n) => lightOn(M.toMidi(n)));
          chips[i].classList.add('is-now');
        }
      }
      function playDemo() {
        Sound.ensure();
        stopRuns();
        const steps = spec.demo.steps;
        demoRun = Runner({
          length: () => steps.length,
          dur: (i) => steps[i].beats * 60 / demoTempo,
          sound: (i, when) => {
            const d = steps[i].beats * 60 / demoTempo;
            steps[i].notes.forEach((n) => { const v = Sound.piano(M.toMidi(n), when, d * 0.94); if (v) demoVoices.push(v); });
            if (demoVoices.length > 40) demoVoices.splice(0, demoVoices.length - 40);
          },
          visual: showStep,
          done: () => { showStep(-1); demoAt = 0; setPlaying(false); }
        });
        demoRun.start(demoAt >= steps.length ? 0 : demoAt);
        setPlaying(true);
      }
      function pauseDemo() {
        if (!demoRun) return;
        demoAt = Math.max(0, demoRun.shown);
        demoRun.stop();
        demoVoices.splice(0).forEach((v) => v.stop());
        showStep(-1);
        setPlaying(false);
      }
      function setPlaying(on) {
        if (!playBtn) return;
        iconLabel(playBtn, on ? 'pause' : 'play', t(on ? 'Pause' : 'Play'));
        root.classList.toggle('is-playing', on);
      }

      /* tasks: the keys chosen (a chord), or the notes played in order (a melody) */
      const picked = new Set(), played = [];
      let said = null, playedRow = null, backRun = null;
      if (isTask) {
        const area = el('div', 'mu-task');
        said = el('p', 'mu-said', { 'aria-live': 'polite' });
        area.appendChild(said);
        if (ordered) {
          playedRow = el('div', 'mu-played', { dir: 'ltr' });
          said.after(playedRow);
          area.append(playedRow,
            button('', t('Play back'), () => playBack(played), { 'data-lockable': true }),
            button('', t('Undo'), () => { if (!locked && played.length) { played.pop(); changed(); } }, { 'data-lockable': true }),
            button('', t('Clear'), () => { if (!locked) { played.length = 0; changed(); } }, { 'data-lockable': true }));
        } else {
          area.append(button('', t('Play together'), () => playTogether([...picked]), { 'data-lockable': true }),
            button('', t('Clear'), () => { if (!locked) { picked.clear(); changed(); } }, { 'data-lockable': true }));
        }
        root.appendChild(area);
      }
      function act(m) {
        if (revealed) clearReveal();
        if (ordered) { if (played.length < 32) played.push(m); } else if (picked.has(m)) picked.delete(m); else picked.add(m);
        changed();
      }
      function changed() { paintTask(); ctx.onChange(value()); }
      const asNames = (ms) => ms.map(nameOf);
      function value() {
        if (!isTask) return null;
        if (ordered) return played.length ? { notes: asNames(played) } : null;
        return picked.size ? { notes: asNames([...picked].sort((a, b) => a - b)) } : null;
      }
      function paintTask() {
        if (!isTask) return;
        keyEl.forEach((k, m) => {
          const on = !ordered && picked.has(m);
          k.classList.toggle('is-picked', on);
          if (!ordered) k.setAttribute('aria-pressed', String(on));
        });
        said.textContent = '';
        const sargam = labels === 'sargam' ? sa : null;
        if (ordered) {
          said.appendChild(el('strong', null, null, t('You played:') + ' '));
          if (!played.length) said.appendChild(document.createTextNode(t('nothing yet: play the notes on the keys.')));
          playedRow.textContent = '';
          played.forEach((m, i) => {
            const c = el('span', 'mu-chip', { title: spoken(m) });
            c.appendChild(el('span', 'mu-chip__n', null, sargam != null ? M.sargam(m, sa).name : M.pretty(nameOf(m), false)));
            c.dataset.i = String(i + 1);
            playedRow.appendChild(c);
          });
          if (played.length) said.appendChild(document.createTextNode(M.notesText(asNames(played), { octave: false, sargam })));
        } else {
          said.appendChild(el('strong', null, null, t('Chosen:') + ' '));
          const ms = [...picked].sort((a, b) => a - b);
          said.appendChild(document.createTextNode(ms.length ? M.notesText(asNames(ms), { octave: false, sargam }) : t('nothing yet: tap the keys to choose them.')));
        }
      }
      function playTogether(ms) {
        if (!ms.length) return;
        Sound.ensure();
        ms.forEach((m) => { Sound.piano(m, 0, 1.2); lightOn(m); });
        setTimeout(() => ms.forEach(lightOff), 900);
      }
      function playBack(ms) {
        if (!ms.length) return;
        Sound.ensure();
        stopRuns();
        let last = null;
        const sec = 60 / (spec.demo ? demoTempo : 100);
        backRun = Runner({
          length: () => ms.length,
          dur: () => sec,
          sound: (i, when) => Sound.piano(ms[i], when, sec * 0.9),
          visual: (i) => { if (last != null) lightOff(last); last = ms[i]; lightOn(last); },
          done: () => { if (last != null) lightOff(last); last = null; }
        });
        backRun.start(0);
      }
      function stopRuns() {
        if (demoRun && demoRun.playing) pauseDemo();
        if (backRun && backRun.playing) { backRun.stop(); lit.forEach((n, m) => { lit.delete(m); const k = keyEl.get(m); if (k) k.classList.remove('is-on'); }); }
      }
      function clearReveal() {
        revealed = false;
        keyEl.forEach((k) => { k.classList.remove('is-answer'); k.querySelector('.mu-key__n').textContent = ''; });
      }
      // the right answer, done: its keys chosen and marked (numbered, for a melody)
      function reveal() {
        if (!isTask) return;
        const ms = goal.notes.map(M.toMidi).map((m) => (m >= lo && m <= hi ? m : null)).filter((m) => m != null);
        picked.clear(); played.length = 0;
        if (ordered) played.push(...ms); else ms.forEach((m) => picked.add(m));
        clearReveal();
        revealed = true;
        ms.forEach((m, i) => {
          const k = keyEl.get(m);
          if (!k) return;
          k.classList.add('is-answer');
          if (ordered) { const n = k.querySelector('.mu-key__n'); n.textContent = n.textContent ? n.textContent + ',' + (i + 1) : String(i + 1); }
        });
        paintTask();
      }

      paintLabels();
      paintKb();
      unlockOnGesture();

      // a keyboard wider than the page scrolls sideways (a finger then drags it, and taps play):
      // it opens on the marked keys or the demo's, or on middle C
      function fit() {
        const over = keys.scrollWidth > scroll.clientWidth + 1;
        scroll.classList.toggle('is-scrolling', over);
        return over;
      }
      if (fit()) {
        const near = M.markedKeys(spec).concat(spec.demo ? spec.demo.steps.flatMap((s) => s.notes.map(M.toMidi)) : []);
        const focus = near.length ? Math.min(...near) : (60 >= lo && 60 <= hi ? 60 : lo);
        const k = keyEl.get(M.isBlack(focus) ? focus - 1 : focus);
        if (k) scroll.scrollLeft = Math.max(0, k.offsetLeft - scroll.clientWidth * 0.25);
      }
      const ro = window.ResizeObserver ? new ResizeObserver(() => fit()) : null;
      if (ro) ro.observe(scroll);
      const onHide = () => { if (document.hidden) { stopRuns(); upAll(); } };
      document.addEventListener('visibilitychange', onHide);

      return {
        value,
        reset() { stopRuns(); picked.clear(); played.length = 0; clearReveal(); paintTask(); },
        reveal,
        lock(on) { locked = Boolean(on); root.classList.toggle('is-locked', locked); lockButtons(root, locked); if (locked) upAll(); },
        destroy() { stopRuns(); upAll(); Sound.hush(); if (ro) ro.disconnect(); document.removeEventListener('visibilitychange', onHide); host.textContent = ''; }
      };
    }

    /* ---------------- the drums ---------------- */
    const PAD_CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];
    const PAD_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';'];

    function drums(host, spec, ctx, goal) {
      const isTask = Boolean(goal), tapMode = isTask && goal.type === 'tap';
      const pat = tapMode ? null : spec.pattern || null;
      let locked = false;
      const root = el('div', 'mu mu--drums' + (ctx.reduce ? ' is-still' : '') + (isTask ? ' is-task' : ''), { tabindex: '0', role: 'group', 'aria-label': t(tapMode ? 'Tap in time' : 'Drum pads'), 'data-no-i18n': true });
      host.textContent = '';
      host.appendChild(root);
      const bar = el('div', 'mu-bar');
      root.appendChild(bar);
      unlockOnGesture();

      /* the pads */
      const padEl = new Map(), flashTimers = new Map();
      function flash(k) {
        const p = padEl.get(k);
        if (!p) return;
        p.classList.add('is-hit');
        clearTimeout(flashTimers.get(k));
        flashTimers.set(k, setTimeout(() => p.classList.remove('is-hit'), 140));
      }
      function hit(k) { if (locked) return; Sound.drum(k, 0); flash(k); }
      if (!tapMode) {
        const pads = el('div', 'mu-pads');
        spec.pads.forEach((k, i) => {
          const b = el('button', 'mu-pad' + (M.BOLS.includes(k) ? ' mu-pad--tabla' : ''), { type: 'button', 'data-sound': k, 'aria-label': soundLabel(k) });
          b.append(el('span', 'mu-pad__name', { 'aria-hidden': 'true' }, soundLabel(k)));
          if (i < PAD_KEYS.length) b.appendChild(el('span', 'mu-pad__kb', { 'aria-hidden': 'true' }, PAD_KEYS[i]));
          b.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            try { root.focus({ preventScroll: true, focusVisible: false }); } catch (err) { /* old browser */ }
            hit(k);
          });
          b.addEventListener('click', (e) => { if (e.detail === 0) hit(k); }); // Enter or Space on a focused pad
          padEl.set(k, b);
          pads.appendChild(b);
        });
        root.appendChild(pads);
      }

      /* the step grid */
      let cells = null, given = null, gridRun = null, gridPlay = null, tempoV = pat ? pat.tempo : 100, cellEl = {}, headEl = [], now = -1;
      const rows = pat ? Object.keys(pat.tracks) : [];
      const editable = new Set(isTask && goal.type === 'pattern' ? Object.keys(goal.tracks) : rows);
      const original = {};
      let answerShown = false;
      const grid = el('div', 'mu-grid', { dir: 'ltr' });
      if (pat) {
        cells = {};
        rows.forEach((k) => { cells[k] = [...pat.tracks[k]].map((c) => c === 'x'); original[k] = cells[k].slice(); });
        given = new Set(rows.filter((k) => !editable.has(k)));
        gridPlay = button('mu-btn--play', null, () => (gridRun && gridRun.playing ? stopGrid() : playGrid()));
        iconLabel(gridPlay, 'play', t('Play'));
        bar.append(gridPlay, tempoControl(tempoV, (v) => { tempoV = v; }));
        if (!isTask) bar.appendChild(button('', t('Reset'), () => { rows.forEach((k) => { cells[k] = original[k].slice(); }); paintCells(); }));
        bar.appendChild(button('', t('Clear'), () => {
          if (locked) return;
          rows.forEach((k) => { if (editable.has(k)) cells[k].fill(false); });
          answerShown = false;
          paintCells();
          if (isTask) ctx.onChange(value());
        }, { 'data-lockable': true }));
        root.appendChild(grid);
      }
      bar.appendChild(volumeControl());

      const groupStarts = new Set();
      if (pat) {
        if (pat.groups) { let s = 0; pat.groups.forEach((g) => { groupStarts.add(s); s += g; }); } else for (let i = 0; i < pat.steps; i += pat.per_beat) groupStarts.add(i);
      }
      const markAt = {};
      if (pat && pat.groups && pat.marks) { let s = 0; pat.groups.forEach((g, i) => { markAt[s] = pat.marks[i]; s += g; }); }
      const groupOf = (i) => { let n = -1; for (let s = 0; s <= i; s++) if (groupStarts.has(s)) n++; return n; };

      // how many steps to a line: all of them if they fit, else whole beats (or vibhags) per line
      let cols = 0;
      function chooseCols() {
        const w = grid.clientWidth || root.clientWidth || 600;
        const lab = Math.min(84, Math.max(52, w * 0.16));
        const fits = (c) => (w - lab) / c >= 22;
        const cands = [];
        for (let c = pat.steps; c >= 1; c--) {
          if (pat.steps % c) continue;
          let ok = true;
          for (let s = 0; s < pat.steps; s += c) if (!groupStarts.has(s)) ok = false;
          if (ok) cands.push(c);
        }
        return cands.find(fits) || cands[cands.length - 1] || pat.steps;
      }
      function layout() {
        if (!pat) return;
        const c = chooseCols();
        if (c === cols && grid.childNodes.length) return;
        cols = c;
        grid.textContent = '';
        cellEl = {}; headEl = [];
        rows.forEach((k) => { cellEl[k] = []; });
        for (let s0 = 0; s0 < pat.steps; s0 += cols) {
          const line = el('div', 'mu-line');
          line.style.setProperty('--cols', String(cols));
          line.appendChild(el('span', 'mu-corner'));
          for (let i = s0; i < s0 + cols; i++) {
            const sub = i % pat.per_beat;
            const h = el('span', 'mu-head' + (sub ? '' : ' is-beat') + (groupStarts.has(i) ? ' is-gstart' : ''), { 'aria-hidden': 'true' }, sub ? M.countName(i, pat.per_beat).replace(/^\d+/, '') : String(Math.floor(i / pat.per_beat) + 1));
            if (markAt[i] != null) h.dataset.mark = markAt[i];
            headEl[i] = h;
            line.appendChild(h);
          }
          rows.forEach((k) => {
            line.appendChild(el('span', 'mu-rowlab' + (given.has(k) ? ' is-given' : ''), null, soundLabel(k)));
            for (let i = s0; i < s0 + cols; i++) {
              const alt = groupOf(i) % 2 === 1;
              const b = el('button', 'mu-cell' + (alt ? ' is-alt' : '') + (groupStarts.has(i) ? ' is-gstart' : '') + (given.has(k) ? ' is-given' : ''), {
                type: 'button', 'data-sound': k, 'data-i': i, 'aria-label': soundLabel(k) + ' ' + M.countName(i, pat.per_beat)
              });
              if (given.has(k)) b.setAttribute('aria-disabled', 'true');
              b.addEventListener('click', () => toggle(k, i));
              cellEl[k][i] = b;
              line.appendChild(b);
            }
          });
          grid.appendChild(line);
        }
        paintCells();
        if (now >= 0) showStep(now);
      }
      function toggle(k, i) {
        if (locked || given.has(k) || !editable.has(k)) return;
        cells[k][i] = !cells[k][i];
        if (answerShown) { answerShown = false; }
        if (cells[k][i] && !(gridRun && gridRun.playing)) Sound.drum(k, 0);
        paintCells();
        if (isTask) ctx.onChange(value());
      }
      function paintCells() {
        if (!pat) return;
        rows.forEach((k) => cells[k].forEach((on, i) => {
          const b = cellEl[k] && cellEl[k][i];
          if (!b) return;
          b.setAttribute('aria-pressed', String(on));
          b.classList.toggle('is-answer', answerShown && editable.has(k) && on);
        }));
      }
      function showStep(i) {
        if (now >= 0) { if (headEl[now]) headEl[now].classList.remove('is-now'); rows.forEach((k) => { const b = cellEl[k] && cellEl[k][now]; if (b) b.classList.remove('is-now'); }); }
        now = i;
        if (i < 0) return;
        if (headEl[i]) headEl[i].classList.add('is-now');
        rows.forEach((k) => { const b = cellEl[k] && cellEl[k][i]; if (b) b.classList.add('is-now'); if (cells[k][i]) flash(k); });
      }
      function playGrid() {
        Sound.ensure();
        if (gridRun) gridRun.stop();
        gridRun = Runner({
          length: () => pat.steps,
          loop: true,
          dur: () => 60 / tempoV / pat.per_beat,
          sound: (i, when) => rows.forEach((k) => { if (cells[k][i]) Sound.drum(k, when); }),
          visual: showStep
        });
        gridRun.start(0);
        iconLabel(gridPlay, 'stop', t('Stop'));
        root.classList.add('is-playing');
      }
      function stopGrid() {
        if (gridRun) gridRun.stop();
        showStep(-1);
        if (gridPlay) iconLabel(gridPlay, 'play', t('Play'));
        root.classList.remove('is-playing');
      }

      /* tapping in time */
      let tapRun = null, taps = [], t0 = null, tapValue = null, tapping = false;
      const tap = {};
      if (tapMode) {
        const per = goal.per_beat || 1, stepSec = 60 / goal.tempo / per, beatMs = 60000 / goal.tempo;
        const expected = M.tapTimes(goal);
        const total = (goal.rhythm ? goal.rhythm.length : goal.beats * per) * stepSec * 1000; // ms, the run after the count-in
        const box = el('div', 'mu-tap');
        const light = el('div', 'mu-tap__light', { 'aria-hidden': 'true' });
        const count = el('span', 'mu-tap__count', null, '');
        light.appendChild(count);
        const line = el('div', 'mu-tap__line', { 'aria-hidden': 'true', dir: 'ltr' });
        const xOf = (ms) => 3 + 94 * clamp(ms / Math.max(1, total - stepSec * 1000), 0, 1);
        const dots = expected.map((ms) => { const d = el('span', 'mu-tap__dot'); d.style.left = xOf(ms) + '%'; line.appendChild(d); return d; });
        const status = el('p', 'mu-tap__status', { 'aria-live': 'polite' });
        const intro = goal.rhythm
          ? fill('Press Start. Watch the light count {n} beats to get ready, then tap the rhythm: one tap for each dot, as it lights up.', { n: goal.count_in })
          : fill('Press Start. Watch the light count {n} beats to get ready, then tap once on every beat.', { n: goal.count_in });
        status.textContent = intro;
        const startBtn = button('mu-btn--play', null, () => (tapping ? stopTap(true) : startTap()), { 'data-lockable': true });
        iconLabel(startBtn, 'play', t('Start'));
        const pad = el('button', 'mu-pad mu-pad--tap', { type: 'button', 'data-lockable': true });
        pad.append(el('span', 'mu-pad__name', null, t('Tap')), el('span', 'mu-pad__sub', null, soundLabel(goal.sound)));
        padEl.set(goal.sound, pad);
        bar.prepend(el('span', 'mu-tempo__out', { title: t('Tempo (beats per minute)') }, BEAT + goal.tempo));
        bar.prepend(startBtn);
        box.append(light, line, pad, status);
        root.appendChild(box);
        Object.assign(tap, { light, count, dots, line, status, startBtn, pad, intro, xOf, expected });

        function startTap() {
          if (locked) return;
          Sound.ensure();
          stopTap(false);
          taps = []; tapValue = null; ctx.onChange(null);
          line.querySelectorAll('.mu-tap__tick').forEach((x) => x.remove());
          dots.forEach((d) => d.classList.remove('is-now', 'is-answer', 'is-past'));
          const ci = goal.count_in * per;
          const steps = ci + (goal.rhythm ? goal.rhythm.length : goal.beats * per);
          status.textContent = t('Get ready…');
          tapRun = Runner({
            length: () => steps,
            dur: () => stepSec,
            sound: (i, when) => { if (i % per === 0) Sound.click(when, Math.floor(i / per) % goal.count_in === 0); },
            visual: (i) => {
              if (i % per === 0) {
                const b = Math.floor(i / per);
                count.textContent = String(i < ci ? b + 1 : b - goal.count_in + 1);
                light.classList.toggle('is-countin', i < ci);
                if (ctx.reduce) light.classList.add('is-beat'); else restart(light, 'is-beat');
                if (ctx.reduce) setTimeout(() => light.classList.remove('is-beat'), 120);
              }
              if (i === ci) status.textContent = goal.rhythm ? t('Tap now, on the dots.') : t('Tap now, on every beat.');
              if (i >= ci) {
                const ms = (i - ci) * stepSec * 1000;
                dots.forEach((d, j) => { const near = Math.abs(expected[j] - ms) < 1; d.classList.toggle('is-now', near); if (expected[j] < ms) d.classList.add('is-past'); });
              }
            },
            done: () => finishTap()
          });
          const start0 = tapRun.start(0);
          t0 = start0 + ci * stepSec;
          tapping = true;
          iconLabel(startBtn, 'stop', t('Stop'));
          try { root.focus({ preventScroll: true, focusVisible: false }); } catch (err) { /* old browser */ }
        }
        function finishTap() {
          tapping = false;
          iconLabel(startBtn, 'play', t('Start again'));
          dots.forEach((d) => d.classList.remove('is-now'));
          light.classList.remove('is-countin');
          count.textContent = '';
          const r = M.checkTaps(goal, taps);
          tapValue = { taps: taps.slice(0, 64), hits: r.hits, of: r.n };
          status.textContent = taps.length
            ? fill('{hits} of {n} taps on time.', { hits: r.hits, n: r.n }) + ' ' + t('Press Check, or Start again to have another go.')
            : t('No taps that time. Press Start again, and tap the big button (or the space bar) with the beat.');
          ctx.onChange(tapValue);
        }
        function stopTap(byHand) {
          if (tapRun) tapRun.stop();
          if (tapping && byHand) { tapping = false; iconLabel(startBtn, 'play', t('Start')); status.textContent = intro; count.textContent = ''; light.classList.remove('is-countin'); }
          tapping = false;
        }
        function tapNow() {
          if (locked) return;
          Sound.drum(goal.sound, 0);
          flash(goal.sound);
          if (!tapping || t0 == null) return;
          const ms = (perf() - t0) * 1000;
          if (ms < -beatMs * 0.5) return; // taps during the count-in don't count
          taps.push(Math.round(ms));
          const near = expected.some((w) => Math.abs(w - ms) <= goal.tolerance_ms);
          const tick = el('span', 'mu-tap__tick' + (near ? '' : ' is-off'));
          tick.style.left = xOf(ms) + '%';
          line.appendChild(tick);
        }
        pad.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.preventDefault();
          try { root.focus({ preventScroll: true, focusVisible: false }); } catch (err) { /* old browser */ }
          tapNow();
        });
        pad.addEventListener('click', (e) => { if (e.detail === 0) tapNow(); });
        tap.start = startTap; tap.stop = stopTap; tap.now = tapNow;
      }

      root.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target !== root && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (tapMode) {
          if (!tapping) return;
          if (e.code === 'Space' || e.code === 'Enter' || /^Key[A-Z]$/.test(e.code)) { e.preventDefault(); if (!e.repeat) tap.now(); }
          return;
        }
        const i = PAD_CODES.indexOf(e.code);
        if (i < 0 || i >= spec.pads.length) return;
        e.preventDefault();
        if (!e.repeat) hit(spec.pads[i]);
      });

      function value() {
        if (tapMode) return tapValue;
        if (!isTask || !pat) return null;
        const out = {};
        let any = false;
        Object.keys(goal.tracks).forEach((k) => { out[k] = (cells[k] || []).map((on) => { if (on) any = true; return on ? 'x' : '.'; }).join(''); });
        return any ? { tracks: out } : null;
      }

      // laid out again when the width changes (not the height, which the layout itself changes), a frame later
      let ro = null, seenW = 0, relay = 0;
      if (pat) {
        layout();
        seenW = root.clientWidth;
        ro = window.ResizeObserver ? new ResizeObserver(() => {
          if (Math.abs(root.clientWidth - seenW) < 2) return;
          seenW = root.clientWidth;
          cancelAnimationFrame(relay);
          relay = requestAnimationFrame(layout);
        }) : null;
        if (ro) ro.observe(root);
      }
      const onHide = () => { if (document.hidden) { if (gridRun && gridRun.playing) stopGrid(); if (tapMode && tapping) tap.stop(true); } };
      document.addEventListener('visibilitychange', onHide);

      return {
        value,
        reset() {
          if (tapMode) { tap.stop(true); taps = []; tapValue = null; tap.line.querySelectorAll('.mu-tap__tick').forEach((x) => x.remove()); tap.dots.forEach((d) => d.classList.remove('is-answer', 'is-past', 'is-now')); tap.status.textContent = tap.intro; iconLabel(tap.startBtn, 'play', t('Start')); return; }
          if (pat) { rows.forEach((k) => { if (editable.has(k)) cells[k].fill(false); }); answerShown = false; paintCells(); }
        },
        reveal() {
          if (tapMode) { tap.stop(false); tap.dots.forEach((d) => d.classList.add('is-answer')); tap.status.textContent = goal.rhythm ? t('Tap once for each dot, at the time it lights up.') : t('Tap once on every beat, with the light and the click.'); return; }
          if (pat && isTask) { Object.keys(goal.tracks).forEach((k) => { cells[k] = [...goal.tracks[k]].map((c) => c === 'x'); }); answerShown = true; paintCells(); }
        },
        lock(on) { locked = Boolean(on); root.classList.toggle('is-locked', locked); lockButtons(root, locked); },
        destroy() {
          if (gridRun) gridRun.stop();
          if (tapMode) tap.stop(false);
          if (ro) ro.disconnect();
          cancelAnimationFrame(relay);
          document.removeEventListener('visibilitychange', onHide);
          flashTimers.forEach((x) => clearTimeout(x));
          host.textContent = '';
        }
      };
    }

    /* ---------------- in words ---------------- */
    // the place of each hit: "Kick: 1, 3 · Snare: 2, 4"; "every beat", "every step"
    function patternText(tracks, per) {
      return Object.keys(tracks || {}).map((k) => {
        const tr = String(tracks[k] || ''), hits = [];
        [...tr].forEach((c, i) => { if (c === 'x') hits.push(i); });
        let where;
        if (!hits.length) where = t('nothing');
        else if (hits.length === tr.length && tr.length > 1) where = t('every step');
        else if (per > 1 && hits.length === tr.length / per && hits.every((i) => i % per === 0)) where = t('every beat');
        else where = hits.map((i) => M.countName(i, per)).join(', ');
        return soundLabel(k) + ': ' + where;
      }).join(' · ');
    }
    const saOf = (spec) => (spec && spec.labels === 'sargam' && spec.sa ? M.toMidi(spec.sa) : null);
    const cleanTask = (spec, goal) => { try { return M.task(spec, goal); } catch (e) { return null; } };

    function check(goal0, value, spec0) {
      const r = cleanTask(spec0, goal0);
      if (!r) return { correct: false, invalid: true };
      const goal = r.goal;
      if (goal.type === 'notes') {
        if (!value || !Array.isArray(value.notes) || !value.notes.length) return { correct: false, invalid: true, note: t('Play the notes on the keys, then press Check.') };
        const res = M.checkNotes(goal, value.notes);
        if (res.invalid) return { correct: false, invalid: true };
        if (res.correct) return { correct: true };
        if (goal.in_order) {
          if (res.length < res.need) return { correct: false, invalid: true, note: fill('Play all {n} notes, then press Check.', { n: res.need }) };
          if (res.length > res.need) return { correct: false, note: fill('That is too many notes: the answer has {n}.', { n: res.need }) };
          if (res.firstWrong > 1) return { correct: false, note: fill('The first {n} notes are right.', { n: res.firstWrong }) };
          return { correct: false, note: t(res.firstWrong === 1 ? 'The first note is right.' : 'Check the first note.') };
        }
        if (res.length !== res.need) return { correct: false, note: fill(res.length < res.need ? 'Not enough keys: the answer has {n}.' : 'Too many keys: the answer has {n}.', { n: res.need }) };
        return { correct: false, note: t('Some of the keys you chose are not right.') };
      }
      if (goal.type === 'pattern') {
        if (!value || !value.tracks) return { correct: false, invalid: true, note: t('Fill in the grid, then press Check.') };
        const res = M.checkPattern(goal, value.tracks);
        if (res.correct) return { correct: true };
        return { correct: false, note: t('Look again at:') + ' ' + res.wrong.map(soundLabel).join(', ') };
      }
      if (goal.type === 'tap') {
        if (!value || !Array.isArray(value.taps) || !value.taps.length) return { correct: false, invalid: true, note: t('Press Start and tap along, then press Check.') };
        const res = M.checkTaps(goal, value.taps.filter((x) => Number.isFinite(x)).slice(0, 64));
        if (res.correct) return { correct: true };
        let note = fill('{hits} of {n} taps on time.', { hits: res.hits, n: res.n });
        if (res.hits && Math.abs(res.mean) > goal.tolerance_ms / 3) note += ' ' + t(res.mean < 0 ? 'You were a little early.' : 'You were a little late.');
        else if (res.extra > 0) note += ' ' + t('Some taps fell between the beats.');
        return { correct: false, note };
      }
      return { correct: false, invalid: true };
    }
    function describe(value, spec) {
      if (!value) return '';
      if (Array.isArray(value.notes)) return M.notesText(value.notes.filter((n) => M.toMidi(n) != null).slice(0, 32), { octave: true, sargam: saOf(spec) });
      if (value.tracks) return patternText(value.tracks, (spec && spec.pattern && spec.pattern.per_beat) || 1);
      if (Array.isArray(value.taps)) return Number.isFinite(value.hits) && Number.isFinite(value.of) ? fill('{hits} of {n} taps on time', { hits: value.hits, n: value.of }) : fill('{n} taps', { n: value.taps.length });
      return '';
    }
    function answer(goal0, spec0) {
      const r = cleanTask(spec0, goal0);
      if (!r) return '';
      const goal = r.goal;
      if (goal.type === 'notes') return M.notesText(goal.notes, { octave: !goal.any_octave, sargam: saOf(r.spec) });
      if (goal.type === 'pattern') return patternText(goal.tracks, r.spec.pattern.per_beat);
      if (goal.type === 'tap') {
        return goal.rhythm
          ? fill('Tap the rhythm {r} at {tempo}', { r: [...goal.rhythm].map((c, i) => (c === 'x' ? M.countName(i, goal.per_beat) : null)).filter(Boolean).join(', '), tempo: BEAT + goal.tempo })
          : fill('Tap on each of {n} beats at {tempo}', { n: goal.beats, tempo: BEAT + goal.tempo });
      }
      return '';
    }

    /* ---------------- still pictures (the book, print, EPUB) ---------------- */
    const INK = '#2b1d11', GOLD = '#8a6128', SOFT = '#5b4730', PAPER = '#fffaf0', MARK = '#ecd08f';
    const FONT = "Georgia, 'Times New Roman', serif";
    function pianoSvg(spec) {
      const lo = M.toMidi(spec.from), hi = M.toMidi(spec.to);
      const whites = [];
      for (let m = lo; m <= hi; m++) if (!M.isBlack(m)) whites.push(m);
      const kw = 24, kh = 96, bw = 14, bh = 60, pad = 1;
      const marked = new Set(M.markedKeys(spec));
      const sp = spelling(spec, null);
      const nameOf = (m) => sp.map.get(m) || M.noteName(m, sp.flats);
      const sa = spec.sa != null ? M.toMidi(spec.sa) : lo + M.mod12(-lo);
      const lab = (m) => (spec.labels === 'letters' ? M.pretty(nameOf(m), M.mod12(m) === 0) : spec.labels === 'sargam' ? M.sargam(m, sa).name : '');
      let lines = [];
      if (spec.demo) {
        const words = spec.demo.steps.map((s) => (s.notes.length > 1 ? '[' + s.notes.map((n) => M.pretty(n, false)).join(' ') + ']' : s.notes.length ? M.pretty(s.notes[0], false) : '·'));
        let cur = '';
        words.forEach((w) => { if ((cur + ' ' + w).length > Math.max(24, whites.length * 3)) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
        if (cur) lines.push(cur);
        lines = lines.slice(0, 4);
      }
      const width = whites.length * kw + pad * 2, height = kh + pad * 2 + (lines.length ? 10 + lines.length * 16 : 0);
      let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(t('Piano keyboard'))}" font-family="${FONT}">`;
      whites.forEach((m, i) => {
        const x = pad + i * kw, on = marked.has(m);
        s += `<rect x="${x}" y="${pad}" width="${kw}" height="${kh}" rx="2" fill="${on ? MARK : PAPER}" stroke="${INK}" stroke-width="1"/>`;
        if (on) s += `<circle cx="${x + kw / 2}" cy="${pad + kh - 30}" r="3.6" fill="${GOLD}"/>`;
        const l = lab(m);
        if (l) s += `<text x="${x + kw / 2}" y="${pad + kh - 9}" font-size="${l.length > 2 ? 8 : 10}" text-anchor="middle" fill="${INK}">${esc(l)}</text>`;
      });
      for (let m = lo; m <= hi; m++) {
        if (!M.isBlack(m)) continue;
        const wi = whites.indexOf(m - 1), on = marked.has(m);
        const x = pad + (wi + 1 + (BLACK_OFFSET[M.mod12(m)] || 0)) * kw - bw / 2;
        s += `<rect x="${x.toFixed(1)}" y="${pad}" width="${bw}" height="${bh}" rx="2" fill="${on ? GOLD : INK}" stroke="${INK}" stroke-width="1"/>`;
        if (on) s += `<circle cx="${(x + bw / 2).toFixed(1)}" cy="${pad + bh - 12}" r="3" fill="${PAPER}"/>`;
      }
      lines.forEach((ln, i) => { s += `<text x="${width / 2}" y="${kh + pad * 2 + 22 + i * 16}" font-size="12" text-anchor="middle" fill="${SOFT}">${esc(ln)}</text>`; });
      return s + '</svg>';
    }
    function drumsSvg(spec) {
      const pat = spec.pattern;
      if (!pat) {
        const w = 86, gap = 8, n = spec.pads.length, width = n * w + (n - 1) * gap + 2;
        let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 50" width="${width}" height="50" role="img" aria-label="${esc(t('Drum pads'))}" font-family="${FONT}">`;
        spec.pads.forEach((k, i) => {
          const x = 1 + i * (w + gap);
          s += `<rect x="${x}" y="1" width="${w}" height="48" rx="9" fill="${PAPER}" stroke="${INK}"/><text x="${x + w / 2}" y="30" font-size="12" text-anchor="middle" fill="${INK}">${esc(soundLabel(k))}</text>`;
        });
        return s + '</svg>';
      }
      const rows = Object.keys(pat.tracks), lab = 78, c = 16, g = 3, top = pat.marks ? 30 : 18;
      const starts = new Set();
      if (pat.groups) { let x = 0; pat.groups.forEach((n) => { starts.add(x); x += n; }); } else for (let i = 0; i < pat.steps; i += pat.per_beat) starts.add(i);
      const xs = [];
      let x = lab;
      for (let i = 0; i < pat.steps; i++) { if (i && starts.has(i)) x += 4; xs.push(x); x += c + g; }
      const width = x + 2, height = top + rows.length * (c + g) + 2;
      let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(t('A step pattern for drums'))}" font-family="${FONT}">`;
      const marks = {};
      if (pat.groups && pat.marks) { let q = 0; pat.groups.forEach((n, i) => { marks[q] = pat.marks[i]; q += n; }); }
      for (let i = 0; i < pat.steps; i++) {
        const beat = i % pat.per_beat === 0;
        s += `<text x="${xs[i] + c / 2}" y="${top - 5}" font-size="${beat ? 10 : 8}" text-anchor="middle" fill="${beat ? INK : SOFT}">${esc(beat ? String(i / pat.per_beat + 1) : M.countName(i, pat.per_beat).replace(/^\d+/, ''))}</text>`;
        if (marks[i] != null) s += `<text x="${xs[i] + c / 2}" y="10" font-size="10" text-anchor="middle" fill="#9a3324">${esc(marks[i])}</text>`;
      }
      rows.forEach((k, r) => {
        const y = top + r * (c + g);
        s += `<text x="${lab - 8}" y="${y + c - 4}" font-size="11" text-anchor="end" fill="${INK}">${esc(soundLabel(k))}</text>`;
        [...pat.tracks[k]].forEach((ch, i) => {
          s += ch === 'x'
            ? `<rect x="${xs[i]}" y="${y}" width="${c}" height="${c}" rx="3" fill="${INK}"/>`
            : `<rect x="${xs[i] + 0.5}" y="${y + 0.5}" width="${c - 1}" height="${c - 1}" rx="3" fill="${PAPER}" stroke="${GOLD}" stroke-opacity=".55"/>`;
        });
      });
      return s + '</svg>';
    }
    function still(spec0, goal0) {
      // a task's spec is a clean block spec too (its rows to fill start empty)
      const r = goal0 ? cleanTask(spec0, goal0) : null;
      const spec = r ? r.spec : M.block(spec0, { keepEmpty: true });
      if (!spec) return '';
      return spec.instrument === 'piano' ? pianoSvg(spec) : drumsSvg(spec);
    }

    /* ---------------- the kind ---------------- */
    P.widgets.register('music', {
      block(host, raw, ctx) {
        const spec = M.block(raw);
        if (!spec) throw new Error('this piano or drum part does not hold together');
        return spec.instrument === 'piano' ? piano(host, spec, ctx, null) : drums(host, spec, ctx, null);
      },
      task(host, rawSpec, rawGoal, ctx) {
        const r = M.task(rawSpec, rawGoal);
        if (!r) throw new Error('this music task does not hold together');
        return r.spec.instrument === 'piano' ? piano(host, r.spec, ctx, r.goal) : drums(host, r.spec, ctx, r.goal);
      },
      check, describe, answer, still
    });
  }
})();
