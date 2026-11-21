/* =====================================================================
   Build from a syllabus (app.html). A small "Paste a syllabus" link in
   the course builder opens a box for a syllabus or chapter list, and the
   server plans the course to follow it (server/data.mjs and ai.mjs).
   The box is in use exactly while it is open: "Don't use a syllabus"
   closes it again.

   P.syllabus.value()  the syllabus to send with the course request ('' if none)
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.auth.current()) return;
  const $ = P.$;
  const MAX = 4000;

  const openRow = $('#b-syl-open-row'), openBtn = $('#b-syl-open'), field = $('#b-syl-field');
  const box = $('#b-syl'), count = $('#b-syl-count'), removeBtn = $('#b-syl-remove');
  if (!openBtn || !field || !box) return;

  const syncCount = () => {
    const n = box.value.length;
    count.textContent = n > MAX * 0.75 ? `${n} / ${MAX}` : '';
  };

  function setOpen(open) {
    field.hidden = !open;
    openRow.hidden = open;
    openBtn.setAttribute('aria-expanded', String(open));
    if (open) box.focus();
    else openBtn.focus();
  }

  openBtn.addEventListener('click', () => setOpen(true));
  removeBtn.addEventListener('click', () => {
    box.value = '';
    syncCount();
    setOpen(false);
  });
  box.addEventListener('input', syncCount);

  P.syllabus = {
    value: () => (field.hidden ? '' : box.value.replace(/\r\n?/g, '\n').trim().slice(0, MAX))
  };
})();
