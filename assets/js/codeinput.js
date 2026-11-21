/* =====================================================================
   Six-slot code input (used for the invite code and the email OTP).
   A real <input> sits invisibly over the slots; each slot has a gold
   fill that scales in, and the active slot shows a blinking caret.

   P.codeInput(rootEl, {
     length: 6, digits: false, label, describedBy, msgEl,
     check: async (code) => true | false | 'error message',
     successHTML, errorText, onSuccess(code)
   }) -> { reset(), focus(), disable() }
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;

  const CHECK_SVG = '<svg class="check" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
    '<path d="M7 12.4l3.3 3.3L17.2 8.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  P.CHECK_SVG = CHECK_SVG;

  P.codeInput = function (root, options) {
    const o = Object.assign({
      length: 6, digits: false, label: 'Code', describedBy: '', msgEl: null,
      check: async () => false, successHTML: `${CHECK_SVG}<span>Done</span>`, errorText: 'That code isn’t valid. Try again.',
      onSuccess: null
    }, options);

    root.classList.add('code');
    if (o.digits) root.classList.add('code--digits');
    const slotsHTML = Array.from({ length: o.length }, (_, i) =>
      `<div class="slot" style="--i:${i}"><span class="slot__fill"></span><span class="slot__ch"></span><span class="slot__caret"></span></div>`).join('');
    root.innerHTML =
      `<input class="code__input" type="text" inputmode="${o.digits ? 'numeric' : 'text'}" maxlength="${o.length}"` +
      ` autocomplete="one-time-code" autocapitalize="${o.digits ? 'off' : 'characters'}" autocorrect="off" spellcheck="false"` +
      ` aria-label="${P.esc(o.label)}"${o.describedBy ? ` aria-describedby="${P.esc(o.describedBy)}"` : ''}>` +
      `<div class="slots" aria-hidden="true">${slotsHTML}</div>`;

    const input = root.querySelector('.code__input');
    const slots = Array.from(root.querySelectorAll('.slot'));
    const msg = o.msgEl;
    const pattern = o.digits ? /[^0-9]/g : /[^A-Z0-9]/g;
    let state = 'idle';
    let timer = 0;

    function render() {
      const v = input.value;
      slots.forEach((s, i) => {
        s.classList.toggle('is-filled', i < v.length);
        s.querySelector('.slot__ch').textContent = v[i] || '';
        s.classList.toggle('is-active', state === 'idle' && v.length < o.length && i === v.length);
      });
    }
    function setMessage(kind, html) {
      if (!msg) return;
      msg.className = 'code-msg' + (kind ? ` is-${kind}` : '');
      msg.innerHTML = html;
    }

    async function verify(code) {
      state = 'checking';
      input.readOnly = true;
      root.classList.add('is-checking');
      render();
      const [result] = await Promise.all([o.check(code), P.delay(P.motion.reduce ? 0 : 450)]);
      root.classList.remove('is-checking');
      if (result === true) {
        state = 'success';
        root.classList.add('is-success');
        setMessage('success', o.successHTML);
        input.blur();
        render();
        if (o.onSuccess) o.onSuccess(code);
      } else {
        state = 'error';
        root.classList.add('is-error');
        setMessage('error', P.esc(typeof result === 'string' ? result : o.errorText));
        if (navigator.vibrate) navigator.vibrate(60);
        render();
        timer = setTimeout(() => {
          root.classList.remove('is-error');
          input.value = '';
          input.readOnly = false;
          state = 'idle';
          render();
          input.focus({ preventScroll: true });
        }, P.motion.reduce ? 1200 : 950);
      }
    }

    input.addEventListener('input', () => {
      if (state !== 'idle') return;
      const clean = (o.digits ? input.value : input.value.toUpperCase()).replace(pattern, '').slice(0, o.length);
      input.value = clean;
      if (clean.length && msg && msg.classList.contains('is-error')) setMessage('', '');
      render();
      if (clean.length === o.length) verify(clean);
    });
    const caretToEnd = () => {
      const n = input.value.length;
      try { input.setSelectionRange(n, n); } catch (e) { /* noop */ }
    };
    input.addEventListener('focus', () => { root.classList.add('is-focused'); caretToEnd(); render(); });
    input.addEventListener('blur', () => root.classList.remove('is-focused'));
    input.addEventListener('click', caretToEnd);
    input.addEventListener('keyup', caretToEnd);

    render();

    return {
      reset() {
        clearTimeout(timer);
        state = 'idle';
        root.classList.remove('is-success', 'is-error', 'is-checking');
        input.readOnly = false;
        input.value = '';
        setMessage('', '');
        render();
      },
      focus() { input.focus(); },
      disable() { state = 'done'; input.readOnly = true; render(); }
    };
  };
})();
