/* =====================================================================
   Interactive parts of lessons ("widgets"), the browser half of
   server/widgets.mjs: a chess board, a circuit, a graph with sliders, a
   piano or drums, cards to put in order, match or sort. Each kind lives in assets/js/widgets/<kind>.js (with
   assets/css/widgets/<kind>.css) and is fetched the first time a page
   needs it, so pages without one load nothing extra; once fetched it is
   kept by the offline app like any other file under /assets/.

   A kind registers itself:

     P.widgets.register('chess', {
       // shows it: animated, and usually playable ("try it yourself")
       block(host, spec, ctx) -> handle            handle.destroy()
       // a task question: the learner does something
       task(host, spec, goal, ctx) -> handle
           handle.value()    what the learner has done (null: nothing yet);
                             plain JSON, as it is saved with their progress
           handle.reset()    back to the start, for another try
           handle.reveal()   show the right answer done (after three tries)
           handle.lock(on)   stop or allow input
           handle.destroy()
       check(goal, value, spec) -> { correct, invalid?, note? }
           invalid: not a real attempt yet (asks again, counts nothing);
           note: a short line shown with the result, already translated
       describe(value, spec) -> 'Nf3'      the learner's attempt, in words
       answer(goal, spec)    -> 'Nf3'      the right answer, in words
       still(spec, goal?)    -> '<svg …>'  a still picture: book, print, EPUB
     });

   ctx: { t (translate), fill(s, vals), esc, lang (the lesson's language),
          reduce (reduced motion), onChange(value) (tasks: the learner did
          something) }

   Everything in a spec or goal is untrusted data (from the AI, or from
   a course file): a kind checks it again and builds its markup with text
   nodes or P.esc, never by putting spec strings into innerHTML.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const KINDS = ['chess', 'circuit', 'graph', 'music', 'arrange', 'chem'];
  const impls = {};
  const loading = {};
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, v) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in (v || {}) ? v[k] : m));

  function load(kind) {
    if (impls[kind]) return Promise.resolve(impls[kind]);
    if (!KINDS.includes(kind)) return Promise.reject(new Error('unknown widget ' + kind));
    if (loading[kind]) return loading[kind];
    loading[kind] = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[data-widget="${kind}"]`)) {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = `/assets/css/widgets/${kind}.css`;
        l.dataset.widget = kind;
        document.head.appendChild(l);
      }
      const s = document.createElement('script');
      s.src = `/assets/js/widgets/${kind}.js`;
      s.async = true;
      s.dataset.widget = kind;
      // a kind may load a helper file before it registers (it sets document.currentScript.ready), or
      // register at once and say when its helper has arrived (impl.ready); either way, wait for it
      s.onload = () => Promise.resolve(s.ready)
        .then(() => (impls[kind] ? impls[kind].ready : Promise.reject(new Error(kind + ' did not register'))))
        .then(() => resolve(impls[kind]), reject);
      s.onerror = () => { delete loading[kind]; reject(new Error(kind + ' could not be loaded')); };
      document.head.appendChild(s);
    });
    return loading[kind];
  }

  const ctxFor = (extra) => Object.assign({
    t, fill, esc: P.esc, lang: P.lang || 'en',
    reduce: Boolean(P.motion && P.motion.reduce),
    onChange: () => {}
  }, extra || {});

  function failed(host, err) {
    host.classList.remove('is-loading');
    host.classList.add('is-failed');
    host.textContent = t('This interactive part couldn’t be shown here.');
    if (err) console.warn('[Primer] widget:', err.message || err);
  }

  P.widgets = {
    kinds: KINDS,
    register(kind, impl) { if (KINDS.includes(kind) && impl && typeof impl.block === 'function') impls[kind] = impl; },
    has: (kind) => Boolean(impls[kind]),
    load,
    preload: (kinds) => Promise.all([...new Set(kinds || [])].map((k) => load(k).catch(() => null))),

    // the kinds a lesson uses (to fetch them early, or to keep them for offline)
    used(lesson) {
      const out = new Set();
      ((lesson && lesson.sections) || []).forEach((s) => {
        (s.blocks || []).forEach((b) => { if (b && b.t === 'widget' && KINDS.includes(b.kind)) out.add(b.kind); });
        (s.checkpoint || []).forEach((q) => { if (q && q.type === 'task' && KINDS.includes(q.kind)) out.add(q.kind); });
      });
      return [...out];
    },
    files: (kinds) => (kinds || []).flatMap((k) => [`/assets/js/widgets/${k}.js`, `/assets/css/widgets/${k}.css`]),

    // a block among a lesson's content
    mountBlock(host, block, extra) {
      host.classList.add('wdg', 'wdg--' + block.kind, 'is-loading');
      host.setAttribute('aria-busy', 'true');
      return load(block.kind).then((impl) => {
        host.classList.remove('is-loading');
        host.removeAttribute('aria-busy');
        try { return impl.block(host, block.spec, ctxFor(extra)) || null; } catch (err) { failed(host, err); return null; }
      }).catch((err) => { failed(host, err); return null; });
    },

    // a task question; the handle's value() is what gets checked
    mountTask(host, q, extra) {
      host.classList.add('wdg', 'wdg--' + q.kind, 'wdg--task', 'is-loading');
      host.setAttribute('aria-busy', 'true');
      return load(q.kind).then((impl) => {
        host.classList.remove('is-loading');
        host.removeAttribute('aria-busy');
        try { return impl.task(host, q.spec, q.goal, ctxFor(extra)) || null; } catch (err) { failed(host, err); return null; }
      }).catch((err) => { failed(host, err); return null; });
    },

    check(q, value) {
      const impl = impls[q.kind];
      if (!impl || value == null) return { correct: false, invalid: true };
      try { return impl.check(q.goal, value, q.spec) || { correct: false }; } catch (err) { return { correct: false, invalid: true }; }
    },
    describe(q, value) {
      const impl = impls[q.kind];
      try { return impl && impl.describe ? String(impl.describe(value, q.spec) || '') : ''; } catch (err) { return ''; }
    },
    answer(q) {
      const impl = impls[q.kind];
      try { return impl && impl.answer ? String(impl.answer(q.goal, q.spec) || '') : ''; } catch (err) { return ''; }
    },
    // a still picture (the book, print, EPUB): its kind must be loaded first (preload); '' if it can't be drawn
    stillNow(kind, spec, goal) {
      const impl = impls[kind];
      try { return impl && impl.still ? String(impl.still(spec, goal) || '') : ''; } catch (err) { return ''; }
    }
  };
})();
