// The optics bench: the physics (assets/js/widgets/optics-core.js), the server's checks of what the AI writes
// (server/widgets/optics.mjs, through server/widgets.mjs), and the browser half's words and pictures
// (assets/js/widgets/optics.js, run here without a page).   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import O from '../assets/js/widgets/optics-core.js';
import * as optics from '../server/widgets/optics.mjs';
import { normWidgetBlock, normTask, widgetKinds, widgetPrompt } from '../server/widgets.mjs';

const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const nature = (s) => (s.infinite ? 'infinity' : [s.real ? 'real' : 'virtual', s.inverted ? 'inverted' : 'erect', s.size].join(' '));

/* ---------------- image formation ---------------- */

test('a convex lens (f = +10 cm): the six cases in the textbook, with NCERT signs', () => {
  const img = (u) => O.image('lens', 'convex', 10, u, 3);
  // 1. at infinity: at F2, point-sized
  let s = img(-Infinity);
  near(s.v, 10); near(s.m, 0); assert.equal(s.real, true);
  // 2. beyond 2F1: between F2 and 2F2, diminished
  s = img(-30);
  near(s.v, 15); near(s.m, -0.5); near(s.hi, -1.5);
  assert.equal(nature(s), 'real inverted diminished');
  assert.equal(O.zone('lens', 'convex', 10, -30), 'beyond2F');
  assert.equal(O.zone('lens', 'convex', 10, s.v), 'between');
  // 3. at 2F1: at 2F2, the same size
  s = img(-20);
  near(s.v, 20); near(s.m, -1);
  assert.equal(nature(s), 'real inverted same');
  assert.equal(O.zone('lens', 'convex', 10, s.v), 'at2F');
  // 4. between F1 and 2F1: beyond 2F2, magnified
  s = img(-15);
  near(s.v, 30); near(s.m, -2);
  assert.equal(nature(s), 'real inverted magnified');
  assert.equal(O.zone('lens', 'convex', 10, s.v), 'beyond2F');
  // 5. at F1: at infinity
  s = img(-10);
  assert.equal(s.infinite, true);
  assert.equal(s.v, Infinity);
  assert.equal(O.zone('lens', 'convex', 10, -10), 'atF');
  // 6. between F1 and O: virtual, erect, magnified, on the object's side
  s = img(-5);
  near(s.v, -10); near(s.m, 2); near(s.hi, 6);
  assert.equal(nature(s), 'virtual erect magnified');
  assert.equal(O.zone('lens', 'convex', 10, -5), 'inside');
});

test('a concave mirror (f = -10 cm): the same six cases, the image in front (v < 0) when real', () => {
  const img = (u) => O.image('mirror', 'concave', -10, u, 2);
  let s = img(-Infinity);
  near(s.v, -10); assert.equal(s.real, true);
  s = img(-30); near(s.v, -15); near(s.m, -0.5); assert.equal(nature(s), 'real inverted diminished');
  s = img(-20); near(s.v, -20); near(s.m, -1); assert.equal(nature(s), 'real inverted same');
  assert.equal(O.zone('mirror', 'concave', -10, s.v), 'at2F', 'at C');
  s = img(-15); near(s.v, -30); near(s.m, -2); assert.equal(nature(s), 'real inverted magnified');
  assert.equal(img(-10).infinite, true, 'at F: at infinity');
  s = img(-5); near(s.v, 10); near(s.m, 2); assert.equal(nature(s), 'virtual erect magnified');
  assert.equal(O.zone('mirror', 'concave', -10, s.v), 'behind');
});

test('a concave lens, a convex mirror and a plane mirror: always virtual and erect', () => {
  let s = O.image('lens', 'concave', -12, -24, 3);
  near(s.v, -8); near(s.m, 1 / 3); assert.equal(nature(s), 'virtual erect diminished');
  assert.equal(O.zone('lens', 'concave', -12, s.v), 'inside', 'between F1 and O');
  s = O.image('mirror', 'convex', 15, -30, 4);
  near(s.v, 10); near(s.m, 1 / 3); assert.equal(nature(s), 'virtual erect diminished');
  assert.equal(O.zone('mirror', 'convex', 15, s.v), 'inside', 'between P and F, behind');
  assert.equal(O.zone('mirror', 'convex', 15, -30), 'front');
  s = O.image('mirror', 'plane', null, -12, 4);
  near(s.v, 12); near(s.m, 1); assert.equal(nature(s), 'virtual erect same');
});

