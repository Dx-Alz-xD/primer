/* =====================================================================
   A course as a book: the part the reader and the EPUB share.

   P.book.load(courseId) -> book
     Fetches the course and its written lessons in one call, cleans every
     lesson with P.cleanLesson (AI-written HTML is never trusted as
     stored) and makes each written lesson a chapter. Lessons that aren't
     written yet stay in book.entries, so the contents can list them.

   P.book.html.cover / toc / chapter / answers (book, ..., link) -> HTML
     The same markup feeds the reader (book.js) and the EPUB (epub.js).
     `link` says where cross-references point: the reader keeps the whole
     book in one page (#ch-3), the EPUB has a file per chapter.

   Blocks render the way the lesson player renders them (lesson.js);
   checkpoint questions become numbered exercises (3.1, 3.2...) with an
   answer key at the back.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const esc = P.esc;
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const letter = (i) => String.fromCharCode(97 + i);
  const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  /* ---------- loading ---------- */

  // Control characters (a stray bell or escape from the model) print as boxes, so they go.
  const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const scrub = (v) => (typeof v === 'string' ? v.replace(CTRL, '')
    : Array.isArray(v) ? v.map(scrub)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)])) : v);

  // Only the shapes the renderer understands get through, so an odd lesson can't break the book.
  function normalize(raw) {
    raw = scrub(raw);
    return {
      // its sources (server/refs.mjs), checked by assets/js/refs.js when they are shown
      refs: raw && raw.refs && typeof raw.refs === 'object' ? raw.refs : null,
      sections: arr(raw && raw.sections).filter((s) => s && typeof s === 'object').map((s) => ({
        title: str(s.title),
        blocks: arr(s.blocks).filter((b) => b && typeof b === 'object' && typeof b.t === 'string')
          .map((b) => (b.t === 'list' ? Object.assign({}, b, { items: arr(b.items).map(str) }) : b)),
        recap: arr(s.recap).map(str),
        checkpoint: arr(s.checkpoint).filter((q) => q && typeof q === 'object' && q.prompt != null)
          .map((q) => Object.assign({}, q, { prompt: str(q.prompt), choices: q.type === 'choice' ? arr(q.choices).map(str) : undefined }))
      }))
    };
  }

  // Figures are drawn inline, so two of them can't both use id="arrow". Ids get a per-figure prefix.
  function scopeIds(svg, prefix) {
    if (!/\sid=/i.test(svg)) return svg;
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${svg}</body>`, 'text/html');
    const root = doc.body.querySelector('svg');
    if (!root) return svg;
    const all = [root].concat(Array.from(root.querySelectorAll('*')));
    const map = new Map();
    all.forEach((n) => {
      if (!n.hasAttribute('id')) return;
      const id = n.getAttribute('id');
      const next = prefix + (id.replace(/[^\w-]/g, '') || 'x');
      map.set(id, next);
      n.setAttribute('id', next);
    });
    all.forEach((n) => Array.from(n.attributes).forEach((a) => {
      const m = /^url\(#([^)]+)\)$/.exec(a.value.trim());
      if (m && map.has(m[1])) n.setAttribute(a.name, `url(#${map.get(m[1])})`);
    }));
    return root.outerHTML;
  }

  async function load(courseId) {
    const d = await P.get(`/api/courses/${encodeURIComponent(courseId)}/book`, {
      timeout: 60000, timeoutMessage: 'The book took too long to load. Try again.'
    });
    const course = d.course;
    const flat = P.courseGen.flatten(course);
    const stored = new Map(arr(d.lessons).map((l) => [l.n, l]));
    const entries = flat.map((meta) => {
      const e = { n: meta.n, title: meta.title, unit: meta.unit, unitIndex: meta.unitIndex, minutes: meta.minutes, lesson: null, model: null };
      let raw = null;
      if (stored.has(meta.n)) {
        raw = stored.get(meta.n).lesson;
        e.model = stored.get(meta.n).model || null;
      } else if (course.source === 'sample') {
        // sample courses carry a few hand-written lessons; their drafts aren't book material
        const s = P.courseGen.lesson(course, meta.n);
        if (s && !s.draft) raw = s;
      }
      if (!raw) return e;
      try {
        const lesson = P.cleanLesson(normalize(raw));
        lesson.sections.forEach((s, si) => s.blocks.forEach((b, bi) => {
          if (b.t === 'figure' && b.svg) b.svg = scopeIds(b.svg, `f${meta.n}-${si + 1}-${bi + 1}-`);
        }));
        if (lesson.sections.some((s) => s.blocks.length || s.checkpoint.length)) e.lesson = lesson;
      } catch (err) {
        console.warn(`[Primer] Lesson ${meta.n} couldn’t be read for the book.`, err);
      }
      return e;
    });
    const chapters = entries.filter((e) => e.lesson);
    chapters.forEach((c) => { c.questions = c.lesson.sections.flatMap((s) => s.checkpoint); });
    const title = course.title || course.topic || 'Untitled course';
    return {
      id: course.id,
      course,
      title,
      topic: course.topic || '',
      range: `From ${course.from || 'the very beginning'} to ${course.to || 'the end of the subject'}`,
      date: new Date(),
      lang: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(course.lang || '') ? course.lang : (document.documentElement.lang || 'en'),
      sample: course.source === 'sample',
      entries,
      chapters,
      total: flat.length,
      hasExercises: chapters.some((c) => c.questions.length > 0)
    };
  }

  /* ---------- rendering ---------- */

  function block(b, a) {
    const at = ` data-a="${a}"`;
    switch (b.t) {
      case 'p': return `<p${at}>${str(b.html)}</p>`;
      case 'h': return `<h4 class="bk-h"${at}>${esc(b.text)}</h4>`;
      case 'math': return `<div class="math-display"${at}>$$${esc(b.tex)}$$</div>`;
      case 'list': return `<ul${at}>${b.items.map((it) => `<li>${it}</li>`).join('')}</ul>`;
      case 'figure': return b.svg ? `<figure class="fig"${at}>${b.svg}${b.caption ? `<figcaption>${b.caption}</figcaption>` : ''}</figure>` : '';
      case 'photo': return P.photos && b.src ? P.photos.html(b, { attr: at }) : '';
      case 'callout': {
        const kind = str(b.kind || 'note').replace(/[^\w-]/g, '') || 'note';
        return `<aside class="callout callout--${kind}"${at}>${b.title ? `<div class="callout__title">${esc(b.title)}</div>` : ''}<div class="callout__body">${str(b.html)}</div></aside>`;
      }
      default: return '';
    }
  }

  function countLine(book) {
    const n = book.chapters.length;
    if (n === book.total) return book.total === 1 ? 'One lesson' : `All ${book.total} lessons`;
    return `${n} of ${book.total} lessons written so far`;
  }

  function cover(book) {
    const sameAsTopic = !book.topic || book.topic.toLowerCase() === book.title.toLowerCase();
    return `<section class="bk-cover" id="cover" data-a="cover" aria-labelledby="bk-cover-title">
      <div class="bk-cover__main">
        <p class="bk-cover__topic">${sameAsTopic ? 'A Primer course' : `A course on ${esc(book.topic)}`}</p>
        <h1 class="bk-cover__title" id="bk-cover-title">${esc(book.title)}</h1>
        <div class="bk-rule" aria-hidden="true"></div>
        <p class="bk-cover__range">${esc(book.range)}</p>
        <p class="bk-cover__count">${esc(countLine(book))}</p>
      </div>
      <div class="bk-cover__foot">
        <p class="bk-cover__by">Written with Primer</p>
        <p class="bk-cover__date">${esc(DATE.format(book.date))}</p>
      </div>
    </section>`;
  }

  function toc(book, link) {
    const units = [];
    book.entries.forEach((e) => {
      const last = units[units.length - 1];
      if (!last || last.index !== e.unitIndex) units.push({ index: e.unitIndex, title: e.unit, rows: [] });
      units[units.length - 1].rows.push(e);
    });
    const row = (e) => (e.lesson
      ? `<li class="bk-toc__row" data-a="t${e.n}"><a class="bk-toc__link" href="${link.chapter(e.n)}"><span class="bk-toc__n">${e.n}</span><span class="bk-toc__t">${esc(e.title)}</span><span class="bk-toc__dots" aria-hidden="true"></span><span class="bk-toc__pg" data-pg="ch-${e.n}"></span></a></li>`
      : `<li class="bk-toc__row is-unwritten" data-a="t${e.n}"><span class="bk-toc__n">${e.n}</span><span class="bk-toc__t">${esc(e.title)} <em class="bk-toc__status">not written yet</em></span><a class="bk-toc__write" href="${link.lesson(e.n)}" aria-label="${book.sample ? `Open lesson ${e.n}, ${esc(e.title)}, in the lesson player` : `Write lesson ${e.n}, ${esc(e.title)}, in the lesson player`}">${book.sample ? 'Open it' : 'Write it'}</a></li>`);
    const missing = book.total - book.chapters.length;
    const note = missing
      ? `<p class="bk-toc__note">${missing === 1 ? 'One lesson isn’t' : `${missing} lessons aren’t`} written yet. ${book.sample ? 'Open one in the lesson player to read its draft.' : 'Open one in the lesson player and it is written for you, then it appears here as a chapter.'}</p>`
      : '';
    return `<nav class="bk-toc" id="contents" data-a="toc" aria-labelledby="bk-toc-title">
      <h2 class="bk-toc__title" id="bk-toc-title">Contents</h2>
      ${note}
      ${units.map((u) => `<section class="bk-toc__unit" aria-labelledby="bk-tu-${u.index}">
        <h3 class="bk-toc__unit-title" id="bk-tu-${u.index}" data-a="tu${u.index}">Unit ${P.roman(u.index)}: ${esc(u.title)}</h3>
        <ol class="bk-toc__list">${u.rows.map(row).join('')}</ol>
      </section>`).join('')}
      ${book.hasExercises ? `<p class="bk-toc__row bk-toc__row--end" data-a="ta"><a class="bk-toc__link" href="${link.answers()}"><span class="bk-toc__n"></span><span class="bk-toc__t">Answers to the exercises</span><span class="bk-toc__dots" aria-hidden="true"></span><span class="bk-toc__pg" data-pg="answers"></span></a></p>` : ''}
    </nav>`;
  }

  function exercise(q, n, k, link) {
    let body = `<div class="bk-ex__prompt">${q.prompt}</div>`;
    if (q.type === 'choice' && q.choices && q.choices.length) {
      body += `<ol class="bk-ex__choices">${q.choices.map((c, i) => `<li><span class="bk-ex__letter">(${letter(i)})</span> ${c}</li>`).join('')}</ol>`;
    } else if (q.type === 'numeric' && q.unit) {
      body += `<p class="bk-ex__note">Give your answer in ${esc(q.unit)}.</p>`;
    } else if (q.type === 'subjective') {
      body += '<p class="bk-ex__note">Answer in a few sentences of your own.</p>';
    }
    return `<li class="bk-ex__item" id="ex-${n}-${k}" data-a="e${n}-${k}"><span class="bk-ex__n">${n}.${k}</span>${body}<p class="bk-ex__more"><a class="bk-ex__ans" href="${link.answer(n, k)}" aria-label="Answer to exercise ${n}.${k}">Answer</a></p></li>`;
  }

  function answer(q, n, k, link) {
    let main;
    if (q.type === 'choice') {
      const i = Number(q.answer);
      main = q.choices && q.choices[i] != null ? `<strong class="bk-ans__key">(${letter(i)})</strong> ${q.choices[i]}` : '<em>No answer was given for this question.</em>';
    } else if (q.type === 'numeric') {
      main = `<strong class="bk-ans__key">${esc(str(q.answer))}${q.unit ? ' ' + esc(q.unit) : ''}</strong>`;
    } else if (q.type === 'text') {
      const accept = arr(q.accept).map(str).filter(Boolean);
      main = `<strong class="bk-ans__key">${esc(accept[0] || '')}</strong>${accept.length > 1 ? ` <span class="bk-ans__also">Also accepted: ${accept.slice(1).map(esc).join('; ')}</span>` : ''}`;
    } else {
      main = q.model ? `<span class="bk-ans__label">A model answer:</span> ${q.model}` : '<em>Answers will vary.</em> Check yours against the lesson.';
    }
    const why = q.explain ? `<div class="bk-ans__explain">${q.explain}</div>` : '';
    return `<li class="bk-ans__item" id="ans-${n}-${k}" data-a="a${n}-${k}"><span class="bk-ex__n">${n}.${k}</span><div class="bk-ans__main">${main}</div>${why}<p class="bk-ex__more"><a class="bk-ans__back" href="${link.exercise(n, k)}" aria-label="Back to exercise ${n}.${k}">Back to the exercise</a></p></li>`;
  }

  // A chapter's sources (assets/js/refs.js): numbers beside its parts' titles, and the list after its exercises.
  const srcPrefix = (ch) => `src-${ch.n}-`;
  const srcTags = (ch, si) => (P.refs ? P.refs.tags(ch.lesson, si, { prefix: srcPrefix(ch), text: true }) : '');
  const srcList = (book, ch) => (P.refs ? P.refs.list(ch.lesson, { prefix: srcPrefix(ch), heading: 'h3', cls: 'srcs bk-src', lang: book.lang, anchor: `s${ch.n}` }) : '');

  function chapter(book, ch, link) {
    const body = ch.lesson.sections.map((s, si) => {
      const a = `c${ch.n}-${si + 1}`;
      return (s.title ? `<h3 class="bk-sec"${` data-a="${a}"`}>${esc(s.title)}${srcTags(ch, si)}</h3>` : '') +
        s.blocks.map((b, bi) => block(b, `${a}-${bi + 1}`)).join('');
    }).join('');
    const ex = ch.questions.length
      ? `<section class="bk-ex" aria-labelledby="ex-${ch.n}-title">
          <h3 class="bk-ex__title" id="ex-${ch.n}-title" data-a="e${ch.n}">Exercises</h3>
          <ol class="bk-ex__list">${ch.questions.map((q, i) => exercise(q, ch.n, i + 1, link)).join('')}</ol>
        </section>`
      : '';
    return `<article class="bk-chapter" id="ch-${ch.n}" aria-labelledby="ch-${ch.n}-title">
      <header class="bk-chapter__head" data-a="c${ch.n}">
        <p class="bk-chapter__kicker">Lesson ${ch.n}</p>
        <h2 class="bk-chapter__title" id="ch-${ch.n}-title">${esc(ch.title)}</h2>
        <p class="bk-chapter__unit">Unit ${P.roman(ch.unitIndex)}: ${esc(ch.unit)}</p>
        <div class="bk-rule" aria-hidden="true"></div>
      </header>
      ${body}${ex}${srcList(book, ch)}
    </article>`;
  }

  function answers(book, link) {
    if (!book.hasExercises) return '';
    return `<section class="bk-answers" id="answers" aria-labelledby="bk-answers-title">
      <h2 class="bk-answers__title" id="bk-answers-title" data-a="answers">Answers</h2>
      ${book.chapters.filter((c) => c.questions.length).map((c) => `<section class="bk-ans-ch" aria-labelledby="ans-${c.n}-title">
        <h3 class="bk-ans-ch__title" id="ans-${c.n}-title" data-a="a${c.n}">Lesson ${c.n}: ${esc(c.title)}</h3>
        <ol class="bk-ans">${c.questions.map((q, i) => answer(q, c.n, i + 1, link)).join('')}</ol>
      </section>`).join('')}
    </section>`;
  }

  P.book = {
    load,
    html: { cover, toc, chapter, answers, block },
    countLine,
    // Where cross-references point when the whole book is one page.
    readerLinks: (book) => ({
      chapter: (n) => `#ch-${n}`,
      exercise: (n, k) => `#ex-${n}-${k}`,
      answer: (n, k) => `#ans-${n}-${k}`,
      answers: () => '#answers',
      lesson: (n) => `lesson.html?course=${encodeURIComponent(book.id)}&lesson=${n}`
    })
  };
})();
