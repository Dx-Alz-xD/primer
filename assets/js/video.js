/* =====================================================================
   Watch mode on the lesson page, for learners who would rather watch
   than read (server/videos.mjs does the finding and the narrating).

   - "Read | Watch" at the top of the lesson, remembered per learner
     (and per lesson when a suggestion below switches just this one).
   - Watch: the lesson as a sequence of videos, each followed by a short
     quiz. The next video opens once the quiz is answered, like the
     checkpoints of the written lesson, and the answers, wrong-answer
     records, Review, notebook and doubts all work as they do there
     (lesson.js renders the questions; see P.watch.start).
   - YouTube videos the server chose for the lesson, embedded from
     youtube-nocookie.com only once the learner presses play, with
     captions on in their language, credited with the video's title and
     channel, a link to YouTube's own transcript, and a suggestion when
     the video isn't spoken in their language and has no captions in it.
   - Primer-made videos: each part of the lesson narrated (ElevenLabs,
     with word timings, or the browser's own voice) over slides of the
     part, with captions and the full transcript underneath. In another
     language, the narration reads the lesson's translation.
   - Sign language: captions always on and large, and videos by real
     signers when the server finds any.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const W = Object.assign({ youtube: false, narration: false, mode: 'read', source: 'youtube', sign: false }, P.boot.watch || {});

  const ICON = {
    book: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.4c-2.3-1.7-5.3-2-8.2-1.2v12c2.9-.8 5.9-.5 8.2 1.2 2.3-1.7 5.3-2 8.2-1.2v-12c-2.9-.8-5.9-.5-8.2 1.2z"/><path d="M12 6.4v12"/></svg>',
    screen: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12.5" rx="2"/><path d="M10.2 8.3v5l4.3-2.5z"/><path d="M8 20.5h8"/></svg>',
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    big: '<svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.5 5.5v13l10.5-6.5z"/></svg>',
    lock: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M8 12.4l2.7 2.7L16.2 9.6"/></svg>',
    hands: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 11V5.5a1.3 1.3 0 0 1 2.6 0V10"/><path d="M10.1 9.5V4.3a1.3 1.3 0 0 1 2.6 0v5.2"/><path d="M12.7 9.6V5.2a1.3 1.3 0 0 1 2.6 0v6"/><path d="M15.3 10.8V8a1.3 1.3 0 0 1 2.6 0v5.5a7 7 0 0 1-7 7h-.4a6 6 0 0 1-4.8-2.4L3.8 15a1.4 1.4 0 0 1 2.1-1.8l1.6 1.6V11"/></svg>'
  };

  let page = null;    // what lesson.js shares (see lesson.js, start())
  let data = null;    // GET /api/courses/:id/lessons/:n/videos
  let vbody = null, paper = null;
  let steps = [], shown = -1, renderGen = 0;
  const players = new Set();

  const learner = () => String(P.lang || 'en').split('-')[0];
  const shownLang = () => (page.lesson.translated ? page.lesson.translated.lang : P.api.lessonLang(page.course()));
  const offline = () => Boolean(P.offline && P.offline.isOffline && P.offline.isOffline());
  const apiBase = () => `/api/courses/${encodeURIComponent(page.course().id)}/lessons/${page.n}`;
  const clock = (s) => { const x = Math.max(0, Math.round(s || 0)); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), r = x % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(r).padStart(2, '0'); };
  function langName(code) {
    try { return new Intl.DisplayNames([P.lang || 'en'], { type: 'language' }).of(code) || code; } catch (e) { return code; }
  }

  /* ---------------- preferences ---------------- */
  const lessonKey = () => `primer.watch.${page.course().id}.${page.n}`;
  const lessonPref = () => P.store.get(lessonKey(), {}) || {};
  function setLessonPref(patch) {
    const p = Object.assign(lessonPref(), patch);
    Object.keys(p).forEach((k) => { if (p[k] == null) delete p[k]; });
    P.store.set(lessonKey(), p);
  }
  const mode = () => lessonPref().mode || W.mode || 'read';
  const preferredSource = () => lessonPref().source || W.source || 'youtube';
  function savePrefs(patch) {
    Object.assign(W, patch);
    P.put('/api/videos/prefs', patch).catch(() => {});
  }

  /* ---------------- Read | Watch ---------------- */
  function mountSwitch() {
    const head = $('#lhead');
    if (!head || head.querySelector('.vmode')) return;
    const sw = document.createElement('div');
    sw.className = 'vmode';
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', t('How to follow this lesson'));
    sw.innerHTML = `<button type="button" class="vmode__btn" data-mode="read" aria-pressed="false">${ICON.book}<span>${esc(t('Read'))}</span></button>` +
      `<button type="button" class="vmode__btn" data-mode="watch" aria-pressed="false">${ICON.screen}<span>${esc(t('Watch'))}</span></button>`;
    sw.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b || b.getAttribute('aria-pressed') === 'true') return;
      setLessonPref({ mode: null });
      savePrefs({ mode: b.dataset.mode });
      if (b.dataset.mode === 'watch') enter(); else leave();
    });
    const tip = head.querySelector('.lhead__tip');
    if (tip) tip.before(sw); else head.appendChild(sw);
  }
  function syncSwitch(m) {
    $$('.vmode__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  }

  function enter() {
    paper.classList.add('is-watch');
    vbody.hidden = false;
    if (P.voice) P.voice.stop();
    syncSwitch('watch');
    render();
  }
  function leave() {
    stopAll();
    players.forEach((p) => p.destroy());
    players.clear();
    renderGen++;
    paper.classList.remove('is-watch');
    vbody.hidden = true;
    vbody.innerHTML = '';
    syncSwitch('read');
    page.rerender(); // answers given while watching show in the written lesson too
  }

  /* ---------------- the Watch view ---------------- */
  function youtubeState() {
    if (!data) return 'unknown';
    const y = data.youtube || {};
    if (!y.configured || y.status === 'off') return 'off';
    if (y.status === 'safety') return 'safety';
    return 'on';
  }
  const source = () => (youtubeState() === 'on' && !offline() ? preferredSource() : 'made');

  async function render() {
    const gen = ++renderGen;
    stopAll();
    players.forEach((p) => p.destroy());
    players.clear();
    vbody.classList.toggle('is-sign', Boolean(W.sign));
    vbody.innerHTML = `
      <div class="vbar">
        <div class="vsrc" role="group" aria-label="${esc(t('Where the videos come from'))}">
          <span class="vsrc__label">${esc(t('Videos'))}</span>
          <button type="button" class="vsrc__btn" data-src="youtube" aria-pressed="false">${esc(t('From YouTube'))}</button>
          <button type="button" class="vsrc__btn" data-src="made" aria-pressed="false">${esc(t('Made by Primer'))}</button>
        </div>
        <label class="vsign">${ICON.hands}<input type="checkbox"${W.sign ? ' checked' : ''}><span>${esc(t('Sign language'))}</span></label>
      </div>
      <p class="vnote" role="status" hidden></p>
      <section class="vsigned" aria-labelledby="vsigned-title" hidden></section>
      <div class="vsteps"></div>
      <div class="llock vlock" hidden></div>`;
    $('.vsrc', vbody).addEventListener('click', (e) => {
      const b = e.target.closest('[data-src]');
      if (!b || b.disabled || b.getAttribute('aria-pressed') === 'true') return;
      setLessonPref({ source: null });
      savePrefs({ source: b.dataset.src });
      render();
    });
    $('.vsign input', vbody).addEventListener('change', (e) => {
      savePrefs({ sign: e.target.checked });
      vbody.classList.toggle('is-sign', W.sign);
      players.forEach((p) => p.signMode(W.sign));
      renderSigned();
    });

    const stepsBox = $('.vsteps', vbody);
    if (!data) {
      stepsBox.innerHTML = waiting(t('Getting the videos ready…'));
      try {
        data = await P.get(apiBase() + '/videos', { timeout: 30000 });
      } catch (err) {
        if (gen !== renderGen) return;
        stepsBox.innerHTML = `<div class="lload lload--error" role="alert"><div><p class="lload__title">${esc(t('The videos didn’t load'))}</p><p>${esc(err.message)}</p></div></div>`;
        return;
      }
      if (gen !== renderGen) return;
    }
    syncSource();
    renderSigned();

    if (source() === 'youtube') {
      let y = data.youtube;
      const tracksMissing = y.status === 'found' && y.videos.some((v) => !Array.isArray(v.tracks));
      if (y.status === 'new' || y.status === 'error' || tracksMissing) {
        if (y.status !== 'found') stepsBox.innerHTML = waiting(t('Finding videos for this lesson on YouTube…'), t('Primer looks once, picks the videos that cover this lesson and writes a quiz for each. It takes a few seconds.'));
        try {
          const d = await P.post(apiBase() + '/videos', {}, { timeout: 180000 });
          data = Object.assign(data, d);
        } catch (err) {
          data.youtube.status = 'error';
          data.youtube.error = err.message;
        }
        if (gen !== renderGen) return;
        y = data.youtube;
      }
      if (y.status === 'found' && y.videos.length) {
        note('');
        buildSteps('youtube');
        return;
      }
      syncSource('made');
      note(y.status === 'none' ? t('No suitable YouTube video was found for this lesson, so these are Primer’s own videos, made from it.')
        : t('YouTube couldn’t be searched just now, so these are Primer’s own videos, made from this lesson.'));
    } else {
      const why = youtubeState();
      note(why === 'safety' ? t('For this course, Primer shows its own videos, made from the lesson.')
        : offline() && why === 'on' ? t('You’re offline, so these are Primer’s own videos, made from this lesson.')
          : '');
    }
    buildSteps('made');
  }

  const waiting = (title, sub) => `<div class="lload" role="status"><span class="quill" aria-hidden="true"><i></i><i></i><i></i></span><div><p class="lload__title">${esc(title)}</p>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div>`;
  function note(s) {
    const el = $('.vnote', vbody);
    if (!el) return;
    el.textContent = s || '';
    el.hidden = !s;
  }
  function syncSource(now) {
    const src = now || source();
    const yt = youtubeState();
    $$('.vsrc__btn', vbody).forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.src === src));
      if (b.dataset.src === 'youtube') {
        b.disabled = yt !== 'on' || offline();
        b.title = yt === 'off' ? t('YouTube isn’t set up on this Primer server.') : yt === 'safety' ? t('For this course, Primer shows its own videos.') : offline() ? t('You’re offline.') : '';
      }
    });
  }

  /* ---------------- the sequence: video, quiz, video, quiz… ---------------- */
  const hasContent = (s) => Boolean(s && ((s.blocks || []).length || (s.checkpoint || []).length));

  function buildSteps(kind) {
    const secs = page.sections;
    steps = [];
    if (kind === 'youtube') {
      const covered = new Set();
      data.youtube.videos.forEach((v) => {
        (v.parts || []).forEach((p) => covered.add(p));
        steps.push({ kind: 'yt', v, key: v.parts && v.parts.length ? v.parts[0] : 1e3 });
      });
      // parts no video covers get Primer's own video, in their place in the lesson
      secs.forEach((s, i) => { if (!covered.has(i) && hasContent(s)) steps.push({ kind: 'made', sec: i, key: i + 0.5 }); });
      steps.sort((a, b) => a.key - b.key);
    } else {
      secs.forEach((s, i) => { if (hasContent(s)) steps.push({ kind: 'made', sec: i }); });
    }
    renderSteps();
  }

  function ownQuestion(id) {
    for (let i = 0; i < page.sections.length; i++) {
      const q = (page.sections[i].checkpoint || []).find((x) => x.id === id);
      if (q) return { q, sec: i };
    }
    return null;
  }
  // AI-written text is cleaned every time it's shown, as lesson questions are (api.js)
  function cleanQ(x) {
    const h = P.sanitizeHTML;
    return Object.assign({}, x, {
      prompt: h(x.prompt), choices: x.choices ? x.choices.map(h) : undefined,
      hint: x.hint ? h(x.hint) : '', explain: x.explain ? h(x.explain) : ''
    });
  }
  function quizOf(step) {
    if (!step.quiz) {
      step.quiz = step.kind === 'made'
        ? (page.sections[step.sec].checkpoint || []).map((q) => ({ q, sec: step.sec }))
        : (step.v.quiz || []).map((x) => ownQuestion(x.id) || { q: cleanQ(x), sec: null });
    }
    return step.quiz;
  }
  const stepDone = (step) => quizOf(step).every(({ q }) => page.prog().answered[q.id]);

  function renderSteps() {
    const box = $('.vsteps', vbody);
    box.innerHTML = '';
    shown = -1;
    for (let k = 0; k < steps.length; k++) {
      box.appendChild(stepEl(k, false));
      shown = k;
      if (!stepDone(steps[k])) break;
    }
    updateLock();
    if (steps.length && steps.every(stepDone)) done();
  }

  function onAnswered(k) {
    if (!stepDone(steps[k])) return;
    let opened = null;
    while (shown < steps.length - 1 && stepDone(steps[shown])) {
      shown++;
      const el = stepEl(shown, true);
      $('.vsteps', vbody).appendChild(el);
      if (!opened) opened = el;
    }
    updateLock();
    if (opened && P.sfx && !steps.every(stepDone)) setTimeout(() => P.sfx.play('unlock'), 420);
    if (opened) {
      setTimeout(() => {
        const top = opened.getBoundingClientRect().top;
        if (top > window.innerHeight - 140) window.scrollBy({ top: top - (window.innerHeight - 300), behavior: P.motion.reduce ? 'auto' : 'smooth' });
      }, P.motion.reduce ? 0 : 500);
    }
    if (steps.every(stepDone)) done();
  }

  function done() {
    page.finish(steps.flatMap((s) => quizOf(s).map((x) => x.q)));
  }

  function updateLock() {
    const lock = $('.vlock', vbody);
    if (!lock) return;
    const left = steps.length - 1 - shown;
    lock.hidden = left <= 0;
    if (left > 0) {
      lock.innerHTML = `${ICON.lock}<span>${esc(left === 1 ? t('One more video opens when you answer the quiz above.') : fill('{n} more videos open when you answer the quiz above.', { n: left }))}</span>`;
    }
  }

  function stepEl(k, animate) {
    const step = steps[k];
    const el = document.createElement('section');
    el.className = 'lsec vstep' + (animate ? ' is-new' : '');
    el.id = `vstep-${k}`;
    el.setAttribute('aria-labelledby', `vstep-${k}-title`);
    const title = step.kind === 'yt' ? step.v.title : page.sections[step.sec].title;
    const kindLabel = step.kind === 'yt' ? t('From YouTube') : t('Made by Primer');
    el.innerHTML = `<p class="vstep__n">${esc(fill('Video {n} of {total}', { n: k + 1, total: steps.length }))} · ${esc(kindLabel)}</p>
      <h2 class="lsec__title vstep__title" id="vstep-${k}-title" data-no-i18n>${esc(title)}</h2>`;
    el.appendChild(step.kind === 'yt' ? ytBlock(step) : madeBlock(step, k));
    const quiz = quizOf(step);
    if (quiz.length) el.appendChild(quizBox(step, k, quiz));
    P.math(el);
    return el;
  }

  function quizBox(step, k, quiz) {
    const box = document.createElement('div');
    box.className = 'checkpoint vquiz';
    const more = k < steps.length - 1;
    const yt = step.kind === 'yt';
    box.innerHTML = `<p class="checkpoint__title">${ICON.check}${esc(t('Quiz'))}</p>
      <p class="checkpoint__sub">${esc(yt ? t('Based on what the video covers (its title, description and chapters) and the matching part of this lesson.') : t('The questions from this part of the lesson.'))} ${esc(more ? t('Answer to open the next video.') : t('Answer to finish the lesson.'))}</p>`;
    const revise = yt ? reviseFor(step) : null;
    quiz.forEach(({ q, sec }) => {
      const ctx = {
        section: sec == null ? revise : null,
        rereadLabel: t('Watch the video again'),
        reread: () => rewatch(k),
        onAnswered: () => onAnswered(k)
      };
      const form = page.question(q, sec, ctx);
      // the question's own words are lesson content, not interface text
      $$('.q__prompt, .q__choices, .q__unit', form).forEach((x) => x.setAttribute('data-no-i18n', ''));
      box.appendChild(form);
    });
    return box;
  }

  // After a wrong answer on a video's quiz: the key points of the lesson parts the video covers.
  function reviseFor(step) {
    const parts = (step.v.parts && step.v.parts.length ? step.v.parts : page.sections.map((_, i) => i)).map((i) => page.sections[i]).filter(Boolean);
    const recap = parts.flatMap((s) => s.recap || []).slice(0, 6);
    return { title: step.v.title, recap, blocks: recap.length ? [] : parts.flatMap((s) => s.blocks || []) };
  }

  function rewatch(k) {
    const el = $(`#vstep-${k}`);
    if (!el) return;
    el.scrollIntoView({ behavior: P.motion.reduce ? 'auto' : 'smooth', block: 'start' });
    const step = steps[k];
    if (step.player) { step.player.seek(0); step.player.play(); }
  }

  /* ---------------- YouTube ---------------- */
  const ytLink = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const thumb = (id) => `/vthumb/${encodeURIComponent(id)}.jpg`;

  function facade(v, label) {
    return `<button type="button" class="vfacade" aria-label="${esc(fill('Play the video: {title}', { title: v.title }))}">
        <img class="vfacade__img" src="${esc(thumb(v.id))}" alt="" loading="lazy" decoding="async">
        <span class="vfacade__play" aria-hidden="true">${ICON.big}</span>
        ${v.seconds ? `<span class="vfacade__len" aria-hidden="true">${esc(clock(v.seconds))}</span>` : ''}
        ${label ? `<span class="vfacade__tag" aria-hidden="true">${esc(label)}</span>` : ''}
      </button>`;
  }

  function embed(frame, v, start) {
    stopAll();
    const L = learner();
    const params = new URLSearchParams({ autoplay: '1', cc_load_policy: '1', cc_lang_pref: L, hl: L, rel: '0', playsinline: '1' });
    if (start) params.set('start', String(Math.floor(start)));
    const f = document.createElement('iframe');
    f.className = 'vframe__iframe';
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?${params}`;
    f.title = fill('YouTube video: {title}', { title: v.title });
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    // YouTube's player needs to know which site embeds it: only the origin is sent, never the page
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.innerHTML = '';
    frame.appendChild(f);
    frame.classList.add('is-playing');
  }

  function wireFacade(frame, v) {
    const img = $('.vfacade__img', frame);
    if (img) img.addEventListener('error', () => { img.hidden = true; });
    const b = $('.vfacade', frame);
    if (b) b.addEventListener('click', () => embed(frame, v, 0));
  }

  function credit(v) {
    const channel = v.channelId
      ? `<a href="https://www.youtube.com/channel/${esc(encodeURIComponent(v.channelId))}" target="_blank" rel="noopener noreferrer" data-no-i18n>${esc(v.channel)}</a>`
      : `<span data-no-i18n>${esc(v.channel)}</span>`;
    return `<p class="vcredit"><span>${esc(t('Video'))}:</span> <a href="${esc(ytLink(v.id))}" target="_blank" rel="noopener noreferrer" data-no-i18n>${esc(v.title)}</a> · ${channel} · YouTube${v.license === 'creativeCommon' ? ' · CC BY' : ''}</p>`;
  }

  function ytBlock(step) {
    const v = step.v;
    const wrap = document.createElement('div');
    wrap.className = 'vyt';
    const parts = (v.parts || []).map((i) => page.sections[i]).filter(Boolean);
    const chapters = (v.chapters || []).slice(0, 12);
    wrap.innerHTML = `
      <div class="vframe">${facade(v)}</div>
      <p class="vframe__note">${esc(t('Plays from YouTube, without YouTube’s cookies, when you press play. Captions are on.'))}</p>
      ${credit(v)}
      <p class="vtools">
        <a class="textlink" href="${esc(ytLink(v.id))}" target="_blank" rel="noopener noreferrer">${esc(t('Transcript'))}</a>
        <span class="vtools__hint">${esc(t('Opens the video on YouTube: under its description, choose “Show transcript”.'))}</span>
      </p>
      ${v.why ? `<p class="vyt__why" data-no-i18n>${esc(v.why)}</p>` : ''}
      ${parts.length ? `<p class="vyt__covers"><span>${esc(t('Covers'))}:</span> <span data-no-i18n>${parts.map((s) => esc(s.title)).join(' · ')}</span></p>` : ''}
      ${chapters.length ? `<details class="vchap"><summary>${esc(t('Chapters'))}</summary><ol>${chapters.map((c) => `<li><button type="button" class="textlink" data-at="${c.t}"><span class="vchap__t">${esc(clock(c.t))}</span> <span data-no-i18n>${esc(c.title)}</span></button></li>`).join('')}</ol></details>` : ''}
      ${mismatchHTML(v)}`;
    const frame = $('.vframe', wrap);
    wireFacade(frame, v);
    wrap.addEventListener('click', (e) => {
      const at = e.target.closest('[data-at]');
      if (at) { embed(frame, v, Number(at.dataset.at)); frame.scrollIntoView({ behavior: P.motion.reduce ? 'auto' : 'smooth', block: 'center' }); return; }
      const act = e.target.closest('[data-mis]');
      if (act) mismatchAction(act.dataset.mis, act, frame, v);
    });
    return wrap;
  }

  /* ---------- a video in another language than the learner's ---------- */
  function mismatchHTML(v) {
    const L = learner();
    const A = String(v.audioLang || '').split('-')[0];
    if (!A || A === L) return '';
    const tracks = Array.isArray(v.tracks) ? v.tracks.map((x) => String(x).split('-')[0]) : null;
    const spoken = langName(A), mine = langName(L);
    if (tracks && tracks.includes(L)) {
      return `<p class="vmis vmis--ok">${esc(fill('Spoken in {lang}, with captions in {mine}: they’re on.', { lang: spoken, mine }))}</p>`;
    }
    const canTranslate = tracks ? tracks.length > 0 : v.captions; // auto-translate needs a caption track to start from
    return `<div class="vmis" role="note">
        <p class="vmis__head"><strong>${esc(fill('This video is in {lang}, with no captions in {mine}.', { lang: spoken, mine }))}</strong></p>
        <div class="vmis__acts">
          <button type="button" class="btn btn--small" data-mis="made">${esc(fill('Watch Primer’s video in {mine}', { mine }))}</button>
          <button type="button" class="btn btn--ghost btn--small" data-mis="read">${esc(t('Read this lesson instead'))}</button>
          ${canTranslate ? `<button type="button" class="btn btn--ghost btn--small" data-mis="cc">${esc(t('Watch with translated captions'))}</button>` : ''}
        </div>
        <p class="vmis__how" hidden>${esc(fill('In the player, turn on captions (CC), then open Settings (the gear) → Subtitles/CC → Auto-translate, and choose {mine}.', { mine }))}</p>
        <p class="vmis__small">${esc(t('Primer doesn’t dub other people’s videos: that needs the owner’s rights. Its own video, narrated in your language, is the dubbed version.'))}</p>
      </div>`;
  }

  function mismatchAction(what, btn, frame, v) {
    const course = page.course();
    if (what === 'made') {
      setLessonPref({ source: 'made' });
      // the lesson is in another language: translate it (Read and Watch alike), then narrate the translation
      if (P.api.lessonLang(course) !== learner() && !page.lesson.translated) {
        P.api.setTranslation(course, true);
        location.reload();
        return;
      }
      render();
    } else if (what === 'read') {
      setLessonPref({ mode: 'read' });
      leave();
      const b = $('.vmode__btn[data-mode="read"]');
      if (b) b.focus();
      P.toast(t('This lesson opens as text from now on. Choose Watch to go back to the videos.'));
    } else if (what === 'cc') {
      const how = $('.vmis__how', btn.closest('.vmis'));
      if (how) how.hidden = false;
      if (!frame.classList.contains('is-playing')) embed(frame, v, 0);
    }
  }

  /* ---------------- sign language ---------------- */
  async function renderSigned() {
    const box = $('.vsigned', vbody);
    if (!box) return;
    if (!W.sign) { box.hidden = true; box.innerHTML = ''; return; }
    const gen = renderGen;
    box.hidden = false;
    const head = `<h2 class="vsigned__title" id="vsigned-title">${ICON.hands}<span>${esc(t('Signed version'))}</span></h2>`;
    let s = data && data.signed;
    if (!s && data && youtubeState() !== 'off' && !offline()) {
      box.innerHTML = head + `<p class="vsigned__status" role="status">${esc(t('Looking for this lesson in sign language…'))}</p>`;
      try {
        const d = await P.post(apiBase() + '/videos/signed', {}, { timeout: 90000 });
        s = d.signed;
        if (s) data.signed = s;
      } catch (err) { s = null; }
      if (gen !== renderGen || !W.sign) return;
    }
    if (!s || !(s.videos || []).length) {
      box.innerHTML = head + `<p class="vsigned__none">${esc(t('No signed video for this lesson yet. Captions are on.'))}</p>`;
      return;
    }
    box.innerHTML = head + `<p class="vsigned__sub">${esc(t('Videos of this lesson’s subject by people who sign it. Captions stay on in every video.'))}</p>` +
      s.videos.map((v, i) => `<div class="vsigned__item" data-i="${i}"><div class="vframe vframe--small">${facade(v, v.signer || '')}</div>${credit(v)}</div>`).join('');
    $$('.vsigned__item', box).forEach((it) => wireFacade($('.vframe', it), s.videos[Number(it.dataset.i)]));
  }

  /* ---------------- Primer-made videos ---------------- */
  function madeBlock(step, k) {
    const i = step.sec;
    const lang = shownLang();
    const nar = ((data && data.narration && data.narration[lang]) || [])[i] || null;
    const player = makePlayer({ section: page.sections[i], sec: i, lang, narration: nar && nar.script ? nar : null, onEnd: () => toQuiz(k) });
    step.player = player;
    players.add(player);
    return player.el;
  }

  function toQuiz(k) {
    const quiz = $(`#vstep-${k} .vquiz`);
    if (!quiz) return;
    const r = quiz.getBoundingClientRect();
    if (r.top > window.innerHeight - 120) quiz.scrollIntoView({ behavior: P.motion.reduce ? 'auto' : 'smooth', block: 'center' });
    quiz.classList.remove('is-flash');
    void quiz.offsetWidth;
    quiz.classList.add('is-flash');
  }

  function stopAll(except) {
    players.forEach((p) => { if (p !== except) p.pause(); });
  }

  // Sentences of the script (long ones cut at a comma), each with its place in the script.
  function makeCues(script, segments) {
    const cues = [];
    const push = (s, o, seg) => {
      let txt = s, at = o;
      const lead = txt.length - txt.trimStart().length;
      at += lead;
      txt = txt.trim();
      while (txt.length > 130) {
        let cut = -1;
        const re = /[,;:]\s+/g;
        let m;
        while ((m = re.exec(txt)) && m.index < 118) cut = m.index + m[0].length;
        if (cut < 30) { const sp = txt.lastIndexOf(' ', 110); cut = sp > 30 ? sp + 1 : 110; }
        const part = txt.slice(0, cut).trimEnd();
        cues.push({ o: at, e: at + part.length, text: part, seg });
        const rest = txt.slice(cut);
        at += cut + (rest.length - rest.trimStart().length);
        txt = rest.trim();
      }
      if (txt) cues.push({ o: at, e: at + txt.length, text: txt, seg });
    };
    segments.forEach((sg, si) => {
      const end = si + 1 < segments.length ? segments[si + 1].o : script.length;
      const txt = script.slice(sg.o, end);
      const re = /[.!?।…]+["”’)\]]*(?=\s|$)/g;
      let start = 0, m;
      while ((m = re.exec(txt))) {
        const stop = m.index + m[0].length;
        push(txt.slice(start, stop), sg.o + start, si);
        start = stop;
      }
      if (txt.slice(start).trim()) push(txt.slice(start), sg.o + start, si);
    });
    return cues;
  }

  // What the screen shows for each segment of the narration.
  function makeSlides(section, segments, opts) {
    const blocks = section.blocks || [];
    const figures = blocks.filter((b) => b.t === 'figure');
    const photoOf = (src) => blocks.find((b) => b.t === 'photo' && b.src === src);
    const recap = section.recap || [];
    const slides = [];
    const forSeg = [];
    const titlePhoto = segments[0] && segments[0].src ? photoOf(segments[0].src) : null;
    const lessonTitle = page.lesson.title || page.meta.title || '';
    slides.push(`<div class="vslide vslide--title${titlePhoto ? ' has-photo' : ''}">
        ${titlePhoto ? `<img class="vslide__bg" src="${esc(titlePhoto.src)}" alt="${esc(titlePhoto.alt || '')}">` : ''}
        <div class="vslide__titlebox">
          <p class="vslide__kicker">${esc(fill('Part {n} of {total}', { n: opts.sec + 1, total: page.sections.length }))}</p>
          <h3 class="vslide__h">${esc(section.title)}</h3>
          <p class="vslide__lesson">${esc(lessonTitle)}</p>
        </div>
        ${titlePhoto ? photoCredit(titlePhoto) : ''}
      </div>`);
    let pointsSlide = -1;
    if (recap.length) {
      pointsSlide = slides.length;
      slides.push(`<div class="vslide vslide--points"><p class="vslide__kicker">${esc(t('Key points'))}</p><ol class="vslide__points">${recap.map((r) => `<li>${r}</li>`).join('')}</ol></div>`);
    }
    const texts = segments.filter((s) => s.kind === 'text').length;
    let rank = 0;
    segments.forEach((sg) => {
      if (sg.kind === 'math' && sg.tex) {
        forSeg.push({ slide: slides.length });
        slides.push(`<div class="vslide vslide--math"><div class="math-display">$$${esc(sg.tex)}$$</div></div>`);
      } else if (sg.kind === 'figure' && figures[sg.fig] && figures[sg.fig].svg) {
        const f = figures[sg.fig];
        forSeg.push({ slide: slides.length });
        slides.push(`<div class="vslide vslide--figure">${f.svg}${f.caption ? `<p class="vslide__cap">${f.caption}</p>` : ''}</div>`);
      } else if (sg.kind === 'photo' && photoOf(sg.src)) {
        const ph = photoOf(sg.src);
        forSeg.push({ slide: slides.length });
        slides.push(`<div class="vslide vslide--photo"><img class="vslide__img" src="${esc(ph.src)}" alt="${esc(ph.alt || '')}">${ph.caption ? `<p class="vslide__cap">${ph.caption}</p>` : ''}${photoCredit(ph)}</div>`);
      } else if (sg.kind === 'text' && pointsSlide >= 0) {
        forSeg.push({ slide: pointsSlide, point: Math.min(recap.length - 1, Math.floor((rank++ / Math.max(1, texts)) * recap.length)) });
      } else {
        forSeg.push({ slide: 0 });
      }
    });
    return { html: slides.join(''), forSeg };
  }
  function photoCredit(ph) {
    const c = ph.credit || {};
    const line = [c.author, c.license].filter(Boolean).join(' · ');
    return `<small class="vslide__credit">${esc(t('Photo'))}: ${esc(line ? line + ' · ' : '')}Wikimedia Commons</small>`;
  }

  // A browser voice for the language, if there is one.
  function browserVoice(lang) {
    const synth = window.speechSynthesis;
    if (!synth) return { ok: false };
    const all = synth.getVoices ? synth.getVoices() : [];
    const base = String(lang).split('-')[0];
    const v = all.find((x) => String(x.lang).toLowerCase().replace('_', '-').split('-')[0] === base);
    return { ok: Boolean(v) || all.length === 0, voice: v || null };
  }

  function makePlayer(o) {
    const el = document.createElement('div');
    el.className = 'vmade';
    el.innerHTML = `
      <div class="vstage" data-no-i18n>
        <div class="vstage__slides"></div>
        <div class="vstage__cap" aria-hidden="true"></div>
        <button type="button" class="vstage__big" aria-label="${esc(t('Play'))}">${ICON.big}</button>
        <span class="vstage__badge">${esc(t('Primer video'))}</span>
      </div>
      <div class="vctl">
        <button type="button" class="vctl__play" aria-label="${esc(t('Play'))}">${ICON.play}</button>
        <span class="vctl__time" aria-live="off">0:00</span>
        <input class="vctl__seek" type="range" min="0" max="1000" step="1" value="0" aria-label="${esc(t('Position in the video'))}">
        <button type="button" class="vctl__cc" aria-pressed="true" aria-label="${esc(t('Captions'))}">CC</button>
      </div>
      <p class="vmade__voice" role="status" hidden></p>
      <details class="vtrans" open>
        <summary>${esc(t('Transcript'))}</summary>
        <div class="vtrans__text" data-doubtable data-no-i18n></div>
      </details>`;
    const stage = $('.vstage', el), slidesBox = $('.vstage__slides', el), capBox = $('.vstage__cap', el);
    const big = $('.vstage__big', el), playBtn = $('.vctl__play', el), seek = $('.vctl__seek', el), timeEl = $('.vctl__time', el);
    const ccBtn = $('.vctl__cc', el), voiceEl = $('.vmade__voice', el), trans = $('.vtrans__text', el);

    let nar = null, cues = [], len = 0, forSeg = [], slideEls = [];
    let engine = null, busy = false, curCue = -1, curSlide = -1, curPoint = -1, raf = 0, pendingSeek = null, captions = true;

    function prepare(n) {
      nar = n;
      len = n.script.length;
      cues = makeCues(n.script, n.segments || []);
      const s = makeSlides(o.section, n.segments || [], o);
      slidesBox.innerHTML = s.html;
      forSeg = s.forSeg;
      slideEls = $$('.vslide', slidesBox);
      P.math(slidesBox);
      // the transcript: the narration, a paragraph per passage, a span per caption
      let html = '', seg = -1;
      cues.forEach((c, k) => {
        if (c.seg !== seg) { html += (seg >= 0 ? '</p>' : '') + '<p>'; seg = c.seg; }
        html += `<span class="vcue" data-k="${k}">${esc(c.text)}</span> `;
      });
      trans.innerHTML = html + (seg >= 0 ? '</p>' : '');
      curCue = curSlide = curPoint = -1;
      show(0);
    }
    function titleOnly() {
      slidesBox.innerHTML = `<div class="vslide vslide--title is-on"><div class="vslide__titlebox"><p class="vslide__kicker">${esc(fill('Part {n} of {total}', { n: o.sec + 1, total: page.sections.length }))}</p><h3 class="vslide__h">${esc(o.section.title)}</h3></div></div>`;
      trans.innerHTML = `<p class="vtrans__wait">${esc(t('The transcript appears when the video starts.'))}</p>`;
    }

    const cueAt = (off) => {
      let lo = 0, hi = cues.length - 1, k = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (cues[mid].o <= off) { k = mid; lo = mid + 1; } else hi = mid - 1; }
      return k;
    };
    function show(off) {
      if (!cues.length) return;
      const k = cueAt(off);
      const c = cues[k];
      if (k !== curCue) {
        curCue = k;
        // the caption: the sentence being read, word by word
        const parts = [];
        const re = /\S+/g;
        let m;
        while ((m = re.exec(c.text))) parts.push(`<span data-o="${c.o + m.index}">${esc(m[0])}</span>`);
        capBox.innerHTML = `<span class="vcap">${parts.join(' ')}</span>`;
        $$('.vcue.is-on', trans).forEach((x) => x.classList.remove('is-on'));
        const cueEl = trans.querySelector(`.vcue[data-k="${k}"]`);
        if (cueEl) {
          cueEl.classList.add('is-on');
          // keep the current sentence in view inside the transcript box, not the page
          const top = cueEl.offsetTop - trans.offsetTop;
          if (top < trans.scrollTop || top > trans.scrollTop + trans.clientHeight - 40) trans.scrollTop = Math.max(0, top - 40);
        }
        const f = forSeg[c.seg] || { slide: 0 };
        if (f.slide !== curSlide) {
          curSlide = f.slide;
          slideEls.forEach((s, i) => s.classList.toggle('is-on', i === f.slide));
        }
        if (f.point != null && f.point !== curPoint) {
          curPoint = f.point;
          $$('.vslide__points li', slidesBox).forEach((li, i) => { li.classList.toggle('is-seen', i < f.point); li.classList.toggle('is-on', i === f.point); });
        }
      }
      let word = null;
      $$('[data-o]', capBox).forEach((w) => { if (Number(w.dataset.o) <= off) word = w; });
      $$('.is-word', capBox).forEach((w) => { if (w !== word) w.classList.remove('is-word'); });
      if (word) word.classList.add('is-word');
    }
    if (o.narration) prepare(o.narration); else titleOnly();

    function paintTime() {
      if (!engine) return;
      const pr = Math.max(0, Math.min(1, engine.progress()));
      if (document.activeElement !== seek) seek.value = String(Math.round(pr * 1000));
      const total = engine.duration();
      timeEl.textContent = `${clock(pr * total)} / ${engine.kind === 'audio' ? '' : '~'}${clock(total)}`;
    }
    function tick() {
      if (!engine) return;
      show(engine.offset());
      paintTime();
    }
    function loop() {
      cancelAnimationFrame(raf);
      const go = () => { tick(); if (engine && engine.playing) raf = requestAnimationFrame(go); };
      raf = requestAnimationFrame(go);
    }
    function paintState() {
      const on = Boolean(engine && engine.playing);
      playBtn.innerHTML = on ? ICON.pause : ICON.play;
      playBtn.setAttribute('aria-label', on ? t('Pause') : t('Play'));
      big.hidden = on || busy;
      el.classList.toggle('is-playing', on);
      el.classList.toggle('is-busy', busy);
      if (on) loop();
    }
    function voiceNote(s) { voiceEl.textContent = s || ''; voiceEl.hidden = !s; }

    const hooks = {
      tick, state: paintState,
      end: () => { cancelAnimationFrame(raf); tick(); paintState(); el.classList.add('is-ended'); if (o.onEnd) o.onEnd(); },
      noVoice: () => {
        const at = engine ? engine.offset() : 0;
        if (engine) engine.destroy();
        engine = timerEngine(cues, len, hooks, at);
        voiceNote(t('Your browser’s voice didn’t start, so the captions play on their own.'));
        engine.play();
      }
    };

    async function getNarration() {
      // kept ElevenLabs narration first; otherwise ask for it (the server makes it, or says to use the browser's voice)
      if (nar && nar.url) return;
      if (nar && !W.narration) { voiceNote(t('Your browser reads this video.')); return; }
      const d = await P.post(apiBase() + '/narration', { section: o.sec, lang: o.lang }, { timeout: 170000, timeoutMessage: t('The narration took too long. Try again.') });
      const n = d.narration;
      if (!nar || nar.script !== n.script) prepare(n); else nar = n;
      if (n.provider === 'browser') voiceNote(t(n.reason || 'Your browser reads this video.'));
      if (data && data.narration) { (data.narration[o.lang] = data.narration[o.lang] || [])[o.sec] = n; }
      // a downloaded course keeps the new narration: asking again lets the offline copy pick it up
      if (n.url && P.offline && P.offline.supported) P.get(apiBase() + '/videos').catch(() => {});
    }

    function speechOrTimer(at) {
      const v = browserVoice(o.lang);
      if (window.speechSynthesis && window.SpeechSynthesisUtterance && v.ok) return speechEngine(cues, len, o.lang, v.voice, hooks, at);
      voiceNote(t('Your browser has no voice for this language, so the captions play on their own.'));
      return timerEngine(cues, len, hooks, at);
    }

    async function play() {
      stopAll(player);
      if (P.voice) P.voice.stop();
      if (engine) { engine.play(); paintState(); return; }
      if (busy) return;
      busy = true;
      paintState();
      try {
        await getNarration();
      } catch (err) {
        if (!nar) { busy = false; paintState(); voiceNote(err.message); return; }
        voiceNote(t('The narration couldn’t be made just now, so your browser reads this video.'));
      }
      const start = pendingSeek != null ? pendingSeek : 0;
      if (nar.url) {
        engine = audioEngine(nar.url, nar.words, len, hooks);
        try { await engine.ready; } catch (e) {
          engine.destroy();
          engine = speechOrTimer(start);
          voiceNote(t('The recorded narration couldn’t be played, so your browser reads this video.'));
        }
      } else {
        engine = speechOrTimer(start);
      }
      busy = false;
      if (pendingSeek != null && engine.kind === 'audio') engine.seek(pendingSeek);
      pendingSeek = null;
      el.classList.remove('is-ended');
      el.classList.add('is-started');
      engine.play();
      paintState();
    }
    function pause() { if (engine && engine.playing) { engine.pause(); paintState(); } }
    function seekTo(off) {
      if (!cues.length) return;
      el.classList.remove('is-ended');
      if (engine) { engine.seek(off); tick(); } else { pendingSeek = off; show(off); seek.value = String(Math.round((off / Math.max(1, len)) * 1000)); }
    }

    big.addEventListener('click', play);
    playBtn.addEventListener('click', () => (engine && engine.playing ? pause() : play()));
    stage.addEventListener('click', (e) => { if (e.target === stage || e.target.closest('.vstage__slides')) { if (engine && engine.playing) pause(); else play(); } });
    seek.addEventListener('input', () => {
      if (!len) return;
      const frac = Number(seek.value) / 1000;
      if (engine && engine.kind === 'audio') { engine.seekFraction(frac); tick(); } else seekTo(Math.floor(frac * len));
    });
    ccBtn.addEventListener('click', () => {
      if (W.sign) return; // captions stay on in sign-language mode
      captions = !captions;
      ccBtn.setAttribute('aria-pressed', String(captions));
      capBox.hidden = !captions;
    });
    trans.addEventListener('click', (e) => {
      const c = e.target.closest('.vcue');
      if (!c || (window.getSelection && String(window.getSelection()).trim())) return; // selecting text asks a doubt instead
      seekTo(cues[Number(c.dataset.k)].o);
      if (!engine || !engine.playing) play();
    });

    const player = {
      el,
      play, pause,
      seek: (off) => seekTo(off || 0),
      signMode(on) {
        if (on) { captions = true; capBox.hidden = false; ccBtn.setAttribute('aria-pressed', 'true'); }
        ccBtn.disabled = Boolean(on);
      },
      destroy() { cancelAnimationFrame(raf); if (engine) engine.destroy(); engine = null; }
    };
    player.signMode(W.sign);
    return player;
  }

  /* ---------- the three ways a Primer video can speak ---------- */

  // ElevenLabs narration: the audio, with each word's timing (or, without timings, an even spread).
  function audioEngine(url, words, len, hooks) {
    const a = new Audio();
    a.preload = 'auto';
    let blobUrl = '';
    const ready = (async () => {
      const r = await fetch(url, { credentials: 'same-origin' }); // through the service worker, so a downloaded course plays offline
      if (!r.ok) throw new Error('audio ' + r.status);
      blobUrl = URL.createObjectURL(await r.blob());
      a.src = blobUrl;
      await new Promise((res, rej) => {
        a.addEventListener('loadedmetadata', res, { once: true });
        a.addEventListener('error', () => rej(new Error('audio')), { once: true });
      });
    })();
    a.addEventListener('ended', hooks.end);
    a.addEventListener('play', hooks.state);
    a.addEventListener('pause', hooks.state);
    const ws = Array.isArray(words) && words.length ? words : null;
    const dur = () => (Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 1);
    function offsetAt(sec) {
      if (!ws) return Math.floor((sec / dur()) * len);
      const ms = sec * 1000;
      let lo = 0, hi = ws.length - 1, k = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (ws[mid][2] <= ms) { k = mid; lo = mid + 1; } else hi = mid - 1; }
      return k < 0 ? 0 : ws[k][0];
    }
    function timeAt(off) {
      if (!ws) return (off / Math.max(1, len)) * dur();
      const w = ws.find((x) => x[0] >= off) || ws[ws.length - 1];
      return w[2] / 1000;
    }
    return {
      kind: 'audio', ready,
      play() { a.play().catch(() => {}); },
      pause() { a.pause(); },
      seek(off) { a.currentTime = timeAt(off); },
      seekFraction(f) { a.currentTime = f * dur(); },
      offset: () => offsetAt(a.currentTime),
      progress: () => a.currentTime / dur(),
      duration: () => dur(),
      get playing() { return !a.paused && !a.ended; },
      destroy() { a.pause(); if (blobUrl) URL.revokeObjectURL(blobUrl); }
    };
  }

  // The browser's own voice, a caption at a time, with word boundaries for the highlight.
  function speechEngine(cues, len, lang, voice, hooks, at) {
    const synth = window.speechSynthesis;
    const CPS = 14;
    let k = Math.max(0, cueIndex(cues, at || 0)), off = cues.length ? cues[k].o : 0, playing = false, gen = 0, guard = 0;
    function speak() {
      const my = ++gen;
      if (k >= cues.length) { playing = false; off = len; hooks.end(); return; }
      const c = cues[k];
      const u = new SpeechSynthesisUtterance(c.text);
      u.lang = lang;
      if (voice) u.voice = voice;
      let started = false;
      u.onstart = () => { if (my !== gen) return; started = true; off = c.o; hooks.tick(); };
      u.onboundary = (e) => { if (my !== gen) return; off = c.o + (e.charIndex || 0); hooks.tick(); };
      u.onend = () => { if (my !== gen || !playing) return; k++; off = k < cues.length ? cues[k].o : len; hooks.tick(); speak(); };
      u.onerror = (e) => { if (my !== gen || !playing || (e && (e.error === 'interrupted' || e.error === 'canceled'))) return; hooks.noVoice(); };
      synth.speak(u);
      clearTimeout(guard);
      guard = setTimeout(() => { if (!started && my === gen && playing) { gen++; synth.cancel(); hooks.noVoice(); } }, 3000);
    }
    return {
      kind: 'speech', ready: Promise.resolve(),
      play() { if (playing) return; playing = true; synth.cancel(); speak(); hooks.state(); },
      pause() { playing = false; gen++; clearTimeout(guard); synth.cancel(); hooks.state(); },
      seek(o) { k = Math.max(0, cueIndex(cues, o)); off = cues.length ? cues[k].o : 0; if (playing) { synth.cancel(); speak(); } },
      offset: () => off,
      progress: () => (len ? off / len : 0),
      duration: () => len / CPS,
      get playing() { return playing; },
      destroy() { playing = false; gen++; clearTimeout(guard); synth.cancel(); }
    };
  }

  // No voice at all: the captions move on at a reading pace.
  function timerEngine(cues, len, hooks, at) {
    const CPS = 14;
    let off = at || 0, playing = false, last = 0, raf = 0;
    function step(ts) {
      if (!playing) return;
      off += ((ts - last) / 1000) * CPS;
      last = ts;
      if (off >= len) { off = len; playing = false; hooks.tick(); hooks.state(); hooks.end(); return; }
      raf = requestAnimationFrame(step);
    }
    return {
      kind: 'timer', ready: Promise.resolve(),
      play() { if (playing) return; if (off >= len) off = 0; playing = true; last = performance.now(); raf = requestAnimationFrame(step); hooks.state(); },
      pause() { playing = false; cancelAnimationFrame(raf); hooks.state(); },
      seek(o) { off = Math.max(0, Math.min(len, o)); },
      offset: () => off,
      progress: () => (len ? off / len : 0),
      duration: () => len / CPS,
      get playing() { return playing; },
      destroy() { playing = false; cancelAnimationFrame(raf); }
    };
  }
  function cueIndex(cues, off) {
    let k = 0;
    for (let i = 0; i < cues.length; i++) { if (cues[i].o <= off) k = i; else break; }
    return k;
  }

  /* ---------------- start ---------------- */
  P.watch = {
    // Called by lesson.js once the lesson is on the page, with:
    // { course(), n, meta, flat, lesson, sections, prog(), question(q, secIdx, ctx), sectionComplete(i),
    //   finish(questions), rerender(), lessonHref(n), outlineHref }
    start(p) {
      page = p;
      const course = page.course();
      if (course.source !== 'ai' && course.source !== 'library') return; // sample lessons are built in the browser: they're read
      paper = $('#paper');
      vbody = document.createElement('div');
      vbody.id = 'vbody';
      vbody.className = 'vbody';
      vbody.hidden = true;
      $('#lbody').after(vbody);
      mountSwitch();
      if (mode() === 'watch') enter(); else syncSwitch('read');
    }
  };
  // pages that go into the background stop talking
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(); });
})();