test('the lens and mirror formulas hold everywhere, and the principal rays meet at the image', () => {
  for (const u of [-45, -27, -13, -7, -2.5]) {
    for (const f of [8, -8]) {
      const L = O.image('lens', f > 0 ? 'convex' : 'concave', f, u, 2);
      near(1 / L.v - 1 / u, 1 / f, 1e-9, 'lens');
      near(L.m, L.v / u, 1e-12);
      const M = O.image('mirror', f < 0 ? 'concave' : 'convex', f, u, 2);
      near(1 / M.v + 1 / u, 1 / f, 1e-9, 'mirror');
      near(M.m, -M.v / u, 1e-12);
      for (const [mode, kind, s] of [['lens', f > 0 ? 'convex' : 'concave', L], ['mirror', f < 0 ? 'concave' : 'convex', M]]) {
        const rays = O.principalRays(mode, kind, f, u, 2);
        assert.ok(rays.length >= 2, `${mode} ${kind} u=${u}: rays`);
        for (const r of rays) {
          // the line on from the hit point, or back along it for a virtual image, passes through the image's tip
          const cross = (s.v - r.hit[0]) * r.dir[1] - (s.hi - r.hit[1]) * r.dir[0];
          near(cross, 0, 1e-6, `${mode} ${kind} u=${u} ${r.id}`);
          assert.ok(mode === 'lens' ? r.dir[0] > 0 : r.dir[0] < 0, 'light goes on through a lens, back from a mirror');
          if (!s.real) assert.ok(r.back, 'a virtual image has its dashed lines');
        }
      }
    }
  }
  // the textbook rays: parallel then through F2; through O undeviated; through F1 then parallel
  const [par, cen, foc] = O.principalRays('lens', 'convex', 10, -30, 3);
  near(par.hit[1], 3); near(par.dir[1] / par.dir[0], -3 / 10, 1e-9, 'through F2 = (10, 0)');
  near(cen.hit[1], 0); near(cen.dir[1] / cen.dir[0], -3 / 30, 1e-9, 'undeviated');
  near(foc.dir[1], 0, 1e-12, 'parallel');
  // at F the rays come out parallel
  const atF = O.principalRays('lens', 'convex', 10, -10, 3);
  atF.forEach((r) => near(r.dir[1] / r.dir[0], -0.3, 1e-9));
});

/* ---------------- refraction ---------------- */

test('Snell\'s law, the critical angle and total internal reflection', () => {
  near(O.snell(1, 1.5, 30).r, 19.4712, 1e-3, 'air into glass');
  near(O.snell(1.5, 1, 30).r, 48.5904, 1e-3, 'glass into air');
  near(O.snell(1, 1.33, 0).r, 0, 1e-9, 'along the normal');
  near(O.criticalAngle(1.5, 1), 41.8103, 1e-3);
  near(O.criticalAngle(1.33, 1), 48.7535, 1e-3);
  near(O.criticalAngle(2.42, 1), 24.4075, 1e-3);
  assert.equal(O.criticalAngle(1, 1.5), null, 'none into a denser medium');
  assert.equal(O.snell(1.5, 1, 41).tir, false);
  assert.equal(O.snell(1.5, 1, 42).tir, true);
  near(O.snell(1, 1.5, 0).R, 0.04, 1e-9, '4% reflected at normal incidence');
  near(O.snell(1.5, 1, 60).R, 1, 0, 'all of it under TIR');
  // n1 sin i = n2 sin r, as the readouts say
  const spec = O.normSpec({ mode: 'refraction', from: 'water', to: 'diamond', angle: 50 });
  const st = O.rayState(spec, { i: 50 });
  near(1.33 * Math.sin(50 * Math.PI / 180), 2.42 * Math.sin(st.r * Math.PI / 180), 1e-9);
  assert.equal(O.rayState(O.normSpec({ mode: 'refraction', from: 'glass', to: 'air', angle: 60 }), { i: 60 }).tir, true);
});

test('a glass slab: the ray comes out parallel, shifted by t sin(i - r) / cos r', () => {
  const spec = O.normSpec({ mode: 'refraction', shape: 'slab', to: 'glass', angle: 40, thickness: 5 });
  const st = O.rayState(spec, { i: 40 });
  const r = Math.asin(Math.sin(40 * Math.PI / 180) / 1.5);
  near(st.r, r * 180 / Math.PI, 1e-9);
  near(st.e, 40, 1e-9, 'it comes out at the angle it went in');
  near(st.deviation, 0, 1e-6, 'parallel');
  near(st.shift, 5 * Math.sin(40 * Math.PI / 180 - r) / Math.cos(r), 1e-9);
  near(O.rayState(spec, { i: 0 }).shift, 0, 1e-9, 'none along the normal');
});

