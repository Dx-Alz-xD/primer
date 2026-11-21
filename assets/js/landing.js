/* Landing page: topic box with TextType hints, chips, reading room. */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, $$ = P.$$;

  const signedIn = !!P.auth.current();
  $$('[data-when="guest"]').forEach((el) => { el.hidden = signedIn; });
  $$('[data-when="user"]').forEach((el) => { el.hidden = !signedIn; });

  const SURPRISE = [
    'The history of the printing press', 'How vaccines train the immune system', 'Beginner chess openings',
    'The basics of music theory', 'Roman architecture', 'How neural networks learn', 'Bookbinding by hand',
    'The French Revolution', 'Mushroom identification', 'How the stock market works', 'Latin for beginners',
    'The physics of rainbows', "Shakespeare's sonnets", 'The science of sourdough', 'Map projections'
  ];

  // Building lives behind sign-in; app.html bounces guests to auth and back.
  const go = (topic) => {
    const t = P.clean(topic);
    if (!t) return false;
    location.href = 'app.html?topic=' + encodeURIComponent(t);
    return true;
  };

  /* ---------- topic box ---------- */
  const form = $('#ask');
  const input = $('#topic');
  const field = $('#ask-field');
  const typeEl = $('#ask-type');

  const hints = P.TextType(typeEl, {
    text: [
      'How black holes work',
      'Calculus, from limits to the chain rule',
      'Stoicism, explained like I’m five',
      'Organic chemistry, with mnemonics',
      'Personal finance for a first job'
    ],
    typingSpeed: 55,
    variableSpeed: { min: 35, max: 85 },
    pauseDuration: 1700,
    deletingSpeed: 28,
    deleteMode: 'select',
    typeEffect: 'fade',
    mistakes: 0.2,
    cursorStyle: 'bar',
    cursorGlide: true,
    showCursor: true,
    prefix: 'Try: '
  });
  if (hints) input.placeholder = '';

  const syncHints = () => {
    const quiet = document.activeElement === input || input.value.length > 0;
    field.classList.toggle('is-quiet', quiet);
    if (!hints) return;
    if (quiet) hints.pause(); else hints.resume();
  };
  input.addEventListener('focus', syncHints);
  input.addEventListener('blur', syncHints);
  input.addEventListener('input', syncHints);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!go(input.value)) {
      P.shake(input);
      input.focus();
    }
  });

  let lastSurprise = '';
  $$('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (chip.hasAttribute('data-surprise')) {
        let t;
        do { t = P.pick(SURPRISE); } while (t === lastSurprise);
        lastSurprise = t;
        go(t);
      } else {
        go(chip.dataset.topic);
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    input.focus();
  });

  /* ---------- reading room ---------- */
  P.initWall($('#wall'), {
    words: ['Astronomy', 'Latin', 'Chess', 'Botany', 'Philosophy', 'Typography', 'Cartography', 'Poetry'],
    onPick: go,
    shuffleButton: $('#wall-shuffle')
  });
})();
