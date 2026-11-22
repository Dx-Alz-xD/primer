/* =====================================================================
   The physics sandbox (assets/js/widgets.js): a live 2D scene for
   lessons on mechanics. Things fall with and without air, fly from a
   launcher, collide on a track, slide down ramps, bounce on springs,
   swing, smash through brick walls and float. The learner drags any
   object and throws it (it leaves the hand at the hand's speed), taps
   one to read its values, and moves sliders for the scene's numbers.

   Beside the scene (below it on a phone) a panel shows, live, what the
   lesson asks for: time, position, velocity, speed, acceleration, each
   force (in the colour of its arrow on the drawing), momentum, energy,
   and the world's gravity and air; under it, a small graph against time
   (where terminal velocity shows as the curve flattening).

   The engine is assets/js/widgets/physics-core.js, shared with the
   server: a fixed step of 1/120 s, the same numbers everywhere. As a
   task the learner sets the sliders and presses Play; check() runs the
   scene from the start, without drawing, and says what came out.

   The same drawing code paints the live canvas and the still SVG for the
   book (a "pen" with two inks). Every spec is checked again here; its
   words go into the page as text, never as markup.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;

  /* ---------------- the engine, shared with the server ---------------- */

  let C = window.PrimerPhysics || null;
  const ready = C ? Promise.resolve(C) : new Promise((resolve, reject) => {
    let s = document.querySelector('script[data-physics-core]');
    if (!s) {
      s = document.createElement('script');
      s.src = '/assets/js/widgets/physics-core.js';
      s.async = true;
      s.setAttribute('data-physics-core', '');
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => { C = window.PrimerPhysics || null; if (C) resolve(C); else reject(new Error('the physics engine did not load')); });
    s.addEventListener('error', () => reject(new Error('the physics engine could not be loaded')));
  });
  ready.catch(() => {});
  if (document.currentScript) document.currentScript.ready = ready;

  /* ---------------- words ---------------- */

  const T = (s) => (P.t ? P.t(s) : s);
  const F = (s, v) => T(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m));
  const fmt = (x, u) => C.fmt(x, u);
  const nameOf = (b) => (b && (b.label || b.id)) || '';

  // what each slider is called (every string literal, for the translators)
  function varName(spec, v, t, fill) {
    const dot = v.indexOf('.');
    if (dot > 0) {
      const b = spec.bodies.find((x) => x.id === v.slice(0, dot));
      const name = nameOf(b), k = v.slice(dot + 1);
      const L = {
        mass: fill('Mass ({name})', { name }), cd: fill('Drag coefficient ({name})', { name }), area: fill('Area ({name})', { name }),
        b: fill('Linear drag ({name})', { name }), r: fill('Radius ({name})', { name }), e: fill('Bounciness ({name})', { name }),
        mu: fill('Friction ({name})', { name }), v: fill('Velocity ({name})', { name }), density: fill('Density ({name})', { name }),
        length: fill('Length ({name})', { name }), angle: fill('Angle ({name})', { name })
      };
      return L[k] || v;
    }
    const sc = spec.scene;
    switch (v) {
      case 'g': return t('Gravity g');
      case 'air': return t('Air density');
      case 'e': return t('Bounciness e');
      case 'k': return t('Spring constant k');
      case 'damping': return t('Damping');
      case 'pull': return t('Pull');
      case 'force': return sc === 'ramp' ? t('Force up the ramp') : t('Push');
      case 'strength': return t('Wall strength');
      case 'density': return t('Water density');
      case 'time': return t('Push time');
      case 'distance': return t('Distance to the wall');
      case 'pad': return t('Cushion time');
      case 'mu': return t('Friction μ');
      case 'angle': return sc === 'projectile' ? t('Launch angle') : sc === 'ramp' ? t('Ramp angle') : t('Starting angle');
      case 'speed': return sc === 'projectile' ? t('Launch speed') : t('Speed');
      case 'height': return sc === 'drop' ? t('Drop height') : t('Launch height');
      case 'length': return sc === 'ramp' ? t('Ramp length') : sc === 'spring' ? t('Natural length') : t('Length');
      default: return v;
    }
  }
  const unitOf = (spec, v) => { const i = C.varInfo(spec, v); return i ? i[2] : ''; };
  const valText = (spec, v, x) => fmt(x, unitOf(spec, v));

  /* ---------------- colours: the lesson's inks ---------------- */

  const INK = '#2b1d11', SOFT = '#5b4730', GOLD = '#8a6128', RED = '#9a3324', GREEN = '#3d6a2c', PAPER = '#f6eedb';
  const BLUE = '#2f5d8a', PURPLE = '#6b3f7a', TEAL = '#2f6f6a', ORANGE = '#b4561c', HATCH = 'rgba(91,71,48,.55)';
  const FILL = { red: '#c0533f', blue: '#4a78a8', green: '#5d8a4a', gold: '#c99a52', grey: '#8d8578', brown: '#8a5a3a', purple: '#7d5a8c', ink: '#3a2a1c', brick: '#a5493a' };
  const FORCES = ['weight', 'normal', 'friction', 'drag', 'spring', 'tension', 'buoyancy', 'applied', 'hand'];
  const FCOL = { weight: RED, normal: BLUE, friction: ORANGE, drag: TEAL, spring: PURPLE, tension: PURPLE, buoyancy: BLUE, applied: GOLD, hand: GOLD, net: INK, velocity: GREEN };
  const forceName = (k, t) => ({
    weight: t('Weight'), normal: t('Normal force'), friction: t('Friction'), drag: t('Drag'), spring: t('Spring force'), tension: t('Tension'),
    buoyancy: t('Buoyancy'), applied: t('Applied force'), hand: t('Your pull'), net: t('Net force')
  })[k] || k;

  /* ---------------- the pen: one drawing, two inks ---------------- */

  const SVGNS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r1 = (x) => Math.round(x * 10) / 10;
  const FONT = '"Cormorant Garamond", Georgia, "Times New Roman", serif';

  function canvasPen(g) {
    const style = (o) => {
      g.globalAlpha = o.alpha != null ? o.alpha : 1;
      if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = o.width || 1.5; g.setLineDash(o.dash || []); g.lineCap = o.cap || 'round'; g.lineJoin = 'round'; }
      if (o.fill) g.fillStyle = o.fill;
    };
    return {
      line(pts, o) { if (pts.length < 2) return; style(o); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke(); },
      poly(pts, o) { style(o); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); if (o.fill) g.fill(); if (o.stroke) g.stroke(); },
      circle(x, y, r, o) { style(o); g.beginPath(); g.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); if (o.fill) g.fill(); if (o.stroke) g.stroke(); },
      text(x, y, s, o) {
        style(o);
        g.font = `${o.italic ? 'italic ' : ''}${o.weight || 600} ${o.size || 14}px ${FONT}`;
        g.textAlign = o.anchor === 'middle' ? 'center' : o.anchor === 'end' ? 'right' : 'left';
        g.textBaseline = o.base || 'alphabetic';
        if (o.halo) { g.lineWidth = 3.5; g.strokeStyle = o.halo; g.setLineDash([]); g.lineJoin = 'round'; g.strokeText(s, x, y); }
        g.fillStyle = o.fill || INK; g.fillText(s, x, y);
      },
      done() { g.globalAlpha = 1; g.setLineDash([]); }
    };
  }
  function svgPen() {
    const out = [];
    const st = (o) => [
      o.fill ? `fill="${o.fill}"` : 'fill="none"', o.stroke ? `stroke="${o.stroke}" stroke-width="${o.width || 1.5}"` : '',
      o.dash ? `stroke-dasharray="${o.dash.join(' ')}"` : '', o.alpha != null && o.alpha < 1 ? `opacity="${r1(o.alpha * 100) / 100}"` : ''
    ].filter(Boolean).join(' ');
    const pts = (p) => p.map((q) => r1(q[0]) + ',' + r1(q[1])).join(' ');
    return {
      line(p, o) { if (p.length >= 2) out.push(`<polyline points="${pts(p)}" ${st(Object.assign({}, o, { fill: null }))} stroke-linecap="round" stroke-linejoin="round"/>`); },
      poly(p, o) { out.push(`<polygon points="${pts(p)}" ${st(o)} stroke-linejoin="round"/>`); },
      circle(x, y, r, o) { out.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(Math.max(0.5, r))}" ${st(o)}/>`); },
      text(x, y, s, o) {
        const base = o.base === 'middle' ? ' dy="0.35em"' : o.base === 'top' ? ' dy="0.8em"' : '';
        const halo = o.halo ? ` stroke="${o.halo}" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round"` : '';
        out.push(`<text x="${r1(x)}" y="${r1(y)}"${base} font-size="${o.size || 14}" font-weight="${o.weight || 600}"${o.italic ? ' font-style="italic"' : ''} text-anchor="${o.anchor || 'start'}" fill="${o.fill || INK}"${halo}>${esc(s)}</text>`);
      },
      done() {},
      svg(w, h, label) {
        return `<svg xmlns="${SVGNS}" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}" width="${Math.round(w)}" height="${Math.round(h)}" role="img" aria-label="${esc(label)}" font-family="Georgia, 'Times New Roman', serif"><rect width="100%" height="100%" fill="${PAPER}"/>${out.join('')}</svg>`;
      }
    };
  }

  /* ---------------- the camera ---------------- */

  // the world's view rectangle fitted into w x h pixels (y up in the world, down on screen)
  function camera(v, w, h, pad) {
    const vw = v.x1 - v.x0, vh = v.y1 - v.y0;
    const k = Math.min((w - 2 * pad) / vw, (h - 2 * pad) / vh);
    const ox = (w - vw * k) / 2, oy = (h - vh * k) / 2;
    const cam = { k, x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1, w, h, ox, oy };
    cam.sx = (x) => ox + (x - cam.x0) * k;
    cam.sy = (y) => h - oy - (y - cam.y0) * k;
    cam.wx = (px) => cam.x0 + (px - ox) / k;
    cam.wy = (py) => cam.y0 + (h - oy - py) / k;
    cam.left = cam.wx(0); cam.right = cam.wx(w); cam.top = cam.wy(0); cam.bottom = cam.wy(h);
    return cam;
  }
  function niceStep(x) {
    const e = Math.pow(10, Math.floor(Math.log10(x)));
    const m = x / e;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
  }

  /* ---------------- the drawing ---------------- */

  // everything in the scene, in world order; o: { sel, arrows, trails, still, t, fill }
  function paint(pen, W, spec, cam, o) {
    const t = o.t || T, fill = o.fill || F;
    const k = cam.k;
    const X = cam.sx, Y = cam.sy;
    let enlarged = false;
    const gy = Y(0);
    // fluid
    W.fluids.forEach((f) => {
      const x0 = X(f.x0), x1 = X(f.x1), y0 = Y(0), y1 = Y(f.level);
      pen.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { fill: 'rgba(74,120,168,.22)' });
      pen.line([[x0, y1], [x1, y1]], { stroke: 'rgba(47,93,138,.7)', width: 1.6 });
      for (let x = x0 + 8; x < x1 - 8; x += 22) pen.line([[x, y1 + 6], [x + 9, y1 + 6]], { stroke: 'rgba(47,93,138,.35)', width: 1.2 });
    });
    // the ground, hatched like a textbook diagram
    if (W.groundBody && gy < cam.h + 2) {
      pen.line([[0, gy], [cam.w, gy]], { stroke: INK, width: 2 });
      const off = ((X(0) % 12) + 12) % 12;
      for (let x = off - 12; x < cam.w + 12; x += 12) pen.line([[x, gy + 1], [x - 8, gy + 9]], { stroke: HATCH, width: 1 });
      // metre marks along the ground, so motion shows when the camera follows
      if (o.ticks) {
        const step = niceStep(70 / k);
        for (let x = Math.ceil(cam.left / step) * step; x <= cam.right; x += step) {
          pen.line([[X(x), gy], [X(x), gy + 5]], { stroke: SOFT, width: 1.2 });
          pen.text(X(x), gy + 17, fmt(x, 'm'), { size: 11.5, fill: SOFT, anchor: 'middle', weight: 500 });
        }
      }
    }
    // statics: ramps, walls, the cliff, the tank, track stops
    W.bodies.forEach((b) => {
      if (!b.isStatic || b.dead || b.kind === 'ground' || b.mortar) return;
      const pts = b.wx.map((x, i) => [X(x), Y(b.wy[i])]);
      if (b.kind === 'ceiling') {
        pen.poly(pts, { fill: '#d9c9a5', stroke: INK, width: 1.6 });
        const yb = Math.min(...pts.map((p) => p[1]));
        for (let x = Math.min(...pts.map((p) => p[0])) + 4; x < Math.max(...pts.map((p) => p[0])); x += 10) pen.line([[x, yb], [x + 7, yb - 7]], { stroke: HATCH, width: 1 });
        return;
      }
      pen.poly(pts, { fill: b.kind === 'ramp' ? '#e3d3ae' : b.kind === 'tank' ? '#cdbb92' : '#d9c9a5', stroke: INK, width: 1.6 });
      if (b.kind === 'ramp' || b.kind === 'cliff') {
        // hatching inside, clipped by hand: lines parallel to the slope's foot
        const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
        for (let y = maxY - 9; y > minY + 4; y -= 11) {
          const xs = [];
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], c = pts[(i + 1) % pts.length];
            if ((a[1] - y) * (c[1] - y) < 0) xs.push(a[0] + (y - a[1]) / (c[1] - a[1]) * (c[0] - a[0]));
          }
          if (xs.length === 2) pen.line([[Math.min(...xs) + 3, y], [Math.max(...xs) - 3, y]], { stroke: 'rgba(91,71,48,.25)', width: 1 });
        }
      }
    });
    // a cushion on the wall's face
    if (spec.scene === 'wall' && W.meta.wall) {
      const pad = W.bodies.find((b) => b.wallId && b.pad);
      if (pad) {
        const x = X(W.meta.wall[0]), top = Y(W.meta.wall[2]);
        const w = Math.max(3, Math.min(10, 3 + pad.pad * 60));
        pen.poly([[x - w, gy], [x, gy], [x, top], [x - w, top]], { fill: '#d6c48f', stroke: GOLD, width: 1.2 });
      }
    }
    // a landing zone to aim at
    if (spec.target) {
      const a = X(spec.target.x[0]), c = X(spec.target.x[1]);
      pen.poly([[a, gy - 6], [c, gy - 6], [c, gy], [a, gy]], { fill: 'rgba(138,97,40,.35)', stroke: GOLD, width: 1.4 });
      pen.line([[a, gy - 16], [a, gy]], { stroke: GOLD, width: 1.4 });
      pen.line([[c, gy - 16], [c, gy]], { stroke: GOLD, width: 1.4 });
      pen.text((a + c) / 2, gy - 12, `${fmt(spec.target.x[0], '')}–${fmt(spec.target.x[1], 'm')}`, { size: 12.5, fill: GOLD, anchor: 'middle', halo: PAPER });
    }
    // pivots, ropes and rods
    W.joints.forEach((j) => {
      if (j.type !== 'rod') return;
      const q = C.rodGeom(j);
      const a = [X(q.pax), Y(q.pay)], b = [X(q.pbx), Y(q.pby)];
      const slack = j.rope && q.len < j.L - 0.01;
      if (slack) {
        // a slack rope sags
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + Math.min(40, (j.L - q.len) * k * 0.5);
        const pts = []; for (let i = 0; i <= 12; i++) { const s = i / 12; pts.push([(1 - s) * (1 - s) * b[0] + 2 * s * (1 - s) * mx + s * s * a[0], (1 - s) * (1 - s) * b[1] + 2 * s * (1 - s) * my + s * s * a[1]]); }
        pen.line(pts, { stroke: SOFT, width: 1.4 });
      } else pen.line([b, a], { stroke: j.rope ? SOFT : INK, width: j.rope ? 1.4 : 2.6 });
      if (!j.B) {
        pen.poly([[b[0] - 12, b[1] - 9], [b[0] + 12, b[1] - 9], [b[0] + 12, b[1] - 4], [b[0] - 12, b[1] - 4]], { fill: '#d9c9a5', stroke: INK, width: 1.4 });
        for (let x = b[0] - 10; x < b[0] + 12; x += 6) pen.line([[x, b[1] - 9], [x + 5, b[1] - 14]], { stroke: HATCH, width: 1 });
        pen.circle(b[0], b[1], 3, { fill: INK });
      }
    });
    // springs: a coil that stretches
    W.springs.forEach((sp) => {
      const q = C.springGeom(sp);
      const a = [X(q.pax), Y(q.pay)], b = [X(q.pbx), Y(q.pby)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const lead = Math.min(10, L * 0.12), coils = 10, amp = Math.max(5, Math.min(11, 0.06 * sp.L * k + 4));
      const pts = [a, [a[0] + ux * lead, a[1] + uy * lead]];
      for (let i = 0; i < coils * 2; i++) {
        const s = lead + (L - 2 * lead) * (i + 0.5) / (coils * 2), side = i % 2 ? -1 : 1;
        pts.push([a[0] + ux * s + nx * amp * side, a[1] + uy * s + ny * amp * side]);
      }
      pts.push([b[0] - ux * lead, b[1] - uy * lead], b);
      pen.line(pts, { stroke: INK, width: 1.8 });
      if (!sp.A) pen.circle(a[0], a[1], 2.8, { fill: INK });
    });
    // the launcher
    if (spec.scene === 'projectile' && W.meta.launch) {
      const lx = X(W.meta.launch[0]), ly = Y(W.meta.launch[1]);
      const a = W.meta.angle * Math.PI / 180, L = 34;
      const bx = Math.cos(a), by = -Math.sin(a);
      const nx2 = -by, ny2 = bx;
      pen.poly([[lx - nx2 * 6, ly - ny2 * 6], [lx + bx * L - nx2 * 5, ly + by * L - ny2 * 5], [lx + bx * L + nx2 * 5, ly + by * L + ny2 * 5], [lx + nx2 * 6, ly + ny2 * 6]], { fill: '#6b5638', stroke: INK, width: 1.4 });
      pen.circle(lx, ly, 9, { fill: '#8a7350', stroke: INK, width: 1.4 });
      if (o.still) pen.text(lx + 44, ly - 6, fmt(W.meta.angle, '°'), { size: 13, fill: GOLD });
    }
    // trails
    if (o.trails) o.trails.forEach((tr) => {
      const n = tr.pts.length;
      for (let i = 0; i < n; i += 1) {
        const p = tr.pts[i];
        pen.circle(X(p[0]), Y(p[1]), 1.7, { fill: tr.color, alpha: 0.25 + 0.6 * (i / n) });
      }
    });
    // bodies: bricks first, then the rest
    const order = W.bodies.filter((b) => !b.dead && (!b.isStatic || b.mortar)).sort((a, b) => (b.mortar || b.loose ? 1 : 0) - (a.mortar || a.loose ? 1 : 0));
    order.forEach((b) => {
      const sel = o.sel === b;
      const col = FILL[b.color] || FILL.red;
      if (b.shape === 'ball') {
        let r = b.r * k;
        if (r < 6) { r = 6; enlarged = true; }
        const x = X(b.x), y = Y(b.y);
        pen.circle(x, y, r, { fill: col, stroke: INK, width: 1.5 });
        pen.circle(x - r * 0.35, y - r * 0.35, r * 0.28, { fill: 'rgba(255,250,235,.45)' });
        if (r >= 7) pen.line([[x, y], [x + Math.cos(-b.a) * r * 0.85, y + Math.sin(-b.a) * r * 0.85]], { stroke: 'rgba(43,29,17,.55)', width: 1.3 });
        if (sel) pen.circle(x, y, r + 5, { stroke: GOLD, width: 2, dash: [4, 3] });
        b._px = { x, y, r };
      } else {
        let pts = b.wx.map((x, i) => [X(x), Y(b.wy[i])]);
        const cx = X(b.x), cy = Y(b.y);
        const wpx = 2 * b.hw * k, hpx = 2 * b.hh * k;
        if (wpx < 8 || hpx < 8) { const sx = Math.max(1, 8 / wpx), sy = Math.max(1, 8 / hpx); const s = Math.max(sx, sy); pts = pts.map((p) => [cx + (p[0] - cx) * s, cy + (p[1] - cy) * s]); enlarged = true; }
        const brick = b.mortar || b.loose || b.color === 'brick';
        pen.poly(pts, { fill: brick ? FILL.brick : col, stroke: brick ? '#6e2b20' : INK, width: brick ? 1.1 : 1.5 });
        if (brick) pen.line([[pts[3][0] + (pts[2][0] - pts[3][0]) * 0.1, pts[3][1] + (pts[2][1] - pts[3][1]) * 0.1 + 2], [pts[2][0] - (pts[2][0] - pts[3][0]) * 0.1, pts[2][1] - (pts[2][1] - pts[3][1]) * 0.1 + 2]], { stroke: 'rgba(255,220,190,.35)', width: 1 });
        if (!brick && !o.names && b.label && wpx > 30) pen.text(cx, cy, b.label.slice(0, 8), { size: 11, fill: PAPER, anchor: 'middle', base: 'middle', weight: 700 });
        if (sel) pen.poly(pts.map((p) => [cx + (p[0] - cx) * 1.18 + Math.sign(p[0] - cx) * 3, cy + (p[1] - cy) * 1.18 + Math.sign(p[1] - cy) * 3]), { stroke: GOLD, width: 2, dash: [4, 3] });
        b._px = { x: cx, y: cy, r: Math.max(Math.hypot(wpx, hpx) / 2, 8) };
      }
    });
    // a name by each moving body
    const placed = [];
    if (o.names) order.forEach((b) => {
      if (b.isStatic || b.mortar || b.loose || b.piece || !b.id || !b._px) return;
      const p = b._px;
      let x = p.x + p.r + 4, y = p.y - p.r - 2;
      while (placed.some((q) => Math.abs(q[0] - x) < 40 && Math.abs(q[1] - y) < 13)) y += 14;
      placed.push([x, y]);
      pen.text(x, y, nameOf(b), { size: 12.5, fill: SOFT, weight: 700, halo: PAPER });
    });
    // on paper: how each body sets off
    if (o.still) order.forEach((b) => {
      if (b.isStatic || !b._px || Math.hypot(b.vx, b.vy) < 0.01) return;
      arrowAt(pen, b._px, b.vx * (o.vscale || 8), b.vy * (o.vscale || 8), GREEN, 2.4);
    });
    // arrows on the chosen body: its velocity, and the forces on it (scaled to its weight)
    if (o.arrows && o.sel && !o.sel.dead && o.sel._px) {
      const b = o.sel, p = b._px;
      const rd = C.readout(W, b);
      const maxF = Math.max(b.m * W.g, ...FORCES.map((f) => Math.hypot(b.F[f][0], b.F[f][1])), 1e-9);
      const fk = 46 / Math.max(b.m * W.g, maxF * 0.35);
      const arrow = (vx, vy, color, w, dash) => arrowAt(pen, p, vx, vy, color, w, dash);
      FORCES.forEach((f) => { const v = b.F[f]; if (Math.hypot(v[0], v[1]) > 0.02 * maxF) arrow(v[0] * fk, v[1] * fk, FCOL[f], 2.4); });
      if (Math.hypot(rd.net[0], rd.net[1]) > 0.02 * maxF) arrow(rd.net[0] * fk, rd.net[1] * fk, INK, 2, [5, 3]);
      const vs = o.vscale || 8;
      arrow(b.vx * vs, b.vy * vs, GREEN, 2.6);
    }
    // the spec's own notes
    spec.labels.forEach((l) => pen.text(X(l.at[0]), Y(l.at[1]), l.text, { size: 13, fill: SOFT, anchor: 'middle', italic: true, weight: 500, halo: PAPER }));
    // off the edge: an arrow where it went
    W.bodies.forEach((b) => {
      if (b.isStatic || b.dead || b.loose || b.piece || !b._px) return;
      const p = b._px;
      if (p.x > -p.r && p.x < cam.w + p.r && p.y > -p.r && p.y < cam.h + p.r) return;
      const x = Math.max(12, Math.min(cam.w - 12, p.x)), y = Math.max(12, Math.min(cam.h - 12, p.y));
      const ang = Math.atan2(p.y - y, p.x - x);
      const ux = Math.cos(ang), uy = Math.sin(ang);
      pen.poly([[x + ux * 8, y + uy * 8], [x - ux * 4 - uy * 6, y - uy * 4 + ux * 6], [x - ux * 4 + uy * 6, y - uy * 4 - ux * 6]], { fill: FILL[b.color] || RED, stroke: INK, width: 1 });
      pen.text(x - ux * 14, y - uy * 14 + 4, nameOf(b), { size: 11, fill: INK, anchor: 'middle', halo: PAPER });
    });
    // the scale bar, bottom left (where the ground has no metre marks)
    if (!o.ticks) {
      const len = niceStep(Math.max(40, Math.min(110, cam.w * 0.16)) / k);
      const L = len * k, sx = 12, sy = cam.h - 12;
      pen.line([[sx, sy - 5], [sx, sy], [sx + L, sy], [sx + L, sy - 5]], { stroke: INK, width: 1.6, cap: 'butt' });
      pen.text(sx + L / 2, sy - 6, fmt(len, 'm'), { size: 12.5, fill: INK, anchor: 'middle', halo: PAPER });
    }
    if (enlarged) pen.text(o.ruler ? cam.w - 60 : cam.w - 10, 16, t('Small things are drawn larger'), { size: 11, fill: SOFT, anchor: 'end', italic: true, weight: 500, halo: PAPER });
    // heights up the side, for a tall drop
    if (o.ruler) {
      const step = niceStep(60 / k);
      for (let y = Math.ceil(Math.max(0, cam.bottom) / step) * step; y <= cam.top; y += step) {
        pen.line([[cam.w - 8, Y(y)], [cam.w, Y(y)]], { stroke: SOFT, width: 1.2 });
        pen.text(cam.w - 11, Y(y), fmt(y, 'm'), { size: 11, fill: SOFT, anchor: 'end', base: 'middle', weight: 500, halo: PAPER });
      }
    }
    pen.done();
    return { enlarged };
  }

  // an arrow from a body's centre, at most 130 px long (y up in the world, down on screen)
  function arrowAt(pen, p, vx, vy, color, w, dash) {
    const L = Math.hypot(vx, vy);
    if (L < 4) return;
    const s = Math.min(1, 130 / L);
    const ex = p.x + vx * s, ey = p.y - vy * s, ux = vx / L, uy = -vy / L;
    pen.line([[p.x, p.y], [ex - ux * 5, ey - uy * 5]], { stroke: color, width: w, dash });
    pen.poly([[ex, ey], [ex - ux * 10 - uy * 5, ey - uy * 10 + ux * 5], [ex - ux * 10 + uy * 5, ey - uy * 10 - ux * 5]], { fill: color });
  }

  /* ---------------- the live scene ---------------- */

  const SPEEDS = [1, 0.5, 0.25];

  function el(tag, cls, attrs) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach((k) => { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    return n;
  }
  function icon(kind) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '15'); s.setAttribute('height', '15'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', { play: 'M4 2.5v11l9-5.5z', pause: 'M4 2.5h3v11H4zM9 2.5h3v11H9z', step: 'M3 2.5v11l7-5.5zM11 2.5h2.5v11H11z', reset: 'M8 2.5a5.5 5.5 0 1 1-5.2 3.8l1.7.6A3.7 3.7 0 1 0 8 4.3V6.5L4.8 3.4 8 .3z' }[kind]);
    p.setAttribute('fill', 'currentColor');
    s.appendChild(p);
    return s;
  }

  function mount(host, spec, goal, ctx, mode) {
    const t = ctx.t || T, fill = ctx.fill || F;
    const reduce = Boolean(ctx.reduce);
    const isTask = mode === 'task';
    const sliders = spec.sliders;
    const start = C.startVals(spec);
    let vals = Object.assign({}, start);
    let W = null, sel = null, playing = false, speedIx = 0, acc = 0, last = 0, raf = 0, destroyed = false, onScreen = true, locked = false, touched = false;
    let trails = new Map(), hist = [], period = [], lastV = null, idle = 0, fx = [];
    const view = C.view(spec);
    const following = view.follow;
    const movers = () => W.bodies.filter((b) => !b.isStatic && !b.dead && !b.loose && !b.piece);
    const showNames = spec.bodies.length > 1;

    /* the page */
    const root = el('div', 'phx' + (isTask ? ' phx--task' : ''), { 'data-no-i18n': '' });
    const main = el('div', 'phx-main');
    const stage = el('div', 'phx-stage');
    const canvas = el('canvas', 'phx-canvas', { tabindex: '0', role: 'application', 'aria-roledescription': t('simulation') });
    const keysHelp = el('p', 'sr-only');
    const helpId = 'phx-k' + (++uid);
    keysHelp.id = helpId;
    keysHelp.textContent = isTask ? t('Tab to an object to read its values. N picks the next object; Space plays or pauses.')
      : t('Arrow keys push the chosen object; with Shift they throw it. N picks the next object; Space plays or pauses.');
    canvas.setAttribute('aria-describedby', helpId);
    stage.append(canvas, keysHelp);
    const panel = el('div', 'phx-panel', { role: 'group', 'aria-label': t('Values') });
    main.append(stage, panel);
    root.appendChild(main);

    // the bar: play, step, slow motion, reset, arrows, trail
    const bar = el('div', 'phx-bar');
    const btn = (cls, label, ic) => { const b = el('button', 'phx-btn ' + cls, { type: 'button' }); if (ic) b.appendChild(icon(ic)); const s = el('span'); s.textContent = label; b.appendChild(s); bar.appendChild(b); return b; };
    const playBtn = btn('phx-play', t('Play'), 'play');
    const stepBtn = btn('phx-step', t('Step'), 'step');
    const speedBtn = btn('phx-speed', '1×');
    const resetBtn = btn('phx-reset', t('Reset'), 'reset');
    const toggle = (label, on) => { const l = el('label', 'phx-check'); const i = el('input', '', { type: 'checkbox' }); i.checked = on; const s = el('span'); s.textContent = label; l.append(i, s); bar.appendChild(l); return i; };
    const arrowsBox = toggle(t('Arrows'), spec.arrows);
    const trailBox = toggle(t('Trail'), spec.trail);
    root.appendChild(bar);

    // sliders
    const sliderEls = {};
    if (sliders.length) {
      const box = el('div', 'phx-sliders');
      sliders.forEach((c, i) => {
        const id = 'phx-s' + uid + '-' + i;
        const row = el('div', 'phx-slider');
        const lab = el('label', 'phx-slider__name', { for: id });
        lab.textContent = varName(spec, c.var, t, fill);
        const input = el('input', 'phx-range', { type: 'range', id, min: String(c.min), max: String(c.max), step: String(c.step), dir: 'ltr' });
        input.value = String(vals[c.var]);
        const out = el('output', 'phx-slider__out', { for: id });
        row.append(lab, input, out);
        box.appendChild(row);
        input.addEventListener('input', () => {
          if (locked) { input.value = String(vals[c.var]); return; }
          vals[c.var] = C.onSlider(c, Number(input.value));
          slid(c.var);
        });
        sliderEls[c.var] = { input, out, c };
      });
      root.appendChild(box);
    }
    const hint = el('p', 'phx-hint');
    hint.textContent = isTask ? t('Set the sliders, then press Play to see what happens.') : t('Drag an object to move it; let go to throw it. Tap one to read its values.');
    root.appendChild(hint);
    const say = el('p', 'sr-only', { 'aria-live': 'polite' });
    root.appendChild(say);
    host.textContent = '';
    host.appendChild(root);

    /* the panel: who is chosen, the values, the graph */
    const pick = el('div', 'phx-pick', { role: 'group', 'aria-label': t('Choose an object') });
    const who = el('p', 'phx-who');
    const dl = el('dl', 'phx-vals');
    const graphWrap = el('div', 'phx-graph');
    const graph = el('canvas', 'phx-graph__c', { role: 'img' });
    const graphCap = el('p', 'phx-graph__cap');
    graphWrap.append(graph, graphCap);
    panel.append(pick, who, dl);
    if (spec.graph !== 'none') panel.appendChild(graphWrap);

    /* building the world */
    let range = new Map();
    function rebuild() {
      W = C.build(spec, vals);
      const id = sel && sel.id;
      sel = movers().find((b) => b.id === id) || movers()[0] || null;
      trails = new Map(); hist = []; period = []; lastV = null; idle = 0; range = new Map(); fx = []; wide = null;
      buildPick();
      sampleGraph(true);
    }
    function buildPick() {
      pick.textContent = '';
      const ms = movers();
      pick.hidden = ms.length < 2;
      ms.forEach((b) => {
        const c = el('button', 'phx-chip', { type: 'button', 'aria-pressed': b === sel ? 'true' : 'false' });
        const dot = el('i', 'phx-chip__dot');
        dot.style.background = FILL[b.color] || FILL.red;
        const s = el('span'); s.textContent = nameOf(b);
        c.append(dot, s);
        c.addEventListener('click', () => choose(b));
        pick.appendChild(c);
      });
    }
    function choose(b) {
      sel = b;
      [...pick.children].forEach((c, i) => c.setAttribute('aria-pressed', movers()[i] === b ? 'true' : 'false'));
      period = []; lastV = null;
      draw(); panelNow();
      say.textContent = fill('{name} chosen.', { name: nameOf(b) }) + ' ' + summary();
    }

    /* sizing */
    let cam = null, dpr = 1, cw = 0, ch = 0;
    const g2 = canvas.getContext('2d');
    function size() {
      const w = Math.max(200, Math.round(stage.clientWidth || 320));
      const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
      let aspect = Math.max(0.85, Math.min(2.1, vw / vh));
      const maxH = Math.max(240, Math.min(560, (window.innerHeight || 700) * 0.62));
      const h = Math.round(Math.min(maxH, Math.max(180, w / aspect))); // never a sliver on a phone
      dpr = Math.min(2, window.devicePixelRatio || 1);
      if (w !== cw || h !== ch) {
        cw = w; ch = h;
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        canvas.style.height = h + 'px';
      }
      const gw = Math.round(panel.clientWidth || 220);
      graph.width = Math.round(gw * dpr); graph.height = Math.round(118 * dpr); graph.style.height = '118px';
    }
    // the part of the world on screen (a follow camera keeps the chosen body in view)
    let camX = null, camY = null;
    function lens() {
      let v = view;
      if (following === 'x') {
        const vw = Math.min(view.x1 - view.x0, 9);
        const target = sel ? sel.x - vw * 0.35 : view.x0;
        camX = camX == null ? Math.max(view.x0, target) : camX + (Math.max(view.x0, target) - camX) * 0.2;
        v = { x0: camX, x1: camX + vw, y0: view.y0, y1: view.y1 };
      } else if (following === 'y') {
        const vh = 40;
        const target = sel ? sel.y - vh * 0.55 : view.y1 - vh;
        const want = Math.max(view.y0, Math.min(view.y1 - vh, target));
        camY = camY == null ? want : camY + (want - camY) * 0.25;
        v = { x0: view.x0, x1: view.x1, y0: camY, y1: camY + vh };
      }
      else v = widen();
      return camera(v, cw, ch, 6);
    }
    // a body thrown or flown out of the scene: the view widens to keep it in sight (up to six times), and closes again
    let wide = null;
    function widen() {
      let x0 = view.x0, y0 = view.y0, x1 = view.x1, y1 = view.y1;
      const bw = x1 - x0, bh = y1 - y0;
      movers().forEach((b) => {
        const m = (b.shape === 'ball' ? b.r : Math.max(b.hw, b.hh)) + 0.04 * Math.max(bw, bh);
        x0 = Math.min(x0, b.x - m); x1 = Math.max(x1, b.x + m); y0 = Math.min(y0, b.y - m); y1 = Math.max(y1, b.y + m);
      });
      x0 = Math.max(x0, view.x0 - 2.5 * bw); x1 = Math.min(x1, view.x1 + 2.5 * bw); y0 = Math.max(y0, view.y0 - 0.5 * bh); y1 = Math.min(y1, view.y1 + 2.5 * bh);
      if (!wide) wide = { x0, y0, x1, y1 };
      const k = reduce ? 1 : 0.12;
      wide = { x0: wide.x0 + (x0 - wide.x0) * k, y0: wide.y0 + (y0 - wide.y0) * k, x1: wide.x1 + (x1 - wide.x1) * k, y1: wide.y1 + (y1 - wide.y1) * k };
      return wide;
    }

    /* drawing */
    function draw() {
      if (!W || destroyed) return;
      cam = lens();
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      g2.clearRect(0, 0, cw, ch);
      const tr = trailBox.checked ? [...trails.entries()].map(([b, pts]) => ({ pts, color: FILL[b.color] || RED })) : null;
      const vs = velocityScale();
      paint(canvasPen(g2), W, spec, cam, { sel, arrows: arrowsBox.checked, trails: tr, t, fill, names: showNames, ticks: following === 'x' || spec.scene === 'projectile' || spec.scene === 'push', ruler: following === 'y' || spec.scene === 'drop', vscale: vs });
      // dust where something broke or landed hard
      fx = fx.filter((p) => p.life > 0);
      fx.forEach((p) => {
        g2.globalAlpha = Math.max(0, p.life) * 0.8;
        g2.fillStyle = p.color;
        g2.beginPath(); g2.arc(cam.sx(p.x), cam.sy(p.y), p.r, 0, Math.PI * 2); g2.fill();
      });
      g2.globalAlpha = 1;
    }
    // pixels per m/s for the velocity arrow: the scene's typical speed is about 60 px
    function typicalSpeed() { return Math.max(1, spec.speed || 0, ...spec.bodies.map((b) => Math.abs(b.v || 0)), Math.sqrt(2 * Math.max(spec.g, 1) * Math.max(0.5, (view.y1 - view.y0) * 0.5))); }
    function velocityScale() { return 60 / typicalSpeed(); }

    /* the panel's numbers */
    let rows = [];
    function setRows(list) {
      // reuse the rows; make new ones only when what is shown changes
      const key = list.map((r) => r[0]).join('|');
      if (dl._key !== key) {
        dl.textContent = '';
        rows = list.map((r) => {
          const row = el('div', 'phx-row' + (r[3] ? ' phx-row--' + r[3] : ''));
          const dt = el('dt');
          if (r[2]) { const sw = el('i', 'phx-sw'); sw.style.background = r[2]; dt.appendChild(sw); }
          const name = el('span'); name.textContent = r[0];
          dt.appendChild(name);
          const dd = el('dd');
          row.append(dt, dd);
          dl.appendChild(row);
          return { dd, row };
        });
        dl._key = key;
      }
      list.forEach((r, i) => { if (rows[i].dd.textContent !== r[1]) rows[i].dd.textContent = r[1]; if (r[4] != null) { rows[i].row.style.setProperty('--phx-meter', String(Math.max(0, Math.min(1, r[4])))); rows[i].row.classList.toggle('is-over', r[4] >= 1); } });
    }
    function panelNow() {
      if (!W || !sel) { setRows([]); who.textContent = ''; return; }
      const b = sel, rd = C.readout(W, b);
      const tag = drag(b), whoKey = [b.key, b.m, tag].join('|');
      if (who._key !== whoKey) {
        who._key = whoKey;
        who.textContent = '';
        const dot = el('i', 'phx-chip__dot'); dot.style.background = FILL[b.color] || FILL.red;
        const nm = el('b'); nm.textContent = nameOf(b);
        const ms = el('span'); ms.textContent = fmt(b.m, 'kg');
        who.append(dot, nm, ms);
        if (tag) { const sp = el('span', 'phx-tag'); sp.textContent = tag; who.appendChild(sp); }
      }
      const list = [];
      const rail = b.rail != null;
      // what is all but nothing reads as 0 (not 0.000829)
      const vT = 1e-3 * typicalSpeed(), aT = 1e-3 * Math.max(W.g, 1), fT = 1e-3 * Math.max(b.m * W.g, 1e-3);
      const zz = (x, tol) => (Math.abs(x) < tol ? 0 : x);
      const vel = rail ? fmt(zz(b.vx, vT), 'm/s') : `${fmt(zz(b.vx, vT), '')}, ${fmt(zz(b.vy, vT), 'm/s')}`;
      const forcesShown = new Set();
      const force = (k, always) => {
        const v = b.F[k], m = Math.hypot(v[0], v[1]);
        if (!always && m < fT) return;
        if (forcesShown.has(k)) return;
        forcesShown.add(k);
        list.push([forceName(k, t), fmt(zz(m, fT), 'N'), FCOL[k]]);
      };
      spec.show.forEach((s) => {
        switch (s) {
          case 'time': list.push([t('Time'), fmt(W.t, 's')]); break;
          case 'position': list.push([t('Position (x, y)'), `${fmt(b.x, '')}, ${fmt(rd.h, 'm')}`]); break;
          case 'height': list.push([t('Height'), fmt(rd.h, 'm')]); break;
          case 'velocity': list.push([rail ? t('Velocity') : t('Velocity (vx, vy)'), vel, FCOL.velocity]); break;
          case 'speed': list.push([t('Speed'), fmt(zz(rd.v, vT), 'm/s'), s === 'speed' && !spec.show.includes('velocity') ? FCOL.velocity : null]); break;
          case 'acceleration': list.push([t('Acceleration'), fmt(zz(smoothA(b, rd), aT), 'm/s²')]); break;
          case 'forces': FORCES.forEach((k) => force(k, false)); list.push([forceName('net', t), fmt(zz(Math.hypot(rd.net[0], rd.net[1]), fT), 'N'), INK]); forcesShown.add('net'); break;
          case 'weight': case 'drag': case 'normal': case 'friction': case 'spring': case 'tension': case 'buoyancy': case 'applied': force(s, true); break;
          case 'net': if (!forcesShown.has('net')) { list.push([forceName('net', t), fmt(zz(Math.hypot(rd.net[0], rd.net[1]), fT), 'N'), INK]); forcesShown.add('net'); } break;
          case 'momentum': list.push([t('Momentum'), rail ? fmt(zz(rd.px, vT * b.m), 'kg·m/s') : fmt(zz(rd.p, vT * b.m), 'kg·m/s')]); break;
          case 'ke': list.push([t('Kinetic energy'), fmt(rd.ke, 'J')]); break;
          case 'pe': list.push([t('Potential energy'), fmt(rd.pe, 'J')]); break;
          case 'energy':
            list.push([t('Kinetic energy'), fmt(rd.ke + rd.spin, 'J')]);
            list.push([t('Potential energy'), fmt(rd.pe, 'J')]);
            if (rd.spe > 1e-9 || W.springs.length) list.push([t('Spring energy'), fmt(rd.spe, 'J')]);
            list.push([t('Total energy'), fmt(rd.energy, 'J')]);
            break;
          case 'total': { const tt = C.totals(W); list.push([t('Total momentum'), fmt(tt.px, 'kg·m/s')]); list.push([t('Total kinetic energy'), fmt(tt.ke, 'J')]); break; }
          case 'world':
            list.push([t('Gravity g'), fmt(W.g, 'm/s²')]);
            if (spec.scene === 'drop' || spec.scene === 'projectile' || W.air) list.push([t('Air density'), fmt(W.air, 'kg/m³')]);
            if (W.fluids.length) list.push([t('Water density'), fmt(W.fluids[0].density, 'kg/m³')]);
            break;
          case 'extension': list.push([t('Extension'), fmt(rd.ext, 'm')]); break;
          case 'angle': list.push([t('Angle'), fmt(rd.angle, '°')]); break;
          case 'period': list.push([t('Period'), period.length >= 2 ? fmt((period[period.length - 1] - period[0]) / (period.length - 1), 's') : '—']); break;
          case 'range': list.push([t('Range'), range.has(b) ? fmt(range.get(b), 'm') : '—']); break;
          case 'maxheight': list.push([t('Highest point'), fmt(Math.max(0, b.maxY), 'm')]); break;
          case 'impact': {
            const st = spec.scene === 'wall' ? W.bodies.find((o) => o.mortar || o.wallId) : null;
            const strength = spec.scene === 'wall' ? spec.strength : null;
            list.push([t('Impact force'), fmt(b.impact, 'N'), null, strength ? 'meter' : null, strength ? b.impact / strength : null]);
            if (strength) list.push([t('Wall strength'), fmt(st && st.mortar ? st.mortar : strength, 'N')]);
            break;
          }
          case 'terminal': list.push([t('Terminal velocity'), rd.terminal != null ? fmt(rd.terminal, 'm/s') : '—']); break;
          case 'submerged': list.push([t('Under the surface'), fmt((rd.sub || 0) * 100, '%')]); break;
        }
      });
      setRows(list);
      drawGraph();
    }
    function drag(b) {
      if (spec.scene !== 'drop') return '';
      return b.cd || b.b ? t('with air resistance') : t('no air resistance');
    }
    // acceleration, smoothed over a few steps so it reads steadily
    const aHist = [];
    function smoothA(b, rd) {
      aHist.push([b.ax, b.ay]);
      if (aHist.length > 8) aHist.shift();
      const ax = aHist.reduce((s, a) => s + a[0], 0) / aHist.length, ay = aHist.reduce((s, a) => s + a[1], 0) / aHist.length;
      return Math.hypot(ax, ay);
    }

    /* the graph: a quantity against time, for each moving body */
    const GQ = {
      speed: [(b) => Math.hypot(b.vx, b.vy), 'm/s', () => t('Speed')], height: [(b) => b.y - b.rest, 'm', () => t('Height')],
      x: [(b) => b.x, 'm', () => 'x'], vx: [(b) => b.vx, 'm/s', () => t('Velocity')], vy: [(b) => b.vy, 'm/s', () => t('Vertical velocity')],
      a: [(b) => Math.hypot(b.ax, b.ay), 'm/s²', () => t('Acceleration')], ke: [(b) => 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy), 'J', () => t('Kinetic energy')],
      momentum: [(b) => b.m * b.vx, 'kg·m/s', () => t('Momentum')],
      force: [(b) => { const v = b.peakN || 0; b.peakN = 0; return v; }, 'N', () => t('Contact force')],
      extension: [() => (W.springs[0] ? W.springs[0].ext : 0), 'm', () => t('Extension')],
      angle: [(b) => { const rd = C.readout(W, b); return rd.angle || 0; }, '°', () => t('Angle')],
      energy: [null, 'J', () => t('Energy')]
    };
    function sampleGraph(force) {
      if (spec.graph === 'none' || !W) return;
      if (!force && W.n % 4) return;
      const ms = movers().slice(0, 4);
      if (spec.graph === 'energy') {
        if (!sel) return;
        const rd = C.readout(W, sel);
        hist.push([W.t, rd.ke + rd.spin, rd.pe + rd.spe, rd.energy]);
      } else hist.push([W.t, ...ms.map((b) => GQ[spec.graph][0](b))]);
      if (hist.length > 1200) hist.splice(0, hist.length - 900);
      hist.bodies = ms;
    }
    function drawGraph() {
      if (spec.graph === 'none' || !hist.length) return;
      const g = graph.getContext('2d');
      const w = graph.width / dpr, h = graph.height / dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const q = GQ[spec.graph];
      const series = spec.graph === 'energy' ? [[1, GREEN, t('Kinetic')], [2, GOLD, t('Potential')], [3, INK, t('Total')]]
        : (hist.bodies || []).map((b, i) => [i + 1, FILL[b.color] || RED, nameOf(b), b]);
      const tmax = Math.max(4, hist[hist.length - 1][0] * 1.08);
      const t0 = Math.max(0, tmax - 30);
      let lo = 0, hi = 1e-9;
      hist.forEach((r) => { if (r[0] < t0) return; series.forEach(([i]) => { if (Number.isFinite(r[i])) { lo = Math.min(lo, r[i]); hi = Math.max(hi, r[i]); } }); });
      // terminal velocity, drawn where it will level off
      let vt = null;
      if (spec.graph === 'speed' && sel && sel.cd && W.air && !isTask) { vt = Math.sqrt(2 * sel.m * W.g / (W.air * sel.cd * sel.area)); if (vt < hi * 3) hi = Math.max(hi, vt); else vt = null; }
      if (hi - lo < 1e-3) hi = lo + 1;
      const span = hi - lo;
      hi += span * 0.08; if (lo < 0) lo -= span * 0.08;
      const L = 38, R = 8, Tp = 8, B = 20;
      const gx = (x) => L + (x - t0) / (tmax - t0) * (w - L - R), gy = (y) => h - B - (y - lo) / (hi - lo) * (h - Tp - B);
      g.font = `500 11px ${FONT}`; g.fillStyle = SOFT; g.strokeStyle = 'rgba(91,71,48,.18)'; g.lineWidth = 1;
      const ys = niceStep((hi - lo) / 3);
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (let y = Math.ceil(lo / ys) * ys; y <= hi; y += ys) { g.beginPath(); g.moveTo(L, gy(y)); g.lineTo(w - R, gy(y)); g.stroke(); g.fillText(fmt(y, ''), L - 4, gy(y)); }
      const xs = niceStep((tmax - t0) / 4);
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (let x = Math.ceil(t0 / xs) * xs; x <= tmax; x += xs) g.fillText(fmt(x, ''), gx(x), h - B + 4);
      g.strokeStyle = SOFT; g.lineWidth = 1.2; g.beginPath(); g.moveTo(L, Tp); g.lineTo(L, h - B); g.lineTo(w - R, h - B); g.stroke();
      if (vt != null) {
        g.setLineDash([4, 4]); g.strokeStyle = TEAL; g.beginPath(); g.moveTo(L, gy(vt)); g.lineTo(w - R, gy(vt)); g.stroke(); g.setLineDash([]);
        g.fillStyle = TEAL; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(t('terminal velocity'), w - R - 2, gy(vt) - 2);
      }
      series.forEach(([i, col, , b]) => {
        g.strokeStyle = col; g.lineWidth = b && b !== sel ? 1.6 : 2.6; g.globalAlpha = b && b !== sel ? 0.65 : 1;
        g.beginPath();
        let first = true;
        hist.forEach((r) => { if (r[0] < t0 || !Number.isFinite(r[i])) return; const x = gx(r[0]), y = gy(r[i]); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); });
        g.stroke();
      });
      g.globalAlpha = 1;
      graphCap.textContent = fill('{what} ({unit}) against time (s)', { what: q[2](), unit: q[1] });
      graph.setAttribute('aria-label', graphCap.textContent);
    }

    /* running */
    function stepOnce() {
      C.step(W);
      // the contact force's peak since the graph last looked (an impact lasts a single step)
      // (a blow that broke something is the impact the panel shows: its impulse went into the pieces)
      if (spec.graph === 'force') movers().forEach((b) => {
        const blow = b.impact > (b.seenImpact || 0) ? b.impact : 0;
        b.seenImpact = b.impact;
        b.peakN = Math.max(b.peakN || 0, blow, Math.hypot(b.F.normal[0] + b.F.friction[0], b.F.normal[1] + b.F.friction[1]));
      });
      // what happened: landings (the range), breaks (dust), turning points (the period)
      for (const e of W.events) {
        if (e.type === 'land' && e.b.launch && !range.has(e.b)) range.set(e.b, e.x - e.b.launch[0]);
        if (e.type === 'land' && !e.b.launch && !range.has(e.b) && spec.scene === 'free') range.set(e.b, e.x - e.b.home.x);
        if (e.type === 'break') dust(e.x, e.y, 26, '#c8a27a', 1.2);
        if (e.type === 'land' && e.speed > 4 && !reduce) dust(e.x, e.y - (e.b.rest || 0), 8, '#bfa57e', 0.6);
      }
      if (sel) {
        const coord = spec.scene === 'spring' && spec.orient === 'vertical' ? sel.vy : sel.vx;
        if (lastV != null && lastV > 0 && coord <= 0) { period.push(W.t); if (period.length > 5) period.shift(); }
        lastV = coord;
      }
      if (W.n % 3 === 0) movers().forEach((b) => {
        if (b !== sel && spec.scene !== 'projectile' && spec.scene !== 'drop') return;
        let tr = trails.get(b);
        if (!tr) { tr = []; trails.set(b, tr); }
        tr.push([b.x, b.y]);
        if (tr.length > 360) tr.shift();
      });
      sampleGraph(false);
    }
    function dust(x, y, n, color, life) {
      if (reduce) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 0.5 + Math.random() * 2.5;
        fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.abs(Math.sin(a)) * s, r: 1.5 + Math.random() * 3, life: life * (0.6 + Math.random() * 0.5), color });
      }
    }
    const running = () => !destroyed && onScreen && !document.hidden && playing;
    let lastPanel = 0;
    function frame(now) {
      raf = 0;
      if (!running()) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      acc += dt * SPEEDS[speedIx];
      let n = 0;
      while (acc >= C.DT - 1e-12 && n < 10) { stepOnce(); acc -= C.DT; n++; }
      if (n === 10) acc = 0;
      fx.forEach((p) => { p.x += p.vx * dt * (view.x1 - view.x0) * 0.05; p.y += p.vy * dt * (view.y1 - view.y0) * 0.05; p.vy -= dt * 2; p.life -= dt; });
      // still for a while, or a long time running: stop, to spare the battery
      const moving = movers().some((b) => Math.hypot(b.vx, b.vy) > 0.02 || Math.abs(b.w) > 0.05) || W.mouse;
      idle = moving ? 0 : idle + dt;
      if (idle > 2.5 || W.t > 180) setPlaying(false);
      draw();
      if (now - lastPanel > 120) { lastPanel = now; panelNow(); }
      if (playing) raf = requestAnimationFrame(frame);
    }
    function schedule() { if (!raf && running()) { last = 0; raf = requestAnimationFrame(frame); } }
    function setPlaying(on) {
      playing = Boolean(on);
      idle = 0;
      playBtn.replaceChildren(icon(playing ? 'pause' : 'play'), Object.assign(el('span'), { textContent: playing ? t('Pause') : t('Play') }));
      playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      root.classList.toggle('is-playing', playing);
      if (playing) schedule(); else { panelNow(); draw(); }
    }

    /* the controls */
    playBtn.addEventListener('click', () => {
      if (!playing && W.t > 0 && idle === 0 && settled()) { rebuild(); }
      setPlaying(!playing);
    });
    const settled = () => movers().every((b) => Math.hypot(b.vx, b.vy) < 0.02) && W.t > 0.5 && !W.springs.length && !W.joints.some((j) => j.type === 'rod');
    stepBtn.addEventListener('click', () => { if (playing) setPlaying(false); for (let i = 0; i < 6; i++) stepOnce(); draw(); panelNow(); });
    speedBtn.addEventListener('click', () => {
      speedIx = (speedIx + 1) % SPEEDS.length;
      speedBtn.querySelector('span').textContent = ['1×', '½×', '¼×'][speedIx];
      speedBtn.setAttribute('aria-label', [t('Speed: normal'), t('Speed: half'), t('Speed: a quarter')][speedIx]);
    });
    speedBtn.setAttribute('aria-label', t('Speed: normal'));
    resetBtn.addEventListener('click', () => { rebuild(); setPlaying(false); draw(); panelNow(); });
    arrowsBox.addEventListener('change', () => draw());
    trailBox.addEventListener('change', () => draw());

    function slid(v) {
      const c = sliderEls[v];
      if (c) { c.out.textContent = valText(spec, v, vals[v]); c.input.setAttribute('aria-valuetext', valText(spec, v, vals[v])); }
      touched = true;
      if (isTask) { rebuild(); setPlaying(false); }
      else if (!C.applyVar(W, C.withVals(spec, vals), v, vals[v])) { const was = playing; rebuild(); if (was) setPlaying(true); else { draw(); panelNow(); } }
      else { draw(); panelNow(); }
      try { if (isTask && ctx.onChange) ctx.onChange(value()); } catch (err) { /* the page's own handler */ }
    }
    Object.keys(sliderEls).forEach((v) => { const c = sliderEls[v]; c.out.textContent = valText(spec, v, vals[v]); c.input.setAttribute('aria-valuetext', valText(spec, v, vals[v])); });

    /* dragging and throwing */
    let grabbed = null, trace = [], downAt = null;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function hit(px, py) {
      let best = null, bd = Infinity;
      movers().forEach((b) => {
        if (!b._px) return;
        const d = Math.hypot(px - b._px.x, py - b._px.y);
        const reach = Math.max(b._px.r + 6, 22);
        if (d < reach && d < bd) { best = b; bd = d; }
      });
      return best;
    }
    const canDrag = () => !isTask && !locked;
    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      const [px, py] = local(e);
      const b = hit(px, py);
      if (!b) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      if (b !== sel) choose(b);
      downAt = [px, py];
      if (!canDrag()) return;
      grabbed = b;
      C.grab(W, b, cam.wx(px), cam.wy(py));
      trace = [[performance.now(), cam.wx(px), cam.wy(py)]];
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
      root.classList.add('is-dragging');
      if (!playing) setPlaying(true);
    }
    function onMove(e) {
      if (!grabbed || !W.mouse) return;
      const [px, py] = local(e);
      const x = cam.wx(px), y = cam.wy(py);
      W.mouse.tx = x; W.mouse.ty = y;
      trace.push([performance.now(), x, y]);
      if (trace.length > 12) trace.shift();
    }
    function onUp(e) {
      if (!grabbed) return;
      const b = grabbed;
      grabbed = null;
      C.release(W);
      root.classList.remove('is-dragging');
      const [px, py] = local(e);
      // a fling: it leaves the hand with the hand's speed (over the last tenth of a second)
      if (downAt && Math.hypot(px - downAt[0], py - downAt[1]) > 5 && trace.length > 1) {
        const now = performance.now();
        const recent = trace.filter((q) => now - q[0] < 100);
        const a = recent.length > 1 ? recent[0] : trace[Math.max(0, trace.length - 3)], z = trace[trace.length - 1];
        const dtm = Math.max(0.016, (z[0] - a[0]) / 1000);
        let vx = (z[1] - a[1]) / dtm, vy = (z[2] - a[2]) / dtm;
        const cap = Math.max(5, Math.min(40, 1.5 * Math.hypot(view.x1 - view.x0, view.y1 - view.y0)));
        const s = Math.hypot(vx, vy);
        if (s > cap) { vx *= cap / s; vy *= cap / s; }
        if (now - z[0] > 120) { vx = 0; vy = 0; } // held still before letting go: just dropped
        b.vx = vx; b.vy = b.rail != null ? 0 : vy;
        say.textContent = fill('Thrown at {v}.', { v: fmt(Math.hypot(b.vx, b.vy), 'm/s') });
      }
      downAt = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* fine */ }
    }
    // a touch that lands on an object moves it, not the page
    const onTouch = (e) => { const t0 = e.touches[0]; if (!t0) return; const r = canvas.getBoundingClientRect(); if (hit(t0.clientX - r.left, t0.clientY - r.top)) e.preventDefault(); };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('touchstart', onTouch, { passive: false });

    /* the keyboard: N picks, arrows push, Shift+arrows throw, Space plays */
    function onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (k === 'n' || k === 'N') { const ms = movers(); if (ms.length) choose(ms[(ms.indexOf(sel) + 1) % ms.length]); e.preventDefault(); return; }
      if (k === ' ' || k === 'Spacebar') { setPlaying(!playing); e.preventDefault(); return; }
      if (!sel || !canDrag()) return;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
      if (!dir) return;
      e.preventDefault();
      const base = Math.max(0.5, Math.min(5, 0.08 * (view.x1 - view.x0)));
      const dv = base * (e.shiftKey ? 4 : 1);
      sel.vx += dir[0] * dv;
      if (sel.rail == null) sel.vy += dir[1] * dv;
      if (!playing) setPlaying(true);
      const said = { name: nameOf(sel), v: fmt(Math.hypot(sel.vx, sel.vy), 'm/s') };
      say.textContent = e.shiftKey ? fill('{name} thrown: {v}.', said) : fill('{name} pushed: {v}.', said);
    }
    canvas.addEventListener('keydown', onKey);
    function summary() {
      if (!sel || !W) return '';
      const rd = C.readout(W, sel);
      return fill('Speed {v}, height {h}.', { v: fmt(rd.v, 'm/s'), h: fmt(rd.h, 'm') });
    }

    /* on and off screen, size changes */
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
      onScreen = es.some((x) => x.isIntersecting);
      if (onScreen && !started) { started = true; if (!reduce && !isTask) setPlaying(true); }
      schedule();
    }) : null;
    let started = false;
    if (io) io.observe(canvas);
    const onVis = () => schedule();
    document.addEventListener('visibilitychange', onVis);
    let seenW = 0;
    let roRaf = 0;
    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { const w = stage.clientWidth; if (w === seenW || roRaf) return; seenW = w; roRaf = requestAnimationFrame(() => { roRaf = 0; if (destroyed) return; size(); draw(); drawGraph(); }); }) : null;
    if (ro) ro.observe(stage);

    rebuild();
    size();
    draw();
    panelNow();
    canvas.setAttribute('aria-label', describeScene(spec, t, fill));
    if (!io) { started = true; if (!reduce && !isTask) setPlaying(true); }

    function value() { return touched ? { v: Object.assign({}, vals) } : null; }
    function setVals(v) {
      Object.keys(sliderEls).forEach((k) => { if (v[k] != null) vals[k] = v[k]; const c = sliderEls[k]; c.input.value = String(vals[k]); c.out.textContent = valText(spec, k, vals[k]); c.input.setAttribute('aria-valuetext', valText(spec, k, vals[k])); });
    }

    return {
      value,
      reset() { vals = Object.assign({}, start); setVals(vals); touched = false; rebuild(); setPlaying(false); },
      reveal() {
        const sol = solved(spec, goal);
        if (!sol) return;
        vals = Object.assign({}, vals, sol);
        setVals(vals);
        touched = true;
        rebuild();
        setPlaying(true);
      },
      lock(on) {
        locked = Boolean(on);
        root.classList.toggle('is-locked', locked);
        Object.values(sliderEls).forEach((s) => { s.input.disabled = locked; });
      },
      destroy() {
        destroyed = true;
        if (raf) cancelAnimationFrame(raf);
        if (roRaf) cancelAnimationFrame(roRaf);
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('touchstart', onTouch);
        canvas.removeEventListener('keydown', onKey);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  let uid = 0;

  // the scene in a sentence, for screen readers
  function describeScene(spec, t, fill) {
    const names = spec.bodies.map(nameOf).join(', ');
    const what = {
      drop: t('Objects falling side by side'), projectile: t('A launch from a cannon'), collision: t('Bodies colliding on a track'), ramp: t('A block on a ramp'),
      push: t('A box pushed along a floor'), spring: t('A mass on a spring'), pendulum: t('A pendulum'), wall: t('A ball and a brick wall'), float: t('Objects in a tank of water'), free: t('A physics scene')
    }[spec.scene];
    return fill('{what}: {names}.', { what, names });
  }

  /* ---------------- checked once, kept ---------------- */

  const checked = new WeakMap();
  function cleanTask(spec, goal) {
    if (!C || !spec || typeof spec !== 'object' || !goal || typeof goal !== 'object') return null;
    let m = checked.get(spec);
    if (!m) { m = new WeakMap(); checked.set(spec, m); }
    if (!m.has(goal)) { let v = null; try { v = C.normTask(spec, goal, { light: true }); } catch (e) { v = null; } m.set(goal, v); }
    return m.get(goal);
  }
  function cleanSpec(spec) {
    if (!C || !spec || typeof spec !== 'object') return null;
    let m = checked.get(spec);
    if (!m) { m = new WeakMap(); checked.set(spec, m); }
    if (!m.has(checked)) { let v = null; try { v = C.normSpec(spec); } catch (e) { v = null; } m.set(checked, v); }
    return m.get(checked);
  }
  const solutions = new WeakMap();
  function solved(spec, goal) {
    if (!goal) return null;
    if (!solutions.has(goal)) { let s = null; try { s = C.solution(spec, goal); } catch (e) { s = null; } solutions.set(goal, s); }
    return solutions.get(goal);
  }

  // until the engine has loaded (it is usually there first: widgets.js waits for "ready"), a handle that waits
  function later(host, startFn) {
    let h = null, gone = false;
    const queue = [];
    ready.then(() => {
      if (gone) return;
      h = startFn();
      queue.forEach((fn) => fn(h));
    }).catch((err) => failed(host, err));
    const call = (name) => (...args) => { if (h) return h[name](...args); if (name !== 'value') queue.push((x) => x && x[name](...args)); return null; };
    return { value: () => (h ? h.value() : null), reset: call('reset'), reveal: call('reveal'), lock: call('lock'), destroy() { gone = true; if (h) h.destroy(); } };
  }
  function failed(host, err) {
    host.classList.remove('is-loading');
    host.classList.add('is-failed');
    host.textContent = T('This interactive part couldn’t be shown here.');
    if (err) console.warn('[Primer] physics:', err.message || err);
  }

  // what a result was, in words: "It landed at 31 m; the target is 40 to 45 m."
  function noteFor(spec, goal, r) {
    if (!r) return '';
    const b = spec.bodies.find((x) => x.id === goal.body);
    const name = nameOf(b);
    const Q = {
      range: T('The range'), height: T('The highest point'), time: T('The time'), speed: T('The speed'), vx: T('The velocity'), terminal: T('The terminal velocity'),
      period: T('The period'), extension: T('The extension'), distance: T('The distance'), accel: T('The acceleration'), force: T('The impact force'), submerged: T('The part under the surface')
    };
    switch (goal.type) {
      case 'land': return r.landed ? F('It landed at {x}; the target is {a} to {b}.', { x: fmt(r.got, 'm'), a: fmt(goal.x[0], ''), b: fmt(goal.x[1], 'm') }) : T('It never landed.');
      case 'stop': return F('{name} still moves at {v} after the collision.', { name, v: fmt(r.got, 'm/s') });
      case 'break': return r.got ? F('The wall broke: the impact force was {f}, more than its strength of {s}.', { f: fmt(r.force, 'N'), s: fmt(r.strength, 'N') })
        : F('The wall held: the impact force was {f}; it takes {s} to break it.', { f: fmt(r.force, 'N'), s: fmt(r.strength, 'N') });
      case 'slide': return r.got ? F('{name} moved.', { name }) : F('{name} didn’t move.', { name });
      case 'float': return r.got ? F('{name} floats.', { name }) : F('{name} sinks.', { name });
      case 'value': {
        const u = C.QUANT[goal.of].unit;
        if (r.none) return goal.of === 'period' ? T('It didn’t swing long enough to time.') : T('It never got there.');
        if (goal.of === 'terminal' && r.reached === false) return T('It was still speeding up when it landed.');
        const want = goal.value != null ? F('{v} (give or take {tol})', { v: fmt(goal.value, u), tol: fmt(goal.tol, u) })
          : goal.min != null && goal.max != null ? F('{a} to {b}', { a: fmt(goal.min, ''), b: fmt(goal.max, u) }) : goal.min != null ? F('at least {a}', { a: fmt(goal.min, u) }) : F('at most {b}', { b: fmt(goal.max, u) });
        return F('{what} came out at {got}; the target is {want}.', { what: Q[goal.of], got: fmt(r.got, u), want });
      }
      default: return '';
    }
  }

  P.widgets.register('physics', {
    ready,

    block(host, spec, ctx) {
      return later(host, () => {
        const clean = cleanSpec(spec);
        if (!clean) { failed(host, new Error('this scene does not hold together')); return null; }
        return mount(host, clean, null, ctx || {}, 'block');
      });
    },

    task(host, spec, goal, ctx) {
      return later(host, () => {
        const tk = cleanTask(spec, goal);
        if (!tk) { failed(host, new Error('this physics task does not hold together')); return null; }
        return mount(host, tk.spec, tk.goal, ctx || {}, 'task');
      });
    },

    check(goal, value, spec) {
      const tk = cleanTask(spec, goal);
      if (!tk) return { correct: false, invalid: true };
      const res = C.check(tk.spec, tk.goal, value);
      if (res.invalid) return { correct: false, invalid: true, note: T('Move a slider first, then press Check.') };
      return { correct: res.correct, note: res.correct ? '' : noteFor(tk.spec, tk.goal, res.r) };
    },

    describe(value, spec) {
      const s = cleanSpec(spec);
      if (!s || !value || typeof value !== 'object' || !value.v || typeof value.v !== 'object') return '';
      const v = C.clean(s, value.v);
      return s.sliders.map((c) => `${varName(s, c.var, T, F)} = ${valText(s, c.var, v[c.var])}`).join('; ');
    },

    answer(goal, spec) {
      const tk = cleanTask(spec, goal);
      if (!tk) return '';
      const sol = solved(tk.spec, tk.goal);
      if (!sol) return '';
      const start = C.startVals(tk.spec);
      const changed = tk.spec.sliders.filter((c) => sol[c.var] !== start[c.var]);
      return (changed.length ? changed : tk.spec.sliders).map((c) => `${varName(tk.spec, c.var, T, F)} = ${valText(tk.spec, c.var, sol[c.var])}`).join('; ');
    },

    still(spec, goal) {
      if (!C) return '';
      const tk = goal ? cleanTask(spec, goal) : null;
      const s = tk ? tk.spec : cleanSpec(spec);
      if (!s) return '';
      let W;
      try { W = C.build(s, null); } catch (e) { return ''; }
      const v = C.view(s);
      const w = 480, aspect = Math.max(0.85, Math.min(2.1, (v.x1 - v.x0) / (v.y1 - v.y0)));
      const h = Math.round(w / aspect);
      const cam = camera(v, w, h, 8);
      const pen = svgPen();
      const typical = Math.max(1, s.speed || 0, ...s.bodies.map((b) => Math.abs(b.v || 0)));
      paint(pen, W, s, cam, { still: true, names: s.bodies.length > 1, ticks: s.scene === 'projectile', ruler: s.scene === 'drop', vscale: 50 / typical });
      return pen.svg(w, h, describeScene(s, T, F));
    }
  });
})();