test('a prism: δ = i + e - A, the minimum deviation, TIR inside, and violet bent the most', () => {
  const spec = O.normSpec({ mode: 'refraction', shape: 'prism', to: 'glass', apex: 60, angle: 40, white: true });
  for (const i of [35, 40, 50, 60]) {
    const st = O.rayState(spec, { i });
    near(st.deviation, i + st.e - 60, 1e-6, `i = ${i}`);
    near(st.r + Math.asin(1.5 * Math.sin((60 - st.r) * Math.PI / 180)) * 0, st.r, 1e-12);
  }
  const st = O.rayState(spec, { i: 49 });
  near(st.min, 2 * Math.asin(1.5 * Math.sin(Math.PI / 6)) * 180 / Math.PI - 60, 1e-9, 'n = sin((A + δm)/2) / sin(A/2)');
  near(st.min, 37.18, 0.01);
  assert.ok(O.atMinimum(spec, st), 'i = 49° is the nearest whole degree to i = e');
  assert.ok(!O.atMinimum(spec, O.rayState(spec, { i: 40 })));
  for (const i of [30, 40, 60, 70]) assert.ok(O.rayState(spec, { i }).deviation > st.min);
  // too steep inside: the ray meets the second face beyond the critical angle
  assert.equal(O.rayState(spec, { i: 20 }).tir, true);
  // white light: the colours fan out, violet deviated the most and red the least
  const cols = O.rayState(spec, { i: 45 }).geo.colours;
  assert.deepEqual(cols.map((c) => c.colour), O.SPECTRUM);
  const slope = (c) => { const p = c.pts, a = p[p.length - 2], b = p[p.length - 1]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  for (let k = 1; k < cols.length; k++) assert.ok(slope(cols[k]) < slope(cols[k - 1]), `${cols[k].colour} bends more than ${cols[k - 1].colour}`);
});

/* ---------------- specs ---------------- */

test('specs: kept clean, read kindly (a bare focal length takes the kind\'s sign, u is in front), and stable', () => {
  const s = O.normSpec({ mode: 'mirror', kind: 'concave', f: 15, object: { u: 40, h: 3 } });
  assert.equal(s.f, -15, 'a concave mirror\'s f is negative');
  assert.equal(s.object.u, -40, 'the object is in front');
  assert.deepEqual(s.drag, ['object']);
  assert.deepEqual(s.range.u, [-50, -1]);
  assert.deepEqual(O.normSpec(s), s, 'the clean spec checks the same again (the page re-checks it)');
  assert.equal(O.normSpec({ mode: 'lens', kind: 'converging', f: 20 }).kind, 'convex');
  assert.equal(O.normSpec({ kind: 'diverging mirror', f: 10 }).kind, 'convex');
  assert.equal(O.normSpec({ mode: 'lens', f: -8 }).kind, 'concave', 'the kind from f\'s sign');
  assert.equal(O.normSpec({ kind: 'convex lens', f: '10 cm', object: { u: '−25' } }).object.u, -25);
  assert.equal(O.normSpec({ mode: 'mirror', kind: 'plane', object: { u: -12 } }).f, null);
  assert.equal(O.normSpec({ mode: 'lens', kind: 'convex', f: 10, object: { u: -30, look: 'candle' } }).object.look, 'candle');
  const r = O.normSpec({ mode: 'refraction', from: 'Water', to: { n: 1.6, name: 'plastic' }, angle: '35°', media: ['glass', 'diamond'] });
  assert.deepEqual(r.from, { key: 'water', n: 1.33 });
  assert.deepEqual(r.media.map((m) => m.key), ['custom', 'glass', 'diamond'], '"to" joins the choices');
  assert.equal(r.angle, 35);
  assert.deepEqual(O.normSpec(r), r);
  const p = O.normSpec({ mode: 'prism', to: 'flint glass', apex: 45, white: 'yes' });
  assert.equal(p.shape, 'prism'); assert.equal(p.apex, 45); assert.equal(p.white, true); assert.equal(p.to.n, 1.65);
});

test('specs that don\'t hold together are refused with a reason the AI can act on', () => {
  const why = (s) => { try { O.normSpec(s); return ''; } catch (e) { assert.ok(e instanceof O.OpticsError, e.stack); return e.message; } };
  assert.match(why({ mode: 'lens', kind: 'plane', f: 10 }), /a lens is "convex" or "concave"/);
  assert.match(why({ mode: 'lens', kind: 'convex' }), /give the focal length "f"/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 500 }), /from 1 to 100 cm/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 10, object: { u: 0 } }), /can't be at the lens/);
  assert.match(why({ kind: 'convex', f: 10 }), /"mode": "lens" or "mirror"/);
  assert.match(why({ mode: 'mirror', kind: 'plane', sliders: ['f'] }), /plane mirror has no focal length/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 10, object: { u: -50 }, range: { u: [-40, -5] } }), /outside its range/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 10, drag: ['wings'] }), /"drag" can hold/);
  assert.match(why({ mode: 'refraction', from: 'air', to: 'plasma' }), /unknown medium "plasma"/);
  assert.match(why({ mode: 'refraction', from: 'glass', to: 'glass' }), /same refractive index/);
  assert.match(why({ mode: 'refraction', from: 'air', to: { n: 5 } }), /from 1 to 3/);
  assert.match(why({ mode: 'refraction', to: 'water', angle: 95 }), /0 to 89 degrees/);
  assert.match(why({ mode: 'refraction', shape: 'lens-ish' }), /"shape" is "boundary", "slab" or "prism"/);
  assert.match(why({ mode: 'refraction', shape: 'prism', apex: 120 }), /prism's angle/);
});

