/* =====================================================================
   Auth page. Sign up = invite code -> account details -> email code.
   Sign in = email + password (no invite needed).
   Everything is mocked in the browser; see P.auth in core.js.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, $$ = P.$$;

  const next = P.safeNext(P.params.get('next'));
  if (P.auth.current()) { location.replace(next); return; }

  const ripple = P.rippleLibrary ? P.rippleLibrary($('#auth-ripple')) : null;
  const today = () => new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

  /* ---------- tabs ---------- */
  const tabs = $$('.tab');
  const panels = { signup: $('#panel-signup'), signin: $('#panel-signin') };

  function focusFirst(root) {
    const el = root && Array.from(root.querySelectorAll('input:not([type="hidden"]), button, textarea'))
      .find((n) => !n.disabled && n.offsetParent !== null);
    if (el) el.focus({ preventScroll: true });
  }

  function showTab(name, focus) {
    if (!panels[name]) name = 'signup';
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    Object.entries(panels).forEach(([k, el]) => { el.hidden = k !== name; });
    if (location.hash !== '#' + name) history.replaceState(null, '', location.pathname + location.search + '#' + name);
    if (focus) focusFirst(name === 'signup' ? currentStepEl() : panels.signin);
  }

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showTab(t.dataset.tab, true));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const other = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      other.focus();
      showTab(other.dataset.tab);
    });
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    showTab(a.dataset.goto, true);
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (panels[h]) showTab(h);
  });

  /* ---------- password show/hide ---------- */
  $$('.pw__toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('aria-controls'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
      input.focus();
    });
  });

  /* ---------- sign-up steps ---------- */
  const STEPS = ['invite', 'account', 'otp'];
  const stepEls = { invite: $('#step-invite'), account: $('#step-account'), otp: $('#step-otp') };
  let step = 'invite';
  const currentStepEl = () => stepEls[step];

  function go(name, focus = true) {
    step = name;
    const idx = STEPS.indexOf(name);
    STEPS.forEach((s, i) => {
      stepEls[s].hidden = s !== name;
      const li = $(`#progress [data-step="${s}"]`);
      li.classList.toggle('is-current', i === idx);
      li.classList.toggle('is-done', i < idx);
      if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (focus && !panels.signup.hidden) focusFirst(stepEls[name]);
  }

  // 1. invite code
  const stamp = $('#stamp');
  P.codeInput($('#invite-code'), {
    length: 6,
    label: 'Invite code, 6 characters',
    describedBy: 'invite-hint',
    msgEl: $('#invite-msg'),
    check: async (code) => code === P.config.inviteCode,
    successHTML: `${P.CHECK_SVG}<span>Welcome in!</span>`,
    errorText: 'That code isn’t valid. Try again.',
    onSuccess: () => {
      P.session.set('primer.invite', true);
      $('#invite-hint').hidden = true;
      $('#stamp-date').textContent = today();
      stamp.hidden = false;
      if (ripple) ripple.burst();
      setTimeout(() => go('account'), P.motion.reduce ? 600 : 1600);
    }
  });

  // 2. account details
  const form = $('#step-account');
  const fName = $('#su-name'), fEmail = $('#su-email'), fPass = $('#su-pass');
  const setErr = (input, html) => {
    const err = document.getElementById(input.id + '-err');
    err.innerHTML = html || '';
    input.setAttribute('aria-invalid', html ? 'true' : 'false');
    if (html) input.setAttribute('aria-describedby', err.id); else input.removeAttribute('aria-describedby');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    [fName, fEmail, fPass].forEach((f) => setErr(f, ''));
    let bad = null;
    if (!P.clean(fName.value)) { setErr(fName, 'Enter your name.'); bad = bad || fName; }
    if (!P.auth.validEmail(fEmail.value)) { setErr(fEmail, 'Enter an email address, like you@gmail.com.'); bad = bad || fEmail; }
    else if (P.auth.user(fEmail.value)) {
      setErr(fEmail, 'An account already uses this email. <a href="#signin" data-goto="signin">Sign in instead</a>.');
      bad = bad || fEmail;
    }
    if (fPass.value.length < 8) { setErr(fPass, 'Use at least 8 characters.'); bad = bad || fPass; }
    if (bad) { bad.focus(); P.shake(bad); return; }

    const btn = form.querySelector('button[type="submit"]');
    btn.classList.add('is-busy');
    btn.disabled = true;
    const rec = await P.auth.prepare({ name: fName.value, email: fEmail.value, password: fPass.value });
    await P.delay(P.motion.reduce ? 0 : 500); // "sending the email"
    btn.classList.remove('is-busy');
    btn.disabled = false;
    const pending = Object.assign(rec, { otp: makeOtp(), otpAt: Date.now() });
    P.session.set('primer.pending', pending);
    fPass.value = '';
    showOtp(pending);
    otp.reset();
    go('otp');
  });

  // 3. email code (mock: the "email" is shown on the page)
  function makeOtp() {
    let n;
    if (window.crypto && crypto.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); n = a[0]; }
    else n = Math.floor(Math.random() * 1e9);
    return String(n % 1000000).padStart(6, '0');
  }
  function showOtp(p) {
    $('#otp-email').textContent = p.email;
    $('#otp-demo').textContent = p.otp;
    const inbox = $('#inbox');
    inbox.classList.remove('is-new');
    void inbox.offsetWidth;
    inbox.classList.add('is-new');
  }

  const otp = P.codeInput($('#otp-code'), {
    length: 6,
    digits: true,
    label: 'Email code, 6 digits',
    msgEl: $('#otp-msg'),
    check: async (code) => {
      const p = P.session.get('primer.pending');
      if (!p) return 'This sign-up timed out. Start again with your invite code.';
      if (Date.now() - p.otpAt > P.config.otpMinutes * 60000) return 'That code has expired. Send a new one.';
      return code === p.otp ? true : 'That code doesn’t match the email. Check it and try again.';
    },
    successHTML: `${P.CHECK_SVG}<span>Email confirmed. Opening Primer…</span>`,
    onSuccess: () => {
      const p = P.session.get('primer.pending');
      const user = P.auth.create(p);
      P.auth.startSession(user);
      P.session.remove('primer.pending');
      P.session.remove('primer.invite');
      setTimeout(() => { location.href = next; }, P.motion.reduce ? 200 : 1100);
    }
  });

  const resend = $('#otp-resend');
  let cooldown = 0, cdTimer = 0;
  function tickCooldown() {
    const left = Math.ceil((cooldown - Date.now()) / 1000);
    if (left <= 0) {
      resend.disabled = false;
      resend.textContent = 'Send a new code';
      return;
    }
    resend.disabled = true;
    resend.textContent = `Send a new code (${left}s)`;
    cdTimer = setTimeout(tickCooldown, 500);
  }
  resend.addEventListener('click', () => {
    const p = P.session.get('primer.pending');
    if (!p) { go('invite'); return; }
    p.otp = makeOtp();
    p.otpAt = Date.now();
    P.session.set('primer.pending', p);
    showOtp(p);
    otp.reset();
    otp.focus();
    P.toast('We sent a new code. The old one no longer works.');
    cooldown = Date.now() + 30000;
    clearTimeout(cdTimer);
    tickCooldown();
  });
  $('#otp-change').addEventListener('click', () => {
    const p = P.session.get('primer.pending');
    if (p) { fName.value = p.name; fEmail.value = p.email; }
    P.session.remove('primer.pending');
    otp.reset();
    go('account');
    fEmail.select();
  });

  /* ---------- sign in ---------- */
  const signin = $('#signin-form');
  const siErr = $('#signin-error');
  signin.addEventListener('submit', async (e) => {
    e.preventDefault();
    siErr.innerHTML = '';
    const email = $('#si-email'), pass = $('#si-pass');
    if (!P.auth.validEmail(email.value) || !pass.value) {
      siErr.textContent = 'Enter the email and password you signed up with.';
      P.shake(signin);
      (P.auth.validEmail(email.value) ? pass : email).focus();
      return;
    }
    const btn = signin.querySelector('button[type="submit"]');
    btn.disabled = true;
    const res = await P.auth.signIn(email.value, pass.value);
    btn.disabled = false;
    if (res.ok) { location.href = next; return; }
    if (res.reason === 'no-account') {
      siErr.innerHTML = 'No account uses this email yet. <a href="#signup" data-goto="signup">Sign up with an invite code</a>.';
      email.focus();
    } else {
      siErr.textContent = 'That password doesn’t match this account. Try again.';
      pass.select();
    }
    P.shake(signin);
  });

  /* ---------- restore where the visitor left off ---------- */
  const pending = P.session.get('primer.pending');
  if (pending) {
    fName.value = pending.name;
    fEmail.value = pending.email;
    showOtp(pending);
    go('otp', false);
  } else if (P.session.get('primer.invite')) {
    go('account', false);
  } else {
    go('invite', false);
  }

  const hash = location.hash.slice(1);
  showTab(panels[hash] ? hash : (P.params.get('next') ? 'signin' : 'signup'));
})();
