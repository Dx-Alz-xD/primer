// The geometry board: the construction model, measurements and goal checks (assets/js/widgets/geometry-core.js)
// and the server's checks of what the AI writes (server/widgets/geometry.mjs, through server/widgets.mjs).
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../assets/js/widgets/geometry-core.js';
import * as geometry from '../server/widgets/geometry.mjs';
import { normWidgetBlock, normTask, widgetKinds, widgetPrompt, widgetTexts, widgetWithTexts } from '../server/widgets.mjs';

const near = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);
const at = (M, V, name) => M.point(V, name);
// a board, its model and its values at the start (or with some points moved)
function board(spec, moved) {
  const s = G.cleanSpec(spec), M = G.model(s);
  const V = M.compute(moved ? M.fromPositions(moved, false) : M.init());
  return { s, M, V, p: (n) => at(M, V, n), m: (i) => M.measures[i].f(V) };
}
const tri = (more = {}) => ({ points: { A: [0, 0], B: [6, 0], C: [2, 4] }, objects: [{ type: 'polygon', of: ['A', 'B', 'C'] }], drag: ['C'], grid: true, ...more });

test('midpoint, centroid, circumcentre, incentre and orthocentre', () => {
  const b = board(tri({ objects: [
    { type: 'polygon', of: 'ABC' }, { type: 'midpoint', of: ['A', 'B'], name: 'M' }, { type: 'centroid', of: 'ABC', name: 'G' },
    { type: 'circumcentre', of: 'ABC', name: 'O' }, { type: 'incentre', of: 'ABC', name: 'I' }, { type: 'orthocentre', of: 'ABC', name: 'H' }
  ] }));
  assert.deepEqual(b.p('M'), { x: 3, y: 0 });
  near(b.p('G').x, 8 / 3); near(b.p('G').y, 4 / 3);
  const O = b.p('O'), { dist } = G.geo;
  near(dist(O, b.p('A')), dist(O, b.p('B'))); near(dist(O, b.p('A')), dist(O, b.p('C')));
  // the orthocentre: AH is perpendicular to BC
  const H = b.p('H'), A = b.p('A'), B = b.p('B'), C = b.p('C');
  near((H.x - A.x) * (C.x - B.x) + (H.y - A.y) * (C.y - B.y), 0, 1e-9);
  // the incentre is as far from every side
  const I = b.p('I'), line = (p, q) => ({ x: p.x, y: p.y, dx: q.x - p.x, dy: q.y - p.y, lo: -Infinity, hi: Infinity });
  near(G.geo.distTo(I, line(A, B)), G.geo.distTo(I, line(B, C)), 1e-9);
  near(G.geo.distTo(I, line(B, C)), G.geo.distTo(I, line(C, A)), 1e-9);
  // Euler: G is a third of the way from O to H
  near(b.p('G').x, O.x + (H.x - O.x) / 3, 1e-9);
});

test('intersections: two lines, a line and a circle (the other crossing), two circles (the one near)', () => {
  const b = board({
    points: { A: [0, 0], B: [4, 4], C: [0, 4], D: [4, 0], O: [5, 5], E: [8, 5] },
    objects: [
      { type: 'segment', of: 'AB' }, { type: 'segment', of: 'CD' }, { type: 'intersection', of: ['AB', 'CD'], name: 'X' },
      { type: 'circle', center: 'O', through: 'E', name: 'c' }, { type: 'line', of: 'OE' }, { type: 'intersection', of: ['OE', 'c'], name: 'F', not: 'E' },
      { type: 'circle', center: 'E', radius: 3, name: 'k' }, { type: 'intersection', of: ['c', 'k'], name: 'Y', near: [6.5, 8] }
    ]
  });
  assert.deepEqual(b.p('X'), { x: 2, y: 2 });
  near(b.p('F').x, 2); near(b.p('F').y, 5);
  near(b.p('Y').x, 6.5); near(b.p('Y').y, 5 + Math.sqrt(9 - 2.25), 1e-9);
  assert.equal(b.s.objects[7].pick, 0, 'the crossing near (6.5, 8) is kept as a choice, so it stays the same one');
  // segments that stop meeting: the point and what's made from it are simply not there
  const off = board({
    points: { A: [0, 0], B: [4, 4], C: [0, 4], D: [4, 0] },
    objects: [{ type: 'segment', of: 'AB' }, { type: 'segment', of: 'CD' }, { type: 'intersection', of: ['AB', 'CD'], name: 'X' }, { type: 'segment', of: 'AX' }],
    drag: ['B']
  }, { B: [1, 0.5] });
  assert.equal(off.p('X'), null);
  assert.equal(off.V[off.M.nodes.length - 1], null, 'segment AX goes with X');
});

