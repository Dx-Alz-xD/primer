/* =====================================================================
   paper.html: a test on paper, for a classroom without devices.

     ?test=<id>        a test, or a paper copy of a unit or final exam
     ?attempt=<id>     an exam or test that was handed in
     ?worksheet=<id>   a class's most-missed questions (its teacher only)

   The question paper (the course, the date, a line for a name, the
   questions with room to write, no answers) and, on its own page, the
   answer key. Printing is the browser's: its dialog also saves a PDF.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, esc = P.esc;
  if (!P.auth.current() || !P.exams) return;
  P.mountUserNav();

  const W = P.exams.words, H = P.exams.hrefs;
  const t = W.t, fill = W.fill;
  const root = $('#pp-root');
  const LETTERS = 'ABCDEF';
  const clean = (html) => P.sanitizeHTML(html);
  const MATH = {
    delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
    throwOnError: false, strict: 'ignore'
  };
  let mathLater = null;
  const math = (el) => {
    if (window.renderMathInElement) { try { window.renderMathInElement(el, MATH); } catch (e) { console.warn('[Primer] maths', e); } } else mathLater = el;
  };
  window.addEventListener('load', () => { if (mathLater) math(mathLater); });
  const BOOK = '<svg viewBox="0 0 32 32" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M16 9.2c-3-2.3-7-2.7-11-1.6v16c4-1.1 8-.7 11 1.6 3-2.3 7-2.7 11-1.6v-16c-4-1.1-8-.7-11 1.6z"/><path d="M16 9.2v16"/></svg>';

  function today() {
    try { return new Date().toLocaleDateString(P.lang || 'en', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return new Date().toDateString(); }
  }

  /* ---------- what to print, from each kind of source ---------- */
  function fromTest(x) {
    const paper = x.kind === 'paper';
    return {
      title: paper ? (x.unit ? W.examName(x.unit) : esc(t('Final exam'))) : x.title ? `<span data-no-i18n>${esc(x.title)}</span>` : esc(t('Test')),
      subtitle: paper ? (x.unitTitle || '') : x.title ? '' : null,
      subtitleHTML: !paper && !x.title ? W.lessonsLabel(x.lessons) : '',
      course: x.course, minutes: x.minutes, questions: x.questions, lessons: x.lessonInfo || {},
      pass: true, back: paper ? H.outline(x.course.id) : H.test(x.id)
    };
  }
  function fromAttempt(a, id) {
    const title = a.kind === 'unit' ? W.examName(a.unit) : a.kind === 'final' ? esc(t('Final exam')) : a.title ? `<span data-no-i18n>${esc(a.title)}</span>` : esc(t('Test'));
    return { title, subtitle: a.unitTitle || '', course: a.course, minutes: a.minutes, questions: a.questions, lessons: a.lessons || {}, pass: true, back: H.attempt(id) };
  }
  function fromWorksheet(w) {
    return {
      title: esc(t('Worksheet')), subtitleHTML: `${esc(t('Questions the class finds hard'))} · <span data-no-i18n>${esc(w.class.name)}</span>`,
      course: w.course, minutes: null, lessons: {}, pass: false, worksheet: w,
      questions: w.questions.map((q) => Object.assign({}, q, { type: q.type === 'written' ? 'open' : q.type })),
      back: `class.html?id=${w.class.id}`
    };
  }

  /* ---------- the question paper ---------- */
  const lines = (n) => `<div class="pp-lines" aria-hidden="true">${'<span></span>'.repeat(n)}</div>`;
  function questionHTML(q, k) {
    let body = '';
    if (q.type === 'choice') {
      body = `<ol class="pp-choices">${q.choices.map((c, i) => `<li><span class="pp-bubble" aria-hidden="true">${LETTERS[i]}</span><span data-no-i18n>${clean(c)}</span></li>`).join('')}</ol>`;
    } else if (q.type === 'numeric' || q.type === 'text') {
      body = `<p class="pp-short"><span>${esc(t('Answer:'))}</span><span class="pp-short__line"></span>${q.unit ? `<span data-no-i18n>${esc(q.unit)}</span>` : ''}</p>`;
    } else {
      body = lines(q.type === 'subjective' ? 7 : 5);
    }
    return `<li class="pp-q" value="${k}">
        <div class="pp-q__prompt" data-no-i18n>${clean(q.prompt)}</div>
        ${q.type === 'subjective' ? `<p class="pp-q__marks">${esc(t('(1 mark)'))}</p>` : ''}
        ${body}
      </li>`;
  }

  function keyHTML(q, k, ws) {
    let ans, more = '';
    if (q.type === 'choice') {
      ans = LETTERS[q.answer];
      more = `<span data-no-i18n>${clean(q.choices[q.answer])}</span>${q.explain ? `<p class="pp-key__why" data-no-i18n>${clean(q.explain)}</p>` : ''}`;
    } else if (q.type === 'numeric') {
      ans = '=';
      more = `<span data-no-i18n>${esc(String(q.answer))}${q.unit ? ' ' + esc(q.unit) : ''}</span>${q.explain ? `<p class="pp-key__why" data-no-i18n>${clean(q.explain)}</p>` : ''}`;
    } else if (q.type === 'text') {
      ans = '=';
      more = `<span data-no-i18n>${esc((q.accept || []).join(' / '))}</span>${q.explain ? `<p class="pp-key__why" data-no-i18n>${clean(q.explain)}</p>` : ''}`;
    } else {
      ans = '✎';
      const model = q.model ? clean(q.model) : q.correct ? esc(q.correct) : '';
      more = model ? `<span class="pp-key__label">${esc(t('A model answer:'))}</span> <span data-no-i18n>${model}</span>` : `<span class="pp-key__label">${esc(t('Mark against the lesson.'))}</span>`;
      if (q.type === 'subjective') more += `<p class="pp-key__why">${esc(t('1 mark for an answer that gets the main idea right, half a mark for one on the right track that misses a key point.'))}</p>`;
    }
    const note = ws ? `<p class="pp-key__note">${fill('Missed by {n} of {total} students', { n: q.students, total: ws.members })}${q.lessonTitle ? ` · ${fill('Lesson {n}', { n: q.lesson })}: <span data-no-i18n>${esc(q.lessonTitle)}</span>` : ''}</p>` : '';
    return `<li class="pp-key__item" value="${k}"><span class="pp-key__ans" aria-hidden="true">${ans}</span><div class="pp-key__body">${more}${note}</div></li>`;
  }

  function render(p) {
    const qs = p.questions;
    const choice = qs.filter((q) => q.type === 'choice');
    const short = qs.filter((q) => q.type === 'numeric' || q.type === 'text');
    const written = qs.filter((q) => q.type === 'subjective' || q.type === 'open');
    const order = choice.concat(short, written);
    const num = new Map(order.map((q, i) => [q, i + 1]));
    const part = (label, list, sub) => (list.length ? `<section class="pp-part">
        <h2 class="pp-part__title">${esc(label)}</h2>${sub ? `<p class="pp-part__sub">${esc(sub)}</p>` : ''}
        <ol class="pp-qs">${list.map((q) => questionHTML(q, num.get(q))).join('')}</ol></section>` : '');
    const parts = [choice.length ? 1 : 0, short.length ? 1 : 0, written.length ? 1 : 0].reduce((a, b) => a + b, 0);
    const letter = (i) => (parts > 1 ? `${'ABC'[i]} · ` : '');
    let pi = 0;
    const sections = [
      choice.length ? part(`${letter(pi++)}${t('Multiple choice')}`, choice, t('Circle the letter of the one right answer.')) : '',
      short.length ? part(`${letter(pi++)}${t('Short answers')}`, short, t('Write your answer on the line.')) : '',
      written.length ? part(`${letter(pi++)}${t('Written answers')}`, written, t('Answer in full sentences, in your own words, in the space below each question.')) : ''
    ].join('');
    const rules = [
      p.minutes ? fill('Time allowed: {m} minutes', { m: p.minutes }) : '',
      qs.length === 1 ? esc(t('1 question')) : fill('{n} questions', { n: qs.length }),
      p.pass ? esc(t('1 mark each · pass mark 60%')) : ''
    ].filter(Boolean).join(' · ');

    root.innerHTML = `
      <div class="pp-tools">
        <a class="textlink" href="${p.back}">${esc(t('Back'))}</a>
        <button class="btn btn--small" type="button" data-print>${esc(t('Print or save as PDF'))}</button>
        <label class="pp-opt"><input type="checkbox" data-key checked> ${esc(t('Add the answer key, on its own page'))}</label>
        <p class="pp-tip">${esc(t('In the print dialog, choose “Save as PDF” to keep a copy, or a printer to make copies for the class.'))}</p>
      </div>
      <article class="pp-sheet" aria-labelledby="pp-title">
        <header class="pp-head">
          <div class="pp-head__top"><span class="pp-brand">${BOOK} Primer</span><span class="pp-date">${esc(today())}</span></div>
          <p class="pp-course" data-no-i18n>${esc(p.course.title)}</p>
          <h1 id="pp-title">${p.title}</h1>
          ${p.subtitle ? `<p class="pp-sub" data-no-i18n>${esc(p.subtitle)}</p>` : p.subtitleHTML ? `<p class="pp-sub">${p.subtitleHTML}</p>` : ''}
          <div class="pp-fields">
            <span class="pp-field"><span>${esc(t('Name'))}</span><span class="pp-field__line"></span></span>
            <span class="pp-field pp-field--short"><span>${esc(t('Class'))}</span><span class="pp-field__line"></span></span>
            ${p.pass ? `<span class="pp-field pp-field--short"><span>${esc(t('Marks'))}</span><span class="pp-field__line"></span><span>/ ${qs.length}</span></span>` : ''}
          </div>
          <p class="pp-rules">${rules}</p>
        </header>
        ${sections}
        <p class="pp-end">${esc(t('End of the paper'))}</p>
      </article>
      <article class="pp-sheet pp-key" aria-labelledby="pp-key-title">
        <header class="pp-head pp-head--key">
          <div class="pp-head__top"><span class="pp-brand">${BOOK} Primer</span><span class="pp-date">${esc(t('For the teacher'))}</span></div>
          <p class="pp-course" data-no-i18n>${esc(p.course.title)}</p>
          <h2 id="pp-key-title" class="pp-key__title">${esc(t('Answer key'))}: ${p.title}</h2>
          <p class="pp-rules">${esc(t('Keep this page apart from the question papers.'))}</p>
        </header>
        <ol class="pp-key__list">${order.map((q) => keyHTML(q, num.get(q), p.worksheet)).join('')}</ol>
      </article>`;
    document.title = `${root.querySelector('#pp-title').textContent} | Primer`;
    if (P.contentLang) P.$$('.pp-sheet', root).forEach((el) => P.contentLang(el, p.course.lang || 'en'));
    math(root);
    $('[data-print]', root).addEventListener('click', () => window.print());
    $('[data-key]', root).addEventListener('change', (e) => document.body.classList.toggle('pp-no-key', !e.target.checked));
  }

  (async () => {
    try {
      const prm = P.params;
      let paper;
      if (prm.get('test')) paper = fromTest((await P.get(`/api/tests/${Number(prm.get('test'))}`)).test);
      else if (prm.get('attempt')) paper = fromAttempt((await P.get(`/api/exams/${Number(prm.get('attempt'))}/paper`)).paper, Number(prm.get('attempt')));
      else if (prm.get('worksheet')) paper = fromWorksheet((await P.get(`/api/classes/${Number(prm.get('worksheet'))}/worksheet`)).worksheet);
      else throw new Error(t('This link doesn’t point to a paper to print.'));
      if (!paper.questions.length) throw new Error(t('There are no questions to print yet.'));
      render(paper);
    } catch (err) {
      root.innerHTML = `<div class="pp-msg card card--solid"><h1>${esc(t('This paper didn’t open'))}</h1><p>${esc(err.message)}</p>
        <p class="pp-msg__go"><a class="btn" href="app.html#library">${esc(t('Go to your courses'))}</a></p></div>`;
    }
  })();
})();
