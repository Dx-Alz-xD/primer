/* =====================================================================
   The landing page's moments (GSAP: assets/vendor/gsap).

   - The headline enters once, letter by letter (SplitText).
   - The topic is typed in gold and grows roses (typegarden.js, after
     Type Garden): each hint's subject as its hint finishes typing, or
     whatever the visitor types, letter by letter.
   - The eyebrow's words unscramble out of the library's letters
     (GSAP ScrambleText).
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
  // the page is translated by i18n.js once the dictionary is in and the page has loaded (DOMContentLoaded);
  // wait for that pass (a cached dictionary can arrive first), so the headline is split in its own language
  const translated = new Promise((resolve) => {
    const after = () => Promise.resolve(P.tReady).then(() => setTimeout(resolve, 0));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', after, { once: true });
    else after();
  });
  const ready = Promise.race([translated, new Promise((r) => setTimeout(r, 1500))]);
  if (g && ST) g.registerPlugin(ST);
  if (g && Split) g.registerPlugin(Split);
  if (g && window.ScrambleTextPlugin) g.registerPlugin(window.ScrambleTextPlugin);
  const live = () => Boolean(g) && !reduce();

  /* ---------- the hero ---------- */
  const h1 = $('[data-split]');
  const rest = $$('.hero__demo, .hero .lead, .hero .ask, .chips--hero, .hero__note');
  const brow = $('.eyebrow');
  const browText = $('.eyebrow__text');
  // Latin and Cyrillic can be taken apart letter by letter; other scripts can't (vowel signs, joined letters)
  const latin = (txt) => Array.from(txt).every((ch) => { const c = ch.codePointAt(0); return c <= 0x024F || (c >= 0x0400 && c <= 0x04FF) || (c >= 0x2000 && c <= 0x206F); });
  if (live() && h1) {
    g.set([h1, brow, ...rest].filter(Boolean), { autoAlpha: 0 }); // nothing shows before its entrance (the text may still be translated)
    ready.then(() => {
      g.set(h1, { autoAlpha: 1 });
      // the eyebrow: its rose opens, and its words unscramble out of the library's letters (GSAP ScrambleText)
      if (brow) {
        g.fromTo(brow, { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.7, ease: 'power3.out', clearProps: 'transform' });
        g.from('.eyebrow__mark', { scale: 0.2, rotation: -60, transformOrigin: '50% 60%', duration: 1, ease: 'back.out(2)' });
        if (browText && window.ScrambleTextPlugin && latin(browText.textContent)) {
          g.to(browText, { duration: 1.5, ease: 'none', scrambleText: { text: browText.textContent, chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ&', revealDelay: 0.25, speed: 0.45 } });
        }
      }
      // the headline letter by letter; whatever happens there, the rest of the hero still comes in
      // (Latin and Cyrillic letter by letter; any other script word by word, since splitting
      // Devanagari or Tamil between letters tears off vowel signs, and Arabic letters must join)
      try {
        if (Split) {
          const byLetter = latin(h1.textContent);
          Split.create(h1, {
            type: byLetter ? 'words,chars' : 'words', mask: 'words', autoSplit: true,
            onSplit: (self) => g.from(byLetter ? self.chars : self.words, { yPercent: 115, duration: 1.05, ease: 'power4.out', stagger: byLetter ? 0.017 : 0.09 })
          });
        }
      } catch (e) { /* the headline simply shows */ }
      g.fromTo(rest, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07, delay: 0.4, clearProps: 'transform' });
    });
  }

  /* ---------- the type garden ---------- */
  // The builder at work, in a loop: a topic is typed into Primer's text box in gold and grows roses
  // (typegarden.js), while a pointer wanders by the button with question marks drifting off it (so
  // much to learn, which first?). Once the roses are out, the questions go, the pointer settles on
  // "Build my course" and clicks, and the next topic is typed. Whatever the visitor types in the real
  // box is followed letter by letter instead, with the pointer waiting on the button.
  const SUBJECTS = ['Black holes', 'Calculus', 'Stoicism', 'Organic chemistry', 'Personal finance'];
  const demo = $('.hero__demo');
  const tgCanvas = $('#type-garden');
  // a little sparer than Type Garden's, so the topic stays readable; set from the left, as in a text box
  const garden = tgCanvas && P.typeGarden ? P.typeGarden(tgCanvas, { density: 0.78, align: 'left' }) : null;
  P.heroGarden = garden; // for checking the page by hand
  if (garden && demo) {
    const input = $('#topic');
    const typed = () => (input ? input.value.trim() : '');
    const cursor = $('.demo__cursor', demo), arrow = $('.demo__arrow', demo), btn = $('.demo__btn', demo);
    const qs = $$('.demo__q', demo);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // a point on an element, in the scene's own pixels
    const spot = (el, fx, fy) => {
      const a = demo.getBoundingClientRect(), b = el.getBoundingClientRect();
      return { x: b.left - a.left + b.width * fx, y: b.top - a.top + b.height * fy };
    };
    const onButton = () => spot(btn, 0.62, 0.55);
    // a tap on the scene's button takes its topic to the real box (the scene itself is hidden from
    // screen readers and keyboards, which have the real form beside it)
    let aim = ''; // the topic the scene is typing (a tap mid-way takes the whole of it)
    if (btn && input) {
      btn.addEventListener('click', () => {
        const word = (typed() ? garden.text : aim || garden.text).trim();
        if (!word) return;
        input.value = word;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus({ preventScroll: true });
      });
    }

    if (!live()) {
      // still: the pointer rests by the button with its questions round it, and the topic is there, grown
      demo.classList.add('is-still');
      const place = () => { const p = onButton(); cursor.style.transform = `translate(${p.x}px, ${p.y}px)`; };
      ready.then(() => { aim = t(SUBJECTS[0]); garden.typeTo(aim); place(); });
      window.addEventListener('resize', place);
      if (input) input.addEventListener('input', () => { garden.mirror(typed() || t(SUBJECTS[0])); });
    } else {
      // the question marks: each rises off the pointer, turns a little and fades, again and again
      let wonders = [];
      const wonder = (on) => {
        wonders.forEach((tl) => tl.kill());
        wonders = [];
        if (!on) { g.to(qs, { autoAlpha: 0, scale: 0.3, duration: 0.3, ease: 'power2.in', overwrite: true }); return; }
        qs.forEach((q, i) => {
          const tl = g.timeline({ repeat: -1, repeatRefresh: true, delay: i * 0.27 });
          tl.fromTo(q, { x: () => rnd(-38, 26), y: () => rnd(-6, 12), scale: 0.45, rotation: () => rnd(-30, 30), autoAlpha: 0 },
            { x: () => '+=' + rnd(-26, 26), y: () => '-=' + rnd(44, 78), scale: () => rnd(0.9, 1.3), rotation: () => rnd(-28, 28), duration: 1.9, ease: 'sine.out' }, 0)
            .to(q, { autoAlpha: 0.95, duration: 0.35, ease: 'power1.out' }, 0)
            .to(q, { autoAlpha: 0, duration: 0.55, ease: 'power1.in' }, 1.35);
          wonders.push(tl);
        });
      };
      // wandering: short drifts around the button, never quite onto it
      let wandering = false;
      const wander = () => {
        if (!wandering) return;
        const b = onButton(), box = demo.getBoundingClientRect();
        const x = Math.max(16, Math.min(box.width - 34, b.x + rnd(-200, 30)));
        const y = Math.max(16, Math.min(box.height - 30, b.y + rnd(-150, 20)));
        g.to(cursor, { x, y, duration: rnd(0.9, 1.5), ease: 'sine.inOut', overwrite: true, onComplete: () => g.delayedCall(rnd(0.05, 0.45), wander) });
      };
      const startWander = () => { if (!wandering) { wandering = true; wander(); } };
      const stopWander = () => { wandering = false; };
      const toButton = (dur) => new Promise((resolve) => {
        const b = onButton();
        g.to(cursor, { x: b.x, y: b.y, duration: dur, ease: 'power2.inOut', overwrite: true, onComplete: resolve });
      });
      const click = async () => {
        btn.classList.add('is-press');
        g.fromTo(arrow, { scale: 1 }, { scale: 0.86, duration: 0.09, yoyo: true, repeat: 1, transformOrigin: '20% 10%' });
        await sleep(170);
        btn.classList.remove('is-press');
      };
      const grown = async (word) => { for (let i = 0; i < 90 && garden.text !== word; i++) await sleep(120); };

      // the visitor typing takes over: the box follows them, and the pointer waits on the button
      let visitor = false;
      if (input) {
        input.addEventListener('input', async () => {
          const v = typed();
          if (v) {
            garden.mirror(input.value);
            if (!visitor) { visitor = true; stopWander(); wonder(false); await toButton(0.6); btn.classList.add('is-hover'); }
          } else visitor = false;
        });
      }

      g.set(cursor, { x: 40, y: 60 });
      const play = async () => {
        let i = 0;
        for (;;) {
          if (visitor || document.hidden) { await sleep(500); continue; }
          const word = t(SUBJECTS[i % SUBJECTS.length]);
          aim = word;
          i++;
          btn.classList.remove('is-hover');
          startWander();
          wonder(true);
          garden.typeTo(word);
          await grown(word);
          await sleep(1700); // the roses open
          if (visitor) continue;
          stopWander();
          wonder(false);
          await toButton(0.85);
          btn.classList.add('is-hover');
          await sleep(450);
          await click();
          await sleep(1500);
        }
      };
      ready.then(() => setTimeout(play, 600));
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
