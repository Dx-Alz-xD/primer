/* =====================================================================
   "arrange": cards the learner taps into place (server/widgets/arrange.mjs).
     order  tap the cards in order; they fill the places 1, 2, 3...
     match  tap a card, then the thing it goes with
     group  tap a card, then the group it belongs in
   Tapping works the same with a finger, a mouse or the keyboard (every
   card and place is a button). The right answer is the spec itself; the
   cards start shuffled, the same way each time, never already right.
   A task's value: { at: [place of each card, or null] }, plain JSON.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, v) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

  /* ---------------- the cards and places of a spec ---------------- */

  // cards: what gets moved; places: where they go; right[i]: the place card i belongs in
  function model(spec) {
    if (spec.mode === 'order') {
      return { mode: 'order', cards: spec.items.slice(), places: spec.items.map((_, i) => String(i + 1)), one: true, right: spec.items.map((_, i) => i) };
    }
    if (spec.mode === 'match') {
      return { mode: 'match', cards: spec.pairs.map((p) => p[1]), places: spec.pairs.map((p) => p[0]), one: true, right: spec.pairs.map((_, i) => i) };
    }
    const cards = [], right = [];
    spec.groups.forEach((g, gi) => g.items.forEach((it) => { cards.push(it); right.push(gi); }));
    return { mode: 'group', cards, places: spec.groups.map((g) => g.name), one: false, right };
  }

  // the order the cards start in: shuffled from their own words, so it is the same each time
  function shuffled(words) {
    let h = 2166136261;
    for (const ch of words.join('|')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    let s = h || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const idx = words.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    // never already right, and never simply backwards
    if (idx.length > 2 && idx.every((v, i) => v === idx.length - 1 - i)) [idx[0], idx[1]] = [idx[1], idx[0]];
    if (idx.length > 1 && idx.every((v, i) => v === i)) idx.push(idx.shift());
    return idx;
  }

  const validAt = (m, at) => Array.isArray(at) && at.length === m.cards.length
    && at.every((p) => p === null || (Number.isInteger(p) && p >= 0 && p < m.places.length));

  /* ---------------- drawing and tapping ---------------- */

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function mount(host, spec, ctx, asBlock) {
    const m = model(spec);
    const n = m.cards.length;
    const start = shuffled(m.cards);
    let at = new Array(n).fill(null); // place of each card
    let was = at.slice();              // where each card was at the last drawing: a card that moved arrives softly
    let picked = null;                 // the card tapped and waiting for a place
    let locked = false;
    let marks = null;                  // after "Check" in a block: which cards are right

    host.textContent = '';
    const root = el('div', `arr arr--${m.mode}`);
    root.appendChild(el('p', 'arr__how', m.mode === 'order'
      ? t('Tap the cards in order, first to last. Tap a placed card to take it back.')
      : m.mode === 'match' ? t('Tap a card, then tap what it goes with.') : t('Tap a card, then tap the group it belongs in.')));
    const placesEl = el(m.mode === 'order' ? 'ol' : 'div', 'arr__places');
    const pool = el('div', 'arr__pool');
    pool.setAttribute('role', 'group');
    pool.setAttribute('aria-label', t('Cards'));
    root.append(placesEl, pool);

    const cardBtn = (i) => {
      const b = el('button', 'arr__card', m.cards[i]);
      b.type = 'button';
      b.dataset.card = String(i);
      if (picked === i) { b.classList.add('is-picked'); b.setAttribute('aria-pressed', 'true'); } else b.setAttribute('aria-pressed', 'false');
      if (marks) b.classList.add(marks[i] ? 'is-right' : 'is-wrong');
      if (was[i] !== at[i]) b.classList.add('is-moved');
      b.disabled = locked;
      return b;
    };

    function draw() {
      placesEl.textContent = '';
      m.places.forEach((name, p) => {
        const slot = el(m.mode === 'order' ? 'li' : 'div', 'arr__place');
        slot.dataset.place = String(p);
        const label = el('span', 'arr__name', name);
        if (m.mode === 'order') label.setAttribute('aria-hidden', 'true');
        const drop = el('div', 'arr__drop');
        const inHere = at.map((q, i) => (q === p ? i : -1)).filter((i) => i >= 0);
        inHere.forEach((i) => drop.appendChild(cardBtn(i)));
        if (!inHere.length) drop.appendChild(el('span', 'arr__empty', m.mode === 'order' ? '' : '·'));
        // the place itself is tapped to put the picked card there
        const go = el('button', 'arr__go');
        go.type = 'button';
        go.dataset.go = String(p);
        go.disabled = locked;
        go.setAttribute('aria-label', m.mode === 'order' ? fill('Put the card in place {n}', { n: p + 1 }) : fill('Put it with: {name}', { name }));
        slot.classList.toggle('is-ready', picked !== null && !locked);
        slot.append(label, drop, go);
        placesEl.appendChild(slot);
      });
      pool.textContent = '';
      const left = start.filter((i) => at[i] === null);
      left.forEach((i) => pool.appendChild(cardBtn(i)));
      pool.classList.toggle('is-empty', !left.length);
      pool.classList.toggle('is-ready', picked !== null && at[picked] !== null && !locked);
      if (!left.length) pool.appendChild(el('span', 'arr__done', t('Every card is placed.')));
      was = at.slice();
    }

    const changed = () => { marks = null; draw(); if (feedback) feedback.textContent = ''; ctx.onChange(value()); };
    const value = () => (at.some((p) => p !== null) ? { at: at.slice() } : null);

    function put(i, p) {
      if (m.one) {
        const there = at.indexOf(p);
        if (there >= 0 && there !== i) at[there] = at[i]; // the card already there swaps places (or goes back)
      }
      at[i] = p;
    }

    root.addEventListener('click', (e) => {
      if (locked) return;
      const c = e.target.closest('[data-card]');
      const go = e.target.closest('[data-go]');
      const slot = !c && !go && e.target.closest('.arr__place');
      if (c) {
        const i = Number(c.dataset.card);
        if (m.mode === 'order') {
          // order: a card from the pile fills the first empty place; a placed card goes back
          if (at[i] === null) { const p = m.places.findIndex((_, q) => !at.includes(q)); if (p >= 0) at[i] = p; } else at[i] = null;
          picked = null;
        } else if (picked === i) picked = null;
        else if (picked !== null && at[i] !== null && at[picked] !== at[i]) { put(picked, at[i]); picked = null; } // tapped a placed card: put the picked one there
        else picked = i;
        changed();
        focusCard(i);
        return;
      }
      const p = go ? Number(go.dataset.go) : slot ? Number(slot.dataset.place) : -1;
      if (p >= 0 && picked !== null) {
        const i = picked;
        put(i, p);
        picked = null;
        changed();
        focusCard(i);
      } else if (p >= 0 && m.mode === 'order') {
        const i = at.indexOf(p);
        if (i >= 0) { at[i] = null; changed(); }
      } else if (e.target.closest('.arr__pool') && picked !== null && at[picked] !== null) {
        at[picked] = null; // a placed card taken back to the pile
        const i = picked;
        picked = null;
        changed();
        focusCard(i);
      }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && picked !== null) { picked = null; draw(); }
    });
    const focusCard = (i) => { const b = root.querySelector(`[data-card="${i}"]`); if (b) b.focus({ preventScroll: true }); };

    // a block checks itself; a task is checked by the question it is in
    let feedback = null;
    if (asBlock) {
      const bar = el('div', 'arr__actions');
      const check = el('button', 'btn btn--small arr__check', t('Check'));
      const again = el('button', 'arr__link', t('Start again'));
      const show = el('button', 'arr__link', t('Show me'));
      [check, again, show].forEach((b) => { b.type = 'button'; });
      feedback = el('p', 'arr__feedback');
      feedback.setAttribute('role', 'status');
      bar.append(check, again, show);
      root.append(bar, feedback);
      check.addEventListener('click', () => {
        if (at.some((p) => p === null)) { feedback.textContent = t('Place every card first.'); return; }
        marks = at.map((p, i) => p === m.right[i]);
        const good = marks.filter(Boolean).length;
        draw();
        feedback.textContent = good === n ? t('All right! Well done.') : fill(lineFor(m.mode), { n: good, total: n });
        feedback.classList.toggle('is-right', good === n);
      });
      again.addEventListener('click', () => { at = new Array(n).fill(null); picked = null; changed(); });
      show.addEventListener('click', () => { at = m.right.slice(); picked = null; marks = null; draw(); feedback.textContent = t('This is the right way.'); feedback.classList.add('is-right'); });
    }

    host.appendChild(root);
    draw();

    return {
      value,
      reset() { at = new Array(n).fill(null); picked = null; marks = null; draw(); },
      reveal() { at = m.right.slice(); picked = null; marks = null; root.classList.add('is-done'); draw(); },
      lock(on) { locked = Boolean(on); picked = null; draw(); },
      destroy() { host.textContent = ''; }
    };
  }

  const lineFor = (mode) => (mode === 'match' ? '{n} of {total} pairs are right.' : mode === 'group' ? '{n} of {total} cards are in the right group.' : '{n} of {total} are in the right place.');

  /* ---------------- words: what was done, and the right answer ---------------- */

  function inWords(m, at) {
    if (m.mode === 'order') {
      return m.places.map((_, p) => { const i = at.indexOf(p); return i >= 0 ? m.cards[i] : '…'; }).join(' → ');
    }
    if (m.mode === 'match') {
      return m.places.map((name, p) => { const i = at.indexOf(p); return `${name} – ${i >= 0 ? m.cards[i] : '…'}`; }).join('; ');
    }
    return m.places.map((name, p) => `${name}: ${m.cards.filter((_, i) => at[i] === p).join(', ') || '…'}`).join('; ');
  }

  /* ---------------- the still picture (book, print, EPUB) ---------------- */

  function still(spec) {
    const m = model(spec);
    const esc = P.esc;
    const order = shuffled(m.cards);
    if (m.mode === 'match') {
      const letters = 'abcdef';
      return `<div class="arr-still arr-still--match"><ol class="arr-still__left">${m.places.map((x) => `<li>${esc(x)} <span class="arr-still__blank">____</span></li>`).join('')}</ol>`
        + `<ul class="arr-still__right">${order.map((i, k) => `<li>(${letters[k]}) ${esc(m.cards[i])}</li>`).join('')}</ul></div>`;
    }
    const cards = `<p class="arr-still__cards"><strong>${esc(t('Cards'))}:</strong> ${order.map((i) => esc(m.cards[i])).join(' · ')}</p>`;
    if (m.mode === 'order') {
      return `<div class="arr-still arr-still--order">${cards}<ol class="arr-still__slots">${m.places.map(() => '<li><span class="arr-still__blank">________________</span></li>').join('')}</ol></div>`;
    }
    return `<div class="arr-still arr-still--group">${cards}<ul class="arr-still__groups">${m.places.map((x) => `<li><strong>${esc(x)}:</strong> <span class="arr-still__blank">________________</span></li>`).join('')}</ul></div>`;
  }

  P.widgets.register('arrange', {
    block: (host, spec, ctx) => mount(host, spec, ctx, true),
    task: (host, spec, goal, ctx) => mount(host, spec, ctx, false),
    check(goal, value, spec) {
      const m = model(spec);
      const at = value && value.at;
      if (!validAt(m, at)) return { correct: false, invalid: true };
      if (at.some((p) => p === null)) return { correct: false, invalid: true, note: t('Place every card first.') };
      const good = at.filter((p, i) => p === m.right[i]).length;
      return good === m.cards.length ? { correct: true } : { correct: false, note: fill(lineFor(m.mode), { n: good, total: m.cards.length }) };
    },
    describe(value, spec) {
      const m = model(spec);
      return value && validAt(m, value.at) ? inWords(m, value.at) : '';
    },
    answer(goal, spec) {
      const m = model(spec);
      return inWords(m, m.right);
    },
    still
  });
})();
