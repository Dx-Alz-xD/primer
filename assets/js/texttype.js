/* =====================================================================
   TextType: vanilla port of the React Bits component (no React, no gsap).
   P.TextType(el, options) -> { pause(), resume(), destroy() }
   Options mirror the React props: text, typingSpeed, initialDelay,
   pauseDuration, deletingSpeed, deleteMode ('backspace'|'select'),
   typeEffect ('none'|'fade'|'blur'|'rise'), mistakes (0..1), variableSpeed
   {min,max}, loop, showCursor, cursorStyle ('character'|'bar'|'block'|
   'underscore'), cursorCharacter, cursorGlide, hideCursorWhileTyping,
   prefix, textColors, onSentenceComplete, startOnVisible.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;

  const NEIGHBORS = {
    a: 'qwsz', b: 'vghn', c: 'xdfv', d: 'serfcx', e: 'wsdr', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', i: 'ujko',
    j: 'huikmn', k: 'jiolm', l: 'kop', m: 'njk', n: 'bhjm', o: 'iklp', p: 'ol', q: 'wa', r: 'edft', s: 'awedxz',
    t: 'rfgy', u: 'yhji', v: 'cfgb', w: 'qase', x: 'zsdc', y: 'tghu', z: 'asx',
    0: '9p', 1: '2q', 2: '13w', 3: '24e', 4: '35r', 5: '46t', 6: '57y', 7: '68u', 8: '79i', 9: '80o'
  };

  const EFFECTS = {
    fade: { keyframes: [{ opacity: 0 }, { opacity: 1 }], options: { duration: 360, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' } },
    blur: {
      keyframes: [{ opacity: 0, filter: 'blur(0.3em)' }, { opacity: 1, filter: 'blur(0em)' }],
      options: { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    },
    rise: {
      keyframes: [{ opacity: 0, top: '0.6em' }, { opacity: 1, top: '0em' }],
      options: { duration: 480, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' }
    }
  };

  const graphemes = (value) => {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (p) => p.segment);
    }
    return Array.from(value);
  };

  const typoFor = (char) => {
    const keys = NEIGHBORS[char.toLowerCase()];
    if (!keys) return null;
    const k = keys[Math.floor(Math.random() * keys.length)];
    return char === char.toLowerCase() ? k : k.toUpperCase();
  };

  const span = (cls, text) => {
    const s = document.createElement('span');
    if (cls) s.className = cls;
    if (text != null) s.textContent = text;
    return s;
  };

  P.TextType = function (el, options) {
    const o = Object.assign({
      text: [], typingSpeed: 50, initialDelay: 0, pauseDuration: 2000, deletingSpeed: 30, deleteMode: 'backspace',
      loop: true, showCursor: true, cursorStyle: 'character', cursorCharacter: '|', cursorGlide: true,
      hideCursorWhileTyping: false, typeEffect: 'none', mistakes: 0, prefix: '', variableSpeed: null,
      textColors: [], onSentenceComplete: null, startOnVisible: false
    }, options);
    const sentences = (Array.isArray(o.text) ? o.text : [String(o.text)]).filter(Boolean);
    if (!sentences.length) return null;

    el.classList.add('text-type');
    el.textContent = '';
    const sr = span('text-type__sr', o.prefix + sentences.join(' '));
    const content = span('text-type__content');
    content.setAttribute('aria-hidden', 'true');
    if (o.prefix) content.append(span('text-type__prefix', o.prefix));
    const textSpan = span('');
    const caret = span('text-type__caret', '​');
    content.append(textSpan, caret);
    el.append(sr, content);

    let cursor = null;
    if (o.showCursor) {
      cursor = span(`text-type__cursor text-type__cursor--${o.cursorStyle}`);
      cursor.setAttribute('aria-hidden', 'true');
      const blink = span('text-type__blink');
      if (o.cursorStyle === 'character') blink.textContent = o.cursorCharacter;
      else blink.append(span('text-type__shape'));
      cursor.append(blink);
      el.append(cursor);
    }

    let index = 0;
    let chars = graphemes(sentences[0]);
    let shown = 0, deleting = false, selected = 0, typo = null, lastTypo = -1;
    let timer = 0, running = false, visible = !o.startOnVisible, lastPos = null;
    const minS = o.variableSpeed ? o.variableSpeed.min : o.typingSpeed;
    const maxS = o.variableSpeed ? o.variableSpeed.max : o.typingSpeed;
    const speed = () => minS + Math.random() * (maxS - minS);
    const pace = (minS + maxS) / 2;
    const glide = Math.min(0.18, Math.max(0.06, pace * 0.0016));

    const animate = (node) => {
      const eff = EFFECTS[o.typeEffect];
      if (!eff || P.motion.reduce || typeof node.animate !== 'function') return;
      node.animate(eff.keyframes, eff.options);
    };
    const addChar = (ch) => { const s = span('text-type__char', ch); textSpan.append(s); animate(s); };
    const popChar = () => { if (textSpan.lastChild) textSpan.lastChild.remove(); };
    const setColor = () => { textSpan.style.color = o.textColors.length ? o.textColors[index % o.textColors.length] : ''; };

    function placeCursor(instant) {
      if (!cursor) return;
      const x = caret.offsetLeft, y = caret.offsetTop;
      if (lastPos && Math.abs(lastPos.x - x) < 0.5 && Math.abs(lastPos.y - y) < 0.5) return;
      const smooth = !instant && lastPos && o.cursorGlide && !P.motion.reduce && Math.abs(lastPos.y - y) <= 1;
      cursor.style.transition = smooth ? `transform ${glide}s cubic-bezier(.2,.8,.2,1), opacity .2s` : 'opacity .2s';
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      lastPos = { x, y };
      if (!instant) {
        cursor.classList.add('is-active');
        clearTimeout(cursor._t);
        cursor._t = setTimeout(() => cursor.classList.remove('is-active'), 180);
      }
    }
    const setTyping = (on) => { if (cursor && o.hideCursorWhileTyping) cursor.classList.toggle('text-type__cursor--hidden', on); };

    function wait(ms, action) {
      timer = setTimeout(() => {
        action();
        placeCursor(false);
        step();
      }, ms);
    }

    function step() {
      clearTimeout(timer);
      if (!running || !visible) return;
      const reduce = P.motion.reduce;
      const total = chars.length;
      setTyping(deleting || typo !== null || shown < total);

      if (!deleting) {
        if (typo) {
          if (reduce) return wait(0, () => { typo.tail.forEach(popChar); typo = null; });
          if (!typo.fixing) {
            if (typo.tail.length < typo.plan.length) {
              return wait(speed(), () => { const ch = typo.plan[typo.tail.length]; typo.tail.push(ch); addChar(ch); });
            }
            return wait(260 + Math.random() * 320, () => { typo.fixing = true; });
          }
          if (typo.tail.length) return wait(Math.max(45, o.deletingSpeed), () => { typo.tail.pop(); popChar(); });
          return wait(90 + Math.random() * 140, () => { typo = null; });
        }
        if (shown < total) {
          const lead = shown === 0 ? o.initialDelay : 0;
          if (reduce) return wait(lead, () => { while (shown < total) addChar(chars[shown++]); });
          const next = shown;
          const wrong = o.mistakes > 0 && shown > 0 && lastTypo !== next ? typoFor(chars[next]) : null;
          if (wrong && Math.random() < Math.min(1, o.mistakes) * 0.16) {
            lastTypo = next;
            const plan = [wrong];
            const follow = chars[next + 1];
            if (follow && follow.trim() && Math.random() < 0.4) plan.push(follow);
            return wait(lead + speed(), () => { typo = { plan, tail: [wrong], fixing: false }; addChar(wrong); });
          }
          return wait(lead + speed(), () => { addChar(chars[shown]); shown++; });
        }
        if (o.loop || index < sentences.length - 1) return wait(o.pauseDuration, () => { deleting = true; });
        setTyping(false);
        return;
      }

      if (shown > 0) {
        if (reduce) return wait(0, () => { textSpan.textContent = ''; shown = 0; });
        if (o.deleteMode === 'select') {
          if (selected < shown) {
            return wait(o.deletingSpeed, () => {
              selected++;
              const kids = textSpan.children;
              if (kids[kids.length - selected]) kids[kids.length - selected].classList.add('text-type__char--selected');
            });
          }
          return wait(Math.max(160, o.deletingSpeed * 8), () => { selected = 0; shown = 0; textSpan.textContent = ''; });
        }
        return wait(o.deletingSpeed, () => { popChar(); shown--; });
      }

      if (o.onSentenceComplete) o.onSentenceComplete(sentences[index], index);
      lastTypo = -1;
      selected = 0;
      deleting = false;
      index = (index + 1) % sentences.length;
      chars = graphemes(sentences[index]);
      setColor();
      step();
    }

    if (o.startOnVisible) {
      const io = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;
        visible = true;
        io.disconnect();
        step();
      }, { threshold: 0.1 });
      io.observe(el);
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => placeCursor(true)).observe(el);

    setColor();
    running = true;
    placeCursor(true);
    step();

    return {
      pause() { running = false; clearTimeout(timer); },
      resume() { if (!running) { running = true; step(); } },
      destroy() { running = false; clearTimeout(timer); el.textContent = ''; }
    };
  };
})();
