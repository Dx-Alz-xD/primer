/* =====================================================================
   "Check my working" (lesson.html), served by server/working.mjs.

   The learner works a problem out on paper and photographs it (1 to 3
   photos for a long working). The photos are made smaller here (about
   1600 px on the long side, JPEG), so their metadata never leaves the
   device. Primer reads the working line by line, checks the arithmetic
   and algebra exactly and the rest with the AI, and shows the steps as
   a marked page: a tick, a cross, a question mark or "carried forward"
   on each line, the first wrong line in red with what went wrong, and a
   hint for the next try. A chatbot solves the problem for you; this
   checks how you solved it.

   P.working.attach(q, w, ctx)        a "Check my working" button on a question that involves working
   P.working.offer(q, w, panel, ctx)  the same, offered in the revision panel after a wrong answer
   P.working.any(ctx)                 "Check any working": a problem and its working, no lesson question
     ctx: { course(), n, lessonTitle, lang() }
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth || !P.auth.current()) return;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  // the lesson body isn't translated by the page-wide dictionary, so interface text goes through P.t here
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  // the same, for HTML: the sentence is escaped, the values are HTML already
  const fillHTML = (s, vals) => esc(t(s)).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const BOOT = Object.assign({ vision: false, photos: 3, daily: 20 }, (P.boot && P.boot.working) || {});
  const MAX = BOOT.photos || 3;
  const SIDE = 1600;
  const math = (el) => { if (P.math) P.math(el); };
  const mtex = (tex) => `\\(${esc(tex)}\\)`;
  const num = (n) => { try { return new Intl.NumberFormat(P.lang || 'en').format(n); } catch (e) { return String(n); } };
  const reduce = () => Boolean(P.motion && P.motion.reduce);

  const svg = (d, size = 20, w = 1.7) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    camera: svg('<path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.3" r="3.6"/>'),
    image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8 8.5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    check: svg('<path d="M4.5 12.8l4.6 4.7L19.8 6.2"/>', 22, 2.6),
    cross: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 22, 2.6),
    query: svg('<path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4"/><path d="M12 18h.01"/>', 22, 2.3),
    carry: svg('<path d="M4.5 12.8l4.6 4.7L19.8 6.2"/>', 22, 2.2),
    dash: svg('<path d="M7 12h10"/>', 22, 2.2),
    calc: svg('<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8 7.5h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/>', 16, 1.6),
    bulb: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>', 18, 1.6),
    zoom: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.6-4.6M11 8.5v5M8.5 11h5"/>', 16, 1.8)
  };

  /* ---------------- which questions ---------------- */

  const CALC = /\b(calculat|solve|find|work out|compute|show that|prove|derive|determine|evaluate|simplify|how (much|many|long|far|fast|high|big))|गणना|हल कीजिए|ज्ञात कीजिए|सिद्ध कीजिए|निकालिए/i;
  const plain = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  function involvesWorking(q) {
    if (!q || !q.prompt) return false;
    if (q.type === 'numeric') return true;
    const mathy = /\\\(|\\\[|\d/.test(q.prompt);
    if (q.type === 'subjective') return mathy && CALC.test(plain(q.prompt));
    if (q.type === 'choice') {
      const cs = q.choices || [];
      return mathy && cs.length > 0 && cs.filter((c) => /\d|\\\(/.test(c)).length >= Math.ceil(cs.length / 2);
    }
    return false;
  }

  // what the learner has typed or chosen in the question, for the checker's context
  function typed(q, w) {
    if (!w) return '';
    if (q.type === 'choice') { const r = w.querySelector('input[type="radio"]:checked'); return r && q.choices ? plain(q.choices[Number(r.value)]) : ''; }
    const el = w.querySelector('.q__input, .q__textarea');
    return el ? String(el.value || '').trim().slice(0, 200) : '';
  }

  /* ---------------- photos ---------------- */

  function loadImg(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  const toData = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(t('That image couldn’t be opened. Try a JPEG or PNG photo.')));
    r.readAsDataURL(blob);
  });
  // A photo made smaller (1600 px on its long side) and re-encoded as JPEG: quick to send, and
  // its metadata (where it was taken) never leaves the device.
  async function shrink(file) {
    if (!file || (file.type && !/^image\//.test(file.type))) throw new Error(t('That file isn’t an image.'));
    if (file.size > 40 * 1024 * 1024) throw new Error(t('That image is too large. Choose a smaller one.'));
    let src, w0, h0, url = null;
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' });
      w0 = src.width; h0 = src.height;
    } catch (e) {
      try { const r = await loadImg(file); src = r.img; url = r.url; w0 = r.width; h0 = r.height; } catch (e2) {
        throw new Error(t('That image couldn’t be opened. Try a JPEG or PNG photo.'));
      }
    }
    const k = Math.min(1, SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, w, h);
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    if (url) URL.revokeObjectURL(url);
    let blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (blob && blob.size > 2_300_000) blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.65));
    if (!blob) throw new Error(t('That image couldn’t be opened. Try a JPEG or PNG photo.'));
    return { blob, data: await toData(blob), url: URL.createObjectURL(blob), width: w, height: h };
  }

  /* ---------------- a photo, larger ---------------- */

  let zoomDlg = null;
  function zoom(url, alt) {
    if (!zoomDlg) {
      zoomDlg = document.createElement('dialog');
      zoomDlg.className = 'wk-zoom';
      zoomDlg.innerHTML = `<button class="wk-zoom__x" type="button" aria-label="${esc(t('Close'))}">×</button><img alt="">`;
      document.body.appendChild(zoomDlg);
      zoomDlg.addEventListener('click', (e) => { if (e.target === zoomDlg || e.target.closest('.wk-zoom__x') || e.target.tagName === 'IMG') zoomDlg.close(); });
    }
    const img = zoomDlg.querySelector('img');
    img.src = url;
    img.alt = alt || '';
    zoomDlg.showModal();
  }

  /* ---------------- words for what the checks found ---------------- */

  const MARKS = {
    ok: { icon: ICON.check, label: 'Correct' },
    wrong: { icon: ICON.cross, label: 'Wrong' },
    carried: { icon: ICON.carry, label: 'Done right, but it carries an earlier mistake' },
    unclear: { icon: ICON.query, label: 'Couldn’t read this line' },
    unchecked: { icon: ICON.dash, label: 'Not checked' },
    note: { icon: '', label: '' },
    pending: { icon: '<span class="wk-dots" aria-hidden="true"><i></i><i></i><i></i></span>', label: 'Being checked' }
  };

  // An exact check's finding, in the interface language, with its maths.
  function exactWhy(r) {
    if (!r) return '';
    if (r.kind === 'arith') return fillHTML('{expr} is {value}, not {wrote}.', { expr: mtex(r.expr), value: mtex(r.value), wrote: mtex(r.wrote) });
    if (r.kind === 'identity') return fillHTML('These two aren’t equal: when {at}, one is {value} and the other is {wrote}.', { at: mtex(r.at), value: mtex(r.value), wrote: mtex(r.wrote) });
    if (r.kind === 'solve') return fillHTML('Step {prev} is true when {name} = {before}, but this line is true when {name} = {after}.', { prev: num(r.prev), name: mtex(r.name), before: mtex(r.before), after: mtex(r.after) });
    return '';
  }

  // [3, 4] -> "3–4"; [2, 5, 7] -> "2, 5 and 7"
  function lineList(ns) {
    const runs = [];
    ns.forEach((n) => { const last = runs[runs.length - 1]; if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]); });
    const parts = runs.map(([a, b]) => (a === b ? num(a) : `${num(a)}–${num(b)}`));
    try { return new Intl.ListFormat(P.lang || 'en', { type: 'conjunction' }).format(parts); } catch (e) { return parts.join(', '); }
  }
  function unclearNote(ns) {
    if (!ns || !ns.length) return '';
    const one = ns.length === 1;
    return `${esc(one ? fill('I couldn’t read line {n}.', { n: num(ns[0]) }) : fill('I couldn’t read lines {lines}.', { lines: lineList(ns) }))} ${esc(t('Try a brighter photo, with the page flat.'))}`;
  }

  function verdictOf(R) {
    if (R.verdict === 'unread') return { cls: 'unread', text: t('I couldn’t read this working.') };
    if (R.verdict === 'wrong') return { cls: 'wrong', text: fill('Step {n} is where it went wrong.', { n: num(R.firstWrong) }) };
    if (R.verdict === 'final') return { cls: 'final', text: t('Your steps look right, but the final answer doesn’t match.') };
    if (R.verdict === 'right') return { cls: 'right', text: t('Every step checks out.') };
    return { cls: 'clean', text: t('I didn’t find a mistake.') };
  }

  const modelName = (m) => String(m || '').replace(/^models\//, '').replace(/:free$/, '');

  /* ---------------- one card: photograph, check, see the marked working ---------------- */

  // opts: { kind: 'lesson', q, w, ctx } or { kind: 'any', ctx }
  function Card(opts) {
    const el = document.createElement('section');
    el.className = 'wk' + (opts.kind === 'any' ? ' wk--any' : '');
    el.hidden = true;
    el.setAttribute('aria-label', t(opts.kind === 'any' ? 'Check any working' : 'Check my working'));
    const st = { photos: [], problem: '', id: null, read: null, result: null, run: 0, view: 'pick' };
    const live = document.createElement('div');
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');

    // in the "Check any working" dialog, the dialog's own title and close button stand for these
    const head = () => (opts.kind === 'any' ? '' : `
      <div class="wk__head">
        <p class="wk__title">${ICON.camera}<span>${esc(t('Check my working'))}</span></p>
        <button class="wk__x" type="button" data-wk-close aria-label="${esc(t('Close'))}">×</button>
      </div>`);
    const say = (msg) => { live.textContent = msg; };
    const paint = (html, after) => {
      el.innerHTML = head() + html;
      el.appendChild(live);
      const x = $('[data-wk-close]', el);
      if (x) x.addEventListener('click', close);
      if (after) after();
      math(el);
    };
    const forget = () => { st.photos.forEach((p) => URL.revokeObjectURL(p.url)); st.photos = []; };

    /* --- picking photos --- */
    function pick(msg) {
      st.view = 'pick';
      paint(`
        <p class="wk__lead">${esc(t('Photograph the working on your page. I’ll read each line and show you exactly where it went wrong, and why.'))}</p>
        ${opts.kind === 'any' ? `<label class="wk__label" for="wk-problem">${esc(t('The problem'))} <small>${esc(t('(if it isn’t on the page)'))}</small></label>
          <textarea class="wk__problem" id="wk-problem" rows="2" maxlength="1500" placeholder="${esc(t('For example: A car speeds up from 10 m/s to 30 m/s in 5 s. Find its acceleration.'))}">${esc(st.problem)}</textarea>` : ''}
        <div class="wk__pick">
          <button class="wk__pickbtn" type="button" data-wk-camera>${ICON.camera}<span>${esc(t('Take a photo'))}</span></button>
          <button class="wk__pickbtn" type="button" data-wk-gallery>${ICON.image}<span>${esc(t('Choose from gallery'))}</span></button>
        </div>
        <p class="wk__tip">${esc(t('Write one step on each line. Lay the page flat, in good light, with all the working in the photo.'))} ${esc(fill('A long working can take up to {n} photos.', { n: num(MAX) }))}</p>
        <p class="wk__privacy">${esc(t('Your photo is made smaller on this device and sent only to read your working. Primer doesn’t keep it.'))}</p>
        <p class="wk__err" role="alert">${esc(msg || '')}</p>
        <input type="file" accept="image/*" capture="environment" hidden data-in-camera>
        <input type="file" accept="image/*" multiple hidden data-in-gallery>`, () => {
        bindInputs();
        const prob = $('#wk-problem', el);
        if (prob) prob.addEventListener('input', () => { st.problem = prob.value; });
      });
    }
    function bindInputs() {
      const cam = $('[data-in-camera]', el), gal = $('[data-in-gallery]', el);
      $$('[data-wk-camera]', el).forEach((b) => b.addEventListener('click', () => cam.click()));
      $$('[data-wk-gallery], [data-wk-more]', el).forEach((b) => b.addEventListener('click', () => gal.click()));
      [cam, gal].forEach((inp) => inp.addEventListener('change', () => {
        const files = Array.from(inp.files || []);
        inp.value = '';
        if (files.length) add(files);
      }));
    }
    async function add(files) {
      let err = '';
      for (const f of files) {
        if (st.photos.length >= MAX) { err = fill('Add up to {n} photos at a time.', { n: num(MAX) }); break; }
        try { st.photos.push(await shrink(f)); } catch (e) { err = e.message; }
      }
      if (st.photos.length) preview(err); else pick(err);
    }

    /* --- the photos, before checking --- */
    function shots(cls = '') {
      return `<ul class="wk__shots ${cls}" aria-label="${esc(t('Your photos'))}">${st.photos.map((p, i) => `
        <li class="wk__shot">
          <button class="wk__shotimg" type="button" data-zoom="${i}" aria-label="${esc(fill('See photo {n} larger', { n: num(i + 1) }))}"><img src="${esc(p.url)}" alt=""></button>
          ${cls ? '' : `<button class="wk__shotx" type="button" data-remove="${i}" aria-label="${esc(fill('Remove photo {n}', { n: num(i + 1) }))}">×</button>`}
        </li>`).join('')}
        ${!cls && st.photos.length < MAX ? `<li class="wk__shot"><button class="wk__add" type="button" data-wk-more>${ICON.plus}<span>${esc(t('Add a page'))}</span></button></li>` : ''}
      </ul>`;
    }
    function bindShots() {
      $$('[data-zoom]', el).forEach((b) => b.addEventListener('click', () => {
        const p = st.photos[Number(b.dataset.zoom)];
        if (p) zoom(p.url, fill('Photo {n} of your working', { n: num(Number(b.dataset.zoom) + 1) }));
      }));
      $$('[data-remove]', el).forEach((b) => b.addEventListener('click', () => {
        const i = Number(b.dataset.remove);
        const p = st.photos[i];
        if (p) URL.revokeObjectURL(p.url);
        st.photos.splice(i, 1);
        if (st.photos.length) preview(); else pick();
      }));
    }
    function preview(msg) {
      st.view = 'preview';
      paint(`
        ${shots()}
        <p class="wk__tip">${esc(t('Can you read every line in the photo? If not, retake it.'))}</p>
        <p class="wk__err" role="alert">${esc(msg || '')}</p>
        <div class="wk__actions">
          <button class="btn btn--small wk__go" type="button" data-wk-check>${ICON.check}<span>${esc(t('Check'))}</span></button>
          <button class="textlink" type="button" data-wk-retake>${esc(t('Retake'))}</button>
        </div>
        <input type="file" accept="image/*" capture="environment" hidden data-in-camera>
        <input type="file" accept="image/*" multiple hidden data-in-gallery>`, () => {
        bindInputs();
        bindShots();
        $('[data-wk-check]', el).addEventListener('click', go);
        $('[data-wk-retake]', el).addEventListener('click', () => { forget(); pick(); focusFirst(); });
      });
      const b = $('[data-wk-check]', el);
      if (b) b.focus({ preventScroll: true });
    }

    /* --- reading and checking --- */
    function busy(stage, steps) {
      st.view = 'busy';
      const stages = ['Reading your working…', 'Checking each step…', 'Finding the first mistake…'];
      paint(`
        <div class="wk__busy" role="status">
          <div class="wk__scan${stage === 0 ? ' is-on' : ''}">${st.photos[0] ? `<img src="${esc(st.photos[0].url)}" alt="">` : ''}<span class="wk__beam" aria-hidden="true"></span>${st.photos.length > 1 ? `<span class="wk__count">${esc(fill('{n} photos', { n: num(st.photos.length) }))}</span>` : ''}</div>
          <ol class="wk__stages">${stages.map((s, i) => `<li class="${i < stage ? 'is-done' : i === stage ? 'is-active' : ''}">${esc(t(s))}</li>`).join('')}</ol>
        </div>
        ${steps ? `<p class="wk-cap">${esc(fill(steps.length === 1 ? 'I read {n} line.' : 'I read {n} lines.', { n: num(steps.length) }))}</p>${stepList(steps, null, true)}` : ''}`);
      say(t(stages[stage]));
    }
    function payload() {
      const ctx = opts.ctx || {};
      const lang = typeof ctx.lang === 'function' ? ctx.lang() : ctx.lang;
      const body = { images: st.photos.map((p) => p.data), lang: lang || P.lang || 'en' };
      if (opts.kind === 'lesson') {
        const course = ctx.course();
        Object.assign(body, { courseId: course.id, n: ctx.n, qid: opts.q.id, answer: typed(opts.q, opts.w) });
        // a sample course's lesson lives in this browser, so its question goes along
        if (course.source === 'sample') {
          const q = opts.q;
          body.question = { type: q.type, prompt: plain(q.prompt), answer: q.answer, tolerance: q.tolerance, unit: q.unit, explain: plain(q.explain), choices: (q.choices || []).map(plain), accept: q.accept, model: plain(q.model) };
        }
      } else {
        body.problem = String(st.problem || '').trim().slice(0, 1500);
      }
      return body;
    }
    async function go() {
      if (!st.photos.length) return pick();
      const mine = ++st.run;
      st.id = null; st.read = null; st.result = null;
      busy(0);
      let r;
      try {
        r = await P.post('/api/working/read', payload(), { timeout: 170000, timeoutMessage: t('Reading your working took too long. Try again.') });
      } catch (err) {
        if (mine !== st.run || err.status === 401) return;
        return failed(err.message, go);
      }
      if (mine !== st.run) return;
      st.id = r.id;
      st.read = r;
      if (!r.readable) {
        const steps = (r.steps || []).map((s) => ({ ...s, mark: s.unclear ? 'unclear' : 'unchecked', by: null }));
        return result({ verdict: 'unread', steps, unclear: r.unclear || [], counts: { exact: 0, ai: 0, unclear: steps.length, steps: steps.length }, final: {}, summary: '', hint: '', models: { reader: r.model } });
      }
      busy(1, r.steps.map((s) => ({ ...s, mark: s.unclear ? 'unclear' : s.exact ? (s.exact.status === 'wrong' ? 'wrong' : 'ok') : s.tex ? 'pending' : 'note', by: s.exact ? 'exact' : null })));
      judge(mine);
    }
    async function judge(mine, steps) {
      try {
        const body = { id: st.id };
        if (steps) body.steps = steps;
        const c = await P.post('/api/working/check', body, { timeout: 130000, timeoutMessage: t('Checking took too long. Try again.') });
        if (mine !== st.run) return;
        st.result = c.result;
        result(c.result);
      } catch (err) {
        if (mine !== st.run || err.status === 401) return;
        failed(err.message, () => { const m = ++st.run; busy(1); judge(m, steps); });
      }
    }
    function failed(message, again) {
      st.view = 'error';
      paint(`
        ${st.photos.length ? shots('is-small') : ''}
        <p class="wk__err" role="alert">${esc(message || t('Something went wrong.'))}</p>
        <div class="wk__actions">
          <button class="btn btn--small" type="button" data-wk-again>${esc(t('Try again'))}</button>
          <button class="textlink" type="button" data-wk-retake>${esc(t('Take another photo'))}</button>
        </div>`, () => {
        bindShots();
        $('[data-wk-again]', el).addEventListener('click', again);
        $('[data-wk-retake]', el).addEventListener('click', () => { forget(); pick(); focusFirst(); });
      });
    }

    /* --- the marked working --- */
    function byLine(s, R) {
      if (s.mark === 'carried') {
        const carry = esc(R && R.firstWrong ? fill('Done right, but it carries the mistake from step {n}', { n: num(R.firstWrong) }) : t('Done right, but it carries an earlier mistake'));
        return s.by === 'exact' ? `<span class="wk-tag wk-tag--exact">${ICON.calc}${esc(t('Checked exactly'))}</span> ${carry}` : carry;
      }
      if (s.mark === 'unclear') return esc(t('Couldn’t read this line'));
      if (s.mark === 'pending') return esc(t('Checking…'));
      if (s.mark === 'note' || s.mark === 'unchecked') return '';
      if (s.by === 'exact') return `<span class="wk-tag wk-tag--exact">${ICON.calc}${esc(t(s.exact && s.exact.rounded ? 'Checked exactly (rounded)' : 'Checked exactly'))}</span>`;
      if (s.by === 'ai') return `<span class="wk-tag wk-tag--ai">${esc(t('Checked by the AI'))}</span>`;
      return '';
    }
    function stepList(steps, R, pending) {
      return `<ol class="wk-steps${pending ? ' is-pending' : ''}">${steps.map((s) => {
        const first = R && R.firstWrong === s.n;
        const M = MARKS[s.mark] || MARKS.unchecked;
        const why = s.mark === 'wrong' ? [s.why ? `<p class="wk-step__say">${esc(s.why)}</p>` : '', s.exact && s.exact.status === 'wrong' && s.exact.reason ? `<p class="wk-step__calc">${ICON.calc}<span>${exactWhy(s.exact.reason)}</span></p>` : ''].join('') : '';
        const words = s.text ? `<span class="wk-step__words" dir="auto">${esc(s.text)}</span>` : '';
        const maths = s.tex ? `<span class="wk-step__math">${mtex(s.tex)}</span>` : '';
        return `<li class="wk-step is-${esc(s.mark)}${first ? ' is-first' : ''}">
          <span class="wk-step__n" aria-hidden="true">${num(s.n)}</span>
          <span class="wk-step__mark" aria-hidden="true">${M.icon}</span>
          <div class="wk-step__body">
            <p class="wk-step__line"><span class="sr-only">${esc(fill('Step {n}', { n: num(s.n) }))}${M.label ? `, ${esc(t(M.label))}` : ''}: </span>${words}${words && maths ? ' ' : ''}${maths || (s.unclear && !words ? '<span class="wk-step__blank">?</span>' : '')}</p>
            ${byLine(s, R) ? `<p class="wk-step__by">${byLine(s, R)}</p>` : ''}
            ${why ? `<div class="wk-step__why">${first ? `<p class="wk-step__flag">${esc(t('Here’s the mistake'))}</p>` : ''}${why}</div>` : ''}
          </div>
        </li>`;
      }).join('')}</ol>`;
    }
    function result(R) {
      st.view = 'result';
      const v = verdictOf(R);
      const fm = R.final && R.final.matches;
      const finalTex = R.finalTex || '';
      const finalLine = finalTex
        ? fillHTML(fm === true ? 'Your final answer, {answer}, matches.' : fm === false ? 'Your final answer, {answer}, doesn’t match.' : 'Your final answer: {answer}.', { answer: mtex(finalTex) })
        : '';
      const c = R.counts || {};
      const reader = modelName(R.models && R.models.reader), judgeM = modelName(R.models && R.models.judge);
      const honest = [
        c.exact ? esc(fill(c.exact === 1 ? '1 step was checked exactly, by calculation.' : '{n} steps were checked exactly, by calculation.', { n: num(c.exact) })) : '',
        c.ai ? esc(fill(c.ai === 1 ? '1 was checked by the AI{model}.' : '{n} were checked by the AI{model}.', { n: num(c.ai), model: judgeM ? ` (${judgeM})` : '' })) : '',
        R.judged === false && R.verdict !== 'unread' ? esc(t('The AI couldn’t check the rest just now, so only the arithmetic and algebra were checked.')) : '',
        c.ai || reader ? esc(t('AI reading and checking can be wrong.')) : ''
      ].filter(Boolean).join(' ');
      const hasMarks = R.steps && R.steps.some((s) => s.mark !== 'note');
      const sumLabel = R.verdict === 'wrong' || R.verdict === 'final' ? 'What went wrong' : 'What you did well';
      paint(`
        <div class="wk-res is-${v.cls}">
          <div class="wk-res__head">
            ${st.photos.length ? `<button class="wk-res__thumb" type="button" data-zoom="0" aria-label="${esc(t('See your photo larger'))}"><img src="${esc(st.photos[0].url)}" alt="">${st.photos.length > 1 ? `<span>+${num(st.photos.length - 1)}</span>` : ''}<i>${ICON.zoom}</i></button>` : ''}
            <div class="wk-res__said">
              <p class="wk-res__eyebrow">${esc(t('Your working, checked'))}</p>
              <p class="wk-res__verdict">${esc(v.text)}</p>
              ${finalLine ? `<p class="wk-res__final is-${fm === true ? 'yes' : fm === false ? 'no' : 'na'}">${finalLine}</p>` : ''}
            </div>
          </div>
          ${R.unclear && R.unclear.length ? `<p class="wk-res__unclear">${ICON.query}<span>${unclearNote(R.unclear)}</span></p>` : ''}
          ${R.verdict === 'unread' ? `<p class="wk-res__unclear">${ICON.query}<span>${esc(t('Try a brighter photo, with the page flat and all the working in view.'))}</span></p>` : ''}
          ${hasMarks ? `<p class="wk-cap">${esc(t('What I read, line by line'))}</p>${stepList(R.steps, R)}` : ''}
          ${R.summary ? `<div class="wk-say wk-say--${R.verdict === 'wrong' || R.verdict === 'final' ? 'wrong' : 'good'}"><p class="wk-say__label">${esc(t(sumLabel))}</p><p dir="auto">${esc(R.summary)}</p></div>` : ''}
          ${R.hint ? `<div class="wk-say wk-say--hint"><p class="wk-say__label">${ICON.bulb}<span>${esc(t('A hint for your next try'))}</span></p><p dir="auto">${esc(R.hint)}</p></div>` : ''}
          ${honest ? `<p class="wk-res__honest">${honest}</p>` : ''}
          <div class="wk__actions">
            ${R.judged === false && st.id && R.verdict !== 'unread' ? `<button class="btn btn--small" type="button" data-wk-rejudge>${esc(t('Ask the AI again'))}</button>` : ''}
            <button class="${R.judged === false ? 'textlink' : 'btn btn--small'}" type="button" data-wk-retake>${ICON.camera}<span>${esc(t('Check another photo'))}</span></button>
            ${st.id && hasMarks ? `<button class="textlink" type="button" data-wk-edit>${esc(t('Fix a line I misread'))}</button>` : ''}
            ${P.notebook && opts.kind === 'lesson' && hasMarks ? `<button class="textlink" type="button" data-wk-save>${esc(t('Save to notebook'))}</button>` : ''}
          </div>
        </div>`, () => {
        bindShots();
        $('[data-wk-retake]', el).addEventListener('click', () => { forget(); pick(); focusFirst(); });
        const ed = $('[data-wk-edit]', el);
        if (ed) ed.addEventListener('click', () => edit(R));
        const sv = $('[data-wk-save]', el);
        if (sv) sv.addEventListener('click', () => { P.notebook.append(notebookText(R)); sv.disabled = true; sv.textContent = t('Saved to your notebook'); });
        const rj = $('[data-wk-rejudge]', el);
        if (rj) rj.addEventListener('click', () => { const m = ++st.run; busy(1); judge(m); });
      });
      if (P.contentLang && opts.ctx) {
        const lang = typeof opts.ctx.lang === 'function' ? opts.ctx.lang() : opts.ctx.lang;
        $$('.wk-say p[dir], .wk-step__say', el).forEach((p) => P.contentLang(p, lang));
      }
      say(v.text);
      const first = $('.wk-step.is-first', el);
      if (first && !reduce()) first.classList.add('is-arriving');
      el.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'nearest' });
    }

    /* --- fixing lines read wrong --- */
    function edit(R) {
      st.view = 'edit';
      const steps = R.steps;
      paint(`
        <p class="wk-cap">${esc(t('Fix any line I read wrong, then check again. Write maths plainly, like 2x + 3 = 7 or v = u + at.'))}</p>
        <ol class="wk-edit">${steps.map((s, i) => `
          <li><label class="wk-edit__n" for="wk-e-${i}">${num(s.n)}</label>
            <div class="wk-edit__row">${s.text ? `<span class="wk-edit__words" dir="auto">${esc(s.text)}</span>` : ''}
            <input class="wk-edit__in" id="wk-e-${i}" type="text" value="${esc(s.tex)}" spellcheck="false" autocomplete="off" autocapitalize="off" data-i="${i}" aria-label="${esc(fill('Step {n}', { n: num(s.n) }))}"></div></li>`).join('')}</ol>
        <div class="wk__actions">
          <button class="btn btn--small" type="button" data-wk-recheck>${esc(t('Check again'))}</button>
          <button class="textlink" type="button" data-wk-cancel>${esc(t('Cancel'))}</button>
        </div>`, () => {
        $('[data-wk-cancel]', el).addEventListener('click', () => result(R));
        $('[data-wk-recheck]', el).addEventListener('click', () => {
          const list = steps.map((s, i) => ({ text: s.text, tex: ($(`#wk-e-${i}`, el) || {}).value || '' }));
          const m = ++st.run;
          busy(1);
          judge(m, list);
        });
        const firstIn = $('.wk-edit__in', el);
        if (firstIn) firstIn.focus({ preventScroll: true });
      });
    }

    function notebookText(R) {
      const sym = { ok: '✓', wrong: '✗', carried: '↪', unclear: '?', unchecked: '·', note: '' };
      const date = (() => { try { return new Intl.DateTimeFormat(P.lang || 'en', { dateStyle: 'medium' }).format(new Date()); } catch (e) { return new Date().toDateString(); } })();
      const lines = [fill('My working, checked ({date})', { date })];
      if (opts.q) lines.push(plain(opts.q.prompt));
      R.steps.forEach((s) => lines.push(`${sym[s.mark] || ''} ${num(s.n)}. ${[s.text, s.tex].filter(Boolean).join(' ')}${s.mark === 'wrong' && s.why ? ` — ${s.why}` : ''}`.trim()));
      if (R.summary) lines.push(`${t(R.verdict === 'wrong' || R.verdict === 'final' ? 'What went wrong' : 'What you did well')}: ${R.summary}`);
      if (R.hint) lines.push(`${t('A hint for your next try')}: ${R.hint}`);
      return lines.join('\n');
    }

    function focusFirst() {
      const b = $('[data-wk-camera]', el);
      if (b) b.focus({ preventScroll: true });
    }
    function open() {
      el.hidden = false;
      if (st.view === 'pick' || !el.innerHTML) pick();
      el.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'nearest' });
      if (st.view === 'pick') focusFirst();
    }
    function close() {
      st.run++;
      forget();
      st.view = 'pick';
      el.hidden = true;
      el.innerHTML = '';
      const back = opts.w && opts.w.querySelector('[data-wk-open]');
      if (back) back.focus({ preventScroll: true });
    }
    return { el, open, close };
  }

  /* ---------------- on a question ---------------- */

  function cardFor(q, w, ctx) {
    if (!w._wk) {
      w._wk = Card({ kind: 'lesson', q, w, ctx });
      w.after(w._wk.el); // beside the question's form, so locking the question never locks the card
    }
    return w._wk;
  }

  function attach(q, w, ctx) {
    if (!BOOT.vision || !w || !involvesWorking(q)) return;
    const actions = w.querySelector('.q__actions');
    if (!actions || actions.querySelector('[data-wk-open]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wk-open';
    b.dataset.wkOpen = '';
    b.innerHTML = `${ICON.camera}<span>${esc(t('Check my working'))}</span>`;
    b.addEventListener('click', () => cardFor(q, w, ctx).open());
    actions.appendChild(b);
  }

  function offer(q, w, panel, ctx) {
    if (!BOOT.vision || !panel || !involvesWorking(q) || panel.querySelector('.wk-offer')) return;
    const box = document.createElement('div');
    box.className = 'wk-offer';
    box.innerHTML = `<span class="wk-offer__icon">${ICON.camera}</span>
      <p class="wk-offer__text">${esc(t('Photograph your working and I’ll find the mistake.'))}</p>
      <button class="btn btn--small wk-offer__go" type="button">${esc(t('Check my working'))}</button>`;
    // the card opens just below the question, so the offer steps aside
    box.querySelector('button').addEventListener('click', () => { box.hidden = true; cardFor(q, w, ctx).open(); });
    const acts = panel.querySelector('.q__revise-actions');
    if (acts) acts.before(box); else panel.appendChild(box);
  }

  /* ---------------- "Check any working" ---------------- */

  let anyDlg = null, anyCard = null;
  function any(ctx) {
    if (!BOOT.vision) return;
    if (!anyDlg) {
      anyDlg = document.createElement('dialog');
      anyDlg.className = 'wk-dlg';
      anyDlg.setAttribute('aria-labelledby', 'wk-dlg-title');
      anyDlg.innerHTML = `<div class="wk-dlg__head"><h2 id="wk-dlg-title">${esc(t('Check any working'))}</h2><button class="wk__x" type="button" data-close aria-label="${esc(t('Close'))}">×</button></div>
        <p class="wk-dlg__lead">${esc(t('A problem from your book, a worksheet or a past paper: photograph it with your working, and I’ll check every step.'))}</p>`;
      document.body.appendChild(anyDlg);
      anyDlg.addEventListener('click', (e) => { if (e.target === anyDlg || e.target.closest('[data-close]')) anyDlg.close(); });
      anyDlg.addEventListener('close', () => { if (anyCard) anyCard.close(); });
    }
    if (anyCard) anyCard.el.remove();
    anyCard = Card({ kind: 'any', ctx: ctx || {} });
    anyDlg.appendChild(anyCard.el);
    anyDlg.showModal();
    anyCard.open();
  }

  // On a lesson with questions worked on paper, "Check any working" sits under the lesson's title.
  document.addEventListener('primer:lesson', (e) => {
    const d = e.detail || {};
    if (!BOOT.vision || !d.sections || !d.sections.some((s) => (s.checkpoint || []).some(involvesWorking))) return;
    const headEl = $('#lhead');
    if (!headEl || headEl.querySelector('.wk-entry')) return;
    const p = document.createElement('p');
    p.className = 'wk-entry';
    p.innerHTML = `${ICON.camera}<span>${esc(t('Stuck on a problem from your book?'))}</span> <button class="textlink" type="button">${esc(t('Check any working'))}</button>`;
    p.querySelector('button').addEventListener('click', () => {
      const course = d.course ? d.course() : null;
      const lang = course && P.api ? (d.lesson && d.lesson.translated ? P.lang : P.api.lessonLang(course)) : P.lang;
      any({ lang });
    });
    headEl.appendChild(p);
  });

  P.working = { attach, offer, any, involvesWorking };
})();
