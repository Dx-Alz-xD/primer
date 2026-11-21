/* =====================================================================
   Course length (app.html). A "Length" choice in the course builder:
     As long as the subject needs (the default) · Concise (one unit of
     up to 5 lessons, a quick overview) · Number of lessons (typed: 8,
     20, 60...) · Time I want to spend (45 minutes, 3 hours, 10 hours...).
   The server holds the AI's outline to it (server/length.mjs), the
   course page shows what was chosen, and the offline sample course
   keeps to it too.

   P.courseLength.read()          { value } (null: as long as the subject needs),
                                  or { error } (already shown beside the choice)
   P.courseLength.describe(len)   "Concise: a quick overview", "20 lessons", "About 3 hours"
   P.courseLength.fits(len, lessons, minutes)  does a course of that size fit it?
   P.courseLength.time(minutes)   "45 minutes", "3 hours", "2 h 30 min"
   P.courseLength.mountCourse(view, course)    the "Length" row on the course page
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const $ = P.$;
  const t = (s) => (P.t ? P.t(s) : s);
  // interface sentences with {placeholders}: translated whole, then filled in
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const MAX_LESSONS = 150, MIN_MINUTES = 10, MAX_MINUTES = 3000, CONCISE = 5;

  function time(min) {
    const n = Math.round(min);
    if (n < 60) return fill('{n} minutes', { n });
    const h = Math.floor(n / 60), m = n % 60;
    if (m) return fill('{h} h {m} min', { h, m });
    return h === 1 ? t('1 hour') : fill('{n} hours', { n: h });
  }
  const lessonsText = (n) => (n === 1 ? t('1 lesson') : fill('{n} lessons', { n }));

  function describe(len) {
    if (!len) return t('As long as the subject needs');
    if (len.kind === 'concise') return t('Concise: a quick overview');
    if (len.kind === 'lessons') return lessonsText(len.n);
    return fill('About {time}', { time: time(len.n) });
  }

  // the same test as fitLength in server/length.mjs
  function fits(len, lessons, minutes) {
    if (!len) return true;
    if (len.kind === 'concise') return lessons <= CONCISE;
    if (len.kind === 'lessons') return Math.abs(lessons - len.n) <= Math.round(len.n * 0.1);
    return minutes >= len.n * 0.85 && minutes <= len.n * 1.15;
  }

  /* ---------------- the course page: "Length" ---------------- */
  function courseLine(course) {
    const len = course.length;
    const flat = P.courseGen.flatten(course);
    const mins = flat.reduce((a, l) => a + (l.minutes || 0), 0);
    if (len.kind === 'concise') return t('Concise: a quick overview');
    if (len.kind === 'lessons') {
      if (flat.length === len.n) return len.n === 1 ? t('1 lesson, as you asked') : fill('{n} lessons, as you asked', { n: len.n });
      return fill('You asked for {n} lessons; this course has {m}.', { n: len.n, m: flat.length });
    }
    if (fits(len, flat.length, mins)) return fill('About {time}, as you asked', { time: time(len.n) });
    return fill('You asked for about {time}; this course takes about {planned}.', { time: time(len.n), planned: time(mins) });
  }

  function mountCourse(view, course) {
    if (!course || !course.length || !view) return;
    const range = view.querySelector('.spec [data-range]');
    if (!range) return;
    const dt = document.createElement('dt');
    dt.textContent = 'Length';
    const dd = document.createElement('dd');
    dd.setAttribute('data-clen', '');
    range.after(dt, dd);
    const paint = () => { dd.textContent = courseLine(course); };
    paint();
    if (P.tReady) P.tReady.then(paint);
  }

  /* ---------------- the offline sample course keeps to the length ---------------- */
  // `count` lessons spread evenly over the list, always keeping its first and last.
  function spread(list, count) {
    if (count >= list.length) return list.slice();
    if (count <= 1) return list.slice(0, 1);
    const out = [];
    for (let i = 0; i < count; i++) out.push(list[Math.round((i * (list.length - 1)) / (count - 1))]);
    return out;
  }
  function fitSample(course, len) {
    const flat = P.courseGen.flatten(course).map((l) => ({ unit: l.unit, title: l.title, desc: l.desc, tags: l.tags || [], minutes: l.minutes, contentId: l.contentId || null }));
    if (!flat.length) return course;
    const want = len.kind === 'concise' ? Math.min(CONCISE, flat.length)
      : len.kind === 'lessons' ? len.n
      : Math.max(1, Math.min(MAX_LESSONS, Math.round(len.n / 15)));
    const list = spread(flat, want);
    for (let k = 1; list.length < want; k++) {
      list.push({ unit: 'Practice', title: `Practice set ${k}`, desc: 'Mixed questions from the whole course so far.', tags: ['practice'], minutes: 15, contentId: null });
    }
    if (len.kind === 'minutes') { // the sample's times are made up anyway: share the budget out
      const base = Math.floor(len.n / list.length), extra = len.n - base * list.length;
      list.forEach((l, i) => { l.minutes = Math.min(60, Math.max(5, base + (i < extra ? 1 : 0))); });
    }
    const units = [];
    list.forEach((l) => {
      const title = len.kind === 'concise' ? course.title : l.unit;
      const last = units[units.length - 1];
      if (!last || last.title !== title) units.push({ title, lessons: [] });
      units[units.length - 1].lessons.push({ title: l.title, desc: l.desc, tags: l.tags, minutes: l.minutes, contentId: l.contentId });
    });
    course.units = units;
    course.length = len;
    return course;
  }
  if (P.courseGen && P.courseGen.build) {
    const build = P.courseGen.build;
    P.courseGen.build = (req) => {
      const course = build(req);
      return req && req.length ? fitSample(course, req.length) : course;
    };
  }

  P.courseLength = { read: () => ({ value: null }), describe, fits, time, mountCourse };

  /* ---------------- the builder: "Length" ---------------- */
  const form = $('#builder');
  const rangeField = $('#b-from') && $('#b-from').closest('fieldset');
  if (!form || !rangeField) return;

  const OPTIONS = [
    ['', 'As long as the subject needs'],
    ['concise', 'Concise'],
    ['lessons', 'Number of lessons'],
    ['minutes', 'Time I want to spend']
  ];
  const HELP = {
    '': 'As many lessons as the range needs, often 12 to 40.',
    concise: 'One unit of up to 5 lessons, for a quick overview.',
    lessons: 'Exactly this many lessons, from 1 to 150.',
    minutes: 'The lessons’ times add up to about this, from 10 minutes to 50 hours.'
  };
  const box = document.createElement('fieldset');
  box.className = 'field clen';
  box.innerHTML = `
    <legend class="label">Length <small>optional</small></legend>
    <div class="clen__opts">
      ${OPTIONS.map(([v, label]) => `<label class="clen__opt"><input type="radio" name="b-len" value="${v}"${v ? '' : ' checked'}><span>${label}</span></label>`).join('')}
    </div>
    <div class="clen__more" data-for="lessons" hidden>
      <label class="help" for="b-len-n">How many lessons?</label>
      <input class="input input--sm clen__num" id="b-len-n" type="number" min="1" max="${MAX_LESSONS}" step="1" inputmode="numeric" placeholder="e.g. 20" aria-describedby="b-len-err">
    </div>
    <div class="clen__more" data-for="minutes" hidden>
      <label class="help" for="b-len-t">How much time, in all?</label>
      <input class="input input--sm clen__num" id="b-len-t" type="number" min="0" step="any" inputmode="decimal" placeholder="e.g. 3" aria-describedby="b-len-err">
      <select class="select select--small" id="b-len-unit" aria-label="Unit of time"><option value="60">hours</option><option value="1">minutes</option></select>
    </div>
    <p class="help clen__help" id="b-len-help"></p>
    <p class="field__error" id="b-len-err"></p>`;
  rangeField.after(box);

  const radios = Array.from(box.querySelectorAll('input[name="b-len"]'));
  const numEl = box.querySelector('#b-len-n'), timeEl = box.querySelector('#b-len-t'), unitEl = box.querySelector('#b-len-unit');
  const helpEl = box.querySelector('#b-len-help'), errEl = box.querySelector('#b-len-err');
  const foot = form.querySelector('.builder__foot .help');
  const footText = foot ? foot.textContent : '';
  const choice = () => (radios.find((r) => r.checked) || radios[0]).value;
  // the unit names aren't translated by the page (options with values are skipped), so they are here
  const nameUnits = () => { unitEl.options[0].textContent = t('hours'); unitEl.options[1].textContent = t('minutes'); };

  const clearError = () => {
    errEl.textContent = '';
    numEl.removeAttribute('aria-invalid');
    timeEl.removeAttribute('aria-invalid');
  };

  // what was typed, without complaining: null when it isn't a usable length yet
  function peek() {
    const v = choice();
    if (v === 'concise') return { kind: 'concise' };
    if (v === 'lessons') {
      const n = Number(numEl.value);
      return Number.isInteger(n) && n >= 1 && n <= MAX_LESSONS ? { kind: 'lessons', n } : null;
    }
    if (v === 'minutes') {
      const x = Number(String(timeEl.value).replace(',', '.'));
      const n = Math.round(x * Number(unitEl.value));
      return x > 0 && n >= MIN_MINUTES && n <= MAX_MINUTES ? { kind: 'minutes', n } : null;
    }
    return null;
  }

  function paint() {
    const v = choice();
    box.querySelectorAll('.clen__more').forEach((el) => { el.hidden = el.dataset.for !== v; });
    helpEl.textContent = t(HELP[v]);
    if (!foot) return;
    const len = peek();
    if (!len) { foot.textContent = footText; return; }
    foot.textContent = len.kind === 'concise' ? t('Your outline will be one unit of up to 5 lessons.')
      : len.kind === 'lessons' ? (len.n === 1 ? t('Your outline will have exactly 1 lesson.') : fill('Your outline will have exactly {n} lessons.', { n: len.n }))
      : fill('Your outline’s lessons will add up to about {time}.', { time: time(len.n) });
  }

  radios.forEach((r) => r.addEventListener('change', () => {
    clearError();
    paint();
    const v = choice();
    if (v === 'lessons') numEl.focus();
    else if (v === 'minutes') timeEl.focus();
  }));
  [numEl, timeEl].forEach((el) => el.addEventListener('input', () => { clearError(); paint(); }));
  unitEl.addEventListener('change', () => { clearError(); paint(); });
  nameUnits();
  paint();
  if (P.tReady) P.tReady.then(() => { nameUnits(); paint(); });

  function bad(el, msg) {
    errEl.textContent = msg;
    el.setAttribute('aria-invalid', 'true');
    el.focus();
    P.shake(el);
    return { error: msg };
  }

  P.courseLength.read = () => {
    clearError();
    const v = choice();
    if (!v) return { value: null };
    const len = peek();
    if (len) return { value: len };
    if (v === 'lessons') return bad(numEl, t('Type a number of lessons from 1 to 150.'));
    return bad(timeEl, t('Type a time from 10 minutes to 50 hours.'));
  };
})();
