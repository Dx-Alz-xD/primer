/* =====================================================================
   The level check (app.html): "Not sure where to start? Take a 2-minute
   level check." The server (POST /api/placement) writes 6 questions on
   the topic, from the basics up to the end point, each tagged with the
   concept it tests. A small dialog asks them one at a time and stops at
   the first one the learner misses: that concept becomes the course's
   starting point ("Teach me from"). Missing the first keeps the very
   beginning; getting all of them right suggests the last concept.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const $ = P.$, esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  // interface sentences with {placeholders}: translated whole, then filled in
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const clean = (html) => (P.sanitizeHTML ? P.sanitizeHTML(html) : esc(html));

  const trigger = $('#b-level');
  const topicEl = $('#b-topic'), fromEl = $('#b-from'), toEl = $('#b-to');
  const topicErr = $('#b-topic-err'), resultEl = $('#b-level-result');
  if (!trigger || !topicEl || !fromEl || typeof HTMLDialogElement !== 'function') {
    if (trigger) trigger.closest('.lvl-line').hidden = true;
    return;
  }

  /* ---------- maths: KaTeX is loaded only when a question needs it ---------- */
  let katexLoading = null;
  function renderMath(el) {
    if (!/\\\(|\\\[/.test(el.textContent)) return;
    const go = () => {
      if (window.renderMathInElement) {
        window.renderMathInElement(el, { delimiters: [{ left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }], throwOnError: false });
      }
    };
    if (window.renderMathInElement) { go(); return; }
    if (!katexLoading) {
      const add = (tag, attrs) => new Promise((res, rej) => {
        const node = document.createElement(tag);
        Object.assign(node, attrs);
        node.crossOrigin = 'anonymous';
        node.onload = res; node.onerror = rej;
        document.head.appendChild(node);
      });
      const base = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';
      katexLoading = add('link', { rel: 'stylesheet', href: base + 'katex.min.css' })
        .then(() => add('script', { src: base + 'katex.min.js' }))
        .then(() => add('script', { src: base + 'contrib/auto-render.min.js' }))
        .catch(() => {});
    }
    katexLoading.then(go);
  }

  /* ---------- the dialog ---------- */
  const dlg = document.createElement('dialog');
  dlg.className = 'lvl';
  dlg.setAttribute('aria-labelledby', 'lvl-title');
  dlg.innerHTML = `
    <div class="lvl__head">
      <div>
        <p class="lvl__eyebrow">Level check</p>
        <h2 class="lvl__title ugc" id="lvl-title"></h2>
      </div>
      <button class="lvl__x" type="button" data-close aria-label="Close the level check">×</button>
    </div>
    <div class="lvl__body"></div>`;
  document.body.appendChild(dlg);
  const titleEl = dlg.querySelector('#lvl-title');
  const body = dlg.querySelector('.lvl__body');

  let run = 0;      // bumped on every start and close, so a late reply is ignored
  let state = null; // { topic, to, questions, before }

  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) dlg.close();
  });
  dlg.addEventListener('close', () => { run++; });

  trigger.addEventListener('click', () => {
    const topic = P.clean(topicEl.value, 120);
    if (!topic) {
      topicErr.textContent = t('Name a topic first, so the level check knows what to ask about.');
      topicEl.setAttribute('aria-invalid', 'true');
      topicEl.focus();
      P.shake(topicEl);
      return;
    }
    topicErr.textContent = '';
    topicEl.removeAttribute('aria-invalid');
    start(topic, P.clean(toEl.value, 80));
  });

  // the note under the range only describes the starting point the level check chose
  const hideResult = () => { resultEl.hidden = true; resultEl.textContent = ''; };
  fromEl.addEventListener('input', hideResult);
  topicEl.addEventListener('input', hideResult);

  async function start(topic, to) {
    const my = ++run;
    state = { topic, to, questions: [], before: fromEl.value };
    titleEl.textContent = topic;
    showLoading();
    if (!dlg.open) dlg.showModal();
    try {
      const d = await P.post('/api/placement', { topic, to }, {
        timeout: 130000, timeoutMessage: t('The AI took too long to write the questions. Try again.')
      });
      if (my !== run) return;
      if (!d.questions || !d.questions.length) throw new Error(t('No questions came back. Try again.'));
      state.questions = d.questions;
      showQuestion(0);
    } catch (err) {
      if (my !== run) return;
      showError(err);
    }
  }

  function showLoading() {
    body.innerHTML = `
      <div class="lvl__wait" role="status">
        <span class="lvl__dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <div>
          <p class="lvl__lead">Writing your questions</p>
          <p class="help">Free AI models usually take 10 to 40 seconds. Questions on a topic are kept, so the next level check on it is instant.</p>
        </div>
      </div>
      <div class="lvl__actions"><button class="textlink" type="button" data-close>Cancel</button></div>`;
  }

  function showError(err) {
    const refused = err && err.status === 400;
    body.innerHTML = `
      <div class="lvl__fail" role="alert">
        <p class="lvl__lead">${refused ? esc(err.message) : esc(t('The level check isn’t available right now.'))}</p>
        ${refused ? '' : `<p class="lvl__reason">${esc(err && err.message ? err.message : '')}</p>`}
        <p>You can still build your course: type where to start in “Teach me from”, or leave it empty to start from the very beginning.</p>
      </div>
      <div class="lvl__actions">
        <button class="btn btn--small" type="button" data-continue>Continue without it</button>
        ${refused ? '' : '<button class="textlink" type="button" data-retry>Try again</button>'}
      </div>`;
    body.querySelector('[data-continue]').addEventListener('click', () => { dlg.close(); fromEl.focus(); });
    const retry = body.querySelector('[data-retry]');
    if (retry) retry.addEventListener('click', () => start(state.topic, state.to));
    body.querySelector('[data-continue]').focus();
  }

  function showQuestion(i) {
    const qs = state.questions;
    const q = qs[i];
    const last = i === qs.length - 1;
    body.innerHTML = `
      <p class="lvl__pos">${esc(fill('Question {n} of {total}', { n: i + 1, total: qs.length }))}</p>
      <div class="lvl__steps" aria-hidden="true">${qs.map((_, k) => `<span class="${k < i ? 'is-done' : k === i ? 'is-current' : ''}"></span>`).join('')}</div>
      <form class="lvl__q" novalidate>
        <div class="lvl__prompt ugc" id="lvl-q-prompt" tabindex="-1">${clean(q.prompt)}</div>
        <div class="lvl__choices" role="radiogroup" aria-labelledby="lvl-q-prompt">
          ${q.choices.map((c, k) => `<label class="lvl__choice"><input type="radio" name="lvl-choice" value="${k}"><span class="ugc">${clean(c)}</span></label>`).join('')}
        </div>
        <p class="field__error" data-err></p>
        <div class="lvl__actions">
          <button class="btn btn--small" type="submit">${last ? 'See where to start' : 'Next'}</button>
          <button class="textlink" type="button" data-skip>I don’t know this yet</button>
        </div>
      </form>`;
    const form = body.querySelector('form');
    const errEl = form.querySelector('[data-err]');
    form.addEventListener('change', () => {
      form.querySelectorAll('.lvl__choice').forEach((l) => l.classList.toggle('is-checked', l.querySelector('input').checked));
      errEl.textContent = '';
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const picked = form.querySelector('input:checked');
      if (!picked) { errEl.textContent = t('Choose an answer, or say you don’t know this yet.'); return; }
      answer(i, Number(picked.value));
    });
    form.querySelector('[data-skip]').addEventListener('click', () => answer(i, null));
    renderMath(body);
    form.querySelector('#lvl-q-prompt').focus();
  }

  function answer(i, choice) {
    const qs = state.questions;
    const right = choice === qs[i].answer;
    if (right && i < qs.length - 1) { showQuestion(i + 1); return; }
    showResult(right ? -1 : i);
  }

  // "a", "a and b", "a, b and c"
  const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${t('and')} ${xs[xs.length - 1]}`);

  // missed: the index of the first question missed, or -1 when every answer was right
  function showResult(missed) {
    const qs = state.questions;
    const asked = missed < 0 ? qs : qs.slice(0, missed + 1);
    const known = asked.filter((_, k) => k !== missed).map((q) => q.concept);
    const startAt = missed < 0 ? qs[qs.length - 1].concept : missed === 0 ? '' : qs[missed].concept;
    const why = missed < 0
      ? fill('You knew everything from {first} to {last}, so the course starts at {last}.', { first: qs[0].concept, last: startAt })
      : missed === 0
        ? fill('{concept} is new to you, so the course starts at the very beginning.', { concept: P.cap(qs[0].concept) })
        : fill('You knew {known}, so the course starts at {start}.', { known: list(known), start: startAt });

    const before = state.before;
    fromEl.value = startAt;
    resultEl.textContent = why;
    resultEl.hidden = false;
    const changed = before !== startAt;

    const missedQ = missed >= 0 ? qs[missed] : null;
    body.innerHTML = `
      <p class="lvl__pos">Your starting point</p>
      <h3 class="lvl__start">${startAt ? `<span class="ugc">${esc(P.cap(startAt))}</span>` : esc(t('The very beginning'))}</h3>
      <p class="lvl__why">${esc(why)}</p>
      <ul class="lvl__list">
        ${asked.map((q, k) => k === missed
          ? `<li class="is-missed"><span class="lvl__mark" aria-hidden="true">✗</span><span><span class="ugc">${esc(q.concept)}</span><span class="sr-only"> (${esc(t('new to you'))})</span>
              <span class="lvl__answer"><span>The right answer:</span> <span class="ugc">${clean(q.choices[q.answer])}</span></span></span></li>`
          : `<li class="is-known"><span class="lvl__mark" aria-hidden="true">✓</span><span><span class="ugc">${esc(q.concept)}</span><span class="sr-only"> (${esc(t('you knew this'))})</span></span></li>`).join('')}
      </ul>
      ${missed < 0 ? '<p class="lvl__note help">You may know most of this already. You could also aim further with “Up to”.</p>' : ''}
      <p class="lvl__note help">${esc(startAt
        ? fill('“Teach me from” is now “{start}”. You can still change it.', { start: startAt })
        : t('“Teach me from” is now empty, which means the very beginning. You can still change it.'))}</p>
      <div class="lvl__actions">
        <button class="btn btn--small" type="button" data-done>Done</button>
        ${changed ? '<button class="textlink" type="button" data-undo>Undo</button>' : ''}
      </div>`;
    if (missedQ) renderMath(body);
    body.querySelector('[data-done]').addEventListener('click', () => { dlg.close(); fromEl.focus(); });
    const undo = body.querySelector('[data-undo]');
    if (undo) {
      undo.addEventListener('click', () => {
        fromEl.value = before;
        hideResult();
        dlg.close();
        fromEl.focus();
      });
    }
    body.querySelector('[data-done]').focus();
  }
})();
