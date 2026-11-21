/* =====================================================================
   The lesson notebook: a notebook that sits beside the lesson.
   - Write: lined paper, saved to the account as you type.
   - Sketch: a blank page to draw diagrams and worked steps.
   - All notes: every lesson's notes in this course, in one place.
   It also keeps what the learner draws on the lesson itself with the
   whiteboard, so annotations are still there next time.

   P.initNotebook({ course, n, lessonTitle, toggle, board, paper })
   P.notebook.append(text)   adds a line (used by "Add to notebook")
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, $$ = P.$$, esc = P.esc;

  const ICON_CLOSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const PEN_COLORS = [['#24305e', 'Blue ink'], ['#2b1d11', 'Black ink'], ['#9a3324', 'Red'], ['#3d6a2c', 'Green']];
  const PAD_W = 600, PAD_H = 820;
  const round = (strokes) => strokes.map((s) => ({ tool: s.tool, color: s.color, pts: s.pts.map(([x, y]) => [Math.round(x), Math.round(y)]) }));

  P.initNotebook = function ({ course, n, lessonTitle, toggle, board, paper }) {
    const el = document.createElement('aside');
    el.className = 'nb';
    el.id = 'notebook';
    el.hidden = true;
    el.setAttribute('aria-label', 'Notebook');
    el.innerHTML = `
      <span class="nb__ribbon" aria-hidden="true"></span>
      <header class="nb__head">
        <div>
          <p class="nb__eyebrow">Notebook</p>
          <h2 class="nb__title">Lesson ${n}: ${esc(lessonTitle)}</h2>
        </div>
        <button class="nb__close" type="button" aria-label="Close the notebook">${ICON_CLOSE}</button>
      </header>
      <div class="nb__tabs" role="tablist" aria-label="Notebook pages">
        <button class="nb__tab" type="button" role="tab" id="nb-tab-write" aria-controls="nb-write" aria-selected="true">Write</button>
        <button class="nb__tab" type="button" role="tab" id="nb-tab-sketch" aria-controls="nb-sketch" aria-selected="false" tabindex="-1">Sketch</button>
        <button class="nb__tab" type="button" role="tab" id="nb-tab-all" aria-controls="nb-all" aria-selected="false" tabindex="-1">All notes</button>
      </div>
      <div class="nb__body">
        <div class="nb__page" id="nb-write" role="tabpanel" aria-labelledby="nb-tab-write">
          <textarea class="nb__text" id="nb-text" spellcheck="true" aria-label="Your notes for this lesson" placeholder="Write anything: what clicked, what didn’t, a formula to remember…"></textarea>
        </div>
        <div class="nb__page nb__page--sketch" id="nb-sketch" role="tabpanel" aria-labelledby="nb-tab-sketch" hidden>
          <div class="nb__tools" role="toolbar" aria-label="Sketch tools">
            <button class="nb__tool" type="button" data-pad-tool="pen" aria-pressed="true">Pen</button>
            <button class="nb__tool" type="button" data-pad-tool="highlighter" aria-pressed="false">Highlighter</button>
            <button class="nb__tool" type="button" data-pad-tool="eraser" aria-pressed="false">Eraser</button>
            <span class="nb__swatches">${PEN_COLORS.map(([c, name], i) => `<button class="nb__swatch" type="button" data-pad-color="${c}" style="--c:${c}" aria-label="${name}" aria-pressed="${i === 0}"></button>`).join('')}</span>
            <span class="nb__spacer"></span>
            <button class="nb__tool" type="button" data-pad-act="undo">Undo</button>
            <button class="nb__tool" type="button" data-pad-act="clear">Clear</button>
          </div>
          <div class="nb__pad"><canvas width="${PAD_W}" height="${PAD_H}" aria-label="Sketch page for this lesson" role="img"></canvas></div>
        </div>
        <div class="nb__page nb__page--all" id="nb-all" role="tabpanel" aria-labelledby="nb-tab-all" hidden>
          <div class="nb__all" id="nb-all-list"></div>
        </div>
      </div>
      <footer class="nb__foot">
        <span class="nb__status" id="nb-status" role="status" aria-live="polite">Loading your notes…</span>
        <span class="nb__count" id="nb-count"></span>
      </footer>`;
    $('#main').appendChild(el);

    const ta = $('#nb-text', el);
    const status = $('#nb-status', el);
    const count = $('#nb-count', el);
    const state = { text: '', pad: [], page: [], pageWidth: 0, loaded: false };

    /* ---------- open / close ---------- */
    const DOCK = window.matchMedia('(min-width: 1600px)');
    function setOpen(on, focus) {
      el.hidden = !on;
      document.body.classList.toggle('nb-open', on);
      toggle.setAttribute('aria-expanded', String(on));
      P.store.set('primer.nb.open', on);
      if (on && focus) (activeTab === 'write' ? ta : $(`#nb-tab-${activeTab}`, el)).focus({ preventScroll: true });
      if (!on && focus) toggle.focus();
      if (on && activeTab === 'sketch') fitPad();
    }
    toggle.addEventListener('click', () => setOpen(el.hidden, true));
    $('.nb__close', el).addEventListener('click', () => setOpen(false, true));
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !DOCK.matches) { e.stopPropagation(); setOpen(false, true); } });

    /* ---------- tabs ---------- */
    let activeTab = 'write';
    const tabs = $$('.nb__tab', el);
    function showTab(name) {
      activeTab = name;
      tabs.forEach((t) => {
        const on = t.id === `nb-tab-${name}`;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      $$('.nb__page', el).forEach((p) => { p.hidden = p.id !== `nb-${name}`; });
      if (name === 'sketch') fitPad();
      if (name === 'all') loadAll();
    }
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => showTab(t.id.replace('nb-tab-', '')));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        showTab(next.id.replace('nb-tab-', ''));
      });
    });

    /* ---------- saving ---------- */
    let timer = 0, dirty = false, saving = null;
    const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const payload = () => ({ text: state.text, sketch: { page: round(state.page), pageWidth: state.pageWidth, pad: round(state.pad) } });
    async function save(keepalive) {
      clearTimeout(timer);
      if (!dirty || !state.loaded) return;
      dirty = false;
      status.textContent = 'Saving…';
      try {
        saving = P.api.saveNotes(course.id, n, payload(), keepalive);
        const r = await saving;
        if (!dirty) status.textContent = `Saved at ${fmt(r.updatedAt)}`;
      } catch (err) {
        dirty = true;
        status.textContent = 'Not saved yet: ' + err.message;
        timer = setTimeout(() => save(false), 6000);
      }
    }
    const schedule = () => { dirty = true; status.textContent = 'Editing…'; clearTimeout(timer); timer = setTimeout(() => save(false), 900); };
    addEventListener('pagehide', () => save(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });

    const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
    const updateCount = () => { const w = words(state.text); count.textContent = w ? `${w} word${w === 1 ? '' : 's'}` : ''; };
    ta.addEventListener('input', () => { state.text = ta.value; updateCount(); schedule(); });

    /* ---------- the drawing on the lesson page ---------- */
    function onPageSketch(strokes) {
      state.page = strokes.slice();
      state.pageWidth = paper.offsetWidth;
      schedule();
    }

    /* ---------- sketch page ---------- */
    const pad = $('.nb__pad canvas', el);
    const pctx = pad.getContext('2d');
    const PAD_TOOLS = { pen: { width: 2.6, alpha: 1 }, highlighter: { width: 18, alpha: 0.3, color: '#e0a93a' }, eraser: { width: 24, alpha: 1 } };
    const padState = { tool: 'pen', color: PEN_COLORS[0][0], cur: null };
    function drawPadStroke(s) {
      const T = PAD_TOOLS[s.tool] || PAD_TOOLS.pen;
      const p = s.pts;
      if (!p.length) return;
      pctx.save();
      pctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      pctx.globalAlpha = T.alpha;
      pctx.strokeStyle = T.color || s.color;
      pctx.lineWidth = T.width;
      pctx.lineCap = 'round';
      pctx.lineJoin = 'round';
      pctx.beginPath();
      pctx.moveTo(p[0][0], p[0][1]);
      if (p.length < 3) { p.slice(1).forEach(([x, y]) => pctx.lineTo(x, y)); if (p.length === 1) pctx.lineTo(p[0][0] + 0.01, p[0][1]); }
      else {
        for (let i = 1; i < p.length - 1; i++) pctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
        pctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      }
      pctx.stroke();
      pctx.restore();
    }
    function redrawPad() {
      pctx.clearRect(0, 0, PAD_W, PAD_H);
      state.pad.forEach(drawPadStroke);
      if (padState.cur) drawPadStroke(padState.cur);
    }
    function fitPad() { /* the canvas scales with CSS; nothing to resize */ redrawPad(); }
    const padPoint = (e) => {
      const r = pad.getBoundingClientRect();
      return [(e.clientX - r.left) * (PAD_W / r.width), (e.clientY - r.top) * (PAD_H / r.height)];
    };
    pad.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { pad.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      padState.cur = { tool: padState.tool, color: padState.color, pts: [padPoint(e)] };
      redrawPad();
    });
    pad.addEventListener('pointermove', (e) => {
      if (!padState.cur) return;
      (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]).forEach((ev) => padState.cur.pts.push(padPoint(ev)));
      redrawPad();
    });
    const endPad = () => {
      if (!padState.cur) return;
      state.pad.push(padState.cur);
      padState.cur = null;
      redrawPad();
      schedule();
    };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => pad.addEventListener(t, endPad));
    $$('[data-pad-tool]', el).forEach((b) => b.addEventListener('click', () => {
      padState.tool = b.dataset.padTool;
      $$('[data-pad-tool]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    $$('[data-pad-color]', el).forEach((b) => b.addEventListener('click', () => {
      padState.color = b.dataset.padColor;
      padState.tool = 'pen';
      $$('[data-pad-tool]', el).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.padTool === 'pen')));
      $$('[data-pad-color]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    $('[data-pad-act="undo"]', el).addEventListener('click', () => { if (state.pad.pop()) { redrawPad(); schedule(); } });
    $('[data-pad-act="clear"]', el).addEventListener('click', () => {
      if (!state.pad.length || !window.confirm('Clear this sketch page? This can’t be undone.')) return;
      state.pad = [];
      redrawPad();
      schedule();
    });

    /* ---------- all notes in this course ---------- */
    async function loadAll() {
      const list = $('#nb-all-list', el);
      list.innerHTML = '<p class="nb__empty">Gathering your notes…</p>';
      try {
        await save(false);
        const d = await P.get(`/api/courses/${encodeURIComponent(course.id)}/notes`);
        const flat = P.courseGen.flatten(course);
        if (!d.notes.length) { list.innerHTML = '<p class="nb__empty">No notes in this course yet. Whatever you write on the Write page appears here, lesson by lesson.</p>'; return; }
        list.innerHTML = d.notes.map((note) => {
          const meta = flat[note.lesson - 1];
          const here = note.lesson === n;
          return `<section class="nb__entry${here ? ' is-here' : ''}">
              <h3><a href="lesson.html?course=${encodeURIComponent(course.id)}&amp;lesson=${note.lesson}">Lesson ${note.lesson}${meta ? ': ' + esc(meta.title) : ''}</a>${here ? ' <small>this lesson</small>' : ''}</h3>
              <p>${esc(note.text).replace(/\n/g, '<br>')}</p>
            </section>`;
        }).join('');
      } catch (err) {
        list.innerHTML = `<p class="nb__empty">Your notes didn’t load: ${esc(err.message)}</p>`;
      }
    }

    /* ---------- load what was saved ---------- */
    P.api.getNotes(course.id, n).then((d) => {
      state.text = d.text || '';
      ta.value = state.text;
      const sk = d.sketch || {};
      state.pad = Array.isArray(sk.pad) ? sk.pad : [];
      state.page = Array.isArray(sk.page) ? sk.page : [];
      state.pageWidth = sk.pageWidth || paper.offsetWidth;
      if (state.page.length && board) {
        // the page may be a different width now: stretch the drawing to match
        const k = state.pageWidth ? paper.offsetWidth / state.pageWidth : 1;
        board.setStrokes(state.page.map((s) => ({ tool: s.tool, color: s.color, pts: s.pts.map(([x, y]) => [x * k, y]) })));
      }
      state.loaded = true;
      updateCount();
      status.textContent = d.updatedAt ? `Last saved ${new Date(d.updatedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Notes save as you write.';
      redrawPad();
      el.dispatchEvent(new CustomEvent('primer:notes', { bubbles: true })); // the notes are in (study methods lay them out)
    }).catch((err) => {
      state.loaded = true;
      status.textContent = 'Your notes didn’t load: ' + err.message;
    });

    let saved = null;
    try { saved = P.store.get('primer.nb.open', false); } catch (e) { saved = false; }
    if (saved) setOpen(true, false);

    P.notebook = {
      append(textToAdd) {
        if (el.hidden) setOpen(true, false);
        showTab('write');
        const sep = state.text && !state.text.endsWith('\n') ? '\n\n' : (state.text ? '\n' : '');
        state.text = state.text + sep + textToAdd + '\n';
        ta.value = state.text;
        ta.scrollTop = ta.scrollHeight;
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(ta.value.length, ta.value.length);
        updateCount();
        schedule();
        P.toast('Added to your notebook.');
      }
    };
    return { onPageSketch };
  };
})();