/* ---------------- tasks and goals ---------------- */

const TASKS = {
  sameSize: [{ mode: 'lens', kind: 'convex', f: 10, object: { u: -35, h: 3 } }, { type: 'image', nature: 'real', orientation: 'inverted', size: 'same' }],
  magnifier: [{ mode: 'lens', kind: 'convex', f: 10, object: { u: -30, h: 3 } }, { type: 'image', nature: 'virtual', size: 'magnified' }],
  setF: [{ mode: 'lens', kind: 'convex', f: 8, object: { u: -20, h: 3 }, drag: [], sliders: ['f'] }, { type: 'image', v: 30 }],
  tir: [{ mode: 'refraction', from: 'glass', to: 'air', angle: 20 }, { type: 'ray', tir: true }],
  r20: [{ mode: 'refraction', from: 'air', to: 'glass', angle: 45 }, { type: 'ray', r: 20 }]
};

test('the five kinds of task in the brief are kept, and each has a right answer the learner can reach', () => {
  for (const [name, [spec, goal]] of Object.entries(TASKS)) {
    const t = O.normTask(spec, goal);
    const sol = O.solution(t.spec, t.goal);
    assert.ok(sol, name);
    assert.equal(O.check(t.spec, t.goal, sol).correct, true, name);
    assert.equal(O.check(t.spec, t.goal, O.startValue(t.spec)).correct, false, `${name}: not done at the start`);
  }
  const at = (name) => { const t = O.normTask(...TASKS[name]); return O.solution(t.spec, t.goal); };
  assert.equal(at('sameSize').u, -20, 'at 2F1');
  assert.equal(at('magnifier').u, -9, 'just inside F1, nearest the start');
  assert.equal(at('setF').f, 12, '1/f = 1/30 + 1/20');
  assert.equal(at('tir').i, 42, 'just past the critical angle, 41.8°');
  assert.equal(at('r20').i, 31, 'sin 31° / 1.5 = sin 20.04°');
  const t = O.normTask(...TASKS.magnifier);
  assert.deepEqual(O.solutions(t.spec, t.goal).map((v) => v.u).sort((a, b) => a - b), [-9, -8, -7, -6, -5, -4, -3, -2, -1]);
});

