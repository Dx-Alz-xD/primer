// The physics sandbox: the engine and scenes (assets/js/widgets/physics-core.js) against the textbook,
// and the server's checks of what the AI writes (server/widgets/physics.mjs, through server/widgets.mjs).
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../assets/js/widgets/physics-core.js';
import * as physics from '../server/widgets/physics.mjs';
import { normWidgetBlock, normTask, widgetKinds, widgetPrompt, widgetTexts, widgetWithTexts, KINDS } from '../server/widgets.mjs';

const near = (got, want, tol, msg) => assert.ok(Math.abs(got - want) <= tol, `${msg || ''}: expected ${want}, got ${got}`);
const rel = (got, want, frac, msg) => near(got, want, Math.abs(want) * frac, msg);
const value = (spec, of, extra = {}) => C.measure(C.normSpec(spec), {}, { type: 'value', body: 'A', of, value: 1, tol: 1, ...extra });
const run = (W, seconds) => { const n = Math.round(seconds / C.DT); for (let i = 0; i < n; i++) C.step(W); };
const movers = (W) => W.bodies.filter((b) => !b.isStatic && !b.dead);

/* ---------- the physics ---------- */

test('free fall: the time to fall h is √(2h/g), and it lands at √(2gh)', () => {
  for (const [h, g] of [[20, 9.8], [5, 1.62], [80, 3.71]]) {
    const spec = { scene: 'drop', height: h, g, air: 0, bodies: [{ id: 'A', r: 0.1, mass: 1 }] };
    rel(value(spec, 'time').got, Math.sqrt(2 * h / g), 1e-3, `fall time from ${h} m at g = ${g}`);
    rel(value(spec, 'speed').got, Math.sqrt(2 * g * h), 1e-3, `landing speed from ${h} m`);
  }
  // in a vacuum a feather and a stone fall together
  const both = C.normSpec({ scene: 'drop', height: 10, air: 1.2, bodies: [{ id: 'A', mass: 0.005, cd: 1.2, air: false }, { id: 'B', mass: 5, air: false }] });
  const tA = C.measure(both, {}, { type: 'value', body: 'A', of: 'time', value: 1, tol: 1 }).got;
  const tB = C.measure(both, {}, { type: 'value', body: 'B', of: 'time', value: 1, tol: 1 }).got;
  near(tA, tB, 1e-9, 'without drag, mass makes no difference');
});

test('air resistance: speed levels off at the terminal velocity √(2mg / ρ Cd A), or mg / b for linear drag', () => {
  const m = 0.05, r = 0.1, cd = 0.5, rho = 1.2, g = 9.8, A = Math.PI * r * r;
  const r1 = value({ scene: 'drop', height: 200, bodies: [{ id: 'A', r, mass: m, cd }] }, 'terminal');
  assert.equal(r1.reached, true, 'it has stopped speeding up by the time it lands');
  rel(r1.got, Math.sqrt(2 * m * g / (rho * cd * A)), 1e-6, 'quadratic drag');
  // the drag force then balances the weight
  const W = C.build(C.normSpec({ scene: 'drop', height: 200, bodies: [{ id: 'A', r, mass: m, cd }] }), null);
  run(W, 6);
  const rd = C.readout(W, W.bodies.find((b) => b.id === 'A'));
  rel(rd.F.drag[1], m * g, 1e-5, 'drag = weight at terminal velocity');
  near(Math.hypot(rd.net[0], rd.net[1]), 0, 1e-4, 'no net force');
  rel(rd.terminal, Math.sqrt(2 * m * g / (rho * cd * A)), 1e-9, 'the readout says the same');
  // heavier: faster; a parachute (more area): slower
  const heavy = value({ scene: 'drop', height: 300, bodies: [{ id: 'A', r, mass: 4 * m, cd }] }, 'terminal').got;
  rel(heavy, 2 * r1.got, 1e-6, 'four times the mass, twice the terminal velocity');
  const lin = value({ scene: 'drop', height: 100, bodies: [{ id: 'A', r, mass: 1, b: 2, cd: 0 }] }, 'terminal');
  rel(lin.got, 1 * 9.8 / 2, 1e-6, 'linear drag');
  // a short drop never gets there, and says so
  assert.equal(value({ scene: 'drop', height: 1, bodies: [{ id: 'A', r, mass: m, cd }] }, 'terminal').reached, false);
});

