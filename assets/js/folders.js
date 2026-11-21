/* =====================================================================
   Folders ("General Topic"): a learner groups courses under a name.
   - P.folders: the folder list kept by the server, moving courses, and
     the AI's quiet check that each topic fits its folder's name.
   - P.shelves: the library on app.html, one shelf per folder plus an
     "Unfiled" shelf, with create / rename / delete, a Folder menu on
     every card, and "Add many topics" (one course per line, built one
     after another, with progress and a cancel button).
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, esc = P.esc;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id;
  const changed = () => document.dispatchEvent(new CustomEvent('primer:folders'));

  /* ------------------------------------------------------------------
     Data
  ------------------------------------------------------------------ */
  P.folders = {
    _all: [],
    _loading: null,
    available: true, // false when this server has no folders feature
    load(force) {
      if (!this._loading || force) {
        this._loading = P.get('/api/folders').then((d) => {
          this._all = d.folders.slice().sort(byName);
          this.available = true;
          return this;
        }).catch((err) => {
          this._loading = null;
          if (err.status === 404) { this.available = false; this._all = []; return this; }
          throw err;
        });
      }
      return this._loading;
    },
    list() { return this._all; },
    get(id) { return id == null ? null : this._all.find((f) => f.id === Number(id)) || null; },
    count(id) { return P.courses.list().filter((c) => c.folderId === id).length; },

    async create(name) {
      const d = await P.post('/api/folders', { name });
      this._all = this._all.concat(d.folder).sort(byName);
      changed();
      return d.folder;
    },
    async rename(id, name) {
      const d = await P.patch(`/api/folders/${id}`, { name });
      this._all = this._all.map((f) => (f.id === id ? d.folder : f)).sort(byName);
      changed();
      return d.folder;
    },
    async remove(id) {
      const d = await P.del(`/api/folders/${id}`);
      this._all = this._all.filter((f) => f.id !== id);
      P.courses.list().forEach((c) => { if (c.folderId === id) { c.folderId = null; delete c.folderFit; } });
      changed();
      return d.unfiled;
    },
    // Moves a course into a folder, or out of every folder with folderId null.
    async move(courseId, folderId) {
      const d = await P.put(`/api/courses/${encodeURIComponent(courseId)}/folder`, { folderId: folderId || null });
      const c = P.courses.get(courseId);
      if (c && c.folderId !== d.folderId) { c.folderId = d.folderId; delete c.folderFit; }
      return d.folderId;
    },

    // True when a course in a folder hasn't been checked against that folder's current name.
    needsFit(c) {
      const f = this.get(c.folderId);
      return Boolean(f) && !(c.folderFit && c.folderFit.folderId === f.id && c.folderFit.folder === f.name);
    },
    // The quiet "doesn't seem to fit" note for a course, or null.
    misfit(c) {
      const f = this.get(c.folderId), fit = c.folderFit;
      if (!f || !fit || fit.ok !== false || fit.dismissed || fit.folderId !== f.id || fit.folder !== f.name) return null;
      return { folder: f.name, reason: fit.reason || '' };
    },
    // One AI request for the whole batch. Returns how many courses got an answer;
    // if the AI can't be reached the check is skipped quietly.
    async checkFit(folderId, courseIds) {
      if (!courseIds.length || !this.get(folderId)) return 0;
      try {
        const d = await P.post(`/api/folders/${folderId}/fit`, { courseIds }, { timeout: 90000 });
        let n = 0;
        Object.entries(d.results || {}).forEach(([id, fit]) => {
          const c = P.courses.get(id);
          if (c) { c.folderFit = fit; n++; }
        });
        return n;
      } catch (err) {
        console.warn('[Primer] folder fit check skipped:', err.message);
        return 0;
      }
    },
    // Checks every course that still needs it, one request per folder.
    async sweep(courses) {
      const groups = new Map();
      (courses || P.courses.list()).forEach((c) => {
        if (this.needsFit(c)) groups.set(c.folderId, (groups.get(c.folderId) || []).concat(c.id));
      });
      const counts = await Promise.all(Array.from(groups, ([fid, ids]) => this.checkFit(fid, ids.slice(0, 40))));
      return counts.reduce((a, b) => a + b, 0);
    },
    async dismissFit(courseId) {
      const c = P.courses.get(courseId);
      if (c && c.folderFit) c.folderFit.dismissed = true;
      await P.post(`/api/courses/${encodeURIComponent(courseId)}/folder-fit/dismiss`, {});
    },

    // <option>s for a folder menu.
    options(selected) {
      return ['<option value="">Unfiled</option>'].concat(this._all.map((f) =>
        `<option value="${f.id}"${f.id === selected ? ' selected' : ''}>${esc(f.name)}</option>`)).join('');
    },
    fitNote(c, miss) {
      return `<p class="fitwarn"><span>Doesn’t seem to fit “${esc(miss.folder)}”${miss.reason ? `: ${esc(miss.reason)}` : ''}</span>
        <button class="fitwarn__x" type="button" data-dismiss-fit="${esc(c.id)}" aria-label="Dismiss the note about “${esc(c.title)}”">Dismiss</button></p>`;
    }
  };

  /* ------------------------------------------------------------------
     The library shelves (app.html)
  ------------------------------------------------------------------ */
  const MAX_BULK = 20;
  const runs = new Map(); // folder id -> { running, cancel, items, instructions, panel }
  let root = null, opts = {};

  function cardHTML(c) {
    const s = P.courses.stats(c);
    const sameAsTopic = c.title.toLowerCase() === c.topic.toLowerCase();
    const miss = P.folders.misfit(c);
    const mv = `mv-${c.id}`;
    return `<article class="ccard card card--solid" data-course="${esc(c.id)}">
        <h3><a class="ccard__link" href="app.html?course=${encodeURIComponent(c.id)}">${esc(c.title)}</a></h3>
        ${sameAsTopic ? '' : `<p class="ccard__topic">${esc(c.topic)}</p>`}
        ${c.source === 'library' ? '<p class="ccard__src">From the shared library</p>' : ''}
        ${miss ? P.folders.fitNote(c, miss) : ''}
        <p class="ccard__meta">${s.done} of ${s.total} lessons done</p>
        <div class="bar" aria-hidden="true"><span style="width:${s.pct}%"></span></div>
        ${P.folders.list().length ? `<div class="ccard__move">
          <label class="ccard__movelabel" for="${mv}">Folder<span class="sr-only"> for “${esc(c.title)}”</span></label>
          <select class="select select--small" id="${mv}" data-move="${esc(c.id)}">${P.folders.options(c.folderId)}</select>
        </div>` : ''}
      </article>`;
  }

  function gridHTML(list, folder) {
    if (list.length) return `<div class="library__grid shelf__grid">${list.map(cardHTML).join('')}</div>`;
    return folder ? '<p class="shelf__empty">No courses here yet. Add a topic, or move a course in with the Folder menu on its card.</p>' : '';
  }

  function shelfHTML(f, list) {
    return `<section class="shelf" data-folder="${f.id}" aria-labelledby="shelf-${f.id}">
        <header class="shelf__head">
          <div class="shelf__name" data-name>
            <h3 class="shelf__title" id="shelf-${f.id}" tabindex="-1">${esc(f.name)}</h3>
            <span class="shelf__count" data-count>${plural(list.length, 'course')}</span>
          </div>
          <div class="shelf__actions">
            <button class="textlink" type="button" data-add-one>Add a topic</button>
            <button class="textlink" type="button" data-add-many aria-expanded="${runs.has(f.id) && !runs.get(f.id).panel.hidden}" aria-controls="bulk-${f.id}">Add many topics</button>
            <button class="textlink" type="button" data-rename>Rename</button>
            <button class="textlink" type="button" data-delete-folder>Delete folder</button>
          </div>
        </header>
        <div data-bulk-slot></div>
        <div data-grid>${gridHTML(list, f)}</div>
      </section>`;
  }

  function render() {
    if (!root) return;
    const folders = P.folders.list();
    const courses = P.courses.list();
    const unfiled = courses.filter((c) => !P.folders.get(c.folderId));
    $('#library-empty').hidden = courses.length > 0 || folders.length > 0;
    const newBtn = $('#folder-new-btn');
    if (newBtn) newBtn.hidden = !P.folders.available;

    // Keep focus where it was if it sits in a bulk panel that survives the redraw.
    const active = document.activeElement;
    const keepFocus = active && active.closest && active.closest('.bulk') ? active : null;

    root.innerHTML = folders.map((f) => shelfHTML(f, courses.filter((c) => c.folderId === f.id))).join('')
      + (unfiled.length ? (folders.length
        ? `<section class="shelf shelf--unfiled" aria-labelledby="shelf-unfiled">
             <header class="shelf__head"><div class="shelf__name">
               <h3 class="shelf__title" id="shelf-unfiled">Unfiled</h3>
               <span class="shelf__count">${plural(unfiled.length, 'course')}</span>
             </div></header>
             <div data-grid>${gridHTML(unfiled, null)}</div>
           </section>`
        : `<div data-grid>${gridHTML(unfiled, null)}</div>`) : '');

    runs.forEach((run, fid) => {
      const slot = root.querySelector(`.shelf[data-folder="${fid}"] [data-bulk-slot]`);
      if (slot) slot.replaceWith(run.panel);
      else if (!run.running) runs.delete(fid);
    });
    if (keepFocus && document.body.contains(keepFocus)) keepFocus.focus({ preventScroll: true });
  }

  // Redraws one shelf's cards and count without touching the rest (a bulk run keeps focus).
  function refreshShelf(fid) {
    const shelf = root && root.querySelector(`.shelf[data-folder="${fid}"]`);
    const f = P.folders.get(fid);
    if (!shelf || !f) { render(); return; }
    const list = P.courses.list().filter((c) => c.folderId === fid);
    shelf.querySelector('[data-grid]').innerHTML = gridHTML(list, f);
    shelf.querySelector('[data-count]').textContent = plural(list.length, 'course');
    $('#library-empty').hidden = true;
  }

  /* ---------- new folder ---------- */
  function wireNewFolder() {
    const btn = $('#folder-new-btn'), form = $('#folder-new');
    if (!btn || !form) return;
    const input = $('#folder-new-name'), err = $('#folder-new-err');
    const close = () => { form.hidden = true; btn.setAttribute('aria-expanded', 'false'); err.textContent = ''; input.removeAttribute('aria-invalid'); };
    btn.addEventListener('click', () => {
      if (!form.hidden) { close(); btn.focus(); return; }
      form.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      input.value = '';
      input.focus();
    });
    form.querySelector('[data-cancel]').addEventListener('click', () => { close(); btn.focus(); });
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } });
    input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = P.clean(input.value, 60);
      if (!name) { err.textContent = 'Give the folder a name.'; input.setAttribute('aria-invalid', 'true'); input.focus(); P.shake(input); return; }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const f = await P.folders.create(name);
        close();
        render();
        P.toast(`Made the folder “${f.name}”.`);
        const title = root.querySelector(`#shelf-${f.id}`);
        if (title) { title.scrollIntoView({ block: 'center', behavior: P.motion.reduce ? 'auto' : 'smooth' }); title.focus({ preventScroll: true }); }
      } catch (ex) {
        err.textContent = ex.message;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      } finally {
        submit.disabled = false;
      }
    });
  }

  /* ---------- rename ---------- */
  function startRename(shelf, f) {
    const slot = shelf.querySelector('[data-name]');
    const id = `rn-${f.id}`;
    slot.innerHTML = `<form class="shelf__rename" novalidate>
        <label class="sr-only" for="${id}">New name for the folder “${esc(f.name)}”</label>
        <input class="input input--sm" id="${id}" maxlength="60" value="${esc(f.name)}" autocomplete="off" aria-describedby="${id}-err">
        <button class="btn btn--small" type="submit">Save</button>
        <button class="textlink" type="button" data-rename-cancel>Cancel</button>
        <p class="field__error" id="${id}-err"></p>
      </form>`;
    const input = slot.querySelector('input');
    input.focus();
    input.select();
  }

  async function saveRename(form, f) {
    const input = form.querySelector('input'), err = form.querySelector('.field__error');
    const name = P.clean(input.value, 60);
    if (!name) { err.textContent = 'Give the folder a name.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    if (name === f.name) { render(); focusShelf(f.id, '[data-rename]'); return; }
    form.querySelector('[type="submit"]').disabled = true;
    try {
      const nf = await P.folders.rename(f.id, name);
      render();
      focusShelf(nf.id, '[data-rename]');
      P.toast(`Renamed the folder to “${nf.name}”.`);
      // The courses inside were checked against the old name.
      if (await P.folders.sweep(P.courses.list().filter((c) => c.folderId === nf.id))) refreshShelf(nf.id);
    } catch (ex) {
      form.querySelector('[type="submit"]').disabled = false;
      err.textContent = ex.message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  }

  function focusShelf(fid, sel) {
    const el = root.querySelector(`.shelf[data-folder="${fid}"] ${sel || '.shelf__title'}`);
    if (el) el.focus();
  }

  /* ---------- delete ---------- */
  async function deleteFolder(f, btn) {
    if (runs.has(f.id) && runs.get(f.id).running) { P.toast('Cancel the topics being added to this folder first.', 'error'); return; }
    const n = P.folders.count(f.id);
    const msg = n
      ? `Delete the folder “${f.name}”? Its ${plural(n, 'course')} will stay in your library, unfiled.`
      : `Delete the empty folder “${f.name}”?`;
    if (!window.confirm(msg)) return;
    btn.disabled = true;
    try {
      const unfiled = await P.folders.remove(f.id);
      runs.delete(f.id);
      render();
      P.toast(unfiled ? `Deleted “${f.name}”. ${plural(unfiled, 'course')} ${unfiled === 1 ? 'is' : 'are'} now unfiled.` : `Deleted “${f.name}”.`);
      const head = $('#library-title');
      if (head) { head.setAttribute('tabindex', '-1'); head.focus(); }
    } catch (ex) {
      btn.disabled = false;
      P.toast('Couldn’t delete the folder: ' + ex.message, 'error');
    }
  }

  /* ---------- moving a course from its card ---------- */
  async function moveFromCard(select) {
    const id = select.dataset.move;
    const c = P.courses.get(id);
    const before = c ? c.folderId : null;
    const to = select.value ? Number(select.value) : null;
    select.disabled = true;
    try {
      await P.folders.move(id, to);
      render();
      const again = root.querySelector(`#mv-${CSS.escape(id)}`);
      if (again) again.focus({ preventScroll: false });
      const f = P.folders.get(to);
      P.toast(f ? `Moved “${c.title}” to “${f.name}”.` : `Moved “${c.title}” out of its folder.`);
      if (f && await P.folders.checkFit(f.id, [id])) refreshShelf(f.id);
    } catch (ex) {
      select.disabled = false;
      select.value = before == null ? '' : String(before);
      P.toast('Couldn’t move the course: ' + ex.message, 'error');
    }
  }

  /* ---------- add many topics ---------- */
  function parseTopics(raw) {
    return String(raw || '').split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')).map((line) => {
      const [topic, from, to] = line.split('|').map((s) => P.clean(s, 120));
      return { topic: P.clean(topic, 120), from: P.clean(from, 80), to: P.clean(to, 80) };
    }).filter((t) => t.topic);
  }

  function bulkPanel(f) {
    const el = document.createElement('form');
    el.className = 'bulk card card--solid';
    el.id = `bulk-${f.id}`;
    el.noValidate = true;
    el.dataset.bulk = String(f.id);
    el.innerHTML = `
      <div class="field">
        <label class="label" for="bulk-topics-${f.id}">Topics to add, one per line</label>
        <textarea class="textarea bulk__topics" id="bulk-topics-${f.id}" rows="5" aria-describedby="bulk-help-${f.id} bulk-err-${f.id}"
          placeholder="Origami&#10;Watercolour painting | mixing colours | glazing&#10;Calligraphy"></textarea>
        <p class="help" id="bulk-help-${f.id}">Add a range after a bar if you like: topic | from | to. Each line becomes its own course, planned one after another, up to ${MAX_BULK} at a time.</p>
        <p class="field__error" id="bulk-err-${f.id}"></p>
      </div>
      <div class="field">
        <label class="label" for="bulk-instr-${f.id}">Teaching instructions for all of them <small>optional</small></label>
        <input class="input" id="bulk-instr-${f.id}" maxlength="600" autocomplete="off" placeholder="e.g. Lots of worked examples.">
      </div>
      <div class="bulk__actions">
        <button class="btn btn--small" type="submit" data-bulk-start>Build these courses</button>
        <button class="btn btn--ghost btn--small" type="button" data-bulk-cancel hidden>Cancel</button>
        <button class="textlink" type="button" data-bulk-close>Close</button>
      </div>
      <p class="bulk__status" role="status" aria-live="polite"></p>
      <ol class="bulk__list" aria-label="Topics being added" hidden></ol>`;
    return el;
  }

  function toggleBulk(f, btn) {
    let run = runs.get(f.id);
    if (!run) {
      run = { running: false, cancel: false, items: [], panel: bulkPanel(f) };
      runs.set(f.id, run);
      run.panel.hidden = true;
      btn.closest('.shelf').querySelector('[data-bulk-slot]').replaceWith(run.panel);
    }
    const open = run.panel.hidden;
    run.panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) run.panel.querySelector('textarea').focus();
    else btn.focus();
  }

  const STATE = {
    waiting: 'Waiting',
    active: 'Planning…',
    cancelled: 'Cancelled',
    skipped: 'Not started'
  };
  function itemState(it) {
    if (it.status === 'done') {
      return `Built: ${plural(it.lessons, 'lesson')}${it.library ? ', from the shared library' : ''}. <a href="app.html?course=${encodeURIComponent(it.courseId)}">Open<span class="sr-only"> ${esc(it.topic)}</span></a>`;
    }
    if (it.status === 'sample') return `Saved as a sample outline, because the AI couldn’t be reached. <a href="app.html?course=${encodeURIComponent(it.courseId)}">Open<span class="sr-only"> ${esc(it.topic)}</span></a>`;
    if (it.status === 'failed') return `Not built: ${esc(it.msg || 'something went wrong')}`;
    return STATE[it.status] || '';
  }
  function paint(run) {
    const list = run.panel.querySelector('.bulk__list');
    list.hidden = !run.items.length;
    list.innerHTML = run.items.map((it) => `<li class="bulk__item is-${it.status}">
        <span class="bulk__topic">${esc(it.topic)}${it.from || it.to ? `<span class="bulk__range"> from ${esc(it.from || 'the beginning')} to ${esc(it.to || 'the end')}</span>` : ''}</span>
        <span class="bulk__state">${itemState(it)}</span>
      </li>`).join('');
    const p = run.panel;
    p.querySelector('[data-bulk-start]').hidden = run.running;
    p.querySelector('[data-bulk-close]').hidden = run.running;
    const cancel = p.querySelector('[data-bulk-cancel]');
    cancel.hidden = !run.running;
    cancel.disabled = run.cancel;
    cancel.textContent = run.cancel ? 'Stopping after this topic…' : 'Cancel';
    p.querySelector('textarea').disabled = run.running;
    p.querySelector('input').disabled = run.running;
  }
  const say = (run, msg) => { run.panel.querySelector('.bulk__status').textContent = msg; };

  const leaveGuard = (e) => { e.preventDefault(); e.returnValue = ''; };

  async function startBulk(f, run) {
    const ta = run.panel.querySelector('textarea'), err = run.panel.querySelector('.field__error');
    const items = parseTopics(ta.value);
    err.textContent = '';
    ta.removeAttribute('aria-invalid');
    if (!items.length) { err.textContent = 'Type at least one topic, one per line.'; ta.setAttribute('aria-invalid', 'true'); ta.focus(); P.shake(ta); return; }
    if (items.length > MAX_BULK) { err.textContent = `That’s ${items.length} topics. Add at most ${MAX_BULK} at a time.`; ta.setAttribute('aria-invalid', 'true'); ta.focus(); return; }

    run.items = items.map((t) => Object.assign(t, { status: 'waiting' }));
    run.instructions = P.clean(run.panel.querySelector('input').value, 600);
    run.running = true;
    run.cancel = false;
    paint(run);
    run.panel.querySelector('[data-bulk-cancel]').focus();
    addEventListener('beforeunload', leaveGuard);

    const built = [];
    let failsInARow = 0, stopped = false;
    for (let i = 0; i < run.items.length; i++) {
      const it = run.items[i];
      if (run.cancel) { it.status = 'cancelled'; continue; }
      if (stopped) { it.status = 'skipped'; continue; }
      it.status = 'active';
      paint(run);
      say(run, `Planning ${i + 1} of ${run.items.length}: ${it.topic}`);
      try {
        const course = await P.api.generateCourse({ topic: it.topic, from: it.from, to: it.to, instructions: run.instructions, extra: { folderId: f.id } });
        it.courseId = course.id;
        it.lessons = P.courseGen.count(course);
        built.push(course.id);
        if (course.source === 'sample') { it.status = 'sample'; failsInARow++; }
        else { it.status = 'done'; it.library = course.source === 'library'; failsInARow = 0; }
        refreshShelf(f.id);
      } catch (ex) {
        it.status = 'failed';
        it.msg = ex.message;
        failsInARow++;
      }
      if (failsInARow >= 2) stopped = true;
      paint(run);
    }

    run.running = false;
    removeEventListener('beforeunload', leaveGuard);
    const done = run.items.filter((it) => it.status === 'done' || it.status === 'sample').length;
    let msg = `Added ${done} of ${plural(run.items.length, 'topic')} to “${f.name}”.`;
    if (run.cancel) msg += ' The rest were cancelled.';
    else if (stopped && run.items.some((it) => it.status === 'skipped')) msg += ' Stopped early, because the AI couldn’t be reached twice in a row. Try the rest later.';
    say(run, msg);
    if (!run.cancel && !stopped) ta.value = '';
    paint(run);
    const startBtn = run.panel.querySelector('[data-bulk-start]');
    if (run.panel.contains(document.activeElement) || document.activeElement === document.body) startBtn.focus({ preventScroll: true });
    // One AI request asks whether every new topic fits the folder's name.
    if (built.length && await P.folders.checkFit(f.id, built)) refreshShelf(f.id);
  }

  /* ---------- events (delegated, so redraws need no rewiring) ---------- */
  function wire() {
    root.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t || !root.contains(t)) return;
      const shelf = t.closest('.shelf');
      const f = shelf && P.folders.get(shelf.dataset.folder);
      if (t.matches('[data-dismiss-fit]')) {
        const id = t.dataset.dismissFit;
        const card = t.closest('.ccard');
        t.closest('.fitwarn').remove();
        if (card) { const link = card.querySelector('.ccard__link'); if (link) link.focus(); }
        P.folders.dismissFit(id).catch((ex) => P.toast('Couldn’t dismiss the note: ' + ex.message, 'error'));
        return;
      }
      if (!f) return;
      if (t.matches('[data-add-one]') && opts.onAddOne) opts.onAddOne(f);
      else if (t.matches('[data-add-many]')) toggleBulk(f, t);
      else if (t.matches('[data-rename]')) startRename(shelf, f);
      else if (t.matches('[data-rename-cancel]')) { render(); focusShelf(f.id, '[data-rename]'); }
      else if (t.matches('[data-delete-folder]')) deleteFolder(f, t);
      else if (t.matches('[data-bulk-cancel]')) { const run = runs.get(f.id); if (run && run.running) { run.cancel = true; paint(run); say(run, 'Stopping after the topic being planned now.'); } }
      else if (t.matches('[data-bulk-close]')) {
        const run = runs.get(f.id);
        if (run) run.panel.hidden = true;
        const opener = shelf.querySelector('[data-add-many]');
        opener.setAttribute('aria-expanded', 'false');
        opener.focus();
      }
    });
    root.addEventListener('submit', (e) => {
      const form = e.target;
      const shelf = form.closest('.shelf');
      const f = shelf && P.folders.get(shelf.dataset.folder);
      if (!f) return;
      e.preventDefault();
      if (form.matches('.shelf__rename')) saveRename(form, f);
      else if (form.matches('.bulk')) { const run = runs.get(f.id); if (run && !run.running) startBulk(f, run); }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const form = e.target.closest && e.target.closest('.shelf__rename');
      if (!form) return;
      const shelf = form.closest('.shelf');
      render();
      focusShelf(shelf.dataset.folder, '[data-rename]');
    });
    root.addEventListener('change', (e) => {
      if (e.target.matches('select[data-move]')) moveFromCard(e.target);
    });
  }

  P.shelves = {
    // opts.onAddOne(folder): the shelf's "Add a topic" button was pressed.
    mount(el, options) {
      root = el;
      opts = options || {};
      wire();
      wireNewFolder();
      render();
      // Courses filed but never checked against their folder's name (say, built from the form above).
      P.folders.sweep().then((n) => { if (n && !this.busy()) render(); });
    },
    render,
    // The folder whose topics are being added right now, if any.
    busy() {
      for (const [fid, run] of runs) if (run.running) return P.folders.get(fid);
      return null;
    }
  };
})();