test('goals: words, numbers and ranges; a mirror\'s, a slab\'s and a prism\'s', () => {
  const s = O.normSpec({ mode: 'mirror', kind: 'concave', f: 10, object: { u: -40 } });
  assert.deepEqual(O.normGoal({ type: 'image', nature: 'real and inverted', size: 'enlarged' }, s), { type: 'image', nature: 'real', orientation: 'inverted', size: 'magnified' });
  assert.deepEqual(O.normGoal({ v: 'infinity' }, s), { type: 'image', infinity: true });
  assert.deepEqual(O.normGoal({ type: 'image', v: [-40, -25], f: 10 }, s), { type: 'image', v: [-40, -25], f: -10 });
  assert.throws(() => O.normGoal({ type: 'image', nature: 'real virtual' }, s), /both real and virtual/);
  assert.throws(() => O.normGoal({ type: 'ray', tir: true }, s), /goal is \{"type": "image"/);
  assert.throws(() => O.normGoal({ type: 'image' }, s), /needs something to reach/);
  const slab = O.normSpec({ mode: 'refraction', shape: 'slab', to: 'glass', angle: 20 });
  assert.deepEqual(O.normGoal({ shift: [1, 1.5] }, slab), { type: 'ray', shift: [1, 1.5] });
  assert.throws(() => O.normGoal({ minimum: true }, slab), /for a prism/);
  const prism = O.normSpec({ mode: 'refraction', shape: 'prism', to: 'glass', angle: 30 });
  assert.deepEqual(O.normGoal({ deviation: 'minimum' }, prism), { type: 'ray', minimum: true });
  assert.ok(O.normTask(prism, { type: 'ray', minimum: true }));
  assert.ok(O.normTask(slab, { type: 'ray', shift: [1, 1.5] }));
  assert.ok(O.normTask({ mode: 'mirror', kind: 'concave', f: 10, object: { u: -40 } }, { type: 'image', infinity: true }));
  assert.ok(O.normTask({ mode: 'refraction', from: 'air', to: 'water', angle: 45, turn: false, media: ['water', 'glass', 'diamond'] }, { type: 'ray', r: [0, 20] }), 'choose diamond');
  assert.ok(O.normTask({ mode: 'refraction', from: 'glass', to: 'air', angle: 20 }, { type: 'ray', critical: true }));
});

test('tasks that can\'t be done, or are done already, are refused with a reason to repair them', () => {
  const why = (s, g) => optics.why(s, g);
  assert.equal(why(...TASKS.sameSize), '');
  assert.equal(why({ mode: 'lens', kind: 'concave', f: 10, object: { u: -30 } }, { type: 'image', nature: 'real' }),
    'with a concave lens the image is always virtual, erect and diminished, so no object position gives a real image');
  assert.match(why({ mode: 'mirror', kind: 'convex', f: 15, object: { u: -30 } }, { type: 'image', size: 'magnified' }), /convex mirror the image is always virtual, erect and diminished/);
  assert.match(why({ mode: 'mirror', kind: 'plane', object: { u: -10 } }, { type: 'image', nature: 'real' }), /plane mirror the image is always virtual, erect and the same size/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 10, object: { u: -30 } }, { type: 'image', nature: 'virtual', size: 'diminished' }), /always magnified/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 10, object: { u: -20 } }, { type: 'image', size: 'same' }), /already met at the start \(u = -20 cm gives v = \+20 cm, m = -1 \(real, inverted, same size\)\); start the object where it isn't, e\.g\. "u": -23/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 10, object: { u: -30 } }, { type: 'image', v: 25 }), /v = \+25 cm needs u = -16\.67 cm, which is not one of the object's positions .*e\.g\. v = \+24\.29 cm \(u = -17 cm\)/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 10, object: { u: -30 } }, { type: 'image', v: 5 }), /no real object .*beyond F2/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 10, object: { u: -30 }, step: 3 }, { type: 'image', size: 'same' }), /needs the object exactly at 2F1 \(u = -20 cm\)/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 10, object: { u: -20 }, drag: [], sliders: ['f'] }, { type: 'image', v: 33 }), /needs f = \+12\.45 cm, which is not one of the slider's values/);
  assert.match(why({ mode: 'refraction', from: 'air', to: 'glass', angle: 20 }, { type: 'ray', tir: true }), /from air \(n = 1\) into glass \(n = 1\.5\) it never happens: put the laser in the denser one \("from": "glass", "to": "air"\)/);
  assert.match(why({ mode: 'refraction', from: 'glass', to: 'air', angle: 20, range: [0, 30] }, { type: 'ray', tir: true }), /starts at the critical angle, 41\.8°, but the laser turns only up to 30°/);
  assert.match(why({ mode: 'refraction', from: 'air', to: 'glass', angle: 20 }, { type: 'ray', r: 50 }), /never more than 41\.8° from the normal/);
  assert.match(why({ mode: 'refraction', from: 'air', to: 'glass', angle: 20, step: 5 }, { type: 'ray', r: 20 }), /r = 20° needs i = 30\.87°, which is not an angle of the laser/);
  assert.match(why({ mode: 'refraction', from: 'glass', to: 'air', angle: 50 }, { type: 'ray', tir: true }), /already met .*e\.g\. "angle": 41/);
  // from real AI lessons: a water prism's deviation is never under its minimum; an open question is not a task
  assert.equal(why({ mode: 'refraction', from: 'air', to: 'water', angle: 40, shape: 'prism', apex: 60, white: true }, { type: 'ray', deviation: 20 }),
    'the deviation = 20° can\'t happen here: it only goes from 23.4° to 90° (its minimum deviation is 23.4°)');
  assert.match(why({ mode: 'refraction', shape: 'slab', to: 'glass', angle: 10, thickness: 5 }, { type: 'ray', shift: 9 }), /it only goes from 0 cm to 4\.92 cm/);
  assert.match(why({ mode: 'refraction', from: 'air', to: 'glass', angle: 30, shape: 'slab', thickness: 8 }, { type: 'ray', shift: [0, 100] }), /^every setting meets the goal .*so there is nothing to find/);
  assert.match(why({ mode: 'lens', kind: 'convex', f: 10, drag: [] }, { type: 'image', nature: 'virtual' }), /nothing for the learner to change/);
  assert.match(why({ mode: 'refraction', to: 'glass', turn: false }, { type: 'ray', r: 10 }), /nothing for the learner to change/);
});

