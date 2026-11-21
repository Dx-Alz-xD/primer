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
  // shown on a course whose topic was reframed for safety (server/safety.mjs)
  const SAFETY_NOTES = {
    harm: 'Primer teaches this subject’s science, history and safety, and how harm is prevented, never how to cause it.',
    hate: 'Primer teaches this as critical history: what the ideas claimed, why people followed them, and why they are rejected.',
    selfharm: 'If you’re going through a hard time, you don’t have to face it alone. In India, call Tele-MANAS on 14416, free and at any time.'
  };
  const smooth = () => (P.motion.reduce ? 'auto' : 'smooth');

  const courseId = P.params.get('course');
  // Folders are a nice-to-have here: if they don't load, the library still works without them.
  Promise.all([P.courses.load(), P.folders.load().catch((err) => { console.warn('[Primer] folders:', err.message); })]).then(() => {
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

    // Which folder to file the new course in (shown once the learner has folders).
    const folderSel = $('#b-folder');
    const syncFolders = () => {
      const keep = folderSel.value;
      folderSel.innerHTML = P.folders.options(null);
      folderSel.value = P.folders.get(keep) ? keep : '';
      $('#b-folder-field').hidden = !P.folders.list().length;
    };
    syncFolders();
    document.addEventListener('primer:folders', syncFolders);

    // The language the course is written in: the interface language unless the learner picks another.
    // Each language by its own name, with its name in the interface language beside it.
    const langSel = $('#b-lang');
    const fillLangs = () => {
      const keep = langSel.value || P.lang || 'en';
      const opt = (code) => {
        const C = P.COURSE_LANGS[code], local = P.langName(code);
        return `<option value="${code}" lang="${code}">${esc(C.name)}${local && local !== C.name ? ` · ${esc(local)}` : ''}</option>`;
      };
      const more = P.MORE_LANGS.slice().sort((a, b) => P.langName(a).localeCompare(P.langName(b), P.lang));
      langSel.innerHTML = Object.keys(P.LANGS).map(opt).join('') +
        `<optgroup label="${esc(P.t('More languages'))}">${more.map(opt).join('')}</optgroup>`;
      langSel.value = P.COURSE_LANGS[keep] ? keep : 'en';
    };
    if (langSel && P.COURSE_LANGS) { fillLangs(); P.tReady.then(fillLangs); }

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
      const busy = P.shelves.busy();
      if (busy) {
        P.toast(`Topics are still being added to “${busy.name}”. Wait for them to finish, or cancel them first.`, 'error');
        return;
      }
      const folderId = folderSel.value ? Number(folderSel.value) : null;

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
        const course = await P.api.generateCourse({
          topic: t, from: from.value, to: to.value, instructions: instr.value,
          extra: { folderId, syllabus: P.syllabus ? P.syllabus.value() : '', lang: langSel && langSel.value ? langSel.value : undefined }
        });
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

    // The library: one shelf per folder, plus the unfiled courses.
    P.shelves.mount($('#shelves'), {
      onAddOne(f) {
        syncFolders();
        folderSel.value = String(f.id);
        form.scrollIntoView({ block: 'start', behavior: smooth() });
        topic.focus({ preventScroll: true });
        P.toast(`The next course you build will be filed in “${f.name}”.`);
      }
    });
    offerImport();
    if (P.classes) P.classes.mountLibrary();
    if (location.hash === '#library') requestAnimationFrame(() => $('#library').scrollIntoView());
    else topic.focus({ preventScroll: true });
  }

  function renderLibrary() {
    P.shelves.render();
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
    const rangeHTML = () => {
      const from = course.from ? `<span class="ugc">${esc(P.cap(course.from))}</span>` : '';
      const to = course.to ? `<span class="ugc">${esc(course.to)}</span>` : '';
      const line = from ? (to ? '{from} to {to}' : '{from} to the end of the subject') : (to ? 'The very beginning to {to}' : 'The very beginning to the end of the subject');
      return esc(P.t ? P.t(line) : line).replace('{from}', () => from).replace('{to}', () => to);
    };
    const lang = course.lang || 'en';
    const langRow = P.COURSE_LANGS && lang !== P.lang
      ? `<dt>Language</dt><dd><span lang="${esc(lang)}" data-no-i18n>${esc((P.COURSE_LANGS[lang] || {}).name || lang)}</span></dd>` : '';
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

    const lib = course.source === 'library' && course.library ? course.library : null;
    const libText = lib
      ? (lib.offset === 0 && flat.length === lib.total
        ? `From the shared library: all ${lib.total} lessons of “${esc(lib.subject)}”.`
        : `From the shared library: lessons ${lib.offset + 1}–${lib.offset + flat.length} of “${esc(lib.subject)}”.`)
      : '';
    const folderRow = P.folders.list().length
      ? `<dt class="noprint"><label for="c-folder">Folder</label></dt>
         <dd class="noprint"><select class="select select--small" id="c-folder">${P.folders.options(course.folderId)}</select></dd>`
      : '';

    view.innerHTML = `
      <a class="backlink" href="app.html">All courses</a>
      <header class="course-head card card--solid">
        <h1>${esc(course.title)}</h1>
        <p class="course-head__meta">${flat.length} lessons in ${course.units.length} units, about ${duration}</p>
        ${lib ? `<p class="course-head__lib"><span>${libText}</span> <span data-lib-more></span></p>` : ''}
        ${course.syllabus ? `<details class="course-head__syl"><summary>Follows your syllabus</summary><p class="course-head__syltext ugc">${esc(course.syllabus)}</p></details>` : ''}
        ${course.source === 'sample' && course.aiError ? `<p class="course-head__note">This is a sample outline, because the AI couldn’t be reached: ${esc(course.aiError)}</p>` : ''}
        ${course.safety && SAFETY_NOTES[course.safety.kind] ? `<p class="course-head__note">${SAFETY_NOTES[course.safety.kind]}</p>` : ''}
        <div data-fit-slot></div>
        <dl class="spec">
          <dt>Topic</dt><dd>${esc(course.topic)}</dd>
          <dt>Range</dt><dd data-range>${rangeHTML()}</dd>
          <dt>Teaching</dt><dd>${teaching}</dd>
          ${langRow}
          ${folderRow}
        </dl>
        <div class="course-head__progress">
          <div class="bar" role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax="${stats.total}" aria-valuenow="${stats.done}"><span style="width:${stats.pct}%"></span></div>
          <p>${stats.done} of ${stats.total} lessons complete</p>
        </div>
        <div data-review-slot></div>
        <div class="course-head__actions">
          <a class="btn" href="${lessonHref(course.id, resume)}">${cta}</a>
          <a class="textlink" href="book.html?course=${encodeURIComponent(course.id)}">Read as a book</a>
          <button class="textlink" type="button" data-epub>Download EPUB</button>
          <button class="textlink" type="button" data-print>Save outline as PDF</button>
          <a class="textlink" href="community.html?share=${encodeURIComponent(course.id)}">Share to Community</a>
          <button class="textlink" type="button" data-delete>Delete course</button>
        </div>
        <div data-offline-slot></div>
      </header>
      <ol class="units">${unitsHTML}</ol>`;

    if (P.review) P.review.courseCard(view.querySelector('[data-review-slot]'), course.id); // "2 to review · 1 of 3 mistakes fixed"
    // the range again once the dictionary is in, if the page was drawn before it
    if (P.tReady) P.tReady.then(() => { const dd = view.querySelector('[data-range]'); if (dd) dd.innerHTML = rangeHTML(); });
    // the course's own words (its title, units and lessons) in its language, its direction and its script's font
    if (P.contentLang) [view.querySelector('.course-head h1'), view.querySelector('.units')].forEach((el) => P.contentLang(el, lang));

    // The quiet note when the AI thinks this topic doesn't belong in its folder.
    const fitSlot = view.querySelector('[data-fit-slot]');
    const paintFit = () => {
      const miss = P.folders.misfit(course);
      fitSlot.innerHTML = miss ? P.folders.fitNote(course, miss) : '';
    };
    paintFit();
    fitSlot.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dismiss-fit]');
      if (!b) return;
      fitSlot.innerHTML = '';
      view.querySelector('h1').setAttribute('tabindex', '-1');
      view.querySelector('h1').focus();
      P.folders.dismissFit(course.id).catch((err) => P.toast('Couldn’t dismiss the note: ' + err.message, 'error'));
    });
    if (P.folders.needsFit(course)) P.folders.checkFit(course.folderId, [course.id]).then((n) => { if (n) paintFit(); });

    const folderSel = view.querySelector('#c-folder');
    if (folderSel) {
      folderSel.addEventListener('change', async () => {
        const before = course.folderId;
        const to = folderSel.value ? Number(folderSel.value) : null;
        folderSel.disabled = true;
        try {
          await P.folders.move(course.id, to);
          paintFit();
          const f = P.folders.get(to);
          P.toast(f ? `Moved to “${f.name}”.` : 'Moved out of its folder.');
          if (f && await P.folders.checkFit(f.id, [course.id])) paintFit();
        } catch (err) {
          folderSel.value = before == null ? '' : String(before);
          P.toast('Couldn’t move the course: ' + err.message, 'error');
        } finally {
          folderSel.disabled = false;
        }
      });
    }

    // How many learners share this shared-library subject.
    if (lib) {
      P.get(`/api/library/${encodeURIComponent(lib.id)}`).then((d) => {
        const s = d.subject;
        const more = view.querySelector('[data-lib-more]');
        if (!more) return;
        const who = s.learners > 1 ? `Shared by ${s.learners} learners.` : 'You’re the first learner to use it.';
        const ready = s.written ? ` ${s.written} of its ${s.lessons} lessons are already written, so they open at once.` : '';
        more.textContent = who + ready;
      }).catch(() => {});
    }

    // "Download for offline" (assets/js/offline.js)
    if (P.offline) P.offline.mountCourse(view.querySelector('[data-offline-slot]'), course);
    view.querySelector('[data-epub]').addEventListener('click', (e) => P.epub.download(course.id, e.currentTarget));
    view.querySelector('[data-print]').addEventListener('click', () => window.print());
    view.querySelector('[data-delete]').addEventListener('click', async (e) => {
      if (!window.confirm(`Delete “${course.title}” and all its progress? This can’t be undone.${P.classes ? P.classes.deleteWarning(course) : ''}`)) return;
      e.target.disabled = true;
      try {
        await P.courses.remove(course.id);
        location.href = 'app.html';
      } catch (err) {
        e.target.disabled = false;
        P.toast('Couldn’t delete the course: ' + err.message, 'error');
      }
    });
    if (P.classes) P.classes.mountCourse(view, course);
  }
})();
