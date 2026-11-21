/* =====================================================================
   Lesson player (lesson.html?course=<id>&lesson=<n>)

   - A lesson is a list of sections. Each section ends in a checkpoint.
   - Only sections up to the first unanswered checkpoint are rendered,
     so content past an open question isn't in the page at all.
   - Wrong answer: the question locks and a revision panel for that
     section appears; "try again" re-opens it. After 2 misses a hint
     shows, after 3 the learner can reveal the answer.
   - Written (subjective) answers are recorded and unlock the next part;
     then the AI marks them and the feedback appears under the answer
     (assets/js/marking.js).
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  if (!P.auth.current()) return;
  // The lesson body is content, which the dictionary leaves alone, so its interface text (checkpoints,
  // buttons, feedback) is translated here, and marked data-i18n in case the dictionary arrives later.
  const t = (s) => (P.t ? P.t(s) : s);
  const T = (s) => esc(t(s));

  /* ---------- maths (KaTeX auto-render) ---------- */
  const MATH_OPTS = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false }
    ],
    throwOnError: false
  };
  const mathQueue = new Set();
  P.math = (el) => {
    if (!el) return;
    if (window.renderMathInElement) {
      try { window.renderMathInElement(el, MATH_OPTS); } catch (e) { console.warn('[Primer] maths', e); }
    } else {
      mathQueue.add(el);
    }
  };
  window.addEventListener('load', () => {
    if (window.renderMathInElement) mathQueue.forEach((el) => P.math(el));
    else if (mathQueue.size) $('#paper').classList.add('no-katex');
    mathQueue.clear();
  });

  const LOCK_SVG = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/></svg>';
  const CHECK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M8 12.4l2.7 2.7L16.2 9.6"/></svg>';
  const smooth = () => (P.motion.reduce ? 'auto' : 'smooth');

  P.courses.load().then(run).catch((err) => {
    const main = $('#main');
    main.className = 'wrap';
    main.innerHTML = `<div class="lmsg card card--solid"><h1>This lesson didn’t load</h1><p>${esc(err.message)}</p><p style="margin-top:1.3rem"><a class="btn" href="lesson.html${esc(location.search)}">Try again</a></p></div>`;
  });

  function run() {
  /* ---------- which lesson ---------- */
  const courseId = P.params.get('course');
  const n = Math.max(1, parseInt(P.params.get('lesson') || '1', 10) || 1);
  let course = P.courses.get(courseId);
  const paper = $('#paper');

  if (!course) {
    showMessage('Lesson not found', 'This course isn’t in your library. It may have been deleted, or built in another browser.', 'app.html', 'Go to your courses');
    return;
  }
  const flat = P.courseGen.flatten(course);
  const meta = flat[n - 1];
  const outlineHref = `app.html?course=${encodeURIComponent(course.id)}`;
  const lessonHref = (k) => `lesson.html?course=${encodeURIComponent(course.id)}&lesson=${k}`;
  if (!meta) {
    showMessage('Lesson not found', `This course has ${flat.length} lessons.`, outlineHref, 'Back to the outline');
    return;
  }

  document.title = `${meta.title} | Primer`;
  $('#back-link').href = outlineHref;
  $('#lbar-course').textContent = course.title;
  $('#lbar-pos').textContent = `Lesson ${n} of ${flat.length}`;
  renderSide();
  renderNav();

  let lesson, sections, prog, unlocked = 0;
  loadLesson();

  // AI lessons are written the first time they're opened, which takes a while on free models.
  function loadLesson() {
    const needsWriting = (course.source === 'ai' || course.source === 'library') && !(course.written || []).includes(n);
    // Shared-library lessons are often written already, so give them a moment before showing the wait.
    const wait = needsWriting ? setTimeout(showWriting, course.source === 'library' ? 500 : 0) : 0;
    P.api.getLesson(course, n).then((l) => { clearTimeout(wait); start(l); }).catch((err) => {
      clearTimeout(wait);
      console.error(err);
      showLoadError(err);
    });
  }

  function showWriting() {
    $('#lhead').innerHTML = `
      <p class="lhead__pos">Lesson ${n} of ${flat.length}, in Unit ${P.roman(meta.unitIndex)}: ${esc(meta.unit)}</p>
      <h1 id="lesson-title">${esc(meta.title)}</h1>`;
    $('#lbody').innerHTML = `
      <div class="lload" role="status">
        <span class="quill" aria-hidden="true"><i></i><i></i><i></i></span>
        <div>
          <p class="lload__title" data-i18n>${T('Writing this lesson')}</p>
          <p data-i18n>${T('Free AI models usually take 20 to 60 seconds. Once it’s written it’s saved, so it opens instantly next time.')}</p>
        </div>
      </div>`;
  }

  function showLoadError(err) {
    $('#lbody').innerHTML = `
      <div class="lload lload--error" role="alert">
        <div>
          <p class="lload__title" data-i18n>${T('This lesson couldn’t be written')}</p>
          <p data-i18n>${T(err && err.message ? err.message : 'Something went wrong.')}</p>
          <div class="lload__actions" data-i18n>
            <button class="btn btn--small" type="button" data-retry>${T('Try again')}</button>
            <a class="textlink" href="${outlineHref}">${T('Back to the outline')}</a>
          </div>
        </div>
      </div>`;
    $('#lbody [data-retry]').addEventListener('click', () => {
      course = P.courses.get(course.id) || course;
      loadLesson();
    });
  }

  /* ------------------------------------------------------------------
     Layout bits
  ------------------------------------------------------------------ */
  function showMessage(title, text, href, label) {
    const main = $('#main');
    main.className = 'wrap';
    main.innerHTML = `<div class="lmsg card card--solid"><h1>${esc(title)}</h1><p>${esc(text)}</p><p style="margin-top:1.3rem"><a class="btn" href="${href}">${esc(label)}</a></p></div>`;
    const tools = $('.lbar__tools');
    if (tools) tools.hidden = true;
  }

  function renderSide() {
    const prog = course.progress || {};
    let html = '';
    let lastUnit = -1;
    flat.forEach((l) => {
      if (l.unitIndex !== lastUnit) {
        html += `<p class="side__unit">Unit ${P.roman(l.unitIndex)}: ${esc(l.unit)}</p>`;
        lastUnit = l.unitIndex;
      }
      const done = prog[l.n] && prog[l.n].done;
      html += `<a href="${lessonHref(l.n)}" class="${done ? 'is-done' : ''}"${l.n === n ? ' aria-current="page"' : ''}>` +
        `<span class="side__n" aria-hidden="true">${done ? '✓' : l.n}</span>` +
        `<span>${esc(l.title)}${done ? '<span class="sr-only"> (completed)</span>' : ''}</span></a>`;
    });
    const side = $('#side');
    side.innerHTML = html;
    const cur = side.querySelector('[aria-current]');
    if (cur) side.scrollTop = Math.max(0, cur.offsetTop - side.clientHeight / 2);
  }

  function renderNav() {
    const prev = flat[n - 2], next = flat[n];
    $('#lnav').innerHTML =
      (prev ? `<a href="${lessonHref(prev.n)}"><small>Previous lesson</small>${esc(prev.title)}</a>` : '') +
      (next ? `<a class="lnav__next" href="${lessonHref(next.n)}"><small>Next lesson</small>${esc(next.title)}</a>` : '');
  }

  /* ------------------------------------------------------------------
     Lesson rendering
  ------------------------------------------------------------------ */
  function start(L) {
    if (!L) { showLoadError(new Error('This lesson isn’t in the course.')); return; }
    lesson = L;
    sections = L.sections;
    $('#lbody').innerHTML = '';
    course = P.courses.get(course.id) || course;
    prog = P.courses.progress(course, n);
    prog.answered = prog.answered || {};
    prog.tries = prog.tries || {};

    renderHead();
    // the course's own words in their language, direction and script's font: titles come from the outline,
    // and the lesson's body is in the learner's language when it was translated for them
    if (P.contentLang) {
      ['#lesson-title', '#side', '#lbar-course'].forEach((sel) => P.contentLang($(sel), P.api.lessonLang(course)));
      P.contentLang($('#lbody'), L.translated ? P.lang : P.api.lessonLang(course));
    }
    if (P.voice) P.voice.init({ course, n, sections, sectionEl: (i) => $(`#sec-${i}`), unlocked: () => unlocked });
    renderParts();
    save();
    if (allComplete()) finish();

    let notebook = null;
    const board = P.initDoubts({
      paper,
      courseId: course.id,
      lessonN: n,
      lessonTitle: meta.title,
      wbToggle: $('#wb-toggle'),
      bar: $('#wb-bar'),
      countEl: $('#doubts-count'),
      drawerToggle: $('#doubts-toggle'),
      drawer: $('#doubts'),
      onSketchChange: (strokes) => { if (notebook) notebook.onPageSketch(strokes); }
    });
    notebook = P.initNotebook({ course, n, lessonTitle: meta.title, toggle: $('#nb-toggle'), board, paper });

    // Watch mode (assets/js/video.js) follows the same lesson as videos, with the same questions and progress.
    if (P.watch) {
      P.watch.start({
        course: () => course, n, meta, flat, lesson, sections, prog: () => prog,
        question: renderQuestion, sectionComplete, finish, rerender: renderParts, lessonHref, outlineHref
      });
    }
  }

  // The parts written so far, up to the first unanswered checkpoint (again after Watch mode).
  function renderParts() {
    $('#lbody').innerHTML = '';
    renderSection(0, false);
    unlocked = 0;
    while (unlocked < sections.length - 1 && sectionComplete(unlocked)) {
      unlocked++;
      renderSection(unlocked, false);
    }
    updateLock();
    updateSegs();
  }

  function renderHead() {
    const style = course.style || [];
    $('#lhead').innerHTML = `
      <p class="lhead__pos">Lesson ${n} of ${flat.length}, in Unit ${P.roman(meta.unitIndex)}: ${esc(meta.unit)}</p>
      <h1 id="lesson-title">${esc(lesson.title)}</h1>
      <div class="lhead__meta"><span>About ${lesson.minutes} minutes</span>${style.map((s) => `<span class="lhead__style">${esc(s.label)}</span>`).join('')}${lesson.model ? `<span class="lhead__model">Written by ${esc(lesson.model.replace(/:free$/, ''))}</span>` : ''}</div>
      ${lesson.draft ? '<p class="draft-note"><strong>Draft lesson.</strong> The full AI-written theory, diagrams and questions will appear here once the course generator is connected. The checkpoints below already work, so you can try the flow.</p>' : ''}
      ${translationNote()}
      <p class="lhead__tip">Select any sentence to ask a doubt about it, or open the whiteboard to sketch on these notes.</p>`;
    const tr = $('#lhead [data-tr]');
    if (tr) tr.addEventListener('click', () => { P.api.setTranslation(course, tr.dataset.tr === 'on'); location.reload(); });
  }

  // A lesson written in another language than the learner's: offer it in theirs, or the original back.
  function translationNote() {
    const from = P.api.lessonLang(course);
    if (course.source === 'sample' || !P.lang || from === P.lang || !P.LANGS) return '';
    const fromName = P.langName ? P.langName(from) : from; // in the interface language
    const toName = (P.LANGS[P.lang] || {}).name || P.lang;
    return lesson.translated
      ? `<p class="trnote">Translated from ${esc(fromName)}. <button class="textlink" type="button" data-tr="off">Show the original</button></p>`
      : `<p class="trnote">This lesson is written in ${esc(fromName)}. <button class="textlink" type="button" data-tr="on">Read it in ${esc(toName)}</button></p>`;
  }

  function blockHTML(b, i) {
    const id = `data-block="${i}"`;
    switch (b.t) {
      case 'p': return `<p ${id}>${b.html}</p>`;
      case 'h': return `<h3 ${id}>${esc(b.text)}</h3>`;
      case 'math': return `<div class="math-display" ${id}>$$${esc(b.tex)}$$</div>`;
      case 'list': return `<ul ${id}>${b.items.map((it) => `<li>${it}</li>`).join('')}</ul>`;
      case 'figure': return `<figure class="fig" ${id}>${b.svg ? b.svg : `<img src="${esc(b.src)}" alt="${esc(b.alt || '')}" loading="lazy">`}${b.caption ? `<figcaption>${b.caption}</figcaption>` : ''}</figure>`;
      case 'callout': return `<aside class="callout callout--${esc(b.kind || 'note')}" ${id}>${b.title ? `<div class="callout__title">${esc(b.title)}</div>` : ''}<div class="callout__body">${b.html}</div></aside>`;
      case 'photo': return P.photos ? P.photos.html(b, { attr: ` ${id}` }) : '';
      default: return '';
    }
  }

  function renderSection(i, animate) {
    const s = sections[i];
    const el = document.createElement('section');
    el.className = 'lsec' + (animate ? ' is-new' : '');
    el.id = `sec-${i}`;
    el.dataset.sec = String(i);
    el.setAttribute('aria-labelledby', `sec-${i}-title`);
    el.innerHTML = `<h2 class="lsec__title" id="sec-${i}-title">${esc(s.title)}</h2>
      <div class="lsec__content" data-doubtable>${s.blocks.map(blockHTML).join('')}</div>`;
    if (s.checkpoint && s.checkpoint.length) {
      const cp = document.createElement('div');
      cp.className = 'checkpoint';
      const more = i < sections.length - 1;
      const count = s.checkpoint.length;
      cp.innerHTML = `<p class="checkpoint__title" data-i18n>${CHECK_SVG}${T('Check your understanding')}</p>
        <p class="checkpoint__sub" data-i18n>${T(more ? (count > 1 ? `Answer all ${count} to open the next part of the lesson.` : 'Answer to open the next part of the lesson.') : 'Answer to finish the lesson.')}</p>`;
      s.checkpoint.forEach((q) => cp.appendChild(renderQuestion(q, i)));
      el.appendChild(cp);
    }
    $('#lbody').appendChild(el);
    P.math(el);
    if (P.voice) P.voice.decorate(el, i);
    return el;
  }

  /* ------------------------------------------------------------------
     Questions
  ------------------------------------------------------------------ */
  // ctx (optional, Watch mode): { section: what to revise after a wrong answer, reread() and
  // rereadLabel: going back to the video, onAnswered(q): called once the question is answered }.
  // A question that isn't one of the lesson's own checkpoints is rendered with secIdx null.
  function renderQuestion(q, secIdx, ctx) {
    const w = document.createElement('form');
    w.className = 'q';
    w.noValidate = true;
    w.dataset.q = q.id;
    const pid = `q-${q.id}-prompt`;
    let body = `<div class="q__prompt" id="${pid}" data-doubtable>${q.prompt}</div>`;
    if (q.type === 'choice') {
      body += `<div class="q__choices" role="radiogroup" aria-labelledby="${pid}">` +
        q.choices.map((c, ci) => `<label class="q__choice"><input type="radio" name="q-${q.id}" value="${ci}"><span>${c}</span></label>`).join('') +
        '</div>';
    } else if (q.type === 'subjective') {
      body += `<textarea class="q__textarea" aria-labelledby="${pid}" maxlength="3000" placeholder="${T('Write your answer in your own words')}"></textarea>`;
    } else {
      body += `<div class="q__row"><input class="q__input" type="text" inputmode="${q.type === 'numeric' ? 'decimal' : 'text'}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-labelledby="${pid}" placeholder="${T(q.type === 'numeric' ? 'Your answer' : 'Type your answer')}" data-i18n>${q.unit ? `<span class="q__unit">${esc(q.unit)}</span>` : ''}</div>`;
    }
    body += `<div class="q__actions" data-i18n><button class="btn btn--small q__check" type="submit">${T(q.type === 'subjective' ? 'Submit answer' : 'Check')}</button></div>
      <div class="q__feedback" role="status" aria-live="polite"></div>
      <div class="q__revise" hidden></div>`;
    w.innerHTML = body;

    w.addEventListener('change', (e) => {
      if (e.target.type === 'radio') $$('.q__choice', w).forEach((l) => l.classList.toggle('is-checked', l.querySelector('input').checked));
    });
    w.addEventListener('submit', (e) => {
      e.preventDefault();
      check(q, w, secIdx, ctx);
    });

    const done = prog.answered[q.id];
    if (done) restore(q, w, done);
    return w;
  }

  function readValue(q, w) {
    if (q.type === 'choice') {
      const r = w.querySelector('input[type="radio"]:checked');
      return r ? r.value : '';
    }
    if (q.type === 'subjective') return w.querySelector('textarea').value.trim();
    return w.querySelector('.q__input').value.trim();
  }

  function setFeedback(w, kind, html) {
    const f = w.querySelector('.q__feedback');
    f.className = 'q__feedback' + (kind ? ` is-${kind}` : '');
    f.innerHTML = html;
    P.math(f);
  }

  function lockQ(w, on) {
    w.classList.toggle('is-locked', on);
    $$('input, textarea, .q__check', w).forEach((el) => { el.disabled = on; });
  }

  const answerText = (q) => {
    if (q.type === 'choice') return q.choices[q.answer];
    if (q.type === 'numeric') return `${q.answer}${q.unit ? ' ' + esc(q.unit) : ''}`;
    if (q.type === 'text') return esc((q.accept || [])[0] || '');
    return '';
  };

  function answered(secIdx, ctx, q) {
    if (secIdx != null) afterAnswer(secIdx);
    if (ctx && ctx.onAnswered) ctx.onAnswered(q);
  }

  async function check(q, w, secIdx, ctx) {
    if (prog.answered[q.id] || w.classList.contains('is-locked')) return;
    const value = readValue(q, w);
    if (!value) {
      setFeedback(w, 'warn', T(q.type === 'choice' ? 'Choose an answer first.' : q.type === 'subjective' ? 'Write your answer first.' : 'Enter an answer first.'));
      return;
    }

    if (q.type === 'subjective') {
      lockQ(w, true);
      setFeedback(w, 'warn', T('Saving your answer…'));
      await P.api.submitSubjective(course, n, q, value);
      record(q, { status: 'submitted', value });
      showSubmitted(q, w, true);
      answered(secIdx, ctx, q);
      return;
    }

    const res = P.api.checkAnswer(q, value);
    if (res.invalid) {
      setFeedback(w, 'warn', T('Enter a number, like 7, 2.5 or 3/4.'));
      return;
    }
    prog.tries[q.id] = (prog.tries[q.id] || 0) + 1;
    if (res.correct) {
      if (P.sfx) P.sfx.play('correct');
      record(q, { status: 'correct', value, tries: prog.tries[q.id] });
      showCorrect(q, w);
      answered(secIdx, ctx, q);
    } else {
      if (P.sfx) P.sfx.play('wrong');
      save();
      P.api.recordMistake(course, n, meta.title, q, value);
      await showWrong(q, w, secIdx, value, ctx);
    }
  }

  function showCorrect(q, w) {
    w.classList.remove('is-wrong');
    w.classList.add('is-correct');
    lockQ(w, true);
    w.querySelector('.q__revise').hidden = true;
    setFeedback(w, 'correct', `<strong data-i18n>${T('Correct.')}</strong>${q.explain ? `<span class="explain">${q.explain}</span>` : ''}`);
  }

  async function showWrong(q, w, secIdx, value, ctx) {
    const tries = prog.tries[q.id];
    const section = (ctx && ctx.section) || sections[secIdx];
    w.classList.add('is-wrong');
    lockQ(w, true);
    setFeedback(w, 'wrong', `<strong>${T('Not quite.')}</strong> ${T('Revise this part of the lesson, then try again.')}`);

    const panel = w.querySelector('.q__revise');
    const rev = await P.api.getRevision(course, lesson, section, q, value);
    panel.innerHTML = `
      <h4>${T('Revise: ' + section.title)}</h4>
      <p>${T('The key points from this part of the lesson:')}</p>
      <ul>${rev.points.map((p) => `<li>${p}</li>`).join('')}</ul>
      ${tries >= 2 && q.hint ? `<p class="q__hint"><strong>${T('Hint:')}</strong> ${q.hint}</p>` : ''}
      <div class="q__revise-actions">
        <button class="btn btn--small" type="button" data-retry>${T('I’ve revised, try again')}</button>
        <button class="textlink" type="button" data-reread>${ctx && ctx.rereadLabel ? esc(T(ctx.rereadLabel)) : T('Re-read the section')}</button>
        ${tries >= 3 ? `<button class="textlink" type="button" data-reveal>${T('Show the answer')}</button>` : ''}
      </div>`;
    panel.hidden = false;
    P.math(panel);
    panel.querySelector('[data-retry]').addEventListener('click', () => retry(q, w));
    panel.querySelector('[data-reread]').addEventListener('click', () => (ctx && ctx.reread ? ctx.reread() : reread(secIdx)));
    const rv = panel.querySelector('[data-reveal]');
    if (rv) rv.addEventListener('click', () => reveal(q, w, secIdx, ctx));
    panel.querySelector('[data-retry]').focus({ preventScroll: true });
  }

  function retry(q, w) {
    w.classList.remove('is-wrong');
    lockQ(w, false);
    w.querySelector('.q__revise').hidden = true;
    setFeedback(w, '', '');
    if (q.type === 'choice') {
      $$('input', w).forEach((r) => { r.checked = false; });
      $$('.q__choice', w).forEach((l) => l.classList.remove('is-checked'));
      w.querySelector('input').focus();
    } else {
      const inp = w.querySelector('.q__input');
      inp.focus();
      inp.select();
    }
  }

  function reread(secIdx) {
    const content = $(`#sec-${secIdx} .lsec__content`);
    $(`#sec-${secIdx}`).scrollIntoView({ behavior: smooth(), block: 'start' });
    content.classList.remove('is-flash');
    void content.offsetWidth;
    content.classList.add('is-flash');
  }

  function reveal(q, w, secIdx, ctx) {
    record(q, { status: 'revealed', tries: prog.tries[q.id] });
    showRevealed(q, w);
    answered(secIdx, ctx, q);
  }

  function showRevealed(q, w) {
    w.classList.remove('is-wrong');
    w.classList.add('is-revealed');
    lockQ(w, true);
    w.querySelector('.q__revise').hidden = true;
    if (q.type === 'choice') {
      const ans = $$('.q__choice', w)[q.answer];
      if (ans) ans.classList.add('is-answer');
    }
    setFeedback(w, 'revealed', `<strong data-i18n>${T('Answer:')}</strong> ${answerText(q)}${q.explain ? `<span class="explain">${q.explain}</span>` : ''}`);
  }

  function showSubmitted(q, w, fresh) {
    lockQ(w, true);
    setFeedback(w, 'submitted', `<strong data-i18n>${T('Answer saved.')}</strong>`);
    if (q.model && !w.querySelector('.model')) {
      const d = document.createElement('details');
      d.className = 'model';
      d.innerHTML = `<summary data-i18n>${T('Compare with a model answer')}</summary><div class="model__body">${q.model}</div>`;
      w.appendChild(d);
      P.math(d);
    }
    if (P.marking) P.marking.show({ course, n, q, w, value: readValue(q, w), fresh: Boolean(fresh) });
  }

  function restore(q, w, a) {
    if (q.type === 'choice' && a.value != null) {
      const r = w.querySelector(`input[value="${CSS.escape(String(a.value))}"]`);
      if (r) { r.checked = true; r.closest('.q__choice').classList.add('is-checked'); }
    } else if (q.type === 'subjective') {
      w.querySelector('textarea').value = a.value || '';
    } else if (a.value != null) {
      w.querySelector('.q__input').value = a.value;
    }
    if (a.status === 'correct') showCorrect(q, w);
    else if (a.status === 'revealed') showRevealed(q, w);
    else if (a.status === 'submitted') showSubmitted(q, w);
  }

  /* ------------------------------------------------------------------
     Progress, unlocking, completion
  ------------------------------------------------------------------ */
  function record(q, data) {
    prog.answered[q.id] = Object.assign({ at: Date.now() }, data);
    save();
  }
  function save() {
    P.courses.setProgress(course.id, n, prog);
    course = P.courses.get(course.id) || course;
  }
  const sectionComplete = (i) => (sections[i].checkpoint || []).every((q) => prog.answered[q.id]);
  const allComplete = () => sections.every((s, i) => sectionComplete(i));

  function afterAnswer(secIdx) {
    updateSegs();
    if (!sectionComplete(secIdx)) return;
    let opened = null;
    while (unlocked < sections.length - 1 && sectionComplete(unlocked)) {
      unlocked++;
      const el = renderSection(unlocked, true);
      if (!opened) opened = el;
    }
    updateLock();
    updateSegs();
    if (opened && !allComplete() && P.sfx) setTimeout(() => P.sfx.play('unlock'), 420);
    if (opened) {
      // bring the new part into view without yanking the answer off-screen
      setTimeout(() => {
        const title = opened.querySelector('.lsec__title');
        const top = title.getBoundingClientRect().top;
        if (top > window.innerHeight - 140) window.scrollBy({ top: top - (window.innerHeight - 280), behavior: smooth() });
      }, P.motion.reduce ? 0 : 500);
    }
    if (allComplete()) finish();
  }

  function updateLock() {
    const remaining = sections.length - 1 - unlocked;
    const lock = $('#llock');
    if (remaining > 0) {
      lock.hidden = false;
      lock.innerHTML = `${LOCK_SVG}<span>${remaining === 1 ? 'One more part of this lesson opens' : `${remaining} more parts of this lesson open`} when you answer the checkpoint above.</span>`;
    } else {
      lock.hidden = true;
    }
  }

  function updateSegs() {
    let done = 0;
    $('#segs').innerHTML = sections.map((s, i) => {
      const complete = i <= unlocked && sectionComplete(i);
      if (complete) done++;
      return `<span class="seg${complete ? ' is-done' : i === unlocked ? ' is-current' : ''}"></span>`;
    }).join('');
    $('#segs').setAttribute('aria-label', `Lesson progress: ${done} of ${sections.length} parts done`);
  }

  // asked: the questions the learner answered, when they weren't the lesson's checkpoints (Watch mode's quizzes)
  function finish(asked) {
    if (!prog.done) {
      if (P.sfx) setTimeout(() => P.sfx.play('complete'), 500);
      prog.done = true;
      prog.doneAt = Date.now();
      save();
    }
    const qs = (Array.isArray(asked) ? asked : sections.flatMap((s) => s.checkpoint || [])).filter((q) => q.type !== 'subjective');
    const firstTry = qs.filter((q) => { const a = prog.answered[q.id]; return a && a.status === 'correct' && (a.tries || 1) === 1; }).length;
    const revealed = qs.filter((q) => { const a = prog.answered[q.id]; return a && a.status === 'revealed'; }).length;
    const next = flat[n];
    const box = $('#ldone');
    box.innerHTML = `<h2>Lesson complete</h2>
      <p>${qs.length ? `You got ${firstTry} of ${qs.length} question${qs.length > 1 ? 's' : ''} right on the first try${revealed ? `, and revealed ${revealed} answer${revealed > 1 ? 's' : ''}` : ''}.` : 'Nice work.'}</p>
      <div class="ldone__actions">
        ${next ? `<a class="btn" href="${lessonHref(next.n)}">Next: ${esc(next.title)}</a>` : `<a class="btn" href="${outlineHref}">Back to the course</a>`}
        <a class="textlink" href="${outlineHref}">Course outline</a>
      </div>`;
    box.hidden = false;
    renderSide();
  }
  } // run
})();
