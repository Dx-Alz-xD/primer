/* =====================================================================
   Marking answers written in your own words (lesson.html).
   A subjective checkpoint answer is saved with the lesson's progress and
   opens the next part at once. Then the server marks it with the AI
   (POST /api/answers/mark) and the verdict, a sentence or two of feedback
   and the key points that were missing appear under the answer, beside
   the model answer. Marks are kept on the server, so they come back when
   the lesson is opened again (GET /api/answers/marks).
   If the AI can't be reached the answer stays saved, with a way to try
   again later. Sample courses (whose lessons live in the browser) aren't
   marked.

   P.marking.show({ course, n, q, w, value, fresh })
     w is the question's form; fresh means it was just submitted.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const esc = P.esc;
  // the lesson body isn't translated by the page-wide dictionary, so interface text goes through P.t here
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));

  const VERDICTS = {
    good: { label: 'Good answer.', cls: 'good' },
    partly: { label: 'Partly there.', cls: 'partly' },
    'not yet': { label: 'Not yet.', cls: 'notyet' }
  };
  const markable = (course) => Boolean(course && (course.source === 'ai' || course.source === 'library'));

  // One request per lesson for the marks already given.
  const known = new Map(); // "courseId|n" -> Promise<{ qid: mark }>
  function marksFor(courseId, n) {
    const key = `${courseId}|${n}`;
    if (!known.has(key)) {
      known.set(key, P.get(`/api/answers/marks?course=${encodeURIComponent(courseId)}&lesson=${n}`)
        .then((d) => d.marks || {})
        .catch(() => { known.delete(key); return {}; }));
    }
    return known.get(key);
  }

  function slot(w) {
    let el = w.querySelector('.qmark');
    if (!el) {
      el = document.createElement('div');
      el.className = 'qmark';
      el.setAttribute('aria-live', 'polite');
      (w.querySelector('.q__revise') || w.querySelector('.q__feedback')).after(el);
    }
    return el;
  }

  const modelBox = (w) => w.querySelector('details.model');

  function paint(ctx, state, data) {
    const el = slot(ctx.w);
    el.className = 'qmark is-' + state;
    if (state === 'pending') {
      el.innerHTML = `<p class="qmark__wait"><span class="qmark__dots" aria-hidden="true"><i></i><i></i><i></i></span>${esc(t('Marking your answer…'))}</p>`;
    } else if (state === 'marked') {
      const v = VERDICTS[data.verdict] || VERDICTS.partly;
      const missing = (data.missing || []).filter(Boolean);
      el.classList.add('is-' + v.cls);
      el.innerHTML = `
        <p class="qmark__verdict"><strong>${esc(t(v.label))}</strong></p>
        <div class="qmark__feedback">${P.sanitizeHTML(data.feedback)}</div>
        ${missing.length ? `<p class="qmark__missing-title">${esc(t('What was missing:'))}</p><ul class="qmark__missing">${missing.map((m) => `<li>${P.sanitizeHTML(m)}</li>`).join('')}</ul>` : ''}
        ${data.model ? `<p class="qmark__by">${esc(fill('Marked by {model}. AI marking can be wrong.', { model: data.model.replace(/:free$/, '') }))}</p>` : ''}`;
      const d = modelBox(ctx.w);
      if (d && data.verdict !== 'good') d.open = true; // the model answer is the quickest way to see what to add
    } else if (state === 'support') {
      el.innerHTML = `<div class="qmark__support">${P.sanitizeHTML(data.html)}</div>
        <button class="textlink" type="button" data-mark>${esc(t('Try marking it again'))}</button>`;
    } else if (state === 'failed' || state === 'unmarked') {
      el.innerHTML = `
        <p class="qmark__fail">${esc(t(state === 'failed' ? 'Couldn’t mark this right now.' : 'This answer hasn’t been marked yet.'))}</p>
        ${data && data.error ? `<p class="qmark__why">${esc(data.error)}</p>` : ''}
        <button class="textlink" type="button" data-mark>${esc(t(state === 'failed' ? 'Try again' : 'Mark my answer'))}</button>`;
    } else if (state === 'sample') {
      el.innerHTML = `<p class="qmark__note">${esc(t('Answers in sample courses aren’t marked. Compare yours with the model answer.'))}</p>`;
    }
    const again = el.querySelector('[data-mark]');
    if (again) again.addEventListener('click', () => mark(ctx));
    if (P.math) P.math(el);
  }

  async function mark(ctx) {
    paint(ctx, 'pending');
    try {
      const d = await P.post('/api/answers/mark', { courseId: ctx.course.id, n: ctx.n, qid: ctx.q.id, answer: ctx.value }, {
        timeout: 120000, timeoutMessage: t('Marking took too long.')
      });
      const m = d.mark || {};
      paint(ctx, m.status === 'support' ? 'support' : 'marked', m);
    } catch (err) {
      if (err.status === 401) return;
      paint(ctx, 'failed', { error: err.message });
    }
  }

  P.marking = {
    show(ctx) {
      if (!ctx || !ctx.w || !ctx.q || ctx.q.type !== 'subjective') return;
      if (!markable(ctx.course)) {
        if (ctx.q.model) paint(ctx, 'sample');
        return;
      }
      if (!ctx.value) return;
      if (ctx.fresh) { mark(ctx); return; }
      marksFor(ctx.course.id, ctx.n).then((marks) => {
        const m = marks[ctx.q.id];
        if (m && m.status === 'marked') paint(ctx, 'marked', m);
        else paint(ctx, m && m.status === 'failed' ? 'failed' : 'unmarked');
      });
    }
  };
})();
