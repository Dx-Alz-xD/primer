/* =====================================================================
   app.html: build a course (topic + optional range + teaching
   instructions), see your library, and view a course outline.
   app.html?course=<id> shows the outline; app.html?topic=... prefills.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  if (!P.auth.current()) return; // the inline guard is already redirecting
  P.mountUserNav();

  const SURPRISE = [
    'The history of the printing press', 'How vaccines train the immune system', 'Beginner chess openings',
    'The basics of music theory', 'Roman architecture', 'How neural networks learn', 'Bookbinding by hand',
    'Mushroom identification', 'How the stock market works', 'Latin for beginners', 'The physics of rainbows',
    "Shakespeare's sonnets", 'The science of sourdough', 'Map projections', 'Organic chemistry'
  ];
  const lessonHref = (id, n) => `lesson.html?course=${encodeURIComponent(id)}&lesson=${n}`;
  const smooth = () => (P.motion.reduce ? 'auto' : 'smooth');

  const courseId = P.params.get('course');
  P.courses.load().then(() => {
    if (courseId) showCourse(courseId);
    else showBuilder();
  }).catch((err) => {
    $('#view-build').hidden = true;
    const view = $('#view-course');
    view.hidden = false;
    view.innerHTML = `<div class="notfound card card--solid"><h1>Your courses didn’t load</h1><p>${esc(err.message)}</p>
      <p style="margin-top:1.3rem"><button class="btn" type="button" data-reload>Try again</button></p></div>`;
    view.querySelector('[data-reload]').addEventListener('click', () => location.reload());
  });

  // Courses kept by the old browser-only version can be moved into the account once.
  function offerImport() {
    const legacy = P.legacyCourses();
    if (!legacy.length) return;
    const bar = document.createElement('div');
    bar.className = 'import card card--solid';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Courses saved in this browser');
    bar.innerHTML = `<p><strong>${legacy.length} course${legacy.length > 1 ? 's are' : ' is'} saved only in this browser.</strong> Move ${legacy.length > 1 ? 'them' : 'it'} into your account so ${legacy.length > 1 ? 'they follow' : 'it follows'} you to any device.</p>
      <div class="import__actions"><button class="btn btn--small" type="button" data-import>Move to my account</button><button class="textlink" type="button" data-skip>Not now</button></div>`;
    $('#library').before(bar);
    bar.querySelector('[data-skip]').addEventListener('click', () => bar.remove());
    bar.querySelector('[data-import]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const n = await P.courses.importLegacy();
        bar.remove();
        renderLibrary();
        P.toast(`Moved ${n} course${n === 1 ? '' : 's'} into your account.`);
      } catch (err) {
        e.target.disabled = false;
        P.toast('Couldn’t move the courses: ' + err.message, 'error');
      }
    });
  }

  /* ------------------------------------------------------------------
     Builder
  ------------------------------------------------------------------ */
  function showBuilder() {
    $('#view-build').hidden = false;
    $('#view-course').hidden = true;

    const form = $('#builder');
    const topic = $('#b-topic'), from = $('#b-from'), to = $('#b-to'), instr = $('#b-instr');
    const topicErr = $('#b-topic-err');

    const pre = P.params.get('topic');
    if (pre) {
      topic.value = P.clean(pre, 120);
      history.replaceState(null, '', 'app.html' + location.hash);
    }

    let lastSurprise = '';
    $$('[data-topic], [data-surprise]', form).forEach((chip) => {
      chip.addEventListener('click', () => {
        let t = chip.dataset.topic;
        if (chip.hasAttribute('data-surprise')) {
          do { t = P.pick(SURPRISE); } while (t === lastSurprise);
          lastSurprise = t;
        }
        topic.value = t;
        clearTopicError();
        topic.focus();
      });
    });

    const instrChips = $$('[data-instr]', form);
    const syncInstr = () => instrChips.forEach((c) => c.setAttribute('aria-pressed', String(instr.value.includes(c.dataset.instr))));
    instrChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const phrase = chip.dataset.instr;
        let v = instr.value;
        if (v.includes(phrase)) v = v.replace(phrase, '').replace(/\s{2,}/g, ' ').trim();
        else v = (v.trim() ? v.trim().replace(/([^.!?])$/, '$1.') + ' ' : '') + phrase;
        instr.value = v;
        syncInstr();
      });
    });
    instr.addEventListener('input', syncInstr);

    const clearTopicError = () => { topicErr.textContent = ''; topic.removeAttribute('aria-invalid'); };
    topic.addEventListener('input', clearTopicError);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = P.clean(topic.value, 120);
      if (!t) {
        topicErr.textContent = 'Name a topic to build a course on.';
        topic.setAttribute('aria-invalid', 'true');
        topic.focus();
        P.shake(topic);
        return;
      }
      clearTopicError();

      const building = $('#building');
      form.hidden = true;
      $('#library').hidden = true;
      building.hidden = false;
      $('#building-topic').textContent = `“${t}”`;
      const steps = $$('#building-steps li');
      steps.forEach((li) => { li.className = ''; });
      let i = 0;
      steps[0].classList.add('is-active');
      const tick = setInterval(() => {
        if (i < steps.length - 1) {
          steps[i].className = 'is-done';
          i++;
          steps[i].className = 'is-active';
        }
      }, P.motion.reduce ? 60 : 540);
      building.scrollIntoView({ block: 'center', behavior: smooth() });

      try {
        const course = await P.api.generateCourse({ topic: t, from: from.value, to: to.value, instructions: instr.value });
        clearInterval(tick);
        steps.forEach((li) => { li.className = 'is-done'; });
        P.courses.save(course);
        await P.delay(P.motion.reduce ? 0 : 350);
        location.href = 'app.html?course=' + encodeURIComponent(course.id);
      } catch (err) {
        console.error(err);
        clearInterval(tick);
        building.hidden = true;
        form.hidden = false;
        $('#library').hidden = false;
        P.toast('Something went wrong while planning the course. Try again.', 'error');
      }
    });

    renderLibrary();
    offerImport();
    if (location.hash === '#library') requestAnimationFrame(() => $('#library').scrollIntoView());
    else topic.focus({ preventScroll: true });
  }

  function renderLibrary() {
    const grid = $('#library-grid');
    const list = P.courses.list();
    $('#library-empty').hidden = list.length > 0;
    grid.innerHTML = list.map((c) => {
      const s = P.courses.stats(c);
      const sameAsTopic = c.title.toLowerCase() === c.topic.toLowerCase();
      return `<a class="ccard card card--solid" href="app.html?course=${encodeURIComponent(c.id)}">
          <h3>${esc(c.title)}</h3>
          ${sameAsTopic ? '' : `<p class="ccard__topic">${esc(c.topic)}</p>`}
          <p class="ccard__meta">${s.done} of ${s.total} lessons done</p>
          <div class="bar" aria-hidden="true"><span style="width:${s.pct}%"></span></div>
        </a>`;
    }).join('');
  }

  /* ------------------------------------------------------------------
     Course outline
  ------------------------------------------------------------------ */
  function showCourse(id) {
    $('#view-build').hidden = true;
    const view = $('#view-course');
    view.hidden = false;

    const course = P.courses.get(id);
    if (!course) {
      view.innerHTML = `<div class="notfound card card--solid">
          <h1>Course not found</h1>
          <p>It may have been deleted, or it was built in another browser.</p>
          <p style="margin-top:1.3rem"><a class="btn" href="app.html">Build a course</a></p>
        </div>`;
      return;
    }

    document.title = `${course.title} | Primer`;
    P.courses.touch(id);
    const flat = P.courseGen.flatten(course);
    const stats = P.courses.stats(course);
    const prog = course.progress || {};
    const mins = flat.reduce((a, l) => a + (l.minutes || 0), 0);
    const duration = mins < 90 ? `${mins} minutes` : `${Math.round(mins / 30) / 2} hours`;
    const started = Object.keys(prog).length > 0;
    const resume = P.courses.resumeAt(course);
    const cta = !started ? 'Start lesson 1' : stats.done === stats.total ? 'Review from lesson 1' : `Continue with lesson ${resume}`;
    const range = `${course.from ? esc(P.cap(course.from)) : 'The very beginning'} to ${course.to ? esc(course.to) : 'the end of the subject'}`;
    const teaching = course.instructions ? `“${esc(course.instructions)}”` : 'No special instructions';

    const unitsHTML = course.units.map((u, ui) => {
      const rows = flat.filter((l) => l.unitIndex === ui + 1).map((l) => {
        const p = prog[l.n];
        const done = !!(p && p.done);
        const inProgress = !done && p && Object.keys(p.answered || {}).length > 0;
        const tags = (l.tags || []).map((t) => `<span class="tag">${esc(P.TAGS[t] || t)}</span>`).join('');
        return `<li><a class="lrow${done ? ' is-done' : ''}" href="${lessonHref(course.id, l.n)}">
            <span class="lrow__n" aria-hidden="true">${done ? '✓' : l.n}</span>
            <span>
              <span class="lrow__title"><span class="sr-only">Lesson ${l.n}${done ? ', completed' : ''}: </span>${esc(l.title)}</span>
              <span class="lrow__desc">${esc(l.desc)}</span>
              ${tags ? `<span class="lrow__tags">${tags}</span>` : ''}
            </span>
            <span class="lrow__side">${l.minutes} min${done ? '<span class="lrow__status">Done</span>' : inProgress ? '<span class="lrow__status">In progress</span>' : ''}</span>
          </a></li>`;
      }).join('');
      return `<li class="unit">
          <h2 class="unit__title"><span class="unit__num">Unit ${P.roman(ui + 1)}</span> ${esc(u.title)}</h2>
          <ol class="lessons">${rows}</ol>
        </li>`;
    }).join('');

    view.innerHTML = `
      <a class="backlink" href="app.html">All courses</a>
      <header class="course-head card card--solid">
        <h1>${esc(course.title)}</h1>
        <p class="course-head__meta">${flat.length} lessons in ${course.units.length} units, about ${duration}</p>
        ${course.source === 'sample' && course.aiError ? `<p class="course-head__note">This is a sample outline, because the AI couldn’t be reached: ${esc(course.aiError)}</p>` : ''}
        <dl class="spec">
          <dt>Topic</dt><dd>${esc(course.topic)}</dd>
          <dt>Range</dt><dd>${range}</dd>
          <dt>Teaching</dt><dd>${teaching}</dd>
        </dl>
        <div class="course-head__progress">
          <div class="bar" role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax="${stats.total}" aria-valuenow="${stats.done}"><span style="width:${stats.pct}%"></span></div>
          <p>${stats.done} of ${stats.total} lessons complete</p>
        </div>
        <div class="course-head__actions">
          <a class="btn" href="${lessonHref(course.id, resume)}">${cta}</a>
          <a class="textlink" href="book.html?course=${encodeURIComponent(course.id)}">Read as a book</a>
          <button class="textlink" type="button" data-epub>Download EPUB</button>
          <button class="textlink" type="button" data-print>Save outline as PDF</button>
          <button class="textlink" type="button" data-delete>Delete course</button>
        </div>
      </header>
      <ol class="units">${unitsHTML}</ol>`;

    view.querySelector('[data-epub]').addEventListener('click', (e) => P.epub.download(course.id, e.currentTarget));
    view.querySelector('[data-print]').addEventListener('click', () => window.print());
    view.querySelector('[data-delete]').addEventListener('click', async (e) => {
      if (!window.confirm(`Delete “${course.title}” and all its progress? This can’t be undone.`)) return;
      e.target.disabled = true;
      try {
        await P.courses.remove(course.id);
        location.href = 'app.html';
      } catch (err) {
        e.target.disabled = false;
        P.toast('Couldn’t delete the course: ' + err.message, 'error');
      }
    });
  }
})();