test('check(): what the learner did, right or wrong, and why', () => {
  const t = O.normTask(...TASKS.sameSize);
  assert.deepEqual(O.check(t.spec, t.goal, { u: -15 }).why, { key: 'size', want: 'same' });
  assert.equal(O.check(t.spec, t.goal, { u: -10 }).why.key, 'infinity');
  assert.equal(O.check(t.spec, t.goal, { u: -20, f: 10, h: 3 }).correct, true);
  assert.equal(O.check(t.spec, t.goal, { u: -20.5 }).invalid, true, 'not a position the object can take');
  assert.equal(O.check(t.spec, t.goal, { u: -20, f: 12 }).invalid, true, 'f can\'t change here');
  assert.equal(O.check(t.spec, t.goal, null).invalid, true);
  const r = O.normTask(...TASKS.r20);
  const w = O.check(r.spec, r.goal, { i: 35 });
  assert.equal(w.why.key, 'r'); near(w.why.got, 22.48, 0.01); assert.equal(w.why.want, 20);
  const tir = O.normTask(...TASKS.tir);
  assert.deepEqual(O.check(tir.spec, tir.goal, { i: 41 }).why, { key: 'tir', want: true });
  assert.equal(O.check(tir.spec, tir.goal, { i: 89 }).correct, true);
});

/* ---------------- the server module ---------------- */

test('blocks: a bench to try things on; one with nothing to move is left out', () => {
  const b = normWidgetBlock({ t: 'widget', kind: 'optics', spec: { mode: 'lens', kind: 'convex', f: 10, object: { u: -30 } }, caption: 'Drag it.' });
  assert.equal(b.kind, 'optics');
  assert.equal(b.spec.f, 10);
  assert.equal(normWidgetBlock({ t: 'widget', kind: 'optics', spec: { mode: 'lens', kind: 'convex', f: 10, drag: [] } }), null);
  assert.match(optics.why({ mode: 'lens', kind: 'convex', f: 10, drag: [] }), /^a block needs something to try: let them drag the object/);
  assert.equal(optics.why({ mode: 'lens', kind: 'convex', f: 10, drag: [], sliders: ['f'] }), '');
  assert.equal(optics.block({ mode: 'lens' }), null);
  const q = normTask({ type: 'task', kind: 'optics', spec: TASKS.tir[0], goal: TASKS.tir[1] }, { prompt: 'Turn it until TIR.', hint: '', explain: '' });
  assert.equal(q.type, 'task');
  assert.deepEqual(q.goal, { type: 'ray', tir: true });
  assert.equal(normTask({ type: 'task', kind: 'optics', spec: TASKS.tir[0], goal: { type: 'ray', tir: false } }, { prompt: 'x', hint: '', explain: '' }), null, 'already done');
});

