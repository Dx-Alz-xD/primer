/* =====================================================================
   Mock backend. Every network call the real app will make goes through
   P.api, so wiring the backend means replacing these function bodies.
   Courses and doubts are stored per user in localStorage for now.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;

  const userKey = (prefix) => {
    const u = P.auth.current();
    return `${prefix}:${u ? u.email : 'guest'}`;
  };

  /* ---------- course library ---------- */
  P.courses = {
    all() { return P.store.get(userKey('primer.courses'), {}) || {}; },
    list() {
      return Object.values(this.all()).sort((a, b) => (b.openedAt || b.createdAt) - (a.openedAt || a.createdAt));
    },
    get(id) { return id ? this.all()[id] || null : null; },
    save(course) {
      const all = this.all();
      all[course.id] = course;
      if (!P.store.set(userKey('primer.courses'), all)) P.toast('Your browser storage is full, so this course may not be saved.', 'error');
      return course;
    },
    remove(id) {
      const all = this.all();
      delete all[id];
      P.store.set(userKey('primer.courses'), all);
    },
    touch(id) {
      const c = this.get(id);
      if (c) { c.openedAt = Date.now(); this.save(c); }
    },
    progress(course, n) {
      const p = (course.progress || {})[n];
      return p ? JSON.parse(JSON.stringify(p)) : { answered: {}, tries: {}, done: false };
    },
    setProgress(courseId, n, prog) {
      const c = this.get(courseId);
      if (!c) return;
      c.progress = c.progress || {};
      c.progress[n] = prog;
      c.openedAt = Date.now();
      c.lastLesson = n;
      this.save(c);
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

  /* ---------- talking to the Primer server (server/index.mjs) ---------- */
  async function postJSON(url, body, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      let data = null;
      try { data = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok || !data || !data.ok) {
        const noServer = res.status === 404 || res.status === 405 || res.status === 501;
        throw new Error((data && data.error) || (noServer
          ? 'The Primer server isn’t running, so the AI can’t be reached. Start it with npm start.'
          : `The server answered with an error (${res.status}).`));
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The AI took too long to answer. Try again.');
      if (err instanceof TypeError) throw new Error('Can’t reach the Primer server. Start it with npm start.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

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

  function courseFromOutline(input, outline, model) {
    return {
      id: P.uid(),
      topic: input.topic,
      title: outline.title || P.cap(input.topic),
      from: input.from,
      to: input.to,
      instructions: input.instructions,
      style: P.parseStyle(input.instructions),
      createdAt: Date.now(),
      openedAt: Date.now(),
      source: 'ai',
      model,
      units: outline.units.map((u) => ({
        title: u.title,
        lessons: u.lessons.map((l) => ({ title: l.title, desc: l.desc, tags: l.tags || [], minutes: l.minutes || 15, contentId: null }))
      })),
      lessons: {},
      progress: {}
    };
  }

  /* ---------- the API surface ---------- */
  P.api = {
    // AI outline with 20-30 lessons. If the AI can't be reached, a sample outline is built locally.
    async generateCourse(req) {
      const input = {
        topic: P.clean(req.topic, 120),
        from: P.clean(req.from, 80),
        to: P.clean(req.to, 80),
        instructions: P.clean(req.instructions, 600)
      };
      try {
        const res = await postJSON('/api/outline', input, 240000);
        return courseFromOutline(input, res.outline, res.model);
      } catch (err) {
        console.warn('[Primer] AI outline failed:', err);
        const course = P.courseGen.build(input);
        course.source = 'sample';
        course.aiError = err.message;
        return course;
      }
    },

    // A lesson: written by the AI the first time it's opened, then stored with the course.
    // Sample courses keep using the built-in sample lessons.
    async getLesson(course, n) {
      const flat = P.courseGen.flatten(course);
      const meta = flat[n - 1];
      if (!meta) return null;
      if (course.source !== 'ai') {
        await P.delay(120);
        return P.courseGen.lesson(course, n);
      }
      const withMeta = (l) => Object.assign({}, l, { title: meta.title, unit: meta.unit, unitIndex: meta.unitIndex, minutes: meta.minutes });
      const stored = course.lessons && course.lessons[n];
      if (stored) return withMeta(stored);

      const res = await postJSON('/api/lesson', {
        topic: course.topic,
        from: course.from,
        to: course.to,
        instructions: course.instructions,
        courseTitle: course.title,
        n,
        outline: flat.map((l) => ({ n: l.n, unit: l.unit, title: l.title, desc: l.desc }))
      }, 330000);
      const lesson = cleanLesson(res.lesson);
      lesson.model = res.model;
      const fresh = P.courses.get(course.id) || course;
      fresh.lessons = fresh.lessons || {};
      fresh.lessons[n] = lesson;
      P.courses.save(fresh);
      return withMeta(lesson);
    },

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

    // Written answers: checking mechanism to be decided, so we only record them.
    async submitSubjective(course, lessonN, q, text) {
      await P.delay(P.motion.reduce ? 0 : 450);
      return { status: 'submitted' };
    },

    // Doubts from a text selection or a whiteboard sketch. Stored until the tutor exists.
    async askDoubt(payload) {
      await P.delay(P.motion.reduce ? 0 : 300);
      const key = userKey('primer.doubts');
      const list = P.store.get(key, []) || [];
      const item = Object.assign({ id: P.uid(), at: Date.now(), status: 'waiting' }, payload);
      list.push(item);
      if (!P.store.set(key, list)) {
        // storage full: keep the question, drop the sketch
        item.image = null;
        item.imageDropped = true;
        P.store.set(key, list);
      }
      return { status: 'waiting', id: item.id };
    },

    doubts(courseId, lessonN) {
      return (P.store.get(userKey('primer.doubts'), []) || [])
        .filter((d) => d.courseId === courseId && (lessonN == null || d.lesson === lessonN))
        .sort((a, b) => b.at - a.at);
    }
  };
})();