test('collisions: momentum is conserved; with e = 1 kinetic energy too; with e = 0 they move on together', () => {
  for (const e of [1, 0.6, 0]) {
    const W = C.build(C.normSpec({ scene: 'collision', e, bodies: [{ id: 'A', mass: 2, v: 3 }, { id: 'B', mass: 1, v: -1 }] }), null);
    const [A, B] = movers(W);
    const p0 = A.m * A.vx + B.m * B.vx, k0 = 0.5 * A.m * A.vx ** 2 + 0.5 * B.m * B.vx ** 2;
    run(W, 0.8); // they have met, and not yet reached the ends of the track
    near(A.m * A.vx + B.m * B.vx, p0, 1e-9, `momentum with e = ${e}`);
    near(B.vx - A.vx, e * 4, 1e-9, `they part at e times the speed they met at (e = ${e})`);
    if (e === 1) near(0.5 * A.m * A.vx ** 2 + 0.5 * B.m * B.vx ** 2, k0, 1e-9, 'kinetic energy with e = 1');
    if (e === 0) near(A.vx, B.vx, 1e-9, 'perfectly inelastic: one velocity');
  }
  // equal masses, elastic: the moving one stops and the other takes its velocity
  const r = C.measure(C.normSpec({ scene: 'collision', bodies: [{ id: 'A', mass: 1, v: 2 }, { id: 'B', mass: 1 }] }), {}, { type: 'stop', body: 'A' });
  assert.equal(r.ok, true);
  near(r.got, 0, 1e-9);
});

test('a spring: Hooke\'s law, the period 2π√(m/k), and the stretch mg/k where it hangs at rest', () => {
  for (const [k, m] of [[40, 1], [10, 2.5], [200, 0.5]]) {
    const v = { scene: 'spring', k, pull: 0.1, bodies: [{ mass: m }] };
    rel(value(v, 'period').got, 2 * Math.PI * Math.sqrt(m / k), 2e-3, `vertical, k = ${k}, m = ${m}`);
    rel(value({ ...v, orient: 'horizontal' }, 'period').got, 2 * Math.PI * Math.sqrt(m / k), 2e-3, `horizontal, k = ${k}, m = ${m}`);
    rel(value(v, 'extension').got, m * 9.8 / k, 5e-3, 'where it rests');
  }
  // the spring's force is k times its extension
  const W = C.build(C.normSpec({ scene: 'spring', k: 30, pull: 0.2, bodies: [{ mass: 1 }] }), null);
  run(W, 0.37);
  const sp = W.springs[0], rd = C.readout(W, movers(W)[0]);
  rel(Math.hypot(rd.F.spring[0], rd.F.spring[1]), 30 * Math.abs(sp.ext), 1e-9, 'F = kx');
});

test('a pendulum: the period 2π√(L/g) for small swings, a little longer for big ones', () => {
  for (const [L, g] of [[1, 9.8], [2.5, 9.8], [1, 1.62]]) {
    rel(value({ scene: 'pendulum', length: L, angle: 4, g }, 'period').got, 2 * Math.PI * Math.sqrt(L / g), 2e-3, `L = ${L}, g = ${g}`);
  }
  const th = 40 * Math.PI / 180;
  const big = 2 * Math.PI * Math.sqrt(1 / 9.8) * (1 + th ** 2 / 16 + 11 * th ** 4 / 3072);
  rel(value({ scene: 'pendulum', length: 1, angle: 40 }, 'period').got, big, 3e-3, 'at 40°');
  // energy is kept as it swings (no air)
  const W = C.build(C.normSpec({ scene: 'pendulum', length: 1, angle: 30 }), null);
  const b = movers(W)[0];
  const e0 = C.readout(W, b).energy;
  run(W, 5);
  rel(C.readout(W, b).energy, e0, 0.015, 'total energy after 5 s (the rope\'s constraint loses a little)');
});

