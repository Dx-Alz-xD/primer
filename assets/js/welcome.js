/* =====================================================================
   The welcome after sign-up (welcome.html), one plain question at a
   time, each with a "Listen" button for anyone who finds reading hard:

     1. your name
     2. your date of birth (day, month and year; or just the year; or
        skip it) — the tutor uses the age to explain at the right level
     3. your language (the page reloads in it and carries on at step 4)
     4. would you like a tour? Yes opens the app with the tour
        (assets/js/tour.js); no opens the app as it is

   Each answer is saved as it is given (PUT /api/me), so leaving half
   way loses nothing; signing in again comes back here until step 4.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, v) => t(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const user = P.auth.current();
  if (!user) return;
  const next = P.safeNext ? P.safeNext(P.params.get('next')) : 'app.html';
  const KEY = 'primer.welcome.step';
  const steps = $$('.wc__step');
  const dots = $$('.wc__dots li');
  const count = $('#wc-count');
  const TOTAL = steps.length;
  let at = 1;

  function show(n, focus) {
    at = Math.max(1, Math.min(TOTAL, n));
    steps.forEach((s) => { s.hidden = Number(s.dataset.step) !== at; });
    dots.forEach((d, i) => { d.classList.toggle('is-done', i < at - 1); d.classList.toggle('is-on', i === at - 1); });
    count.textContent = fill('Step {n} of {total}', { n: at, total: TOTAL });
    P.session.set(KEY, at);
    if (P.readAloud) P.readAloud.stop();
    const step = steps[at - 1];
    if (!P.motion.reduce && step.animate) step.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (focus !== false) {
      const f = $('input:not([type=checkbox]), [aria-checked="true"], .wc__choice', step) || $('.wc__title', step);
      if (f) { if (f.classList.contains('wc__title')) f.setAttribute('tabindex', '-1'); f.focus({ preventScroll: true }); }
    }
  }

  // what "Listen" reads on each step: the heading, the question, the help line
  $$('[data-listen]').forEach((slot) => {
    const step = slot.closest('.wc__step');
    if (!P.readAloud) return;
    slot.replaceWith(P.readAloud.button(() => $$('.wc__title, .wc__q, .wc__help', step).map((el) => el.textContent.trim()).join('. ')));
  });
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => show(at - 1)));

  const save = async (body, btn) => {
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    try { await P.put('/api/me', body); return true; } catch (e) { P.toast(e.message, 'error'); return false; } finally { if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); } }
  };

  /* ---------- 1. name ---------- */
  const nameForm = $('.wc__step[data-step="1"]');
  const nameIn = $('#wc-name'), nameErr = $('#wc-name-err');
  nameIn.value = user.name || '';
  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = P.clean(nameIn.value);
    nameErr.textContent = '';
    if (!name) { nameErr.textContent = t('Please write your name.'); nameIn.focus(); if (P.shake) P.shake(nameIn); return; }
    if (await save({ name }, $('.wc__next', nameForm))) { user.name = name; show(2); }
  });

  /* ---------- 2. date of birth ---------- */
  const dobForm = $('.wc__step[data-step="2"]');
  const day = $('#wc-day'), month = $('#wc-month'), year = $('#wc-year'), yearOnly = $('#wc-yearonly'), dobErr = $('#wc-dob-err');
  const opt = (v, label) => `<option value="${v}">${P.esc(label)}</option>`;
  const thisYear = new Date().getFullYear();
  day.innerHTML = opt('', '–') + Array.from({ length: 31 }, (_, i) => opt(i + 1, String(i + 1))).join('');
  // the months by name, in the page's own language
  let names = [];
  try { const f = new Intl.DateTimeFormat(P.lang || 'en', { month: 'long' }); names = Array.from({ length: 12 }, (_, i) => f.format(new Date(2020, i, 15))); } catch (e) { names = []; }
  if (names.length !== 12) names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  month.innerHTML = opt('', '–') + names.map((m, i) => opt(i + 1, m)).join('');
  year.innerHTML = opt('', '–') + Array.from({ length: 98 }, (_, i) => opt(thisYear - 3 - i, String(thisYear - 3 - i))).join('');
  const syncYearOnly = () => $$('.wc__part[data-part]', dobForm).forEach((p) => { p.hidden = yearOnly.checked; });
  yearOnly.addEventListener('change', syncYearOnly);
  if (user.dob) {
    year.value = user.dob.slice(0, 4);
    if (user.dob.length > 4) { month.value = String(Number(user.dob.slice(5, 7))); day.value = String(Number(user.dob.slice(8, 10))); } else yearOnly.checked = true;
  }
  syncYearOnly();
  const pad = (n) => String(n).padStart(2, '0');
  dobForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    dobErr.textContent = '';
    let dob;
    if (yearOnly.checked) {
      if (!year.value) { dobErr.textContent = t('Please choose the year.'); year.focus(); return; }
      dob = year.value;
    } else {
      if (!day.value || !month.value || !year.value) { dobErr.textContent = t('Please choose the day, the month and the year. If you only know the year, tick the box.'); (day.value ? (month.value ? year : month) : day).focus(); return; }
      const d = new Date(Number(year.value), Number(month.value) - 1, Number(day.value));
      if (d.getMonth() !== Number(month.value) - 1) { dobErr.textContent = t('That day is not in that month. Please check it.'); day.focus(); return; }
      dob = `${year.value}-${pad(month.value)}-${pad(day.value)}`;
    }
    if (await save({ dob }, $('.wc__next', dobForm))) { user.dob = dob; show(3); }
  });
  const skip = $('[data-skip]', dobForm);
  if (skip) skip.addEventListener('click', () => show(3));

  /* ---------- 3. language ---------- */
  const langs = $('.wc__langs');
  let pick = P.lang || 'en';
  langs.innerHTML = Object.entries(P.LANGS || { en: { name: 'English', label: 'English' } }).map(([code, L]) =>
    `<button class="wc__lang" type="button" role="radio" aria-checked="${code === pick}" data-code="${code}" lang="${code}"${L.dir ? ` dir="${L.dir}"` : ''}>
      <span class="wc__lname">${P.esc(L.name)}</span>${L.label && L.label !== L.name ? `<span class="wc__llabel" lang="en" dir="ltr">${P.esc(L.label)}</span>` : ''}
    </button>`).join('');
  const choose = (b) => {
    pick = b.dataset.code;
    $$('.wc__lang', langs).forEach((x) => { const on = x === b; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
  };
  $$('.wc__lang', langs).forEach((b) => {
    b.tabIndex = b.dataset.code === pick ? 0 : -1;
    b.addEventListener('click', () => choose(b));
  });
  // arrow keys move through the languages, as in any radio group
  langs.addEventListener('keydown', (e) => {
    const all = $$('.wc__lang', langs), i = all.findIndex((x) => x === document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    const n = all[(i + step + all.length) % all.length];
    choose(n); n.focus();
  });
  $('[data-lang-next]').addEventListener('click', async () => {
    if (pick === P.lang) { show(4); return; }
    P.session.set(KEY, 4);
    await P.setLang(pick); // saves it and reloads the page in that language, at step 4
  });

  /* ---------- 4. the tour, or not ---------- */
  $$('[data-tour]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await save({ welcomed: true }, b))) return;
    P.session.remove(KEY);
    location.href = b.dataset.tour === 'yes' ? 'app.html?tour=1' : next;
  }));

  const resume = Number(P.session.get(KEY, 1)) || 1;
  show(resume, resume > 1);
})();
