/* =====================================================================
   Book reader (book.html?course=<id>, optionally #ch-3 to open at a
   chapter)

   - The whole book is one flow of HTML (title page, contents, a chapter
     per written lesson, answers) laid out in CSS columns. Each column is
     a page, and the flow slides sideways behind a window that is one or
     two pages wide.
   - Two pages side by side on wide screens, one page on phones and
     tablets held upright. Arrow keys, Page Up/Down, Home/End, the
     buttons and a swipe turn the pages.
   - The place is kept by the first block on the page (its data-a), not
     only the page number, so it survives a resize or newly written
     chapters. It is saved per course in localStorage.
   - Save as PDF prints with the print styles in book.css, which lay the
     same flow out page by page on paper.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, esc = P.esc;
  if (!P.auth.current()) return;

  const MATH_OPTS = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false }
    ],
    throwOnError: false
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const courseId = P.params.get('course') || '';
  const KEY = 'primer.book:' + courseId;
  const main = $('#main'), stage = $('#stage'), spread = $('#spread'), flow = $('#flow');
  const prevBtn = $('#bk-prev'), nextBtn = $('#bk-next'), where = $('#bk-where'), bar = $('#bk-bar');
  const runs = [$('#run-l'), $('#run-r')], folios = [$('#folio-l'), $('#folio-r')];
  const outlineHref = courseId ? `app.html?course=${encodeURIComponent(courseId)}` : 'app.html';
  $('#back-link').href = outlineHref;

  let book = null;
  let geo = { two: false, per: 1, step: 1 };
  let pages = 1;     // pages in the book at the current size
  let page = 0;      // the first page in view (even when two are shown)
  let anchors = [];  // [{ key, page }] for every bookmarkable block, in reading order
  let segments = []; // where the title page, contents, each chapter and the answers start
  let anim = null;
  let size = '';

  if (!courseId) {
    message('Book not found', 'Open a course first, then choose “Read as a book”.', '<a class="btn" href="app.html">Go to your courses</a>');
    return;
  }

  P.book.load(courseId).then(start).catch((err) => {
    if (err.status !== 404) console.error(err);
    if (err.status === 404) message('Book not found', 'This course isn’t in your library. It may have been deleted.', '<a class="btn" href="app.html">Go to your courses</a>');
    else message('This book didn’t open', err.message, `<button class="btn" type="button" data-retry>Try again</button><a class="textlink" href="${outlineHref}">Back to the outline</a>`);
  });

  function message(title, text, actions) {
    $('#bk-tools').hidden = true;
    main.className = 'bk-main bk-main--msg';
    main.innerHTML = `<div class="lmsg card card--solid"><h1>${esc(title)}</h1><p>${esc(text)}</p><div class="bk-msg__actions">${actions}</div></div>`;
    const retry = main.querySelector('[data-retry]');
    if (retry) retry.addEventListener('click', () => location.reload());
  }

  function start(b) {
    book = b;
    document.title = `${book.title} | Primer`;
    $('#bk-course').textContent = book.title;
    if (!book.chapters.length) {
      message('This book has no chapters yet',
        book.sample
          ? 'This sample course has no fully written lessons, so there is nothing to put in a book. Build a course with the AI to get one you can read here.'
          : `None of the ${book.total} lessons in this course has been written yet. A lesson is written the first time you open it, and then it appears here as a chapter.`,
        `<a class="btn" href="lesson.html?course=${encodeURIComponent(book.id)}&amp;lesson=1">${book.sample ? 'Open lesson 1' : 'Write lesson 1'}</a><a class="textlink" href="${outlineHref}">Back to the outline</a>`);
      return;
    }

    const link = P.book.readerLinks(book);
    flow.innerHTML = P.book.html.cover(book) + P.book.html.toc(book, link) +
      book.chapters.map((c) => P.book.html.chapter(book, c, link)).join('') +
      P.book.html.answers(book, link) + '<span class="bk-end" aria-hidden="true"></span>';
    flow.setAttribute('aria-label', book.title);
    if (window.renderMathInElement) {
      try { window.renderMathInElement(flow, MATH_OPTS); } catch (e) { console.warn('[Primer] maths', e); }
    } else {
      flow.classList.add('no-katex');
    }

    $('#bk-status').hidden = true;
    spread.hidden = false;
    $('#bk-controls').hidden = false;
    ['#bk-contents', '#bk-pdf', '#bk-epub'].forEach((s) => { $(s).disabled = false; });

    layout();
    const target = location.hash.length > 1 ? byId(location.hash.slice(1)) : null;
    if (target) history.replaceState(null, '', location.pathname + location.search);
    go(target ? pageOf(target) : savedPage(), false);
    bind();
    // Web fonts and KaTeX's fonts change how much fits on a page.
    if (document.fonts) {
      document.fonts.ready.then(relayout);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', relayout);
    }
  }

  /* ------------------------------------------------------------------
     Page geometry: fit one or two pages into the stage, then measure
     where everything landed.
  ------------------------------------------------------------------ */
  function layout() {
    const cs = getComputedStyle(stage);
    const W = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    size = `${stage.clientWidth}x${stage.clientHeight}`;
    const pageH = Math.floor(Math.max(360, H));
    const twoW = Math.floor(Math.min(W / 2, pageH * 0.78));
    const two = W >= 880 && twoW >= 380;
    const pageW = two ? twoW : Math.floor(clamp(W, 260, 700));
    const padX = Math.round(clamp(pageW * 0.085, 18, 56));
    const padTop = Math.round(clamp(pageH * 0.075, 34, 60));
    const padBottom = Math.round(clamp(pageH * 0.08, 38, 64));
    const textW = pageW - 2 * padX;
    const gap = 2 * padX; // the right margin of one page plus the left margin of the next
    const px = {
      '--page-w': pageW, '--page-h': pageH, '--pad-x': padX, '--pad-top': padTop, '--pad-bottom': padBottom,
      '--text-h': pageH - padTop - padBottom, '--col-gap': gap, '--view-w': two ? 2 * textW + gap : textW
    };
    Object.keys(px).forEach((k) => spread.style.setProperty(k, px[k] + 'px'));
    spread.style.setProperty('--cols', two ? '2' : '1');
    spread.style.setProperty('--fs', clamp(pageW / 24, 17, 21).toFixed(2) + 'px');
    spread.classList.toggle('is-two', two);
    spread.classList.toggle('is-one', !two);
    geo = { two, per: two ? 2 : 1, step: textW + gap };
    measure();
  }

  function colOf(el, base) {
    const r = el.getClientRects()[0] || el.getBoundingClientRect();
    return Math.max(0, Math.floor((r.left - base + 2) / geo.step));
  }
  const pageOf = (el) => colOf(el, flow.getBoundingClientRect().left);

  function measure() {
    const base = flow.getBoundingClientRect().left;
    const col = (el) => colOf(el, base);
    pages = col(flow.querySelector('.bk-end')) + 1;
    anchors = Array.from(flow.querySelectorAll('[data-a]'), (el) => ({ key: el.dataset.a, page: col(el) }));
    segments = [{ page: 0, kind: 'cover', label: 'Title page' }];
    const toc = byId('contents');
    if (toc) segments.push({ page: col(toc), kind: 'toc', label: 'Contents' });
    flow.querySelectorAll('.bk-chapter').forEach((ch) => {
      segments.push({ page: col(ch), kind: 'chapter', n: ch.id.slice(3), label: ch.querySelector('.bk-chapter__title').textContent });
    });
    const answers = byId('answers');
    if (answers) segments.push({ page: col(answers), kind: 'answers', label: 'Answers' });
    // page numbers in the contents
    flow.querySelectorAll('[data-pg]').forEach((el) => {
      const t = byId(el.dataset.pg);
      el.textContent = t ? String(col(t) + 1) : '';
    });
  }

  let relayoutTimer = 0;
  function relayout() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => {
      if (spread.hidden) return;
      const key = anchorOn(page);
      layout();
      const a = key && anchors.find((x) => x.key === key);
      go(a ? a.page : page, false);
    }, 100);
  }

  /* ------------------------------------------------------------------
     Turning pages
  ------------------------------------------------------------------ */
  const lastStart = () => (geo.two ? pages - 1 - ((pages - 1) % 2) : pages - 1);

  function go(p, animate) {
    p = clamp(Math.round(p) || 0, 0, lastStart());
    if (geo.two) p -= p % 2;
    const dir = Math.sign(p - page);
    page = p;
    const x = -p * geo.step;
    if (anim) { anim.cancel(); anim = null; }
    flow.style.transform = `translateX(${x}px)`;
    if (animate && dir && !P.motion.reduce && flow.animate) {
      anim = flow.animate([
        { opacity: 0, transform: `translateX(${x + dir * 28}px)` },
        { opacity: 1, transform: `translateX(${x}px)` }
      ], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
      anim.onfinish = () => { anim = null; };
    }
    paint();
    P.store.set(KEY, { anchor: anchorOn(page), page, pages, at: Date.now() });
  }

  function segmentAt(p) {
    let s = segments[0];
    segments.forEach((x) => { if (x.page <= p) s = x; });
    return s;
  }

  // Running heads: the book's title on a left-hand page, the chapter on a right-hand one,
  // and none on the title page or on the page a chapter opens.
  function runningHead(p, leftHand) {
    if (p >= pages) return '';
    const s = segmentAt(p);
    if (s.kind === 'cover' || s.page === p) return '';
    return leftHand ? book.title : s.label;
  }

  function paint() {
    const last = Math.min(pages - 1, page + geo.per - 1);
    [0, 1].forEach((i) => {
      const p = page + i;
      const shown = i < geo.per;
      runs[i].textContent = shown ? runningHead(p, geo.two && i === 0) : '';
      folios[i].textContent = shown && p > 0 && p < pages ? String(p + 1) : '';
    });
    prevBtn.disabled = page <= 0;
    nextBtn.disabled = page >= lastStart();
    const text = last > page ? `Pages ${page + 1}–${last + 1} of ${pages}` : `Page ${page + 1} of ${pages}`;
    where.textContent = text;
    bar.setAttribute('aria-valuemax', String(pages));
    bar.setAttribute('aria-valuenow', String(last + 1));
    bar.setAttribute('aria-valuetext', text);
    bar.firstElementChild.style.width = `${((last + 1) / pages) * 100}%`;
    const s = segmentAt(last); // a chapter opening on the right-hand page names the spread
    $('#bk-pos').textContent = s.kind === 'chapter' ? `Lesson ${s.n}: ${s.label}` : s.label;
  }

  /* ------------------------------------------------------------------
     Remembering the place
  ------------------------------------------------------------------ */
  function anchorOn(p) {
    const a = anchors.find((x) => x.page === p) || anchors.find((x) => x.page > p && x.page < p + geo.per);
    return a ? a.key : null;
  }

  function savedPage() {
    const s = P.store.get(KEY, null);
    if (!s || typeof s !== 'object') return 0;
    const a = s.anchor && anchors.find((x) => x.key === s.anchor);
    if (a) return a.page;
    return Number.isFinite(s.page) ? Math.round(s.page * (s.pages ? pages / s.pages : 1)) : 0;
  }

  /* ------------------------------------------------------------------
     Input: buttons, keys, swipes, links inside the book, keyboard focus
  ------------------------------------------------------------------ */
  function byId(id) {
    let el = null;
    try { el = document.getElementById(decodeURIComponent(id)); } catch (e) { /* malformed */ }
    return el && el !== flow && flow.contains(el) ? el : null; // #flow is the skip link's target, not a place
  }

  function show(el) {
    if (!el) return;
    go(pageOf(el), false);
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    // an exercise or answer is small, so it glows for a moment to show where it is
    if (el.matches('.bk-ex__item, .bk-ans__item')) {
      el.classList.remove('is-flash');
      void el.offsetWidth;
      el.classList.add('is-flash');
    }
  }

  function onKey(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    let to;
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': to = page + geo.per; break;
      case 'ArrowLeft': case 'PageUp': to = page - geo.per; break;
      case 'Home': to = 0; break;
      case 'End': to = lastStart(); break;
      default: return;
    }
    e.preventDefault();
    go(to, true);
  }

  function bind() {
    prevBtn.addEventListener('click', () => go(page - geo.per, true));
    nextBtn.addEventListener('click', () => go(page + geo.per, true));
    $('#bk-contents').addEventListener('click', () => show(byId('contents')));
    $('#bk-pdf').addEventListener('click', () => window.print());
    $('#bk-epub').addEventListener('click', (e) => P.epub.download(book, e.currentTarget));
    document.addEventListener('keydown', onKey);

    // links between the contents, the chapters, the exercises and the answers
    flow.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const el = byId(a.getAttribute('href').slice(1));
      if (!el) return;
      e.preventDefault();
      show(el);
    });

    // book.html?course=...#ch-3 typed or linked while the book is already open
    addEventListener('hashchange', () => {
      const el = location.hash.length > 1 ? byId(location.hash.slice(1)) : null;
      if (!el) return;
      history.replaceState(null, '', location.pathname + location.search);
      show(el);
    });

    // Tabbing to a link on another page turns to that page.
    flow.addEventListener('focusin', (e) => {
      if (e.target === flow) return;
      const p = pageOf(e.target);
      if (p < page || p >= page + geo.per) go(p, false);
    });
    // Browsers without overflow: clip could scroll the window to a focused link; undo that.
    const vp = $('#viewport');
    vp.addEventListener('scroll', () => { vp.scrollLeft = 0; vp.scrollTop = 0; });

    let touch = null;
    spread.addEventListener('pointerdown', (e) => { touch = e.pointerType !== 'mouse' && e.isPrimary ? { x: e.clientX, y: e.clientY } : null; });
    spread.addEventListener('pointercancel', () => { touch = null; });
    spread.addEventListener('pointerup', (e) => {
      if (!touch) return;
      const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) go(page + (dx < 0 ? geo.per : -geo.per), true);
    });

    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        const now = `${stage.clientWidth}x${stage.clientHeight}`;
        if (now !== size) relayout();
      }).observe(stage);
    } else {
      addEventListener('resize', relayout);
    }
  }
})();