test('a projectile: range v² sin 2θ / g, highest point (v sin θ)² / 2g; from a cliff, v √(2h/g)', () => {
  const p = { scene: 'projectile', angle: 45, speed: 15, air: 0 };
  rel(value(p, 'range').got, 15 * 15 / 9.8, 1e-3, 'range at 45°');
  rel(value(p, 'height').got, (15 * Math.SQRT1_2) ** 2 / (2 * 9.8), 1e-3, 'highest point');
  rel(value({ ...p, angle: 30 }, 'time').got, 2 * 15 * 0.5 / 9.8, 1e-3, 'time of flight at 30°');
  rel(value({ ...p, angle: 0, speed: 10, height: 20 }, 'range').got, 10 * Math.sqrt(2 * 20 / 9.8), 3e-3, 'thrown flat from a cliff');
  // air makes it fall short
  assert.ok(value({ ...p, air: 1.2, bodies: [{ id: 'A', r: 0.1, mass: 0.2, cd: 0.47 }] }, 'range').got < 0.8 * 15 * 15 / 9.8);
});

test('friction: a block slides with a = g(sin θ − μk cos θ); static friction holds it, and a push below μs·N', () => {
  const slope = (deg, mu) => 9.8 * (Math.sin(deg * Math.PI / 180) - mu * Math.cos(deg * Math.PI / 180));
  rel(value({ scene: 'ramp', angle: 30, bodies: [{ mass: 1, mu: 0.2, mus: 0.3 }] }, 'accel').got, slope(30, 0.2), 1e-4, 'down a 30° ramp');
  rel(value({ scene: 'ramp', angle: 45, bodies: [{ mass: 5, mu: 0.5, mus: 0.6 }] }, 'accel').got, slope(45, 0.5), 1e-4, 'down a 45° ramp');
  const still = C.normSpec({ scene: 'ramp', angle: 15, bodies: [{ mass: 1, mu: 0.2, mus: 0.3 }] }); // tan 15° = 0.27 < 0.3
  assert.equal(C.measure(still, {}, { type: 'slide', body: 'A', moves: true }).got, false, 'static friction holds it on the slope');
  const W = C.build(still, null);
  run(W, 1);
  const rd = C.readout(W, movers(W)[0]);
  rel(Math.hypot(rd.F.friction[0], rd.F.friction[1]), 9.8 * Math.sin(15 * Math.PI / 180), 1e-4, 'static friction is just what holds it');
  rel(Math.hypot(rd.F.normal[0], rd.F.normal[1]), 9.8 * Math.cos(15 * Math.PI / 180), 1e-4, 'the normal force is mg cos θ');
  // F = ma on a floor: pushed with 10 N, 2 kg, μk 0.3
  rel(value({ scene: 'push', force: 10, bodies: [{ mass: 2, mu: 0.3, mus: 0.4 }] }, 'accel').got, (10 - 0.3 * 2 * 9.8) / 2, 1e-4, 'F - μN = ma');
  const push = (F) => C.measure(C.normSpec({ scene: 'push', force: F, bodies: [{ mass: 2, mu: 0.3, mus: 0.4 }] }), {}, { type: 'slide', body: 'A', moves: true }).got;
  assert.equal(push(7.5), false, '7.5 N < μs N = 7.84 N');
  assert.equal(push(8.2), true, '8.2 N > 7.84 N');
});

test('floating: a body sinks until it pushes aside its own weight of water', () => {
  for (const d of [300, 500, 800]) {
    const s = C.normSpec({ scene: 'float', bodies: [{ id: 'A', shape: 'box', size: [0.3, 0.3], density: d }] });
    near(C.measure(s, {}, { type: 'value', body: 'A', of: 'submerged', value: 1, tol: 1 }).got, d / 10, 1.5, `density ${d}: ${d / 10}% under`);
  }
  const s = C.normSpec({ scene: 'float', bodies: [{ id: 'A', density: 600 }, { id: 'B', density: 2500, shape: 'ball', r: 0.1 }] });
  assert.equal(C.measure(s, {}, { type: 'float', body: 'A', floats: true }).got, true);
  assert.equal(C.measure(s, {}, { type: 'float', body: 'B', floats: true }).got, false);
});

