/* =====================================================================
   "Start from… Your knowledge" (app.html): the learner gives what they
   know, typed or pasted, from text files, or recited aloud, with a
   title and a language, and Primer builds a whole course from it alone
   (POST /api/start/knowledge, server/sources-in.mjs).

   Reciting: the microphone is recorded in parts of about 40 seconds;
   each part is sent to the speech-to-text endpoint (/api/voice/
   transcribe, ElevenLabs) as soon as it ends, and the words appear in a
   transcript box. When the recording stops, the learner corrects the
   transcript and adds it to their text. Nothing is used before they do.
   What was typed is kept for this tab (sessionStorage) if the dialog
   is closed, so nothing long is lost by a slip.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer, SF = P && P.startFrom;
  if (!SF) return;
  const $ = P.$, esc = P.esc, t = SF.t, fill = SF.fill;
  const MAX = SF.boot.maxMaterial || 30000;
  const MIN = 120;
  const PART_MS = 40000;          // one recorded part: about 100 spoken words
  const MOST_MS = 20 * 60000;     // a recording stops itself after 20 minutes
  const DRAFT = 'primer.sf.knowledge';
  const TEXT_FILE = /\.(?:txt|text|md|markdown|csv|tsv|srt|vtt)$/i;
  const MIC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
  const FILE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14.5 3.5V8H19M12 11v6M9 14h6"/></svg>';

  SF.panels.knowledge = { title: 'Your knowledge', render };

  function render(body) {
    body.innerHTML = `
      <form class="sf-form" novalidate>
        <p class="sf-lead">Teach what you know: a tradition, a craft, a recipe, the history of your village, a song and what it means, your own notes. Primer builds a whole course from it, and teaches only what you give it.</p>
        <div class="sf-row">
          <div class="field sf-grow">
            <label class="label" for="sfk-title">Title</label>
            <input class="input" id="sfk-title" type="text" maxlength="120" autocomplete="off" placeholder="e.g. Madhubani painting in our family">
          </div>
          <div class="field">
            <label class="label" for="sfk-lang">Course language</label>
            <select class="input select" id="sfk-lang">${SF.langOptions(SF.defaultLang())}</select>
          </div>
        </div>
        <div class="field">
          <div class="sf-labelrow"><label class="label" for="sfk-text">What you know</label><span class="help sf-count" id="sfk-count" aria-live="polite"></span></div>
          <textarea class="textarea sf-material" id="sfk-text" rows="11" maxlength="${MAX}" aria-describedby="sfk-text-help" placeholder="Write it as fully as you can, in any language: the names, places and steps, the sayings, why it matters."></textarea>
          <p class="help" id="sfk-text-help">Type or paste it here, add text files, or say it aloud.</p>
          <div class="sf-tools">
            <button class="btn btn--ghost btn--small" type="button" data-sfk-files>${FILE}<span>Add text files</span></button>
            <input type="file" id="sfk-files" accept=".txt,.text,.md,.markdown,.csv,.tsv,.srt,.vtt,text/plain,text/markdown" multiple hidden>
            <button class="btn btn--ghost btn--small" type="button" data-sfk-rec aria-controls="sfk-rec">${MIC}<span>Record aloud</span></button>
          </div>
        </div>
        <section class="sf-rec" id="sfk-rec" hidden aria-labelledby="sfk-rec-title">
          <div class="sf-rec__head">
            <h3 class="sf-rec__title" id="sfk-rec-title"><span class="sf-rec__dot" aria-hidden="true"></span><span data-sfk-rec-state>Recording</span></h3>
            <span class="sf-rec__time" data-sfk-time>0:00</span>
            <button class="btn btn--small" type="button" data-sfk-stop>Stop</button>
          </div>
          <p class="help" data-sfk-status role="status"></p>
          <label class="label" for="sfk-transcript">Transcript</label>
          <textarea class="textarea" id="sfk-transcript" rows="6" readonly></textarea>
          <p class="help">Check the transcript and correct any names or words it heard wrong, then add it to your text.</p>
          <div class="sf-actions">
            <button class="btn btn--small" type="button" data-sfk-add disabled>Add to my text</button>
            <button class="textlink" type="button" data-sfk-discard>Throw it away</button>
          </div>
        </section>
        <p class="sf-note">Primer teaches only what you write here. It keeps your names, places and words as you give them, and where something isn’t covered it says so instead of making it up.</p>
        <p class="field__error" data-sfk-err role="alert"></p>
        <div class="sf-actions">
          <button class="btn" type="submit">Build the course</button>
          <button class="textlink" type="button" data-sf-close>Cancel</button>
        </div>
      </form>`;

    const form = $('form', body);
    const titleIn = $('#sfk-title', form), langIn = $('#sfk-lang', form), textIn = $('#sfk-text', form);
    const count = $('#sfk-count', form), err = $('[data-sfk-err]', form);
    const recBox = $('#sfk-rec', form), transcript = $('#sfk-transcript', form);
    const recBtn = $('[data-sfk-rec]', form), stopBtn = $('[data-sfk-stop]', form), addBtn = $('[data-sfk-add]', form);
    const status = $('[data-sfk-status]', form), timeEl = $('[data-sfk-time]', form), stateEl = $('[data-sfk-rec-state]', form);
    const fileIn = $('#sfk-files', form);

    // what was typed before (this tab only)
    const draft = P.session.get(DRAFT, null);
    if (draft) {
      titleIn.value = draft.title || '';
      textIn.value = draft.text || '';
      if (draft.lang && P.COURSE_LANGS[draft.lang]) langIn.value = draft.lang;
      if (draft.transcript) { recBox.hidden = false; transcript.value = draft.transcript; transcript.readOnly = false; addBtn.disabled = false; stateEl.textContent = t('Recorded'); stopBtn.hidden = true; timeEl.textContent = ''; }
    }
    const save = () => P.session.set(DRAFT, { title: titleIn.value, text: textIn.value, lang: langIn.value, transcript: transcript.value });
    const syncCount = () => {
      const n = textIn.value.length;
      count.textContent = n ? fill('{n} of {max} characters', { n: SF.number(n), max: SF.number(MAX) }) : '';
      count.classList.toggle('is-full', n >= MAX);
    };
    syncCount();
    [titleIn, textIn, transcript].forEach((el) => el.addEventListener('input', () => { syncCount(); save(); err.textContent = ''; }));
    langIn.addEventListener('change', save);
    if (P.contentLang) { const sync = () => [textIn, titleIn].forEach((el) => P.contentLang(el, langIn.value)); langIn.addEventListener('change', sync); }

    // adds text at the end of what's there, as much as fits
    function append(more) {
      const cur = textIn.value.replace(/\s+$/, '');
      const join = cur ? '\n\n' : '';
      const room = MAX - cur.length - join.length;
      const add = String(more || '').replace(/\r\n?/g, '\n').trim();
      if (!add) return 0;
      textIn.value = cur + join + add.slice(0, Math.max(0, room));
      syncCount();
      save();
      return add.length > room ? add.length - Math.max(0, room) : 0;
    }

    /* ---------- text files ---------- */
    $('[data-sfk-files]', form).addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', async () => {
      const files = Array.from(fileIn.files || []);
      fileIn.value = '';
      err.textContent = '';
      let cut = 0;
      for (const f of files) {
        if (!TEXT_FILE.test(f.name) && !/^text\//.test(f.type)) { err.textContent = fill('“{name}” isn’t a text file. Add .txt or .md files, or copy the text in.', { name: f.name }); continue; }
        if (f.size > 2 * 1024 * 1024) { err.textContent = fill('“{name}” is too large to add.', { name: f.name }); continue; }
        let s = '';
        try { s = await f.text(); } catch (e) { err.textContent = fill('“{name}” couldn’t be read.', { name: f.name }); continue; }
        if (s.includes('\u0000')) { err.textContent = fill('“{name}” isn’t a text file. Add .txt or .md files, or copy the text in.', { name: f.name }); continue; }
        cut += append(s.replace(new RegExp('^' + String.fromCharCode(0xfeff)), ''));
      }
      if (cut) P.toast(fill('Only the first {max} characters fit, so the end of a file was left out.', { max: SF.number(MAX) }), 'error');
      else if (files.length && !err.textContent) P.toast(t(files.length === 1 ? 'The file was added to your text.' : 'The files were added to your text.'));
      textIn.focus();
    });

    /* ---------- reciting aloud ---------- */
    const rec = { stream: null, mr: null, on: false, seq: 0, parts: [], queue: [], sending: false, started: 0, clock: 0, partTimer: 0, base: '', failed: 0 };
    const mime = (() => {
      if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
      return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    })();
    const clockText = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const renderTranscript = () => {
      const said = rec.parts.filter(Boolean).join(' ');
      transcript.value = (rec.base ? rec.base.replace(/\s+$/, '') + (said ? '\n\n' : '') : '') + said;
      transcript.scrollTop = transcript.scrollHeight;
    };
    const left = () => rec.queue.length + (rec.sending ? 1 : 0);
    function syncStatus() {
      if (rec.on) status.textContent = left() ? t('Listening. The words appear below a few seconds after each part.') : t('Listening…');
      else if (left()) status.textContent = fill(left() === 1 ? 'Writing down the last part…' : 'Writing down {n} more parts…', { n: SF.number(left()) });
      else status.textContent = rec.failed ? fill(rec.failed === 1 ? 'One part couldn’t be written down. Check the transcript for a gap.' : '{n} parts couldn’t be written down. Check the transcript for gaps.', { n: SF.number(rec.failed) }) : '';
      const done = !rec.on && !left();
      transcript.readOnly = !done;
      addBtn.disabled = !done || !transcript.value.trim();
      stateEl.textContent = rec.on ? t('Recording') : done ? t('Recorded') : t('Writing it down…');
      recBox.classList.toggle('is-on', rec.on);
      stopBtn.hidden = !rec.on;
      recBtn.disabled = rec.on || !done;
    }

    async function transcribe(blob) {
      const res = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type || mime || 'audio/webm' }, body: blob, credentials: 'same-origin' });
      let d = null;
      try { d = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok || !d || d.ok === false) throw Object.assign(new Error((d && d.error) || fill('The server answered with an error ({status}).', { status: res.status })), { status: res.status });
      return d.text || '';
    }
    async function drain() {
      if (rec.sending) return;
      rec.sending = true;
      while (rec.queue.length) {
        const { n, blob } = rec.queue.shift();
        syncStatus();
        try {
          rec.parts[n] = await transcribe(blob);
        } catch (e) {
          // a silent or very short part is fine to skip; anything else leaves a gap the learner is told about
          if (!(e.status === 400 || e.status === 422)) { rec.failed++; console.warn('[Primer] transcribe:', e.message); }
          if (e.status === 503 || e.status === 429) { err.textContent = e.message; }
          rec.parts[n] = '';
        }
        renderTranscript();
        save();
      }
      rec.sending = false;
      syncStatus();
    }
    function part() {
      let mr;
      try { mr = new MediaRecorder(rec.stream, mime ? { mimeType: mime } : undefined); } catch (e) { stopRec(); err.textContent = t('This browser can’t record sound. Type the text instead.'); return; }
      const bits = [];
      const n = rec.seq++;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) bits.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(bits, { type: (mr.mimeType || mime || 'audio/webm') });
        if (blob.size > 1500) { rec.queue.push({ n, blob }); drain(); }
        if (rec.on) part();
        else release();
        syncStatus();
      };
      mr.start();
      rec.mr = mr;
      rec.partTimer = setTimeout(() => { if (mr.state === 'recording') mr.stop(); }, PART_MS);
    }
    function release() {
      if (rec.stream) rec.stream.getTracks().forEach((tr) => tr.stop());
      rec.stream = null;
      clearInterval(rec.clock);
    }
    async function startRec() {
      err.textContent = '';
      if (!P.boot.voice) { err.textContent = t('Recording needs the ElevenLabs key on the server. Type or paste the text instead.'); return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { err.textContent = t('This browser can’t record sound. Type the text instead.'); return; }
      try {
        rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        err.textContent = t('Primer couldn’t use the microphone. Allow it for this site in the browser, then try again.');
        return;
      }
      recBox.hidden = false;
      rec.base = transcript.value;
      rec.parts = [];
      rec.seq = 0;
      rec.failed = 0;
      rec.on = true;
      rec.started = Date.now();
      timeEl.textContent = '0:00';
      rec.clock = setInterval(() => {
        const ms = Date.now() - rec.started;
        timeEl.textContent = clockText(ms);
        if (ms >= MOST_MS) { stopRec(); P.toast(t('The recording stopped after 20 minutes. Start another to say more.')); }
      }, 500);
      part();
      syncStatus();
      stopBtn.focus();
    }
    function stopRec() {
      if (!rec.on) return;
      rec.on = false;
      clearTimeout(rec.partTimer);
      if (rec.mr && rec.mr.state === 'recording') rec.mr.stop();
      else release();
      syncStatus();
    }
    recBtn.addEventListener('click', startRec);
    stopBtn.addEventListener('click', stopRec);
    addBtn.addEventListener('click', () => {
      const cut = append(transcript.value);
      transcript.value = '';
      rec.base = '';
      rec.parts = [];
      recBox.hidden = true;
      save();
      if (cut) P.toast(fill('Only the first {max} characters fit, so the end of the transcript was left out.', { max: SF.number(MAX) }), 'error');
      textIn.focus();
      textIn.scrollTop = textIn.scrollHeight;
    });
    $('[data-sfk-discard]', form).addEventListener('click', () => {
      if (transcript.value.trim() && !window.confirm(t('Throw away this transcript?'))) return;
      stopRec();
      rec.queue = [];
      transcript.value = '';
      rec.base = '';
      rec.parts = [];
      recBox.hidden = true;
      save();
      recBtn.focus();
    });
    if (!P.boot.voice) recBtn.title = t('Recording needs the ElevenLabs key on the server.');

    /* ---------- building ---------- */
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      err.textContent = '';
      const title = P.clean(titleIn.value, 120);
      const material = textIn.value.trim();
      if (!title) { err.textContent = t('Give it a title first.'); titleIn.setAttribute('aria-invalid', 'true'); titleIn.focus(); P.shake(titleIn); return; }
      titleIn.removeAttribute('aria-invalid');
      if (material.length < MIN) { err.textContent = t('There isn’t enough to build a course from yet. Add a few more sentences.'); textIn.focus(); P.shake(textIn); return; }
      if (rec.on || left()) { err.textContent = t('Wait for the recording to finish being written down.'); return; }
      if (transcript.value.trim() && !window.confirm(t('The transcript hasn’t been added to your text. Build the course without it?'))) return;
      SF.build({
        form,
        url: '/api/start/knowledge',
        payload: { kind: 'knowledge', title, material, lang: langIn.value, folderId: SF.folderId() },
        steps: ['Reading what you wrote', 'Finding the ideas in it, in order', 'Planning the lessons', 'Noting what it doesn’t cover'],
        note: material.length > 12000 ? 'A long text takes a little longer to plan: up to two or three minutes.' : '',
        onError(er) {
          err.textContent = er.message;
          err.scrollIntoView({ block: 'nearest' });
        }
      }).then(() => { /* on success the page moves on; the draft goes */ });
      P.session.remove(DRAFT);
      addEventListener('pagehide', () => P.session.remove(DRAFT), { once: true });
    });

    // closing the dialog: stop the microphone; keep the draft unless the course was built
    return () => {
      rec.queue = [];
      if (rec.on) { rec.on = false; clearTimeout(rec.partTimer); if (rec.mr && rec.mr.state === 'recording') rec.mr.stop(); }
      release();
      if (!form.hidden) save();
    };
  }
})();
