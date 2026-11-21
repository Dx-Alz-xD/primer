/* =====================================================================
   The tutor, on every signed-in page: a seal in the corner that opens a
   conversation. It knows the learner's courses, recent wrong answers
   and doubts (the server adds them), and on a lesson page it also knows
   which lesson is open. It also waits for the answers to doubts asked in
   a lesson and says when one arrives.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const $ = P.$, esc = P.esc;

  /* ---------- maths: KaTeX is loaded only when a reply needs it ---------- */
  let katexLoading = null;
  function ensureMath() {
    if (window.renderMathInElement) return Promise.resolve();
    if (katexLoading) return katexLoading;
    const add = (tag, attrs) => new Promise((res, rej) => {
      const el = document.createElement(tag);
      Object.assign(el, attrs);
      el.crossOrigin = 'anonymous';
      el.onload = res; el.onerror = rej;
      document.head.appendChild(el);
    });
    const base = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';
    katexLoading = add('link', { rel: 'stylesheet', href: base + 'katex.min.css' })
      .then(() => add('script', { src: base + 'katex.min.js' }))
      .then(() => add('script', { src: base + 'contrib/auto-render.min.js' }))
      .catch(() => {});
    return katexLoading;
  }
  function renderMath(el) {
    if (!/\\\(|\\\[|\$\$/.test(el.textContent)) return;
    if (P.math) { P.math(el); return; }
    ensureMath().then(() => {
      if (window.renderMathInElement) window.renderMathInElement(el, { delimiters: [{ left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }], throwOnError: false });
    });
  }

  /* ---------- where the learner is ---------- */
  const onLesson = /lesson\.html$/.test(location.pathname);
  const here = () => {
    const course = P.params.get('course');
    if (!course) return null;
    return { courseId: course, lesson: onLesson ? Number(P.params.get('lesson')) || null : null };
  };

  /* ---------- the seal and the letter ---------- */
  const QUILL = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 4c-6 1-11 5-13 12l-2 4"/><path d="M20 4c-1 5-4 9-9 11"/><path d="M9.5 12.5L13 9"/></svg>';
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'tutor-seal';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'tutor');
  launcher.innerHTML = `${QUILL}<span>Tutor</span>`;

  const panel = document.createElement('section');
  panel.className = 'tutor';
  panel.id = 'tutor';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Your tutor');
  panel.innerHTML = `
    <header class="tutor__head">
      <div>
        <h2>Your tutor</h2>
        <p>Knows your courses, your doubts and the questions you got wrong.</p>
      </div>
      <button class="tutor__x" type="button" aria-label="Close the tutor"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </header>
    <ol class="tutor__log" aria-live="polite" aria-label="Conversation"></ol>
    <form class="tutor__form" novalidate>
      <label class="sr-only" for="tutor-input">Ask the tutor</label>
      <p class="tutor__ctx" hidden></p>
      <textarea id="tutor-input" class="tutor__input" rows="2" maxlength="1500" placeholder="Ask anything about what you’re learning"></textarea>
      <div class="tutor__row">
        <button class="textlink tutor__clear" type="button">Start over</button>
        <button class="btn btn--small" type="submit">Ask</button>
      </div>
      <p class="tutor__err" role="alert"></p>
    </form>`;
  document.body.append(launcher, panel);

  const log = $('.tutor__log', panel), form = $('.tutor__form', panel), input = $('#tutor-input', panel), err = $('.tutor__err', panel);
  const ctx = $('.tutor__ctx', panel);
  let loaded = false, busy = false;

  function bubble(m) {
    const li = document.createElement('li');
    li.className = 'tmsg tmsg--' + (m.role === 'tutor' ? 'tutor' : 'me');
    li.innerHTML = m.role === 'tutor'
      ? `<div class="tmsg__body">${P.sanitizeHTML ? P.sanitizeHTML(m.content) : esc(m.content)}</div>`
      : `<div class="tmsg__body">${esc(m.content).replace(/\n/g, '<br>')}</div>`;
    log.appendChild(li);
    if (m.role === 'tutor') renderMath(li);
    return li;
  }
  function emptyState() {
    log.innerHTML = `<li class="tutor__empty">
        <p>Ask about anything you’re learning. For example:</p>
        <ul>${['Why do we take a limit instead of plugging in h = 0?', 'What have I been getting wrong lately?', 'Give me one more practice question on this lesson.']
          .map((s) => `<li><button type="button" class="tutor__eg">${esc(s)}</button></li>`).join('')}</ul>
      </li>`;
    log.querySelectorAll('.tutor__eg').forEach((b) => b.addEventListener('click', () => { input.value = b.textContent; input.focus(); }));
  }
  const scrollEnd = () => { log.scrollTop = log.scrollHeight; };

  async function load() {
    if (loaded) return;
    loaded = true;
    log.innerHTML = '<li class="tutor__empty"><p>Opening your conversation…</p></li>';
    try {
      const d = await P.get('/api/tutor');
      log.innerHTML = '';
      if (!d.ai) {
        log.innerHTML = '<li class="tutor__empty"><p>The tutor needs an AI key on the server. Add OPENROUTER_API_KEY to .env and restart Primer.</p></li>';
        form.hidden = true;
        return;
      }
      if (!d.messages.length) emptyState(); else d.messages.forEach(bubble);
      scrollEnd();
    } catch (e) {
      loaded = false;
      log.innerHTML = `<li class="tutor__empty"><p>${esc(e.message)}</p></li>`;
    }
  }

  function setOpen(on) {
    panel.hidden = !on;
    launcher.setAttribute('aria-expanded', String(on));
    document.body.classList.toggle('tutor-open', on);
    if (on) {
      const h = here();
      const c = h && P.courses && P.courses.get(h.courseId);
      ctx.hidden = !c;
      if (c) ctx.textContent = h.lesson ? `Asking about lesson ${h.lesson} of “${c.title}”` : `Asking about “${c.title}”`;
      load().then(scrollEnd);
      setTimeout(() => input.focus({ preventScroll: true }), 30);
    } else {
      launcher.focus({ preventScroll: true });
    }
  }
  launcher.addEventListener('click', () => setOpen(panel.hidden));
  $('.tutor__x', panel).addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message || busy) return;
    busy = true;
    err.textContent = '';
    const empty = log.querySelector('.tutor__empty');
    if (empty) empty.remove();
    bubble({ role: 'learner', content: message });
    input.value = '';
    const thinking = document.createElement('li');
    thinking.className = 'tmsg tmsg--tutor is-thinking';
    thinking.innerHTML = '<div class="tmsg__body"><span class="quill" aria-hidden="true"><i></i><i></i><i></i></span> Writing an answer…</div>';
    log.appendChild(thinking);
    scrollEnd();
    try {
      const d = await P.post('/api/tutor', Object.assign({ message }, here() || {}), { timeout: 130000, timeoutMessage: 'The tutor took too long to answer. Try again.' });
      thinking.remove();
      bubble(d.reply);
    } catch (e2) {
      thinking.remove();
      err.textContent = e2.message;
      input.value = message;
    } finally {
      busy = false;
      scrollEnd();
    }
  });

  $('.tutor__clear', panel).addEventListener('click', async () => {
    if (!window.confirm('Start a new conversation? The tutor still remembers your wrong answers and doubts.')) return;
    try { await P.del('/api/tutor'); emptyState(); } catch (e) { err.textContent = e.message; }
  });

  /* ---------- answers to doubts asked in a lesson ---------- */
  P.onDoubtAsked = (doubt, { refresh }) => {
    if (!P.boot.ai || !doubt || !doubt.courseId) return;
    let tries = 0;
    const poll = async () => {
      tries++;
      try {
        const list = await P.api.loadDoubts(doubt.courseId, doubt.lesson);
        refresh();
        const mine = list.find((x) => x.id === doubt.id);
        if (mine && mine.answer) { P.toast('The tutor answered your doubt. Open Doubts to read it.'); return; }
      } catch (e) { /* try again */ }
      if (tries < 30) setTimeout(poll, 4000);
    };
    setTimeout(poll, 5000);
  };
})();