test('breaking: a wall gives way when the impact force m(1+e)v/Δt passes its strength, and bodies shatter', () => {
  const wall = (speed, strength) => C.measure(C.normSpec({ scene: 'wall', speed, strength, bodies: [{ mass: 2, e: 0.3 }] }), {}, { type: 'break', target: 'W', breaks: true });
  const hard = wall(8, 2000), soft = wall(6, 2000);
  rel(hard.force, 2 * 1.3 * 8 / C.DT, 1e-6, 'the blow');
  assert.equal(hard.got, true, '2496 N > 2000 N');
  assert.equal(soft.got, false, '1872 N < 2000 N');
  // the bricks fly, and momentum along the blow is kept
  const W = C.build(C.normSpec({ scene: 'wall', speed: 12, strength: 1000, bodies: [{ mass: 2 }] }), null);
  run(W, 1.5);
  assert.ok(W.broke.length === 1);
  assert.ok(W.bodies.filter((b) => b.loose).length >= 4, 'several bricks knocked loose');
  // a breakable body dropped from high enough shatters into its pieces
  const glass = (h) => C.normSpec({ scene: 'free', bodies: [{ id: 'G', shape: 'box', size: [0.4, 0.2], mass: 1, at: [0, h], break: { strength: 300, rows: 2, cols: 3 } }] });
  const Wg = C.build(glass(3), null);
  run(Wg, 2);
  assert.equal(Wg.broke.length, 1, 'dropped from 3 m');
  assert.equal(Wg.bodies.filter((b) => b.kind === 'piece' && !b.dead).length, 6);
  const Wk = C.build(glass(0.15), null);
  run(Wk, 2);
  assert.equal(Wk.broke.length, 0, 'set down gently');
});

test('the engine is deterministic: the same scene gives the same numbers, bit for bit', () => {
  const spec = C.normSpec({ scene: 'wall', speed: 11, strength: 1500, rows: 8, cols: 3, bodies: [{ mass: 3 }] });
  const trace = () => { const W = C.build(spec, null); const out = []; for (let i = 0; i < 300; i++) { C.step(W); if (i % 30 === 0) out.push(W.bodies.map((b) => [b.x, b.y, b.a, b.vx, b.vy, b.w])); } return JSON.stringify(out); };
  assert.equal(trace(), trace());
  // its sine and cosine are its own (only + - * /), and right
  for (let x = -20; x <= 20; x += 0.37) { near(C.dsin(x), Math.sin(x), 1e-12, `sin ${x}`); near(C.dcos(x), Math.cos(x), 1e-12, `cos ${x}`); }
});

/* ---------- the spec ---------- */

test('every scene comes out whole, and reading a clean spec again changes nothing', () => {
  const specs = [
    { scene: 'drop' }, { scene: 'projectile', angle: 30, speed: 20, height: 5 }, { scene: 'collision', bodies: [{ mass: 2, v: 3 }, { mass: 1 }, { mass: 4 }] },
    { scene: 'ramp', angle: 20, bodies: [{ shape: 'ball', r: 0.2 }] }, { scene: 'push', force: 30, time: 2 }, { scene: 'spring', orient: 'horizontal', k: 50 },
    { scene: 'pendulum', bodies: [{ length: 0.5 }, { length: 1, angle: 40 }] }, { scene: 'wall', rows: 4, cols: 3 }, { scene: 'float', fluid: { density: 800, name: 'oil' }, bodies: [{ density: 700 }] },
    { scene: 'free', bodies: [{ id: 'A', at: [0, 1], v: [2, 3] }, { id: 'B', shape: 'box', at: [3, 0.25], size: [0.5, 0.5], fixed: true }], springs: [{ a: 'A', b: [0, 3], k: 20, length: 1 }], ramps: [{ x: 5, angle: 30, length: 2 }] }
  ];
  for (const raw of specs) {
    const once = C.normSpec(raw);
    assert.deepEqual(C.normSpec(JSON.parse(JSON.stringify(once))), once, `${raw.scene} again`);
    assert.ok(C.build(once, null).bodies.length > 0);
  }
  const s = C.normSpec({ scene: 'projectile', angle: '45°', speed: '20 m/s', g: 'moon', sliders: [{ var: 'angle', min: 10, max: 80, step: 5, value: 33 }] });
  assert.equal(s.g, 1.62);
  assert.equal(s.speed, 20);
  assert.equal(s.angle, 35, 'a slider starts on one of its steps');
  // what models write in real lessons: a ball's own "v" for the speed, "e" on each body, a force graph
  const w = C.normSpec({ scene: 'wall', bodies: [{ id: 'A', mass: 0.5, v: 12 }], sliders: [{ var: 'A.v', min: 1, max: 20, step: 1 }], graph: 'force' });
  assert.equal(w.speed, 12);
  assert.deepEqual(w.sliders.map((c) => c.var), ['speed']);
  assert.equal(w.graph, 'force');
  assert.equal(C.normSpec({ scene: 'collision', bodies: [{ mass: 3, v: 2, e: 0 }, { mass: 1, e: 0 }] }).e, 0, 'perfectly inelastic, said on the bodies');
});

