/* =====================================================================
   class.html?id=<class>: the teacher's dashboard for one class.
   The join code (copy, close, reopen), the roster, how far the class has
   got in each lesson, the checkpoint questions the class gets wrong and
   the doubts students ask. Everything comes from GET /api/classes/:id,
   which only answers the class's teacher and only reads the students'
   copies of this class's course. It refreshes itself every minute while
   the page is in view.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, esc = P.esc;
  if (!P.auth.current()) return;
  P.mountUserNav();

  const id = Number(P.params.get('id'));
  const root = $('#cls'), status = $('#cls-status');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const fmtCode = (c) => String(c || '').replace(/^(.{3})(.{3})$/, '$1-$2');
  const spell = (c) => String(c || '').split('').join(' ');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const REFRESH_MS = 60_000;

  const MATH = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false }
    ],
    throwOnError: false,
    strict: 'ignore'
  };
  const math = (el) => {
    if (!window.renderMathInElement) return;
    el.querySelectorAll('[data-math]').forEach((n) => {
      try { window.renderMathInElement(n, MATH); } catch (e) { console.warn('[Primer] maths', e); }
    });
  };

  let rtf = null;
  try { rtf = new Intl.RelativeTimeFormat(P.lang || 'en', { numeric: 'auto' }); } catch (e) { rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }); }
  function ago(t) {
    const s = Math.round((t - Date.now()) / 1000);
    const a = Math.abs(s);
    if (a < 45) return rtf.format(0, 'second');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 86400 * 14) return rtf.format(Math.round(s / 86400), 'day');
    try { return new Date(t).toLocaleDateString(P.lang || 'en', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return new Date(t).toDateString(); }
  }
  const when = (t) => `<time datetime="${new Date(t).toISOString()}" title="${esc(new Date(t).toLocaleString(P.lang || 'en'))}" data-no-i18n>${esc(ago(t))}</time>`;

  function fail(title, text) {
    root.hidden = false;
    status.hidden = true;
    root.innerHTML = `<div class="notfound card card--solid">
        <h1>${esc(title)}</h1><p>${esc(text)}</p>
        <p class="notfound__go"><a class="btn" href="app.html#library">Go to your courses</a></p>
      </div>`;
  }

  if (!Number.isInteger(id) || id < 1) { fail('Class not found', 'This link doesn’t name a class.'); return; }

  let data = null, timer = 0, renaming = false;
  async function load(quiet) {
    if (quiet && renaming) return; // a refresh would wipe the name being typed
    try {
      data = await P.get(`/api/classes/${id}`);
      render();
    } catch (err) {
      if (quiet) return;
      if (err.status === 404) fail('Class not found', 'Only the teacher of a class can open its dashboard. If you teach it, check the link.');
      else fail('The class didn’t load', err.message);
      return;
    } finally {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!document.hidden) load(true); }, REFRESH_MS);
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && data) load(true); });

  /* ------------------------------------------------------------------
     Rendering
  ------------------------------------------------------------------ */
  function headHTML(c) {
    return `<header class="cls-head card card--solid">
        <div class="cls-head__main">
          <p class="cls-kicker">Class dashboard</p>
          <div class="cls-head__name" data-name>
            <h1 id="cls-title" tabindex="-1" data-no-i18n>${esc(c.name)}</h1>
            <button class="textlink" type="button" data-rename>Rename</button>
          </div>
          <p class="cls-head__meta"><span>Teaching</span> <a href="app.html?course=${encodeURIComponent(c.courseId)}" data-no-i18n>${esc(c.courseTitle)}</a> · <span>${plural(c.lessons, 'lesson')}</span></p>
          <p class="cls-head__why">Primer’s tutor answers each student’s doubts as they come up. This page shows you what the whole class finds hard.</p>
        </div>
        <div class="codecard cls-code${c.open ? '' : ' is-closed'}">
          <p class="codecard__label">Join code</p>
          <p class="codecard__code" data-no-i18n><span class="sr-only">${esc(spell(c.code))}</span><span aria-hidden="true">${esc(fmtCode(c.code))}</span></p>
          <p class="cls-code__state">${c.open ? 'Open: students can join with this code.' : 'Closed: nobody new can join.'}</p>
          <div class="codecard__actions">
            <button class="btn btn--small" type="button" data-copy>Copy code</button>
            <button class="textlink" type="button" data-toggle>${c.open ? 'Close the class' : 'Reopen the class'}</button>
          </div>
        </div>
      </header>`;
  }

  function statsHTML(d) {
    const c = d.class, n = d.roster.length;
    const done = d.roster.reduce((a, r) => a + r.done, 0);
    const tiles = [
      [String(n), n === 1 ? 'student' : 'students'],
      [`${pct(done, n * c.lessons)}%`, 'average progress'],
      c.source !== 'sample' ? [`${c.written}/${c.lessons}`, 'lessons written, ready for everyone'] : null,
      [String(d.counts.doubts), d.counts.doubts === 1 ? 'doubt asked' : 'doubts asked'],
      [String(d.counts.mistakes), d.counts.mistakes === 1 ? 'wrong answer' : 'wrong answers']
    ].filter(Boolean);
    return `<section class="cls-stats" aria-label="Summary">${tiles.map(([v, l]) =>
      `<div class="stat"><p class="stat__v" data-no-i18n>${esc(v)}</p><p class="stat__l">${esc(l)}</p></div>`).join('')}</section>`;
  }

  function rosterHTML(d) {
    const c = d.class;
    const body = d.roster.length ? `<div class="tablewrap"><table class="roster">
        <thead><tr><th scope="col">Student</th><th scope="col">Lessons done</th><th scope="col">Last active</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
        <tbody>${d.roster.map((r) => `<tr>
          <th scope="row"><span class="roster__name" data-no-i18n>${esc(r.name)}</span>
            <span class="roster__sub">${plural(r.doubts, 'doubt')} · ${plural(r.mistakes, 'wrong answer')}</span></th>
          <td><span class="roster__done">${r.done} of ${r.total}</span>
            <span class="bar roster__bar" aria-hidden="true"><span style="width:${pct(r.done, r.total)}%"></span></span></td>
          <td>${when(r.lastActive)}</td>
          <td class="roster__act"><button class="textlink" type="button" data-remove="${r.id}" data-name="${esc(r.name)}">Remove</button></td>
        </tr>`).join('')}</tbody></table></div>`
      : `<p class="cls-empty">No students yet. Share the join code: students choose “Join a class” under Your courses and type it.</p>`;
    return `<section class="cls-panel card card--solid" aria-labelledby="h-roster">
        <div class="cls-panel__head"><h2 id="h-roster">Students</h2><span class="cls-panel__count">${plural(d.roster.length, 'student')}</span></div>
        ${body}
        ${c.open || !d.roster.length ? '' : '<p class="help cls-panel__note">The class is closed, so nobody new can join. Students already in it carry on as before.</p>'}
      </section>`;
  }

  function lessonsHTML(d) {
    const n = d.roster.length;
    let unit = 0;
    const rows = d.lessons.map((l) => {
      const head = l.unitIndex !== unit ? `<li class="lbars__unit"><span>Unit ${P.roman(l.unitIndex)}</span> <span data-no-i18n>${esc(l.unit)}</span></li>` : '';
      unit = l.unitIndex;
      const chips = [
        l.doubts ? `<span class="lbars__chip">${plural(l.doubts, 'doubt')}</span>` : '',
        l.mistakes ? `<span class="lbars__chip lbars__chip--miss">${plural(l.mistakes, 'wrong answer')}</span>` : '',
        d.class.source !== 'sample' && !l.written ? '<span class="lbars__chip lbars__chip--dim">Not written yet</span>' : ''
      ].join('');
      return `${head}<li class="lbars__row">
          <span class="lbars__n" aria-hidden="true">${l.n}</span>
          <span class="lbars__main">
            <span class="lbars__title"><span class="sr-only">Lesson ${l.n}: </span><span data-no-i18n>${esc(l.title)}</span></span>
            <span class="lbars__bar" aria-hidden="true"><span class="lbars__done" style="width:${pct(l.done, n)}%"></span><span class="lbars__going" style="width:${pct(l.started, n)}%"></span></span>
            ${chips ? `<span class="lbars__chips">${chips}</span>` : ''}
          </span>
          <span class="lbars__side"><span>${l.done} of ${n} done</span>${l.started ? `<span class="lbars__going-t">${l.started} in progress</span>` : ''}</span>
        </li>`;
    }).join('');
    return `<section class="cls-panel card card--solid" aria-labelledby="h-lessons">
        <div class="cls-panel__head"><h2 id="h-lessons">Lesson by lesson</h2>
          <span class="lbars__key" aria-hidden="true"><span class="lbars__swatch"></span>Done <span class="lbars__swatch lbars__swatch--going"></span>In progress</span></div>
        ${n ? '' : '<p class="cls-empty">Progress shows here once students join and start the lessons.</p>'}
        <ol class="lbars">${rows}</ol>
      </section>`;
  }

  function wrongHTML(d) {
    const list = d.wrong.map((w) => `<li class="wrong">
        <p class="wrong__where">${w.lesson ? `<span>Lesson ${w.lesson}</span>${w.lessonTitle ? ` · <span data-no-i18n>${esc(w.lessonTitle)}</span>` : ''}` : '<span>A lesson</span>'}</p>
        <p class="wrong__q" data-math data-no-i18n>${esc(w.prompt)}</p>
        <div class="wrong__meter" aria-hidden="true"><span style="width:${pct(w.students, w.of)}%"></span></div>
        <p class="wrong__stat"><strong>Missed by ${w.students} of ${w.of} students</strong>${w.times > w.students ? ` · <span>${plural(w.times, 'wrong answer')}</span>` : ''}</p>
        ${w.commonWrong ? `<p class="wrong__ans"><span class="wrong__lab">Most common wrong answer</span> <q data-math data-no-i18n>${esc(w.commonWrong.text)}</q>${w.commonWrong.students > 1 ? ` <span class="wrong__n">(${plural(w.commonWrong.students, 'student')})</span>` : ''}</p>` : ''}
        ${w.correct ? `<p class="wrong__ans"><span class="wrong__lab">Answer</span> <q data-math data-no-i18n>${esc(w.correct)}</q></p>` : ''}
      </li>`).join('');
    return `<section class="cls-sheet" aria-labelledby="h-wrong">
        <h2 id="h-wrong">Questions the class gets wrong</h2>
        <p class="cls-sheet__help">Checkpoint questions students answered wrongly, the most missed first. Worth going over with everyone.</p>
        ${list ? `<ol class="wrongs">${list}</ol>` : '<p class="cls-sheet__empty">No wrong answers yet. When students miss a checkpoint question, it shows up here.</p>'}
      </section>`;
  }

  function doubtsHTML(d) {
    const list = d.doubts.map((x) => `<li class="dlist__item">
        <p class="dlist__meta"><strong data-no-i18n>${esc(x.student)}</strong>${x.lesson ? ` · <span>Lesson ${x.lesson}</span>${x.lessonTitle ? `<span>:</span> <span data-no-i18n>${esc(x.lessonTitle)}</span>` : ''}` : ''} · ${when(x.at)}</p>
        ${x.quote ? `<blockquote class="dlist__quote" data-math data-no-i18n>${esc(x.quote)}</blockquote>` : x.kind === 'drawing' ? '<p class="dlist__sketch">Asked about part of the whiteboard</p>' : ''}
        <p class="dlist__q" data-math data-no-i18n>${esc(x.question)}</p>
        <p class="dlist__state${x.answered ? '' : ' is-waiting'}">${x.answered ? 'Answered by the tutor' : 'Waiting for the tutor'}</p>
      </li>`).join('');
    return `<section class="cls-panel card card--solid" aria-labelledby="h-doubts">
        <div class="cls-panel__head"><h2 id="h-doubts">Recent doubts</h2>${d.counts.doubts ? `<span class="cls-panel__count">${plural(d.counts.doubts, 'doubt')} in all</span>` : ''}</div>
        ${list ? `<ol class="dlist">${list}</ol>` : '<p class="cls-empty">No doubts yet. The doubts students ask in this course appear here.</p>'}
      </section>`;
  }

  function render() {
    renaming = false;
    const d = data, c = d.class;
    document.title = `${c.name} | Primer`;
    const focusSel = document.activeElement && document.activeElement.closest('#cls') ? focusKey(document.activeElement) : null;
    root.innerHTML = `
      <a class="backlink" href="app.html?course=${encodeURIComponent(c.courseId)}">Course outline</a>
      ${headHTML(c)}
      ${statsHTML(d)}
      ${rosterHTML(d)}
      <div class="cls-grid">
        ${wrongHTML(d)}
        ${doubtsHTML(d)}
      </div>
      ${lessonsHTML(d)}
      <section class="cls-end" aria-label="Delete this class">
        <button class="textlink cls-end__btn" type="button" data-delete>Delete this class</button>
        <p class="help">Students keep their own copies of the course and everything in them. You lose this dashboard and the join code stops working.</p>
      </section>`;
    status.hidden = true;
    root.hidden = false;
    math(root);
    if (focusSel) { const el = root.querySelector(focusSel); if (el) el.focus({ preventScroll: true }); }
  }
  // Which control had focus, so a quiet refresh doesn't drop the keyboard user.
  function focusKey(el) {
    for (const a of ['data-copy', 'data-toggle', 'data-rename', 'data-delete']) if (el.hasAttribute(a)) return `[${a}]`;
    if (el.dataset.remove) return `[data-remove="${el.dataset.remove}"]`;
    return null;
  }

  /* ------------------------------------------------------------------
     Actions
  ------------------------------------------------------------------ */
  async function copy(value) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('copy refused');
      }
      P.toast('Code copied.');
    } catch (e) {
      P.toast('Couldn’t copy. Select it and copy it yourself.', 'error');
    }
  }

  function startRename() {
    const slot = root.querySelector('[data-name]');
    slot.innerHTML = `<form class="cls-rename" novalidate>
        <label class="sr-only" for="cls-name">New name for the class</label>
        <input class="input" id="cls-name" maxlength="80" autocomplete="off" aria-describedby="cls-name-err">
        <button class="btn btn--small" type="submit">Save</button>
        <button class="textlink" type="button" data-rename-cancel>Cancel</button>
        <p class="field__error" id="cls-name-err"></p>
      </form>`;
    const input = slot.querySelector('input');
    input.value = data.class.name;
    input.focus();
    input.select();
    renaming = true;
  }

  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('.cls-rename');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input'), err = form.querySelector('.field__error');
    const name = P.clean(input.value, 80);
    if (!name) { err.textContent = 'Give the class a name.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    form.querySelector('[type="submit"]').disabled = true;
    try {
      await P.patch(`/api/classes/${id}`, { name });
      await load();
      root.querySelector('#cls-title').focus();
      P.toast('Renamed the class.');
    } catch (ex) {
      form.querySelector('[type="submit"]').disabled = false;
      err.textContent = ex.message;
      input.setAttribute('aria-invalid', 'true');
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.closest('.cls-rename')) { render(); root.querySelector('[data-rename]').focus(); load(true); }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-copy')) return copy(fmtCode(data.class.code));
    if (t.hasAttribute('data-rename')) return startRename();
    if (t.hasAttribute('data-rename-cancel')) { render(); root.querySelector('[data-rename]').focus(); load(true); return; }

    if (t.hasAttribute('data-toggle')) {
      const open = !data.class.open;
      t.disabled = true;
      try {
        await P.patch(`/api/classes/${id}`, { open });
        await load();
        P.toast(open ? 'The class is open again. Students can join with the code.' : 'The class is closed. Nobody new can join.');
      } catch (err) {
        t.disabled = false;
        P.toast(err.message, 'error');
      }
      return;
    }

    if (t.dataset.remove) {
      const name = t.dataset.name;
      if (!window.confirm(`Remove ${name} from the class? Their copy of the course stays theirs, and you’ll no longer see their work.`)) return;
      t.disabled = true;
      try {
        await P.del(`/api/classes/${id}/members/${t.dataset.remove}`);
        await load();
        P.toast(`Removed ${name} from the class.`);
        const h = root.querySelector('#h-roster');
        if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
      } catch (err) {
        t.disabled = false;
        P.toast(err.message, 'error');
      }
      return;
    }

    if (t.hasAttribute('data-delete')) {
      const c = data.class;
      if (!window.confirm(`Delete the class “${c.name}”? Its ${plural(data.roster.length, 'student')} keep their own copies of the course, but this dashboard and the join code go. This can’t be undone.`)) return;
      t.disabled = true;
      try {
        await P.del(`/api/classes/${id}`);
        location.href = 'app.html?course=' + encodeURIComponent(c.courseId);
      } catch (err) {
        t.disabled = false;
        P.toast('Couldn’t delete the class: ' + err.message, 'error');
      }
    }
  });

  // KaTeX arrives from the CDN; draw the maths again once it has.
  window.addEventListener('load', () => { if (data) math(root); });

  load();
})();
