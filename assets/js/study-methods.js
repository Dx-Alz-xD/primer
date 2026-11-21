/* =====================================================================
   Study methods: how a learner chooses to study a course, and what the
   lesson page does differently for each one (server/study.mjs keeps the
   choice and what each method writes down).

   - recall      Active recall: each part's checkpoint question comes
                 first; the learner answers from memory, then reads.
   - feynman     After each part, explain it simply; the AI marks the
                 explanation like a written answer (POST /api/answers/mark).
   - cornell     The notebook becomes a Cornell page: cues, notes and a
                 summary, kept in the lesson's notes.
   - mindmap     Each part's key points as a map to drag, extend and
                 annotate (assets/js/mindmap.js), saved with the lesson.
   - sq3r        Survey the headings, write questions, read, recite each
                 answer from memory, review them all at the end.
   - interleave  Review mixes questions from every course; lessons end
                 with a mixed review.
   - spaced      Review's schedule, explained, with what comes back when.
   - pomodoro    Lessons offer a focus block on the study timer.
   With no method chosen, lessons are exactly as they always were.

   P.study.METHODS, .methodOf(id), .setMethod(id, m), .pick(id),
   P.study.courseData(id)   method, time studied and per-lesson numbers
   P.study.duration(ms)     "3 h 20 min"
   Listens for primer:course (app.js), primer:lesson (lesson.js),
   primer:notes (notebook.js) and primer:review (review.js).
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  const T = (s) => esc(t(s));
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const NL = String.fromCharCode(10);

  const svg = (d) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const METHODS = [
    {
      id: 'recall', name: 'Active recall', tag: 'Answer first, then read.',
      icon: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.5"/><path d="M12 16.8h.01"/>'),
      how: 'Before each part of a lesson opens, you see its checkpoint question and answer it from memory. A guess is fine. Then you read the part and answer the checkpoint for real, with your first answer beside it to compare.',
      why: 'Trying to recall an answer, even when you get it wrong, makes the reading that follows stick far better than reading alone. Psychologists call it the testing effect, or pretesting.'
    },
    {
      id: 'feynman', name: 'Feynman technique', tag: 'Explain each part simply.',
      icon: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 10.5h7"/><path d="M8.5 13.5h4.5"/>'),
      how: 'After each part, you explain it in your own words, as if to a friend who has never studied it. Primer’s AI marks your explanation like a written answer and names the key points you left out.',
      why: 'Explaining in plain words shows the gaps you can’t see while reading: wherever you reach for jargon or get stuck is what to go back to. It is named after the physicist Richard Feynman.'
    },
    {
      id: 'cornell', name: 'Cornell notes', tag: 'Cues, notes and a summary.',
      icon: svg('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9.5 3v12.5"/><path d="M4 15.5h16"/><path d="M12 7h5.5M12 10.5h5.5"/>'),
      how: 'Your notebook opens as a Cornell page for each lesson: notes on the right as you read, questions and key words (cues) in the left column afterwards, and a short summary at the bottom when you finish.',
      why: 'The cues turn your notes into questions you can test yourself with: cover the notes and answer each cue. Writing the summary makes you pick out what matters.'
    },
    {
      id: 'mindmap', name: 'Mind map', tag: 'See how the ideas connect.',
      icon: svg('<circle cx="12" cy="12" r="2.6"/><circle cx="4.5" cy="6" r="1.8"/><circle cx="19.5" cy="6" r="1.8"/><circle cx="5" cy="18.5" r="1.8"/><circle cx="19" cy="18.5" r="1.8"/><path d="M9.8 10.4L6 7.2M14.2 10.4L18 7.2M9.9 13.7l-3.5 3.5M14.1 13.7l3.5 3.5"/>'),
      how: 'Each part of a lesson gets a map: its title in the middle and its key points around it. Drag the ideas into an order that makes sense to you, add ideas of your own and notes on any of them. Maps are saved with the lesson.',
      why: 'Arranging ideas yourself makes you decide how they relate, and a picture beside the words gives your memory a second way in. Researchers call this elaboration and dual coding.'
    },
    {
      id: 'sq3r', name: 'SQ3R', tag: 'Survey, question, read, recite, review.',
      icon: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2"/><circle cx="5" cy="18" r="1.2"/>'),
      how: 'Survey the lesson’s headings first and turn each one into a question. Read each part looking for its answer, recite the answer from memory when the part ends, and review all your questions and answers at the end of the lesson.',
      why: 'Reading with a question in mind keeps you looking for meaning instead of skimming, and reciting is retrieval practice. Francis Robinson described the method in 1946, and it is still taught.'
    },
    {
      id: 'interleave', name: 'Interleaving', tag: 'Mix your practice.',
      icon: svg('<path d="M4 7h3.5c2.5 0 3.6 1.4 5 5s2.5 5 5 5H20"/><path d="M4 17h3.5c1.3 0 2.2-.4 2.9-1.2M14.1 8.2c.7-.8 1.6-1.2 2.9-1.2H20"/><path d="M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5"/>'),
      how: 'Review mixes the questions from all your courses instead of taking one course or one lesson at a time, and each lesson ends by suggesting a short mixed review.',
      why: 'When topics are mixed you have to work out which idea each question needs, not just repeat the last one. It feels harder, but studies find it leads to better learning weeks later than practising one topic in a block.'
    },
    {
      id: 'spaced', name: 'Spaced repetition', tag: 'Come back just before you forget.',
      icon: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8 13.5h2M12 13.5h2M8 17h2"/>'),
      how: 'Primer’s Review already does this: a question you get wrong comes back the next day, then 3 days later, until you have answered it right twice in a row. With this method each lesson tells you what will come back, and when.',
      why: 'Practice spread out over days beats the same amount crammed into one sitting, for remembering things weeks later. This is the spacing effect, one of the best-established findings about memory.'
    },
    {
      id: 'pomodoro', name: 'Pomodoro', tag: 'Focus in short blocks.',
      icon: svg('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.8"/><path d="M12 13.5l2.6 1.6"/><path d="M9.5 3h5"/>'),
      how: 'Study in 25-minute focus blocks with a 5-minute break after each, and a longer break after every four. The timer in the top bar keeps time as you move between pages, plays a soft sound and can notify you when a block ends. Each lesson offers to start a block.',
      why: 'A short, fixed block makes it easier to start and to keep your attention on one thing, and regular breaks hold off fatigue. Francesco Cirillo devised it in the 1980s with a tomato-shaped kitchen timer.'
    }
  ];
  const BY_ID = Object.fromEntries(METHODS.map((m) => [m.id, m]));
  const NONE = { id: '', name: 'No method', tag: 'Primer’s usual lessons: read each part, then answer its checkpoint.' };

  const methods = Object.assign({}, P.boot.studyMethods || {});
  const methodOf = (courseId) => (courseId && BY_ID[methods[courseId]] ? methods[courseId] : '');

  /* ---------------- numbers and formatting ---------------- */
  function duration(ms) {
    const mins = Math.round((ms || 0) / 60000);
    if (mins < 1) return t('less than a minute');
    if (mins < 60) return fill('{m} min', { m: mins });
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? fill('{h} h {m} min', { h, m }) : fill('{h} h', { h });
  }

  const dataCache = new Map();
  function courseData(id, fresh) {
    if (fresh || !dataCache.has(id)) {
      dataCache.set(id, P.get('/api/study/course/' + encodeURIComponent(id)).then((d) => {
        if (d.method) methods[id] = d.method; else delete methods[id];
        return d;
      }).catch((err) => { dataCache.delete(id); throw err; }));
    }
    return dataCache.get(id);
  }

  async function setMethod(courseId, method) {
    await P.put('/api/study/course/' + encodeURIComponent(courseId), { method: method || '' });
    if (method) methods[courseId] = method; else delete methods[courseId];
    document.dispatchEvent(new CustomEvent('primer:method', { detail: { courseId, method: method || '' } }));
  }

  /* ---------------- "How it works and why" ---------------- */
  const howHTML = (m) => `<p><strong>${T('How it works:')}</strong> ${T(m.how)}</p><p><strong>${T('Why it works:')}</strong> ${T(m.why)}</p>`;

  /* ---------------- choosing a method ---------------- */
  function pick(courseId, title) {
    return new Promise((resolve) => {
      const cur = methodOf(courseId);
      const dlg = document.createElement('dialog');
      dlg.className = 'smpick';
      dlg.setAttribute('aria-labelledby', 'smpick-title');
      const opt = (m) => `
        <div class="smopt${m.id === cur ? ' is-current' : ''}">
          <label class="smopt__pick">
            <input type="radio" name="smpick" value="${m.id}"${m.id === cur ? ' checked' : ''}>
            ${m.icon ? `<span class="smopt__icon">${m.icon}</span>` : '<span class="smopt__icon smopt__icon--none" aria-hidden="true"></span>'}
            <span class="smopt__text"><span class="smopt__name">${T(m.name)}</span><span class="smopt__tag">${T(m.tag)}</span></span>
          </label>
          ${m.how ? `<details class="smopt__how"><summary>${T('How it works and why')}</summary>${howHTML(m)}</details>` : ''}
        </div>`;
      dlg.innerHTML = `
        <form method="dialog" class="smpick__form">
          <header class="smpick__head">
            <h2 id="smpick-title">${T('How do you want to study this course?')}</h2>
            ${title ? `<p class="smpick__course ugc">${esc(title)}</p>` : ''}
            <p class="smpick__sub">${T('Primer changes how its lessons work to match. You can switch at any time; nothing you have done is lost.')}</p>
          </header>
          <div class="smpick__list" role="radiogroup" aria-labelledby="smpick-title">${opt(NONE)}${METHODS.map(opt).join('')}</div>
          <footer class="smpick__foot">
            <button class="btn" type="submit" value="ok">${T('Use this method')}</button>
            <button class="textlink" type="submit" value="cancel" formnovalidate>${T('Cancel')}</button>
          </footer>
        </form>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => {
        const chosen = dlg.returnValue === 'ok' ? (dlg.querySelector('input[name="smpick"]:checked') || {}).value : null;
        dlg.remove();
        resolve(chosen == null ? null : chosen);
      });
      dlg.showModal();
      const checked = dlg.querySelector('input:checked') || dlg.querySelector('input');
      if (checked) checked.focus();
    });
  }

  async function choose(courseId, title, after) {
    const chosen = await pick(courseId, title);
    if (chosen == null || chosen === methodOf(courseId)) return;
    try {
      await setMethod(courseId, chosen);
      P.toast(chosen ? fill('Studying with {method} now.', { method: t(BY_ID[chosen].name) }) : t('Back to Primer’s usual lessons.'));
      if (after) after(chosen);
    } catch (err) {
      P.toast(fill('Couldn’t change the study method: {error}', { error: err.message }), 'error');
    }
  }

  /* ======================================================================
     The course page: the method, the time studied
     ====================================================================== */
  document.addEventListener('primer:course', (e) => mountCourse(e.detail.view, e.detail.course));

  function mountCourse(view, course) {
    const anchor = view.querySelector('.course-head__progress');
    if (!anchor) return;
    const outer = document.createElement('div');
    outer.className = 'smcourse';
    outer.innerHTML = '<div class="smcourse__main"></div>'; // other tools add rows after this (reminders.js)
    anchor.after(outer);
    const box = outer.firstElementChild;
    let data = null;
    const paint = () => {
      const id = methodOf(course.id);
      const m = BY_ID[id];
      const extra = id === 'pomodoro' && P.timer ? `<button class="textlink" type="button" data-focus>${T('Start a focus block')}</button>`
        : id === 'interleave' ? `<a class="textlink" href="review.html">${T('Mixed review')}</a>`
        : id === 'spaced' ? `<a class="textlink" href="review.html?course=${encodeURIComponent(course.id)}">${T('Review this course')}</a>` : '';
      box.innerHTML = `
        <div class="smcourse__row">
          <span class="smcourse__icon">${m ? m.icon : svg('<path d="M12 6.4c-2.3-1.7-5.3-2-8.2-1.2v12c2.9-.8 5.9-.5 8.2 1.2 2.3-1.7 5.3-2 8.2-1.2v-12c-2.9-.8-5.9-.5-8.2 1.2z"/><path d="M12 6.4v12"/>')}</span>
          <p class="smcourse__text"><span class="smcourse__label">${T('Study method')}</span>
            <strong>${T(m ? m.name : 'None chosen')}</strong>
            <span class="smcourse__tag">${T(m ? m.tag : 'Pick one and Primer’s lessons change to match it.')}</span></p>
          <span class="smcourse__acts">${extra}<button class="btn btn--ghost btn--small" type="button" data-pick>${T(m ? 'Change method' : 'Choose a method')}</button></span>
        </div>
        ${m ? `<details class="smcourse__how"><summary>${T('How it works and why')}</summary>${howHTML(m)}</details>` : ''}
        <p class="smcourse__time" data-time>${timeLine()}</p>`;
      box.querySelector('[data-pick]').addEventListener('click', () => choose(course.id, course.title, paint));
      const f = box.querySelector('[data-focus]');
      if (f) f.addEventListener('click', () => P.timer.start({ mode: 'pomodoro', course: { id: course.id, title: course.title } }));
    };
    const timeLine = () => {
      if (!data) return '';
      if (!data.ms) return T('No study time yet. Time in this course’s lessons and on the study timer is counted here.');
      const parts = [fill('{time} studied', { time: duration(data.ms) })];
      if (data.sessions) parts.push(data.sessions === 1 ? t('1 focus session') : fill('{n} focus sessions', { n: data.sessions }));
      return esc(parts.join(' · '));
    };
    paint();
    courseData(course.id, true).then((d) => { data = d; paint(); }).catch(() => {});
    if (P.tReady) P.tReady.then(paint);
  }

  /* ======================================================================
     The lesson page
     ====================================================================== */
  let L = null;       // the lesson (from lesson.js) and what the method keeps for it
  let notesIn = false; // the notebook has loaded its notes
  document.addEventListener('primer:notes', () => { notesIn = true; if (L && L.method === 'cornell') cornellSheet(); });
  document.addEventListener('primer:lesson', (e) => startLesson(e.detail));
  document.addEventListener('primer:method', (e) => {
    if (L && e.detail.courseId === L.course().id) { teardown(); L.method = e.detail.method; apply(); }
  });

  const markable = () => ['ai', 'library'].includes(L.course().source);
  const sectionDone = (i) => (L.sections[i].checkpoint || []).every((q) => L.prog().answered[q.id]);
  const lbody = () => $('#lbody');
  const plain = (html) => { const d = document.createElement('div'); d.innerHTML = P.sanitizeHTML(html); return d.textContent.replace(/\s+/g, ' ').trim(); };

  function startLesson(ctx) {
    L = Object.assign({}, ctx, { method: methodOf(ctx.course().id), pages: null, pagesP: null, saveTimers: {} });
    // parts appear as checkpoints are answered (and again after Watch mode): decorate each one as it does
    new MutationObserver((muts) => {
      if (!L.method) return;
      muts.forEach((m) => m.addedNodes.forEach((node) => {
        if (node.nodeType === 1 && node.matches('section.lsec[data-sec]')) withPages(() => decorate(node, Number(node.dataset.sec)));
      }));
    }).observe(lbody(), { childList: true });
    const done = $('#ldone');
    if (done) new MutationObserver(() => { if (L.method && !done.hidden) withPages(endCard); }).observe(done, { attributes: true, attributeFilter: ['hidden'] });
    apply();
    // the choice may have changed on another device since this page was drawn
    courseData(ctx.course().id).then((d) => {
      if (L && (d.method || '') !== L.method) { teardown(); L.method = d.method || ''; apply(); }
    }).catch(() => {});
  }

  // What the methods kept for this lesson (guesses, questions, maps, explanations).
  function withPages(fn) {
    if (L.pages) { fn(); return; }
    if (!L.pagesP) {
      const id = encodeURIComponent(L.course().id);
      L.pagesP = P.get(`/api/study/pages/${id}/${L.n}`)
        .catch(() => ({ recall: {}, sq3r: {}, mindmap: {}, feynman: {}, feynmanMarks: {} }))
        .then((d) => { L.pages = d; ['recall', 'sq3r', 'mindmap', 'feynman', 'feynmanMarks'].forEach((k) => { L.pages[k] = L.pages[k] || {}; }); return d; });
    }
    L.pagesP.then(() => { if (L.method) fn(); });
  }

  function savePage(kind, delay = 700) {
    clearTimeout(L.saveTimers[kind]);
    L.saveTimers[kind] = setTimeout(() => {
      const id = encodeURIComponent(L.course().id);
      P.put(`/api/study/pages/${id}/${L.n}/${kind}`, { data: L.pages[kind] }, { keepalive: true })
        .then(() => flashSaved(kind))
        .catch((err) => {
          if (err.status === 401) return;
          const retry = !err.status || err.status >= 500 || err.status === 429; // offline, or the server is busy
          if (!retry || !L.warned) P.toast(fill('Not saved yet: {error}', { error: err.message }), 'error');
          if (retry) { L.warned = true; savePage(kind, 8000); }
        });
    }, delay);
  }
  function flashSaved(kind) {
    $$(`[data-saved="${kind}"]`).forEach((el) => {
      el.textContent = t('Saved');
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.textContent = ''; }, 2400);
    });
  }

  function teardown() {
    $$('.smdeco').forEach((el) => el.remove());
    $$('.sm-veiled').forEach((el) => el.classList.remove('sm-veiled'));
    const page = $('#nb-write');
    if (page) page.classList.remove('is-cornell');
    if (L && L.unwrapNotebook) { L.unwrapNotebook(); L.unwrapNotebook = null; }
    if (L && L.offTimer) { L.offTimer(); L.offTimer = null; }
  }

  function apply() {
    if (!L.method) return;
    mountBar();
    withPages(() => {
      if (L.method === 'sq3r') survey();
      $$('section.lsec[data-sec]', lbody()).forEach((sec) => decorate(sec, Number(sec.dataset.sec)));
      const done = $('#ldone');
      if (done && !done.hidden) endCard();
    });
    if (L.method === 'cornell') cornellSheet();
  }

  /* ---------- the bar under the lesson's title ---------- */
  function mountBar() {
    const m = BY_ID[L.method];
    if (!m) return;
    const bar = document.createElement('div');
    bar.className = 'smbar smdeco';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', t('Study method'));
    const action = {
      cornell: `<button class="btn btn--small" type="button" data-open-nb>${T('Open my Cornell notes')}</button>`,
      pomodoro: P.timer ? `<button class="btn btn--small" type="button" data-focus>${T('Start a focus block')}</button>` : '',
      interleave: `<a class="btn btn--small" href="review.html">${T('Mixed review')}</a>`,
      spaced: `<a class="btn btn--small" href="review.html?course=${encodeURIComponent(L.course().id)}">${T('Review this course')}</a>`
    }[L.method] || '';
    bar.innerHTML = `
      <span class="smbar__icon">${m.icon}</span>
      <p class="smbar__text"><span class="smbar__label">${T('Study method')}</span> <strong>${T(m.name)}</strong> <span class="smbar__tag">${T(m.tag)}</span><span class="smbar__live" data-live></span></p>
      <span class="smbar__acts">${action}<button class="textlink" type="button" data-how aria-expanded="false">${T('How it works')}</button><button class="textlink" type="button" data-change>${T('Change')}</button></span>
      <div class="smbar__how" hidden>${howHTML(m)}</div>`;
    $('#lhead').after(bar);
    const how = bar.querySelector('.smbar__how'), howBtn = bar.querySelector('[data-how]');
    howBtn.addEventListener('click', () => { how.hidden = !how.hidden; howBtn.setAttribute('aria-expanded', String(!how.hidden)); });
    bar.querySelector('[data-change]').addEventListener('click', () => choose(L.course().id, L.course().title));
    const nb = bar.querySelector('[data-open-nb]');
    if (nb) nb.addEventListener('click', () => openNotebook('#smc-notes'));
    const focus = bar.querySelector('[data-focus]');
    if (focus && P.timer) {
      const live = bar.querySelector('[data-live]');
      const sync = (s) => {
        const busy = s.status !== 'idle';
        focus.hidden = busy;
        live.textContent = busy ? ' · ' + P.timer.describe(s) : '';
      };
      focus.addEventListener('click', () => P.timer.start({ mode: 'pomodoro', course: { id: L.course().id, title: L.course().title } }));
      L.offTimer = P.timer.on(sync);
    }
    if (L.method === 'interleave' || L.method === 'spaced') {
      const live = bar.querySelector('[data-live]');
      const due = P.review ? P.review.due() : 0;
      if (due) live.textContent = ' · ' + (due === 1 ? t('1 question due in Review') : fill('{n} questions due in Review', { n: due }));
    }
  }

  function openNotebook(focusSel) {
    const toggle = $('#nb-toggle');
    if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
    const tab = $('#nb-tab-write');
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
    const el = focusSel && $(focusSel);
    if (el) setTimeout(() => el.focus(), 60);
  }

  /* ---------- each part of the lesson ---------- */
  function decorate(sec, i) {
    if (!L.sections[i] || sec.closest('.vstep') || sec.querySelector(':scope > .smdeco')) return;
    if (L.method === 'recall') recall(sec, i);
    else if (L.method === 'feynman') feynman(sec, i);
    else if (L.method === 'mindmap') mindmap(sec, i);
    else if (L.method === 'sq3r') sq3rPart(sec, i);
  }

  const deco = (tag, cls) => {
    const el = document.createElement(tag);
    el.className = cls + ' smdeco';
    el.setAttribute('data-i18n', '');
    return el;
  };

  /* Active recall: the question first, from memory; then the part. */
  function recall(sec, i) {
    const s = L.sections[i];
    const qs = s.checkpoint || [];
    if (!qs.length) return;
    const kept = L.pages.recall[i];
    if (sectionDone(i) || (kept && kept.read)) { guessNote(sec, kept); return; }
    sec.classList.add('sm-veiled');
    const panel = deco('div', 'smrecall');
    panel.innerHTML = `
      <p class="smdeco__eyebrow">${T('Recall first')}</p>
      <p class="smdeco__lead">${T(qs.length > 1 ? 'Before you read this part, answer its questions from memory. A guess is fine: trying first makes what you read next stick.' : 'Before you read this part, answer its question from memory. A guess is fine: trying first makes what you read next stick.')}</p>
      <ol class="smrecall__qs" data-no-i18n>${qs.map((q) => `<li><div class="smrecall__q">${q.prompt}</div>${q.type === 'choice' && Array.isArray(q.choices) ? `<ul class="smrecall__choices">${q.choices.map((c) => `<li>${c}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>
      <label class="smdeco__label" for="smrecall-${i}">${T('Your answer from memory')}</label>
      <textarea class="smdeco__text" id="smrecall-${i}" rows="3" maxlength="2000" placeholder="${T('What do you think the answer is? It isn’t marked.')}">${esc((kept && kept.guess) || '')}</textarea>
      <div class="smdeco__actions">
        <button class="btn btn--small" type="button" data-read>${T('Now read the part')}</button>
        <button class="textlink" type="button" data-skip>${T('Skip, just read')}</button>
      </div>`;
    sec.querySelector('.lsec__title').after(panel);
    P.math(panel);
    const ta = panel.querySelector('textarea');
    ta.addEventListener('input', () => { L.pages.recall[i] = { guess: ta.value.trim(), read: false, at: Date.now() }; savePage('recall', 1200); });
    const reveal = (keepGuess) => {
      L.pages.recall[i] = { guess: keepGuess ? ta.value.trim() : '', read: true, at: Date.now() };
      savePage('recall', 0);
      sec.classList.remove('sm-veiled');
      panel.remove();
      guessNote(sec, L.pages.recall[i]);
      const title = sec.querySelector('.lsec__title');
      title.setAttribute('tabindex', '-1');
      title.focus({ preventScroll: true });
      title.scrollIntoView({ behavior: P.motion.reduce ? 'auto' : 'smooth', block: 'start' });
    };
    panel.querySelector('[data-read]').addEventListener('click', () => reveal(true));
    panel.querySelector('[data-skip]').addEventListener('click', () => reveal(false));
  }

  function guessNote(sec, kept) {
    const cp = sec.querySelector('.checkpoint');
    if (!cp || !kept || !kept.guess || cp.querySelector('.smguess')) return;
    const note = deco('p', 'smguess');
    note.innerHTML = `<strong>${T('Before reading, you answered:')}</strong> <span class="smguess__text" data-no-i18n>${esc(kept.guess)}</span>`;
    cp.querySelector('.checkpoint__sub').after(note);
  }

  /* Feynman: explain the part simply; marked like a written answer. */
  const VERDICTS = { good: ['Good explanation.', 'good'], partly: ['Partly there.', 'partly'], 'not yet': ['Not yet.', 'notyet'] };
  function feynman(sec, i) {
    const s = L.sections[i];
    const card = deco('div', 'smfeyn');
    const mark = L.pages.feynmanMarks[i];
    const draft = L.pages.feynman[i] != null ? L.pages.feynman[i] : (mark && mark.answer) || '';
    card.innerHTML = `
      <p class="smdeco__eyebrow">${T('Explain it simply')}</p>
      <p class="smdeco__lead">${T('Explain this part in your own words, as if to a friend who has never studied it: what it is, why it matters, and an example. Plain words, no jargon.')}</p>
      <label class="sr-only" for="smfeyn-${i}">${esc(fill('Your explanation of “{title}”', { title: s.title }))}</label>
      <textarea class="smdeco__text" id="smfeyn-${i}" rows="4" maxlength="3000" placeholder="${T('Start with: It’s about…')}">${esc(draft)}</textarea>
      <div class="smdeco__actions">
        <button class="btn btn--small" type="button" data-mark>${T(markable() ? 'Mark my explanation' : 'Compare with the key points')}</button>
        <span class="smdeco__saved" data-saved="feynman" aria-live="polite"></span>
      </div>
      <div class="qmark" aria-live="polite"></div>`;
    sec.appendChild(card);
    const ta = card.querySelector('textarea');
    const out = card.querySelector('.qmark');
    ta.addEventListener('input', () => { L.pages.feynman[i] = ta.value; savePage('feynman', 1200); });
    if (mark && mark.status === 'marked' && mark.answer === ta.value.trim()) paintMark(out, 'marked', mark);
    else if (mark && mark.status === 'failed') paintMark(out, 'failed', mark);
    card.querySelector('[data-mark]').addEventListener('click', async () => {
      const answer = ta.value.trim();
      if (!answer) { paintMark(out, 'warn', { error: t('Write your explanation first.') }); ta.focus(); return; }
      L.pages.feynman[i] = ta.value;
      savePage('feynman', 0);
      if (!markable()) { paintMark(out, 'sample', { points: s.recap || [] }); return; }
      paintMark(out, 'pending');
      try {
        const d = await P.post('/api/answers/mark', { courseId: L.course().id, n: L.n, qid: 'f' + i, answer }, {
          timeout: 120000, timeoutMessage: t('Marking took too long.')
        });
        const m = d.mark || {};
        L.pages.feynmanMarks[i] = Object.assign({ answer }, m);
        paintMark(out, m.status === 'support' ? 'support' : 'marked', m);
      } catch (err) {
        if (err.status === 401) return;
        paintMark(out, 'failed', { error: err.message });
      }
    });
  }

  function paintMark(el, state, data) {
    el.className = 'qmark is-' + state;
    if (state === 'pending') {
      el.innerHTML = `<p class="qmark__wait"><span class="qmark__dots" aria-hidden="true"><i></i><i></i><i></i></span>${T('Marking your explanation…')}</p>`;
    } else if (state === 'marked') {
      const v = VERDICTS[data.verdict] || VERDICTS.partly;
      const missing = (data.missing || []).filter(Boolean);
      el.classList.add('is-' + v[1]);
      el.innerHTML = `<p class="qmark__verdict"><strong>${T(v[0])}</strong></p>
        <div class="qmark__feedback" data-no-i18n>${P.sanitizeHTML(data.feedback)}</div>
        ${missing.length ? `<p class="qmark__missing-title">${T('What was missing:')}</p><ul class="qmark__missing" data-no-i18n>${missing.map((m) => `<li>${P.sanitizeHTML(m)}</li>`).join('')}</ul>` : ''}
        ${data.model ? `<p class="qmark__by">${esc(fill('Marked by {model}. AI marking can be wrong.', { model: String(data.model).replace(/:free$/, '') }))}</p>` : ''}`;
    } else if (state === 'support') {
      el.innerHTML = `<div class="qmark__support" data-no-i18n>${P.sanitizeHTML(data.html)}</div>`;
    } else if (state === 'failed') {
      el.innerHTML = `<p class="qmark__fail">${T('Couldn’t mark this right now.')}</p>${data && data.error ? `<p class="qmark__why" data-no-i18n>${esc(data.error)}</p>` : ''}`;
    } else if (state === 'warn') {
      el.innerHTML = `<p class="qmark__fail">${esc(data.error)}</p>`;
    } else if (state === 'sample') {
      el.innerHTML = `<p class="qmark__note">${T('Explanations in sample courses aren’t marked. Check yours against this part’s key points:')}</p>
        <ul class="qmark__missing" data-no-i18n>${(data.points || []).map((p) => `<li>${p}</li>`).join('')}</ul>`;
    }
    P.math(el);
  }

  /* Mind map: the part's key points, to arrange and annotate. */
  function mindmap(sec, i) {
    if (!P.mindmap) return;
    const s = L.sections[i];
    const box = deco('div', 'smmap');
    box.innerHTML = `
      <div class="smmap__head">
        <p class="smdeco__eyebrow">${T('Mind map')}</p>
        <p class="smmap__hint">${T('Drag the ideas to arrange them. Select one to add a note, or an idea of your own linked to it.')}</p>
        <span class="smdeco__saved" data-saved="mindmap" aria-live="polite"></span>
      </div>
      <div class="smmap__host" data-no-i18n></div>`;
    const content = sec.querySelector('.lsec__content');
    content.after(box);
    const points = (s.recap && s.recap.length ? s.recap : s.blocks.filter((b) => b.t === 'p').slice(0, 3).map((b) => b.html)).map(plain).filter(Boolean);
    P.mindmap.mount(box.querySelector('.smmap__host'), {
      title: s.title,
      points,
      data: L.pages.mindmap[i] || null,
      onChange(data) { L.pages.mindmap[i] = data; savePage('mindmap', 900); },
      toNotebook(textOut) { if (P.notebook) P.notebook.append(textOut); }
    });
  }

  /* SQ3R: survey and question before the lesson; read, recite in each part; review at the end. */
  const STEPS = ['Survey', 'Question', 'Read', 'Recite', 'Review'];
  function sq3rData() { const d = L.pages.sq3r; d.q = d.q || {}; d.r = d.r || {}; return d; }
  function steps(on) { return `<ol class="smsteps" aria-label="${T('SQ3R steps')}">${STEPS.map((s, k) => `<li class="${k < on ? 'is-done' : k === on ? 'is-on' : ''}">${T(s)}</li>`).join('')}</ol>`; }
  function survey() {
    const d = sq3rData();
    const box = document.createElement('section');
    box.className = 'smsq3r smdeco';
    box.setAttribute('aria-labelledby', 'smsq3r-title');
    const render = () => {
      const open = !d.surveyed;
      box.innerHTML = open ? `
        ${steps(d.q && Object.values(d.q).some(Boolean) ? 1 : 0)}
        <h2 class="smsq3r__title" id="smsq3r-title">${T('Survey the lesson, then ask')}</h2>
        <p class="smdeco__lead">${T('Skim the headings of this lesson before you read it, and turn each one into a question to read for.')}</p>
        <ol class="smsq3r__list">${L.sections.map((s, k) => `
          <li><span class="smsq3r__h" data-no-i18n>${esc(s.title)}</span>
            <label class="sr-only" for="smsq-${k}">${esc(fill('Your question about “{title}”', { title: s.title }))}</label>
            <input class="input smsq3r__in" id="smsq-${k}" data-k="${k}" type="text" maxlength="300" autocomplete="off" placeholder="${T('Your question: What…? Why…? How…?')}" value="${esc(d.q[k] || '')}"></li>`).join('')}
        </ol>
        <div class="smdeco__actions"><button class="btn btn--small" type="button" data-go>${T('Start reading')}</button><span class="smdeco__saved" data-saved="sq3r" aria-live="polite"></span></div>`
        : `${steps(2)}<p class="smsq3r__ready"><strong id="smsq3r-title">${T('SQ3R')}</strong> ${T('Read each part looking for the answer to your question, then recite it from memory.')} <button class="textlink" type="button" data-edit>${T('See your questions')}</button></p>`;
      $$('.smsq3r__in', box).forEach((inp) => inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        d.q[k] = inp.value.trim();
        savePage('sq3r', 1000);
        const line = $(`.smsq3r-q[data-k="${k}"]`);
        if (line && !d.q[k]) line.remove();
        else if (line) line.querySelector('.smsq3r-q__text').textContent = d.q[k];
        else if ($(`#sec-${k}`)) questionLine($(`#sec-${k}`), Number(k));
      }));
      const go = box.querySelector('[data-go]');
      if (go) go.addEventListener('click', () => {
        d.surveyed = true;
        savePage('sq3r', 0);
        render();
        $$('section.lsec[data-sec]', lbody()).forEach((sec) => { const k = Number(sec.dataset.sec); if (!sec.querySelector('.smsq3r-q')) questionLine(sec, k); });
        const first = $('#sec-0 .lsec__title');
        if (first) first.scrollIntoView({ behavior: P.motion.reduce ? 'auto' : 'smooth', block: 'start' });
      });
      const edit = box.querySelector('[data-edit]');
      if (edit) edit.addEventListener('click', () => { d.surveyed = false; render(); const inp = box.querySelector('.smsq3r__in'); if (inp) inp.focus(); });
    };
    render();
    const bar = $('.smbar');
    (bar || $('#lhead')).after(box);
  }
  function questionLine(sec, k) {
    const q = sq3rData().q[k];
    if (!q) return;
    const line = deco('p', 'smsq3r-q');
    line.dataset.k = String(k);
    line.innerHTML = `<strong>${T('Your question:')}</strong> <span class="smsq3r-q__text" data-no-i18n>${esc(q)}</span>`;
    sec.querySelector('.lsec__title').after(line);
  }
  function sq3rPart(sec, k) {
    questionLine(sec, k);
    const d = sq3rData();
    const box = deco('div', 'smrecite');
    box.innerHTML = `
      <p class="smdeco__eyebrow">${T('Recite')}</p>
      <label class="smdeco__lead" for="smrec-${k}">${T(d.q[k] ? 'Without looking back, answer your question from memory, in a sentence or two.' : 'Without looking back, say what this part was about, in a sentence or two.')}</label>
      <textarea class="smdeco__text" id="smrec-${k}" rows="3" maxlength="2000">${esc(d.r[k] || '')}</textarea>
      <span class="smdeco__saved" data-saved="sq3r" aria-live="polite"></span>`;
    sec.querySelector('.lsec__content').after(box);
    const ta = box.querySelector('textarea');
    ta.addEventListener('input', () => { d.r[k] = ta.value.trim(); savePage('sq3r', 1000); });
  }

  /* ---------- when the lesson is complete ---------- */
  function endCard() {
    const done = $('#ldone');
    if (!done || $('.smend')) return;
    const card = document.createElement('section');
    card.className = 'smend smdeco';
    card.setAttribute('aria-label', t('Study method'));
    const courseId = L.course().id;
    let html = '';
    if (L.method === 'sq3r') {
      const d = sq3rData();
      const rows = L.sections.map((s, k) => ({ s, q: d.q[k], r: d.r[k] })).filter((x) => x.q || x.r);
      html = `${steps(4)}<h2>${T('Review your questions')}</h2>
        ${rows.length ? `<dl class="smend__qa" data-no-i18n>${rows.map((x) => `<dt>${esc(x.q || x.s.title)}</dt><dd>${x.r ? esc(x.r) : `<em>${T('No answer written')}</em>`}</dd>`).join('')}</dl>`
          : `<p>${T('You didn’t write questions for this lesson. Next time, survey the headings first.')}</p>`}
        <div class="smdeco__actions">${rows.length ? `<button class="btn btn--small" type="button" data-nb>${T('Add them to my notebook')}</button>` : ''}<a class="textlink" href="review.html?course=${encodeURIComponent(courseId)}">${T('Review this course’s mistakes')}</a></div>`;
    } else if (L.method === 'cornell') {
      html = `<h2>${T('Finish your Cornell page')}</h2><p>${T('Write the questions and key words in the cues column, then sum up the whole lesson in two or three sentences at the bottom.')}</p>
        <div class="smdeco__actions"><button class="btn btn--small" type="button" data-summary>${T('Write my summary')}</button></div>`;
    } else if (L.method === 'interleave') {
      const due = P.review ? P.review.due() : 0;
      html = `<h2>${T('Mix it up')}</h2><p>${esc(due ? (due === 1 ? t('Before the next lesson, answer the question waiting in Review. It may come from another course: that’s the point.') : fill('Before the next lesson, answer {n} mixed questions from your courses in Review.', { n: due })) : t('Nothing is due in Review yet. Mistakes from all your courses will be mixed there.'))}</p>
        <div class="smdeco__actions"><a class="btn btn--small" href="review.html">${T('Mixed review')}</a></div>`;
    } else if (L.method === 'spaced') {
      const prog = L.prog();
      const missed = L.sections.flatMap((s) => s.checkpoint || []).filter((q) => q.type !== 'subjective' && prog.answered[q.id] && ((prog.answered[q.id].tries || 1) > 1 || prog.answered[q.id].status === 'revealed')).length;
      html = `<h2>${T('What comes back, and when')}</h2><p>${esc(missed ? (missed === 1 ? t('The question you missed in this lesson comes back in Review tomorrow, then 3 days later, until you get it right twice in a row.') : fill('The {n} questions you missed in this lesson come back in Review tomorrow, then 3 days later, until you get each right twice in a row.', { n: missed })) : t('You missed nothing in this lesson, so nothing from it comes back in Review.'))}</p>
        <div class="smdeco__actions"><a class="btn btn--small" href="review.html?course=${encodeURIComponent(courseId)}">${T('Review this course')}</a></div>`;
    } else if (L.method === 'feynman') {
      const total = L.sections.length;
      const marked = Object.values(L.pages.feynmanMarks).filter((m) => m && m.verdict).length;
      html = `<h2>${T('Explained in your own words')}</h2><p>${esc(fill('You explained {done} of the {total} parts of this lesson.', { done: marked, total }))} ${T('Any part marked “Not yet” is worth explaining again tomorrow.')}</p>`;
    } else if (L.method === 'recall') {
      const tried = Object.values(L.pages.recall).filter((r) => r && r.guess).length;
      html = `<h2>${T('Recall, then read')}</h2><p>${esc(fill('You answered {done} of the {total} parts from memory before reading them.', { done: tried, total: L.sections.length }))}</p>`;
    } else if (L.method === 'mindmap') {
      html = `<h2>${T('Your maps')}</h2><p>${T('Your mind maps for this lesson are saved. Next time, try redrawing one from memory before you look.')}</p>`;
    } else if (L.method === 'pomodoro') {
      html = P.timer ? `<h2>${T('Focus blocks')}</h2><p data-live></p>` : '';
    }
    if (!html) return;
    card.innerHTML = html;
    done.after(card);
    const nb = card.querySelector('[data-nb]');
    if (nb) nb.addEventListener('click', () => {
      const d = sq3rData();
      const lines = [fill('SQ3R: {title}', { title: L.meta.title })];
      L.sections.forEach((s, k) => { if (d.q[k] || d.r[k]) lines.push('Q: ' + (d.q[k] || s.title), 'A: ' + (d.r[k] || '…'), ''); });
      if (P.notebook) P.notebook.append(lines.join(NL).trim());
    });
    const sum = card.querySelector('[data-summary]');
    if (sum) sum.addEventListener('click', () => openNotebook('#smc-sum'));
    const live = card.querySelector('[data-live]');
    if (live && P.timer) {
      const s = P.timer.state();
      live.textContent = s.sessions ? (s.sessions === 1 ? t('1 focus session today. Take a break before the next lesson.') : fill('{n} focus sessions today. Take a break before the next lesson.', { n: s.sessions })) : t('Start a focus block before the next lesson, from the timer in the top bar.');
    }
  }

  /* ---------- Cornell notes: the notebook as cues, notes and a summary ---------- */
  const MARK = /^─{3,} (.+?) ─{3,}$/;
  const mark = (label) => `──── ${t(label)} ────`;
  function parseCornell(textIn) {
    const lines = String(textIn || '').split(NL);
    const parts = [];
    let cur = { lines: [] };
    const before = cur;
    lines.forEach((line) => {
      if (MARK.test(line.trim())) { cur = { lines: [] }; parts.push(cur); } else cur.lines.push(line);
    });
    const txt = (p) => (p ? p.lines.join(NL).trim() : '');
    if (!parts.length) return { cues: '', notes: txt(before), sum: '' };
    const notes = [txt(before), txt(parts[1])].filter(Boolean).join(NL + NL);
    return { cues: txt(parts[0]), notes, sum: parts.slice(2).map(txt).filter(Boolean).join(NL + NL) };
  }
  function composeCornell({ cues, notes, sum }) {
    if (!cues.trim() && !notes.trim() && !sum.trim()) return '';
    return [mark('Cues'), cues.trim(), '', mark('Notes'), notes.trim(), '', mark('Summary'), sum.trim()].join(NL) + NL;
  }

  function cornellSheet() {
    const page = $('#nb-write'), ta = $('#nb-text');
    if (!page || !ta || !notesIn) return;
    let sheet = page.querySelector('.smcornell');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'smcornell smdeco';
      sheet.innerHTML = `
        <div class="smcornell__grid">
          <div class="smcornell__col smcornell__col--cues"><label for="smc-cues">${T('Cues')}</label>
            <textarea id="smc-cues" spellcheck="true" placeholder="${T('Questions and key words, written after you read')}"></textarea></div>
          <div class="smcornell__col smcornell__col--notes"><label for="smc-notes">${T('Notes')}</label>
            <textarea id="smc-notes" spellcheck="true" placeholder="${T('Notes as you read: ideas, examples, formulas')}"></textarea></div>
        </div>
        <div class="smcornell__col smcornell__col--sum"><label for="smc-sum">${T('Summary')}</label>
          <textarea id="smc-sum" spellcheck="true" placeholder="${T('Two or three sentences on the whole lesson, written at the end')}"></textarea></div>
        <p class="smcornell__foot"><button class="textlink" type="button" data-plain>${T('Plain page')}</button></p>`;
      page.appendChild(sheet);
      const [cues, notes, sum] = ['#smc-cues', '#smc-notes', '#smc-sum'].map((s) => sheet.querySelector(s));
      const push = () => {
        ta.value = composeCornell({ cues: cues.value, notes: notes.value, sum: sum.value });
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      };
      [cues, notes, sum].forEach((x) => x.addEventListener('input', push));
      // the same notes as one plain page, and back (the page keeps the three headings as lines)
      const toggle = sheet.querySelector('[data-plain]');
      toggle.addEventListener('click', () => {
        const on = page.classList.toggle('is-cornell');
        toggle.textContent = t(on ? 'Plain page' : 'Cornell page');
        if (on) { fillSheet(); notes.focus(); } else ta.focus();
      });
      // "Add to notebook" (doubts, maps, SQ3R) goes into the notes column
      if (P.notebook && !L.unwrapNotebook) {
        const orig = P.notebook.append;
        P.notebook.append = (textIn) => {
          if (!page.classList.contains('is-cornell')) return orig(textIn);
          openNotebook();
          notes.value = (notes.value.trim() ? notes.value.replace(/\s+$/, '') + NL + NL : '') + textIn;
          push();
          notes.scrollTop = notes.scrollHeight;
          P.toast(t('Added to your notebook.'));
        };
        L.unwrapNotebook = () => { P.notebook.append = orig; };
      }
    }
    page.classList.add('is-cornell');
    fillSheet();
    function fillSheet() {
      const parts = parseCornell(ta.value);
      const [cues, notes, sum] = ['#smc-cues', '#smc-notes', '#smc-sum'].map((s) => sheet.querySelector(s));
      cues.value = parts.cues; notes.value = parts.notes; sum.value = parts.sum;
      // a fresh page starts with the lesson's parts as headings (saved only once something is written)
      if (!parts.cues && !parts.notes && !parts.sum) notes.value = L.sections.map((s, k) => `${k + 1}. ${s.title}` + NL).join(NL);
    }
  }

  /* ======================================================================
     Review: interleaving mixes the questions of different courses
     ====================================================================== */
  document.addEventListener('primer:review', (e) => {
    const d = e.detail;
    const filter = P.params.get('course');
    const mixing = Object.values(methods).includes('interleave');
    if (filter) {
      if (methods[filter] === 'interleave') reviewNote(`${T('This course uses interleaving.')} <a href="review.html">${T('Review all your courses, mixed')}</a>`);
      return;
    }
    if (!mixing) return;
    d.due = interleave(d.due);
    d.upcoming = interleave(d.upcoming);
    const courses = new Set(d.due.map((it) => it.course.id)).size;
    reviewNote(courses > 1 ? T('Interleaved: questions from your different courses are mixed, so each one makes you think which idea it needs.') : T('Interleaving is on: once more than one course has questions due, they are mixed here.'));
  });
  // round robin: one from each course in turn, and within a course one from each lesson in turn
  function roundRobin(lists) {
    const out = [];
    const queues = lists.map((l) => l.slice());
    while (queues.some((q) => q.length)) queues.forEach((q) => { if (q.length) out.push(q.shift()); });
    return out;
  }
  function groupBy(items, key) {
    const m = new Map();
    items.forEach((it) => { const k = key(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it); });
    return Array.from(m.values());
  }
  function interleave(items) {
    return roundRobin(groupBy(items || [], (it) => it.course.id).map((list) => roundRobin(groupBy(list, (it) => it.lesson))));
  }
  function reviewNote(html) {
    const root = $('#rv-root');
    if (!root || $('.smrv')) return;
    const p = document.createElement('p');
    p.className = 'smrv';
    p.innerHTML = html;
    root.before(p);
  }

  P.study = { METHODS, methodOf, setMethod, pick: (id, title) => choose(id, title), courseData, duration, interleave };
})();