test('specs that make no sense are left out, with a reason the AI can act on', () => {
  const why = (spec) => { try { C.normSpec(spec); return ''; } catch (e) { assert.ok(e instanceof C.PhysicsError, e.message); return e.message; } };
  assert.match(why({ scene: 'rocket' }), /unknown scene "rocket"/);
  assert.match(why({ scene: 'projectile', angle: 120 }), /launch angle 120 is outside 0 to 90/);
  assert.match(why({ scene: 'drop', bodies: [{ mass: 5000 }] }), /mass 5000 is outside/);
  assert.match(why({ scene: 'spring', k: 20000, bodies: [{ mass: 0.01 }] }), /too stiff.*keep k \/ m below/);
  assert.match(why({ scene: 'projectile', sliders: [{ var: 'g', min: 1, max: 25, step: 0.1 }] }), /240 steps; give it at most 60/);
  assert.match(why({ scene: 'projectile', sliders: [{ var: 'k', min: 1, max: 2 }] }), /no slider for/);
  assert.match(why({ scene: 'wall', rows: 12, cols: 4 }), /bricks; at most 39/);
  assert.match(why({ scene: 'wall', bodies: [{ v: 3 }, { v: 12 }] }), /a wall scene has one body \(got 2\): to compare a slow and a fast ball, give it a "speed" slider/);
  assert.match(why({ scene: 'free', bodies: [{ id: 'A', at: [0, 0.5], r: 0.3 }, { id: 'B', at: [0.2, 0.5], r: 0.3 }] }), /overlap at the start/);
  assert.match(why({ scene: 'collision', bodies: [{ mass: 1, v: 0 }, { mass: 1 }] }), /nothing on the track is moving/);
});

/* ---------- tasks, checked on the server ---------- */

const LAND = { spec: { scene: 'projectile', speed: 15, angle: 70, sliders: [{ var: 'angle', min: 10, max: 80, step: 5 }] }, goal: { type: 'land', body: 'A', x: [21, 24] } };

