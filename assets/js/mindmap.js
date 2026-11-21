/* =====================================================================
   A small mind map for one part of a lesson (the Mind map study method,
   assets/js/study-methods.js): the part's title in the middle and its
   key points around it. Ideas can be dragged (or moved with the arrow
   keys), given a note, and joined by ideas of the learner's own.

   P.mindmap.mount(host, { title, points, data, onChange(data), toNotebook(text) })
     data: { v: 1, nodes: [{ id, text, x, y, note, parent, own }] }
     x and y are fractions of the board, so a map fits any width.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  const T = (s) => esc(t(s));
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const NL = String.fromCharCode(10);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let seq = 0;

  function layout(title, points) {
    const nodes = [{ id: 'c', text: title, x: 0.5, y: 0.5, note: '', parent: null, own: false }];
    const n = points.length;
    points.forEach((p, k) => {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / Math.max(n, 1);
      nodes.push({ id: 'p' + k, text: p, x: 0.5 + 0.34 * Math.cos(a), y: 0.5 + 0.36 * Math.sin(a), note: '', parent: 'c', own: false });
    });
    return { v: 1, nodes };
  }

  function mount(host, opts) {
    const fresh = () => layout(opts.title, opts.points || []);
    let data = opts.data && Array.isArray(opts.data.nodes) && opts.data.nodes.length ? JSON.parse(JSON.stringify(opts.data)) : fresh();
    let selected = null;
    const uid = 'mm' + (++seq);

    host.innerHTML = `
      <div class="mm" role="group" aria-label="${esc(fill('Mind map of “{title}”', { title: opts.title }))}" aria-describedby="${uid}-help">
        <p class="sr-only" id="${uid}-help">${T('Each idea is a button. Select one to add a note to it. Move a selected idea with the arrow keys.')}</p>
        <svg class="mm__lines" aria-hidden="true"></svg>
        <div class="mm__nodes"></div>
      </div>
      <div class="mm__bar">
        <p class="mm__sel" aria-live="polite"></p>
        <div class="mm__edit" hidden>
          <label class="mm__label" for="${uid}-note">${T('Note on this idea')}</label>
          <textarea class="mm__note" id="${uid}-note" rows="2" maxlength="600" placeholder="${T('An example, a question, a link to something else…')}"></textarea>
        </div>
        <form class="mm__add" novalidate>
          <label class="sr-only" for="${uid}-new">${T('A new idea')}</label>
          <input class="mm__new" id="${uid}-new" type="text" maxlength="160" autocomplete="off" placeholder="${T('Add an idea of your own')}">
          <button class="mm__btn" type="submit">${T('Add')}</button>
        </form>
        <div class="mm__acts">
          <button class="mm__btn" type="button" data-del hidden>${T('Delete this idea')}</button>
          <button class="mm__btn" type="button" data-tidy>${T('Tidy up')}</button>
          ${opts.toNotebook ? `<button class="mm__btn" type="button" data-nb>${T('Copy to notebook')}</button>` : ''}
        </div>
      </div>`;
    const board = host.querySelector('.mm');
    const lines = host.querySelector('.mm__lines');
    const layer = host.querySelector('.mm__nodes');
    const selText = host.querySelector('.mm__sel');
    const edit = host.querySelector('.mm__edit');
    const noteBox = host.querySelector('.mm__note');
    const delBtn = host.querySelector('[data-del]');
    const byId = (id) => data.nodes.find((x) => x.id === id);

    const changed = () => { if (opts.onChange) opts.onChange(JSON.parse(JSON.stringify(data))); };

    function nodeLabel(nd) {
      return nd.text + (nd.note ? '. ' + fill('Note: {note}', { note: nd.note }) : '');
    }

    function render() {
      layer.innerHTML = '';
      data.nodes.forEach((nd) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mm__node' + (nd.id === 'c' ? ' is-centre' : '') + (nd.own ? ' is-own' : '') + (nd.id === selected ? ' is-selected' : '');
        b.dataset.id = nd.id;
        b.setAttribute('aria-pressed', String(nd.id === selected));
        b.setAttribute('aria-label', nodeLabel(nd));
        b.innerHTML = `<span class="mm__text">${esc(nd.text)}</span>${nd.note ? `<span class="mm__nnote">${esc(nd.note)}</span>` : ''}`;
        layer.appendChild(b);
      });
      if (P.math) P.math(layer);
      relayout();
      syncBar();
    }
    const elOf = (nd) => layer.querySelector(`[data-id="${CSS.escape(nd.id)}"]`);
    // where an idea's box sits: its place on the board, kept whole inside it (a narrow screen moves it in)
    function centre(nd, el) {
      el = el || elOf(nd);
      const w = board.clientWidth, h = board.clientHeight;
      const hw = el ? el.offsetWidth / 2 + 3 : 0, hh = el ? el.offsetHeight / 2 + 3 : 0;
      return { x: Math.min(Math.max(nd.x * w, hw), Math.max(hw, w - hw)), y: Math.min(Math.max(nd.y * h, hh), Math.max(hh, h - hh)) };
    }
    function place(el, nd) { const c = centre(nd, el); el.style.left = c.x.toFixed(1) + 'px'; el.style.top = c.y.toFixed(1) + 'px'; }
    function relayout() {
      data.nodes.forEach((nd) => { const el = elOf(nd); if (el) place(el, nd); });
      drawLines();
    }

    function drawLines() {
      const w = board.clientWidth, h = board.clientHeight;
      lines.setAttribute('viewBox', `0 0 ${w} ${h}`);
      lines.innerHTML = data.nodes.filter((nd) => nd.parent && byId(nd.parent)).map((nd) => {
        const p = byId(nd.parent);
        const a = centre(p), b = centre(nd);
        const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
        const mx = (x1 + x2) / 2;
        return `<path class="${nd.own ? 'is-own' : ''}" d="M${x1.toFixed(1)} ${y1.toFixed(1)} C${mx.toFixed(1)} ${y1.toFixed(1)} ${mx.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
      }).join('');
    }

    function syncBar() {
      const nd = selected && byId(selected);
      edit.hidden = !nd;
      delBtn.hidden = !(nd && nd.own);
      selText.textContent = nd ? fill('Selected: {idea}', { idea: nd.text }) : t('Select an idea to add a note to it. New ideas join the selected one, or the middle.');
      if (nd && document.activeElement !== noteBox) noteBox.value = nd.note || '';
    }

    function select(id, focus) {
      selected = selected === id && !focus ? null : id;
      layer.querySelectorAll('.mm__node').forEach((b) => {
        const on = b.dataset.id === selected;
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-pressed', String(on));
      });
      syncBar();
    }

    /* ---------- dragging ---------- */
    let drag = null;
    layer.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.mm__node');
      if (!b || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const r = board.getBoundingClientRect();
      drag = { b, id: b.dataset.id, x0: e.clientX, y0: e.clientY, r, moved: false, pid: e.pointerId };
    });
    layer.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pid) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      if (!drag.moved) { drag.moved = true; try { drag.b.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } drag.b.classList.add('is-drag'); }
      e.preventDefault();
      const nd = byId(drag.id);
      nd.x = clamp((e.clientX - drag.r.left) / drag.r.width, 0.06, 0.94);
      nd.y = clamp((e.clientY - drag.r.top) / drag.r.height, 0.07, 0.93);
      place(drag.b, nd);
      drawLines();
    });
    const endDrag = (e) => {
      if (!drag || (e && e.pointerId !== drag.pid)) return;
      const d = drag;
      drag = null;
      d.b.classList.remove('is-drag');
      if (d.moved) { d.b._dragged = true; changed(); }
    };
    ['pointerup', 'pointercancel'].forEach((ev) => layer.addEventListener(ev, endDrag));
    layer.addEventListener('click', (e) => {
      const b = e.target.closest('.mm__node');
      if (!b) return;
      if (b._dragged) { b._dragged = false; return; }
      select(b.dataset.id);
    });
    layer.addEventListener('keydown', (e) => {
      const b = e.target.closest('.mm__node');
      if (!b) return;
      const step = e.shiftKey ? 0.08 : 0.025;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) {
        e.preventDefault();
        const nd = byId(b.dataset.id);
        nd.x = clamp(nd.x + d[0], 0.06, 0.94);
        nd.y = clamp(nd.y + d[1], 0.07, 0.93);
        place(b, nd);
        drawLines();
        changed();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && byId(b.dataset.id).own) {
        e.preventDefault();
        remove(b.dataset.id);
      }
    });

    /* ---------- notes, new ideas, deleting ---------- */
    noteBox.addEventListener('input', () => {
      const nd = selected && byId(selected);
      if (!nd) return;
      nd.note = noteBox.value.slice(0, 600);
      const b = layer.querySelector(`[data-id="${CSS.escape(nd.id)}"]`);
      if (b) {
        let nn = b.querySelector('.mm__nnote');
        if (nd.note && !nn) { nn = document.createElement('span'); nn.className = 'mm__nnote'; b.appendChild(nn); }
        if (nn) { if (nd.note) nn.textContent = nd.note; else nn.remove(); }
        b.setAttribute('aria-label', nodeLabel(nd));
        place(b, nd); // a longer box may need moving in from the edge
        drawLines();
      }
      changed();
    });
    host.querySelector('.mm__add').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = host.querySelector('.mm__new');
      const textIn = inp.value.replace(/\s+/g, ' ').trim();
      if (!textIn) { inp.focus(); return; }
      if (data.nodes.length >= 40) { P.toast(t('That’s a full map. Tidy it up, or delete an idea first.')); return; }
      const parent = byId(selected) || byId('c');
      const spot = freeSpot(parent);
      const nd = { id: 'o' + Date.now().toString(36) + (seq++), text: textIn.slice(0, 160), note: '', parent: parent.id, own: true, x: spot[0], y: spot[1] };
      data.nodes.push(nd);
      inp.value = '';
      selected = nd.id;
      render();
      changed();
      const b = layer.querySelector(`[data-id="${CSS.escape(nd.id)}"]`);
      if (b) b.focus();
    });
    // the place near a parent idea that is farthest from every other idea (in board proportions)
    function freeSpot(parent, others) {
      const aspect = board.clientWidth && board.clientHeight ? board.clientWidth / board.clientHeight : 1.6;
      const list = others || data.nodes;
      let best = null, bestD = -1;
      [0.17, 0.25, 0.33].forEach((r) => {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * 2 * Math.PI;
          const x = clamp(parent.x + (r / aspect) * 1.6 * Math.cos(a), 0.1, 0.9), y = clamp(parent.y + r * Math.sin(a), 0.1, 0.9);
          const d = Math.min(...list.map((o) => Math.hypot((o.x - x) * aspect, o.y - y)));
          if (d > bestD + 0.02) { bestD = d; best = [x, y]; }
        }
      });
      return best || [0.5, 0.5];
    }
    function remove(id) {
      const gone = new Set([id]);
      let grew = true;
      while (grew) { grew = false; data.nodes.forEach((x) => { if (x.parent && gone.has(x.parent) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }); }
      data.nodes = data.nodes.filter((x) => !gone.has(x.id));
      selected = null;
      render();
      changed();
      host.querySelector('.mm__new').focus();
    }
    delBtn.addEventListener('click', () => { if (selected) remove(selected); });
    host.querySelector('[data-tidy]').addEventListener('click', () => {
      // the lesson's own points back around the middle, notes and ideas kept
      const base = fresh();
      const own = data.nodes.filter((x) => x.own);
      const keep = new Map(data.nodes.map((x) => [x.id, x]));
      data.nodes = base.nodes.map((x) => Object.assign(x, { note: (keep.get(x.id) || {}).note || '' }));
      own.forEach((x) => {
        const parent = byId(x.parent) || byId('c');
        const spot = freeSpot(parent);
        data.nodes.push(Object.assign({}, x, { parent: parent.id, x: spot[0], y: spot[1] }));
      });
      render();
      changed();
    });
    const nb = host.querySelector('[data-nb]');
    if (nb) nb.addEventListener('click', () => {
      const lines2 = [fill('Mind map: {title}', { title: opts.title })];
      const walk = (id, depth) => data.nodes.filter((x) => x.parent === id).forEach((x) => {
        lines2.push('  '.repeat(depth) + '- ' + x.text + (x.note ? ` (${x.note})` : ''));
        walk(x.id, depth + 1);
      });
      walk('c', 0);
      opts.toNotebook(lines2.join(NL));
    });

    if (window.ResizeObserver) new ResizeObserver(() => relayout()).observe(board);
    render();
    return { data: () => data };
  }

  P.mindmap = { mount, layout };
})();
