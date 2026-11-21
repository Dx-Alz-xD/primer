/* =====================================================================
   Doubts: ask about selected text, or about a sketch on the whiteboard.
   Nothing answers yet; doubts go to P.api.askDoubt (stored locally)
   and are listed in the Doubts drawer until the tutor backend exists.

   P.initDoubts({ paper, courseId, lessonN, lessonTitle, wbToggle, bar,
                  countEl, drawerToggle, drawer })
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  const trim = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

  // Plain text without KaTeX's duplicate hidden markup: whole formulas come back as \( tex \),
  // which reads cleanly and is exactly what a tutor model wants to receive.
  function plainText(root) {
    root.querySelectorAll('.katex').forEach((k) => {
      const ann = k.querySelector('annotation[encoding="application/x-tex"]');
      if (ann) k.replaceWith(document.createTextNode(`\\(${ann.textContent.trim()}\\)`));
    });
    root.querySelectorAll('.katex-mathml').forEach((m) => m.remove());
    return root.textContent.replace(/\s+/g, ' ').trim();
  }
  const renderMath = (el) => { if (P.math) P.math(el); };

  P.initDoubts = function ({ paper, courseId, lessonN, lessonTitle, wbToggle, bar, countEl, drawerToggle, drawer, onSketchChange }) {
    const sketchChanged = () => { if (onSketchChange) onSketchChange(wb.strokes); };
    /* ================================================================
       The "Any doubt?" box
    ================================================================ */
    const box = document.createElement('div');
    box.className = 'doubt';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Ask a doubt');
    box.innerHTML = `
      <div class="doubt__context"></div>
      <label class="doubt__label" for="doubt-text">Any doubt?</label>
      <textarea class="textarea" id="doubt-text" rows="3" maxlength="1000" placeholder="What’s unclear about this part?"></textarea>
      <p class="doubt__error" role="alert"></p>
      <div class="doubt__actions">
        <button class="textlink doubt__note" type="button" data-note>Add to notebook</button>
        <button class="textlink" type="button" data-cancel>Cancel</button>
        <button class="btn btn--small" type="button" data-ask>Ask</button>
      </div>`;
    document.body.appendChild(box);
    const ta = box.querySelector('textarea');
    const errEl = box.querySelector('.doubt__error');
    const ctxEl = box.querySelector('.doubt__context');
    let current = null;

    function openBox(payload, anchor) {
      current = payload;
      ctxEl.innerHTML = payload.kind === 'drawing'
        ? `<img class="doubt__sketch" src="${esc(payload.image)}" alt="Your sketch on the notes">${payload.context ? `<p class="doubt__near">Near: “${esc(trim(payload.context, 160))}”</p>` : ''}`
        : `<blockquote class="doubt__quote">“${esc(trim(payload.quote, 280))}”</blockquote>`;
      renderMath(ctxEl);
      errEl.textContent = '';
      box.hidden = false;
      const w = box.offsetWidth;
      const vw = document.documentElement.clientWidth;
      let left = anchor.left + anchor.width / 2 - w / 2;
      left = Math.max(window.scrollX + 12, Math.min(left, window.scrollX + vw - w - 12));
      box.style.left = `${left}px`;
      box.style.top = `${anchor.bottom + 10}px`;
      const r = box.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 12) window.scrollBy({ top: r.bottom - window.innerHeight + 24, behavior: P.motion.reduce ? 'auto' : 'smooth' });
    }

    function closeBox() {
      box.hidden = true;
      current = null;
      ta.value = '';
      errEl.textContent = '';
    }

    async function ask() {
      const question = ta.value.trim();
      if (!question) {
        errEl.textContent = 'Type your question first.';
        ta.focus();
        return;
      }
      const btn = box.querySelector('[data-ask]');
      btn.disabled = true;
      let saved;
      try {
        saved = await P.api.askDoubt(Object.assign({}, current, { question, courseId, lesson: lessonN, lessonTitle }));
      } catch (err) {
        btn.disabled = false;
        errEl.textContent = err.message;
        return;
      }
      btn.disabled = false;
      closeBox();
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      P.toast(P.boot.ai ? 'Doubt saved. The tutor is writing an answer; it will appear under Doubts.' : 'Doubt saved under Doubts.');
      refreshCount();
      if (P.onDoubtAsked) P.onDoubtAsked(saved, { refresh: refreshCount });
    }

    box.querySelector('[data-cancel]').addEventListener('click', closeBox);
    if (P.voice && P.voice.micButton) P.voice.micButton(ta, box.querySelector('.doubt__actions'));
    box.querySelector('[data-note]').addEventListener('click', () => {
      if (!current || !P.notebook) return;
      const quote = current.kind === 'drawing' ? current.context : current.quote;
      P.notebook.append(`“${trim(quote || '', 600)}”` + (ta.value.trim() ? `\n${ta.value.trim()}` : ''));
      closeBox();
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    });
    box.querySelector('[data-ask]').addEventListener('click', ask);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask(); });

    /* ================================================================
       Text selection -> box
    ================================================================ */
    function selectionTarget() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      const holder = document.createElement('div');
      holder.appendChild(range.cloneContents());
      const text = plainText(holder);
      if (text.length < 2) return null;
      const node = range.commonAncestorContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el || !paper.contains(el) || el.closest('input, textarea, button, .doubt')) return null;
      const rects = range.getClientRects();
      const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return null;
      const sec = el.closest('.lsec');
      return {
        payload: { kind: 'selection', quote: text.slice(0, 1200), section: sec ? sec.querySelector('.lsec__title').textContent : '' },
        anchor: { left: rect.left + window.scrollX, bottom: rect.bottom + window.scrollY, width: rect.width }
      };
    }

    function trySelection() {
      if (wb.active) return;
      if (!box.hidden && box.contains(document.activeElement)) return; // they're typing a doubt
      const t = selectionTarget();
      if (t) openBox(t.payload, t.anchor);
    }

    document.addEventListener('mouseup', (e) => {
      if (box.contains(e.target)) return;
      setTimeout(trySelection, 0);
    });
    document.addEventListener('keyup', (e) => {
      if (e.shiftKey || e.key === 'Shift') setTimeout(trySelection, 0);
    });
    // touch: selection handles move without mouseup, so watch the selection itself
    let selTimer = 0;
    const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
    document.addEventListener('selectionchange', () => {
      if (!coarse.matches) return;
      clearTimeout(selTimer);
      selTimer = setTimeout(trySelection, 500);
    });
    document.addEventListener('pointerdown', (e) => {
      if (box.hidden || box.contains(e.target)) return;
      if (!ta.value.trim()) closeBox();
    });

    /* ================================================================
       Whiteboard: draw on the notes, then ask about the drawing
    ================================================================ */
    const TOOLS = {
      pen: { width: 2.6, alpha: 1 },
      highlighter: { width: 18, alpha: 0.32, color: '#e0a93a' },
      eraser: { width: 26, alpha: 1 }
    };
    const wb = { active: false, tool: 'pen', color: '#2b1d11', strokes: [], cur: null, askedFrom: 0, dpr: 1, ldpr: 1 };

    const canvas = document.createElement('canvas');
    canvas.className = 'wb-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    paper.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const live = document.createElement('canvas'); // viewport-sized layer for the stroke being drawn (highlighter)
    live.className = 'wb-live';
    live.setAttribute('aria-hidden', 'true');
    live.hidden = true;
    document.body.appendChild(live);
    const lctx = live.getContext('2d');

    function sizeCanvas() {
      const w = paper.offsetWidth, h = paper.offsetHeight;
      wb.dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, 1.5, 12000 / Math.max(1, h)));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const W = Math.max(1, Math.round(w * wb.dpr)), H = Math.max(1, Math.round(h * wb.dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
        redraw();
      }
    }
    let roQueued = false;
    new ResizeObserver(() => {
      if (roQueued) return;
      roQueued = true;
      requestAnimationFrame(() => { roQueued = false; sizeCanvas(); });
    }).observe(paper);
    sizeCanvas();

    function drawStroke(c, s, scale, ox, oy) {
      const T = TOOLS[s.tool];
      const p = s.pts;
      if (!p.length) return;
      c.save();
      c.setTransform(scale, 0, 0, scale, ox * scale, oy * scale);
      c.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      c.globalAlpha = T.alpha;
      c.strokeStyle = T.color || s.color;
      c.lineWidth = T.width;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(p[0][0], p[0][1]);
      if (p.length < 3) {
        for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]);
        if (p.length === 1) c.lineTo(p[0][0] + 0.01, p[0][1]);
      } else {
        for (let i = 1; i < p.length - 1; i++) {
          c.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
        }
        const l = p[p.length - 1];
        c.lineTo(l[0], l[1]);
      }
      c.stroke();
      c.restore();
    }

    function redraw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      wb.strokes.forEach((s) => drawStroke(ctx, s, wb.dpr, 0, 0));
    }

    // pen + eraser: draw the newest segment straight onto the page canvas
    function drawSegment(from) {
      const s = wb.cur;
      const T = TOOLS[s.tool];
      if (s.pts.length < 2) return;
      ctx.save();
      ctx.setTransform(wb.dpr, 0, 0, wb.dpr, 0, 0);
      ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.color;
      ctx.lineWidth = T.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const a = s.pts[Math.max(0, from)];
      ctx.moveTo(a[0], a[1]);
      for (let i = Math.max(0, from) + 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
      ctx.stroke();
      ctx.restore();
    }

    // highlighter: redraw the whole stroke on the live layer so overlaps don't darken
    function drawLive() {
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, live.width, live.height);
      const r = paper.getBoundingClientRect();
      drawStroke(lctx, wb.cur, wb.ldpr, r.left, r.top);
    }
    function sizeLive() {
      wb.ldpr = Math.min(window.devicePixelRatio || 1, 2);
      live.width = Math.round(window.innerWidth * wb.ldpr);
      live.height = Math.round(window.innerHeight * wb.ldpr);
    }

    const point = (e) => {
      const r = paper.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (!wb.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      if (!box.hidden && !ta.value.trim()) closeBox();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      wb.cur = { tool: wb.tool, color: wb.color, pts: [point(e)] };
      if (wb.tool === 'highlighter') { sizeLive(); live.hidden = false; drawLive(); }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!wb.cur) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const before = wb.cur.pts.length;
      (evs.length ? evs : [e]).forEach((ev) => wb.cur.pts.push(point(ev)));
      if (wb.cur.tool === 'highlighter') drawLive();
      else drawSegment(before - 1);
    });
    const endStroke = () => {
      if (!wb.cur) return;
      const s = wb.cur;
      wb.cur = null;
      if (s.tool === 'highlighter') {
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.clearRect(0, 0, live.width, live.height);
        live.hidden = true;
      }
      wb.strokes.push(s);
      redraw(); // repaint with smoothing
      sketchChanged();
    };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('lostpointercapture', endStroke);

    function setActive(on) {
      wb.active = on;
      paper.classList.toggle('is-drawing', on);
      document.body.classList.toggle('is-wb', on);
      bar.hidden = !on;
      wbToggle.setAttribute('aria-pressed', String(on));
      if (on) {
        sizeCanvas();
        if (!ta.value.trim()) closeBox();
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        P.toast('Draw on the notes, then press “Ask about this”.');
      }
    }
    wbToggle.addEventListener('click', () => setActive(!wb.active));

    $$('[data-tool]', bar).forEach((b) => b.addEventListener('click', () => selectTool(b.dataset.tool)));
    function selectTool(tool) {
      wb.tool = tool;
      $$('[data-tool]', bar).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tool === tool)));
    }
    $$('[data-color]', bar).forEach((b) => b.addEventListener('click', () => {
      wb.color = b.dataset.color;
      if (wb.tool !== 'pen') selectTool('pen');
      $$('[data-color]', bar).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    bar.querySelector('[data-act="undo"]').addEventListener('click', () => {
      wb.strokes.pop();
      wb.askedFrom = Math.min(wb.askedFrom, wb.strokes.length);
      redraw();
      sketchChanged();
    });
    bar.querySelector('[data-act="clear"]').addEventListener('click', () => {
      if (!wb.strokes.length) return;
      wb.strokes = [];
      wb.askedFrom = 0;
      redraw();
      sketchChanged();
    });
    bar.querySelector('[data-act="done"]').addEventListener('click', () => setActive(false));
    bar.querySelector('[data-act="ask"]').addEventListener('click', askAboutDrawing);

    function askAboutDrawing() {
      // the strokes drawn since the last question (or all of them)
      let set = wb.strokes.slice(wb.askedFrom).filter((s) => s.tool !== 'eraser');
      if (!set.length) set = wb.strokes.filter((s) => s.tool !== 'eraser');
      if (!set.length) { P.toast('Draw on the notes first, then ask about it.'); return; }

      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      set.forEach((s) => {
        const pad = TOOLS[s.tool].width / 2;
        s.pts.forEach(([x, y]) => {
          x0 = Math.min(x0, x - pad); y0 = Math.min(y0, y - pad);
          x1 = Math.max(x1, x + pad); y1 = Math.max(y1, y + pad);
        });
      });
      const margin = 28;
      x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin);
      x1 = Math.min(paper.offsetWidth, x1 + margin); y1 = Math.min(paper.offsetHeight, y1 + margin);
      const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);

      // snapshot of the ink on a parchment background
      const scale = Math.min(1, 560 / w, 400 / h);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(w * scale));
      out.height = Math.max(1, Math.round(h * scale));
      const o = out.getContext('2d');
      o.fillStyle = '#ece0c4';
      o.fillRect(0, 0, out.width, out.height);
      o.drawImage(canvas, x0 * wb.dpr, y0 * wb.dpr, w * wb.dpr, h * wb.dpr, 0, 0, out.width, out.height);
      const image = out.toDataURL('image/jpeg', 0.82);

      // the lesson text underneath the sketch, so the tutor knows what it's about
      const pr = paper.getBoundingClientRect();
      const context = $$('[data-block], .q__prompt', paper)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom - pr.top >= y0 && r.top - pr.top <= y1;
        })
        .map((el) => plainText(el.cloneNode(true)))
        .join(' ')
        .slice(0, 800);

      wb.askedFrom = wb.strokes.length;
      openBox({ kind: 'drawing', image, context }, { left: pr.left + window.scrollX + x0, bottom: pr.top + window.scrollY + y1, width: w });
      ta.focus({ preventScroll: true });
    }

    /* ================================================================
       Doubts drawer + counter
    ================================================================ */
    const listEl = $('#doubts-list');
    const emptyEl = $('#doubts-empty');
    const scrim = $('#scrim');
    const fmt = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    function refreshCount() {
      const count = P.api.doubts(courseId, lessonN).length;
      countEl.textContent = count ? String(count) : '';
      countEl.dataset.n = String(count);
      drawerToggle.setAttribute('aria-label', `Doubts, ${count} asked in this lesson`);
      if (!drawer.hidden) renderDrawer();
    }
    function renderDrawer() {
      const list = P.api.doubts(courseId, lessonN);
      listEl.innerHTML = list.map((d) => {
        const top = d.kind === 'drawing'
          ? (d.image ? `<img src="${esc(d.image)}" alt="Your sketch on the notes">` : '<p class="ditem__quote">A sketch on the notes</p>')
          : `<p class="ditem__quote">“${esc(trim(d.quote || '', 220))}”</p>`;
        const answer = d.answer
          ? `<div class="ditem__a"><p class="ditem__by">Tutor</p>${P.sanitizeHTML(d.answer)}</div>`
          : '';
        return `<li class="ditem">${top}<p class="ditem__q">${esc(d.question)}</p>${answer}<p class="ditem__meta">${esc(fmt(d.at))}.${d.answer ? '' : ' Waiting for the tutor.'}</p></li>`;
      }).join('');
      renderMath(listEl);
      emptyEl.hidden = list.length > 0;
    }
    function openDrawer() {
      renderDrawer();
      drawer.hidden = false;
      scrim.hidden = false;
      drawerToggle.setAttribute('aria-expanded', 'true');
      $('#doubts-close').focus();
    }
    function closeDrawer() {
      drawer.hidden = true;
      scrim.hidden = true;
      drawerToggle.setAttribute('aria-expanded', 'false');
      drawerToggle.focus();
    }
    drawerToggle.addEventListener('click', () => (drawer.hidden ? openDrawer() : closeDrawer()));
    $('#doubts-close').addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!box.hidden) { closeBox(); return; }
      if (!drawer.hidden) { closeDrawer(); return; }
      if (wb.active) setActive(false);
    });

    refreshCount();
    P.api.loadDoubts(courseId, lessonN).then(refreshCount).catch(() => {});
    return {
      refresh: refreshCount,
      strokes: () => wb.strokes,
      // restore saved drawings (they are not "asked about" yet, so new strokes start a fresh doubt)
      setStrokes(strokes) {
        wb.strokes = Array.isArray(strokes) ? strokes.filter((s) => s && TOOLS[s.tool] && Array.isArray(s.pts)) : [];
        wb.askedFrom = wb.strokes.length;
        redraw();
      }
    };
  };
})();
