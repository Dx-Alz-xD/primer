/* =====================================================================
   The chess board in lessons (assets/js/widgets.js; the server half is
   server/widgets/chess.mjs, the rules are chess-rules.js, shared).

   A block shows a position, plays a line of moves with Play, Pause,
   Step and Back, lists them in SAN, and lets the learner try their own
   moves from any point (Reset goes back). A task is a checkpoint
   question done on the board: find the move, play a line while the
   board answers, mate in one or two (the board defends), or tap the
   squares. Input: tap a piece then a square, drag with a mouse or a
   finger, or the keyboard (arrow keys between squares, Enter or Space
   to pick up and put down, Escape to let go).

   Every spec and goal is checked again here with the same rules as on
   the server. Pieces are drawn here as SVG (no font glyphs, which turn
   into emoji on some phones); nothing from a spec goes into markup
   except squares and moves the rules have checked, and text is escaped.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;

  // the rules, shared with the server; the loader waits for them (impl.ready)
  let R = window.PrimerChessRules || null;
  const ready = R ? Promise.resolve(R) : new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/assets/js/widgets/chess-rules.js';
    s.async = true;
    s.onload = () => { R = window.PrimerChessRules || null; return R ? resolve(R) : reject(new Error('the chess rules did not load')); };
    s.onerror = () => reject(new Error('the chess rules could not be loaded'));
    document.head.appendChild(s);
  });
  ready.catch(() => {});

  const tr = (s) => (P.t ? P.t(s) : s);
  const fill = (s, v) => tr(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const esc = P.esc || ((s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
  const el = (tag, cls, attrs) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    return e;
  };

  /* ------------------------------------------------------------------
     The pieces, drawn for Primer (100 × 100): parts filled and outlined,
     detail lines, and, on dark pieces, light seams between the parts.
  ------------------------------------------------------------------ */
  const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  const BASE = 'M24 91H76C80.5 91 83 88.6 83 85.5C83 81.6 80 79 75.5 79H24.5C20 79 17 81.6 17 85.5C17 88.6 19.5 91 24 91Z';
  const BODY = 'M33 64C33 70 30.5 75 27 79H73C69.5 75 67 70 67 64Z';
  const COLLAR = 'M29.5 65H70.5L71.5 58H28.5Z';
  const SHAPES = {
    p: {
      parts: ['M41.5 47C41.5 60 34 70 27.5 79H72.5C66 70 58.5 60 58.5 47Z', 'M35.5 48.5H64.5C64.5 43.5 61.5 40.5 57.5 40.5H42.5C38.5 40.5 35.5 43.5 35.5 48.5Z', circ(50, 27.5, 12.5), BASE],
      lines: [], sep: ['M38 48.5H62', 'M28.5 79H71.5'], dots: []
    },
    r: {
      parts: ['M33.5 43H66.5L69.5 73H30.5Z', 'M25.5 18.5H35.5V26.5H44.5V18.5H55.5V26.5H64.5V18.5H74.5V37C74.5 40.5 72.5 43 69 43H31C27.5 43 25.5 40.5 25.5 37Z', 'M27.5 79L30 72.5H70L72.5 79Z', BASE],
      lines: [], sep: ['M31 43H69', 'M30.5 72.5H69.5', 'M28 79H72'], dots: []
    },
    n: {
      parts: ['M31 79C29.5 67 33 59 43.5 52.5C38.5 51.5 33.5 54.5 27.5 58.5C22 62 15.5 59 15.5 52.5C15.5 45 23.5 39 29.5 32.5C33 27.5 36 22 42 17.5L44 8.5L50.5 15.5C64.5 16.5 78 29 78 50.5C78 63 73 72 72.5 79Z', BASE],
      lines: ['M52 17.5C63.5 22.5 71 33.5 71.5 49'], sep: ['M30 79H72'], dots: [[38.5, 29, 2.8], [21.5, 52, 1.7]]
    },
    b: {
      parts: ['M40.5 58C40.5 67 35 73 30 79H70C65 73 59.5 67 59.5 58Z', 'M34.5 59.5H65.5C65.5 55.5 62.5 53 58.5 53H41.5C37.5 53 34.5 55.5 34.5 59.5Z', 'M50 16.5C61.5 24.5 66.5 34 63.5 44.5C61.5 50 56.5 53 50 53C43.5 53 38.5 50 36.5 44.5C33.5 34 38.5 24.5 50 16.5Z', circ(50, 11.5, 5), BASE],
      lines: ['M55.5 27.5L45.5 40'], sep: ['M37 53H63', 'M37 59.5H63', 'M30.5 79H69.5'], dots: []
    },
    q: {
      parts: [BODY, COLLAR, 'M30 58L19.5 28.5L29 45L35 20.5L42 39L50 16.5L58 39L65 20.5L71 45L80.5 28.5L70 58Z', circ(19.5, 26, 4.5), circ(35, 18, 4.5), circ(50, 13.5, 4.5), circ(65, 18, 4.5), circ(80.5, 26, 4.5), BASE],
      lines: [], sep: ['M30 58H70', 'M31.5 65H68.5', 'M28 79H72'], dots: []
    },
    k: {
      parts: [BODY, COLLAR, 'M46.5 5H53.5V11H59.5V18H53.5V40H46.5V18H40.5V11H46.5Z', 'M29 58C21.5 46 27 33 38 33C44 33 48 37 50 41.5C52 37 56 33 62 33C73 33 78.5 46 71 58Z', BASE],
      lines: ['M32.5 50C44.5 46 55.5 46 67.5 50'], sep: ['M30 58H70', 'M31.5 65H68.5', 'M28 79H72'], dots: []
    }
  };
  const INK = '#2b1d11', IVORY = '#fbf6ea', SEAM = '#e8dbbd';
  const pieceArt = {};
  // the inside of a piece's <svg>: built from the constant shapes above only
  function pieceInner(p) {
    if (pieceArt[p]) return pieceArt[p];
    const s = SHAPES[p.toLowerCase()];
    const white = p < 'a';
    const detail = white ? INK : SEAM;
    const paths = (list) => list.map((d) => `<path d="${d}"/>`).join('');
    let out = `<g fill="${white ? IVORY : INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round">${paths(s.parts)}</g>`;
    if (s.lines.length) out += `<g fill="none" stroke="${detail}" stroke-width="2.6" stroke-linecap="round">${paths(s.lines)}</g>`;
    if (!white && s.sep.length) out += `<g fill="none" stroke="${SEAM}" stroke-width="1.6" stroke-linecap="round" opacity=".8">${paths(s.sep)}</g>`;
    if (s.dots.length) out += `<g fill="${detail}">${s.dots.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`;
    pieceArt[p] = out;
    return out;
  }
  const pieceSVG = (p) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${pieceInner(p)}</svg>`;

  const NAMES = {
    P: 'White pawn', N: 'White knight', B: 'White bishop', R: 'White rook', Q: 'White queen', K: 'White king',
    p: 'Black pawn', n: 'Black knight', b: 'Black bishop', r: 'Black rook', q: 'Black queen', k: 'Black king'
  };
  const PROMO = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
  const ARROW = { g: '#3d6a2c', r: '#9a3324', y: '#b07a1e', b: '#2f5f86' };
  const ICONS = {
    start: '<path d="M6 5v14"/><path d="M18 6l-8 6 8 6z" fill="currentColor"/>',
    back: '<path d="M16 6l-8 6 8 6z" fill="currentColor"/>',
    play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
    pause: '<path d="M8 5.5v13M16 5.5v13"/>',
    fwd: '<path d="M8 6l8 6-8 6z" fill="currentColor"/>',
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4v4.5H9"/>',
    undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>'
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

  // checked specs, kept: the server already checked them, and the browser checks again only once
  const cache = new Map();
  function normed(spec, goal) {
    if (!R) return null;
    let key;
    try { key = JSON.stringify([spec, goal == null ? null : goal]); } catch (e) { return null; }
    if (cache.has(key)) return cache.get(key);
    const out = goal == null ? R.normBlock(spec) : R.normTask(spec, goal);
    if (cache.size > 100) cache.clear();
    cache.set(key, out);
    return out;
  }
  const lastOf = (start, ucis) => {
    let p = start, m = null;
    for (const u of ucis || []) { m = R.parseMove(p, u); if (!m) return null; p = R.play(p, m); }
    return m;
  };

  /* ------------------------------------------------------------------
     The board: squares (the keyboard and the screen reader use them),
     the pieces above them, arrows above those, and the promotion chooser.
  ------------------------------------------------------------------ */
  function makeBoard(o) {
    const t = o.ctx.t;
    const reduce = Boolean(o.ctx.reduce);
    const flip = o.orientation === 'black';
    const at = (row, col) => (flip ? row * 8 + (7 - col) : (7 - row) * 8 + col);
    const rc = (i) => (flip ? [i >> 3, 7 - (i & 7)] : [7 - (i >> 3), i & 7]);

    const frame = el('div', 'chs__frame');
    const grid = el('div', 'chs__board', { role: 'grid', 'aria-label': t('Chess board') });
    const sqs = new Array(64);
    for (let row = 0; row < 8; row++) {
      const r = el('div', 'chs__row', { role: 'row' });
      for (let col = 0; col < 8; col++) {
        const i = at(row, col);
        const s = el('div', `chs__sq ${((i >> 3) + (i & 7)) % 2 ? 'is-light' : 'is-dark'}`, { role: 'gridcell', tabindex: '-1' });
        s.dataset.i = String(i);
        if (col === 0) s.appendChild(Object.assign(el('span', 'chs__co chs__co--rank', { 'aria-hidden': 'true' }), { textContent: String((i >> 3) + 1) }));
        if (row === 7) s.appendChild(Object.assign(el('span', 'chs__co chs__co--file', { 'aria-hidden': 'true' }), { textContent: R.FILES[i & 7] }));
        r.appendChild(s);
        sqs[i] = s;
      }
      grid.appendChild(r);
    }
    const layer = el('div', 'chs__pieces', { 'aria-hidden': 'true' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'chs__arrows');
    svg.setAttribute('viewBox', '0 0 800 800');
    svg.setAttribute('aria-hidden', 'true');
    const promo = el('div', 'chs__promo');
    promo.hidden = true;
    const live = el('div', 'chs__live', { 'aria-live': 'polite' });
    frame.append(grid, layer, svg, promo, live);

    let pos = null, moves = [], sel = -1, focusIdx = -1, input = null, drag = null, promoOpen = false;
    const pcs = new Array(64);
    let decor = {};

    const place = (d, i) => { const [r, c] = rc(i); d.style.transform = `translate(${c * 100}%, ${r * 100}%)`; };

    function drawPieces(anim, captured) {
      layer.textContent = '';
      pcs.fill(null);
      const go = anim && !reduce;
      const moving = [];
      for (let i = 0; i < 64; i++) {
        const p = pos.b[i];
        if (!p) continue;
        const d = el('div', 'chs__pc');
        d.innerHTML = pieceSVG(p);
        let from = i;
        if (go) {
          if (i === anim.to) from = anim.from;
          else if (anim.castle && i === anim.rookTo) from = anim.rookFrom;
        }
        place(d, from);
        if (from !== i) moving.push([d, i]);
        layer.appendChild(d);
        pcs[i] = d;
      }
      if (go && captured && captured.piece) {
        const g = el('div', 'chs__pc is-gone');
        g.innerHTML = pieceSVG(captured.piece);
        place(g, captured.sq);
        layer.insertBefore(g, layer.firstChild);
        setTimeout(() => g.remove(), 320);
      }
      if (moving.length) {
        void layer.offsetWidth; // start from the old squares
        moving.forEach(([d, i]) => { d.classList.add('is-moving'); place(d, i); });
      }
    }

    function drawArrows(list) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      (list || []).forEach(([a, b, c]) => {
        const [r1, c1] = rc(R.sqIndex(a)), [r2, c2] = rc(R.sqIndex(b));
        const x1 = c1 * 100 + 50, y1 = r1 * 100 + 50, x2 = c2 * 100 + 50, y2 = r2 * 100 + 50;
        const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        const head = 34, w = 15, ex = x2 - ux * 12, ey = y2 - uy * 12; // the tip stops short of the centre
        const bx = ex - ux * head, by = ey - uy * head;
        const color = ARROW[c] || ARROW.g;
        const line = document.createElementNS(svg.namespaceURI, 'line');
        [['x1', x1 + ux * 18], ['y1', y1 + uy * 18], ['x2', bx], ['y2', by], ['stroke', color], ['stroke-width', String(w)], ['stroke-linecap', 'round']].forEach(([k, v]) => line.setAttribute(k, String(v)));
        const tip = document.createElementNS(svg.namespaceURI, 'polygon');
        tip.setAttribute('points', `${ex},${ey} ${bx - uy * 24},${by + ux * 24} ${bx + uy * 24},${by - ux * 24}`);
        tip.setAttribute('fill', color);
        const g = document.createElementNS(svg.namespaceURI, 'g');
        g.setAttribute('opacity', '.78');
        g.append(line, tip);
        svg.appendChild(g);
      });
    }

    const mine = (i) => Boolean(pos && pos.b[i] && R.colorOf(pos.b[i]) === pos.turn);
    const targets = (i) => moves.filter((m) => m.from === i);

    function paint() {
      const last = decor.last;
      const hl = new Set(decor.highlight || []);
      const marks = decor.marks || {};
      const checkSq = pos && R.inCheck(pos) ? pos.b.indexOf(pos.turn === 'w' ? 'K' : 'k') : -1;
      const tg = sel >= 0 ? targets(sel) : [];
      for (let i = 0; i < 64; i++) {
        const s = sqs[i], name = R.sqName(i), p = pos ? pos.b[i] : '';
        const c = s.classList;
        c.toggle('is-last', Boolean(last && (last.from === i || last.to === i)));
        c.toggle('is-hl', hl.has(name));
        c.toggle('is-check', i === checkSq);
        c.toggle('is-sel', i === sel);
        const isT = tg.some((m) => m.to === i);
        c.toggle('is-target', isT && !p && !(tg.find((m) => m.to === i) || {}).ep);
        c.toggle('is-capture', isT && (Boolean(p) || Boolean((tg.find((m) => m.to === i) || {}).ep)));
        c.toggle('is-mark', Boolean(marks.mark && marks.mark.has(name)));
        c.toggle('is-good', Boolean(marks.good && marks.good.has(name)));
        c.toggle('is-bad', Boolean(marks.bad && marks.bad.has(name)));
        c.toggle('is-mine', input === 'move' && mine(i));
        let label = name + (p ? ', ' + t(NAMES[p]) : '');
        if (isT) label += ', ' + t('a move here');
        if (marks.mark && marks.mark.has(name)) label += ', ' + t('chosen');
        s.setAttribute('aria-label', label);
        if (i === sel || (marks.mark && marks.mark.has(name))) s.setAttribute('aria-selected', 'true');
        else s.removeAttribute('aria-selected');
      }
      frame.classList.toggle('is-input', Boolean(input));
    }

    function setFocus(i, move) {
      if (i < 0) return;
      if (focusIdx >= 0 && sqs[focusIdx]) sqs[focusIdx].tabIndex = -1;
      focusIdx = i;
      sqs[i].tabIndex = 0;
      if (move) sqs[i].focus({ preventScroll: false });
    }

    function select(i) {
      sel = i;
      paint();
    }

    function note(s) { if (o.onNote) o.onNote(s); }

    function illegalWhy(from, to) {
      if (from < 0) return;
      const pseudoOk = R.pseudo(pos).some((m) => m.from === from && m.to === to);
      if (pseudoOk) note(t('That move would leave your king in check.'));
    }

    // a tap or Enter on square i
    function activate(i) {
      if (!input || promoOpen) return;
      if (input === 'square') { if (o.onSquare) o.onSquare(R.sqName(i)); return; }
      if (sel >= 0) {
        if (i === sel) { select(-1); return; }
        const ms = targets(sel).filter((m) => m.to === i);
        if (ms.length) { commit(ms, false); return; }
        if (mine(i)) { pick(i); return; }
        illegalWhy(sel, i);
        select(-1);
        return;
      }
      if (mine(i)) { pick(i); return; }
      if (pos.b[i]) note(t(pos.turn === 'w' ? 'It’s White’s turn.' : 'It’s Black’s turn.'));
    }

    function pick(i) {
      select(i);
      if (!targets(i).length) note(t(R.inCheck(pos) ? 'Your king is in check: that piece can’t help.' : 'That piece has no move here.'));
    }

    function commit(ms, dragged) {
      if (ms.length > 1) { choosePromotion(ms, dragged); return; }
      const m = ms[0];
      sel = -1;
      if (o.onMove) o.onMove(m, dragged);
    }

    function choosePromotion(ms, dragged) {
      promoOpen = true;
      promo.textContent = '';
      const box = el('div', 'chs__promo-box', { role: 'group', 'aria-label': t('Promote the pawn to') });
      const close = () => { promoOpen = false; promo.hidden = true; promo.textContent = ''; };
      const white = pos.turn === 'w';
      const btns = ['q', 'r', 'b', 'n'].map((k) => {
        const m = ms.find((x) => x.promo === k);
        const b = el('button', 'chs__promo-btn', { type: 'button', 'aria-label': t(PROMO[k]), title: t(PROMO[k]) });
        b.innerHTML = pieceSVG(white ? k.toUpperCase() : k);
        b.addEventListener('click', () => { close(); sel = -1; if (o.onMove) o.onMove(m, dragged); setFocus(m.to, true); });
        return b;
      });
      const cancel = el('button', 'chs__promo-btn chs__promo-cancel', { type: 'button', 'aria-label': t('Cancel'), title: t('Cancel') });
      cancel.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      cancel.addEventListener('click', () => { const back = sel; close(); select(-1); drawPieces(); paint(); setFocus(back >= 0 ? back : focusIdx, true); });
      box.append(...btns, cancel);
      box.addEventListener('keydown', (e) => {
        const all = [...btns, cancel], k = all.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel.click(); } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); all[(k + 1) % all.length].focus(); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); all[(k + all.length - 1) % all.length].focus(); }
      });
      promo.appendChild(box);
      promo.hidden = false;
      btns[0].focus({ preventScroll: true });
    }

    // the square under a point, or -1
    function squareAt(x, y) {
      const r = grid.getBoundingClientRect();
      const col = Math.floor(((x - r.left) / r.width) * 8), row = Math.floor(((y - r.top) / r.height) * 8);
      return col < 0 || col > 7 || row < 0 || row > 7 ? -1 : at(row, col);
    }
    const sqOf = (e) => { const s = e.target && e.target.closest ? e.target.closest('.chs__sq') : null; return s && grid.contains(s) ? Number(s.dataset.i) : -1; };

    function onDown(e) {
      if (!input || promoOpen || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const i = sqOf(e);
      if (i < 0) return;
      setFocus(i, false);
      if (input === 'square') { e.preventDefault(); activate(i); return; }
      if (sel >= 0 && sel !== i && !mine(i)) { e.preventDefault(); activate(i); return; }
      if (!mine(i)) { activate(i); return; }
      e.preventDefault();
      drag = { i, x: e.clientX, y: e.clientY, was: sel === i, moved: false, id: e.pointerId };
      if (sel !== i) pick(i);
      try { grid.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    }
    function onMoveP(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = pcs[drag.i];
      if (!d) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      if (!drag.moved) { drag.moved = true; d.classList.add('is-drag'); frame.classList.add('is-dragging'); }
      const r = frame.getBoundingClientRect(), size = grid.getBoundingClientRect().width / 8;
      d.style.transform = `translate(${e.clientX - r.left - size / 2}px, ${e.clientY - r.top - size / 2}px)`;
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dr = drag;
      drag = null;
      frame.classList.remove('is-dragging');
      try { grid.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
      const d = pcs[dr.i];
      if (d) d.classList.remove('is-drag');
      if (!dr.moved) { if (dr.was) select(-1); return; }
      const to = e.type === 'pointercancel' ? -1 : squareAt(e.clientX, e.clientY);
      const ms = to >= 0 ? targets(dr.i).filter((m) => m.to === to) : [];
      if (ms.length) { if (d) place(d, to); setFocus(to, false); commit(ms, true); return; }
      if (d) place(d, dr.i);
      if (to >= 0 && to !== dr.i) { illegalWhy(dr.i, to); select(-1); }
    }
    grid.addEventListener('pointerdown', onDown);
    grid.addEventListener('pointermove', onMoveP);
    grid.addEventListener('pointerup', onUp);
    grid.addEventListener('pointercancel', onUp);
    grid.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });
    grid.addEventListener('focusin', (e) => { const i = sqOf(e); if (i >= 0 && i !== focusIdx) setFocus(i, false); });
    grid.addEventListener('keydown', (e) => {
      if (promoOpen) return;
      const k = e.key;
      const [r, c] = rc(focusIdx < 0 ? 0 : focusIdx);
      const nav = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      if (nav) {
        e.preventDefault();
        const nr = Math.min(7, Math.max(0, r + nav[0])), nc = Math.min(7, Math.max(0, c + nav[1]));
        setFocus(at(nr, nc), true);
      } else if (k === 'Home' || k === 'End') {
        e.preventDefault();
        setFocus(at(r, k === 'Home' ? 0 : 7), true);
      } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        activate(focusIdx);
      } else if (k === 'Escape' && sel >= 0) {
        e.preventDefault();
        e.stopPropagation();
        select(-1);
      }
    });

    return {
      el: frame,
      // pos: the position; opts: { last, anim, captured, arrows, highlight, marks }
      show(p, opts) {
        const x = opts || {};
        pos = p;
        moves = R.legal(p);
        sel = -1;
        decor = { last: x.last || null, highlight: x.highlight, marks: x.marks };
        let anim = x.anim || null;
        if (anim && anim.castle) {
          const home = anim.from;
          anim = Object.assign({}, anim, anim.castle === 'K' ? { rookFrom: home + 3, rookTo: home + 1 } : { rookFrom: home - 4, rookTo: home - 1 });
        }
        drawPieces(anim, x.captured);
        drawArrows(x.arrows);
        paint();
        if (focusIdx < 0) setFocus(p.b.indexOf(p.turn === 'w' ? 'K' : 'k'), false);
      },
      marks(m) { decor.marks = m; paint(); },
      input(mode) { input = mode || null; if (!input) sel = -1; if (promoOpen && !input) { promoOpen = false; promo.hidden = true; } paint(); },
      say(s) { live.textContent = ''; setTimeout(() => { live.textContent = s; }, 30); },
      focus() { if (focusIdx >= 0) sqs[focusIdx].focus({ preventScroll: true }); },
      destroy() { drag = null; layer.textContent = ''; }
    };
  }

  // "White knight from g1 to f3." for the screen reader
  const spoken = (t, p, m) => fill('{piece} from {from} to {to}.', { piece: t(NAMES[m.piece]), from: R.sqName(m.from), to: R.sqName(m.to) });
  function statusLine(t, p) {
    const st = R.status(p), w = p.turn === 'w';
    if (st === 'checkmate') return t(w ? 'Checkmate. Black wins.' : 'Checkmate. White wins.');
    if (st === 'stalemate') return t('Stalemate: a draw.');
    if (st === 'material') return t('A draw: neither side can checkmate.');
    if (st === 'check') return t(w ? 'White is in check.' : 'Black is in check.');
    return t(w ? 'White to move.' : 'Black to move.');
  }
  const capturedBy = (p, m) => (m.ep ? { piece: m.cap, sq: m.to + (p.turn === 'w' ? -8 : 8) } : m.cap ? { piece: p.b[m.to], sq: m.to } : null);

  function button(cls, label, ico, text) {
    const b = el('button', 'chs__btn ' + cls, { type: 'button', title: label, 'aria-label': label });
    b.innerHTML = icon(ico) + (text ? `<span>${esc(text)}</span>` : '');
    return b;
  }

  function failedHere(host, ctx) {
    host.classList.add('is-failed');
    host.textContent = ctx.t('This chess board couldn’t be shown here.');
    return null;
  }

  /* ------------------------------------------------------------------
     A block: the position after the setup, a line to play through, and
     the learner's own moves from any point of it.
  ------------------------------------------------------------------ */
  function block(host, spec, ctx) {
    const s = normed(spec);
    if (!s) return failedHere(host, ctx);
    const t = ctx.t;
    const first = R.parseFEN(s.fen);
    const setupStart = R.parseFEN(s.start);
    const setupLast = lastOf(setupStart, s.setup);

    const root = el('div', 'chs chs--block');
    const board = makeBoard({ orientation: s.orientation, ctx, onMove: (m, dragged) => mine(m, dragged), onNote: (n) => flash(n) });
    const status = el('p', 'chs__status');
    const bar = el('div', 'chs__bar');
    const bStart = button('chs__btn--start', t('Back to the start'), 'start');
    const bBack = button('chs__btn--back', t('Back one move'), 'back');
    const bPlay = button('chs__btn--play', t('Play'), 'play');
    const bFwd = button('chs__btn--fwd', t('Next move'), 'fwd');
    const bReset = button('chs__btn--reset', t('Reset'), 'reset', t('Reset'));
    bar.append(bStart, bBack, bPlay, bFwd, bReset);
    const list = el('ol', 'chs__moves', { 'aria-label': t('Moves') });
    root.append(board.el, status, bar, list);
    host.textContent = '';
    host.appendChild(root);

    let line = [], posns = [first], sans = [], own = -1, ply = 0, timer = null, playing = false, noteTimer = null;

    // the line from the first position: its moves, the positions they reach, their SAN
    function setLine(ucis, from) {
      line = line.slice(0, from);
      posns = posns.slice(0, from + 1);
      sans = sans.slice(0, from);
      for (let k = from; k < ucis.length; k++) {
        const p = posns[k], m = R.parseMove(p, ucis[k]);
        if (!m) break;
        line.push(m);
        sans.push(R.san(p, m));
        posns.push(R.play(p, m));
      }
    }
    setLine(s.moves, 0);

    // the board at the current move, then the rest
    function render(anim) {
      const atStart = ply === 0;
      board.show(posns[ply], {
        last: atStart ? setupLast : line[ply - 1],
        anim: anim || null,
        captured: anim && anim.forward ? capturedBy(posns[ply - 1], line[ply - 1]) : null,
        arrows: atStart ? s.arrows : null,
        highlight: atStart ? s.highlight : null
      });
      ui();
    }
    // the controls, the status line and the move list (the board is left as it is, mid-slide or not)
    function ui() {
      const p = posns[ply];
      board.input(s.play && !playing ? 'move' : null);
      const hint = ply === 0 && s.play && !playing && own < 0 ? ' ' + t(line.length ? 'Press Play to watch, or move a piece yourself.' : 'Move the pieces to try it yourself.') : '';
      status.textContent = statusLine(t, p) + hint;
      bStart.disabled = ply === 0;
      bBack.disabled = ply === 0;
      bFwd.disabled = ply >= line.length;
      bPlay.disabled = !line.length;
      bPlay.hidden = !s.moves.length; // a board with no line of its own: nothing to play
      bReset.disabled = own < 0 && ply === 0;
      bPlay.innerHTML = icon(playing ? 'pause' : 'play');
      const pl = t(playing ? 'Pause' : 'Play');
      bPlay.title = pl;
      bPlay.setAttribute('aria-label', pl);
      moveList();
    }

    function moveList() {
      list.textContent = '';
      const show = s.setup.length || line.length;
      list.hidden = !show;
      if (!show) return;
      if (s.setup.length) {
        const li = el('li', 'chs__setup');
        let p = setupStart;
        const toks = [];
        s.setup.forEach((u, k) => {
          const m = R.parseMove(p, u);
          const num = p.turn === 'w' ? `${p.full}. ` : k === 0 ? `${p.full}… ` : '';
          toks.push(num + R.san(p, m));
          p = R.play(p, m);
        });
        li.textContent = (toks.length > 10 ? '… ' + toks.slice(-8).join(' ') : toks.join(' '));
        list.appendChild(li);
      }
      line.forEach((m, k) => {
        const p = posns[k];
        const li = el('li', 'chs__ply');
        if (p.turn === 'w' || k === 0) li.appendChild(Object.assign(el('span', 'chs__num'), { textContent: p.turn === 'w' ? `${p.full}.` : `${p.full}…` }));
        const b = el('button', 'chs__mv' + (k + 1 === ply ? ' is-current' : '') + (own >= 0 && k >= own ? ' is-own' : ''), { type: 'button' });
        b.textContent = sans[k];
        if (k + 1 === ply) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', () => { stop(); go(k + 1); });
        li.appendChild(b);
        list.appendChild(li);
      });
      const cur = list.querySelector('.is-current');
      if (cur && list.scrollHeight > list.clientHeight) list.scrollTop = Math.max(0, cur.offsetTop - list.clientHeight / 2);
    }

    function go(k, animate) {
      k = Math.max(0, Math.min(line.length, k));
      if (k === ply) { render(); return; }
      let anim = null;
      if (animate !== false && k === ply + 1) anim = Object.assign({ forward: true }, line[ply]);
      else if (animate !== false && k === ply - 1) anim = { from: line[k].to, to: line[k].from, castle: '' };
      ply = k;
      render(anim);
      if (anim && anim.forward) board.say(spoken(t, posns[ply - 1], line[ply - 1]) + ' ' + statusLine(t, posns[ply]));
    }

    function stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (playing) { playing = false; ui(); }
    }
    function tick() {
      timer = null;
      if (ply >= line.length) { stop(); return; }
      go(ply + 1);
      if (ply >= line.length) { playing = false; ui(); } else timer = setTimeout(tick, 1100);
    }
    function play() {
      if (!line.length) return;
      playing = true;
      if (ply >= line.length) { ply = 0; render(); timer = setTimeout(tick, 700); return; }
      ui();
      timer = setTimeout(tick, 300);
    }

    // the learner moved a piece: along the line if it is its next move, else their own line from here
    function mine(m, dragged) {
      stop();
      if (ply < line.length && R.uci(line[ply]) === R.uci(m)) { go(ply + 1, !dragged); return; }
      const before = posns[ply];
      if (own < 0 || own > ply) own = ply;
      setLine([...line.slice(0, ply).map(R.uci), R.uci(m)], ply);
      ply += 1;
      render(dragged ? null : Object.assign({ forward: true }, m));
      board.say(spoken(t, before, m) + ' ' + statusLine(t, posns[ply]));
    }

    function flash(n) {
      status.textContent = n;
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { noteTimer = null; status.textContent = statusLine(t, posns[ply]); }, 2600);
    }

    bStart.addEventListener('click', () => { stop(); go(0, false); });
    bBack.addEventListener('click', () => { stop(); go(ply - 1); });
    bFwd.addEventListener('click', () => { stop(); go(ply + 1); });
    bPlay.addEventListener('click', () => (playing ? stop() : play()));
    bReset.addEventListener('click', () => { stop(); own = -1; line = []; posns = [first]; sans = []; setLine(s.moves, 0); ply = 0; render(); });

    render();
    return {
      destroy() { if (timer) clearTimeout(timer); if (noteTimer) clearTimeout(noteTimer); board.destroy(); host.textContent = ''; }
    };
  }

  /* ------------------------------------------------------------------
     A task: the learner plays from the position (or taps squares); the
     board answers in a line, and defends in a mate.
  ------------------------------------------------------------------ */
  function task(host, spec, goal, ctx) {
    const n = normed(spec, goal);
    if (!n) return failedHere(host, ctx);
    const t = ctx.t, S = n.spec, G = n.goal;
    const start = R.parseFEN(S.fen);
    const me = start.turn;
    const squares = G.type === 'square';
    const setupLast = lastOf(R.parseFEN(S.start), S.setup);

    const root = el('div', 'chs chs--task');
    const board = makeBoard({ orientation: S.orientation, ctx, onMove: (m, dragged) => learner(m, dragged), onSquare: (sq) => tap(sq), onNote: (x) => flash(x) });
    const status = el('p', 'chs__status');
    const bar = el('div', 'chs__bar');
    const bUndo = squares ? button('chs__btn--clear', t('Clear'), 'reset', t('Clear')) : button('chs__btn--undo', t('Take back'), 'undo', t('Take back'));
    bar.appendChild(bUndo);
    root.append(board.el, status, bar);
    host.textContent = '';
    host.appendChild(root);
    if (!host.hasAttribute('tabindex')) host.tabIndex = -1;
    const onHostFocus = (e) => { if (e.target === host) board.focus(); };
    host.addEventListener('focus', onHostFocus);

    let played = [], posns = [start], moves = [], marks = new Set(), locked = false, busy = false, revealed = false;
    const timers = new Set();
    let noteTimer = null;
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
    const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); busy = false; };
    const cur = () => posns[posns.length - 1];
    const learnerCount = () => Math.ceil(played.length / 2);

    // may the learner move now?
    function open() {
      if (locked || revealed || busy || squares) return false;
      const p = cur();
      if (p.turn !== me || !R.legal(p).length) return false;
      if (G.type === 'move') return played.length === 0;
      if (G.type === 'line') return played.length < G.moves.length && played.every((u, k) => u === G.moves[k]);
      return learnerCount() < G.n;
    }

    function message() {
      if (revealed) return t('The answer, played on the board.');
      if (squares) return marks.size ? fill('{n} chosen. Tap one again to take it back.', { n: marks.size }) : t('Tap each square, then press Check.');
      if (busy) return '';
      if (!played.length) return t(me === 'w' ? 'White to play: make your move.' : 'Black to play: make your move.');
      if (open()) return t('Your move.');
      const st = R.status(cur());
      if (st === 'checkmate') return t('Checkmate.') + ' ' + t('Press Check.');
      return t('Press Check, or take the move back.');
    }

    function render(anim, captured) {
      const p = cur();
      const marksOut = squares ? { mark: marks } : undefined;
      board.show(p, {
        last: moves.length ? moves[moves.length - 1] : setupLast,
        anim, captured,
        arrows: played.length || revealed ? null : S.arrows,
        highlight: played.length || revealed ? null : S.highlight,
        marks: marksOut
      });
      board.input(squares ? (locked || revealed ? null : 'square') : open() ? 'move' : null);
      status.textContent = message();
      bUndo.disabled = locked || revealed || busy || (squares ? !marks.size : !played.length);
    }

    function push(m) {
      const p = cur();
      played.push(R.uci(m));
      moves.push(m);
      posns.push(R.play(p, m));
      return p;
    }

    function learner(m, dragged) {
      if (!open()) return;
      const before = push(m);
      // the board's answer, if it has one
      let reply = null;
      const k = played.length - 1;
      if (G.type === 'line' && played[k] === G.moves[k] && k + 1 < G.moves.length) reply = G.moves[k + 1];
      if (G.type === 'mate' && learnerCount() < G.n && R.legal(cur()).length) { const r = R.defend(cur(), G.n - learnerCount()); reply = r ? R.uci(r) : null; }
      busy = Boolean(reply);
      render(dragged ? null : m, dragged ? null : capturedBy(before, m));
      board.say(spoken(t, before, m) + ' ' + statusLine(t, cur()));
      ctx.onChange(value());
      if (!reply) return;
      later(() => {
        busy = false;
        const p = cur(), r = R.parseMove(p, reply);
        if (!r) { render(); return; }
        push(r);
        render(r, capturedBy(p, r));
        board.say(spoken(t, p, r) + ' ' + statusLine(t, cur()));
        ctx.onChange(value());
      }, ctx.reduce ? 250 : 650);
    }

    function tap(sq) {
      if (locked || revealed) return;
      if (marks.has(sq)) marks.delete(sq); else marks.add(sq);
      render();
      ctx.onChange(value());
    }

    function undo() {
      if (locked || revealed || busy) return;
      if (squares) { marks.clear(); render(); ctx.onChange(value()); return; }
      if (!played.length) return;
      // back to before the learner's last move (with the board's answer to it)
      let cut = played.length - 1;
      if (cut % 2 === 1) cut -= 1;
      played = played.slice(0, cut);
      moves = moves.slice(0, cut);
      posns = posns.slice(0, cut + 1);
      render();
      ctx.onChange(value());
      board.focus();
    }
    bUndo.addEventListener('click', undo);

    function flash(x) {
      status.textContent = x;
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { noteTimer = null; status.textContent = message(); }, 2600);
    }

    function value() {
      if (squares) return marks.size ? { squares: [...marks].sort() } : null;
      return played.length ? { moves: played.slice() } : null;
    }

    function reset() {
      clearTimers();
      played = []; moves = []; posns = [start]; marks = new Set(); revealed = false; locked = false;
      render();
    }

    function reveal() {
      clearTimers();
      revealed = true;
      if (squares) {
        const want = new Set(G.squares);
        board.show(start, { last: setupLast, marks: { good: want, bad: new Set([...marks].filter((x) => !want.has(x))) } });
        board.input(null);
        status.textContent = message();
        bUndo.disabled = true;
        return;
      }
      const sol = G.type === 'move' ? [G.best[0]] : G.type === 'line' ? G.moves : G.line;
      played = []; moves = []; posns = [start];
      render();
      const stepAt = (k) => {
        const p = cur(), m = R.parseMove(p, sol[k]);
        if (!m) return;
        push(m);
        render(m, capturedBy(p, m));
        if (k + 1 < sol.length) later(() => stepAt(k + 1), ctx.reduce ? 300 : 900);
      };
      if (sol.length) later(() => stepAt(0), ctx.reduce ? 0 : 350);
    }

    render();
    return {
      value,
      reset,
      reveal,
      lock(on) { locked = Boolean(on); render(); },
      destroy() { clearTimers(); if (noteTimer) clearTimeout(noteTimer); host.removeEventListener('focus', onHostFocus); board.destroy(); host.textContent = ''; }
    };
  }

  /* ------------------------------------------------------------------
     Checking, and the attempt and answer in words
  ------------------------------------------------------------------ */
  // the learner's moves replayed from the task's position: the positions, or null if any is not legal
  function replay(start, ucis) {
    if (!Array.isArray(ucis) || ucis.length > 40) return null;
    const ps = [start];
    for (const u of ucis) {
      const p = ps[ps.length - 1], m = typeof u === 'string' ? R.parseMove(p, u) : null;
      if (!m) return null;
      ps.push(R.play(p, m));
    }
    return ps;
  }

  function check(goal, value, spec) {
    const n = normed(spec, goal);
    if (!n || !value || typeof value !== 'object') return { correct: false, invalid: true };
    const G = n.goal, start = R.parseFEN(n.spec.fen);
    const keepGoing = { correct: false, invalid: true, note: tr('Keep going: it’s still your move.') };
    if (G.type === 'square') {
      const got = Array.isArray(value.squares) ? value.squares.filter((x) => typeof x === 'string' && R.sqIndex(x) >= 0) : [];
      if (!got.length) return { correct: false, invalid: true };
      const want = new Set(G.squares), mineSet = new Set(got);
      const right = [...mineSet].filter((x) => want.has(x)).length, wrong = mineSet.size - right;
      if (!wrong && right === want.size) return { correct: true };
      return { correct: false, note: wrong ? tr('Not every square you chose is right.') : fill('You found {n} of the {total} squares.', { n: right, total: want.size }) };
    }
    const ps = replay(start, value.moves);
    if (!ps || ps.length < 2) return { correct: false, invalid: true };
    const ucis = value.moves;
    const end = ps[ps.length - 1], st = R.status(end);
    const mateBy = (p) => R.status(p) === 'checkmate' && p.turn !== start.turn;
    if (G.type === 'move') {
      const ok = G.best.includes(ucis[0]) || mateBy(ps[1]);
      return { correct: ok };
    }
    if (G.type === 'line') {
      for (let k = 0; k < ucis.length; k += 2) {
        if (ucis[k] === G.moves[k]) continue;
        // the last move of the line: another move that mates is as good
        if (k === G.moves.length - 1 && mateBy(ps[k + 1])) return { correct: true };
        return { correct: false };
      }
      if (ucis.length >= G.moves.length) return { correct: true };
      return keepGoing;
    }
    // mate in n
    const mineCount = Math.ceil(ucis.length / 2);
    if (mateBy(end)) return { correct: mineCount <= G.n };
    if (st === 'stalemate') return { correct: false, note: tr('That’s stalemate, not checkmate: a draw.') };
    if (mineCount < G.n && st !== 'checkmate') return keepGoing;
    return { correct: false, note: tr('That isn’t checkmate: the king can still get out.') };
  }

  function describe(value, spec) {
    if (!value || typeof value !== 'object') return '';
    if (Array.isArray(value.squares)) return value.squares.filter((x) => typeof x === 'string' && R.sqIndex(x) >= 0).join(', ');
    const s = normed(spec); // a task's spec reads as a board with no line of its own
    if (!s || !Array.isArray(value.moves)) return '';
    return R.sanLine(R.parseFEN(s.fen), value.moves.filter((u) => typeof u === 'string'));
  }

  function answer(goal, spec) {
    const n = normed(spec, goal);
    if (!n) return '';
    const G = n.goal, start = R.parseFEN(n.spec.fen);
    if (G.type === 'square') return G.squares.join(', ');
    if (G.type === 'move') return G.best.map((u) => R.san(start, R.parseMove(start, u))).join(' ' + tr('or') + ' ');
    return R.sanLine(start, G.type === 'line' ? G.moves : G.line);
  }

  /* ------------------------------------------------------------------
     A still picture, for the book, print and EPUB: the position after the
     setup, its arrows and marked squares, and the line written under it.
  ------------------------------------------------------------------ */
  const STILL = { light: '#efe2c4', dark: '#b48c5c', last: 'rgba(214,165,84,.55)', hl: 'rgba(61,106,44,.38)', edge: '#6f4f2c' };
  function still(spec, goal) {
    if (!R) return '';
    const n = goal ? normed(spec, goal) : null;
    const s = n ? n.spec : normed(spec);
    if (!s) return '';
    const pos = R.parseFEN(s.fen);
    const flip = s.orientation === 'black';
    const Q = 40, M = 18, W = M + Q * 8 + 6;
    const rc = (i) => (flip ? [i >> 3, 7 - (i & 7)] : [7 - (i >> 3), i & 7]);
    const xy = (i) => { const [r, c] = rc(i); return [M + c * Q, 4 + r * Q]; };
    const last = lastOf(R.parseFEN(s.start), s.setup);
    let body = `<rect x="${M - 3}" y="1" width="${Q * 8 + 6}" height="${Q * 8 + 6}" fill="${STILL.edge}"/>`;
    for (let i = 0; i < 64; i++) {
      const [x, y] = xy(i);
      body += `<rect x="${x}" y="${y}" width="${Q}" height="${Q}" fill="${((i >> 3) + (i & 7)) % 2 ? STILL.light : STILL.dark}"/>`;
      if (last && (last.from === i || last.to === i)) body += `<rect x="${x}" y="${y}" width="${Q}" height="${Q}" fill="${STILL.last}"/>`;
      if ((s.highlight || []).includes(R.sqName(i))) body += `<rect x="${x}" y="${y}" width="${Q}" height="${Q}" fill="${STILL.hl}"/>`;
    }
    for (let k = 0; k < 8; k++) {
      const file = flip ? R.FILES[7 - k] : R.FILES[k], rank = flip ? k + 1 : 8 - k;
      body += `<text x="${M + k * Q + Q / 2}" y="${4 + Q * 8 + 15}" text-anchor="middle">${file}</text><text x="${M / 2 - 1}" y="${4 + k * Q + Q / 2 + 4}" text-anchor="middle">${rank}</text>`;
    }
    for (let i = 0; i < 64; i++) {
      const p = pos.b[i];
      if (!p) continue;
      const [x, y] = xy(i);
      body += `<g transform="translate(${x + 2} ${y + 2}) scale(${(Q - 4) / 100})">${pieceInner(p)}</g>`;
    }
    (s.arrows || []).forEach(([a, b, c]) => {
      const [x1, y1] = xy(R.sqIndex(a)), [x2, y2] = xy(R.sqIndex(b));
      const ax = x1 + Q / 2, ay = y1 + Q / 2, bx0 = x2 + Q / 2, by0 = y2 + Q / 2;
      const len = Math.hypot(bx0 - ax, by0 - ay), ux = (bx0 - ax) / len, uy = (by0 - ay) / len;
      const ex = bx0 - ux * 5, ey = by0 - uy * 5, hx = ex - ux * 14, hy = ey - uy * 14;
      const col = ARROW[c] || ARROW.g;
      body += `<g opacity=".8"><line x1="${(ax + ux * 8).toFixed(1)}" y1="${(ay + uy * 8).toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="${col}" stroke-width="6" stroke-linecap="round"/><polygon points="${ex.toFixed(1)},${ey.toFixed(1)} ${(hx - uy * 10).toFixed(1)},${(hy + ux * 10).toFixed(1)} ${(hx + uy * 10).toFixed(1)},${(hy - ux * 10).toFixed(1)}" fill="${col}"/></g>`;
    });
    // the line under the board, wrapped; or whose move it is
    const text = s.moves && s.moves.length ? R.sanLine(pos, s.moves) : tr(pos.turn === 'w' ? 'White to move.' : 'Black to move.');
    const rows = [];
    let row = '';
    text.split(' ').forEach((w) => { if ((row + ' ' + w).trim().length > 44) { rows.push(row.trim()); row = w; } else row += ' ' + w; });
    if (row.trim()) rows.push(row.trim());
    const shown = rows.slice(0, 6);
    if (rows.length > 6) shown[5] += ' …';
    const top = 4 + Q * 8 + 22;
    const lines = shown.map((r, k) => `<text x="${W / 2}" y="${top + 18 + k * 18}" text-anchor="middle" font-size="14" fill="#2b1d11">${esc(r)}</text>`).join('');
    const H = top + 10 + shown.length * 18;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(tr('Chess board'))}" font-family="Georgia, 'Times New Roman', serif" font-size="11" fill="#5b4730">${body}${lines}</svg>`;
  }

  // block and task wait for the rules if the core ever calls them early
  function whenReady(make) {
    if (R) return make();
    let h = null, gone = false;
    const queue = [];
    ready.then(() => { if (gone) return; h = make(); queue.forEach(([k, a]) => h && h[k] && h[k](...a)); }).catch(() => {});
    const call = (k) => (...a) => { if (k === 'destroy') gone = true; if (h) { if (h[k]) h[k](...a); } else queue.push([k, a]); };
    return { value: () => (h && h.value ? h.value() : null), reset: call('reset'), reveal: call('reveal'), lock: call('lock'), destroy: call('destroy') };
  }

  P.widgets.register('chess', {
    ready,
    block: (host, spec, ctx) => whenReady(() => block(host, spec, ctx)),
    task: (host, spec, goal, ctx) => whenReady(() => task(host, spec, goal, ctx)),
    check: (goal, value, spec) => (R ? check(goal, value, spec) : { correct: false, invalid: true }),
    describe: (value, spec) => (R ? describe(value, spec) : ''),
    answer: (goal, spec) => (R ? answer(goal, spec) : ''),
    still: (spec, goal) => (R ? still(spec, goal) : '')
  });
})();
