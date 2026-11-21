/* =====================================================================
   exam.html: taking exams and tests (server/exams.mjs).

     ?course=<id>&unit=<u>   a unit exam: what it covers, then the exam
     ?course=<id>&final=1    the final exam
     ?attempt=<id>           an exam being taken (carry on) or its results
     ?course=<id>&make=1     make a test: lessons, numbers of questions, timer
     ?test=<id>              a test: take it, print it, past results

   While an exam is open the clock stays at the top. Answers are saved as
   they're given, so a closed page loses nothing; the server keeps the
   time too, and hands an exam in when it runs out even if the page is
   gone. Nothing here knows the right answers until the exam is handed
   in: the server checks multiple choice and the AI marks written answers.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  if (!P.auth.current() || !P.exams) return;
  P.mountUserNav();

  const W = P.exams.words, H = P.exams.hrefs;
  const t = W.t, fill = W.fill;
  // the same as fill, for the browser's own dialogs (plain text, nothing escaped)
  const say = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const roman = (n) => P.roman(n);
  const enc = encodeURIComponent;
  const root = $('#xm-root');
  const LETTERS = 'ABCDEF';
  const clean = (html) => P.sanitizeHTML(html);
  const smooth = () => (P.motion.reduce ? 'auto' : 'smooth');

  /* ---------- maths ---------- */
  const MATH = {
    delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
    throwOnError: false, strict: 'ignore'
  };
  const mathQueue = new Set();
  const math = (el) => {
    if (!el) return;
    if (window.renderMathInElement) { try { window.renderMathInElement(el, MATH); } catch (e) { console.warn('[Primer] maths', e); } } else mathQueue.add(el);
  };
  window.addEventListener('load', () => { mathQueue.forEach((el) => math(el)); mathQueue.clear(); });

  /* ---------- words ---------- */
  function fmtDate(ms) {
    try { return new Date(ms).toLocaleDateString(P.lang || 'en', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return new Date(ms).toDateString(); }
  }
  const clock = (s) => {
    s = Math.max(0, Math.ceil(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  };
  const marks = (n) => (n === 1 ? esc(t('1 mark')) : fill('{n} marks', { n: W.fmtNum(n) }));
  function examTitle(a) {
    if (a.kind === 'unit') return W.examName(a.unit);
    if (a.kind === 'final') return esc(t('Final exam'));
    return a.test ? W.testName(a.test) : esc(t('Test'));
  }
  const pctOf = (a) => (a.total ? Math.round((100 * a.score) / a.total) : 0);

  function fail(title, text, href, label) {
    hideBar();
    root.innerHTML = `<section class="paper xm-paper xm-msg"><h1>${esc(title)}</h1><p>${esc(text)}</p>
      <p class="xm-msg__go"><a class="btn" href="${href || 'app.html#library'}">${esc(label || t('Go to your courses'))}</a></p></section>`;
  }
  function busy(title, text) {
    hideBar();
    root.innerHTML = `<section class="paper xm-paper"><div class="lload" role="status"><span class="quill" aria-hidden="true"><i></i><i></i><i></i></span>
      <div><p class="lload__title">${esc(title)}</p><p>${esc(text)}</p></div></div></section>`;
  }
  const announce = (msg) => { const el = $('#xm-announce'); el.textContent = ''; setTimeout(() => { el.textContent = msg; }, 60); };
  function hideBar() { $('#xm-bar').hidden = true; document.body.classList.remove('is-taking'); }

  // "You can try again in 4:59": counts down, then calls done()
  function countdown(el, at, done) {
    const tick = () => {
      const ms = at - Date.now();
      if (ms <= 0) { clearInterval(id); done(); return; }
      el.textContent = say('You can try again in {time}, with fresh questions.', { time: clock(ms / 1000) });
    };
    const id = setInterval(tick, 1000);
    tick();
    return id;
  }

  /* ---------- which view ---------- */
  const prm = P.params;
  const attemptId = Number(prm.get('attempt')) || null;
  const testId = Number(prm.get('test')) || null;
  const courseId = prm.get('course');
  const unitN = Number(prm.get('unit')) || null;

  /* ------------------------------------------------------------------
     Before an exam: what it covers and how it works
  ------------------------------------------------------------------ */
  async function showIntro(cid, u) {
    const [, d] = await Promise.all([P.courses.load(), P.exams.status(cid, true)]);
    const course = P.courses.get(cid);
    if (!course) return fail(t('Course not found'), t('This course isn’t in your library. It may have been deleted.'));
    const flat = P.courseGen.flatten(course);
    const info = u ? d.units[u - 1] : d.final;
    if (!info) return fail(t('Exam not found'), say('This course has {n} units.', { n: d.units.length }), H.outline(cid), t('Back to the course'));
    const name = u ? W.examName(u) : esc(t('Final exam'));
    document.title = `${u ? say('Unit {u} exam', { u: roman(u) }) : t('Final exam')} | Primer`;
    const next = u ? d.units[u] : null;
    const covers = u
      ? flat.filter((l) => l.unitIndex === u).map((l) => `<li><span class="xm-covers__n">${l.n}</span> <span data-no-i18n>${esc(l.title)}</span></li>`).join('')
      : d.units.map((x) => `<li><span class="xm-covers__n">${roman(x.unit)}</span> <span data-no-i18n>${esc(x.title)}</span>${x.passed ? ` <span class="xm-covers__ok">${esc(t('passed'))}</span>` : ''}</li>`).join('');
    const rules = [
      fill('{n} questions: {c} multiple choice and {w} answered in your own words.', { n: info.questions, c: info.choice, w: info.written }),
      fill('{m} minutes. The clock starts when the questions appear, and the exam is handed in for you when time runs out.', { m: info.minutes }),
      esc(t('Pass mark 60%. Each multiple-choice question is worth 1 mark. Written answers are marked by the AI: 1 mark for a good answer, half a mark for a partly right one.')),
      (u ? (next ? fill('Passing opens Unit {u}.', { u: roman(next.unit) }) : esc(t('This is the last unit. After it comes the final exam.')))
        : esc(t('Passing completes the course and adds a certificate to your skill passport.'))) +
        ' ' + fill('If you don’t pass, you can try again after {m} minutes, with fresh questions.', { m: W.fmtNum(d.pauseMinutes) }),
      esc(t('Your answers are saved as you go, so nothing is lost if the page closes. The clock keeps running.'))
    ];
    let stateLine = '';
    if (info.passed) stateLine = fill('You passed this exam with {pct}.', { pct: `${info.best.pct}%` });
    else if (info.best) stateLine = fill('Your best so far is {pct}.', { pct: `${info.best.pct}%` });
    let main;
    if (!d.ai) main = `<p class="xm-note">${esc(t('Exams are written by the AI, and the AI isn’t set up on this server yet.'))}</p>`;
    else if (info.current) main = `<a class="btn" href="${H.attempt(info.current.id)}">${esc(t('Carry on with the exam'))}</a>`;
    else if (info.marking) main = `<a class="btn" href="${H.attempt(info.marking.id)}">${esc(t('See your results'))}</a>`;
    else if (info.retakeAt) main = `<button class="btn" type="button" data-start disabled>${esc(t('Take it again'))}</button>`;
    else if (info.passed) main = `<a class="btn" href="${H.attempt(info.best.id)}">${esc(t('See your results'))}</a><button class="btn btn--ghost" type="button" data-start>${esc(t('Take it again for practice'))}</button>`;
    else main = `<button class="btn" type="button" data-start>${esc(info.last ? t('Take it again') : t('Start the exam'))}</button>`;

    root.innerHTML = `
      <section class="paper xm-paper xm-intro" aria-labelledby="xm-title">
        <p class="xm-head__course" data-no-i18n>${esc(course.title)}</p>
        <h1 id="xm-title">${name}</h1>
        ${u ? `<p class="xm-head__sub" data-no-i18n>${esc(info.title)}</p>` : ''}
        ${stateLine ? `<p class="xm-intro__state">${stateLine}</p>` : ''}
        <ul class="xm-rules">${rules.map((r) => `<li>${r}</li>`).join('')}</ul>
        <h2 class="xm-intro__h">${esc(u ? t('The lessons it covers') : t('The units it covers'))}</h2>
        <ol class="xm-covers">${covers}</ol>
        <p class="xm-intro__retake" data-retake-line hidden></p>
        <div class="xm-actions">
          ${main}
          <a class="textlink" href="${H.outline(cid)}">${esc(t('Back to the course'))}</a>
          ${d.ai ? `<button class="textlink" type="button" data-paper>${esc(t('Print a paper copy'))}</button>` : ''}
        </div>
      </section>`;
    if (P.contentLang) $$('.xm-covers, .xm-head__course, .xm-head__sub', root).forEach((el) => P.contentLang(el, course.lang || 'en'));
    const start = $('[data-start]', root);
    if (info.retakeAt && start) {
      const line = $('[data-retake-line]', root);
      line.hidden = false;
      countdown(line, info.retakeAt, () => { start.disabled = false; line.hidden = true; });
    }
    if (start) start.addEventListener('click', () => begin(cid, u));
    const paper = $('[data-paper]', root);
    if (paper) paper.addEventListener('click', () => printCopy(paper, cid, u));
  }

  async function printCopy(btn, cid, u) {
    if (btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('Writing a paper copy…');
    try {
      const d = await P.post(u ? `/api/courses/${enc(cid)}/exams/unit/${u}/paper` : `/api/courses/${enc(cid)}/exams/final/paper`, {}, {
        timeout: 330000, timeoutMessage: t('The AI took too long to write the paper. Try again.')
      });
      location.href = H.paper(d.test.id);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      P.toast(err.message, 'error');
    }
  }

  async function begin(cid, u) {
    busy(t('Writing your exam'), u
      ? t('The AI is writing fresh questions from this unit’s lessons. It usually takes 10 to 40 seconds.')
      : t('The AI is writing fresh questions from every unit. For a long course this can take a minute.'));
    try {
      const d = await P.post(u ? `/api/courses/${enc(cid)}/exams/unit/${u}` : `/api/courses/${enc(cid)}/exams/final`, {}, {
        timeout: 330000, timeoutMessage: t('The AI took too long to write the exam. Try again.')
      });
      history.replaceState(null, '', H.attempt(d.attempt.id));
      route(d.attempt);
    } catch (err) {
      root.innerHTML = `<section class="paper xm-paper"><div class="lload lload--error" role="alert"><div>
          <p class="lload__title">${esc(t('The exam couldn’t be written'))}</p><p>${esc(err.message)}</p>
          <div class="lload__actions"><button class="btn btn--small" type="button" data-again>${esc(t('Try again'))}</button>
          <a class="textlink" href="${H.outline(cid)}">${esc(t('Back to the course'))}</a></div></div></div></section>`;
      $('[data-again]', root).addEventListener('click', () => begin(cid, u));
    }
  }

  const route = (a, marking) => (a.status === 'open' ? take(a) : results(a, marking));
  async function openAttempt(id) {
    const d = await P.get(`/api/exams/${id}`);
    route(d.attempt, d.marking);
  }

  /* ------------------------------------------------------------------
     Taking an exam
  ------------------------------------------------------------------ */
  function take(a) {
    const answers = Object.assign({}, a.answers || {});
    const choiceQs = a.questions.filter((q) => q.type === 'choice');
    const writtenQs = a.questions.filter((q) => q.type === 'subjective');
    const title = examTitle(a);
    document.title = `${titleText(a)} | Primer`;
    const qHTML = (q) => {
      const v = answers[String(q.k)];
      const field = q.type === 'choice'
        ? `<div class="q__choices" role="radiogroup" aria-labelledby="xq-${q.k}-p">${q.choices.map((c, i) => `
            <label class="q__choice${v === i ? ' is-checked' : ''}"><input type="radio" name="xq-${q.k}" value="${i}"${v === i ? ' checked' : ''}>
              <span class="xm-letter" aria-hidden="true">${LETTERS[i]}</span><span data-no-i18n>${clean(c)}</span></label>`).join('')}</div>`
        : `<textarea class="q__textarea" name="xq-${q.k}" aria-labelledby="xq-${q.k}-p" maxlength="3000" rows="5" placeholder="${esc(t('Write your answer in your own words'))}">${esc(typeof v === 'string' ? v : '')}</textarea>`;
      return `<li class="xm-q" id="xq-${q.k}" data-k="${q.k}">
          <p class="xm-q__n">${fill('Question {k}', { k: q.k })} <span class="xm-q__marks">· ${marks(1)}</span></p>
          <div class="q__prompt" id="xq-${q.k}-p" data-no-i18n>${clean(q.prompt)}</div>
          ${field}
        </li>`;
    };
    const timed = Boolean(a.deadline);
    root.innerHTML = `
      <section class="paper xm-paper xm-take" aria-labelledby="xm-title">
        <header class="xm-head">
          <p class="xm-head__course" data-no-i18n>${esc(a.course.title)}</p>
          <h1 id="xm-title" tabindex="-1">${title}</h1>
          ${a.unitTitle ? `<p class="xm-head__sub" data-no-i18n>${esc(a.unitTitle)}</p>` : ''}
          <p class="xm-head__rules">${fill('{n} questions · pass mark 60%', { n: a.questions.length })} · ${timed ? fill('{m} minutes', { m: Math.round(a.duration / 60) }) : esc(t('No timer'))}.
            ${esc(t('Your answers are saved as you go.'))}</p>
        </header>
        <form class="xm-form" novalidate>
          ${choiceQs.length ? `<h2 class="xm-part">${esc(writtenQs.length ? t('Part A · Multiple choice') : t('Multiple choice'))}</h2>
            <p class="xm-part__sub">${esc(t('Choose one answer for each question.'))}</p>
            <ol class="xm-qs">${choiceQs.map(qHTML).join('')}</ol>` : ''}
          ${writtenQs.length ? `<h2 class="xm-part">${esc(choiceQs.length ? t('Part B · Written answers') : t('Written answers'))}</h2>
            <p class="xm-part__sub">${esc(t('Answer in your own words, in a few sentences. The AI marks each one: 1 mark for a good answer, half a mark for a partly right one.'))}</p>
            <ol class="xm-qs" start="${choiceQs.length + 1}">${writtenQs.map(qHTML).join('')}</ol>` : ''}
          <div class="xm-handin">
            <button class="btn" type="submit">${esc(t('Hand in'))}</button>
            <p class="xm-handin__help">${esc(timed ? t('You can hand it in early. When time runs out, it’s handed in for you.') : t('Hand it in when you’re ready.'))}</p>
          </div>
        </form>
      </section>`;
    if (P.contentLang) $$('.xm-qs, .xm-head__course, .xm-head__sub', root).forEach((el) => P.contentLang(el, a.course.lang || 'en'));
    math(root);

    const bar = $('#xm-bar'), timerEl = $('#xm-timer'), savedEl = $('#xm-bar-saved'), countEl = $('#xm-bar-count');
    $('#xm-bar-name').innerHTML = title;
    bar.hidden = false;
    document.body.classList.add('is-taking');
    const form = $('.xm-form', root);
    const answeredCount = () => a.questions.filter((q) => { const v = answers[String(q.k)]; return q.type === 'choice' ? Number.isInteger(v) : typeof v === 'string' && v.trim() !== ''; }).length;
    const updateCount = () => { countEl.textContent = say('{n} of {total} answered', { n: answeredCount(), total: a.questions.length }); };
    updateCount();

    /* saving as they go */
    let saveTimer = 0, dirty = false, handing = false;
    const payload = () => {
      const out = {};
      a.questions.forEach((q) => { const v = answers[String(q.k)]; out[q.k] = v == null ? '' : v; });
      return out;
    };
    const setSaved = (s) => { savedEl.textContent = s; };
    function queueSave(delay) {
      dirty = true;
      setSaved('');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, delay);
    }
    async function save() {
      clearTimeout(saveTimer);
      if (!dirty || handing) return;
      dirty = false;
      setSaved(t('Saving…'));
      try {
        await P.put(`/api/exams/${a.id}/answers`, { answers: payload() });
        if (!dirty) setSaved(t('Saved'));
      } catch (err) {
        if (err.status === 409) { stop(); openAttempt(a.id); return; } // it was handed in (its time ran out)
        dirty = true;
        setSaved(t('Not saved yet. Trying again…'));
        saveTimer = setTimeout(save, 4000);
      }
    }
    const flushOnLeave = () => { if (dirty && !handing) P.put(`/api/exams/${a.id}/answers`, { answers: payload() }, { keepalive: true }).catch(() => {}); };
    addEventListener('pagehide', flushOnLeave);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushOnLeave(); });

    form.addEventListener('change', (e) => {
      const li = e.target.closest('.xm-q');
      if (!li || e.target.type !== 'radio') return;
      answers[li.dataset.k] = Number(e.target.value);
      $$('.q__choice', li).forEach((l) => l.classList.toggle('is-checked', l.querySelector('input').checked));
      updateCount();
      queueSave(400);
    });
    form.addEventListener('input', (e) => {
      if (e.target.tagName !== 'TEXTAREA') return;
      answers[e.target.closest('.xm-q').dataset.k] = e.target.value;
      updateCount();
      queueSave(1200);
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); handIn(false); });
    $('#xm-bar-handin').onclick = () => handIn(false);

    /* the clock (the server's: what's left is worked out from its time, not the device's) */
    let timer = 0;
    const skew = a.now - Date.now();
    const left = () => a.deadline - (Date.now() + skew);
    const said = new Set();
    function tick() {
      const ms = left();
      if (ms <= 0) {
        timerEl.textContent = '0:00';
        stop();
        announce(t('Time’s up. Your exam is being handed in.'));
        handIn(true);
        return;
      }
      const s = Math.ceil(ms / 1000);
      timerEl.textContent = clock(s);
      timerEl.classList.toggle('is-low', s <= 120);
      timerEl.setAttribute('aria-label', say('Time left: {time}', { time: clock(s) }));
      for (const [at, msg] of [[300, t('5 minutes left.')], [60, t('1 minute left.')]]) {
        if (s <= at && s > at - 5 && !said.has(at)) { said.add(at); announce(msg); }
      }
    }
    function stop() { clearInterval(timer); timer = 0; }
    if (timed) { tick(); timer = setInterval(tick, 500); } else { timerEl.textContent = t('No time limit'); timerEl.classList.add('is-free'); }

    async function handIn(auto) {
      if (handing) return;
      if (!auto) {
        const missing = a.questions.length - answeredCount();
        const ask = missing === 1 ? t('You haven’t answered one question. Hand in the exam anyway?')
          : say('You haven’t answered {n} questions. Hand in the exam anyway?', { n: missing });
        if (missing && !window.confirm(ask)) return;
      }
      handing = true;
      stop();
      clearTimeout(saveTimer);
      busy(auto ? t('Time’s up') : t('Handing in your exam'), writtenQs.length
        ? t('Checking your answers, and the AI is marking your written answers. This takes up to a minute.')
        : t('Checking your answers.'));
      try {
        const d = await P.post(`/api/exams/${a.id}/submit`, { answers: payload() }, { timeout: 240000, timeoutMessage: t('Marking took too long. Your exam is handed in: open it again in a minute to see your results.') });
        results(d.attempt);
      } catch (err) {
        handing = false;
        root.innerHTML = `<section class="paper xm-paper"><div class="lload lload--error" role="alert"><div>
            <p class="lload__title">${esc(t('Your exam couldn’t be handed in from here'))}</p><p>${esc(err.message)}</p>
            <p>${esc(t('Your answers are saved. If time runs out first, the exam is handed in for you with them.'))}</p>
            <div class="lload__actions"><button class="btn btn--small" type="button" data-again>${esc(t('Try again'))}</button></div></div></div></section>`;
        $('[data-again]', root).addEventListener('click', () => openAttempt(a.id).catch((e) => P.toast(e.message, 'error')));
      }
    }
    $('#xm-title').focus({ preventScroll: true });
  }

  function titleText(a) {
    if (a.kind === 'unit') return say('Unit {u} exam', { u: roman(a.unit) });
    if (a.kind === 'final') return t('Final exam');
    return a.test && a.test.title ? a.test.title : t('Test');
  }

  /* ------------------------------------------------------------------
     Results
  ------------------------------------------------------------------ */
  const VERDICT = { good: ['Good answer.', 'good'], partly: ['Partly there.', 'partly'], 'not yet': ['Not yet.', 'notyet'] };

  function markHTML(q, given) {
    const m = q.mark;
    if (!m) return `<div class="qmark is-unmarked"><p class="qmark__fail">${esc(t('This answer hasn’t been marked yet.'))}</p></div>`;
    if (m.error) {
      return `<div class="qmark is-failed"><p class="qmark__fail">${esc(t('Couldn’t mark this right now.'))}</p><p class="qmark__why" data-no-i18n>${esc(m.error)}</p>
        ${m.support ? `<div class="qmark__support" data-no-i18n>${clean(m.support)}</div>` : ''}</div>`;
    }
    const v = VERDICT[m.verdict] || VERDICT.partly;
    const missing = (m.missing || []).filter(Boolean);
    const why = m.blank ? esc(t('No answer was written.')) : m.refused ? esc(t('This answer can’t be marked.')) : `<span data-no-i18n>${clean(m.feedback)}</span>`;
    return `<div class="qmark is-${v[1]}">
        <p class="qmark__verdict"><strong>${esc(t(v[0]))}</strong></p>
        <div class="qmark__feedback">${why}</div>
        ${missing.length ? `<p class="qmark__missing-title">${esc(t('What was missing:'))}</p><ul class="qmark__missing" data-no-i18n>${missing.map((x) => `<li>${clean(x)}</li>`).join('')}</ul>` : ''}
        ${m.model ? `<p class="qmark__by">${fill('Marked by {model}. AI marking can be wrong.', { model: esc(m.model.replace(/:free$/, '')) })}</p>` : ''}
      </div>`;
  }

  function pointsOf(q) {
    if (!q.mark) return null;
    if (q.type === 'choice') return q.mark.right ? 1 : 0;
    return q.mark.verdict === 'good' ? 1 : q.mark.verdict === 'partly' ? 0.5 : q.mark.verdict === 'not yet' ? 0 : null;
  }

  function resultQ(a, q) {
    const given = a.answers[String(q.k)];
    const pts = pointsOf(q);
    const cls = pts == null ? 'is-waiting' : pts === 1 ? 'is-right' : pts > 0 ? 'is-partly' : 'is-wrong';
    const ptsLabel = pts == null ? esc(t('not marked yet')) : fill('{n} of {total}', { n: W.fmtNum(pts), total: 1 });
    let body;
    if (q.type === 'choice') {
      const picked = Number.isInteger(given) ? given : null;
      body = `<ul class="xm-choices">${q.choices.map((c, i) => {
        const right = i === q.answer, mine = i === picked;
        const tag = right ? (mine ? t('Your answer, right') : t('Right answer')) : mine ? t('Your answer') : '';
        return `<li class="xm-choice${right ? ' is-answer' : ''}${mine && !right ? ' is-picked' : ''}"><span class="xm-letter" aria-hidden="true">${LETTERS[i]}</span>
          <span class="xm-choice__text" data-no-i18n>${clean(c)}</span>${tag ? `<span class="xm-choice__tag">${esc(tag)}</span>` : ''}</li>`;
      }).join('')}</ul>
        ${picked == null ? `<p class="xm-none">${esc(t('You didn’t answer this one.'))}</p>` : ''}
        ${q.explain ? `<p class="xm-explain"><strong>${esc(t('Why:'))}</strong> <span data-no-i18n>${clean(q.explain)}</span></p>` : ''}`;
    } else {
      body = `<div class="xm-given"><p class="xm-given__label">${esc(t('Your answer'))}</p>
          ${typeof given === 'string' && given.trim() ? `<blockquote data-no-i18n>${esc(given)}</blockquote>` : `<p class="xm-none">${esc(t('You didn’t answer this one.'))}</p>`}</div>
        ${markHTML(q, given)}
        ${q.model ? `<details class="model"${pts != null && pts < 1 ? ' open' : ''}><summary>${esc(t('A model answer'))}</summary><div class="model__body" data-no-i18n>${clean(q.model)}</div></details>` : ''}`;
    }
    return `<li class="xm-q xm-q--result ${cls}" id="xq-${q.k}">
        <p class="xm-q__n">${fill('Question {k}', { k: q.k })} <span class="xm-pts">${ptsLabel}</span>
          ${q.lesson ? `<span class="xm-q__from">· ${fill('Lesson {n}', { n: q.lesson })}${q.lessonTitle ? `: <span data-no-i18n>${esc(q.lessonTitle)}</span>` : ''}</span>` : ''}</p>
        <div class="q__prompt" data-no-i18n>${clean(q.prompt)}</div>
        ${body}
      </li>`;
  }

  let poll = 0;
  async function results(a, markingNow) {
    hideBar();
    clearTimeout(poll);
    const done = a.status === 'done';
    document.title = `${titleText(a)}: ${t('results')} | Primer`;
    const waiting = a.questions.filter((q) => q.type === 'subjective' && !(q.mark && q.mark.verdict));
    const failedMarks = waiting.filter((q) => q.mark && q.mark.error);
    const choiceMissed = a.questions.filter((q) => q.type === 'choice' && q.mark && !q.mark.right).length;
    const pct = pctOf(a);
    let passport = null;
    if (done && a.kind === 'final' && a.passed) {
      try { passport = (await P.exams.status(a.course.id, true)).passport; } catch (e) { passport = null; }
    }

    let verdict = '';
    if (done) {
      if (a.kind === 'unit') verdict = a.passed ? (a.next ? fill('You passed. Unit {u} is open.', { u: roman(a.next.unit) }) : esc(t('You passed the last unit’s exam. The final exam is next.'))) : esc(t('Not passed yet: the pass mark is 60%.'));
      else if (a.kind === 'final') verdict = a.passed ? esc(t('You passed the final exam. This course is completed.')) : esc(t('Not passed yet: the pass mark is 60%.'));
      else verdict = a.passed ? esc(t('That’s a pass: 60% or more.')) : esc(t('Below the 60% pass mark this time.'));
    }
    const more = [];
    if (done && choiceMissed) {
      more.push(choiceMissed === 1 ? esc(t('The multiple-choice question you missed is now in Review, so it comes back until you’ve got it.'))
        : fill('The {n} multiple-choice questions you missed are now in Review, so they come back until you’ve got them.', { n: choiceMissed }));
    }
    const actions = [];
    if (done && a.kind === 'unit' && a.passed && a.next) actions.push(`<a class="btn" href="${H.lesson(a.course.id, a.next.lesson)}">${fill('Start Unit {u}', { u: roman(a.next.unit) })}</a>`);
    if (done && a.kind === 'unit' && a.passed && !a.next) actions.push(`<a class="btn" href="${H.final(a.course.id)}">${esc(t('Take the final exam'))}</a>`);
    if (done && a.kind === 'final' && a.passed && passport) actions.push(`<a class="btn" href="${H.certificate(passport.code)}">${esc(t('See your certificate'))}</a>`);
    if (done && a.kind !== 'test' && !a.passed) {
      actions.push(`<a class="btn" data-retake href="${a.kind === 'unit' ? H.unit(a.course.id, a.unit) : H.final(a.course.id)}"${a.retakeAt ? ' aria-disabled="true"' : ''}>${esc(t('Take it again'))}</a>`);
    }
    if (done && a.kind === 'test' && a.test) actions.push(`<a class="btn btn--ghost" href="${H.test(a.test.id)}">${esc(t('Take this test again'))}</a>`);
    actions.push(`<a class="textlink" href="${H.outline(a.course.id)}">${esc(t('Back to the course'))}</a>`);
    if (done && choiceMissed) actions.push(`<a class="textlink" href="review.html?course=${enc(a.course.id)}">${esc(t('Go to Review'))}</a>`);
    actions.push(`<a class="textlink" href="paper.html?attempt=${a.id}">${esc(t('Print with the answers'))}</a>`);

    const seal = done
      ? `<div class="xm-seal ${a.passed ? 'is-pass' : 'is-fail'}" aria-hidden="true"><span class="xm-seal__pct">${pct}%</span><span class="xm-seal__word">${esc(a.passed ? t('Passed') : t('Not yet'))}</span></div>`
      : '<div class="xm-seal is-wait" aria-hidden="true"><span class="xm-seal__pct">…</span></div>';
    root.innerHTML = `
      <section class="paper xm-paper xm-result" aria-labelledby="xm-title">
        <header class="xm-result__head">
          ${seal}
          <div class="xm-result__main">
            <p class="xm-head__course" data-no-i18n>${esc(a.course.title)}</p>
            <h1 id="xm-title" tabindex="-1">${examTitle(a)}</h1>
            ${done
              ? `<p class="xm-result__score">${fill('{score} out of {total} marks · {pct}', { score: `<strong>${W.fmtNum(a.score)}</strong>`, total: a.total, pct: `${pct}%` })}</p>
                 <p class="xm-result__verdict">${verdict}</p>`
              : `<p class="xm-result__score">${waiting.length === 1 ? esc(t('One written answer is still to be marked.')) : fill('{n} written answers are still to be marked.', { n: waiting.length })}</p>`}
            ${more.map((m) => `<p class="xm-result__more">${m}</p>`).join('')}
            <p class="xm-result__more" data-retake-line hidden></p>
            ${a.submittedAt ? `<p class="xm-result__when">${fill('Handed in on {date}', { date: esc(fmtDate(a.submittedAt)) })}</p>` : ''}
          </div>
        </header>
        ${!done ? `<div class="xm-wait" role="status">
            ${failedMarks.length && !markingNow
              ? `<p>${esc(t('Some written answers couldn’t be marked yet, so the score isn’t ready.'))}</p><button class="btn btn--small" type="button" data-remark>${esc(t('Mark them again'))}</button>`
              : `<p><span class="qmark__dots" aria-hidden="true"><i></i><i></i><i></i></span>${esc(t('The AI is marking your written answers…'))}</p>`}
          </div>` : ''}
        <div class="xm-actions">${actions.join('')}</div>
        <h2 class="xm-part">${esc(t('Question by question'))}</h2>
        <ol class="xm-qs xm-qs--result">${a.questions.map((q) => resultQ(a, q)).join('')}</ol>
      </section>`;
    if (P.contentLang) $$('.xm-qs, .xm-head__course', root).forEach((el) => P.contentLang(el, a.course.lang || 'en'));
    math(root);
    const retake = $('[data-retake]', root);
    if (retake && a.retakeAt) {
      const line = $('[data-retake-line]', root);
      line.hidden = false;
      retake.addEventListener('click', (e) => { if (retake.getAttribute('aria-disabled') === 'true') e.preventDefault(); });
      countdown(line, a.retakeAt, () => { retake.removeAttribute('aria-disabled'); line.hidden = true; });
    }
    const again = $('[data-remark]', root);
    if (again) {
      again.addEventListener('click', async () => {
        again.disabled = true;
        again.textContent = t('Marking…');
        try {
          const d = await P.post(`/api/exams/${a.id}/remark`, {}, { timeout: 240000 });
          results(d.attempt);
        } catch (err) {
          again.disabled = false;
          again.textContent = t('Mark them again');
          P.toast(err.message, 'error');
        }
      });
    } else if (!done) {
      // being marked on the server (the clock ran out with the page closed): look again shortly
      poll = setTimeout(() => openAttempt(a.id).catch(() => {}), 3000);
    }
    $('#xm-title').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: smooth() });
  }

  /* ------------------------------------------------------------------
     A test: take it, print it, past results
  ------------------------------------------------------------------ */
  async function showTest(tid, fresh) {
    const d = await P.get(`/api/tests/${tid}`);
    const x = d.test;
    const name = W.testName(x);
    document.title = `${x.title || t('Test')} | Primer`;
    const info = x.lessonInfo || {};
    const lessons = x.lessons.map((n) => `<li><span class="xm-covers__n">${n}</span> <span data-no-i18n>${esc((info[n] || {}).title || '')}</span></li>`).join('');
    const open = x.attempts.find((r) => r.status === 'open');
    const past = x.attempts.filter((r) => r.status !== 'open').map((r) => `<li><a href="${H.attempt(r.id)}">${r.status === 'done'
      ? fill('{pct} on {date}', { pct: `${r.pct}%`, date: esc(fmtDate(r.at || r.startedAt)) })
      : fill('Being marked · {date}', { date: esc(fmtDate(r.startedAt)) })}</a></li>`).join('');
    const isPaper = x.kind === 'paper';
    root.innerHTML = `
      <section class="paper xm-paper xm-intro" aria-labelledby="xm-title">
        ${fresh ? `<p class="xm-ready" role="status">${esc(t('Your test is ready. Take it now, or keep it here for later: it’s saved with the course.'))}</p>` : ''}
        <p class="xm-head__course" data-no-i18n>${esc(x.course.title)}</p>
        <h1 id="xm-title" tabindex="-1">${name}</h1>
        <p class="xm-head__sub">${W.testMeta(x)}</p>
        <ul class="xm-rules">
          <li>${fill('{n} questions, 1 mark each. Written answers are marked by the AI: half a mark for a partly right one.', { n: x.questions.length })}</li>
          <li>${x.minutes ? fill('{m} minutes. The clock starts when you start the test, and it’s handed in for you when time runs out.', { m: x.minutes }) : esc(t('No timer: take as long as you need.'))}</li>
          <li>${esc(t('You get the same questions each time you take it. Missed multiple-choice questions come back in Review.'))}</li>
        </ul>
        <h2 class="xm-intro__h">${esc(t('The lessons it covers'))}</h2>
        <ol class="xm-covers">${lessons}</ol>
        ${past ? `<h2 class="xm-intro__h">${esc(t('Your results'))}</h2><ul class="xm-past">${past}</ul>` : ''}
        <div class="xm-actions">
          ${isPaper ? '' : open
            ? `<a class="btn" href="${H.attempt(open.id)}">${esc(t('Carry on with the test'))}</a>`
            : `<button class="btn" type="button" data-start>${esc(t('Take the test'))}</button>`}
          <a class="${isPaper ? 'btn' : 'textlink'}" href="${H.paper(x.id)}">${esc(t('Print'))}</a>
          <a class="textlink" href="${H.outline(x.course.id)}">${esc(t('Back to the course'))}</a>
          <button class="textlink" type="button" data-delete>${esc(t('Delete this test'))}</button>
        </div>
      </section>`;
    if (P.contentLang) $$('.xm-covers, .xm-head__course', root).forEach((el) => P.contentLang(el, x.course.lang || 'en'));
    const start = $('[data-start]', root);
    if (start) {
      start.addEventListener('click', async () => {
        start.disabled = true;
        try {
          const r = await P.post(`/api/tests/${x.id}/start`, {});
          history.replaceState(null, '', H.attempt(r.attempt.id));
          take(r.attempt);
        } catch (err) {
          start.disabled = false;
          P.toast(err.message, 'error');
        }
      });
    }
    $('[data-delete]', root).addEventListener('click', async (e) => {
      if (!window.confirm(t('Delete this test? Results you already have are kept.'))) return;
      e.target.disabled = true;
      try {
        await P.del(`/api/tests/${x.id}`);
        location.href = H.outline(x.course.id);
      } catch (err) {
        e.target.disabled = false;
        P.toast(err.message, 'error');
      }
    });
    if (fresh) $('#xm-title').focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------
     Make a test
  ------------------------------------------------------------------ */
  async function showMake(cid, prev) {
    await P.courses.load();
    const course = P.courses.get(cid);
    if (!course) return fail(t('Course not found'), t('This course isn’t in your library. It may have been deleted.'));
    document.title = `${t('Make a test')} | Primer`;
    const flat = P.courseGen.flatten(course);
    const pre = new Set((prev ? prev.lessons : (prm.get('lessons') || '').split(',').map(Number)).filter((n) => n >= 1 && n <= flat.length));
    const tree = course.units.map((u, ui) => {
      const ls = flat.filter((l) => l.unitIndex === ui + 1);
      return `<li class="xm-tree__unit">
          <label class="xm-check xm-check--unit"><input type="checkbox" data-unit="${ui + 1}">
            <span><span class="xm-tree__u">${W.unitName(ui + 1)}</span> <span data-no-i18n>${esc(u.title)}</span></span></label>
          <ul class="xm-tree__lessons">${ls.map((l) => `<li><label class="xm-check"><input type="checkbox" name="lesson" value="${l.n}"${pre.has(l.n) ? ' checked' : ''}>
            <span><span class="xm-covers__n">${l.n}</span> <span data-no-i18n>${esc(l.title)}</span></span></label></li>`).join('')}</ul>
        </li>`;
    }).join('');
    root.innerHTML = `
      <section class="paper xm-paper xm-make" aria-labelledby="xm-title">
        <p class="xm-head__course" data-no-i18n>${esc(course.title)}</p>
        <h1 id="xm-title">${esc(t('Make a test'))}</h1>
        <p class="xm-head__rules">${esc(t('Pick the lessons to test, how many questions of each kind, and whether there’s a timer. The AI writes the test from those lessons.'))}</p>
        <form class="xm-make__form" novalidate>
          <fieldset class="xm-tree">
            <legend class="xm-legend">${esc(t('Lessons'))}</legend>
            <p class="xm-tree__tools"><button class="textlink" type="button" data-all>${esc(t('Select all'))}</button> <button class="textlink" type="button" data-none>${esc(t('Clear'))}</button></p>
            <ul class="xm-tree__units">${tree}</ul>
            <p class="xm-err" id="xm-err-lessons" role="alert"></p>
          </fieldset>
          <fieldset class="xm-counts">
            <legend class="xm-legend">${esc(t('Questions'))}</legend>
            <label class="xm-num"><span>${esc(t('Multiple choice'))}</span><input class="q__input" type="number" name="choice" min="0" max="20" value="6" inputmode="numeric"><small>${esc(t('up to 20'))}</small></label>
            <label class="xm-num"><span>${esc(t('Written answers'))}</span><input class="q__input" type="number" name="written" min="0" max="5" value="2" inputmode="numeric"><small>${esc(t('up to 5'))}</small></label>
            <p class="xm-err" id="xm-err-counts" role="alert"></p>
          </fieldset>
          <fieldset class="xm-timer-pick">
            <legend class="xm-legend">${esc(t('Timer'))}</legend>
            <label class="xm-check"><input type="radio" name="timer" value="on" checked><span>${esc(t('A timer of'))}</span>
              <input class="q__input xm-mins" type="number" name="minutes" min="5" max="180" value="20" inputmode="numeric" aria-label="${esc(t('Minutes'))}"><span>${esc(t('minutes'))}</span></label>
            <label class="xm-check"><input type="radio" name="timer" value="off"><span>${esc(t('No timer'))}</span></label>
          </fieldset>
          <label class="xm-name"><span class="xm-legend">${esc(t('Name'))} <small>${esc(t('optional'))}</small></span>
            <input class="q__input" type="text" name="title" maxlength="80" placeholder="${esc(t('e.g. Revision before Friday’s class'))}" autocomplete="off"></label>
          <p class="xm-sum" aria-live="polite"></p>
          <div class="xm-actions">
            <button class="btn" type="submit">${esc(t('Make the test'))}</button>
            <a class="textlink" href="${H.outline(cid)}">${esc(t('Back to the course'))}</a>
          </div>
        </form>
      </section>`;
    if (P.contentLang) $$('.xm-tree__units, .xm-head__course', root).forEach((el) => P.contentLang(el, course.lang || 'en'));
    const form = $('.xm-make__form', root);
    const boxes = () => $$('input[name="lesson"]', form);
    const picked = () => boxes().filter((b) => b.checked).map((b) => Number(b.value));
    const minutes = form.elements.minutes;
    let minutesTouched = false;
    minutes.addEventListener('input', () => { minutesTouched = true; form.elements.timer[0].checked = true; });
    const num = (el, max) => Math.max(0, Math.min(max, Math.round(Number(el.value) || 0)));
    function sync() {
      $$('[data-unit]', form).forEach((u) => {
        const own = $$('input[name="lesson"]', u.closest('.xm-tree__unit'));
        const on = own.filter((b) => b.checked).length;
        u.checked = on === own.length && on > 0;
        u.indeterminate = on > 0 && on < own.length;
      });
      const c = num(form.elements.choice, 20), w = num(form.elements.written, 5);
      // a suggested time: a minute and a half per multiple-choice question, five per written one
      if (!minutesTouched) minutes.value = String(Math.min(180, Math.max(5, Math.ceil((c * 1.5 + w * 5) / 5) * 5)));
      const n = picked().length;
      const timed = form.elements.timer.value !== 'off';
      $('.xm-sum', root).textContent = [
        n === 1 ? t('1 lesson') : say('{n} lessons', { n }),
        say('{n} questions', { n: c + w }),
        timed ? say('{n} minutes', { n: num(minutes, 180) }) : t('No timer')
      ].join(' · ');
    }
    form.addEventListener('change', (e) => {
      if (e.target.dataset.unit) $$('input[name="lesson"]', e.target.closest('.xm-tree__unit')).forEach((b) => { b.checked = e.target.checked; });
      $('#xm-err-lessons').textContent = '';
      sync();
    });
    // numbers and the name; a checkbox's 'input' comes before its 'change', which does the ticking
    form.addEventListener('input', (e) => { if (e.target.type !== 'checkbox' && e.target.type !== 'radio') sync(); });
    $('[data-all]', form).addEventListener('click', () => { boxes().forEach((b) => { b.checked = true; }); sync(); });
    $('[data-none]', form).addEventListener('click', () => { boxes().forEach((b) => { b.checked = false; }); sync(); });
    sync();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const lessons = picked();
      const choice = num(form.elements.choice, 20), written = num(form.elements.written, 5);
      $('#xm-err-lessons').textContent = lessons.length ? '' : t('Pick at least one lesson.');
      $('#xm-err-counts').textContent = choice + written ? '' : t('Ask for at least one question.');
      if (!lessons.length || !(choice + written)) { P.shake(lessons.length ? $('.xm-counts', form) : $('.xm-tree', form)); return; }
      const body = { lessons, choice, written, minutes: form.elements.timer.value === 'off' ? null : num(minutes, 180), title: form.elements.title.value };
      busy(t('Writing your test'), t('The AI is writing questions from the lessons you picked. It usually takes 10 to 40 seconds.'));
      try {
        const d = await P.post(`/api/courses/${enc(cid)}/tests`, body, { timeout: 330000, timeoutMessage: t('The AI took too long to write the test. Try again.') });
        history.replaceState(null, '', H.test(d.test.id));
        await showTest(d.test.id, true);
      } catch (err) {
        await showMake(cid, body); // the form comes back as it was
        P.toast(err.message, 'error');
      }
    });
    if (prev) {
      form.elements.choice.value = String(prev.choice);
      form.elements.written.value = String(prev.written);
      form.elements.title.value = prev.title || '';
      if (prev.minutes == null) form.elements.timer[1].checked = true;
      else { minutes.value = String(prev.minutes); minutesTouched = true; }
      sync();
    }
  }

  /* ---------- which view ---------- */
  (async () => {
    try {
      if (attemptId) await openAttempt(attemptId);
      else if (testId) await showTest(testId);
      else if (courseId && prm.get('make') === '1') await showMake(courseId);
      else if (courseId && (unitN || prm.get('final') === '1')) await showIntro(courseId, prm.get('final') === '1' ? null : unitN);
      else fail(t('Nothing to open here'), t('This link doesn’t point to an exam or a test.'));
    } catch (err) {
      console.error(err);
      fail(t('This didn’t open'), err.message, courseId ? H.outline(courseId) : null, courseId ? t('Back to the course') : null);
    }
  })();
})();
