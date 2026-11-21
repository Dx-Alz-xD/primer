/* =====================================================================
   Reading a short text aloud, for people who find reading hard: the
   welcome after sign-up and the tour ("Listen").

   With an ElevenLabs key (P.boot.voice) the text goes to /api/voice/text,
   which reads every language Primer speaks; otherwise the browser's own
   voice reads it, in the page's language when the device has one.

     P.readAloud.button(() => text)   a "Listen" button for that text
     P.readAloud.stop()               stops whatever is being read
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const t = (s) => (P.t ? P.t(s) : s);
  // the device voice to ask for, by Primer's language code
  const BCP = {
    en: 'en-IN', hi: 'hi-IN', bho: 'hi-IN', mai: 'hi-IN', bn: 'bn-IN', mr: 'mr-IN', te: 'te-IN', ta: 'ta-IN', gu: 'gu-IN',
    ur: 'ur-IN', kn: 'kn-IN', or: 'or-IN', ml: 'ml-IN', pa: 'pa-IN', as: 'as-IN', es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA',
    pt: 'pt-BR', ru: 'ru-RU'
  };
  const SPEAKER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  let audio = null, current = null;

  function stop() {
    if (audio) { audio.pause(); audio = null; }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* nothing to stop */ }
    if (current) { current.classList.remove('is-on'); current.setAttribute('aria-pressed', 'false'); current = null; }
  }

  function deviceVoice(text, btn) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { stop(); P.toast(t('This device can’t read aloud.'), 'error'); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP[P.lang] || P.lang || 'en';
    const want = u.lang.toLowerCase().slice(0, 2);
    const v = window.speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith(want));
    if (v) u.voice = v;
    u.rate = 0.92; // a little slower than usual
    u.onend = u.onerror = () => { if (current === btn) stop(); };
    window.speechSynthesis.speak(u);
  }

  async function say(text, btn) {
    if (current === btn) { stop(); return; } // a second press stops it
    stop();
    current = btn;
    btn.classList.add('is-on');
    btn.setAttribute('aria-pressed', 'true');
    const words = String(text || '').trim();
    if (!words) { stop(); return; }
    if (P.boot && P.boot.voice) {
      try {
        const r = await P.post('/api/voice/text', { script: words });
        if (current !== btn) return; // stopped while it was being made
        audio = new Audio(r.url);
        audio.addEventListener('ended', () => { if (current === btn) stop(); });
        await audio.play();
        return;
      } catch (e) { audio = null; /* the device's own voice instead */ }
    }
    if (current === btn) deviceVoice(words, btn);
  }

  P.readAloud = {
    stop,
    say,
    button(getText, cls) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'listen' + (cls ? ' ' + cls : '');
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `${SPEAKER}<span>${P.esc(t('Listen'))}</span>`;
      b.addEventListener('click', () => say(typeof getText === 'function' ? getText() : getText, b));
      return b;
    }
  };
})();
