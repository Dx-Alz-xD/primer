/* =====================================================================
   The tour of Primer (app.html): every part of the app, one short step
   at a time, in plain words for people who have not used an app like
   this before. A step about something on the screen lights it up and
   dims the rest; a step about something on another page (a lesson, a
   test, the offline download) is a card in the middle. Each step can be
   read aloud ("Listen", readaloud.js), in the page's language.

   It starts on its own after the welcome (app.html?tour=1), and from
   "Take a short tour" on the builder. Next, Back, the arrow keys and
   Escape all work; on a phone the card sits at the bottom of the
   screen, under the part it is about.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth || !P.auth.current()) return;
  const $ = (s, r) => (r || document).querySelector(s);
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, v) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

  // sel: the part of the page the step is about (none: a card in the middle)
  const STEPS = [
    { icon: '👋', title: 'Welcome, {name}!', text: 'This is a short tour of Primer. It shows you each part, one by one. Press Next to go on. Press the cross to stop.' },
    { sel: '#b-topic', icon: '✏️', title: 'Write what you want to learn', text: 'Write any topic in this box. For example: growing rice, speaking English, fixing a phone, or maths.' },
    { sel: '.blang', icon: '🗣️', title: 'Choose the language of your lessons', text: 'Pick the language you want to learn in. Your lessons and questions will come in this language.' },
    { sel: '.sf-entry', icon: '📷', title: 'Start from what you have', text: 'You can also start from what you already know, from a photo of a thing, or from a photo of a book page.' },
    { sel: 'fieldset.clen', icon: '⏱️', title: 'Choose how long', text: 'Choose a short course or a long one. You can also say how many lessons you want, or how much time you have.' },
    { sel: '#builder button[type="submit"]', icon: '✅', title: 'Make your course', text: 'Press this button. Primer makes a whole course for you, with the lessons in the right order.' },
    { icon: '📖', title: 'Learn a little at a time', text: 'Each lesson comes in small parts. After each part there is a small question. If your answer is wrong, Primer explains it again.' },
    { sel: '.tutor-seal', icon: '💬', title: 'Ask the tutor', text: 'Have a doubt? Press Tutor and ask anything, in your own words and your own language. You can also speak instead of typing.' },
    { icon: '🔊', title: 'Listen or watch', text: 'Is reading hard? Press Listen to hear a lesson read out loud. You can also watch videos, with a small quiz after each one.' },
    { sel: 'a.nav__link[href^="review"]', icon: '🔁', title: 'Practise what you got wrong', text: 'Review brings back the questions you got wrong a few days later, so you remember them for good.' },
    { icon: '🏅', title: 'Tests and certificates', text: 'After each unit there is a small test. Pass it to open the next unit. Pass the last test to get a certificate.' },
    { icon: '📶', title: 'No internet? No problem', text: 'Download a course when you have internet, and learn later without it. You can also send a whole course to a friend as one file, on WhatsApp.' },
    { icon: '🧑‍🏫', title: 'For teachers', text: 'A teacher can turn a course into a class. Students join with a short code, and the teacher can see how each one is doing.' },
    { sel: '.sbtn--timer', icon: '⏰', title: 'Timer and reminders', text: 'The timer helps you study in short blocks, with breaks. The bell reminds you about courses you have not finished.' },
    { sel: 'a.nav__link[href^="community"]', icon: '🤝', title: 'Learn together', text: 'In Community you can share what you learn and see what others are learning. You can also share what you know, so it is not forgotten.' },
    { sel: '.langpick', icon: '🌐', title: 'Change the language any time', text: 'You can change the language of Primer here, whenever you want.' },
    { icon: '🌱', title: 'You are ready!', text: 'Now write your first topic and press Build my course. Your course will grow like a garden as you learn.' }
  ];

  let root = null, ring = null, card = null, listen = null, at = 0, opener = null, raf = 0;
  const firstName = () => ((P.auth.current().name || '').trim().split(/\s+/)[0] || '');
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const target = (s) => { const el = s.sel ? $(s.sel) : null; return visible(el) ? el : null; };
  const docked = () => window.innerWidth < 700;

  function build() {
    root = document.createElement('div');
    root.className = 'tour';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'tour-title');
    root.setAttribute('aria-describedby', 'tour-text');
    root.innerHTML = `
      <div class="tour__shade"></div>
      <div class="tour__ring" aria-hidden="true"></div>
      <div class="tour__card">
        <button class="tour__close" type="button" aria-label="${P.esc(t('Close the tour'))}">✕</button>
        <div class="tour__head"><span class="tour__icon" aria-hidden="true"></span><span class="tour__count"></span></div>
        <h2 class="tour__title" id="tour-title" tabindex="-1"></h2>
        <p class="tour__text" id="tour-text"></p>
        <div class="tour__bar">
          <span data-listen></span>
          <button class="textlink tour__back" type="button">${P.esc(t('Back'))}</button>
          <button class="btn tour__next" type="button"></button>
        </div>
      </div>`;
    document.body.appendChild(root);
    ring = $('.tour__ring', root);
    card = $('.tour__card', root);
    if (P.readAloud) {
      listen = P.readAloud.button(() => `${$('.tour__title', root).textContent}. ${$('.tour__text', root).textContent}`);
      $('[data-listen]', root).replaceWith(listen);
    } else $('[data-listen]', root).remove();
    $('.tour__close', root).addEventListener('click', () => end(false));
    $('.tour__back', root).addEventListener('click', () => go(at - 1));
    $('.tour__next', root).addEventListener('click', () => (at === STEPS.length - 1 ? end(true) : go(at + 1)));
    // a click on the dimmed page does nothing: the tour holds the screen until it is closed
    $('.tour__shade', root).addEventListener('click', (e) => e.stopPropagation());
    root.addEventListener('keydown', onKey);
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); end(false); return; }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      if (e.key === 'ArrowRight') { if (at < STEPS.length - 1) go(at + 1); } else go(at - 1);
      return;
    }
    if (e.key === 'Tab') { // focus stays inside the card
      const f = Array.from(card.querySelectorAll('button:not([disabled]), [tabindex="0"]')).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); }

  // where the light and the card go for this step
  function place() {
    if (!root) return;
    const s = STEPS[at], el = target(s);
    root.classList.toggle('is-docked', docked());
    if (!el) {
      root.classList.remove('is-top');
      root.classList.add('is-center');
      ring.style.cssText = '';
      card.style.left = card.style.top = '';
      return;
    }
    root.classList.remove('is-center');
    const r = el.getBoundingClientRect(), pad = 8;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    // on a phone the card docks at the bottom, or at the top when the part is down there (the tutor button)
    root.classList.toggle('is-top', docked() && r.top + r.height / 2 > window.innerHeight / 2);
    if (docked()) { card.style.left = card.style.top = ''; return; }
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16, W = window.innerWidth, H = window.innerHeight;
    let top = r.bottom + pad + gap;
    if (top + ch > H - 12) top = r.top - pad - gap - ch; // above it, if there's no room below
    if (top < 12) top = Math.max(12, Math.min(H - ch - 12, r.top + r.height / 2 - ch / 2)); // else beside it
    let left = Math.max(12, Math.min(W - cw - 12, r.left + r.width / 2 - cw / 2));
    if (top === Math.max(12, Math.min(H - ch - 12, r.top + r.height / 2 - ch / 2)) && r.right + gap + cw < W - 12) left = r.right + pad + gap;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function go(i) {
    at = Math.max(0, Math.min(STEPS.length - 1, i));
    const s = STEPS[at];
    if (P.readAloud) P.readAloud.stop();
    $('.tour__icon', root).textContent = s.icon;
    $('.tour__count', root).textContent = fill('{n} of {total}', { n: at + 1, total: STEPS.length });
    $('.tour__title', root).textContent = fill(s.title, { name: firstName() });
    $('.tour__text', root).textContent = t(s.text);
    $('.tour__back', root).hidden = at === 0;
    $('.tour__next', root).textContent = at === STEPS.length - 1 ? t('Start learning') : t('Next');
    const el = target(s);
    // the part it is about comes into view first, near the top, so the card has room under it
    // (on a phone the card is docked at the bottom, so the part goes in the top half)
    if (el && getComputedStyle(el).position !== 'fixed') {
      const r = el.getBoundingClientRect(), H = window.innerHeight;
      const want = docked() ? H * 0.14 : Math.min(110, Math.max(70, H * 0.14));
      const room = docked() ? H * 0.5 : H - card.offsetHeight - 40;
      if (r.top < 60 || r.bottom > room) window.scrollBy({ top: r.top - want, behavior: 'instant' });
    }
    place();
    // (the `translate` property, not `transform`, which centres the card in the middle of the screen)
    if (!P.motion.reduce && card.animate) card.animate([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    $('.tour__title', root).focus({ preventScroll: true });
  }

  function end(finished) {
    if (!root) return;
    if (P.readAloud) P.readAloud.stop();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule);
    root.remove();
    root = null;
    document.documentElement.classList.remove('tour-open');
    P.store.set('primer.tour.seen', true);
    const topic = $('#b-topic');
    if (finished && topic) { topic.scrollIntoView({ block: 'center', behavior: 'instant' }); topic.focus(); } else if (opener && opener.focus) opener.focus();
  }

  function start() {
    if (root) return;
    opener = document.activeElement;
    // the builder, not a course, is what the tour shows
    const view = $('#view-build');
    if (view && view.hidden) { location.href = 'app.html?tour=1'; return; }
    document.documentElement.classList.add('tour-open');
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (!root) build();
    go(0);
  }

  P.tour = { start, end: () => end(false) };

  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-tour-start]'); if (b) { e.preventDefault(); start(); } });

  // straight after the welcome (app.html?tour=1): once the page and its translations are in
  if (P.params.get('tour') === '1') {
    const clean = new URL(location.href);
    clean.searchParams.delete('tour');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
    Promise.resolve(P.tReady).then(() => setTimeout(start, 700));
  }
})();
