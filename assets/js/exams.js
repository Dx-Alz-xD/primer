/* =====================================================================
   Exams on the course page and the lesson page (server/exams.mjs).

   P.exams.status(courseId)        what is open and passed, from GET /api/courses/:id/exams
                                   (the last answer is kept, so a downloaded course still
                                   knows which units are open when there's no connection)
   P.exams.mountCourse(view, course)   the outline: an exam after every unit, locked units,
                                   the final exam, the learner's tests and "Make a test"
   P.exams.gate(course, meta)      the lesson page: resolves false (and shows why) when the
                                   lesson's unit isn't open yet
   P.exams.lessonDone(box, course, meta)  the "Lesson complete" box: points to the unit's exam
                                   when the next lesson needs it
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const esc = P.esc;
  // text built with numbers, and text inside the lesson (which the page-wide dictionary skips), goes through P.t
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, vals) => esc(t(s)).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const roman = (n) => (P.roman ? P.roman(n) : String(n));
  const enc = encodeURIComponent;

  const LOCK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/></svg>';
  const SEAL = '<svg width="34" height="34" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M20 3l3.6 3.2 4.8-.6 1.6 4.6 4.4 2-.9 4.7 2.9 3.8-2.9 3.8.9 4.7-4.4 2-1.6 4.6-4.8-.6L20 37l-3.6-3.2-4.8.6-1.6-4.6-4.4-2 .9-4.7L3.6 20l2.9-3.8-.9-4.7 4.4-2 1.6-4.6 4.8.6z"/><path d="M14 20.5l4 4 8-9"/></svg>';
  const EXAM = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13l1.6 1.6L15 11"/><path d="M10 18h5"/></svg>';

  const hrefs = {
    unit: (id, u) => `exam.html?course=${enc(id)}&unit=${u}`,
    final: (id) => `exam.html?course=${enc(id)}&final=1`,
    make: (id) => `exam.html?course=${enc(id)}&make=1`,
    test: (tid) => `exam.html?test=${tid}`,
    attempt: (aid) => `exam.html?attempt=${aid}`,
    paper: (tid) => `paper.html?test=${tid}`,
    lesson: (id, n) => `lesson.html?course=${enc(id)}&lesson=${n}`,
    outline: (id) => `app.html?course=${enc(id)}`,
    certificate: (code) => `certificate.html?code=${enc(code)}`
  };

  /* ---------------- words ---------------- */
  function list(items) {
    try { return new Intl.ListFormat(P.lang || 'en', { style: 'long', type: 'conjunction' }).format(items); } catch (e) { return items.join(', '); }
  }
  const unitName = (u) => fill('Unit {u}', { u: roman(u) });
  const examName = (u) => fill('Unit {u} exam', { u: roman(u) });
  // "Pass the Unit II exam to open this unit." (the earlier units whose exams aren't passed yet)
  const needsText = (needs) => (needs.length === 1
    ? fill('Pass the Unit {u} exam to open this unit.', { u: roman(needs[0]) })
    : fill('Pass the exams of Units {list} to open this unit.', { list: esc(list(needs.map(roman))) }));
  const pct = (s) => (s ? `${s.pct}%` : '');
  const score = (s) => fill('{score} of {total}', { score: fmtNum(s.score), total: s.total });
  function fmtNum(n) {
    try { return new Intl.NumberFormat(P.lang || 'en', { maximumFractionDigits: 1 }).format(n); } catch (e) { return String(n); }
  }
  function minutesLeft(at) {
    const m = Math.max(1, Math.ceil((at - Date.now()) / 60000));
    return m === 1 ? t('You can try again in a minute, with fresh questions.') : fill('You can try again in {n} minutes, with fresh questions.', { n: m });
  }
  // "Lessons 1–3 and 5", from a list of lesson numbers
  function lessonsLabel(ns) {
    const s = ns.slice().sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < s.length; i++) {
      let j = i;
      while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
      parts.push(j > i + 1 ? `${s[i]}–${s[j]}` : j === i + 1 ? `${s[i]}, ${s[j]}` : String(s[i]));
      i = j;
    }
    return s.length === 1 ? fill('Lesson {n}', { n: s[0] }) : fill('Lessons {list}', { list: esc(list(parts)) });
  }
  function testName(test) {
    if (test.kind === 'paper') return test.unit ? fill('Paper copy of the Unit {u} exam', { u: roman(test.unit) }) : esc(t('Paper copy of the final exam'));
    return test.title ? `<span data-no-i18n>${esc(test.title)}</span>` : lessonsLabel(test.lessons || []);
  }
  function testMeta(test) {
    const parts = [];
    if (test.choice) parts.push(test.choice === 1 ? esc(t('1 multiple choice')) : fill('{n} multiple choice', { n: test.choice }));
    if (test.written) parts.push(test.written === 1 ? esc(t('1 written')) : fill('{n} written', { n: test.written }));
    parts.push(test.minutes ? fill('{n} minutes', { n: test.minutes }) : esc(t('No timer')));
    return parts.join(' · ');
  }

  /* ---------------- status ---------------- */
  const known = new Map();
  const locks = new Map(); // course id -> lessons whose unit isn't open yet
  function noteLocks(courseId, d) {
    locks.set(courseId, new Set(((d && d.units) || []).filter((u) => !u.open).flatMap((u) => u.lessons || []).map(Number)));
    document.dispatchEvent(new CustomEvent('primer:locks', { detail: { courseId } })); // the knowledge map redraws
    return d;
  }
  function status(courseId, force) {
    if (!force && known.has(courseId)) return known.get(courseId);
    const key = 'primer.exams.' + courseId;
    const job = P.get(`/api/courses/${enc(courseId)}/exams`)
      .then((d) => { P.store.set(key, { at: Date.now(), d }); return d; })
      .catch((err) => {
        known.delete(courseId);
        const kept = P.store.get(key, null);
        if (kept && kept.d && err.status !== 404 && err.status !== 401) return Object.assign({}, kept.d, { stale: true });
        throw err;
      })
      // P.unlockAll (debug, assets/js/core.js): every unit open, whatever the exams say
      .then((d) => (P.unlockAll && d && Array.isArray(d.units) ? Object.assign({}, d, { units: d.units.map((u) => Object.assign({}, u, { open: true })) }) : d))
      .then((d) => noteLocks(courseId, d));
    known.set(courseId, job);
    return job;
  }
  // for other tools (the knowledge map): is this lesson waiting for an exam before it?
  P.lessonLocked = (course, n) => { const s = course && locks.get(course.id); return Boolean(s && s.has(Number(n))); };

  // A paper copy of an exam: fresh questions, written by the AI, then the print view.
  async function printCopy(btn, courseId, unit) {
    if (btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('Writing a paper copy…');
    try {
      const url = unit ? `/api/courses/${enc(courseId)}/exams/unit/${unit}/paper` : `/api/courses/${enc(courseId)}/exams/final/paper`;
      const d = await P.post(url, {}, { timeout: 330000, timeoutMessage: t('The AI took too long to write the paper. Try again.') });
      location.href = hrefs.paper(d.test.id);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      P.toast(err.message, 'error');
    }
  }

  /* ---------------- the course outline ---------------- */
  function unitStrip(course, u, next) {
    let state, action;
    if (u.current) {
      state = esc(t('You started this exam. Its clock is still running.'));
      action = `<a class="btn btn--small" href="${hrefs.attempt(u.current.id)}">${esc(t('Carry on with the exam'))}</a>`;
    } else if (u.marking) {
      state = esc(t('Handed in. Your written answers are being marked.'));
      action = `<a class="btn btn--small btn--ghost" href="${hrefs.attempt(u.marking.id)}">${esc(t('See your results'))}</a>`;
    } else if (u.passed) {
      state = fill('Passed, with {pct}.', { pct: pct(u.best) });
      action = `<a class="btn btn--small btn--ghost" href="${hrefs.attempt(u.best.id)}">${esc(t('See your results'))}</a>`;
    } else if (u.last) {
      state = fill('Not passed yet: your best is {pct}, and the pass mark is 60%.', { pct: pct(u.best) }) + (u.retakeAt ? ' ' + minutesLeft(u.retakeAt) : '');
      action = u.retakeAt
        ? `<a class="btn btn--small btn--ghost" href="${hrefs.attempt(u.last.id)}">${esc(t('See your results'))}</a>`
        : `<a class="btn btn--small" href="${hrefs.unit(course.id, u.unit)}">${esc(t('Take it again'))}</a>`;
    } else {
      state = next ? fill('Passing it opens Unit {u}.', { u: roman(next) }) : esc(t('The last unit: then the final exam.'));
      action = `<a class="btn btn--small" href="${hrefs.unit(course.id, u.unit)}">${esc(t('Take the exam'))}</a>`;
    }
    const el = document.createElement('div');
    el.className = 'xm-unit' + (u.passed ? ' is-passed' : u.last ? ' is-failed' : '');
    el.innerHTML = `
      <span class="xm-unit__icon">${u.passed ? SEAL : EXAM}</span>
      <div class="xm-unit__info">
        <p class="xm-unit__title">${examName(u.unit)}</p>
        <p class="xm-unit__meta">${fill('{n} questions · {m} minutes · pass mark 60%', { n: u.questions, m: u.minutes })}</p>
        <p class="xm-unit__state">${state}</p>
      </div>
      <div class="xm-unit__actions">
        ${action}
        <button class="textlink" type="button" data-paper="${u.unit}">${esc(t('Print a paper copy'))}</button>
      </div>`;
    return el;
  }

  function finalCard(course, d) {
    const f = d.final;
    let state = '', action;
    if (d.completed) {
      state = fill('Passed, with {pct}. This course is completed.', { pct: pct(f.best) });
      action = (d.passport ? `<a class="btn btn--small" href="${hrefs.certificate(d.passport.code)}">${esc(t('See your certificate'))}</a>` : '') +
        `<a class="textlink" href="${hrefs.attempt(f.best.id)}">${esc(t('See your results'))}</a>`;
    } else if (f.current) {
      state = esc(t('You started the final exam. Its clock is still running.'));
      action = `<a class="btn btn--small" href="${hrefs.attempt(f.current.id)}">${esc(t('Carry on with the exam'))}</a>`;
    } else if (f.marking) {
      state = esc(t('Handed in. Your written answers are being marked.'));
      action = `<a class="btn btn--small btn--ghost" href="${hrefs.attempt(f.marking.id)}">${esc(t('See your results'))}</a>`;
    } else if (f.last) {
      state = fill('Not passed yet: your best is {pct}, and the pass mark is 60%.', { pct: pct(f.best) }) + (f.retakeAt ? ' ' + minutesLeft(f.retakeAt) : '');
      action = f.retakeAt
        ? `<a class="btn btn--small btn--ghost" href="${hrefs.attempt(f.last.id)}">${esc(t('See your results'))}</a>`
        : `<a class="btn btn--small" href="${hrefs.final(course.id)}">${esc(t('Take it again'))}</a>`;
    } else {
      action = `<a class="btn btn--small" href="${hrefs.final(course.id)}">${esc(t('Take the final exam'))}</a>`;
    }
    const el = document.createElement('section');
    el.className = 'xm-final card card--solid' + (d.completed ? ' is-done' : '');
    el.setAttribute('aria-labelledby', 'xm-final-title');
    el.innerHTML = `
      <span class="xm-final__seal">${SEAL}</span>
      <div class="xm-final__body">
        <h2 id="xm-final-title">${esc(t('Final exam'))}</h2>
        <p class="xm-final__meta">${fill('{c} multiple-choice and {w} written questions, from every unit · {m} minutes · pass mark 60%', { c: f.choice, w: f.written, m: f.minutes })}</p>
        <p class="xm-final__why">${esc(t('Passing it marks the course completed, and adds a certificate to your skill passport that anyone can check.'))}</p>
        ${state ? `<p class="xm-final__state">${state}</p>` : ''}
        <div class="xm-final__actions">${action}<button class="textlink" type="button" data-paper="0">${esc(t('Print a paper copy'))}</button></div>
      </div>`;
    return el;
  }

  function testsCard(course, d) {
    const el = document.createElement('section');
    el.className = 'xm-tests card card--solid';
    el.setAttribute('aria-labelledby', 'xm-tests-title');
    const rows = d.tests.map((x) => `<li class="xm-test">
        <div class="xm-test__info"><p class="xm-test__name">${testName(x)}</p><p class="xm-test__meta">${testMeta(x)}</p></div>
        <div class="xm-test__actions">
          ${x.kind === 'test' ? `<a class="btn btn--small btn--ghost" href="${hrefs.test(x.id)}">${esc(t('Open'))}</a>` : ''}
          <a class="textlink" href="${hrefs.paper(x.id)}">${esc(t('Print'))}</a>
          <button class="textlink" type="button" data-del-test="${x.id}">${esc(t('Delete'))}</button>
        </div>
      </li>`).join('');
    el.innerHTML = `
      <div class="xm-tests__head">
        <h2 id="xm-tests-title">${esc(t('Tests'))}</h2>
        <a class="btn btn--small" href="${hrefs.make(course.id)}">${esc(t('Make a test'))}</a>
      </div>
      <p class="xm-tests__help">${esc(t('Pick any lessons, how many questions of each kind, and a timer or none. Take a test now, keep it to take again, or print it for a class.'))}</p>
      ${rows ? `<ul class="xm-tests__list">${rows}</ul>` : ''}`;
    return el;
  }

  async function mountCourse(view, course) {
    let d;
    try { d = await status(course.id); } catch (e) { return; } // exams are extra: the outline works without them
    if (!d.ai && !d.units.some((u) => u.attempts) && !d.tests.length) return; // exams need the AI to write them
    const unitEls = Array.from(view.querySelectorAll('.units > .unit'));
    d.units.forEach((u, i) => {
      const li = unitEls[i];
      if (!li) return;
      const lessons = li.querySelector('.lessons');
      if (lessons) lessons.after(unitStrip(course, u, d.units[i + 1] ? d.units[i + 1].unit : null));
      if (u.open) return;
      li.classList.add('is-locked');
      const note = document.createElement('div');
      note.className = 'xm-lock';
      note.setAttribute('role', 'note');
      note.innerHTML = `${LOCK}<p>${needsText(u.needs)}</p><a class="btn btn--small btn--ghost" href="${hrefs.unit(course.id, u.needs[0])}">${fill('Take the Unit {u} exam', { u: roman(u.needs[0]) })}</a>`;
      const title = li.querySelector('.unit__title');
      if (title) title.after(note);
      li.querySelectorAll('.lrow').forEach((a) => {
        a.classList.add('is-locked');
        const sr = document.createElement('span');
        sr.className = 'sr-only';
        sr.textContent = t(' (locked)');
        const tt = a.querySelector('.lrow__title');
        if (tt) tt.appendChild(sr);
      });
    });

    const units = view.querySelector('.units');
    if (units) {
      const tests = testsCard(course, d);
      units.after(tests);
      tests.before(finalCard(course, d));
    }
    // a completed course says so at the top
    const h1 = view.querySelector('.course-head h1');
    if (d.completed && h1) {
      const done = document.createElement('p');
      done.className = 'xm-done';
      done.innerHTML = `${SEAL}<span>${esc(t('Completed'))}</span>${d.passport ? ` <a class="textlink" href="${hrefs.certificate(d.passport.code)}">${esc(t('See your certificate'))}</a>` : ''}`;
      h1.after(done);
    }
    // "Continue with lesson 9" when lesson 9 is locked becomes the exam that opens it
    const cta = view.querySelector('.course-head__actions .btn');
    const m = cta && /[?&]lesson=(\d+)/.exec(cta.getAttribute('href') || '');
    if (m) {
      const u = d.units.find((x) => x.lessons.includes(Number(m[1])));
      if (u && !u.open) {
        cta.href = hrefs.unit(course.id, u.needs[0]);
        cta.innerHTML = fill('Take the Unit {u} exam', { u: roman(u.needs[0]) });
      }
    }

    view.addEventListener('click', async (e) => {
      const paper = e.target.closest('[data-paper]');
      if (paper) { printCopy(paper, course.id, Number(paper.dataset.paper) || null); return; }
      const del = e.target.closest('[data-del-test]');
      if (!del) return;
      if (!window.confirm(t('Delete this test? Results you already have are kept.'))) return;
      del.disabled = true;
      try {
        await P.del(`/api/tests/${Number(del.dataset.delTest)}`);
        const li = del.closest('li');
        if (li) li.remove();
        P.toast(t('Test deleted.'));
      } catch (err) {
        del.disabled = false;
        P.toast(err.message, 'error');
      }
    });
  }

  /* ---------------- the lesson page ---------------- */
  function markSide(d) {
    const locked = new Set(d.units.filter((u) => !u.open).flatMap((u) => u.lessons));
    if (!locked.size) return;
    P.$$('#side a').forEach((a) => {
      const m = /[?&]lesson=(\d+)/.exec(a.getAttribute('href') || '');
      if (!m || !locked.has(Number(m[1]))) return;
      a.classList.add('is-locked');
      a.title = t('Locked until the exams before it are passed');
    });
  }

  async function gate(course, meta) {
    let d;
    try { d = await status(course.id); } catch (e) { return true; } // can't tell (offline, say): don't stand in the way
    markSide(d);
    const u = d.units[meta.unitIndex - 1];
    if (!u || u.open) return true;
    const flat = P.courseGen.flatten(course);
    const first = u.needs[0];
    const head = P.$('#lhead'), body = P.$('#lbody');
    head.innerHTML = `
      <p class="lhead__pos">${fill('Lesson {n} of {total}, in Unit {u}: {unit}', { n: meta.n, total: flat.length, u: roman(meta.unitIndex), unit: `<span data-no-i18n>${esc(meta.unit)}</span>` })}</p>
      <h1 id="lesson-title">${esc(meta.title)}</h1>`;
    body.innerHTML = `
      <div class="xm-gate" data-i18n>
        <span class="xm-gate__lock">${LOCK}</span>
        <h2>${esc(t('This unit isn’t open yet'))}</h2>
        <p class="xm-gate__why">${needsText(u.needs)}</p>
        <p class="xm-gate__how">${fill('The Unit {u} exam has 10 questions and takes 25 minutes. You can take it now, even before you finish that unit’s lessons, to skip ahead.', { u: roman(first) })}</p>
        <div class="xm-gate__actions">
          <a class="btn" href="${hrefs.unit(course.id, first)}">${fill('Take the Unit {u} exam', { u: roman(first) })}</a>
          <a class="textlink" href="${hrefs.lesson(course.id, (d.units[first - 1].lessons || [1])[0])}">${fill('Go to Unit {u}', { u: roman(first) })}</a>
          <a class="textlink" href="${hrefs.outline(course.id)}">${esc(t('Back to the outline'))}</a>
        </div>
      </div>`;
    const tools = P.$('.lbar__tools');
    if (tools) tools.hidden = true;
    const segs = P.$('#segs');
    if (segs) segs.hidden = true;
    if (P.contentLang) P.contentLang(P.$('#lesson-title'), course.lang || 'en');
    return false;
  }

  function lessonDone(box, course, meta) {
    status(course.id).then((d) => {
      if (!box || box.hidden) return;
      const u = d.units[meta.unitIndex - 1];
      if (!u) return;
      const flat = P.courseGen.flatten(course);
      const next = flat[meta.n];
      const lastOfUnit = !next || next.unitIndex !== meta.unitIndex;
      if (!lastOfUnit || u.passed) {
        if (!next && !d.completed && d.ai) addLine(box, esc(t('That was the last lesson. The final exam completes the course.')), hrefs.final(course.id), esc(t('Take the final exam')));
        return;
      }
      const nextU = next ? d.units[next.unitIndex - 1] : null;
      if (nextU && !nextU.open) {
        // the next lesson is locked: the exam is the way on
        const btn = box.querySelector('.ldone__actions .btn');
        if (btn) { btn.href = hrefs.unit(course.id, meta.unitIndex); btn.innerHTML = fill('Take the Unit {u} exam', { u: roman(meta.unitIndex) }); }
        const p = document.createElement('p');
        p.className = 'xm-done-note';
        p.innerHTML = fill('You’ve reached the end of Unit {u}. Pass its exam to open Unit {next}.', { u: roman(meta.unitIndex), next: roman(next.unitIndex) });
        box.querySelector('h2').after(p);
      } else if (d.ai) {
        addLine(box, fill('You’ve reached the end of Unit {u}.', { u: roman(meta.unitIndex) }), hrefs.unit(course.id, meta.unitIndex), examName(meta.unitIndex));
      }
    }).catch(() => {});
  }
  function addLine(box, text, href, label) {
    const p = document.createElement('p');
    p.className = 'xm-done-note';
    p.innerHTML = `${text} <a class="textlink" href="${href}">${label}</a>`;
    const actions = box.querySelector('.ldone__actions');
    if (actions) actions.before(p); else box.appendChild(p);
  }

  P.exams = { status, mountCourse, gate, lessonDone, hrefs, words: { unitName, examName, needsText, lessonsLabel, testName, testMeta, list, fmtNum, fill, t }, icons: { LOCK, SEAL, EXAM } };
})();