test('a task must be possible with the sliders, and not done at the start; the server keeps a setting that does it', () => {
  const t = physics.task(LAND.spec, LAND.goal);
  assert.ok(t);
  assert.ok(t.goal.solve && t.goal.solve.v.angle, 'a working setting');
  assert.deepEqual(t.spec.target, { x: [21, 24] }, 'the zone is drawn');
  // that setting works, the start doesn't, and the learner's attempt is judged by running the scene
  assert.equal(C.check(t.spec, t.goal, t.goal.solve).correct, true);
  assert.equal(C.check(t.spec, t.goal, { v: { angle: 70 } }).correct, false);
  assert.equal(C.check(t.spec, t.goal, { v: { angle: 45 } }).correct, true, 'any angle that lands there');
  assert.equal(C.check(t.spec, t.goal, null).invalid, true);
  // the reasons a task is left out
  assert.match(physics.why({ ...LAND.spec, speed: 10 }, LAND.goal), /no slider setting can land between x = 21 and 24 m; across the sliders it lands from [\d.]+ to [\d.]+ m/);
  assert.match(physics.why({ ...LAND.spec, angle: 45 }, LAND.goal), /already meets the goal as it starts \(A lands at x = 23 m\)/);
  assert.match(physics.why({ scene: 'projectile' }, LAND.goal), /nothing to change/);
  assert.match(physics.why({ scene: 'wall', speed: 3, strength: 200000, sliders: [{ var: 'speed', min: 1, max: 15, step: 1 }] }, { type: 'break', breaks: true }), /hardest impact is \d+ N .* strength of 200000 N/);
  assert.match(physics.why({ scene: 'drop', height: 2, bodies: [{ id: 'A', mass: 0.05, cd: 0.5 }], sliders: [{ var: 'A.mass', min: 0.01, max: 0.3, step: 0.01 }] },
    { type: 'value', body: 'A', of: 'terminal', value: 10, tol: 0.3 }), /never reaches its terminal velocity: make the drop higher/);
  assert.equal(physics.task({ ...LAND.spec, speed: 10 }, LAND.goal), null);
  assert.equal(physics.why(LAND.spec, LAND.goal), '');
  // a block's wall must break at some setting (a task may start with one that holds)
  const light = { scene: 'wall', bodies: [{ id: 'A', mass: 0.05, v: 8 }], sliders: [{ var: 'A.v', min: 2, max: 20, step: 1 }] };
  assert.match(physics.why(light), /nothing here can break the wall: the hardest blow is 156 N .* it takes 2000 N; make the ball heavier or faster, or the wall weaker/);
  assert.equal(physics.block(light), null);
  assert.ok(physics.block({ ...light, strength: 100 }), 'a weaker wall');
  // a cushion spreads the blow: the same impulse over its contact time
  const padded = C.measure(C.normSpec({ scene: 'wall', speed: 10, pad: 0.01, bodies: [{ mass: 2, e: 0.3 }] }), {}, { type: 'break', target: 'W', breaks: true });
  rel(padded.force, 2 * 1.3 * 10 / 0.01, 1e-9, 'impact with a 0.01 s cushion');
});

test('tasks of every kind: values, stopping a ball, breaking a wall, floating, sliding', () => {
  const ok = (spec, goal) => { const w = physics.why(spec, goal); assert.equal(w, '', w); return physics.task(spec, goal); };
  let t = ok({ scene: 'collision', e: 0.5, bodies: [{ id: 'A', mass: 2, v: 3 }, { id: 'B', mass: 1 }], sliders: [{ var: 'e', min: 0, max: 1, step: 0.1 }] }, { type: 'value', body: 'B', of: 'vx', value: 4, tol: 0.1 });
  assert.equal(t.goal.solve.v.e, 1, 'B leaves at 4 m/s only when e = 1');
  t = ok({ scene: 'collision', bodies: [{ id: 'A', mass: 1, v: 2 }, { id: 'B', mass: 3 }], sliders: [{ var: 'B.mass', min: 1, max: 5, step: 0.5 }] }, { type: 'stop', body: 'A' });
  assert.equal(t.goal.solve.v['B.mass'], 1);
  t = ok({ scene: 'wall', speed: 3, strength: 2000, sliders: [{ var: 'speed', min: 1, max: 15, step: 1 }] }, { type: 'break', breaks: true });
  assert.ok(2 * 1.3 * t.goal.solve.v.speed / C.DT > 2000 * 1.03);
  t = ok({ scene: 'spring', k: 10, bodies: [{ mass: 1 }], sliders: [{ var: 'k', min: 10, max: 100, step: 10 }] }, { type: 'value', of: 'period', value: 1, tol: 0.05 });
  assert.equal(t.goal.solve.v.k, 40);
  t = ok({ scene: 'pendulum', length: 0.5, sliders: [{ var: 'length', min: 0.25, max: 3, step: 0.25 }] }, { type: 'value', of: 'period', value: 2, tol: 0.05 });
  assert.equal(t.goal.solve.v.length, 1);
  t = ok({ scene: 'float', bodies: [{ id: 'A', density: 1500 }], sliders: [{ var: 'A.density', min: 200, max: 1800, step: 100 }] }, { type: 'float', body: 'A', floats: true });
  assert.ok(t.goal.solve.v['A.density'] < 1000, 'less dense than water, with some of it showing');
  t = ok({ scene: 'ramp', angle: 10, bodies: [{ mass: 1, mu: 0.3, mus: 0.4 }], sliders: [{ var: 'angle', min: 5, max: 45, step: 5 }] }, { type: 'slide', moves: true });
  assert.ok(Math.tan(t.goal.solve.v.angle * Math.PI / 180) > 0.4);
  t = ok({ scene: 'drop', height: 100, bodies: [{ id: 'A', r: 0.1, mass: 0.05, cd: 0.5 }], sliders: [{ var: 'A.mass', min: 0.01, max: 0.3, step: 0.01 }] }, { type: 'value', body: 'A', of: 'terminal', value: 10, tol: 0.3 });
  near(Math.sqrt(2 * t.goal.solve.v['A.mass'] * 9.8 / (1.2 * 0.5 * Math.PI * 0.01)), 10, 0.3);
  // the page checks again without searching: it reads the server's setting
  const light = C.normTask(t.spec, t.goal, { light: true });
  assert.deepEqual(light.goal.solve, t.goal.solve);
  assert.deepEqual(C.solution(light.spec, light.goal), t.goal.solve.v);
});

