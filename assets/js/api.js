/* =====================================================================
   The browser's side of the Primer server. Every network call goes
   through P.api or P.courses, which keep a copy of the learner's library
   in memory and save changes back to their account, so everything
   follows them across sessions and devices.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;

  /* ---------- progress saves: batched, retried, flushed on leave ---------- */
  const pending = new Map(); // "courseId|n" -> progress
  let flushTimer = 0;
  let warned = false;
  function flush(keepalive) {
    clearTimeout(flushTimer);
    const batch = Array.from(pending.entries());
    pending.clear();
    batch.forEach(([key, prog]) => {
      const [id, n] = key.split('|');
      P.put(`/api/courses/${encodeURIComponent(id)}/progress/${n}`, { progress: prog }, { keepalive }).then(() => { warned = false; }).catch((err) => {
        if (!pending.has(key)) pending.set(key, prog);
        if (!warned) { warned = true; P.toast('Your progress couldn’t be saved yet. It will retry: ' + err.message, 'error'); }
        flushTimer = setTimeout(() => flush(false), 5000);
      });
    });
  }
  const queueSave = (id, n, prog) => {
    pending.set(`${id}|${n}`, prog);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(false), 500);
  };
  addEventListener('pagehide', () => { if (pending.size) flush(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && pending.size) flush(true); });

  /* ---------- course library (a cache of what the server holds) ---------- */
  P.courses = {
    _all: {},
    _loading: null,
    load(force) {
      if (!this._loading || force) {
        this._loading = P.get('/api/courses').then((d) => {
          this._all = {};
          d.courses.forEach((c) => { this._all[c.id] = c; });
          return this;
        }).catch((err) => { this._loading = null; throw err; });
      }
      return this._loading;
    },
    all() { return this._all; },
    list() {
      return Object.values(this._all).sort((a, b) => (b.openedAt || b.createdAt) - (a.openedAt || a.createdAt));
    },
    get(id) { return id ? this._all[id] || null : null; },
    put(course) { this._all[course.id] = course; return course; },
    save(course) { return this.put(course); },
    async remove(id) {
      await P.del('/api/courses/' + encodeURIComponent(id));
      delete this._all[id];
    },
    touch(id) {
      const c = this.get(id);
      if (!c) return;
      c.openedAt = Date.now();
      P.patch('/api/courses/' + encodeURIComponent(id), { opened: true }).catch(() => {});
    },
    progress(course, n) {
      const p = (course.progress || {})[n];
      return p ? JSON.parse(JSON.stringify(p)) : { answered: {}, tries: {}, done: false };
    },
    setProgress(courseId, n, prog) {
      const c = this.get(courseId);
      if (!c) return;
      c.progress = c.progress || {};
      c.progress[n] = JSON.parse(JSON.stringify(prog));
      c.openedAt = Date.now();
      c.lastLesson = n;
      queueSave(courseId, n, c.progress[n]);
    },
    // Moves courses from the old browser-only storage into the account, once.
    async importLegacy() {
      const list = P.legacyCourses();
      if (!list.length) return 0;
      const d = await P.post('/api/import', { courses: list }, { timeout: 60000 });
      P.clearLegacy();
      await this.load(true);
      return d.imported;
    },
    stats(course) {
      const total = P.courseGen.count(course);
      const done = Object.values(course.progress || {}).filter((p) => p.done).length;
      return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
    },
    // first lesson that isn't finished (or the one last opened)
    resumeAt(course) {
      const total = P.courseGen.count(course);
      const prog = course.progress || {};
      if (course.lastLesson && prog[course.lastLesson] && !prog[course.lastLesson].done) return course.lastLesson;
      for (let n = 1; n <= total; n++) if (!prog[n] || !prog[n].done) return n;
      return 1;
    }
  };

  /* ---------- answer checking helpers ---------- */
  function parseNumber(raw) {
    const s = String(raw).trim().replace(/,/g, '').replace(/[−–]/g, '-');
    const m = s.match(/^([-+]?\d*\.?\d+)(?:\s*\/\s*([-+]?\d*\.?\d+))?/);
    if (!m) return null;
    const a = parseFloat(m[1]);
    if (m[2] !== undefined) {
      const b = parseFloat(m[2]);
      return b ? a / b : null;
    }
    return a;
  }
  const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  /* ---------- cleaning AI-written HTML before it touches the page ---------- */
  const HTML_OK = new Set(['P', 'STRONG', 'EM', 'B', 'I', 'U', 'SUB', 'SUP', 'BR', 'CODE', 'SPAN', 'SMALL', 'MARK', 'UL', 'OL', 'LI']);
  const SVG_OK = new Set(['svg', 'g', 'path', 'line', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'text', 'tspan', 'defs', 'marker', 'title']);
  const SVG_ATTRS = new Set(['viewbox', 'width', 'height', 'd', 'x', 'y', 'dx', 'dy', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'points', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'transform', 'font-size',
    'font-style', 'font-weight', 'text-anchor', 'dominant-baseline', 'opacity', 'fill-opacity', 'stroke-opacity', 'marker-end',
    'marker-start', 'marker-mid', 'id', 'refx', 'refy', 'markerwidth', 'markerheight', 'markerunits', 'orient', 'xmlns', 'role', 'aria-label']);
  const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'foreignobject', 'image', 'use', 'video', 'audio',
    'canvas', 'form', 'input', 'button', 'textarea', 'select', 'template', 'noscript', 'svg']);

  function cleanTree(node, allowSvg) {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === 3) return;
      if (child.nodeType !== 1) { child.remove(); return; }
      const isSvg = child.namespaceURI === 'http://www.w3.org/2000/svg';
      const name = isSvg ? child.localName : child.tagName;
      const ok = isSvg ? allowSvg && SVG_OK.has(name) : HTML_OK.has(name);
      if (!ok) {
        if (DROP.has(name.toLowerCase()) || (isSvg && !allowSvg)) child.remove();
        else { cleanTree(child, allowSvg); child.replaceWith(...Array.from(child.childNodes)); }
        return;
      }
      Array.from(child.attributes).forEach((a) => {
        const n = a.name.toLowerCase();
        const v = a.value.trim();
        const badValue = /javascript:|data:|expression\(/i.test(v) || (/url\(/i.test(v) && !/^url\(#[\w-]+\)$/i.test(v));
        if (!(isSvg && SVG_ATTRS.has(n)) || n.startsWith('on') || badValue) child.removeAttribute(a.name);
      });
      cleanTree(child, allowSvg);
    });
  }

  P.sanitizeHTML = (html) => {
    const src = String(html == null ? '' : html).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${src}</body>`, 'text/html');
    cleanTree(doc.body, false);
    return doc.body.innerHTML;
  };

  P.sanitizeSVG = (svg) => {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${String(svg || '')}</body>`, 'text/html');
    const el = doc.body.querySelector('svg');
    if (!el) return '';
    const box = doc.createElement('div');
    box.appendChild(el);
    cleanTree(box, true);
    const out = box.querySelector('svg');
    if (!out) return '';
    out.setAttribute('class', 'fig-svg');
    if (!out.getAttribute('role')) out.setAttribute('role', 'img');
    return out.outerHTML;
  };

  function cleanLesson(lesson) {
    const h = P.sanitizeHTML;
    lesson.sections.forEach((s) => {
      s.blocks = s.blocks.map((b) => {
        const o = Object.assign({}, b);
        if (o.html != null) o.html = h(o.html);
        if (o.items) o.items = o.items.map(h);
        if (o.caption) o.caption = h(o.caption);
        if (o.t === 'figure') {
          o.svg = P.sanitizeSVG(o.svg);
          if (!o.svg) return null;
        }
        return o;
      }).filter(Boolean);
      s.recap = (s.recap || []).map(h);
      s.checkpoint = (s.checkpoint || []).map((q) => Object.assign({}, q, {
        prompt: h(q.prompt),
        choices: q.choices ? q.choices.map(h) : undefined,
        hint: q.hint ? h(q.hint) : '',
        explain: q.explain ? h(q.explain) : '',
        model: q.model ? h(q.model) : null
      }));
    });
    return lesson;
  }

  /* ---------- the API surface ---------- */
  const doubtCache = new Map(); // "courseId|n" -> [doubts]
  const plain = (html) => { const d = document.createElement('div'); d.innerHTML = P.sanitizeHTML(html); return d.textContent.replace(/\s+/g, ' ').trim(); };

  P.api = {
    // The server plans the course with the AI and saves it to the account.
    // If the AI can't be reached, a sample outline is built here and saved instead.
    async generateCourse(req) {
      const input = {
        topic: P.clean(req.topic, 120),
        from: P.clean(req.from, 80),
        to: P.clean(req.to, 80),
        instructions: P.clean(req.instructions, 600)
      };
      try {
        const res = await P.post('/api/outline', Object.assign({ style: P.parseStyle(input.instructions) }, input, req.extra || {}), {
          timeout: 330000, timeoutMessage: 'The AI took too long to plan the course. Try again.'
        });
        return P.courses.put(res.course);
      } catch (err) {
        if (err.status === 401) throw err;
        console.warn('[Primer] AI outline failed:', err);
        const sample = P.courseGen.build(input);
        sample.source = 'sample';
        sample.aiError = err.message;
        const res = await P.post('/api/courses', { course: sample, folderId: (req.extra && req.extra.folderId) || null });
        return P.courses.put(res.course);
      }
    },

    // A lesson: written by the AI the first time it's opened, then saved with the course.
    // Sample courses keep using the built-in sample lessons.
    async getLesson(course, n) {
      const flat = P.courseGen.flatten(course);
      const meta = flat[n - 1];
      if (!meta) return null;
      if (course.source === 'sample') {
        await P.delay(120);
        return P.courseGen.lesson(course, n);
      }
      const withMeta = (l) => Object.assign({}, l, { title: meta.title, unit: meta.unit, unitIndex: meta.unitIndex, minutes: meta.minutes });
      const id = encodeURIComponent(course.id);
      let res;
      if ((course.written || []).includes(n)) {
        res = await P.get(`/api/courses/${id}/lessons/${n}`);
      } else {
        res = await P.post('/api/lesson', { courseId: course.id, n }, {
          timeout: 330000, timeoutMessage: 'The AI took too long to write this lesson. Try again.'
        });
        const fresh = P.courses.get(course.id) || course;
        fresh.written = Array.from(new Set((fresh.written || []).concat(n))).sort((a, b) => a - b);
      }
      let translated = null;
      if (P.api.wantsTranslation(course)) {
        try {
          translated = await P.post('/api/lesson/translate', { courseId: course.id, n, lang: P.lang }, {
            timeout: 330000, timeoutMessage: 'The translation took too long. Showing the original.'
          });
        } catch (err) {
          P.toast(`The translation isn’t ready: ${err.message} Showing the original.`, 'error');
        }
      }
      // AI-written HTML is cleaned every time it is shown, never trusted as stored.
      const lesson = cleanLesson(JSON.parse(JSON.stringify((translated || res).lesson)));
      lesson.model = res.model;
      if (translated) { lesson.translated = { lang: P.lang, model: translated.model }; }
      return withMeta(lesson);
    },

    // Lessons written in another language are shown translated once the learner asks, per course.
    lessonLang: (course) => course.lang || 'en',
    wantsTranslation(course) {
      if (!P.lang || course.source === 'sample' || P.api.lessonLang(course) === P.lang) return false;
      try { return P.store.get('primer.tr.' + course.id, null) === P.lang; } catch (e) { return false; }
    },
    setTranslation(course, on) { P.store.set('primer.tr.' + course.id, on ? P.lang : null); },

    // Objective answers are checked locally. Returns { correct, invalid? }
    checkAnswer(q, raw) {
      if (q.type === 'choice') return { correct: Number(raw) === q.answer };
      if (q.type === 'numeric') {
        const v = parseNumber(raw);
        if (v == null || Number.isNaN(v)) return { correct: false, invalid: true };
        const tol = q.tolerance != null ? q.tolerance : 1e-6;
        return { correct: Math.abs(v - q.answer) <= tol };
      }
      if (q.type === 'text') {
        const n = norm(raw);
        return { correct: (q.accept || []).some((a) => norm(a) === n) };
      }
      return { correct: false };
    },

    // After a wrong answer: what to revise. The backend can make this smarter later.
    async getRevision(course, lesson, section, q, wrongAnswer) {
      await P.delay(P.motion.reduce ? 0 : 300);
      const points = section.recap && section.recap.length
        ? section.recap
        : section.blocks.filter((b) => b.t === 'p').slice(0, 2).map((b) => b.html);
      return { points };
    },

    // Written answers are saved with the lesson's progress (the answer text is in it).
    async submitSubjective(course, lessonN, q, text) {
      await P.delay(P.motion.reduce ? 0 : 250);
      return { status: 'submitted' };
    },

    // Every wrong answer is remembered, so the tutor can see what tends to trip this learner up.
    recordMistake(course, n, lessonTitle, q, given) {
      const choiceText = (i) => (q.choices && q.choices[i] != null ? plain(q.choices[i]) : '');
      const correct = q.type === 'choice' ? choiceText(q.answer) : q.type === 'numeric' ? `${q.answer}${q.unit ? ' ' + q.unit : ''}` : (q.accept || [])[0] || '';
      const givenText = q.type === 'choice' ? choiceText(Number(given)) : String(given);
      P.post('/api/mistakes', {
        courseId: course.id, lesson: n, lessonTitle, prompt: plain(q.prompt), given: givenText, correct
      }).catch(() => {});
    },

    // Doubts from a text selection or a whiteboard sketch, saved to the account.
    async askDoubt(payload) {
      const res = await P.post('/api/doubts', payload, { timeout: 45000 });
      const key = `${payload.courseId}|${payload.lesson}`;
      doubtCache.set(key, [res.doubt].concat(doubtCache.get(key) || []));
      return res.doubt;
    },

    async loadDoubts(courseId, lessonN) {
      const res = await P.get(`/api/doubts?course=${encodeURIComponent(courseId)}&lesson=${lessonN}`);
      doubtCache.set(`${courseId}|${lessonN}`, res.doubts);
      return res.doubts;
    },

    doubts(courseId, lessonN) {
      return doubtCache.get(`${courseId}|${lessonN}`) || [];
    },

    // The lesson notebook: typed notes and the drawing on the page, per lesson.
    getNotes: (courseId, n) => P.get(`/api/notes/${encodeURIComponent(courseId)}/${n}`),
    saveNotes: (courseId, n, data, keepalive) => P.put(`/api/notes/${encodeURIComponent(courseId)}/${n}`, data, { keepalive })
  };
})();
