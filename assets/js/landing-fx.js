/* =====================================================================
   The landing page's moments (GSAP: assets/vendor/gsap).

   - The headline enters once, letter by letter (SplitText).
   - The library's letters gather into a topic (swarm.js): each hint's
     subject as the hint finishes typing, or whatever the visitor types.
   - How it works: the app at work. While the section is pinned, scrolling
     plays its four screens (a topic typed, the outline, a checkpoint
     answered, the tutor answering in Hindi) and lights the matching step.
     On a small screen, or with reduced motion, the four screens simply
     stand one after another.
   - The garden grows its sample course once when it comes into view; the
     slider grows or prunes it by hand.

   Everything reads complete without GSAP: the page then shows the final
   state of each moment.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const g = window.gsap;
  const ST = window.ScrollTrigger;
  const Split = window.SplitText;
  const reduce = () => Boolean(P.motion && P.motion.reduce);
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, v) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const ready = Promise.race([P.tReady || Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
  if (g && ST) g.registerPlugin(ST);
  if (g && Split) g.registerPlugin(Split);
  const live = () => Boolean(g) && !reduce();

  /* ---------- the hero ---------- */
  const h1 = $('[data-split]');
  const rest = $$('.hero .pill, .hero__stage, .hero .lead, .hero .ask, .chips--hero, .hero__note');
  if (live() && h1) {
    g.set([h1, ...rest], { autoAlpha: 0 }); // nothing shows before its entrance (the text may still be translated)
    ready.then(() => {
      g.set(h1, { autoAlpha: 1 });
      if (Split) {
        Split.create(h1, {
          type: 'words,chars', mask: 'words', autoSplit: true,
          onSplit: (self) => g.from(self.chars, { yPercent: 115, duration: 1.05, ease: 'power4.out', stagger: 0.017 })
        });
      }
      g.fromTo(rest, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07, delay: 0.4, clearProps: 'transform' });
    });
  }

  /* ---------- the swarm ---------- */
  // the subject of each hint in landing.js, in the same order
  const SUBJECTS = ['Black holes', 'Calculus', 'Stoicism', 'Organic chemistry', 'Personal finance'];
  const canvas = $('#swarm');
  const swarm = canvas && P.swarm ? P.swarm(canvas, { max: 1500 }) : null;
  P.heroSwarm = swarm; // for checking the page by hand
  if (swarm) {
    const input = $('#topic');
    const typed = () => (input ? input.value.trim() : '');
    let hint = 0, timer = 0;
    ready.then(() => { if (!typed()) swarm.say(t(SUBJECTS[0])); });
    document.addEventListener('primer:hint', (e) => {
      hint = e.detail.index % SUBJECTS.length;
      if (!typed()) swarm.say(t(SUBJECTS[hint]));
    });
    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => swarm.say(typed() || t(SUBJECTS[hint])), 260);
      });
    }
  }

  /* ---------- how it works ---------- */
  (function show() {
    const sec = $('#how');
    if (!sec) return;
    const steps = $$('.show__step', sec);
    const scrs = $$('.scr', sec);
    const light = (i) => steps.forEach((s, k) => s.classList.toggle('is-on', k === i));
    const still = () => { sec.classList.add('is-static'); sec.classList.remove('is-pinned'); };
    if (!live() || !ST) { still(); return; }
    const mm = g.matchMedia();
    mm.add('(min-width: 900px) and (min-height: 620px)', () => {
      sec.classList.remove('is-static');
      sec.classList.add('is-pinned');
      const typedEl = $('[data-typed]', sec);
      const chars = Split ? Split.create(typedEl, { type: 'chars' }).chars : [typedEl];
      const rows = $$('.scr__uh, .scr__ls', sec);
      const reply = $('[data-reply]', sec);
      const words = Split ? Split.create(reply, { type: 'words' }).words : [reply];
      g.set(scrs.slice(1), { autoAlpha: 0, y: 24 });
      const swap = (tl, a, b, at) => tl.to(scrs[a], { autoAlpha: 0, y: -24, duration: 0.14 }, at).to(scrs[b], { autoAlpha: 1, y: 0, duration: 0.16 }, at + 0.06);
      const pinEl = $('.show__pin', sec);
      const tl = g.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: pinEl, start: 'top top', end: () => '+=' + Math.round(window.innerHeight * 3.2),
          pin: pinEl, scrub: 0.7, anticipatePin: 1,
          onUpdate: (self) => light(Math.min(3, Math.floor(self.progress * 4)))
        }
      });
      // 1. the topic is typed, the button pressed
      tl.from(chars, { opacity: 0, duration: 0.02, stagger: 0.62 / chars.length }, 0.05);
      tl.to('.scr__btn', { scale: 0.94, duration: 0.06, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 0.76);
      // 2. the outline arrives, unit by unit
      swap(tl, 0, 1, 0.94);
      tl.from(rows, { opacity: 0, x: -12, duration: 0.08, stagger: 0.72 / rows.length }, 1.12);
      // 3. a checkpoint is answered, and the next part opens
      swap(tl, 1, 2, 1.94);
      tl.from($('[data-pick]', sec), { backgroundColor: 'rgba(255,250,235,0.35)', borderColor: 'rgba(91,71,48,0.35)', duration: 0.1 }, 2.4);
      tl.from($('.check__ok', sec), { opacity: 0, x: 8, duration: 0.1 }, 2.45);
      tl.from($('[data-unlock]', sec), { opacity: 0.2, duration: 0.16 }, 2.62);
      // 4. a line is selected, and the tutor answers in Hindi
      swap(tl, 2, 3, 2.94);
      tl.from($('[data-mark]', sec), { backgroundSize: '0% 100%', duration: 0.2 }, 3.12);
      tl.from($('.tutor-demo__me', sec), { opacity: 0, y: 10, duration: 0.1 }, 3.36);
      tl.from(words, { opacity: 0, duration: 0.02, stagger: 0.42 / words.length }, 3.5);
      tl.to({}, { duration: 0.08 }, 3.92);
      return () => { sec.classList.remove('is-pinned'); light(0); };
    });
    mm.add('(max-width: 899px), (max-height: 619px)', () => { still(); return () => sec.classList.remove('is-static'); });
  })();

  /* ---------- the garden ---------- */
  (function garden() {
    const host = $('#grow-garden');
    if (!host || !P.garden) return;
    const range = $('#grow-range'), out = $('#grow-out');
    const total = 12;
    const gd = P.garden.mount(host, { seed: 'how-black-holes-work', units: [3, 4, 5], height: 200 });
    let now = 0;
    const label = () => { if (out) out.textContent = fill('{done} of {total} lessons finished', { done: now, total }); };
    const set = (n, animate) => { now = n; gd.set(n, { animate }); if (range) range.value = String(n); label(); };
    const grows = live() && ST;
    set(grows ? 0 : total, false);
    ready.then(label);
    if (grows) ST.create({ trigger: host, start: 'top 75%', once: true, onEnter: () => set(total, true) });
    if (range) range.addEventListener('input', () => set(Number(range.value), true));
  })();

  // the page's height changes once fonts and translations arrive: measure the pinned section again
  if (ST) {
    ready.then(() => ST.refresh());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ST.refresh());
  }
})();