test('lines made from others: perpendicular, parallel, both bisectors, a foot, tangents', () => {
  const b = board({
    points: { A: [0, 0], B: [6, 0], C: [2, 4], P: [3, 5], O: [0, 0], T: { at: [3, 4], on: 'c' }, Q: [10, 0] },
    objects: [
      { type: 'line', of: 'AB', name: 'l' }, { type: 'perpendicular', through: 'P', to: 'l', name: 'm' }, { type: 'parallel', through: 'P', to: 'AB', name: 'n' },
      { type: 'intersection', of: ['m', 'l'], name: 'F' }, { type: 'foot', from: 'C', to: 'AB', name: 'K' },
      { type: 'perpendicular bisector', of: ['A', 'B'], name: 'pb' }, { type: 'point', name: 'Z', at: [3, 2], on: 'pb' },
      { type: 'angle bisector', at: 'A', from: 'B', to: 'C', name: 'ab' },
      { type: 'circle', center: 'O', radius: 5, name: 'c' }, { type: 'tangent', at: 'T', to: 'c', name: 't' },
      { type: 'tangent', from: 'Q', to: 'c', points: ['U', 'W'] }
    ],
    x: [-6, 11], y: [-6, 7], drag: ['P', 'T', 'Q']
  });
  assert.deepEqual(b.p('F'), { x: 3, y: 0 }, 'the perpendicular from P meets AB at its foot');
  assert.deepEqual(b.p('K'), { x: 2, y: 0 });
  const V = b.V, line = (name) => V[b.M.names.get(name)];
  near(G.geo.between(line('n'), line('l')), 0); near(G.geo.between(line('m'), line('l')), 90);
  near(G.geo.dist(b.p('Z'), b.p('A')), G.geo.dist(b.p('Z'), b.p('B')), 1e-9, 'a point on the perpendicular bisector is as far from A as from B');
  const ab = line('ab'), D = G.geo.along(ab, 2);
  near(G.geo.angleAt(b.p('A'), b.p('B'), D), G.geo.angleAt(b.p('A'), D, b.p('C')), 1e-9, 'the bisector halves angle BAC');
  // the tangent at T is perpendicular to the radius; from Q, the radius to each touching point is perpendicular to QU
  const t = line('t');
  near(t.dx * 3 + t.dy * 4, 0, 1e-9);
  for (const k of ['U', 'W']) {
    const U = b.p(k), Q = b.p('Q');
    near(G.geo.dist(U, b.p('O')), 5, 1e-9);
    near(U.x * (Q.x - U.x) + U.y * (Q.y - U.y), 0, 1e-9);
  }
  near(b.p('U').y, -b.p('W').y, 1e-9, 'one above, one below');
  // Q moved inside the circle: no tangents, and no error
  const inside = board({ points: { O: [0, 0], Q: [10, 0] }, objects: [{ type: 'circle', center: 'O', radius: 5, name: 'c' }, { type: 'tangent', from: 'Q', to: 'c', points: ['U', 'W'] }], x: [-6, 11], y: [-6, 6] }, { Q: [2, 0] });
  assert.equal(inside.p('U'), null);
});

test('transformations: reflect, rotate, translate, enlarge, with the images named A\', B\', C\'', () => {
  const b = board({
    points: { A: [1, 1], B: [3, 1], C: [1, 2], O: [0, 0], D: [5, 0], E: [5, 1] },
    objects: [
      { type: 'line', of: 'DE', name: 'm' }, { type: 'reflect', of: 'ABC', in: 'm' },
      { type: 'rotate', of: ['A'], about: 'O', by: 90, names: ['R'] }, { type: 'translate', of: ['B'], by: [2, 3], names: ['S'] },
      { type: 'translate', of: ['C'], by: 'OD', names: ['U'] }, { type: 'enlarge', of: ['B'], center: 'O', by: -2, names: ['K'] },
      { type: 'reflect', of: ['B'], in: 'O', names: ['N'] }
    ],
    x: [-7, 11], y: [-4, 6]
  });
  assert.deepEqual(b.p("A'"), { x: 9, y: 1 });
  assert.deepEqual(b.p("C'"), { x: 9, y: 2 });
  near(b.p('R').x, -1, 1e-12); near(b.p('R').y, 1, 1e-12);
  assert.deepEqual(b.p('S'), { x: 5, y: 4 });
  assert.deepEqual(b.p('U'), { x: 6, y: 2 });
  assert.deepEqual(b.p('K'), { x: -6, y: -2 });
  assert.deepEqual(b.p('N'), { x: -3, y: -1 });
  assert.ok(b.M.nodes.some((n) => n.kind === 'poly' && n.of.join() === "A',B',C'"), 'the image triangle is drawn');
});

