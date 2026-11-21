/* =====================================================================
   Review today (review.html, or review.html?course=<id> for one course)

   The checkpoint questions a learner got wrong come back here: the day
   after the mistake, then 3 days after a right answer, and two right
   answers in a row fix the mistake for good (server/review.mjs keeps
   the schedule). One question at a time, in the lesson's checkpoint
   style, checked here with P.api.checkAnswer; the result goes to the
   server. When nothing is due, the questions coming up can be practised
   early (that counts the same way).
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  if (!P.auth.current()) return;
  P.mountUserNav();

  const root = $('#rv-root');
  const courseFilter = P.params.get('course');
  const DAY = 86400000;
  const REVIEWABLE = new Set(['choice', 'numeric', 'text', 'task']); // task: done in an interactive part (widgets.js)
  const UPCOMING_SHOWN = 5;
  const smooth = () => (P.motion.reduce ? 'auto' : 'smooth');
  const CHECK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M8 12.4l2.7 2.7L16.2 9.6"/></svg>';

  /* ---------- maths (KaTeX auto-render, as in the lesson) ---------- */
  const MATH_OPTS = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false }
    ],
    throwOnError: false
  };
  const mathQueue = new Set();
  const math = (el) => {
    if (!el) return;
    if (window.renderMathInElement) {
      try { window.renderMathInElement(el, MATH_OPTS); } catch (e) { console.warn('[Primer] maths', e); }
    } else {
      mathQueue.add(el);
    }
  };
  window.addEventListener('load', () => {
    if (window.renderMathInElement) mathQueue.forEach((el) => { if (el.isConnected) math(el); });
    mathQueue.clear();
  });

  /* ---------- loading ---------- */
  let data = null;
  load();

  async function fetchReview() {
    const d = await P.get('/api/review' + (courseFilter ? '?course=' + encodeURIComponent(courseFilter) : ''));
    await prepare(d);
    document.dispatchEvent(new CustomEvent('primer:review', { detail: d })); // interleaving can reorder d.due (study-methods.js)
    if (P.review) P.review.setDue(d.dueAll);
    return d;
  }

  async function load() {
    try {
      data = await fetchReview();
      overview();
    } catch (err) {
      root.innerHTML = `<div class="lmsg card card--solid"><h1>Your review didn’t load</h1><p>${esc(err.message)}</p>
        <div class="rv-actions rv-actions--center"><button class="btn" type="button" data-retry>Try again</button>${courseFilter ? '<a class="textlink" href="review.html">Review every course</a>' : ''}<a class="textlink" href="app.html#library">Your courses</a></div></div>`;
      root.querySelector('[data-retry]').addEventListener('click', () => { root.innerHTML = loadingHTML(); load(); });
    }
  }
  const loadingHTML = () => '<section class="paper rv-paper"><p class="rv-loading" role="status">Gathering your questions…</p></section>';

  // Every question is made ready to ask: sample lessons are built here (they live in the
  // browser), a translated lesson is used if the learner reads this course translated,
  // and AI-written HTML is cleaned, as it is every time a lesson is shown.
  async function prepare(d) {
    const all = d.due.concat(d.upcoming);
    if (all.some((it) => it.builtIn)) {
      try { await P.courses.load(); } catch (e) { /* those questions are skipped below */ }
    }
    const ready = (it) => {
      let question = it.question, section = it.section;
      if (it.builtIn) {
        const course = P.courses.get(it.course.id);
        const lesson = course && P.courseGen.lesson(course, it.lesson);
        const f = lesson && findQuestion(lesson, it.qid);
        if (!f) return false;
        question = f.q;
        section = f.section.title;
      } else if (it.translated && P.api.wantsTranslation(it.course)) {
        question = it.translated.question;
        section = it.translated.section || section;
      }
      it.q = cleanQuestion(question);
      it.sectionTitle = section || '';
      return Boolean(it.q);
    };
    const before = { due: d.due.length, upcoming: d.upcoming.length };
    d.due = d.due.filter(ready);
    d.upcoming = d.upcoming.filter(ready);
    d.counts.due -= before.due - d.due.length;
    d.counts.upcoming -= before.upcoming - d.upcoming.length;
  }

  function findQuestion(lesson, qid) {
    for (const s of lesson.sections || []) {
      const q = (s.checkpoint || []).find((x) => x && x.id === qid);
      if (q) return { q, section: s };
    }
    return null;
  }

  function cleanQuestion(q) {
    if (!q || !REVIEWABLE.has(q.type)) return null;
    const h = P.sanitizeHTML;
    const out = { id: q.id, type: q.type, prompt: h(q.prompt), explain: q.explain ? h(q.explain) : '' };
    if (q.type === 'choice') {
      const a = Number(q.answer);
      if (!Array.isArray(q.choices) || q.choices.length < 2 || !Number.isInteger(a) || a < 0 || a >= q.choices.length) return null;
      out.choices = q.choices.map(h);
      out.answer = a;
    } else if (q.type === 'numeric') {
      const a = Number(q.answer);
      if (!Number.isFinite(a)) return null;
      out.answer = a;
      if (q.tolerance != null && Number.isFinite(Number(q.tolerance))) out.tolerance = Number(q.tolerance);
      if (q.unit) out.unit = String(q.unit);
    } else if (q.type === 'task') {
      // the board, circuit, graph or keyboard and what counts as right: plain data, checked again by its kind
      if (!P.widgets || !P.widgets.kinds.includes(q.kind) || !q.spec || typeof q.spec !== 'object' || !q.goal || typeof q.goal !== 'object') return null;
      out.kind = q.kind;
      out.spec = q.spec;
      out.goal = q.goal;
    } else {
      if (!Array.isArray(q.accept) || !q.accept.length) return null;
      out.accept = q.accept.map(String);
    }
    return out;
  }

  /* ---------- words ---------- */
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function whenLabel(t) {
    if (t == null) return '';
    if (t <= Date.now()) return 'Due now';
    const days = Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY);
    if (days <= 0) return 'Later today';
    if (days === 1) return 'Tomorrow';
    return `In ${days} days`;
  }
  // after an answer: how long until the question comes back (the server's interval, in whole days)
  function backIn(t) {
    const days = Math.max(1, Math.round((t - Date.now()) / DAY));
    return days === 1 ? 'It comes back tomorrow.' : `It comes back in ${days} days.`;
  }
  const lessonHref = (it) => `lesson.html?course=${encodeURIComponent(it.course.id)}&lesson=${it.lesson}`;
  const fromLine = (it) => `<span>Lesson ${it.lesson}: ${esc(it.lessonTitle)}</span> <span class="rv-from__course" data-no-i18n>${esc(it.course.title)}</span>`;
  const answerHTML = (q) => {
    if (q.type === 'choice') return q.choices[q.answer];
    if (q.type === 'numeric') return esc(`${q.answer}${q.unit ? ' ' + q.unit : ''}`);
    if (q.type === 'task') return esc(P.widgets ? P.widgets.answer(q) : '');
    return esc(q.accept[0]);
  };

  /* ------------------------------------------------------------------
     The overview: what's due, what's coming up, and how it's going
  ------------------------------------------------------------------ */
  function headHTML(sub) {
    const c = data.course;
    return `<header class="rv-head">
        <h1 id="rv-title" tabindex="-1">Review today</h1>
        <p class="rv-head__sub">${sub || 'Questions you got wrong come back here until you’ve really learned them.'}</p>
        ${c ? `<p class="rv-head__filter"><span>Only questions from</span> <span class="rv-head__course" data-no-i18n>${esc(c.title)}</span> <a class="textlink" href="review.html">Review every course</a></p>` : ''}
      </header>`;
  }

  function overview(focus) {
    const c = data.counts;
    let now;
    if (c.due > 0) {
      now = `<p class="rv-kicker" id="rv-now">Due today</p>
        <p class="rv-count"><span class="rv-count__n">${c.due}</span> <span class="rv-count__label">${c.due === 1 ? 'question to review' : 'questions to review'}</span></p>
        <p class="rv-lead">Each one is a question you got wrong. Answer it right twice in a row and it’s fixed.</p>
        <div class="rv-actions"><button class="btn" type="button" data-start="due">Start review</button></div>
        ${c.upcoming ? `<h2 class="rv-sub">Coming up</h2>${upcomingHTML()}` : ''}`;
    } else if (c.upcoming > 0) {
      const one = c.upcoming === 1;
      now = `<p class="rv-kicker" id="rv-now">Nothing due today</p>
        <p class="rv-lead">${one ? 'A question you get wrong comes back the next day, so this one isn’t due yet.' : 'A question you get wrong comes back the next day, so these aren’t due yet.'}</p>
        <h2 class="rv-sub">Coming up</h2>
        ${upcomingHTML()}
        <div class="rv-actions"><button class="btn" type="button" data-start="practice">${one ? 'Practise it now anyway' : 'Practise them now anyway'}</button></div>
        <p class="rv-note">Practice counts like a review: a right answer moves a question on, a wrong one brings it back tomorrow.</p>`;
    } else if (c.total > 0) {
      now = `<p class="rv-kicker" id="rv-now">Every mistake is fixed</p>
        <p class="rv-lead">You’ve answered every question you once got wrong right twice in a row. New mistakes will show up here the day after you make them.</p>
        <div class="rv-actions"><a class="btn" href="${data.course ? `app.html?course=${encodeURIComponent(data.course.id)}` : 'app.html#library'}">${data.course ? 'Back to the course' : 'Go to your courses'}</a></div>`;
    } else {
      now = `<p class="rv-kicker" id="rv-now">Nothing to review yet</p>
        <p class="rv-lead">When you get a checkpoint question wrong in a lesson, it comes back here the next day, and keeps coming back until you’ve answered it right twice in a row.</p>
        <div class="rv-actions"><a class="btn" href="${data.course ? `app.html?course=${encodeURIComponent(data.course.id)}` : 'app.html#library'}">${data.course ? 'Back to the course' : 'Go to your courses'}</a></div>`;
    }

    root.innerHTML = `${headHTML()}
      <section class="paper rv-paper" aria-labelledby="rv-now">${now}</section>
      ${statsHTML()}`;
    math(root);
    $$('[data-start]', root).forEach((b) => b.addEventListener('click', () => start(b.dataset.start)));
    if (focus) $('#rv-title').focus({ preventScroll: true });
  }

  function upcomingHTML() {
    const list = data.upcoming.slice(0, UPCOMING_SHOWN);
    const more = data.counts.upcoming - list.length;
    return `<ul class="rv-up">${list.map((it) => `<li class="rv-up__item">
        <div class="rv-up__q" data-no-i18n>${it.q.prompt}</div>
        <p class="rv-up__meta"><span class="rv-up__when">${whenLabel(it.dueAt)}</span> <span aria-hidden="true">·</span> ${fromLine(it)}</p>
      </li>`).join('')}</ul>
      ${more > 0 ? `<p class="rv-up__more">And ${more} more.</p>` : ''}`;
  }

  function statsHTML() {
    const t = data.stats.total, c = data.counts;
    const how = `<details class="rv-how">
        <summary>How review works</summary>
        <ul>
          <li>A question you get wrong in a lesson comes back the next day.</li>
          <li>Answer it right and it comes back in 3 days.</li>
          <li>Answer it right twice in a row and the mistake is fixed: it stops coming back.</li>
          <li>Answer it wrong and it starts again from the next day.</li>
          <li>Written answers aren’t reviewed, only questions with one right answer.</li>
        </ul>
      </details>`;
    if (!t.made) return `<section class="rv-stats card card--solid" aria-labelledby="rv-stats-title"><h2 id="rv-stats-title">Your progress</h2>${how}</section>`;
    const pct = Math.round((t.fixed / t.made) * 100);
    const rows = data.course ? [] : data.stats.courses;
    return `<section class="rv-stats card card--solid" aria-labelledby="rv-stats-title">
        <h2 id="rv-stats-title">Your progress</h2>
        <p class="rv-outcome">You’ve fixed ${t.fixed} of ${t.made} ${t.made === 1 ? 'mistake' : 'mistakes'}.</p>
        <div class="rv-bar" role="progressbar" aria-label="Mistakes fixed" aria-valuemin="0" aria-valuemax="${t.made}" aria-valuenow="${t.fixed}"><span style="width:${pct}%"></span></div>
        <ul class="rv-boxes">
          <li class="rv-box rv-box--wrong"><span class="rv-box__n">${c.wrongLast}</span><span class="rv-box__label">Wrong last time</span><span class="rv-box__sub">back the next day</span></li>
          <li class="rv-box rv-box--once"><span class="rv-box__n">${c.rightOnce}</span><span class="rv-box__label">Right once</span><span class="rv-box__sub">one more to fix it</span></li>
          <li class="rv-box rv-box--fixed"><span class="rv-box__n">${t.fixed}</span><span class="rv-box__label">Fixed</span><span class="rv-box__sub">won’t come back</span></li>
        </ul>
        ${rows.length ? `<table class="rv-table">
          <caption class="sr-only">Mistakes by course</caption>
          <thead><tr><th scope="col">Course</th><th scope="col">Mistakes</th><th scope="col">Fixed</th><th scope="col">Still learning</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <th scope="row"><a href="review.html?course=${encodeURIComponent(r.id)}" data-no-i18n>${esc(r.title)}</a></th>
            <td>${r.made}</td><td>${r.fixed}</td><td>${r.learning}</td></tr>`).join('')}</tbody>
        </table>` : ''}
        ${how}
      </section>`;
  }

  /* ------------------------------------------------------------------
     A session: one question at a time
  ------------------------------------------------------------------ */
  function start(mode) {
    const list = (mode === 'practice' ? data.upcoming : data.due).slice();
    if (!list.length) return;
    const sess = { mode, list, i: 0, results: [] };
    ask(sess);
  }

  function segsHTML(sess) {
    return sess.list.map((it, k) => {
      const r = sess.results[k];
      const cls = r ? (r.right ? ' is-right' : ' is-wrong') : k === sess.i ? ' is-current' : '';
      return `<span class="seg${cls}"></span>`;
    }).join('');
  }

  function ask(sess) {
    const it = sess.list[sess.i];
    const q = it.q;
    const last = sess.i === sess.list.length - 1;
    const order = q.type === 'choice' ? P.shuffle(q.choices.map((_, k) => k)) : null; // a new order each time, so the place isn't what's remembered
    const pid = 'rv-prompt';
    let field;
    if (q.type === 'choice') {
      field = `<div class="q__choices" role="radiogroup" aria-labelledby="${pid}">` +
        order.map((ci) => `<label class="q__choice"><input type="radio" name="rv-choice" value="${ci}"><span data-no-i18n>${q.choices[ci]}</span></label>`).join('') +
        '</div>';
    } else if (q.type === 'task') {
      field = `<div class="q__task" data-task-host role="group" aria-labelledby="${pid}"></div>`;
    } else {
      field = `<div class="q__row"><input class="q__input" type="text" inputmode="${q.type === 'numeric' ? 'decimal' : 'text'}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-labelledby="${pid}" placeholder="${q.type === 'numeric' ? 'Your answer' : 'Type your answer'}">${q.unit ? `<span class="q__unit">${esc(q.unit)}</span>` : ''}</div>`;
    }

    root.innerHTML = `${headHTML(sess.mode === 'practice' ? 'Practising early. Answers count the same as on the day they’re due.' : 'One question at a time. Each one is a question you got wrong before.')}
      <section class="paper rv-paper rv-sess" aria-labelledby="rv-pos">
        <div class="rv-top">
          <p class="rv-pos" id="rv-pos" tabindex="-1">Question ${sess.i + 1} of ${sess.list.length}</p>
          <div class="rv-segs" aria-hidden="true">${segsHTML(sess)}</div>
        </div>
        <p class="rv-from">${fromLine(it)}</p>
        <div class="checkpoint rv-card">
          <p class="checkpoint__title">${CHECK_SVG}Check your understanding</p>
          <p class="checkpoint__sub">${it.streak > 0 ? 'You got this right last time. One more right answer and it’s fixed.' : 'You got this one wrong before.'}</p>
          <form class="q rv-q" novalidate>
            <div class="q__prompt" id="${pid}" data-no-i18n>${q.prompt}</div>
            ${field}
            <div class="q__actions"><button class="btn btn--small q__check" type="submit">Check</button></div>
            <div class="q__feedback" role="status" aria-live="polite"></div>
          </form>
        </div>
        <div class="rv-next" hidden>
          <button class="btn" type="button" data-next>${last ? 'See how you did' : 'Next question'}</button>
        </div>
        <p class="rv-stop"><button class="textlink" type="button" data-stop>Stop for now</button></p>
      </section>`;

    const form = $('.rv-q', root);
    const feedback = $('.q__feedback', form);
    const setFeedback = (kind, html) => {
      feedback.className = 'q__feedback' + (kind ? ` is-${kind}` : '');
      feedback.innerHTML = html;
      math(feedback);
    };
    let answered = false;
    // a task's interactive part, drawn by its kind once it has loaded
    let task = null;
    const taskHost = $('[data-task-host]', form);
    if (taskHost && P.widgets) P.widgets.mountTask(taskHost, q, { onChange: () => { if (!answered) setFeedback('', ''); } }).then((h) => { task = h; });

    form.addEventListener('change', (e) => {
      if (e.target.type === 'radio') $$('.q__choice', form).forEach((l) => l.classList.toggle('is-checked', l.querySelector('input').checked));
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); check(); });
    $('[data-next]', root).addEventListener('click', () => {
      sess.i++;
      if (sess.i < sess.list.length) ask(sess); else finish(sess);
    });
    $('[data-stop]', root).addEventListener('click', () => finish(sess));

    math($('.rv-sess', root));
    if (sess.i > 0) $('.rv-sess', root).scrollIntoView({ behavior: smooth(), block: 'start' });
    const first = $('.q__input', form) || $('input[type="radio"]', form);
    if (sess.i > 0 && first) first.focus({ preventScroll: true });

    async function check() {
      if (answered) return;
      const raw = q.type === 'choice'
        ? (($('input[type="radio"]:checked', form) || {}).value || '')
        : q.type === 'task' ? (task ? task.value() : null)
          : $('.q__input', form).value.trim();
      if (raw == null || raw === '') { setFeedback('warn', q.type === 'choice' ? 'Choose an answer first.' : q.type === 'task' ? 'Try it first, then press Check.' : 'Enter an answer first.'); return; }
      const res = P.api.checkAnswer(q, raw);
      if (res.invalid) { setFeedback('warn', q.type === 'task' ? esc(res.note || 'Try it first, then press Check.') : 'Enter a number, like 7, 2.5 or 3/4.'); return; }

      answered = true;
      const right = res.correct;
      if (P.sfx) P.sfx.play(right ? 'correct' : 'wrong');
      form.classList.add('is-locked', right ? 'is-correct' : 'is-wrong');
      $$('input, .q__check', form).forEach((el) => { el.disabled = true; });
      if (task && task.lock) task.lock(true);
      if (task && !right && task.reveal) task.reveal(); // shows it done right
      if (!right && q.type === 'choice') {
        const ans = $(`input[value="${q.answer}"]`, form);
        if (ans) ans.closest('.q__choice').classList.add('is-answer');
      }
      const explain = q.explain ? `<span class="explain" data-no-i18n>${q.explain}</span>` : '';
      setFeedback(right ? 'correct' : 'wrong', right
        ? `<strong>Correct.</strong>${explain}<span class="rv-sched" data-sched></span>`
        : `<strong>Not quite.</strong><span class="rv-answer"><strong>Answer:</strong> <span data-no-i18n>${answerHTML(q)}</span></span>${explain}<span class="rv-sched" data-sched></span>
           <span class="rv-revise"><a class="textlink" href="${lessonHref(it)}" target="_blank" rel="noopener">Re-read the lesson</a></span>`);

      const result = { item: it, right, saved: null };
      sess.results[sess.i] = result;
      $('.rv-segs', root).innerHTML = segsHTML(sess);
      $('.rv-stop', root).hidden = last;
      $('.rv-next', root).hidden = false;
      $('[data-next]', root).focus({ preventScroll: true });

      const sched = $('[data-sched]', form);
      try {
        const r = await P.post(`/api/review/${it.id}/answer`, { right });
        result.saved = r.item;
        if (P.review) P.review.setDue(r.dueAll);
        sched.textContent = r.item.mastered ? 'Fixed. That’s twice in a row, so it won’t come back.' : backIn(r.item.dueAt);
      } catch (err) {
        result.error = err.message;
        sched.classList.add('is-error');
        sched.textContent = 'This answer couldn’t be saved: ' + err.message;
      }
    }
  }

  /* ------------------------------------------------------------------
     The summary
  ------------------------------------------------------------------ */
  async function finish(sess) {
    const done = sess.results.filter(Boolean);
    if (!done.length) { overview(true); return; }
    const right = done.filter((r) => r.right).length;
    const wrong = done.length - right;
    const fixed = done.filter((r) => r.right && r.saved && r.saved.mastered).length;
    const unsaved = done.filter((r) => r.error).length;
    if (P.sfx) P.sfx.play('complete');

    root.innerHTML = `${headHTML()}
      <section class="paper rv-paper rv-done" aria-labelledby="rv-done-title">
        <h2 id="rv-done-title" tabindex="-1">${sess.mode === 'practice' ? 'Practice done' : 'Review done'}</h2>
        <p class="rv-done__line">${wrong === 0 ? (done.length === 1 ? 'That one was right.' : `All ${done.length} right.`) : `${right} right, ${wrong} to see again tomorrow.`}</p>
        ${fixed ? `<p class="rv-done__fixed">${fixed} fixed for good.</p>` : ''}
        ${unsaved ? `<p class="rv-done__warn">${unsaved === 1 ? 'One answer couldn’t be saved, so it will be asked again.' : `${unsaved} answers couldn’t be saved, so they will be asked again.`}</p>` : ''}
        <div class="rv-done__outcome" data-outcome></div>
        <div class="rv-actions rv-actions--center">
          <button class="btn" type="button" data-again>See what’s coming up</button>
          <a class="textlink" href="${data.course ? `app.html?course=${encodeURIComponent(data.course.id)}` : 'app.html#library'}">${data.course ? 'Back to the course' : 'Your courses'}</a>
        </div>
      </section>`;
    $('#rv-done-title').focus({ preventScroll: true });
    root.scrollIntoView({ behavior: smooth(), block: 'start' });
    $('[data-again]', root).addEventListener('click', () => overview(true));
    $('[data-again]', root).disabled = true;

    // the new numbers: what's fixed now, and what's due next
    try {
      data = await fetchReview();
      const t = data.stats.total;
      if (t.made) {
        $('[data-outcome]', root).innerHTML = `<p class="rv-outcome">You’ve fixed ${t.fixed} of ${t.made} ${t.made === 1 ? 'mistake' : 'mistakes'}.</p>
          <div class="rv-bar" role="progressbar" aria-label="Mistakes fixed" aria-valuemin="0" aria-valuemax="${t.made}" aria-valuenow="${t.fixed}"><span style="width:${Math.round((t.fixed / t.made) * 100)}%"></span></div>`;
      }
    } catch (err) {
      P.toast('Couldn’t refresh your review: ' + err.message, 'error');
    } finally {
      const again = $('[data-again]', root);
      if (again) again.disabled = false;
    }
  }
})();