test('the core frame takes physics blocks and tasks, offers physics to mechanics lessons, and translates its words', () => {
  assert.ok(KINDS.includes('physics'));
  const ex = JSON.parse(physics.prompt.match(/Block example: (.*)/)[1]);
  const b = normWidgetBlock(ex);
  assert.ok(b && b.kind === 'physics' && b.spec.scene === 'drop', 'the prompt\'s block example is valid');
  const tx = JSON.parse(physics.prompt.match(/Task example: (.*)/)[1]);
  const q = normTask(tx, { prompt: tx.prompt, hint: '', explain: '' });
  assert.ok(q && q.goal.solve, 'the prompt\'s task example is valid');
  assert.equal(normWidgetBlock({ t: 'widget', kind: 'physics', spec: { scene: 'nope' } }), null);
  assert.ok(physics.prompt.length < 3300, `the prompt stays short (${physics.prompt.length})`);
  assert.ok(widgetKinds({ topic: 'Physics', title: 'Air resistance and terminal velocity' }).includes('physics'));
  assert.ok(widgetPrompt(['physics']).includes('"kind": "physics"'));
  // the words a translator sees, and the spec with them put back
  const spec = b.spec;
  assert.deepEqual(widgetTexts('physics', spec), ['in air', 'no air']);
  const back = widgetWithTexts('physics', spec, ['हवा में', 'बिना हवा']);
  assert.deepEqual(back.bodies.map((x) => x.label), ['हवा में', 'बिना हवा']);
  assert.ok(physics.block(back), 'still valid');
});

test('which lessons are offered physics: mechanics in the languages Primer serves, not other senses of the words', () => {
  const yes = ['Air resistance and terminal velocity', 'Elastic and inelastic collisions', 'Class 9 physics: force and laws of motion', 'Projectile motion',
    'Simple pendulum', 'Hooke\'s law and springs', 'Friction', 'Kinetic and potential energy', 'Buoyancy and Archimedes\' principle', 'Strength of materials: stress and strain',
    'Physics: momentum', 'Science: speed, velocity and acceleration', 'गुरुत्वाकर्षण', 'घर्षण बल', 'वायु प्रतिरोध', 'प्रक्षेप्य गति', 'संवेग का संरक्षण', 'गति के नियम', 'लोलक',
    'স্প্রিং ও ঘর্ষণ', 'உராய்வு', 'ఘర్షణ', 'ಗುರುತ್ವಾಕರ್ಷಣೆ', 'ഘർഷണം', 'ગુરુત્વાકર્ષણ', 'ਰਗੜ ਬਲ', 'ଘର୍ଷଣ', 'رگڑ', 'قوانين نيوتن', 'Leyes de Newton', 'La chute libre', 'Atrito e plano inclinado', 'Сила трения'];
  const no = ['The force of habit', 'The Indian Air Force', 'Market forces and prices', 'Momentum in sales', 'Gaining momentum in business', 'Electric force and Coulomb\'s law',
    'Photoelectric effect: kinetic energy of electrons', 'Lenses and refraction of light', 'Ohm\'s law and circuits', 'Price elasticity of demand', 'Stress management for exams',
    'Spring season flowers', 'The French Revolution', 'Motion pictures in India', 'Weight loss and diet', 'Mass media', 'Drag and drop in HTML'];
  for (const t of yes) assert.ok(physics.match(t.toLowerCase()), `offered: ${t}`);
  for (const t of no) assert.ok(!physics.match(t.toLowerCase()), `not offered: ${t}`);
});