test('gliders stay on their path, move with it, and snap', () => {
  const spec = { points: { O: [0, 0], A: [5, 0], P: { at: [0, 5], on: 'c' }, B: [-4, -3], Q: { at: [2, 0], on: 'OA' } }, objects: [{ type: 'circle', center: 'O', through: 'A', name: 'c' }, { type: 'segment', of: 'OA' }], drag: ['P', 'Q', 'O'], snap: 1, x: [-6, 6], y: [-6, 6] };
  const s = G.cleanSpec(spec), M = G.model(s);
  let S = M.place(M.init(), 'P', 4, 4);
  let V = M.compute(S);
  near(G.geo.dist(M.point(V, 'P'), M.point(V, 'O')), 5, 1e-9, 'still on the circle');
  near(Math.atan2(M.point(V, 'P').y, M.point(V, 'P').x) * 180 / Math.PI, 45, 1e-9, 'on a whole degree');
  S = M.place(S, 'Q', 9, 3);
  assert.deepEqual(M.point(M.compute(S), 'Q'), { x: 5, y: 0 }, 'kept within the segment');
  S = M.place(S, 'Q', 2.4, 1);
  assert.deepEqual(M.point(M.compute(S), 'Q'), { x: 2, y: 0 }, 'in steps of 1 along it');
  // the centre moves: the circle and the point on it go too
  S = M.place(S, 'O', 1, 0);
  V = M.compute(S);
  near(G.geo.dist(M.point(V, 'P'), M.point(V, 'O')), 4, 1e-9);
  // free points move on the grid and stay in the view
  S = M.place(S, 'O', 7.4, 2.6);
  assert.deepEqual(M.point(M.compute(S), 'O'), { x: 6, y: 3 });
});

test('a dragged point that starts on a circle goes round it (as the AI meant), unless its solution is off it', () => {
  // as a real lesson wrote it: "drag C round the circle", with C a free point on it
  const spec = { x: [0, 10], y: [0, 8], grid: true, points: { O: [5, 4], A: [2, 4], B: [8, 4], C: [5, 7] }, objects: [{ type: 'circle', center: 'O', through: 'A' }, { type: 'segment', of: 'CA' }, { type: 'segment', of: 'CB' }, { type: 'angle', at: 'C', from: 'A', to: 'B' }], drag: ['C'], measure: ['angle ACB'] };
  const s = G.cleanSpec(spec);
  assert.deepEqual(s.points.C, { at: [5, 7], on: 'c' });
  assert.equal(s.objects[0].name, 'c', 'the circle is named so the point can say which');
  assert.deepEqual(G.cleanSpec(s), s);
  const M = G.model(s), V = M.compute(M.place(M.init(), 'C', 9, 9));
  near(G.geo.dist(M.point(V, 'C'), { x: 5, y: 4 }), 3, 1e-9);
  near(M.measures[0].f(V), 90, 1e-9, 'the angle in a semicircle, wherever C goes');
  // a task whose solution is off the circle keeps C free; one made from C (through C) is not a path for it
  assert.match(geometry.why({ ...spec, measure: [] }, { all: ['angle ACB = 60'], solution: { C: [5.5, 6] } }), /C moves in steps of 1/, 'kept free (its solution is off the circle), and dropped for being off the grid');
  assert.deepEqual(G.cleanSpec({ ...spec, objects: [{ type: 'circle', center: 'O', through: 'C' }] }, { solution: { C: [5, 1] } }).points.C, [5, 7]);
  const kept = G.cleanSpec(spec, { task: true, solution: { C: [2, 6] } });
  assert.deepEqual(kept.points.C, { at: [5, 7], free: true }, 'a solution off the circle: C stays free, and the clean spec says so');
  assert.deepEqual(G.cleanSpec(kept), kept);
});

test('a block\'s point roughly on a circle goes on it; a task\'s stays free unless exactly on it, and the clean spec says which', () => {
  // as a real lesson wrote it: C at (4, 6.5) "on" a circle of radius 3 about (5, 4)
  const spec = { x: [0, 10], y: [0, 8], grid: true, points: { O: [5, 4], A: [2, 4], B: [8, 4], C: [4, 6.5], D: [6, 6.5] }, objects: [{ type: 'circle', center: 'O', through: 'A', name: 'c' }, { type: 'angle', at: 'C', from: 'A', to: 'B' }, { type: 'angle', at: 'D', from: 'A', to: 'B' }], drag: ['C', 'D'], measure: ['angle ACB', 'angle ADB'] };
  const b = geometry.block(spec);
  assert.deepEqual(b.points.C, { at: [4, 6.5], on: 'c' });
  const M = G.model(b), V = M.compute(M.init());
  near(M.measures[0].f(V), 90, 1e-9); near(M.measures[1].f(V), 90, 1e-9);
  // the same as a task: C stays free (marked so), and every reading of the clean spec agrees
  const t = geometry.task(spec, { all: ['angle ACB = 90'], solution: { C: [5, 7] } });
  assert.deepEqual(t.spec.points.C, { at: [4, 6.5], free: true });
  assert.deepEqual(t.spec.points.D, { at: [6, 6.5], free: true });
  assert.deepEqual(G.cleanSpec(t.spec), t.spec);
  assert.equal(G.check(t.spec, t.goal, { C: [2, 4] }).correct, false, 'free: C can go anywhere, even onto A');
  // two circles near the point: no guess
  const two = geometry.block({ ...spec, points: { ...spec.points, E: [5, 4.5] }, objects: [...spec.objects, { type: 'circle', center: 'E', radius: 2.5 }] });
  assert.deepEqual(two.points.C, [4, 6.5]);
});