test('the prompt: short, and its own examples pass the checks', () => {
  const blocks = [...optics.prompt.matchAll(/Example block: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]));
  const tasks = [...optics.prompt.matchAll(/Example task: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 1);
  assert.equal(tasks.length, 1);
  assert.ok(normWidgetBlock(blocks[0]), optics.why(blocks[0].spec));
  assert.ok(normTask(tasks[0], { prompt: tasks[0].prompt, hint: '', explain: '' }), optics.why(tasks[0].spec, tasks[0].goal));
  // every spec written out in the prompt's text holds together too
  for (const m of optics.prompt.matchAll(/(\{"mode": "refraction"[^\n]*?\})(?=: )/g)) assert.equal(optics.why(JSON.parse(m[1])), '', m[1]);
  assert.ok(optics.prompt.length <= 3000, `short enough (${optics.prompt.length})`);
  assert.match(widgetPrompt(['optics']), /"kind": "optics"/);
});

test('match(): light and optics in the languages Primer serves, and not "in the light of" or a mirror image', () => {
  const yes = [
    'Class 10: light, reflection and refraction', 'Lenses and image formation', 'Spherical mirrors', 'Refraction through a glass slab', 'The human eye and the colourful world',
    'Snell\'s law', 'Total internal reflection and optical fibres', 'Ray optics and optical instruments', 'Concave and convex mirrors', 'Power of a lens', 'Dispersion of white light by a prism',
    'Light, shadows and reflections', 'Physics: light', 'Magnification and the microscope', 'Critical angle', 'Focal length',
    'प्रकाश: परावर्तन और अपवर्तन', 'लेंस', 'अवतल दर्पण', 'उत्तल लेंस', 'फोकस दूरी', 'अपवर्तनांक', 'पूर्ण आंतरिक परावर्तन', 'प्रिज़्म से प्रकाश (भौतिकी)', 'प्रकाशाचे अपवर्तन', 'अंतर्गोल आरसा',
    'অবতল দর্পণ', 'আলোর প্রতিসরণ', 'পোহৰৰ প্ৰতিসৰণ', 'ஒளிவிலகல்', 'కాంతి వక్రీభవనం', 'ಬೆಳಕಿನ ವಕ್ರೀಭವನ', 'പ്രകാശത്തിന്റെ അപവർത്തനം', 'પ્રકાશનું વક્રીભવન', 'ਪ੍ਰਕਾਸ਼ ਦਾ ਅਪਵਰਤਨ',
    'ଆଲୋକର ପ୍ରତିସରଣ', 'عدسے اور آئینے', 'انكسار الضوء', 'refracción de la luz', 'refração da luz', 'la réfraction de la lumière', 'преломление света', 'собирающая линза',
    'espelhos côncavos', 'lentes y espejos'
  ];
  for (const s of yes) assert.ok(optics.match(s.toLowerCase()), `should match: ${s}`);
  const no = [
    'In the light of history', 'Mirror image of a function', 'Light music of India', 'Convex polygons and their angles', 'Concave up and down: concavity', 'Volume of a prism',
    'Measures of dispersion', 'Through the lens of feminism', 'Photosynthesis needs light', 'Reflections and rotations in geometry', 'Self-reflection and journaling',
    'The French Revolution', 'Diwali, the festival of lights', 'Light years and the distance to stars', 'Image processing in Python', 'A la luz de la historia', 'في ضوء التاريخ',
    'Traffic lights and road safety', 'Convex preferences and indifference curves', 'Electric circuits', 'Quadratic equations'
  ];
  for (const s of no) assert.ok(!optics.match(s.toLowerCase()), `should not match: ${s}`);
  assert.ok(widgetKinds({ topic: 'Class 10 Science', title: 'Light: reflection and refraction' }).includes('optics'));
  assert.ok(!widgetKinds({ topic: 'World history', title: 'The French Revolution' }).includes('optics'));
});

test('texts() and withTexts(): only made-up media names go to the translator, each once, and come back in place', () => {
  const s = optics.block({ mode: 'refraction', from: 'air', to: { n: 1.6, name: 'plastic' }, media: ['glass', { n: 1.6, name: 'plastic' }, { n: 1.4, name: 'oil' }] });
  assert.deepEqual(optics.texts(s), ['plastic', 'oil']);
  const t = optics.withTexts(s, ['प्लास्टिक', 'तेल ‮x']);
  assert.equal(t.to.name, 'प्लास्टिक');
  assert.deepEqual(t.media.map((m) => m.name || m.key), ['glass', 'प्लास्टिक', 'तेल x'], 'no direction-changing characters');
  assert.ok(O.sameMedium(t.to, t.media[1]), '"to" is still one of the choices');
  assert.deepEqual(O.normSpec(t), t, 'and it checks the same again');
  assert.equal(s.to.name, 'plastic', 'the original is not changed');
  assert.equal(optics.withTexts(s, ['one']), null);
  assert.deepEqual(optics.texts(optics.block(TASKS.sameSize[0])), []);
});

