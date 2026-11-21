/* =====================================================================
   Class mode on app.html: one teacher, many students (server/classes.mjs).
   - P.classes: the classes I teach and the ones I'm in.
   - A course I own: "Teach this as a class" opens a small dialog that
     makes a class and shows its join code. Classes made from the course
     are listed above its outline, with a link to each dashboard.
   - My copy of a class's course: who teaches it, what they can see, and
     "Leave class" (the copy stays mine).
   - The library: "Join a class" (code, then the class and what the
     teacher will see, then join), app.html?join=CODE opens it filled in,
     a short list of my classes, and a line on each class course's card.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const $ = P.$, esc = P.esc;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const fmtCode = (c) => String(c || '').replace(/^(.{3})(.{3})$/, '$1-$2');
  const spell = (c) => String(c || '').split('').join(' ');
  const joinLink = (code) => `${location.origin}/app.html?join=${encodeURIComponent(code)}`;
  const CONSENT = 'Your teacher will see your progress, the questions you get wrong and the doubts you ask in this course.';

  P.classes = {
    _mine: null,
    _course: new Map(), // course id -> { member, teaching }
    mine(force) {
      if (!this._mine || force) this._mine = P.get('/api/classes').catch((err) => { this._mine = null; throw err; });
      return this._mine;
    },
    async forCourse(id) {
      const d = await P.get(`/api/courses/${encodeURIComponent(id)}/class`);
      this._course.set(id, d);
      return d;
    },
    create: (courseId, name) => P.post('/api/classes', { courseId, name }),
    lookup: (code) => P.post('/api/classes/lookup', { code }),
    join: (code) => P.post('/api/classes/join', { code }),
    leave: (id) => P.post(`/api/classes/${id}/leave`, {}),

    // Added to the "Delete course" question when the course belongs to a class.
    deleteWarning(course) {
      const d = this._course.get(course.id);
      if (!d) return '';
      if (d.member) return `\n\nYou’ll also leave the class “${d.member.name}”.`;
      if (!d.teaching.length) return '';
      const names = d.teaching.map((c) => `“${c.name}”`).join(', ');
      return `\n\nThis course is taught as ${d.teaching.length === 1 ? 'the class' : 'the classes'} ${names}. Deleting it ends ${d.teaching.length === 1 ? 'that class' : 'those classes'} and their dashboards. Students keep their own copies.`;
    },

    mountCourse,
    mountLibrary
  };

  /* ------------------------------------------------------------------
     A small modal dialog
  ------------------------------------------------------------------ */
  let dialogN = 0;
  function openDialog(title, bodyHTML) {
    const id = `cdialog-${++dialogN}`;
    const dlg = document.createElement('dialog');
    dlg.className = 'cdialog';
    dlg.setAttribute('aria-labelledby', `${id}-title`);
    dlg.innerHTML = `
      <button class="cdialog__x" type="button" data-close aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <h2 class="cdialog__title" id="${id}-title">${esc(title)}</h2>
      <div class="cdialog__body">${bodyHTML}</div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { dlg.close(); return; }
      if (e.target !== dlg) return;
      // a click on the dimmed page around the dialog closes it too
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
  }

  async function copyText(value, okMsg) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('copy refused');
      }
      P.toast(okMsg);
    } catch (e) {
      P.toast('Couldn’t copy. Select it and copy it yourself.', 'error');
    }
  }

  function codeCard(c) {
    return `<div class="codecard">
        <p class="codecard__label">Join code</p>
        <p class="codecard__code" data-no-i18n><span class="sr-only">${esc(spell(c.code))}</span><span aria-hidden="true">${esc(fmtCode(c.code))}</span></p>
        <div class="codecard__actions">
          <button class="btn btn--small" type="button" data-copy-code="${esc(c.code)}">Copy code</button>
          <button class="textlink" type="button" data-copy-link="${esc(c.code)}">Copy a link that joins it</button>
        </div>
      </div>`;
  }

  function wireCopies(root) {
    root.addEventListener('click', (e) => {
      const code = e.target.closest('[data-copy-code]');
      if (code) copyText(fmtCode(code.dataset.copyCode), 'Code copied.');
      const link = e.target.closest('[data-copy-link]');
      if (link) copyText(joinLink(link.dataset.copyLink), 'Link copied.');
    });
  }

  /* ------------------------------------------------------------------
     The course page
  ------------------------------------------------------------------ */
  function teachingList(list) {
    return `<ul class="classnote__list">${list.map((c) => `<li>
        <a class="classnote__name" href="class.html?id=${c.id}" data-no-i18n>${esc(c.name)}</a>
        <span class="classnote__code" data-no-i18n title="Join code">${esc(fmtCode(c.code))}</span>
        <span class="classnote__meta">${plural(c.students, 'student')}</span>
        ${c.open ? '' : '<span class="classnote__closed">Closed</span>'}
        <a class="textlink" href="class.html?id=${c.id}">Open the dashboard</a>
      </li>`).join('')}</ul>`;
  }

  async function mountCourse(view, course) {
    let info;
    try { info = await P.classes.forCourse(course.id); } catch (err) { console.warn('[Primer] classes:', err.message); return; }
    const head = view.querySelector('.course-head');
    const actions = view.querySelector('.course-head__actions');
    if (!head || !actions || !view.isConnected) return;
    const slot = document.createElement('div');
    slot.className = 'classnote-slot';
    (head.querySelector('.course-head__meta') || head.querySelector('h1')).after(slot);

    if (info.member) {
      const m = info.member;
      slot.innerHTML = `<div class="classnote">
          <p class="classnote__head"><span class="classnote__kicker">Class</span> <strong class="classnote__name" data-no-i18n>${esc(m.name)}</strong></p>
          <p class="classnote__line"><span>Taught by</span> <span class="classnote__who" data-no-i18n>${esc(m.teacher)}</span></p>
          <p class="classnote__help">Your teacher sees your progress, the questions you get wrong and the doubts you ask in this course.</p>
        </div>`;
      const btn = document.createElement('button');
      btn.className = 'textlink';
      btn.type = 'button';
      btn.textContent = 'Leave class';
      actions.appendChild(btn);
      btn.addEventListener('click', async () => {
        if (!window.confirm(`Leave the class “${m.name}”? Your teacher will no longer see your work here. This course stays in your library.`)) return;
        btn.disabled = true;
        try {
          await P.classes.leave(m.id);
          P.classes._course.set(course.id, { member: null, teaching: [] });
          slot.innerHTML = '';
          btn.remove();
          P.toast(`You left “${m.name}”. The course is still yours.`);
        } catch (err) {
          btn.disabled = false;
          P.toast('Couldn’t leave the class: ' + err.message, 'error');
        }
      });
      return;
    }

    const paint = () => {
      const list = (P.classes._course.get(course.id) || info).teaching;
      slot.innerHTML = list.length ? `<div class="classnote">
          <p class="classnote__head"><span class="classnote__kicker">${list.length === 1 ? 'Taught as a class' : 'Taught as classes'}</span></p>
          ${teachingList(list)}
        </div>` : '';
    };
    paint();
    const btn = document.createElement('button');
    btn.className = 'btn btn--ghost btn--small';
    btn.type = 'button';
    btn.textContent = 'Teach this as a class';
    btn.setAttribute('aria-haspopup', 'dialog');
    const cta = actions.querySelector('.btn');
    if (cta) cta.after(btn); else actions.prepend(btn);
    btn.addEventListener('click', () => openTeach(course, () => P.classes.forCourse(course.id).then(paint).catch(() => {})));
  }

  function openTeach(course, onMade) {
    const have = (P.classes._course.get(course.id) || { teaching: [] }).teaching;
    const dlg = openDialog('Teach this as a class', `
      <p class="cdialog__lead">Every student who joins gets their own copy of this course. Primer’s tutor answers each student’s doubts, and your dashboard shows what the whole class gets wrong.</p>
      ${have.length ? `<div class="cdialog__have"><p class="cdialog__sub">Classes from this course</p>${teachingList(have)}</div>` : ''}
      <form class="cdialog__form" novalidate>
        <label class="label" for="cd-name">${have.length ? 'Name of the new class' : 'Class name'}</label>
        <input class="input" id="cd-name" type="text" maxlength="80" autocomplete="off" aria-describedby="cd-name-help cd-name-err">
        <p class="help" id="cd-name-help">Students see this name when they join, for example “Year 9 Physics, Period 3”.</p>
        <p class="field__error" id="cd-name-err"></p>
        <div class="cdialog__actions">
          <button class="btn" type="submit">${have.length ? 'Make another class' : 'Make the class'}</button>
          <button class="textlink" type="button" data-close>Cancel</button>
        </div>
      </form>
      <div class="cdialog__made" hidden></div>`);
    const form = dlg.querySelector('form');
    const input = dlg.querySelector('#cd-name'), err = dlg.querySelector('#cd-name-err');
    input.value = course.title;
    input.focus();
    input.select();
    wireCopies(dlg);
    input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = P.clean(input.value, 80);
      if (!name) { err.textContent = 'Give the class a name.'; input.setAttribute('aria-invalid', 'true'); input.focus(); P.shake(input); return; }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const { class: c } = await P.classes.create(course.id, name);
        P.classes._mine = null;
        form.hidden = true;
        const have = dlg.querySelector('.cdialog__have');
        if (have) have.hidden = true;
        dlg.querySelector('.cdialog__lead').hidden = true;
        const made = dlg.querySelector('.cdialog__made');
        made.innerHTML = `
          <p class="cdialog__lead"><span>Your class</span> <strong data-no-i18n>${esc(c.name)}</strong> <span>is ready. Share this code with your students.</span></p>
          ${codeCard(c)}
          <p class="help">Students sign in to Primer, choose “Join a class” under Your courses, and type the code. Each one gets their own copy of the course.</p>
          <div class="cdialog__actions">
            <a class="btn" href="class.html?id=${c.id}">Open the class dashboard</a>
            <button class="textlink" type="button" data-close>Done</button>
          </div>`;
        made.hidden = false;
        made.querySelector('[data-copy-code]').focus();
        if (onMade) onMade(c);
      } catch (ex) {
        submit.disabled = false;
        err.textContent = ex.message;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      }
    });
  }

  /* ------------------------------------------------------------------
     The library: join a class, my classes, a line on class cards
  ------------------------------------------------------------------ */
  function openJoin(prefill) {
    const dlg = openDialog('Join a class', `
      <form class="cdialog__form" data-find novalidate>
        <label class="label" for="cj-code">Class code</label>
        <input class="input input--code" id="cj-code" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7P-QX4" aria-describedby="cj-help cj-err">
        <p class="help" id="cj-help">Your teacher has a six-character code for the class.</p>
        <p class="field__error" id="cj-err" role="alert"></p>
        <div class="cdialog__actions">
          <button class="btn" type="submit">Find the class</button>
          <button class="textlink" type="button" data-close>Cancel</button>
        </div>
      </form>
      <div class="cdialog__preview" hidden></div>`);
    const form = dlg.querySelector('[data-find]');
    const input = dlg.querySelector('#cj-code'), err = dlg.querySelector('#cj-err');
    const pane = dlg.querySelector('.cdialog__preview');
    let code = '';
    const fail = (msg) => { err.textContent = msg; input.setAttribute('aria-invalid', 'true'); input.focus(); P.shake(input); };
    input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      code = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!code) { fail('Type the class code your teacher gave you.'); return; }
      if (code.length !== 6) { fail('A class code has six letters and numbers, like K7P-QX4.'); return; }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const { class: c } = await P.classes.lookup(code);
        showPreview(c);
      } catch (ex) {
        fail(ex.message);
      } finally {
        submit.disabled = false;
      }
    });

    function showPreview(c) {
      form.hidden = true;
      let foot;
      if (c.teaching) {
        foot = `<p class="cdialog__state">You teach this class.</p>
          <div class="cdialog__actions"><a class="btn" href="class.html?id=${c.id}">Open the class dashboard</a><button class="textlink" type="button" data-back>Use another code</button></div>`;
      } else if (c.memberCourseId) {
        foot = `<p class="cdialog__state">You’re already in this class.</p>
          <div class="cdialog__actions"><a class="btn" href="app.html?course=${encodeURIComponent(c.memberCourseId)}">Open your course</a><button class="textlink" type="button" data-back>Use another code</button></div>`;
      } else if (!c.open) {
        foot = `<p class="cdialog__state is-closed">This class isn’t taking new students. Ask your teacher to reopen it.</p>
          <div class="cdialog__actions"><button class="textlink" type="button" data-back>Use another code</button></div>`;
      } else {
        foot = `<p class="consent"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg><span>${CONSENT}</span></p>
          <p class="help">You get your own copy of the course to learn from. If you leave the class later, the copy stays yours.</p>
          <div class="cdialog__actions"><button class="btn" type="button" data-join>Join the class</button><button class="textlink" type="button" data-back>Use another code</button></div>`;
      }
      pane.innerHTML = `
        <div class="joincard">
          <p class="joincard__kicker">Class</p>
          <h3 class="joincard__name" data-no-i18n>${esc(c.name)}</h3>
          <p class="joincard__line"><span>Taught by</span> <strong data-no-i18n>${esc(c.teacher)}</strong></p>
          <p class="joincard__line"><span>Course</span> <span data-no-i18n>${esc(c.course.title)}</span></p>
          <p class="joincard__line joincard__count">${plural(c.course.lessons, 'lesson')}</p>
        </div>
        ${foot}`;
      pane.hidden = false;
      const first = pane.querySelector('[data-join], .btn, [data-back]');
      if (first) first.focus();
      const back = pane.querySelector('[data-back]');
      back.addEventListener('click', () => { pane.hidden = true; pane.innerHTML = ''; form.hidden = false; input.focus(); input.select(); });
      const joinBtn = pane.querySelector('[data-join]');
      if (joinBtn) {
        joinBtn.addEventListener('click', async () => {
          joinBtn.disabled = true;
          joinBtn.textContent = 'Joining…';
          try {
            const d = await P.classes.join(code);
            P.courses.put(d.course);
            P.session.set('primer.classFlash', `You joined “${c.name}”. This copy of the course is yours.`);
            location.href = 'app.html?course=' + encodeURIComponent(d.course.id);
          } catch (ex) {
            joinBtn.disabled = false;
            joinBtn.textContent = 'Join the class';
            P.toast(ex.message, 'error');
          }
        });
      }
    }

    if (prefill) { input.value = fmtCode(prefill); form.requestSubmit(); } else input.focus();
  }

  function panelHTML(d) {
    const teach = d.teaching.map((c) => `<li class="classes__item">
        <a class="classes__name" href="class.html?id=${c.id}" data-no-i18n>${esc(c.name)}</a>
        <span class="classes__meta"><span data-no-i18n>${esc(c.courseTitle)}</span> · <span>${plural(c.students, 'student')}</span>${c.open ? '' : ' · <span>Closed</span>'}</span>
        <span class="classnote__code" data-no-i18n title="Join code">${esc(fmtCode(c.code))}</span>
      </li>`).join('');
    const joined = d.joined.map((c) => `<li class="classes__item">
        <a class="classes__name" href="app.html?course=${encodeURIComponent(c.courseId)}" data-no-i18n>${esc(c.name)}</a>
        <span class="classes__meta"><span>Taught by</span> <span data-no-i18n>${esc(c.teacher)}</span></span>
      </li>`).join('');
    return `<h3 class="classes__title" id="classes-title">Your classes</h3>
      <div class="classes__cols">
        ${teach ? `<div><p class="classes__sub">You teach</p><ul class="classes__list">${teach}</ul></div>` : ''}
        ${joined ? `<div><p class="classes__sub">You’re a student in</p><ul class="classes__list">${joined}</ul></div>` : ''}
      </div>`;
  }

  // A line on the card of every course that belongs to a class.
  let marks = new Map(); // course id -> text
  function decorate() {
    const shelves = $('#shelves');
    if (!shelves) return;
    marks.forEach((label, id) => {
      const card = shelves.querySelector(`.ccard[data-course="${CSS.escape(id)}"]`);
      if (!card || card.querySelector('.ccard__class')) return;
      const p = document.createElement('p');
      p.className = 'ccard__src ccard__class';
      p.innerHTML = label;
      const meta = card.querySelector('.ccard__meta');
      card.insertBefore(p, meta || null);
    });
  }

  function mountLibrary() {
    const btn = $('#class-join-btn');
    if (btn) {
      btn.hidden = false;
      btn.addEventListener('click', () => openJoin());
    }
    const shelves = $('#shelves');
    if (shelves) {
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; decorate(); });
      }).observe(shelves, { childList: true, subtree: true });
    }
    P.classes.mine().then((d) => {
      marks = new Map();
      d.teaching.forEach((c) => marks.set(c.courseId, '<span>Taught as a class</span>'));
      d.joined.forEach((c) => marks.set(c.courseId, `<span>Class</span> <span data-no-i18n>“${esc(c.name)}”</span>`));
      decorate();
      if (!d.teaching.length && !d.joined.length) return;
      const panel = document.createElement('section');
      panel.className = 'classes card card--solid';
      panel.setAttribute('aria-labelledby', 'classes-title');
      panel.innerHTML = panelHTML(d);
      if (shelves) shelves.before(panel);
    }).catch((err) => console.warn('[Primer] classes:', err.message));

    const pre = P.params.get('join');
    if (pre) {
      const params = new URLSearchParams(location.search);
      params.delete('join');
      history.replaceState(null, '', 'app.html' + (params.toString() ? '?' + params : '') + location.hash);
      openJoin(pre.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
    }
  }

  // The note left by a join that has just moved to the course page.
  document.addEventListener('DOMContentLoaded', () => {
    const flash = P.session.get('primer.classFlash');
    if (flash) { P.session.remove('primer.classFlash'); setTimeout(() => P.toast(flash), 300); }
  });
})();