test('points made from others may be written among the points (as a real lesson did); a parallelogram stays one', () => {
  const spec = { x: [0, 12], y: [0, 8], grid: true, points: { A: [2, 1], B: [10, 1], C: [8, 5], D: { type: 'translate', of: ['A'], by: 'BC', names: ['D'] }, O: { type: 'intersection', of: ['AC', 'BD'] } },
    objects: [{ type: 'polygon', of: ['A', 'B', 'C', 'D'] }, { type: 'segment', of: ['A', 'C'] }, { type: 'segment', of: ['B', 'D'] }], drag: ['B', 'C'], measure: ['AO', 'OC', 'BO', 'OD'] };
  const s = geometry.block(spec);
  assert.ok(s, geometry.why(spec));
  assert.deepEqual(Object.keys(s.points), ['A', 'B', 'C']);
  assert.deepEqual(s.objects.slice(3).map((o) => o.type), ['translate', 'intersection']);
  const M = G.model(s);
  for (const [b, c] of [[[10, 1], [8, 5]], [[9, 2], [11, 6]], [[6, 0], [7, 7]]]) {
    const V = M.compute(M.fromPositions({ B: b, C: c }, false));
    near(M.measures[0].f(V), M.measures[1].f(V), 1e-9, 'AO = OC');
    near(M.measures[2].f(V), M.measures[3].f(V), 1e-9, 'BO = OD');
  }
});

test('measurements: lengths, angles, sums, areas, perimeters, ratios, squares, coordinates, units', () => {
  const b = board(tri({
    unit: 'cm', axes: true,
    objects: [{ type: 'polygon', of: ['A', 'B', 'C'] }, { type: 'circle', center: 'A', radius: 2, name: 'c' }],
    measure: ['angle ACB', 'AB', 'area ABC', 'angle A + angle B + angle C', 'perimeter ABC', 'AB/AC', 'AC^2 + BC^2', 'C']
  }));
  const more = board(tri({ objects: [{ type: 'polygon', of: 'ABC' }, { type: 'circle', center: 'A', radius: 2, name: 'c' }], measure: ['radius c', 'area c', '∠BAC', 'x C'] }));
  near(b.m(0), 71.56505117707799, 1e-9);
  near(b.m(1), 6, 1e-9);
  near(b.m(2), 12, 1e-9);
  near(b.m(3), 180, 1e-9, 'a triangle\'s angles');
  near(b.m(4), 6 + Math.sqrt(20) + Math.sqrt(32), 1e-9);
  near(b.m(5), 6 / Math.sqrt(20), 1e-9);
  near(b.m(6), 52, 1e-9);
  assert.deepEqual(b.m(7), [2, 4]);
  assert.equal(more.m(0), 2);
  near(more.m(1), 4 * Math.PI, 1e-9);
  near(more.m(2), 63.43494882292201, 1e-9);
  assert.equal(more.m(3), 2);
  const show = b.M.measures.map((m) => (m.coords ? m.text : `${m.show()} = ${G.showValue(m.f(b.V), m.dim, b.M.unit)}`));
  assert.deepEqual(show.slice(0, 7), ['∠ACB = 71.6°', 'AB = 6 cm', 'area ABC = 12 cm²', '∠A + ∠B + ∠C = 180°', 'perimeter ABC = 16.13 cm', 'AB/AC = 1.34', 'AC² + BC² = 52 cm²']);
  // Pythagoras, as the learner drags C onto the circle on AB
  const r = board(tri({ measure: ['AC^2 + BC^2', 'AB^2'] }), { C: [3, 3] });
  near(r.m(0), r.m(1), 1e-9);
});