/* ---------------- the browser half ---------------- */

const impls = {};
const sandbox = { window: { Primer: { t: (s) => s, widgets: { register: (k, impl) => { impls[k] = impl; } } } } };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../assets/js/widgets/optics-core.js', import.meta.url), 'utf8'), sandbox);
sandbox.window.PrimerOptics = sandbox.PrimerOptics;
vm.runInContext(readFileSync(new URL('../assets/js/widgets/optics.js', import.meta.url), 'utf8'), sandbox);
const B = impls.optics;

test('the browser half registers, and checks an attempt with a note that says what is wrong', () => {
  assert.ok(B && typeof B.block === 'function' && typeof B.task === 'function' && typeof B.still === 'function');
  const [spec, goal] = TASKS.sameSize;
  assert.equal(B.check(goal, { u: -20, f: 10, h: 3 }, spec).correct, true);
  assert.equal(B.check(goal, { u: -15, f: 10, h: 3 }, spec).note, 'The image is real, inverted, and magnified (m = −2); it needs to be the same size.');
  assert.equal(B.check(goal, { u: -10, f: 10, h: 3 }, spec).note, 'The image is at infinity: the light comes out parallel and never meets.');
  assert.equal(B.check(goal, { u: -20.5 }, spec).invalid, true);
  assert.equal(B.check(TASKS.r20[1], { i: 35 }, TASKS.r20[0]).note, 'r = 22.5°; it needs to be 20°.');
  assert.equal(B.check(TASKS.tir[1], { i: 30 }, TASKS.tir[0]).note, 'The ray still gets out: no total internal reflection yet.');
  assert.equal(B.check(TASKS.setF[1], { u: -20, f: 10, h: 3 }, TASKS.setF[0]).note, 'v = +20 cm; it needs to be +30 cm.');
});

test('the browser half says the attempt and the answer in words, and draws a still picture', () => {
  assert.equal(B.describe({ u: -15, f: 10, h: 3 }, TASKS.sameSize[0]), 'u = −15 cm: v = +30 cm, m = −2 (real, inverted, and magnified)');
  assert.equal(B.describe({ i: 45 }, TASKS.tir[0]), 'i = 45°: total internal reflection');
  assert.equal(B.answer(TASKS.sameSize[1], TASKS.sameSize[0]), 'u = −20 cm: v = +20 cm, m = −1 (real, inverted, and the same size)');
  assert.equal(B.answer(TASKS.magnifier[1], TASKS.magnifier[0]), 'Any u from −9 cm to −1 cm; for example u = −5 cm: v = −10 cm, m = +2 (virtual, erect, and magnified)');
  assert.equal(B.answer(TASKS.tir[1], TASKS.tir[0]), 'Any i from 42° to 89°; for example i = 66°: total internal reflection');
  assert.equal(B.answer(TASKS.setF[1], TASKS.setF[0]), 'u = −20 cm, f = +12 cm: v = +30 cm, m = −1.5 (real, inverted, and magnified)');
  for (const spec of [TASKS.sameSize[0], { mode: 'mirror', kind: 'concave', f: 12, object: { u: -40, look: 'candle' } }, { mode: 'mirror', kind: 'plane', object: { u: -10 } },
    TASKS.tir[0], { mode: 'refraction', shape: 'slab', to: 'glass' }, { mode: 'refraction', shape: 'prism', to: 'glass', white: true }]) {
    const pic = B.still(spec);
    assert.match(pic, /^<svg [^>]*viewBox="0 0 600 \d+"/, JSON.stringify(spec));
    assert.match(pic, /<\/svg>$/);
  }
  const pic = B.still({ mode: 'refraction', from: 'air', to: { n: 1.6, name: '<b>plastic</b> & "co"' } });
  assert.ok(!pic.includes('<b>'), 'a made-up name is never markup');
  assert.match(pic, /plastic/);
  assert.equal(B.still({ mode: 'nonsense' }), '');
});
