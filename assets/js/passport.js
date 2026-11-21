/* =====================================================================
   The skill passport (server/exams.mjs).

   certificate.html            the learner's certificates
   certificate.html?code=…     one certificate, ready to print, with its
                               QR code, and a switch to hide it from the
                               public page or show it again
   verify.html?code=…          anyone, signed in or not, checks a code:
                               the same facts, or "hidden", or "no such
                               certificate"

   The QR code is drawn here (assets/js/qr.js) and points at the verify
   page on this same site.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const $ = P.$, esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);
  const fill = (s, vals) => esc(t(s)).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
  const enc = encodeURIComponent;
  const page = document.body.dataset.page;
  const root = $('#pc-root');

  const SEAL = `<svg viewBox="0 0 120 120" aria-hidden="true">
      <g fill="#b07f3a">${Array.from({ length: 24 }, (_, i) => `<path d="M60 4l5 12h-10z" transform="rotate(${i * 15} 60 60)"/>`).join('')}</g>
      <circle cx="60" cy="60" r="45" fill="#d6a554" stroke="#8a6128" stroke-width="2"/>
      <circle cx="60" cy="60" r="37" fill="none" stroke="#f3d38f" stroke-width="1.5" stroke-dasharray="2 3"/>
      <path d="M40 61l13 13 27-29" fill="none" stroke="#2b1d11" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  const BOOK = '<svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M16 9.2c-3-2.3-7-2.7-11-1.6v16c4-1.1 8-.7 11 1.6 3-2.3 7-2.7 11-1.6v-16c-4-1.1-8-.7-11 1.6z"/><path d="M16 9.2v16"/></svg>';

  function fmtDate(ms) {
    try { return new Date(ms).toLocaleDateString(P.lang || 'en', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return new Date(ms).toDateString(); }
  }
  const num = (n) => { try { return new Intl.NumberFormat(P.lang || 'en', { maximumFractionDigits: 1 }).format(n); } catch (e) { return String(n); } };
  // the course's language by its own name, and in the reader's language when that differs
  function langLabel(f) {
    const C = P.COURSE_LANGS && P.COURSE_LANGS[f.lang];
    if (!C) return esc(f.langName || f.lang || '');
    const local = P.langName ? P.langName(f.lang) : C.label;
    return `<span lang="${esc(f.lang)}">${esc(C.name)}</span>${local && local !== C.name ? ` (${esc(local)})` : ''}`;
  }
  const verifyURL = (code) => `${location.origin}/verify.html?code=${enc(code)}`;

  function certHTML(p) {
    const f = p.facts || {};
    const qr = P.qr ? P.qr.svg(verifyURL(p.code), { margin: 2, dark: '#2b1d11', label: t('QR code: open it to check this certificate') }) : '';
    const fixed = f.mistakesMade
      ? `<dd class="cert__num">${f.mistakesFixed}</dd><dd class="cert__sub">${f.mistakesMade === 1 ? esc(t('of 1 mistake, fixed in Review')) : fill('of {n} mistakes, fixed in Review', { n: f.mistakesMade })}</dd>`
      : `<dd class="cert__num">0</dd><dd class="cert__sub">${esc(t('none to fix'))}</dd>`;
    const units = (f.units || []).map((u, i) => `<li class="${u.passed ? 'is-passed' : ''}"><span class="cert__unit-n">${P.roman ? P.roman(i + 1) : i + 1}</span> <span data-no-i18n>${esc(u.title)}</span>${u.passed ? ` <span class="cert__tick" aria-label="${esc(t('passed'))}">✓</span>` : ''}</li>`).join('');
    return `<article class="cert" aria-labelledby="cert-course">
      <div class="cert__frame">
        <span class="cert__corner cert__corner--tl" aria-hidden="true"></span><span class="cert__corner cert__corner--tr" aria-hidden="true"></span>
        <span class="cert__corner cert__corner--bl" aria-hidden="true"></span><span class="cert__corner cert__corner--br" aria-hidden="true"></span>
        <p class="cert__brand">${BOOK}<span>Primer</span><span class="cert__brand-sub">${esc(t('Skill passport'))}</span></p>
        <p class="cert__kicker">${esc(t('Certificate of completion'))}</p>
        <p class="cert__this">${esc(t('This certifies that'))}</p>
        <p class="cert__name" data-no-i18n>${esc(f.name)}</p>
        <p class="cert__has">${esc(t('has completed the course'))}</p>
        <h1 class="cert__course" id="cert-course" data-no-i18n lang="${esc(f.lang || 'en')}">${esc(f.course)}</h1>
        <p class="cert__lang">${fill('taught in {lang}, and passed its final exam', { lang: langLabel(f) })}</p>
        <dl class="cert__facts">
          <div><dt>${esc(t('Final exam'))}</dt><dd class="cert__num">${f.pct}%</dd><dd class="cert__sub">${fill('{score} of {total} marks', { score: num(f.score), total: f.total })}</dd></div>
          <div><dt>${esc(t('Units passed'))}</dt><dd class="cert__num">${f.unitsPassed}</dd><dd class="cert__sub">${fill('of {n} unit exams', { n: f.unitsTotal })}</dd></div>
          <div><dt>${esc(t('Lessons completed'))}</dt><dd class="cert__num">${f.lessonsDone}</dd><dd class="cert__sub">${fill('of {n} lessons', { n: f.lessonsTotal })}</dd></div>
          <div><dt>${esc(t('Mistakes fixed'))}</dt>${fixed}</div>
        </dl>
        ${units ? `<ol class="cert__units" aria-label="${esc(t('Units'))}">${units}</ol>` : ''}
        <footer class="cert__foot">
          <div class="cert__date"><span class="cert__line">${esc(fmtDate(f.completedAt))}</span><span class="cert__cap">${esc(t('Date completed'))}</span></div>
          <div class="cert__seal">${SEAL}</div>
          <div class="cert__check">
            <div class="cert__qr">${qr}</div>
            <div class="cert__checktext">
              <span class="cert__cap">${esc(t('Check it at'))}</span>
              <span class="cert__url" data-no-i18n>${esc(location.host)}/verify.html</span>
              <span class="cert__cap">${esc(t('with the code'))}</span>
              <strong class="cert__code" data-no-i18n>${esc(p.code)}</strong>
            </div>
          </div>
        </footer>
      </div>
    </article>`;
  }

  /* ---------------- certificate.html ---------------- */
  async function showList() {
    const d = await P.get('/api/passports');
    document.title = `${t('Skill passport')} | Primer`;
    const cards = d.passports.map((p) => `<li><a class="pc-card card card--solid" href="certificate.html?code=${enc(p.code)}">
        <span class="pc-card__seal" aria-hidden="true">${SEAL}</span>
        <span class="pc-card__body">
          <span class="pc-card__course" data-no-i18n>${esc(p.facts.course)}</span>
          <span class="pc-card__meta">${fill('Completed on {date} · final exam {pct}', { date: esc(fmtDate(p.facts.completedAt)), pct: `${p.facts.pct}%` })}</span>
          ${p.hidden ? `<span class="pc-card__hidden">${esc(t('Hidden from the public'))}</span>` : ''}
        </span>
        <span class="pc-card__code" data-no-i18n>${esc(p.code)}</span>
      </a></li>`).join('');
    root.innerHTML = `
      <header class="pc-head">
        <h1>${esc(t('Your skill passport'))}</h1>
        <p>${esc(t('A certificate for every course you complete by passing its final exam. Each has a code and a QR code, so an employer, school or NGO can check it on Primer, without an account.'))}</p>
      </header>
      ${cards ? `<ul class="pc-list">${cards}</ul>` : `<div class="pc-empty card card--solid"><p>${esc(t('No certificates yet. Pass a course’s final exam to earn one.'))}</p><p><a class="btn" href="app.html#library">${esc(t('Go to your courses'))}</a></p></div>`}`;
  }

  async function showOne(code) {
    const d = await P.get(`/api/passports/${enc(code)}`);
    const p = d.passport;
    document.title = `${p.facts.course} | Primer`;
    const state = () => (p.hidden
      ? esc(t('Hidden. The public page says this certificate isn’t public, and shows none of its details.'))
      : esc(t('Public. Anyone with the link, the code or the QR code can check it.')));
    root.innerHTML = `
      <a class="backlink pc-back" href="certificate.html">${esc(t('Skill passport'))}</a>
      <div class="pc-tools card card--solid">
        <p class="pc-tools__state" data-state>${state()}</p>
        <div class="pc-tools__actions">
          <button class="btn btn--small" type="button" data-print>${esc(t('Print or save as PDF'))}</button>
          <button class="btn btn--small btn--ghost" type="button" data-copy>${esc(t('Copy the link to check it'))}</button>
          <a class="textlink" href="verify.html?code=${enc(p.code)}">${esc(t('See the public page'))}</a>
          <button class="textlink" type="button" data-hide>${esc(p.hidden ? t('Make it public again') : t('Hide it from the public'))}</button>
          ${p.courseId ? `<a class="textlink" href="app.html?course=${enc(p.courseId)}">${esc(t('Back to the course'))}</a>` : ''}
        </div>
      </div>
      ${certHTML(p)}`;
    $('[data-print]', root).addEventListener('click', () => window.print());
    $('[data-copy]', root).addEventListener('click', () => copy(verifyURL(p.code)));
    const hide = $('[data-hide]', root);
    hide.addEventListener('click', async () => {
      if (!p.hidden && !window.confirm(t('Hide this certificate? Its public page will say it isn’t public, and show none of its details. You can make it public again at any time.'))) return;
      hide.disabled = true;
      try {
        const r = await P.patch(`/api/passports/${enc(p.code)}`, { hidden: !p.hidden });
        p.hidden = r.passport.hidden;
        hide.textContent = p.hidden ? t('Make it public again') : t('Hide it from the public');
        $('[data-state]', root).innerHTML = state();
        P.toast(p.hidden ? t('Hidden from the public.') : t('Public again.'));
      } catch (err) {
        P.toast(err.message, 'error');
      } finally {
        hide.disabled = false;
      }
    });
  }

  async function copy(value) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('copy refused');
      }
      P.toast(t('Link copied.'));
    } catch (e) {
      P.toast(t('Couldn’t copy. The link is on the public page.'), 'error');
    }
  }

  /* ---------------- verify.html ---------------- */
  function mountVerify() {
    const user = P.auth && P.auth.current();
    P.$$('[data-when]').forEach((el) => { el.hidden = el.dataset.when !== (user ? 'user' : 'guest'); });
    if (user) P.mountUserNav();
    const form = $('#vf-form'), input = $('#vf-code'), err = $('#vf-err');
    const code = P.params.get('code');
    if (code) { input.value = code; check(code); }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v.length !== 8) {
        err.textContent = t('A certificate code has 8 letters and numbers, like K7PQ-X4AB.');
        input.setAttribute('aria-invalid', 'true');
        P.shake(input);
        return;
      }
      err.textContent = '';
      input.removeAttribute('aria-invalid');
      const nice = `${v.slice(0, 4)}-${v.slice(4)}`;
      input.value = nice;
      history.replaceState(null, '', `verify.html?code=${enc(nice)}`);
      check(nice);
    });
  }

  async function check(code) {
    root.innerHTML = `<p class="pc-status" role="status">${esc(t('Checking…'))}</p>`;
    try {
      const d = await P.get(`/api/verify/${enc(code)}`, { allow401: true });
      if (!d.found) throw Object.assign(new Error('not found'), { status: 404 });
      if (d.hidden) {
        root.innerHTML = `<div class="vf-box vf-box--hidden card card--solid" role="status">
            <p class="vf-box__title">${esc(t('This certificate isn’t public'))}</p>
            <p>${fill('Primer issued a certificate with the code {code}, but its holder has hidden it, so its details aren’t shown. Ask them to make it public again.', { code: `<strong data-no-i18n>${esc(d.code)}</strong>` })}</p>
          </div>`;
        return;
      }
      const p = d.passport;
      document.title = `${p.facts.course}: ${t('certificate')} | Primer`;
      root.innerHTML = `
        <div class="vf-box vf-box--ok card card--solid" role="status">
          <span class="vf-box__icon" aria-hidden="true">✓</span>
          <div>
            <p class="vf-box__title">${esc(t('This certificate is genuine'))}</p>
            <p>${fill('Primer issued it to {name} on {date}. These are its details as Primer recorded them when the course was completed.', { name: `<strong data-no-i18n>${esc(p.facts.name)}</strong>`, date: esc(fmtDate(p.issuedAt)) })}</p>
          </div>
        </div>
        ${certHTML(p)}`;
    } catch (e) {
      root.innerHTML = `<div class="vf-box vf-box--bad card card--solid" role="alert">
          <p class="vf-box__title">${esc(t(e.status === 404 ? 'No certificate has that code' : 'The code couldn’t be checked'))}</p>
          <p>${esc(e.status === 404 ? t('Check the code and try again. Codes use the letters A to Z (without I and O) and the numbers 2 to 9.') : e.message)}</p>
        </div>`;
    }
  }

  (async () => {
    try {
      if (page === 'verify') return mountVerify();
      if (!P.auth.current()) return;
      P.mountUserNav();
      const code = P.params.get('code');
      if (code) await showOne(code); else await showList();
    } catch (err) {
      root.innerHTML = `<div class="pc-empty card card--solid"><h1>${esc(t('This didn’t open'))}</h1><p>${esc(err.message)}</p>
        <p><a class="btn" href="certificate.html">${esc(t('Skill passport'))}</a></p></div>`;
    }
  })();
})();
