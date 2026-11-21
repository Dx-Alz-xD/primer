/* =====================================================================
   Reuse before writing (app.html). When the learner builds a course,
   the server first looks for one that already covers the request: their
   own courses, Primer's shared library, and course outlines shared on
   the community board (server/reuse.mjs). A strong match is shown before
   any AI credits are spent: open it, use it (a copy in their courses,
   cut to their range), or build a new one anyway.

   "There's new information on this topic" opens a "What's new?" box.
   With it, an existing course can be updated instead of rebuilt: only
   the lessons the information affects are rewritten, new ones are added
   at the end, and the learner's progress stays.

   The course page shows what the last update changed (and marks those
   lessons), and has its own "Add new information" link.

   P.reuse.check(request)  -> Promise: { extra, instructions } to go on
                              building, or null when the learner took an
                              existing course or went back to the form
   P.reuse.mountCourse(view, course)   the course page's part
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const $ = P.$, esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const MAX_INFO = 1500;
  const FLASH = 'primer.reuse.flash';
  const courseHref = (id) => 'app.html?course=' + encodeURIComponent(id);
  const key = (s) => String(s || '').toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const time = (m) => (P.courseLength ? P.courseLength.time(m) : `${m} min`);
  const lessonsText = (n) => (n === 1 ? t('1 lesson') : fill('{n} lessons', { n }));

  /* ---------------- the builder: "What's new?" ---------------- */
  const form = $('#builder');
  const after = $('#b-syl-field') && $('#b-syl-field').closest('.syl');
  let newBox = null, newField = null;
  if (form && after) {
    const wrap = document.createElement('div');
    wrap.className = 'field rnew';
    wrap.innerHTML = `
      <p class="rnew__open" id="b-new-open-row"><button class="textlink" type="button" id="b-new-open" aria-expanded="false" aria-controls="b-new-field">There’s new information on this topic</button> <small class="help">optional</small></p>
      <div class="rnew__field" id="b-new-field" hidden>
        <label class="label" for="b-new">What’s new? <small>optional</small></label>
        <textarea class="textarea rnew__text" id="b-new" maxlength="${MAX_INFO}" rows="4" aria-describedby="b-new-help" placeholder="e.g. Python 3.14 added template strings (t-strings)."></textarea>
        <p class="help" id="b-new-help">If you already have a course on this, Primer updates it with this instead of building a new one: only the lessons it affects are rewritten, and your progress stays.</p>
        <p><button class="textlink" type="button" id="b-new-remove">No new information</button></p>
      </div>`;
    after.after(wrap);
    newBox = wrap.querySelector('#b-new');
    newField = wrap.querySelector('#b-new-field');
    const openRow = wrap.querySelector('#b-new-open-row'), openBtn = wrap.querySelector('#b-new-open');
    const setOpen = (open) => {
      newField.hidden = !open;
      openRow.hidden = open;
      openBtn.setAttribute('aria-expanded', String(open));
      if (open) newBox.focus(); else openBtn.focus();
    };
    openBtn.addEventListener('click', () => setOpen(true));
    wrap.querySelector('#b-new-remove').addEventListener('click', () => { newBox.value = ''; setOpen(false); });
  }
  // the box is in use exactly while it is open, like the syllabus box
  const whatsNew = () => (newField && !newField.hidden ? newBox.value.replace(/\r\n?/g, '\n').trim().slice(0, MAX_INFO) : '');

  // With nothing to update, the new course is asked to cover what's new instead.
  const withNews = (instructions, news) => {
    const head = String(instructions || '').trim();
    return ((head ? head.replace(/([^.!?])$/, '$1.') + ' ' : '') + 'Make sure the course covers this new information: ' + news).slice(0, 600);
  };

  /* ---------------- what a match is like, next to the request ---------------- */
  const rangeHTML = (from, to) => {
    const f = from ? `<span class="ugc">${esc(P.cap(from))}</span>` : '';
    const tt = to ? `<span class="ugc">${esc(to)}</span>` : '';
    const line = f ? (tt ? '{from} to {to}' : '{from} to the end of the subject') : (tt ? 'The very beginning to {to}' : 'The very beginning to the end of the subject');
    return esc(t(line)).replace('{from}', () => f).replace('{to}', () => tt);
  };
  const sameRange = (m, req) => key(m.from) === key(req.from) && key(m.to) === key(req.to);
  const hasRange = (x) => Boolean(x.from || x.to);
  const canCut = (m, req) => hasRange(req) && !sameRange(m, req);

  // a translated sentence with pieces of HTML (already escaped) put into its {placeholders}
  const fillHTML = (s, vals) => esc(t(s)).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));

  function notes(m, req) {
    const out = [];
    if (!sameRange(m, req)) {
      if (!hasRange(m)) out.push(esc(t('It covers the whole subject, so a copy can be cut to your range.')));
      else if (!hasRange(req)) out.push(fillHTML('It covers only part of the subject: {range}.', { range: rangeHTML(m.from, m.to) }));
      else out.push(fillHTML('Its range is {range}; you asked for {asked}.', { range: rangeHTML(m.from, m.to), asked: rangeHTML(req.from, req.to) }));
    }
    const want = req.lang || P.lang || 'en';
    if ((m.lang || 'en') !== want) out.push(esc(fill('It’s written in {lang}.', { lang: P.langName ? P.langName(m.lang || 'en') : m.lang })));
    if (m.kind === 'library' && req.instructions) out.push(esc(t('Its lessons are written for everyone, without your teaching instructions.')));
    else if (m.kind === 'own' && key(req.instructions) !== key(m.instructions)) {
      out.push(esc(t(m.instructions ? 'It was planned with other teaching instructions.' : 'It was planned without teaching instructions.')));
    }
    if (req.syllabus && !m.syllabus) out.push(esc(t('It doesn’t follow the syllabus you pasted.')));
    const len = req.length;
    if (len && P.courseLength && !P.courseLength.fits(len, m.lessons, m.minutes)) {
      if (len.kind === 'concise') out.push(esc(fill('It has {n} lessons, not a concise overview.', { n: m.lessons })));
      else if (len.kind === 'lessons') out.push(esc(fill('It has {n} lessons; you asked for {m}.', { n: m.lessons, m: len.n })));
      else out.push(esc(fill('It takes about {time}; you asked for about {want}.', { time: time(m.minutes), want: time(len.n) })));
    }
    if (m.kind === 'own' && req.whatsNew && !m.updatable) out.push(esc(t('It’s part of a class, so it can’t be updated here.')));
    return out;
  }

  function metaLine(m) {
    const parts = [lessonsText(m.lessons), fill('about {time}', { time: time(m.minutes) })];
    if (m.kind === 'own') parts.push(fill('{done} of {total} done', { done: m.done || 0, total: m.lessons }));
    if (m.kind === 'library' && m.written) parts.push(fill('{n} already written', { n: m.written }));
    if (m.kind === 'community' && m.comments) parts.push(m.comments === 1 ? t('1 comment') : fill('{n} comments', { n: m.comments }));
    return parts.map(esc).join(' · ');
  }

  const KINDS = {
    own: { badge: 'Your course', head: 'You already have a course on this', lead: 'Open it and carry on, and nothing new has to be written.' },
    library: { badge: 'In Primer’s library', head: 'There’s a course on this in Primer’s library', lead: 'Its lessons are shared by every learner, so many open at once and cost no AI credits.' },
    community: { badge: 'Shared in the community', head: 'There’s a course on this in the community', lead: 'Another learner shared this outline. Using it skips planning a new course.' }
  };

  function cardHTML(m, i, req) {
    const news = Boolean(req.whatsNew);
    const btns = [];
    if (m.kind === 'own') {
      if (news && m.updatable) btns.push(`<button class="btn btn--small" type="button" data-act="update" data-i="${i}">Update it with what’s new</button>`);
      btns.push(`<a class="btn btn--small${news && m.updatable ? ' btn--ghost' : ''}" href="${courseHref(m.id)}">Open it</a>`);
      if (canCut(m, req)) btns.push(`<button class="btn btn--small btn--ghost" type="button" data-act="use" data-i="${i}">Use a copy cut to your range</button>`);
    } else {
      if (news) btns.push(`<button class="btn btn--small" type="button" data-act="use-new" data-i="${i}">Use it with what’s new</button>`);
      btns.push(`<button class="btn btn--small${news ? ' btn--ghost' : ''}" type="button" data-act="use" data-i="${i}">Use it</button>`);
      if (m.kind === 'community') btns.push(`<a class="textlink" href="post.html?id=${encodeURIComponent(m.id)}">Open the post</a>`);
    }
    const list = notes(m, req);
    let k = 1; // lessons are numbered through the whole course, as on the course page
    const lessons = m.outline && m.outline.length ? `<details class="rcard__lessons"><summary>See its lessons</summary>
      <ol class="rcard__units">${m.outline.map((u) => { const start = k; k += u.lessons.length; return `<li><span class="rcard__unit ugc">${esc(u.title)}</span><ol class="ugc" start="${start}">${u.lessons.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></li>`; }).join('')}</ol></details>` : '';
    return `<li class="rcard" data-i="${i}">
        <p class="rcard__kind">${esc(t(KINDS[m.kind].badge))}</p>
        <h3 class="rcard__title ugc" data-lang="${esc(m.lang || 'en')}">${esc(m.title)}</h3>
        ${m.topic && key(m.topic) !== key(m.title) ? `<p class="rcard__topic"><span>${esc(t('Topic'))}:</span> <span class="ugc">${esc(m.topic)}</span></p>` : ''}
        <p class="rcard__meta">${metaLine(m)}</p>
        ${list.length ? `<ul class="rcard__notes">${list.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
        <div class="rcard__actions">${btns.join('')}</div>
        ${lessons}
      </li>`;
  }

  /* ---------------- the check, and what the learner chooses ---------------- */
  let panel = null;
  const library = () => $('#library');
  function closePanel(showForm) {
    if (panel) { panel.remove(); panel = null; }
    if (showForm && form) {
      form.hidden = false;
      if (library()) library().hidden = false;
    }
  }

  function showMatches(matches, req) {
    return new Promise((resolve) => {
      closePanel(false);
      const first = KINDS[matches[0].kind];
      const news = Boolean(req.whatsNew);
      const canUpdate = news && matches.some((m) => m.kind !== 'own' || m.updatable);
      panel = document.createElement('section');
      panel.className = 'reuse card card--solid';
      panel.setAttribute('aria-labelledby', 'reuse-title');
      panel.innerHTML = `
        <p class="reuse__eyebrow">Before spending AI credits</p>
        <h2 class="reuse__title" id="reuse-title" tabindex="-1">${esc(t(first.head))}</h2>
        <p class="reuse__lead">${esc(t(canUpdate
          ? 'You said there’s new information. Primer can update an existing course with it: only the lessons it affects are rewritten, and your progress stays.'
          : first.lead))}</p>
        <ul class="reuse__list">${matches.map((m, i) => cardHTML(m, i, req)).join('')}</ul>
        <div class="reuse__foot">
          <button class="btn btn--ghost" type="button" data-act="anyway">Build a new one anyway</button>
          <button class="textlink" type="button" data-act="back">Change my request</button>
        </div>
        <p class="help reuse__cost">Building a new one spends AI credits on planning and writing it.</p>
        <p class="reuse__status" role="status" aria-live="polite"></p>`;
      const building = $('#building');
      if (building) building.before(panel); else form.after(panel);
      panel.querySelectorAll('.rcard__title').forEach((h) => { if (P.contentLang) P.contentLang(h, h.dataset.lang); });
      if (form) form.hidden = true;
      if (library()) library().hidden = true;
      const status = panel.querySelector('.reuse__status');
      const say = (msg, bad) => { status.textContent = msg; status.classList.toggle('is-error', Boolean(bad)); };
      panel.querySelector('.reuse__title').focus({ preventScroll: true });
      panel.scrollIntoView({ block: 'start', behavior: P.motion.reduce ? 'auto' : 'smooth' });

      let busy = false;
      const lock = (on) => { busy = on; panel.querySelectorAll('button').forEach((b) => { b.disabled = on; }); };
      const go = (course, flash) => {
        P.courses.put(course);
        if (flash) P.session.set(FLASH, { id: course.id, text: flash });
        location.href = courseHref(course.id);
        resolve(null);
      };

      panel.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b || busy) return;
        const act = b.dataset.act;
        if (act === 'back') {
          closePanel(true);
          const topic = $('#b-topic');
          if (topic) topic.focus();
          resolve(null);
          return;
        }
        if (act === 'anyway') {
          closePanel(false);
          // the library's course was offered and turned down: plan this one apart from it
          resolve({ extra: matches.some((m) => m.kind === 'library') ? { fresh: true } : {}, instructions: news ? withNews(req.instructions, req.whatsNew) : null });
          return;
        }
        const m = matches[Number(b.dataset.i)];
        if (!m) return;
        lock(true);
        try {
          if (act === 'update') {
            say(t('Updating the course with what’s new…'));
            const d = await P.post('/api/reuse/update', { courseId: m.id, whatsNew: req.whatsNew }, { timeout: 150000, timeoutMessage: 'The AI took too long to update the course. Try again.' });
            if (!d.update.changed) {
              say(fill('Primer didn’t change the course: {note}', { note: d.update.note || t('the new information doesn’t change any lesson.') }), true);
              lock(false);
              return;
            }
            go(d.course, null);
            return;
          }
          say(t(act === 'use-new' ? 'Copying the course and adding what’s new…' : 'Copying the course into yours…'));
          const d = await P.post('/api/reuse/use', { kind: m.kind, id: m.id, request: req.body, whatsNew: act === 'use-new' ? req.whatsNew : '' }, { timeout: 150000 });
          let flash = null;
          if (d.updateError) flash = fill('The course was copied, but the update couldn’t be made: {error}', { error: d.updateError });
          else if (d.update && !d.update.changed) flash = fill('The course was copied. Primer didn’t change it: {note}', { note: d.update.note || t('the new information doesn’t change any lesson.') });
          go(d.course, flash);
        } catch (err) {
          say(err.message, true);
          lock(false);
        }
      });
    });
  }

  async function check(request) {
    const news = whatsNew();
    const body = {
      topic: request.topic, from: request.from || '', to: request.to || '', instructions: request.instructions || '',
      syllabus: request.syllabus || '', lang: request.lang, length: request.length || null, folderId: request.folderId ?? null,
      style: P.parseStyle ? P.parseStyle(request.instructions || '') : []
    };
    const submit = form && form.querySelector('[type="submit"]');
    const foot = form && form.querySelector('.builder__foot');
    let note = foot && foot.querySelector('.reuse__checking');
    if (foot && !note) {
      note = document.createElement('p');
      note.className = 'help reuse__checking';
      note.setAttribute('role', 'status');
      foot.append(note);
    }
    if (submit) submit.disabled = true;
    if (note) note.textContent = 'Looking for a course on this you already have…';
    let found = [];
    try {
      const d = await P.post('/api/reuse/check', body, { timeout: 60000 });
      found = d.matches || [];
    } catch (err) {
      console.warn('[Primer] reuse check:', err.message); // not finding one is never a reason to stop
    } finally {
      if (submit) submit.disabled = false;
      if (note) note.textContent = '';
    }
    if (!found.length) {
      if (news) P.toast(t('There’s no course on this to update yet, so the new one will cover what’s new.'));
      return { extra: {}, instructions: news ? withNews(request.instructions, news) : null };
    }
    return showMatches(found, Object.assign({}, body, { whatsNew: news, body }));
  }

  /* ---------------- the course page ---------------- */
  const listText = (ns) => ns.join(', ');
  const lastUpdate = (course) => (Array.isArray(course.updates) && course.updates.length ? course.updates[course.updates.length - 1] : null);
  function noteHTML(course) {
    const last = lastUpdate(course);
    if (!last) return '';
    let date = '';
    try { date = new Date(last.at).toLocaleDateString(P.lang || 'en', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { date = ''; }
    const what = [];
    if (last.revised && last.revised.length) what.push(fill(last.revised.length === 1 ? 'Rewritten: lesson {list}' : 'Rewritten: lessons {list}', { list: listText(last.revised) }));
    if (last.added && last.added.length) what.push(fill(last.added.length === 1 ? 'New: lesson {list}' : 'New: lessons {list}', { list: listText(last.added) }));
    return `<p class="cupd__title">${esc(fill('Updated with new information on {date}', { date }))}</p>
      ${last.summary ? `<p class="cupd__sum ugc">${esc(last.summary)}</p>` : ''}
      ${what.length ? `<p class="cupd__what">${what.map(esc).join(' · ')}</p>` : ''}
      ${last.info ? `<details class="cupd__info"><summary>What you added</summary><p class="ugc">${esc(last.info)}</p></details>` : ''}`;
  }

  // "Updated" / "New" beside the lessons the last update changed
  function markLessons(view, course) {
    const last = lastUpdate(course);
    if (!last) return;
    const mark = (n, word) => {
      const row = view.querySelector(`.units a.lrow[href$="&lesson=${n}"]`);
      if (!row || row.querySelector('.tag--upd')) return;
      let tags = row.querySelector('.lrow__tags');
      if (!tags) {
        tags = document.createElement('span');
        tags.className = 'lrow__tags';
        (row.querySelector('.lrow__desc') || row).after(tags);
      }
      const tag = document.createElement('span');
      tag.className = 'tag tag--upd';
      tag.textContent = word;
      tags.prepend(tag);
    };
    (last.revised || []).forEach((n) => mark(n, 'Updated'));
    (last.added || []).forEach((n) => mark(n, 'New'));
  }

  function mountCourse(view, course) {
    if (!view || !course) return;
    const flash = P.session.get(FLASH, null);
    if (flash && flash.id === course.id) {
      P.session.remove(FLASH);
      setTimeout(() => P.toast(flash.text), 400);
    }
    const head = view.querySelector('.course-head');
    const actions = view.querySelector('.course-head__actions');
    if (!head || !actions) return;
    const note = document.createElement('div');
    note.className = 'cupd';
    const paint = () => { note.innerHTML = noteHTML(course); note.hidden = !note.innerHTML.trim(); };
    paint();
    if (P.tReady) P.tReady.then(paint);
    actions.before(note);
    markLessons(view, course);

    if (course.source !== 'ai' && course.source !== 'library') return; // a sample course has nothing to update
    const link = document.createElement('button');
    link.className = 'textlink';
    link.type = 'button';
    link.textContent = 'Add new information';
    link.setAttribute('aria-expanded', 'false');
    link.setAttribute('aria-controls', 'cupd-form');
    const del = actions.querySelector('[data-delete]');
    if (del) del.before(link); else actions.append(link);

    const box = document.createElement('form');
    box.className = 'cupd__form';
    box.id = 'cupd-form';
    box.hidden = true;
    box.noValidate = true;
    box.innerHTML = `
      <label class="label" for="cupd-text">What’s new?</label>
      <textarea class="textarea" id="cupd-text" maxlength="${MAX_INFO}" rows="4" aria-describedby="cupd-help" placeholder="e.g. Python 3.14 added template strings (t-strings)."></textarea>
      <p class="help" id="cupd-help">Only the lessons it affects are rewritten, and new ones are added at the end. Your progress, notes and doubts stay.</p>
      <div class="cupd__row"><button class="btn btn--small" type="submit">Update the course</button><button class="textlink" type="button" data-cancel>Cancel</button></div>
      <p class="cupd__status" role="status" aria-live="polite"></p>`;
    actions.after(box);
    const text = box.querySelector('textarea'), status = box.querySelector('.cupd__status');
    const say = (msg, bad) => { status.textContent = msg; status.classList.toggle('is-error', Boolean(bad)); };
    const setOpen = (open) => {
      box.hidden = !open;
      link.setAttribute('aria-expanded', String(open));
      if (open) text.focus(); else link.focus();
    };
    link.addEventListener('click', () => setOpen(box.hidden));
    box.querySelector('[data-cancel]').addEventListener('click', () => { say(''); setOpen(false); });
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      const info = text.value.trim();
      if (!info) { say(t('Write what’s new first.'), true); text.focus(); return; }
      const btns = box.querySelectorAll('button');
      btns.forEach((b) => { b.disabled = true; });
      say(t('Updating the course with what’s new…'));
      try {
        const d = await P.post('/api/reuse/update', { courseId: course.id, whatsNew: info }, { timeout: 150000, timeoutMessage: 'The AI took too long to update the course. Try again.' });
        if (!d.update.changed) {
          say(fill('Primer didn’t change the course: {note}', { note: d.update.note || t('the new information doesn’t change any lesson.') }), true);
          btns.forEach((b) => { b.disabled = false; });
          return;
        }
        P.courses.put(d.course);
        location.reload();
      } catch (err) {
        say(err.message, true);
        btns.forEach((b) => { b.disabled = false; });
      }
    });
  }

  P.reuse = { check, mountCourse };
})();
