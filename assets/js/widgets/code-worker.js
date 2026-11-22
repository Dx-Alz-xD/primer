/* =====================================================================
   The coding window's runner (assets/js/widgets/code.js): runs one
   program away from the page, so the page stays responsive however long
   the program runs, and Stop ends it at once (the page terminates this
   worker). What the program prints comes back as it prints, a little at
   a time; then the result. The interpreters are code-core.js, loaded
   from this same folder; a program can only print, read the input lines
   it was given, and draw with the turtle.
   ===================================================================== */
'use strict';
self.importScripts('code-core.js');

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type !== 'run' || !self.PrimerCode) return;
  let buf = [], last = Date.now();
  const flush = () => {
    if (buf.length) self.postMessage({ id: m.id, type: 'out', chunks: buf });
    buf = [];
    last = Date.now();
  };
  let r;
  try {
    r = self.PrimerCode.run(m.lang, m.code, {
      stdin: m.stdin, steps: m.steps, call: m.call || null,
      onOut: (s, k) => { buf.push({ s, k }); if (buf.length > 200 || Date.now() - last > 50) flush(); }
    });
  } catch (err) {
    r = { error: { kind: 'error', type: 'InternalError', message: String(err && err.message), line: 0, text: 'Something went wrong while running the program.' }, stdout: '', out: [] };
  }
  flush();
  delete r.value; // a program's own values stay here; what it printed and drew goes back
  r.out = null;
  self.postMessage({ id: m.id, type: 'done', result: r });
};
