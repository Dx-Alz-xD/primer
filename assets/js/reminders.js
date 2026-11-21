/* =====================================================================
   Reminders about unfinished courses (server/reminders.mjs decides when).

   - A bell in the top bar of every signed-in page, with the number of
     new reminders. Its panel lists them ("You haven’t opened ‘Derivatives’
     for 9 days: you’re 6 lessons in. Pick up at lesson 7."), with
     snooze, dismiss and "don’t remind me about this course", and the
     settings: how often, browser notifications and quiet hours.
   - Browser notifications, if the learner turns them on: shown through
     the service worker when Primer is opened, and, where the browser
     allows Periodic Background Sync (the installed app on Chrome or
     Edge), from a check about twice a day with Primer closed
     (assets/js/sw-study.js). Each reminder is notified once.
   - On a course's page, "Remind me if I leave this course for a while".
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current() || !P.studyBar || !P.studyPop) return; // the top bar's slot and panels come from timer.js
  const $$ = P.$$, esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  const T = (s) => esc(t(s));
  const fill = (s, vals) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const boot = P.boot.reminders || { unread: 0, notify: false };
  const SYNC_TAG = 'primer-reminders';
  const lessonHref = (r) => `lesson.html?course=${encodeURIComponent(r.courseId)}&lesson=${r.next}`;
  let data = null;

  /* ---------------- the words of a reminder (also used by the service worker's copy) ---------------- */
  function words(r) {
    const vals = { title: r.title, days: r.days, done: r.done, next: r.next };
    const lead = r.days === 1 ? fill('It’s been a day since you opened “{title}”.', vals)
      : r.stage === 1 ? fill('It’s been {days} days since you opened “{title}”.', vals)
        : fill('You haven’t opened “{title}” for {days} days.', vals);
    const where = r.done === 0 ? fill('Pick up at lesson {next}.', vals)
      : r.done === 1 ? fill('You’re 1 lesson in: pick up at lesson {next}.', vals)
        : fill('You’re {done} lessons in: pick up at lesson {next}.', vals);
    return lead + ' ' + where + (r.last ? ' ' + t('This is the last reminder about it.') : '');
  }
  const countLine = (n) => (n === 1 ? t('You have 1 unfinished course.') : fill('You have {n} unfinished courses.', { n }));

  /* ---------------- the bell ---------------- */
  const BELL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2.1 2.1 0 0 0 4 0"/></svg>';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sbtn sbtn--bell';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'sb-remind');
  btn.innerHTML = `${BELL}<span class="sbtn__badge" aria-hidden="true" hidden></span><span class="sbtn__label">${T('Reminders')}</span>`;
  const pop = document.createElement('section');
  pop.className = 'spop sremind';
  pop.id = 'sb-remind';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-labelledby', 'sb-remind-title');
  pop.innerHTML = `
    <header class="spop__head">
      <h2 id="sb-remind-title">${T('Reminders')}</h2>
      <button class="spop__x" type="button" aria-label="${T('Close reminders')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </header>
    <div class="sremind__body" data-body><p class="sremind__count">${T('Gathering your reminders…')}</p></div>
    <details class="sremind__settings">
      <summary>${T('Reminder settings')}</summary>
      <fieldset class="sremind__fs">
        <legend>${T('How often')}</legend>
        <label><input type="radio" name="sr-cadence" value="gentle"> ${T('Gently: after 2, 7 and 30 days away')}</label>
        <label><input type="radio" name="sr-cadence" value="often"> ${T('More often: after 1, 3, 7, 14 and 30 days')}</label>
        <label><input type="radio" name="sr-cadence" value="rarely"> ${T('Rarely: after 7 and 30 days')}</label>
        <label><input type="radio" name="sr-cadence" value="off"> ${T('Never remind me')}</label>
      </fieldset>
      <fieldset class="sremind__fs">
        <legend>${T('Browser notifications')}</legend>
        <label><input type="checkbox" data-notify> ${T('Also show reminders as notifications')}</label>
        <p class="sremind__perm" data-perm aria-live="polite"></p>
        <label class="sremind__quiet"><input type="checkbox" data-quiet> ${T('Quiet hours, no notifications')}</label>
        <span class="sremind__hours" data-hours>
          <label>${T('from')} <select class="select select--small" data-qfrom></select></label>
          <label>${T('to')} <select class="select select--small" data-qto></select></label>
        </span>
      </fieldset>
      <details class="sremind__where">
        <summary>${T('What works where')}</summary>
        <ul>
          <li>${T('The bell works in every browser, whenever Primer is open.')}</li>
          <li>${T('Notifications when you open Primer: Chrome, Edge, Firefox and Safari on computers and Android. On an iPhone or iPad, only once Primer is added to the Home Screen.')}</li>
          <li>${T('Notifications while Primer is closed: only the installed app on Chrome or Edge (Android or a computer), through Periodic Background Sync. The browser decides when to check, usually about once or twice a day, and more often for apps you use a lot.')}</li>
          <li>${T('Primer doesn’t use push messages, so nothing about you is sent to a push service.')}</li>
        </ul>
      </details>
    </details>`;
  P.studyBar().appendChild(btn);
  document.body.appendChild(pop);
  const body = pop.querySelector('[data-body]');

  function setBadge(n) {
    const b = btn.querySelector('.sbtn__badge');
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n || '');
    btn.classList.toggle('has-new', Boolean(n));
    btn.setAttribute('aria-label', n ? (n === 1 ? t('Reminders, 1 new') : fill('Reminders, {n} new', { n })) : t('Reminders'));
  }
  setBadge(boot.unread || 0);

  btn.addEventListener('click', () => P.studyPop.toggle(btn, pop));
  pop.querySelector('.spop__x').addEventListener('click', () => P.studyPop.close(true));
  pop.addEventListener('sp:open', async () => {
    await refresh();
    if (data && data.unread) {
      P.post('/api/reminders/seen', {}).then(() => setBadge(0)).catch(() => {});
    }
    const first = pop.querySelector('.sremind__item a, .spop__x');
    if (first) first.focus({ preventScroll: true });
  });

  async function refresh() {
    try {
      data = await P.get('/api/reminders');
    } catch (err) {
      body.innerHTML = `<p class="sremind__count">${esc(fill('Your reminders didn’t load: {error}', { error: err.message }))}</p>`;
      return null;
    }
    paint();
    return data;
  }

  const dateFmt = (ms) => new Date(ms).toLocaleString(P.lang || undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function paint() {
    const d = data;
    const list = d.reminders.map((r) => `
      <li class="sremind__item${r.unread ? ' is-new' : ''}${r.last ? ' is-last' : ''}" data-id="${esc(r.courseId)}">
        <p class="sremind__text">${r.unread ? `<span class="sr-only">${T('New:')} </span>` : ''}${esc(words(r))}</p>
        <div class="sremind__acts">
          <a class="btn btn--small" href="${lessonHref(r)}">${esc(fill('Pick up at lesson {next}', { next: r.next }))}</a>
          <label class="sr-only" for="sr-snooze-${esc(r.courseId)}">${esc(fill('Snooze the reminder about “{title}”', { title: r.title }))}</label>
          <select class="select select--small" id="sr-snooze-${esc(r.courseId)}" data-snooze>
            <option value="">${T('Snooze…')}</option>
            <option value="1">${T('For a day')}</option>
            <option value="3">${T('For 3 days')}</option>
            <option value="7">${T('For a week')}</option>
          </select>
          <button class="textlink" type="button" data-act="dismiss">${T('Dismiss')}</button>
          <button class="textlink" type="button" data-act="mute">${T('Don’t remind me about this course')}</button>
        </div>
      </li>`).join('');
    const quiet = []
      .concat(d.snoozed.map((s) => `<li data-id="${esc(s.courseId)}"><span class="ugc">${esc(s.title)}</span>: ${esc(fill('snoozed until {when}', { when: dateFmt(s.until) }))} <button class="textlink" type="button" data-act="unsnooze">${T('Remind me again')}</button></li>`))
      .concat(d.muted.map((s) => `<li data-id="${esc(s.courseId)}"><span class="ugc">${esc(s.title)}</span>: ${T('no reminders')} <button class="textlink" type="button" data-act="unmute">${T('Turn back on')}</button></li>`));
    body.innerHTML = `
      <p class="sremind__count">${d.unfinished ? esc(countLine(d.unfinished)) : T('You have no unfinished courses. Reminders appear here when you leave one for a while.')}</p>
      ${d.settings.cadence === 'off' ? `<p class="sremind__off">${T('Reminders are off. Turn them on in the settings below.')}</p>` : ''}
      ${list ? `<ul class="sremind__list">${list}</ul>` : d.unfinished && d.settings.cadence !== 'off' ? `<p class="sremind__none">${T('Nothing to pick up right now. A reminder comes when you leave a course for a while.')}</p>` : ''}
      ${quiet.length ? `<ul class="sremind__quietlist">${quiet.join('')}</ul>` : ''}`;
    // titles are the course's own words, in its language
    if (P.contentLang) d.reminders.forEach((r) => { const li = body.querySelector(`[data-id="${CSS.escape(r.courseId)}"] .sremind__text`); if (li && r.lang !== P.lang) li.setAttribute('data-no-i18n', ''); });
    paintSettings();
  }

  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    act(id, { action: b.dataset.act }, b);
  });
  body.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-snooze]');
    if (!sel || !sel.value) return;
    act(sel.closest('[data-id]').dataset.id, { action: 'snooze', days: Number(sel.value) }, sel);
  });

  async function act(courseId, payload, el) {
    if (el) el.disabled = true;
    try {
      const r = await P.post(`/api/reminders/course/${encodeURIComponent(courseId)}`, payload);
      setBadge(r.unread);
      await refresh();
      const msg = { dismiss: 'Dismissed.', snooze: 'Snoozed.', mute: 'You won’t be reminded about that course.', unmute: 'Reminders for that course are back on.', unsnooze: 'The reminder is back.' }[payload.action];
      if (msg) P.toast(t(msg));
      const next = pop.querySelector('.sremind__item a') || pop.querySelector('.spop__x');
      if (next) next.focus({ preventScroll: true });
    } catch (err) {
      if (el) el.disabled = false;
      P.toast(err.message, 'error');
    }
  }

  /* ---------------- settings ---------------- */
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(P.lang || undefined, { hour: 'numeric', minute: '2-digit' });
  ['[data-qfrom]', '[data-qto]'].forEach((s) => { pop.querySelector(s).innerHTML = hours.map((h) => `<option value="${h}">${esc(hourLabel(h))}</option>`).join(''); });

  function paintSettings() {
    const s = data.settings;
    $$('input[name="sr-cadence"]', pop).forEach((r) => { r.checked = r.value === s.cadence; });
    pop.querySelector('[data-notify]').checked = s.notify && permission() === 'granted';
    const quietOn = s.quietFrom != null && s.quietTo != null;
    pop.querySelector('[data-quiet]').checked = quietOn;
    pop.querySelector('[data-hours]').hidden = !quietOn;
    pop.querySelector('[data-qfrom]').value = String(quietOn ? s.quietFrom : 21);
    pop.querySelector('[data-qto]').value = String(quietOn ? s.quietTo : 8);
    permLine();
  }
  const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');
  async function permLine() {
    const el = pop.querySelector('[data-perm]');
    const p = permission();
    if (p === 'unsupported') { el.textContent = t('This browser can’t show notifications. The bell still works.'); return; }
    if (p === 'denied') { el.textContent = t('Notifications are blocked for Primer. Allow them in your browser’s site settings, then try again.'); return; }
    if (!data || !data.settings.notify || p !== 'granted') { el.textContent = ''; return; }
    const bg = await backgroundState();
    el.textContent = bg === 'on' ? t('On. The installed app also checks in the background, about once or twice a day.')
      : bg === 'app' ? t('On, when you open Primer. Install Primer as an app (Chrome or Edge) to be reminded while it’s closed too.')
        : t('On, when you open Primer. This browser can’t check while Primer is closed.');
  }

  async function saveSettings(patch) {
    try {
      const r = await P.put('/api/reminders/settings', patch);
      data.settings = r.settings;
      setBadge(r.unread);
      boot.notify = r.settings.notify;
      await refresh();
    } catch (err) {
      P.toast(err.message, 'error');
      paintSettings();
    }
  }
  $$('input[name="sr-cadence"]', pop).forEach((r) => r.addEventListener('change', () => { if (r.checked) saveSettings({ cadence: r.value }); }));
  pop.querySelector('[data-quiet]').addEventListener('change', (e) => {
    pop.querySelector('[data-hours]').hidden = !e.target.checked;
    saveSettings(e.target.checked ? { quietFrom: Number(pop.querySelector('[data-qfrom]').value), quietTo: Number(pop.querySelector('[data-qto]').value) } : { quietFrom: null, quietTo: null });
  });
  ['[data-qfrom]', '[data-qto]'].forEach((s) => pop.querySelector(s).addEventListener('change', () => {
    saveSettings({ quietFrom: Number(pop.querySelector('[data-qfrom]').value), quietTo: Number(pop.querySelector('[data-qto]').value) });
  }));
  pop.querySelector('[data-notify]').addEventListener('change', async (e) => {
    const box = e.target;
    if (box.checked) {
      if (permission() === 'unsupported') { box.checked = false; permLine(); return; }
      let p = permission();
      if (p === 'default') { try { p = await Notification.requestPermission(); } catch (err) { p = 'denied'; } }
      if (p !== 'granted') { box.checked = false; permLine(); return; }
      await saveSettings({ notify: true });
      await registerBackground(true);
      notifyNow(true);
    } else {
      await saveSettings({ notify: false });
      await registerBackground(false);
    }
    permLine();
  });

  /* ---------------- notifications ---------------- */
  const quietNow = (s) => {
    if (s.quietFrom == null || s.quietTo == null) return false;
    const h = new Date().getHours();
    return s.quietFrom < s.quietTo ? h >= s.quietFrom && h < s.quietTo : h >= s.quietFrom || h < s.quietTo;
  };
  async function registration() {
    try { return ('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistration() : null; } catch (e) { return null; }
  }
  async function show(title, opts) {
    const reg = await registration();
    if (reg && reg.active) { await reg.showNotification(title, opts); return true; }
    try { new Notification(title, opts); return true; } catch (e) { return false; }
  }
  // New reminders as notifications, once each (also when the learner has just turned them on)
  async function notifyNow(force) {
    if (permission() !== 'granted') return;
    const d = force ? await refresh() : data || await P.get('/api/reminders').catch(() => null);
    if (!d || !d.settings.notify || quietNow(d.settings)) return;
    const fresh = d.reminders.filter((r) => !r.notified && r.unread);
    if (!fresh.length) return;
    const base = { icon: '/assets/icons/icon-192.png', badge: '/assets/icons/icon-192.png' };
    let ok;
    if (fresh.length === 1) {
      const r = fresh[0];
      ok = await show(t('Primer'), Object.assign({ body: words(r), tag: 'primer-remind-' + r.courseId, data: { primer: 'reminder', url: '/' + lessonHref(r) } }, base));
    } else {
      ok = await show(countLine(d.unfinished), Object.assign({
        body: fresh.slice(0, 4).map((r) => '“' + r.title + '”').join(', ') + (fresh.length > 4 ? ' …' : ''),
        tag: 'primer-remind', data: { primer: 'reminder', url: '/app.html#reminders' }
      }, base));
    }
    if (ok) P.post('/api/reminders/notified', { courseIds: fresh.map((r) => r.courseId) }).catch(() => {});
  }

  // Periodic Background Sync: the installed app on Chrome checks now and then with Primer closed.
  async function backgroundState() {
    const reg = await registration();
    if (!reg || !('periodicSync' in reg)) return 'none';
    try {
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (st.state !== 'granted') return 'app';
      const tags = await reg.periodicSync.getTags();
      return tags.includes(SYNC_TAG) ? 'on' : 'app';
    } catch (e) { return 'none'; }
  }
  async function registerBackground(on) {
    const reg = await registration();
    if (!reg || !('periodicSync' in reg)) return;
    try {
      if (!on) { await reg.periodicSync.unregister(SYNC_TAG); return; }
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (st.state === 'granted') await reg.periodicSync.register(SYNC_TAG, { minInterval: 12 * 3600 * 1000 });
    } catch (e) { /* the browser said no: reminders still show when Primer is opened */ }
  }

  // when a page opens: notify what's new, and keep the background check registered
  if (boot.notify && permission() === 'granted') {
    if (boot.unread) setTimeout(() => notifyNow(false), 1500);
    registerBackground(true);
  }
  if (location.hash === '#reminders') setTimeout(() => { if (pop.hidden) P.studyPop.toggle(btn, pop, true); }, 300);

  /* ---------------- a course's page: reminders on or off for it ---------------- */
  document.addEventListener('primer:course', (e) => {
    const { view, course } = e.detail;
    const host = view.querySelector('.smcourse') || view.querySelector('.course-head__progress');
    if (!host) return;
    const row = document.createElement('p');
    row.className = 'srcourse';
    host.appendChild(row);
    P.get(`/api/reminders/course/${encodeURIComponent(course.id)}`).then((d) => {
      if (d.cadence === 'off') { row.innerHTML = `${T('Reminders are off for all your courses.')} <button class="textlink" type="button" data-open>${T('Reminder settings')}</button>`; }
      else row.innerHTML = `<label><input type="checkbox" data-on${d.muted ? '' : ' checked'}> ${T('Remind me if I leave this course for a while')}</label>`;
      const box = row.querySelector('[data-on]');
      if (box) box.addEventListener('change', async () => {
        box.disabled = true;
        try {
          const r = await P.post(`/api/reminders/course/${encodeURIComponent(course.id)}`, { action: box.checked ? 'unmute' : 'mute' });
          setBadge(r.unread);
          P.toast(t(box.checked ? 'Reminders for this course are on.' : 'You won’t be reminded about this course.'));
        } catch (err) { box.checked = !box.checked; P.toast(err.message, 'error'); }
        box.disabled = false;
      });
      const open = row.querySelector('[data-open]');
      if (open) open.addEventListener('click', () => { P.studyPop.toggle(btn, pop, true); pop.querySelector('.sremind__settings').open = true; });
    }).catch(() => row.remove());
  });

  P.reminders = { refresh, words, setBadge };
})();
