/* =====================================================================
   "Start from… A photo" and "A textbook page" (app.html), served by
   server/sources-in.mjs.

   A photo: take one (the camera opens on a phone) or upload one. It is
   made smaller here, then a vision model names the main thing in it and
   says how sure it is, with alternatives when it isn't. The learner
   confirms or corrects it, picks a size (a short lesson, a short unit,
   a full course) and what about it to learn (how it works, how it's
   made, its history, ethics, uses, a mix, or their own angle), and the
   course is planned. The photo is forgotten unless they keep it as the
   course's cover.

   A textbook page: photos of up to six pages, read one at a time into
   text (headings kept, equations in LaTeX, in the page's language). The
   learner checks and corrects the text, then turns it into a lesson or
   a short course in the language they choose, built only from that
   text (POST /api/start/knowledge with kind "page").
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer, SF = P && P.startFrom;
  if (!SF) return;
  const $ = P.$, $$ = P.$$, esc = P.esc, t = SF.t, fill = SF.fill;
  const MAX_PAGES = SF.boot.maxPages || 6;
  const CAMERA = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.3" r="3.6"/></svg>';
  const IMAGE = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8 8.5"/></svg>';

  const noVision = () => `<p class="sf-note sf-note--warn">${esc(t('Reading photos needs a Gemini, Groq or OpenRouter key on the server.'))}</p>`;
  const pickHTML = (what) => `
    <div class="sf-pick">
      <button class="sf-pick__btn" type="button" data-pick-camera${SF.boot.vision ? '' : ' disabled'}>${CAMERA}<span>${esc(t('Take a photo'))}</span></button>
      <button class="sf-pick__btn" type="button" data-pick-file${SF.boot.vision ? '' : ' disabled'}>${IMAGE}<span>${esc(t(what))}</span></button>
    </div>`;

  /* ==================================================================
     A photo
  ================================================================== */
  const ANGLES = [
    ['works', 'How it works'], ['made', 'How it’s made'], ['history', 'Its history'],
    ['ethics', 'Ethics around it'], ['uses', 'Its uses'], ['mix', 'A mix of these']
  ];
  const SURE = { sure: 'Sure', fairly: 'Fairly sure', unsure: 'Not sure' };

  SF.panels.photo = { title: 'A photo', render: renderPhoto };

  function renderPhoto(body) {
    body.innerHTML = `
      <div data-step="pick">
        <p class="sf-lead">Take a photo of something you’re curious about: a plant, a machine, a building, a painting. Primer works out what it is, then builds a lesson or a course on it.</p>
        ${SF.boot.vision ? '' : noVision()}
        ${pickHTML('Upload an image')}
        <input type="file" accept="image/*" capture="environment" hidden data-in-camera>
        <input type="file" accept="image/*" hidden data-in-file>
        <p class="help">Your photo is made smaller on this device and sent to an AI model only to see what’s in it. Primer doesn’t keep it, unless you choose to keep it as the course’s cover.</p>
        <p class="field__error" data-err role="alert"></p>
      </div>
      <div data-step="look" hidden>
        <div class="sf-look">
          <figure class="sf-shot"><img data-shot alt="Your photo"></figure>
          <div class="sf-look__main" data-result aria-live="polite"></div>
        </div>
        <form class="sf-form" data-form novalidate hidden>
          <fieldset class="field sf-sizes">
            <legend class="label">How much?</legend>
            <label class="sf-card"><input type="radio" name="sfp-size" value="lesson"><span class="sf-card__t">A short lesson</span><span class="sf-card__d">One lesson, about 15 minutes</span></label>
            <label class="sf-card"><input type="radio" name="sfp-size" value="unit" checked><span class="sf-card__t">A short unit</span><span class="sf-card__d">3 to 6 lessons</span></label>
            <label class="sf-card"><input type="radio" name="sfp-size" value="course"><span class="sf-card__t">A full course</span><span class="sf-card__d">As many lessons as it needs</span></label>
          </fieldset>
          <fieldset class="field">
            <legend class="label">What about it? <small>choose any</small></legend>
            <div class="chips" data-angles>${ANGLES.map(([k, l]) => `<button class="chip" type="button" aria-pressed="false" data-angle="${k}">${esc(t(l))}</button>`).join('')}</div>
            <label class="help" for="sfp-custom">Or your own angle</label>
            <input class="input" id="sfp-custom" type="text" maxlength="300" autocomplete="off" placeholder="e.g. its place in Indian festivals">
          </fieldset>
          <div class="sf-row">
            <div class="field">
              <label class="label" for="sfp-lang">Course language</label>
              <select class="input select" id="sfp-lang">${SF.langOptions(SF.defaultLang())}</select>
            </div>
          </div>
          <label class="sf-check"><input type="checkbox" id="sfp-keep"> <span>Keep my photo as the course’s cover (only you can see it)</span></label>
          <p class="field__error" data-form-err role="alert"></p>
          <div class="sf-actions">
            <button class="btn" type="submit">Build it</button>
            <button class="textlink" type="button" data-again>Use another photo</button>
          </div>
        </form>
      </div>`;

    const stepPick = $('[data-step="pick"]', body), stepLook = $('[data-step="look"]', body);
    const camIn = $('[data-in-camera]', body), fileIn = $('[data-in-file]', body);
    const pickErr = $('[data-err]', body), shot = $('[data-shot]', body), result = $('[data-result]', body);
    const form = $('[data-form]', body), formErr = $('[data-form-err]', body);
    let photo = null;   // { blob, url, width, height }
    let seen = null;    // what the server said: { result, sure, token }
    let run = 0;

    $('[data-pick-camera]', body).addEventListener('click', () => camIn.click());
    $('[data-pick-file]', body).addEventListener('click', () => fileIn.click());
    [camIn, fileIn].forEach((inp) => inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) look(f); }));

    function forget() { if (photo) URL.revokeObjectURL(photo.url); photo = null; seen = null; }
    function backToPick(msg) {
      run++;
      forget();
      stepLook.hidden = true;
      stepPick.hidden = false;
      form.hidden = true;
      pickErr.textContent = msg || '';
      const b = $('[data-pick-camera]', body);
      if (b) b.focus();
    }
    $('[data-again]', body).addEventListener('click', () => backToPick(''));

    async function look(file) {
      const mine = ++run;
      pickErr.textContent = '';
      forget();
      try { photo = await SF.prepImage(file, 1280, 0.85); } catch (e) { pickErr.textContent = e.message; return; }
      stepPick.hidden = true;
      stepLook.hidden = false;
      form.hidden = true;
      shot.src = photo.url;
      result.innerHTML = `<p class="sf-wait__lead"><span class="sf-dots" aria-hidden="true"><i></i><i></i><i></i></span> <span>${esc(t('Looking at your photo…'))}</span></p>`;
      try {
        const d = await SF.sendImage(`/api/start/photo/identify?lang=${encodeURIComponent(SF.defaultLang())}`, photo.blob);
        if (mine !== run) return;
        seen = d;
        showGuess(d);
      } catch (e) {
        if (mine !== run) return;
        result.innerHTML = `<p class="field__error">${esc(e.message)}</p><p><button class="textlink" type="button" data-retry>${esc(t('Try again'))}</button> · <button class="textlink" type="button" data-other>${esc(t('Use another photo'))}</button></p>`;
        $('[data-retry]', result).addEventListener('click', () => look(file));
        $('[data-other]', result).addEventListener('click', () => backToPick(''));
      }
    }

    function showGuess(d) {
      const r = d.result;
      const opts = r.name ? [{ name: r.name, english: r.english }].concat(r.alternatives || []) : [];
      const lead = !r.name ? 'I couldn’t make out what’s in this photo. What is it?'
        : d.sure === 'unsure' ? 'I’m not sure what this is. Is it one of these?' : 'This looks like';
      result.innerHTML = `
        <p class="sf-guess__lead">${esc(t(lead))}</p>
        <div class="sf-guess" role="radiogroup" aria-label="${esc(t('What the photo shows'))}">
          ${opts.map((o, i) => `<label class="sf-opt"><input type="radio" name="sfp-what" value="${i}"${i === 0 ? ' checked' : ''}>
            <span class="sf-opt__name ugc">${esc(o.name)}</span>${i === 0 && d.sure ? `<span class="sf-sure sf-sure--${d.sure}">${esc(t(SURE[d.sure]))}</span>` : ''}</label>`).join('')}
          <label class="sf-opt sf-opt--other"><input type="radio" name="sfp-what" value="other"${opts.length ? '' : ' checked'}>
            <span>${esc(t('Something else:'))}</span> <input class="input input--inline" type="text" maxlength="120" data-other-name aria-label="${esc(t('What it is'))}" placeholder="${esc(t('Name it'))}"></label>
        </div>
        ${r.description ? `<p class="help ugc">${esc(r.description)}</p>` : ''}`;
      if (P.contentLang) P.contentLang(result, SF.defaultLang());
      const other = $('[data-other-name]', result);
      other.addEventListener('focus', () => { $('input[value="other"]', result).checked = true; syncOpts(); });
      result.addEventListener('change', syncOpts);
      syncOpts();
      form.hidden = false;
      $('#sfp-keep', form).disabled = !d.token;
      if (!d.token) $('#sfp-keep', form).closest('.sf-check').hidden = true;
      if (!opts.length) other.focus();
    }
    function syncOpts() {
      $$('.sf-opt', result).forEach((l) => l.classList.toggle('is-checked', l.querySelector('input[type=radio]').checked));
    }
    function chosen() {
      const r = seen && seen.result;
      const v = ($('input[name="sfp-what"]:checked', result) || {}).value;
      if (v === 'other' || !r) return { topic: P.clean(($('[data-other-name]', result) || {}).value, 120), english: '' };
      const opts = [{ name: r.name, english: r.english }].concat(r.alternatives || []);
      const o = opts[Number(v)] || opts[0];
      return { topic: o.name, english: o.english || '' };
    }

    // angles: "A mix of these" stands alone; picking another unpicks it
    $('[data-angles]', form).addEventListener('click', (e) => {
      const b = e.target.closest('[data-angle]');
      if (!b) return;
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      if (on) $$('[data-angle]', form).forEach((x) => { if (x !== b && (x.dataset.angle === 'mix' || b.dataset.angle === 'mix')) x.setAttribute('aria-pressed', 'false'); });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      formErr.textContent = '';
      const what = chosen();
      if (!what.topic) {
        formErr.textContent = t('Say what the photo shows first.');
        const o = $('[data-other-name]', result);
        if (o) { o.focus(); P.shake(o); }
        return;
      }
      const keep = $('#sfp-keep', form).checked && seen && seen.token;
      SF.build({
        form,
        url: '/api/start/photo/course',
        payload: {
          topic: what.topic, english: what.english,
          size: ($('input[name="sfp-size"]:checked', form) || {}).value || 'unit',
          angles: SF.pressed(form, 'data-angle'),
          custom: P.clean($('#sfp-custom', form).value, 300),
          lang: $('#sfp-lang', form).value,
          keepPhoto: Boolean(keep), token: keep ? seen.token : null,
          width: photo && photo.width, height: photo && photo.height,
          folderId: SF.folderId()
        },
        steps: ['Choosing what to teach about it', 'Putting the lessons in order', 'Writing a line about each lesson'],
        onError(er) { formErr.textContent = er.message; }
      });
    });

    return () => { run++; forget(); };
  }

  /* ==================================================================
     A textbook page
  ================================================================== */
  SF.panels.page = { title: 'A textbook page', render: renderPage };

  function renderPage(body) {
    body.innerHTML = `
      <div data-step="pages">
        <p class="sf-lead">Photograph a page of your textbook or notes, or a few pages. Primer reads them, you check the text, and it becomes a lesson or a short course in the language you choose.</p>
        ${SF.boot.vision ? '' : noVision()}
        ${pickHTML('Upload pages')}
        <input type="file" accept="image/*" capture="environment" hidden data-in-camera>
        <input type="file" accept="image/*" multiple hidden data-in-file>
        <ol class="sf-pages" data-list aria-label="Your pages"></ol>
        <p class="help" data-pages-help></p>
        <p class="field__error" data-err role="alert"></p>
        <div class="sf-actions"><button class="btn" type="button" data-read disabled>Read the pages</button><button class="textlink" type="button" data-sf-close>Cancel</button></div>
      </div>
      <div data-step="text" hidden>
        <div data-status role="status" aria-live="polite"></div>
        <form class="sf-form" data-form novalidate hidden>
          <div class="field">
            <div class="sf-labelrow"><label class="label" for="sfg-text">The text on the page</label><span class="help" data-found-lang></span></div>
            <textarea class="textarea sf-material sf-material--page" id="sfg-text" rows="13" aria-describedby="sfg-text-help"></textarea>
            <p class="help" id="sfg-text-help">Check it against the page and fix anything read wrong. Equations are written in LaTeX, between \\( and \\).</p>
          </div>
          <div class="sf-row">
            <div class="field sf-grow">
              <label class="label" for="sfg-title">Title</label>
              <input class="input" id="sfg-title" type="text" maxlength="120" autocomplete="off">
            </div>
            <div class="field">
              <label class="label" for="sfg-lang">Teach it in</label>
              <select class="input select" id="sfg-lang">${SF.langOptions(SF.defaultLang())}</select>
            </div>
          </div>
          <fieldset class="field sf-sizes sf-sizes--two">
            <legend class="label">Turn it into</legend>
            <label class="sf-card"><input type="radio" name="sfg-size" value="lesson" checked><span class="sf-card__t">A lesson</span><span class="sf-card__d">One lesson from the whole text</span></label>
            <label class="sf-card"><input type="radio" name="sfg-size" value="short"><span class="sf-card__t">A short course</span><span class="sf-card__d">2 to 5 lessons</span></label>
          </fieldset>
          <p class="sf-note">The lesson teaches only what the page says, and keeps its terms.</p>
          <p class="field__error" data-form-err role="alert"></p>
          <div class="sf-actions">
            <button class="btn" type="submit">Build it</button>
            <button class="textlink" type="button" data-back>Add or change pages</button>
          </div>
        </form>
      </div>`;

    const stepPages = $('[data-step="pages"]', body), stepText = $('[data-step="text"]', body);
    const camIn = $('[data-in-camera]', body), fileIn = $('[data-in-file]', body);
    const list = $('[data-list]', body), help = $('[data-pages-help]', body), err = $('[data-err]', body), readBtn = $('[data-read]', body);
    const status = $('[data-status]', body), form = $('[data-form]', body), formErr = $('[data-form-err]', body);
    const textIn = $('#sfg-text', form), titleIn = $('#sfg-title', form), langIn = $('#sfg-lang', form), foundLang = $('[data-found-lang]', form);
    let pages = []; // { id, blob, url, width, height, read: { text, title, code, language } | null }
    let seq = 0, run = 0, edited = false;

    const syncPages = () => {
      list.innerHTML = pages.map((p, i) => `<li class="sf-page">
          <img src="${esc(p.url)}" alt="${esc(fill('Page {n}', { n: SF.number(i + 1) }))}">
          <span class="sf-page__n">${esc(fill('Page {n}', { n: SF.number(i + 1) }))}${p.read ? ' ✓' : ''}</span>
          <button class="sf-page__x" type="button" data-remove="${p.id}" aria-label="${esc(fill('Remove page {n}', { n: SF.number(i + 1) }))}">×</button>
        </li>`).join('');
      help.textContent = pages.length >= MAX_PAGES ? fill('That’s {n} pages, the most at once.', { n: SF.number(MAX_PAGES) })
        : t('Take each page straight on, in good light, with the whole page in the photo.');
      readBtn.disabled = !pages.length;
      $$('[data-pick-camera], [data-pick-file]', body).forEach((b) => { b.disabled = !SF.boot.vision || pages.length >= MAX_PAGES; });
    };
    syncPages();

    async function add(files) {
      err.textContent = '';
      for (const f of files) {
        if (pages.length >= MAX_PAGES) { err.textContent = fill('Add up to {n} pages at a time.', { n: SF.number(MAX_PAGES) }); break; }
        try {
          const img = await SF.prepImage(f, 2000, 0.88);
          pages.push({ id: ++seq, read: null, ...img });
          edited = false;
        } catch (e) { err.textContent = e.message; }
      }
      syncPages();
    }
    $('[data-pick-camera]', body).addEventListener('click', () => camIn.click());
    $('[data-pick-file]', body).addEventListener('click', () => fileIn.click());
    [camIn, fileIn].forEach((inp) => inp.addEventListener('change', () => { const fs = Array.from(inp.files || []); inp.value = ''; if (fs.length) add(fs); }));
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]');
      if (!b) return;
      const i = pages.findIndex((p) => p.id === Number(b.dataset.remove));
      if (i < 0) return;
      URL.revokeObjectURL(pages[i].url);
      pages.splice(i, 1);
      edited = false;
      syncPages();
      const next = list.querySelector('[data-remove]') || $('[data-pick-file]', body);
      if (next) next.focus();
    });

    function assemble() {
      const done = pages.filter((p) => p.read);
      textIn.value = done.map((p) => p.read.text.trim()).filter(Boolean).join('\n\n');
      const first = done.find((p) => p.read.title);
      if (!titleIn.value && first) titleIn.value = first.read.title;
      const code = done.map((p) => p.read.code).find(Boolean);
      const language = (code && P.COURSE_LANGS[code]) ? P.langName(code) : (done.map((p) => p.read.language).find(Boolean) || '');
      foundLang.textContent = language ? fill('Written in {language}', { language }) : '';
      if (P.contentLang && code && P.COURSE_LANGS[code]) P.contentLang(textIn, code);
    }

    async function readAll() {
      const mine = ++run;
      stepPages.hidden = true;
      stepText.hidden = false;
      form.hidden = true;
      formErr.textContent = '';
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        if (p.read) continue;
        status.innerHTML = `<p class="sf-wait__lead"><span class="sf-dots" aria-hidden="true"><i></i><i></i><i></i></span> <span>${esc(fill('Reading page {n} of {total}…', { n: SF.number(i + 1), total: SF.number(pages.length) }))}</span></p>`;
        try {
          const d = await SF.sendImage('/api/start/page/read', p.blob, 200000);
          if (mine !== run) return;
          p.read = d.page;
        } catch (e) {
          if (mine !== run) return;
          status.innerHTML = `<p class="field__error">${esc(fill('Page {n}: {error}', { n: SF.number(i + 1), error: e.message }))}</p>
            <p><button class="textlink" type="button" data-retry>${esc(t('Try again'))}</button> · <button class="textlink" type="button" data-change>${esc(t('Add or change pages'))}</button>${pages.some((x) => x.read) ? ` · <button class="textlink" type="button" data-skip>${esc(t('Go on without it'))}</button>` : ''}</p>`;
          $('[data-retry]', status).addEventListener('click', readAll);
          $('[data-change]', status).addEventListener('click', backToPages);
          const skip = $('[data-skip]', status);
          if (skip) skip.addEventListener('click', () => { URL.revokeObjectURL(p.url); pages.splice(i, 1); syncPages(); readAll(); });
          return;
        }
      }
      status.innerHTML = '';
      if (!edited) assemble();
      form.hidden = false;
      textIn.focus({ preventScroll: true });
      textIn.setSelectionRange(0, 0);
      textIn.scrollTop = 0;
    }
    function backToPages() {
      run++;
      stepText.hidden = true;
      stepPages.hidden = false;
      syncPages();
      const b = $('[data-pick-file]', body);
      if (b) b.focus();
    }
    readBtn.addEventListener('click', readAll);
    $('[data-back]', form).addEventListener('click', backToPages);
    textIn.addEventListener('input', () => { edited = true; formErr.textContent = ''; });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      formErr.textContent = '';
      const material = textIn.value.trim();
      const title = P.clean(titleIn.value, 120);
      if (material.length < 120) { formErr.textContent = t('There isn’t enough text to build a lesson from. Add another page, or type in what’s missing.'); textIn.focus(); return; }
      if (!title) { formErr.textContent = t('Give it a title first.'); titleIn.focus(); P.shake(titleIn); return; }
      SF.build({
        form,
        url: '/api/start/knowledge',
        payload: {
          kind: 'page', title, material, lang: langIn.value, pages: pages.filter((p) => p.read).length || 1,
          size: ($('input[name="sfg-size"]:checked', form) || {}).value || 'lesson', folderId: SF.folderId()
        },
        steps: ['Reading the page’s text', 'Planning what to teach from it', 'Getting the lesson ready'],
        note: 'This usually takes 10 to 60 seconds.',
        onError(er) { formErr.textContent = er.message; }
      });
    });

    return () => { run++; pages.forEach((p) => URL.revokeObjectURL(p.url)); pages = []; };
  }
})();
