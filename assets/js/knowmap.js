/* =====================================================================
   The knowledge map on a course's page: every lesson as a stop on a
   path, grouped by unit and coloured by how well it is known.

   - Mastered     finished, and none of its mistakes still coming back
   - Shaky        mistakes still coming back in Review, a written answer
                  marked "not yet", or under half its questions right on
                  the first try
   - In progress  opened but not finished
   - Not started
   - Locked       when another feature locks lessons (unit exams):
                  P.lessonLocked(course, n), or an outline lesson with
                  `locked: true`. Without either, nothing is locked.
   Built from what the page already has (the course's progress) and the
   per-lesson numbers from GET /api/study/course/:id (Review items,
   marks, time studied). Hovering, focusing or tapping a lesson shows its
   numbers; a click (a second tap on a phone) opens it. A list of the
   same lessons is there for screen readers and anyone who prefers it.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  const T = (s) => esc(t(s));
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const duration = (ms) => (P.study ? P.study.duration(ms) : Math.round(ms / 60000) + ' min');
  const lessonHref = (id, n) => `lesson.html?course=${encodeURIComponent(id)}&lesson=${n}`;

  const STATES = {
    mastered: { label: 'Mastered' },
    shaky: { label: 'Shaky' },
    progress: { label: 'In progress' },
    new: { label: 'Not started' },
    locked: { label: 'Locked' }
  };
  const ORDER = ['mastered', 'shaky', 'progress', 'new', 'locked'];
  const LOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  document.addEventListener('primer:course', (e) => mount(e.detail.view, e.detail.course));

  function lockedOf(course, l) {
    try {
      if (typeof P.lessonLocked === 'function') return Boolean(P.lessonLocked(course, l.n));
    } catch (err) { /* no lock information */ }
    return Boolean(l.locked);
  }

  // one lesson's state and numbers
  function lessonInfo(course, l, nums) {
    const p = (course.progress || {})[l.n] || null;
    const answered = p && p.answered ? Object.values(p.answered) : [];
    const objective = answered.filter((a) => a && (a.status === 'correct' || a.status === 'revealed'));
    const firstTry = objective.filter((a) => a.status === 'correct' && (a.tries || 1) === 1).length;
    const written = answered.filter((a) => a && a.status === 'submitted').length;
    const x = nums || {};
    const info = {
      n: l.n, title: l.title, unit: l.unitIndex,
      done: Boolean(p && p.done), answered: answered.length, objective: objective.length, firstTry, written,
      open: x.open || 0, fixed: x.fixed || 0, notYet: x.notYet || 0, ms: x.ms || 0
    };
    const low = info.objective >= 2 && firstTry / info.objective < 0.5;
    info.low = low;
    if (lockedOf(course, l) && !info.done) info.state = 'locked';
    else if (info.open > 0 || info.notYet > 0 || low) info.state = info.answered || info.done || info.open ? 'shaky' : 'new';
    else if (info.done) info.state = 'mastered';
    else if (p || info.ms > 0) info.state = 'progress';
    else info.state = 'new';
    return info;
  }

  function numbersHTML(i) {
    const rows = [];
    rows.push(i.answered
      ? (i.objective ? fill('{n} questions answered, {k} right on the first try', { n: i.answered, k: i.firstTry }) : fill('{n} questions answered', { n: i.answered }))
      : t('No questions answered yet'));
    if (i.open || i.fixed) {
      rows.push(i.open && i.fixed ? fill('Mistakes: {fixed} fixed, {open} still coming back', { fixed: i.fixed, open: i.open })
        : i.open ? (i.open === 1 ? t('1 mistake still coming back in Review') : fill('{n} mistakes still coming back in Review', { n: i.open }))
          : (i.fixed === 1 ? t('1 mistake, now fixed') : fill('{n} mistakes, all fixed', { n: i.fixed })));
    } else if (i.answered) rows.push(t('No mistakes to review'));
    if (i.notYet) rows.push(i.notYet === 1 ? t('1 written answer marked “not yet”') : fill('{n} written answers marked “not yet”', { n: i.notYet }));
    rows.push(i.ms ? fill('{time} studied', { time: duration(i.ms) }) : t('No study time yet'));
    return rows;
  }

  function mount(view, course) {
    const head = view.querySelector('.course-head');
    if (!head) return;
    const flat = P.courseGen.flatten(course);
    if (!flat.length) return;
    const box = document.createElement('section');
    box.className = 'kmap card card--solid';
    box.setAttribute('aria-labelledby', 'kmap-title');
    head.after(box);
    let nums = {};
    let infos = [];
    let tipFor = null, lastPointer = 'mouse', downTip = null;

    function compute() { infos = flat.map((l) => lessonInfo(course, l, nums[l.n])); }

    // the exams (assets/js/exams.js) say which lessons are locked once they have loaded
    const onLocks = (e) => {
      if (!box.isConnected) { document.removeEventListener('primer:locks', onLocks); return; }
      if (e.detail && e.detail.courseId === course.id) render();
    };
    document.addEventListener('primer:locks', onLocks);

    function render() {
      compute();
      const counts = {};
      ORDER.forEach((s) => { counts[s] = 0; });
      infos.forEach((i) => { counts[i.state]++; });
      // "Mastered: 3": a label and a number reads right in every language, with no plural forms to get wrong
      const summary = ORDER.filter((s) => counts[s]).map((s) => `${t(STATES[s].label)}: ${counts[s]}`).join(' · ');
      const shaky = infos.filter((i) => i.state === 'shaky');
      box.innerHTML = `
        <header class="kmap__head">
          <div>
            <h2 id="kmap-title">${T('Knowledge map')}</h2>
            <p class="kmap__summary">${esc(summary)}</p>
          </div>
          <ul class="kmap__legend" aria-label="${T('Key')}">
            ${ORDER.filter((s) => s !== 'locked' || counts.locked).map((s) => `<li><span class="kmap__swatch is-${s}" aria-hidden="true">${s === 'locked' ? LOCK : ''}</span>${T(STATES[s].label)}</li>`).join('')}
          </ul>
        </header>
        <div class="kmap__units">
          ${course.units.map((u, ui) => `
            <section class="kmap__unit" aria-labelledby="kmap-u${ui}">
              <h3 class="kmap__unit-title" id="kmap-u${ui}"><span class="kmap__unit-num">${esc(fill('Unit {n}', { n: P.roman(ui + 1) }))}</span> <span class="kmap__unit-name">${esc(u.title)}</span></h3>
              <div class="kmap__track" data-unit="${ui + 1}">
                <svg class="kmap__path" aria-hidden="true"></svg>
                <ol class="kmap__nodes">${infos.filter((i) => i.unit === ui + 1).map(nodeHTML).join('')}</ol>
              </div>
            </section>`).join('')}
        </div>
        ${shaky.length ? `<p class="kmap__focus"><strong>${T('Worth another look:')}</strong> ${shaky.slice(0, 6).map((i) => `<a href="${lessonHref(course.id, i.n)}">${esc(fill('Lesson {n}', { n: i.n }))}<span class="kmap__focus-t">: ${esc(i.title)}</span></a>`).join(', ')}${shaky.some((i) => i.open) ? ` · <a href="review.html?course=${encodeURIComponent(course.id)}">${T('Review its mistakes')}</a>` : ''}</p>` : ''}
        <details class="kmap__list">
          <summary>${T('The map as a list')}</summary>
          <table class="kmap__table">
            <caption class="sr-only">${T('Every lesson, its state and its numbers')}</caption>
            <thead><tr><th scope="col">${T('Lesson')}</th><th scope="col">${T('State')}</th><th scope="col">${T('Numbers')}</th></tr></thead>
            <tbody>${infos.map((i) => `<tr><th scope="row"><a href="${lessonHref(course.id, i.n)}">${i.n}. <span class="ugc">${esc(i.title)}</span></a></th><td><span class="kmap__chip is-${i.state}">${T(STATES[i.state].label)}</span></td><td>${numbersHTML(i).map(esc).join('<br>')}</td></tr>`).join('')}</tbody>
          </table>
        </details>
        <div class="kmap__tip" aria-hidden="true" hidden></div>`;
      if (P.contentLang) P.contentLang(box.querySelector('.kmap__units'), course.lang || 'en');
      layout();
    }

    function nodeHTML(i) {
      const st = t(STATES[i.state].label);
      const label = [fill('Lesson {n}: {title}', { n: i.n, title: i.title }), st].concat(numbersHTML(i)).join('. ');
      const locked = i.state === 'locked';
      return `<li class="kmap__stop">
        <a class="kmap__node is-${i.state}" ${locked ? 'aria-disabled="true"' : `href="${lessonHref(course.id, i.n)}"`} data-n="${i.n}" aria-label="${esc(label)}">
          <span class="kmap__num" aria-hidden="true">${locked ? LOCK : i.n}</span>
          ${i.state === 'mastered' ? '<span class="kmap__mark" aria-hidden="true">✓</span>' : i.state === 'shaky' ? '<span class="kmap__mark" aria-hidden="true">!</span>' : ''}
        </a></li>`;
    }

    // Each unit's lessons as a winding path: left to right, then back, as many to a row as fit.
    const NODE = 46, GAP = 26, ROW = 74;
    function layout() {
      box.querySelectorAll('.kmap__track').forEach((track) => {
        const stops = Array.from(track.querySelectorAll('.kmap__stop'));
        const w = track.clientWidth;
        if (!w) return;
        const cols = Math.max(1, Math.min(stops.length, Math.floor((w - 40 + GAP) / (NODE + GAP))));
        const rows = Math.ceil(stops.length / cols);
        const span = cols > 1 ? (w - 40 - NODE) / (cols - 1) : 0;
        const pts = stops.map((li, k) => {
          const r = Math.floor(k / cols), c0 = k % cols;
          const c = r % 2 ? cols - 1 - c0 : c0;
          const x = 20 + NODE / 2 + c * Math.min(span, NODE + GAP * 2.2) + (cols > 1 ? 0 : (w - 40 - NODE) / 2);
          const y = 12 + NODE / 2 + r * ROW;
          li.style.left = (x - NODE / 2) + 'px';
          li.style.top = (y - NODE / 2) + 'px';
          return [x, y];
        });
        track.style.height = (rows * ROW - ROW + NODE + 24) + 'px';
        const svg = track.querySelector('.kmap__path');
        svg.setAttribute('viewBox', `0 0 ${w} ${track.clientHeight}`);
        let d = '';
        pts.forEach(([x, y], k) => {
          if (!k) { d += `M${x} ${y}`; return; }
          const [px, py] = pts[k - 1];
          if (py === y) d += ` L${x} ${y}`;
          else { const out = (Math.floor((k - 1) / cols) % 2 ? -1 : 1) * 30; d += ` C${px + out} ${py} ${x + out} ${y} ${x} ${y}`; }
        });
        const doneUpTo = stops.map((li) => li.querySelector('.kmap__node')).findIndex((a) => !(a.classList.contains('is-mastered') || a.classList.contains('is-shaky') || a.classList.contains('is-progress')));
        svg.innerHTML = `<path class="kmap__line" d="${d}"/>`;
        if (doneUpTo !== 0 && pts.length > 1) {
          const upto = doneUpTo === -1 ? pts.length : doneUpTo;
          const sub = d.split(/ (?=[LC])/).slice(0, upto).join(' ');
          if (upto > 1) svg.innerHTML += `<path class="kmap__line is-walked" d="${sub}"/>`;
        }
      });
    }

    /* ---------- the numbers beside a lesson ---------- */
    function showTip(a) {
      const tip = box.querySelector('.kmap__tip');
      const i = infos[Number(a.dataset.n) - 1];
      if (!i) return;
      tipFor = i.n;
      tip.className = 'kmap__tip is-' + i.state;
      tip.innerHTML = `<p class="kmap__tip-n">${esc(fill('Lesson {n}', { n: i.n }))} · <span class="kmap__chip is-${i.state}">${T(STATES[i.state].label)}</span></p>
        <p class="kmap__tip-t ugc">${esc(i.title)}</p>
        <ul class="kmap__tip-nums">${numbersHTML(i).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        ${i.state !== 'locked' ? `<a class="btn btn--small kmap__tip-go" href="${lessonHref(course.id, i.n)}" tabindex="-1">${T('Open the lesson')}</a>` : `<p class="kmap__tip-lock">${T('This lesson opens when the unit before it is passed.')}</p>`}`;
      tip.hidden = false;
      const br = box.getBoundingClientRect(), r = a.getBoundingClientRect();
      const tw = Math.min(290, br.width - 24);
      tip.style.width = tw + 'px';
      let left = r.left - br.left + r.width / 2 - tw / 2;
      left = Math.max(12, Math.min(br.width - tw - 12, left));
      tip.style.left = left + 'px';
      const below = r.bottom - br.top + 10;
      tip.style.top = below + 'px';
      // above the lesson if there's no room below it in the window
      const h = tip.offsetHeight;
      if (r.bottom + 10 + h > window.innerHeight && r.top - h - 10 > 0) tip.style.top = (r.top - br.top - h - 10) + 'px';
    }
    function hideTip() { const tip = box.querySelector('.kmap__tip'); if (tip) tip.hidden = true; tipFor = null; }

    box.addEventListener('pointerover', (e) => { const a = e.target.closest('.kmap__node'); if (a && e.pointerType !== 'touch') showTip(a); });
    box.addEventListener('pointerout', (e) => {
      const a = e.target.closest('.kmap__node');
      if (a && e.pointerType !== 'touch' && !(e.relatedTarget && (a.contains(e.relatedTarget) || e.relatedTarget.closest('.kmap__tip')))) hideTip();
    });
    box.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; downTip = tipFor; if (!e.target.closest('.kmap__node, .kmap__tip')) hideTip(); });
    box.addEventListener('focusin', (e) => { const a = e.target.closest('.kmap__node'); if (a) showTip(a); });
    box.addEventListener('focusout', (e) => { if (!(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.kmap__node'))) hideTip(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tipFor) { hideTip(); } });
    box.addEventListener('click', (e) => {
      const a = e.target.closest('.kmap__node');
      if (!a) return;
      // on a touch screen the first tap shows the numbers; the second (or "Open the lesson") opens it
      if (a.getAttribute('aria-disabled') === 'true') { e.preventDefault(); showTip(a); return; }
      if (lastPointer === 'touch' && downTip !== Number(a.dataset.n)) { e.preventDefault(); showTip(a); } // (the tap's focus already showed it)
    });

    render();
    if (window.ResizeObserver) {
      let last = 0;
      new ResizeObserver(() => { const w = box.clientWidth; if (w !== last) { last = w; layout(); hideTip(); } }).observe(box);
    }
    const load = P.study ? P.study.courseData(course.id) : P.get('/api/study/course/' + encodeURIComponent(course.id));
    load.then((d) => { nums = d.lessons || {}; render(); }).catch(() => {});
    if (P.tReady) P.tReady.then(() => render());
  }

  P.knowmap = { lessonInfo };
})();
