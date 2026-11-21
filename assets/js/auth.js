/* =====================================================================
   Auth page. Sign up = invite code (when the server asks for one) ->
   account details. Sign in = email + password. The server checks
   everything, hashes the password with argon2id and sets the session
   cookie; this page only collects the details and shows what went wrong.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $ = P.$, $$ = P.$$;

  const next = P.safeNext(P.params.get('next'));
  const needInvite = P.auth.inviteRequired();
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
  const STEPS = needInvite ? ['invite', 'account'] : ['account'];
  const stepEls = { invite: $('#step-invite'), account: $('#step-account') };
  let step = STEPS[0];
  const currentStepEl = () => stepEls[step];

  if (!needInvite) {
    $('#progress').hidden = true;
    $('#account-intro').textContent = 'Your courses, notes and progress are saved to this account, so they follow you to any device.';
    const sw = $('.auth__switch');
    if (sw) sw.innerHTML = 'New here? <a href="#signup" data-goto="signup">Create an account</a>';
  }

  function go(name, focus = true) {
    step = name;
    const idx = STEPS.indexOf(name);
    Object.entries(stepEls).forEach(([s, el]) => { el.hidden = s !== name; });
    STEPS.forEach((s, i) => {
      const li = $(`#progress [data-step="${s}"]`);
      if (!li) return;
      li.classList.toggle('is-current', i === idx);
      li.classList.toggle('is-done', i < idx);
      if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (focus && !panels.signup.hidden) focusFirst(stepEls[name]);
  }

  // 1. invite code, checked by the server
  const stamp = $('#stamp');
  if (P.boot.inviteHint) {
    $('#invite-hint').textContent = `(Demo code: ${P.boot.inviteHint})`;
    $('#invite-hint').hidden = false;
  }
  if (needInvite) {
    P.codeInput($('#invite-code'), {
      length: 6,
      label: 'Invite code, 6 characters',
      describedBy: 'invite-hint',
      msgEl: $('#invite-msg'),
      check: async (code) => {
        try { await P.auth.checkInvite(code); return true; } catch (err) { return err.message; }
      },
      successHTML: `${P.CHECK_SVG}<span>Welcome in!</span>`,
      errorText: 'That code isn’t valid. Try again.',
      onSuccess: (code) => {
        P.session.set('primer.invite', code);
        $('#invite-hint').hidden = true;
        $('#stamp-date').textContent = today();
        stamp.hidden = false;
        if (ripple) ripple.burst();
        setTimeout(() => go('account'), P.motion.reduce ? 600 : 1600);
      }
    });
  }

  // 2. account details, created by the server
  const form = $('#step-account');
  const fName = $('#su-name'), fEmail = $('#su-email'), fPass = $('#su-pass');
  const formErr = $('#su-form-err');
  const setErr = (input, html) => {
    const err = document.getElementById(input.id + '-err');
    err.innerHTML = html || '';
    input.setAttribute('aria-invalid', html ? 'true' : 'false');
    if (html) input.setAttribute('aria-describedby', err.id); else input.removeAttribute('aria-describedby');
  };
  const fieldFor = { name: fName, email: fEmail, password: fPass };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    [fName, fEmail, fPass].forEach((f) => setErr(f, ''));
    formErr.textContent = '';
    let bad = null;
    if (!P.clean(fName.value)) { setErr(fName, 'Enter your name.'); bad = bad || fName; }
    if (!P.auth.validEmail(fEmail.value)) { setErr(fEmail, 'Enter an email address, like you@gmail.com.'); bad = bad || fEmail; }
    if (fPass.value.length < 8) { setErr(fPass, 'Use at least 8 characters.'); bad = bad || fPass; }
    if (bad) { bad.focus(); P.shake(bad); return; }

    const btn = form.querySelector('button[type="submit"]');
    btn.classList.add('is-busy');
    btn.disabled = true;
    try {
      await P.auth.signUp({ invite: P.session.get('primer.invite') || '', name: fName.value, email: fEmail.value, password: fPass.value });
      P.session.remove('primer.invite');
      fPass.value = '';
      btn.textContent = 'Account created. Opening Primer…';
      setTimeout(() => { location.href = next; }, P.motion.reduce ? 100 : 500);
    } catch (err) {
      btn.classList.remove('is-busy');
      btn.disabled = false;
      if (err.fields) {
        Object.entries(err.fields).forEach(([k, msg]) => {
          const input = fieldFor[k];
          if (!input) return;
          setErr(input, k === 'email' && err.status === 409
            ? `${P.esc(msg)} <a href="#signin" data-goto="signin">Sign in instead</a>.`
            : P.esc(msg));
        });
        const first = fieldFor[Object.keys(err.fields)[0]];
        if (first) { first.focus(); P.shake(first); }
      } else if (/invite/i.test(err.message) && needInvite) {
        P.session.remove('primer.invite');
        formErr.textContent = 'Your invite code wasn’t accepted. Enter it again.';
        setTimeout(() => go('invite'), 1200);
      } else {
        formErr.textContent = err.message;
      }
    }
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
    try {
      await P.auth.signIn(email.value, pass.value);
      location.href = next;
    } catch (err) {
      btn.disabled = false;
      siErr.innerHTML = err.status === 401
        ? `${P.esc(err.message)} Check them and try again, or <a href="#signup" data-goto="signup">create an account</a>.`
        : P.esc(err.message);
      pass.select();
      P.shake(signin);
    }
  });

  /* ---------- restore where the visitor left off ---------- */
  go(needInvite && !P.session.get('primer.invite') ? 'invite' : 'account', false);
  const hash = location.hash.slice(1);
  showTab(panels[hash] ? hash : (P.params.get('next') ? 'signin' : 'signup'));
})();