test('a measurement or condition that doesn\'t read says why', () => {
  const bad = (m) => { try { G.cleanSpec(tri({ measure: [m] })); return ''; } catch (e) { assert.ok(e instanceof G.GeoError, e.message); return e.message; } };
  assert.match(bad('angle XYZ'), /no point X/);
  assert.match(bad('ABC'), /say "angle ABC", "area ABC" or "perimeter ABC"/);
  assert.match(bad('angle AB + 1'), /three points/);
  assert.match(bad('AB + angle C'), /can't add or take/);
  assert.match(bad('area of the moon'), /nothing is called|can't read/);
  assert.match(bad('eval(1)'), /can't read/);
  assert.match(bad('angle D'), /no point D/);
  const goal = (c) => { try { G.cleanGoal({ all: [c], solution: { C: [3, 3] } }, G.cleanSpec(tri())); return ''; } catch (e) { return e.message; } };
  assert.match(goal('angle ACB is ninety'), /can't read the condition/);
  assert.match(goal('AB = 90 + angle A'), /one side is a length and the other an angle|can't add/);
  assert.match(goal('3 = 3'), /must measure something/);
});

test('goals: every kind of condition, with example solutions checked and starts that must not already meet them', () => {
  const ok = (spec, goal) => { const s = G.cleanSpec(spec, { drag: Object.keys(goal.solution), include: Object.values(goal.solution) }); return G.cleanGoal(goal, s); };
  const no = (spec, goal) => { try { ok(spec, goal); } catch (e) { assert.ok(e instanceof G.GeoError, e.message); return e.message; } return ''; };
  // an angle
  assert.deepEqual(ok(tri(), { all: ['angle ACB = 90'], solution: { C: [3, 3] } }), { all: ['angle ACB = 90'], solution: { C: [3, 3] } });
  assert.equal(no(tri(), { all: ['angle ACB = 90'], solution: { C: [4, 3] } }), 'the example solution puts C at (4, 3), where angle ACB is 86.8°, not 90°');
  assert.match(no(tri({ points: { A: [0, 0], B: [6, 0], C: [3, 3] } }), { all: ['angle ACB = 90'], solution: { C: [3, 3] } }), /the start already meets the goal/);
  // isosceles, PA = PB, an area
  ok(tri(), { all: ['ABC isosceles'], solution: { C: [3, 4] } });
  ok({ points: { A: [0, 0], B: [6, 0], P: [1, 4] }, objects: [{ type: 'segment', of: 'PA' }, { type: 'segment', of: 'PB' }], grid: true }, { all: ['PA = PB'], solution: { P: [3, 5] } });
  ok(tri(), { all: ['area ABC = 15'], solution: { C: [9, 5] } });
  assert.match(no(tri(), { all: ['area ABC = 15'], solution: { C: [9, 4] } }), /area ABC is 12, not 15/);
  // on a circle; parallel and perpendicular; a parallelogram, a rectangle, a square
  ok({ points: { O: [0, 0], A: [5, 0], P: [1, 1] }, objects: [{ type: 'circle', center: 'O', through: 'A', name: 'c' }], grid: true, x: [-6, 6], y: [-6, 6] }, { all: ['P on c'], solution: { P: [3, 4] } });
  const quad = { points: { A: [0, 0], B: [4, 0], C: [5, 3], D: [2, 4] }, objects: [{ type: 'polygon', of: 'ABCD' }], grid: true };
  ok(quad, { all: ['AB parallel CD'], solution: { D: [1, 3] } });
  ok(quad, { all: ['ABCD parallelogram'], solution: { D: [1, 3] } });
  ok(quad, { all: ['ABCD rectangle'], solution: { C: [4, 3], D: [0, 3] } });
  ok(quad, { all: ['ABCD square'], solution: { C: [4, 4], D: [0, 4] } });
  ok(quad, { all: ['AD perpendicular AB'], solution: { D: [0, 4] } });
  assert.match(no(quad, { all: ['ABCD parallelogram'], solution: { D: [1, 4] } }), /ABCD is not a parallelogram/);
  const quad5 = { points: { A: [0, 0], B: [5, 0], C: [7, 3], D: [2, 4] }, objects: [{ type: 'polygon', of: 'ABCD' }], grid: true };
  ok(quad5, { all: ['ABCD rhombus'], solution: { C: [8, 4], D: [3, 4] } });
  assert.match(no(quad5, { all: ['ABCD rhombus'], solution: { C: [7, 4], D: [2, 4] } }), /not a rhombus/);
  ok(quad5, { all: ['ABCD trapezium'], solution: { C: [6, 4] } });
  ok(quad5, { all: ['ABCD kite'], solution: { C: [7, 7], D: [0, 5] } });
  ok({ points: { O: [0, 0], A: [5, 0], B: [0, 5], C: [-5, 0], D: [2, 2] }, objects: [{ type: 'circle', center: 'O', radius: 5, name: 'c' }, { type: 'polygon', of: 'ABCD' }], grid: true, x: [-6, 6], y: [-6, 6], drag: ['D'] }, { all: ['ABCD cyclic'], solution: { D: [3, -4] } });
});

test('goals: congruent and similar triangles, ratios, collinear points, several conditions at once', () => {
  const two = { points: { A: [0, 0], B: [3, 0], C: [0, 4], D: [6, 0], E: [8, 1], F: [6, 3] }, objects: [{ type: 'polygon', of: 'ABC' }, { type: 'polygon', of: 'DEF' }], drag: ['E', 'F'], grid: true, x: [-1, 13], y: [-1, 9] };
  const s = G.cleanSpec(two);
  G.cleanGoal({ all: ['ABC congruent DEF'], solution: { E: [9, 0], F: [6, 4] } }, s);
  G.cleanGoal({ all: ['ABC similar DEF', 'DE/AB = 2'], solution: { E: [12, 0], F: [6, 8] } }, s);
  assert.match((() => { try { G.cleanGoal({ all: ['ABC similar DEF', 'DE/AB = 2'], solution: { E: [9, 0], F: [6, 4] } }, s); } catch (e) { return e.message; } return ''; })(), /DE\/AB is 1, not 2/);
  const line = G.cleanSpec({ points: { A: [0, 0], B: [2, 2], C: [5, 1] }, drag: ['C'], grid: true, x: [-1, 6], y: [-1, 5] });
  G.cleanGoal({ all: ['A, B, C collinear'], solution: { C: [4, 4] } }, line);
  // the learner's attempt: right, wrong (with what is off), or nothing yet
  const goal = G.cleanGoal({ all: ['ABC congruent DEF'], solution: { E: [9, 0], F: [6, 4] } }, s);
  assert.equal(G.check(s, goal, { E: [9, 0], F: [6, 4] }).correct, true);
  assert.equal(G.check(s, goal, { E: [6, 3], F: [10, 0] }).correct, true, 'turned over, still congruent');
  const wrong = G.check(s, goal, { E: [9, 0], F: [6, 5] });
  assert.equal(wrong.correct, false);
  assert.equal(wrong.fail.cond.kind, 'congruent');
  assert.deepEqual(G.check(s, goal, null), { correct: false, invalid: true });
  assert.deepEqual(G.check(s, goal, { Z: [1, 1] }), { correct: false, invalid: true }, 'only the dragged points count');
});

test('solutions the learner could not reach are errors that say so', () => {
  const s = G.cleanSpec(tri());
  const msg = (goal) => { try { G.cleanGoal(goal, s); } catch (e) { return e.message; } return ''; };
  assert.match(msg({ all: ['angle ACB = 90'], solution: { C: [3.5, 3] } }), /C moves in steps of 1, so it can't be at \(3\.5, 3\)/);
  assert.match(msg({ all: ['angle ACB = 90'], solution: { A: [3, 3] } }), /A is not one of the points the learner drags \(C\)/);
  assert.match(msg({ all: ['angle ACB = 90'], solution: { C: [30, 3] } }), /outside the view/);
  assert.match(msg({ all: ['angle ACB = 90'] }), /needs "solution"/);
  assert.match(msg({ solution: { C: [3, 3] } }), /needs "all"/);
  const glide = G.cleanSpec({ points: { O: [0, 0], A: [5, 0], P: { at: [0, 5], on: 'c' }, B: [-5, 0] }, objects: [{ type: 'circle', center: 'O', through: 'A', name: 'c' }], drag: ['P'], x: [-6, 6], y: [-6, 6] });
  assert.match((() => { try { G.cleanGoal({ all: ['PA = PB'], solution: { P: [2, 2] } }, glide); } catch (e) { return e.message; } return ''; })(), /P stays on c, and \(2, 2\) is not on it/);
});

test('strict spec checks: names, loops, sizes, the view, things that are not there', () => {
  const why = (spec) => { try { G.cleanSpec(spec); return ''; } catch (e) { assert.ok(e instanceof G.GeoError, e.message); return e.message; } };
  assert.match(why(null), /must be an object/);
  assert.match(why({ points: {} }), /at least one point/);
  assert.match(why({ points: { a: [0, 0] } }), /can't be a point's name/);
  assert.match(why({ points: { A: [0, 'x'] } }), /two numbers/);
  assert.match(why({ points: { A: [0, 1e9] } }), /too far out/);
  assert.match(why(tri({ objects: [{ type: 'segment', of: ['A', 'Z'] }] })), /there is no point Z/);
  assert.match(why(tri({ objects: [{ type: 'hexacle', of: 'AB' }] })), /unknown type/);
  assert.match(why(tri({ objects: [{ type: 'circle', center: 'A' }] })), /"through"|"radius"/);
  assert.match(why(tri({ objects: [{ type: 'midpoint', of: 'AB', name: 'A' }] })), /named twice/);
  assert.match(why({ points: { A: [0, 0], B: [4, 0], P: { at: [1, 1], on: 'l' } }, objects: [{ type: 'perpendicular', through: 'P', to: 'AB', name: 'l' }] }), /in a loop/);
  assert.match(why({ points: { A: [0, 0], B: [4, 0], C: [1, 3], D: [5, 3] }, objects: [{ type: 'intersection', of: ['AB', 'CD'], name: 'P' }] }), /parallel at the start/);
  assert.match(why({ points: { O: [0, 0], A: [3, 0], P: [1, 0] }, objects: [{ type: 'circle', center: 'O', through: 'A', name: 'c' }, { type: 'tangent', from: 'P', to: 'c' }] }), /P is inside the circle/);
  assert.match(why({ points: { O: [0, 0], A: [3, 0], B: [0, 3] }, objects: [{ type: 'circle', center: 'O', through: 'A', name: 'c' }, { type: 'circle', center: 'B', radius: 3, name: 'k' }, { type: 'intersection', of: ['c', 'k'], name: 'X' }] }), /meet at two places.* add "near"/);
  assert.match(why(tri({ x: [0, 5] })), /B is at \(6, 0\), outside the view/);
  assert.match(why(tri({ x: [-1, 7], y: [-1, 5], objects: [{ type: 'translate', of: 'ABC', by: [40, 0] }] })), /A' is at \(40, 0\), outside the view/);
  assert.match(why(tri({ drag: ['M'], objects: [{ type: 'midpoint', of: 'AB', name: 'M' }] })), /M is made from other points/);
  assert.match(why(tri({ objects: [{ type: 'segment', of: 'AA' }] })), /appears twice/);
  assert.match(why({ points: { A: [0, 0], B: [0, 0] }, objects: [{ type: 'segment', of: 'AB' }] }), /A and B are at the same place/);
  assert.match(why({ points: Object.fromEntries('ABCDEFGHIJKLMNOPQ'.split('').map((k, i) => [k, [i, 0]])) }), /too many points/);
  assert.match(why(tri({ objects: Array.from({ length: 31 }, () => ({ type: 'segment', of: 'AB' })) })), /too many objects/);
  assert.match(why(tri({ objects: [{ type: 'tangent', at: 'C', to: 'c' }, { type: 'circle', center: 'A', radius: 2, name: 'c' }] })), /C is not on c/);
  // leniency where it is safe: types and names as people write them, a view made to fit, a board's shape kept sensible
  const s = G.cleanSpec({ points: { A: [0, 0], B: [4, 0], C: [0, 3] }, objects: [{ type: 'Triangle', of: 'ABC' }, { type: 'line_segment', from: 'B', to: 'C', color: 'Orange', length: true }, { type: 'mid-point', of: 'BC', name: 'M' }, { type: 'Circle', centre: 'M', through: 'B', name: 'C1' }] });
  assert.deepEqual(s.objects.map((o) => o.type), ['polygon', 'segment', 'midpoint', 'circle']);
  assert.equal(s.objects[1].color, 'gold');
  assert.equal(s.objects[3].name, 'c1');
  assert.ok(s.x[0] <= -1 && s.x[1] >= 4.5 && s.y[0] <= -1 && s.y[1] >= 4, 'the view holds every point and the whole circle');
  assert.ok((s.y[1] - s.y[0]) <= 1.2 * (s.x[1] - s.x[0]) + 1e-9);
  assert.deepEqual(G.cleanSpec(s), s, 'cleaning it again changes nothing');
});

test('the server: blocks, tasks and why, through server/widgets.mjs', () => {
  const spec = tri({ objects: [{ type: 'polygon', of: ['A', 'B', 'C'] }, { type: 'angle', at: 'C', from: 'A', to: 'B' }], measure: ['angle ACB'] });
  assert.equal(normWidgetBlock({ t: 'widget', kind: 'geometry', spec, caption: 'Drag C.' }).kind, 'geometry');
  assert.equal(normWidgetBlock({ t: 'widget', kind: 'geometry', spec: { ...spec, drag: [] } }), null, 'nothing to drag: only a picture');
  assert.match(geometry.why({ ...spec, drag: [] }), /a block needs a point to drag/);
  const q = normTask({ type: 'task', kind: 'geometry', spec: { ...spec, drag: undefined }, goal: { all: ['angle ACB = 90'], solution: { C: [3, 3] } } }, { prompt: 'Make it right.', hint: '', explain: '' });
  assert.equal(q.type, 'task');
  assert.deepEqual(q.spec.drag, ['C'], 'the solution says which points are dragged');
  assert.equal(normTask({ type: 'task', kind: 'geometry', spec, goal: { all: ['angle ACB = 90'], solution: { C: [4, 3] } } }, { prompt: 'x' }), null);
  assert.equal(geometry.why(spec, { all: ['angle ACB = 90'], solution: { C: [4, 3] } }), 'the example solution puts C at (4, 3), where angle ACB is 86.8°, not 90°');
  assert.equal(geometry.why(spec), '');
  assert.equal(geometry.why(spec, { all: ['angle ACB = 90'], solution: { C: [3, 3] } }), '');
  // a solution outside the spec's own points widens the view to hold it
  const far = geometry.task(tri(), { all: ['area ABC = 24'], solution: { C: [2, 8] } });
  assert.ok(far.spec.y[1] >= 8);
  assert.equal(geometry.task('nonsense', {}), null);
  assert.equal(geometry.block({ points: 5 }), null);
});

test('the prompt is short and exact, and its examples pass its own checks', () => {
  assert.ok(geometry.prompt.length < 4300, `${geometry.prompt.length} characters`);
  assert.ok(geometry.prompt.split('\n').filter((l) => !l.startsWith('Example')).join('\n').length < 3000, 'the instructions themselves');
  for (const w of ['"kind": "geometry"', '"points"', '"objects"', '"drag"', '"measure"', '"solution"', '"all"', '"intersection"', '"near"', 'angle ACB = 90', 'AB parallel CD']) assert.ok(geometry.prompt.includes(w), w);
  const line = (k) => JSON.parse(geometry.prompt.split('\n').find((l) => l.startsWith(k)).slice(k.length));
  const block = line('Example block: '), task = line('Example task: ');
  assert.equal(geometry.why(block.spec), '');
  assert.equal(geometry.why(task.spec, task.goal), '');
  assert.equal(normWidgetBlock(block).kind, 'geometry');
  assert.equal(normTask(task, { prompt: task.prompt, hint: task.hint, explain: task.explain }).kind, 'geometry');
  assert.ok(widgetPrompt(['geometry']).includes('Geometry board ("kind": "geometry")'));
  assert.equal(typeof geometry.label, 'string');
});

test('match: geometry in English and the languages Primer serves, and not lookalikes', () => {
  const yes = [
    'Class 9: triangles and congruence', 'Circle theorems', 'lines and angles', 'the pythagoras theorem', 'quadrilaterals', 'area of a triangle',
    'parallel lines and a transversal', 'constructions with ruler and compass', 'similar triangles', 'tangents to a circle', 'coordinate geometry: the distance formula',
    'angles in maths', 'symmetry and reflection of shapes', 'chords and arcs of a circle', 'heights and distances', 'the perpendicular bisector',
    'ज्यामिति', 'त्रिभुज', 'कोण और रेखाएँ (गणित)', 'वृत्त की जीवा और स्पर्श रेखा', 'चतुर्भुज', 'समांतर रेखाएँ', 'त्रिभुजों की सर्वांगसमता', 'पाइथागोरस प्रमेय',
    'ত্রিভুজ', 'জ্যামিতি', 'முக்கோணங்கள்', 'வடிவியல்', 'త్రిభుజాలు', 'ತ್ರಿಭುಜಗಳು', 'ത്രികോണങ്ങൾ', 'ત્રિકોણ', 'ਤ੍ਰਿਭੁਜ', 'ତ୍ରିଭୁଜ', 'متوازی الاضلاع', 'متوازي الأضلاع',
    'geometría: triángulos', 'teorema de pitágoras', 'géométrie du triangle', 'le théorème de thalès', 'triângulos e ângulos em matemática', 'геометрия: треугольники', 'теорема пифагора'
  ];
  const no = [
    'the angle of approach in a story', 'a circle of friends', 'the love triangle in the novel', 'guitar chords for beginners', 'the french revolution',
    'photosynthesis', 'geometric progressions', 'the reflection of light in mirrors', 'crop rotation in farming', 'translation of hindi poems', 'series and parallel circuits',
    'new angles on marketing', 'world war ii', 'fractions and decimals', 'the rotation of the earth', 'congruence modulo n', 'मुगल साम्राज्य', 'la revolución francesa', 'фотосинтез',
    'angle', 'circle', 'rural areas'
  ];
  for (const s of yes) assert.equal(geometry.match(s.toLowerCase()), true, s);
  for (const s of no) assert.equal(geometry.match(s.toLowerCase()), false, s);
  assert.ok(widgetKinds({ topic: 'Class 9 maths', title: 'Triangles and congruence' }).includes('geometry'));
  assert.ok(!widgetKinds({ topic: 'The French Revolution' }).includes('geometry'));
});

test('labels go to the translator and come back into the spec', () => {
  const spec = G.cleanSpec(tri({ objects: [{ type: 'polygon', of: 'ABC', label: 'triangle' }, { type: 'segment', of: 'AB', label: 'base' }], measure: [{ of: 'angle A + angle B + angle C', label: 'sum of the angles' }, 'AB'] }));
  assert.deepEqual(geometry.texts(spec), ['triangle', 'base', 'sum of the angles']);
  assert.deepEqual(widgetTexts('geometry', spec), ['triangle', 'base', 'sum of the angles']);
  const hi = widgetWithTexts('geometry', spec, ['त्रिभुज', 'आधार', 'कोणों का योग']);
  assert.equal(hi.objects[0].label, 'त्रिभुज');
  assert.equal(hi.objects[1].label, 'आधार');
  assert.equal(hi.measure[0].label, 'कोणों का योग');
  assert.equal(hi.measure[0].of, 'angle A + angle B + angle C', 'the maths is never touched');
  assert.equal(geometry.withTexts(spec, ['one']), null, 'a list of the wrong length keeps the original');
  assert.deepEqual(geometry.texts(G.cleanSpec(tri())), []);
});
