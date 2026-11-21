// The graph widget: its expression parser (assets/js/widgets/graph-expr.js), its spec and goal checks, and
// the server module (server/widgets/graph.mjs) that the lesson writer uses.   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../assets/js/widgets/graph-expr.js';
import * as graph from '../server/widgets/graph.mjs';
import { normWidgetBlock, normTask, widgetKinds, widgetPrompt } from '../server/widgets.mjs';

const ev = (src, scope = {}) => G.evaluate(src, scope);
const near = (a, b, eps = 1e-9, msg = '') => { if (typeof eps === 'string') { msg = eps; eps = 1e-9; } assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b} ${msg}`); };
const fails = (src, vars, re) => assert.throws(() => G.compile(src, vars), (e) => e instanceof G.ExprError && (!re || re.test(e.message)), src);

/* ---------- the parser ---------- */

test('precedence and associativity: powers right to left, unary minus below powers', () => {
  assert.equal(ev('1 + 2*3'), 7);
  assert.equal(ev('(1 + 2)*3'), 9);
  assert.equal(ev('2*3^2'), 18);
  assert.equal(ev('2^3^2'), 512);
  assert.equal(ev('-2^2'), -4);
  assert.equal(ev('(-2)^2'), 4);
  assert.equal(ev('2^-1'), 0.5);
  assert.equal(ev('10/2/5'), 1);
  assert.equal(ev('2 - 3 - 4'), -5);
  assert.equal(ev('--3'), 3);
  assert.equal(ev('+3 - -2'), 5);
  assert.equal(ev('2**3'), 8, 'a ** for powers, as some write');
});

test('implicit multiplication: 2x, 3(x+1), 2sin(x), (x+1)(x-1), 2pi, ax', () => {
  assert.equal(ev('2x', { x: 3 }), 6);
  assert.equal(ev('2 x', { x: 3 }), 6);
  assert.equal(ev('3(x+1)', { x: 1 }), 6);
  near(ev('2sin(x)', { x: Math.PI / 2 }), 2);
  assert.equal(ev('(x+1)(x-1)', { x: 3 }), 8);
  near(ev('2pi'), 2 * Math.PI);
  assert.equal(ev('ax^2 + b', { a: 2, b: 1, x: 3 }), 19, 'ax is a times x: a power binds first');
  assert.equal(ev('2x/4', { x: 2 }), 1, 'a product reads left to right with /');
  assert.equal(ev('x(x+1)', { x: 2 }), 6);
  assert.equal(ev('2|x|', { x: -3 }), 6);
  assert.equal(ev('|x - 3| + |x|', { x: 1 }), 3);
  near(ev('sin x cos x', { x: 0.3 }), Math.sin(0.3) * Math.cos(0.3));
  near(ev('sin 2x', { x: 0.3 }), Math.sin(0.6), 'sin 2x is sin(2x)');
  near(ev('sinx', { x: 0.3 }), Math.sin(0.3));
  near(ev('exp(x)', { x: 1 }), Math.E, 'exp is the function, not e*x*p');
});

test('functions and constants', () => {
  near(ev('sin(pi/2) + cos(pi) + tan(0)'), 0);
  near(ev('asin(1)'), Math.PI / 2);
  near(ev('acos(1) + atan(0)'), 0);
  assert.equal(ev('sqrt(16)'), 4);
  assert.equal(ev('abs(-3)'), 3);
  near(ev('ln(e)'), 1);
  near(ev('log(1000)'), 3, 'log is base 10');
  assert.equal(ev('exp(0)'), 1);
  assert.equal(ev('floor(2.7) + round(2.5)'), 5);
  assert.equal(ev('min(3, 1, 2) + max(3, 1, 2)'), 4);
  near(ev('sin^2(x) + cos^2(x)', { x: 0.7 }), 1);
  near(ev('sin^-1(1)'), Math.PI / 2, 'sin^-1 is arcsin');
  assert.equal(ev('(-8)^(1/3)'), -2, 'odd roots of negative numbers are real');
  assert.ok(Number.isNaN(ev('(-8)^(1/2)')), 'even roots of negative numbers are not');
  assert.ok(Number.isNaN(ev('sqrt(-1)')));
  assert.equal(ev('1/0'), Infinity, 'a division by zero is no error: the curve has a gap there');
});

test('what people (and the AI) type: unicode signs, y = in front, square brackets', () => {
  assert.equal(ev('x² − 1', { x: 3 }), 8);
  assert.equal(ev('2·x × 3 ÷ 2', { x: 2 }), 6);
  near(ev('π'), Math.PI);
  assert.equal(ev('√(x + 7)', { x: 9 }), 4);
  assert.equal(ev('y = 2x + 1', { x: 1 }), 3);
  assert.equal(ev('f(x) = x^3', { x: 2 }), 8);
  assert.equal(ev('[x + 1]*2', { x: 1 }), 4);
});

test('bad input gives a clear error', () => {
  fails('', ['x'], /empty/);
  fails('   ', ['x'], /empty/);
  fails('2 +', ['x'], /ends too soon/);
  fails('(1 + 2', ['x'], /without its "\)"/);
  fails('1 + 2)', ['x'], /without its "\("/);
  fails('2 3', ['x'], /missing operator/);
  fails('q + 1', ['x'], /unknown name "q"/);
  fails('foo(x)', ['x'], /unknown name/);
  fails('a*x', ['x'], /unknown name "a"/, 'a name that is not a slider');
  fails('x2', ['x'], /unknown name/);
  fails('\\frac{1}{2}', ['x'], /LaTeX/);
  fails('x = 1', ['x'], /"="/);
  fails('{x}', ['x'], /brace/);
  fails('sin', ['x'], /needs a value/);
  fails('sin()', ['x']);
  fails('min(1)', ['x'], /2 to 8/);
  fails('sqrt(1, 2)', ['x'], /one value/);
  fails('1.2.3', ['x'], /two decimal points/);
  fails('x # 2', ['x'], /can't be read/);
  fails('|x', ['x'], /partner/);
  fails('x'.repeat(161), ['x'], /longer than/);
  fails('('.repeat(40) + 'x' + ')'.repeat(40), ['x'], /nested too deeply/);
  fails('x'.repeat(120), ['x'], /too long/); // 120 x's in a row: 239 parts
  assert.throws(() => G.compile(42, ['x']), G.ExprError);
});

test('no code runs: names outside the fixed tables are errors, never lookups', () => {
  globalThis.__graphPwned = false;
  for (const src of ['constructor', '__proto__', 'toString', 'valueOf', 'prototype', 'this', 'window', 'globalThis', 'process', 'require',
    'alert(1)', 'eval("1")', 'Function("return 1")()', 'x.constructor', 'process.exit()', 'constructor.constructor("globalThis.__graphPwned = true")()',
    '`1`', '"1"', "'1'", 'x; 1', 'x => x', '[].map', 'import("fs")', 'Math.PI', 'new Date']) {
    assert.throws(() => G.compile(src, ['x']), G.ExprError, src);
  }
  assert.equal(globalThis.__graphPwned, false);
  delete globalThis.__graphPwned;
  // and no expression can reach an object's prototype through a slider's scope
  const f = G.compile('a + x', ['a', 'x']);
  assert.ok(Number.isNaN(f(Object.create(null))), 'missing values are NaN, not inherited');
  assert.deepEqual([...f.uses].sort(), ['a', 'x']);
  // the parser never calls eval or Function
  const src = String(G.compile).concat(String(G.parse), String(G.evaluate));
  assert.ok(!/\beval\s*\(|new Function|Function\s*\(/.test(src));
});

/* ---------- specs ---------- */

const QUAD = { x: [-6, 6], y: [-6, 10], params: [{ name: 'a', min: -3, max: 3, step: 0.5, value: 1, label: 'stretch' }, { name: 'k', min: -5, max: 5, step: 1, value: 0 }], plots: [{ expr: 'a*x^2 + k', color: 'blue', label: '\\(y = ax^2 + k\\)' }], points: [{ x: 0, y: 'k', label: 'vertex' }] };
const LINE = { x: [-5, 5], y: [-5, 10], params: [{ name: 'm', min: -4, max: 4, step: 0.5, value: 1 }, { name: 'c', min: -5, max: 5, step: 0.5, value: 0 }], plots: [{ expr: 'm*x + c' }], points: [{ x: 2, y: 5, color: 'red' }] };
const clone = (o) => JSON.parse(JSON.stringify(o));
const why = (spec, goal) => graph.explain(spec, goal);

test('a good spec comes back clean, and cleaning it again changes nothing', () => {
  const s = graph.block(QUAD);
  assert.deepEqual(s.x, [-6, 6]);
  assert.equal(s.params[0].name, 'a');
  assert.equal(s.params[1].label, '');
  assert.equal(s.plots[0].color, 'blue');
  assert.equal(s.points[0].y, 'k', 'a fixed point may follow a slider');
  assert.deepEqual(graph.block(clone(s)), s);
  const trig = graph.block({ x: ['-2*pi', '2*pi'], y: [-2, 2], xstep: 'pi/2', plots: ['sin(x)', { expr: 'tan(x)', colour: 'crimson' }], tangent: { plot: 0, x: 1 }, area: { from: 0, to: 'pi' } });
  near(trig.x[1], 2 * Math.PI);
  assert.deepEqual(trig.xpi, [1, 2]);
  assert.equal(trig.plots[1].color, 'red', 'colour names are mapped to the palette');
  assert.deepEqual(graph.block(clone(trig)), trig, 'pi ticks survive a second cleaning');
});

test('leniency where it is safe: defaults, a missing y window, start values put on the slider\'s steps', () => {
  const s = graph.block({ x: [-3, 3], params: [{ name: 'b', min: 0, max: 10, value: 3.14 }], plots: ['y = b*x'] });
  assert.equal(s.plots[0].expr, 'b*x');
  assert.equal(s.params[0].step, 0.1);
  assert.equal(s.params[0].value, 3.1);
  assert.ok(s.y[0] < 0 && s.y[1] > 0, 'an automatic y window around the curve');
  const p = graph.block({ x: [-5, 5], y: [-5, 5], points: [{ x: 1.3, y: 2, drag: true, snap: 0.5 }] });
  assert.deepEqual(p.points[0].snap, [0.5, 0.5]);
  assert.equal(p.points[0].x, 1.5, 'a draggable point starts on its snap');
  assert.equal(graph.block({ x: [-5, 5], y: [-5, 5], plots: ['x'], points: [{ x: 1, y: 1, drag: true }] }).points[0].snap[0], 0.5, 'default snap: a twentieth of the window');
});

test('strict checks: the window, sliders, expressions, points and sizes', () => {
  const bad = [
    [{ ...QUAD, x: [5, -5] }, /smaller to larger/],
    [{ ...QUAD, x: [0, 0] }, /smaller to larger/],
    [{ ...QUAD, x: [-1e7, 1e7] }, /too large/],
    [{ ...QUAD, x: 'wide' }, /\[min, max\]/],
    [{ ...QUAD, params: [{ ...QUAD.params[0], value: 7 }, QUAD.params[1]] }, /start value is outside/],
    [{ ...QUAD, params: [{ ...QUAD.params[0], min: 3, max: -3 }, QUAD.params[1]] }, /min must be less than max/],
    [{ ...QUAD, params: [{ ...QUAD.params[0], step: 0 }, QUAD.params[1]] }, /step must be/],
    [{ ...QUAD, params: [{ ...QUAD.params[0], step: 0.0001 }, QUAD.params[1]] }, /more than 2000 steps/],
    [{ ...QUAD, params: [{ ...QUAD.params[0], name: 'x' }, QUAD.params[1]] }, /can't be called "x"/],
    [{ ...QUAD, params: [{ ...QUAD.params[0], name: 'sin' }, QUAD.params[1]] }, /can't be called/],
    [{ ...QUAD, params: [{ ...QUAD.params[0], name: 'constructor' }, QUAD.params[1]] }, /name like|can't be called/],
    [{ ...QUAD, params: [QUAD.params[0], { ...QUAD.params[1], name: 'a' }] }, /two sliders/],
    [{ ...QUAD, params: [1, 2, 3, 4, 5] }, /more than 4 sliders/],
    [{ ...QUAD, plots: [{ expr: 'a*x^2 + q' }] }, /unknown name "q"/],
    [{ ...QUAD, plots: [{ expr: 'a x^2 \\cdot k' }] }, /LaTeX/],
    [{ ...QUAD, plots: [{ expr: '' }] }, /no expression/],
    [{ ...QUAD, plots: ['x', 'x', 'x', 'x', 'x'] }, /more than 4 curves/],
    [{ ...QUAD, plots: [{ expr: 'sqrt(-1 - x^2)' }] }, /no value over most of the window/],
    [{ ...QUAD, plots: [{ expr: 'ln(x - 5)' }] }, /no value over most/],
    [{ ...QUAD, plots: [{ expr: 'x^2 + 100' }] }, /outside the window/],
    [{ ...QUAD, points: [{ x: 9, y: 0 }] }, /outside the window/],
    [{ ...QUAD, points: [{ x: 0, y: 'q' }] }, /unknown name/],
    [{ ...QUAD, points: [{ x: 20, y: 0, drag: true }] }, /needs an x inside/],
    [{ ...QUAD, points: [{ x: 1, on: 3 }] }, /curve that isn't there/],
    [{ ...QUAD, points: Array.from({ length: 9 }, () => ({ x: 0, y: 0 })) }, /more than 8 points/],
    [{ ...QUAD, lines: [{ x: 1, y: 1 }] }, /needs x .* or y/],
    [{ ...QUAD, lines: [{ y: 50 }] }, /outside the window/],
    [{ ...QUAD, tangent: { plot: 0, x: 40 } }, /inside the window/],
    [{ x: [-2, 2], y: [-2, 2], plots: ['abs(x)'], tangent: { x: 0 } }, /smooth/],
    [{ ...QUAD, area: { from: 1, to: 1 } }, /wider/],
    [{ x: [-2, 2], y: [-5, 5], plots: ['1/x'], area: { from: -1, to: 1 } }, /no finite value/],
    [{ x: [-2, 2], y: [-2, 2] }, /nothing to draw/],
    [null, /object/],
    [[1, 2], /object/]
  ];
  for (const [spec, re] of bad) {
    const reason = why(spec);
    assert.ok(reason && re.test(reason), `${JSON.stringify(spec).slice(0, 90)} -> ${reason}`);
    assert.equal(graph.block(spec), null);
  }
});

test('curves with breaks and gaps are fine where they are seen: tan, 1/x, floor, sqrt', () => {
  for (const expr of ['tan(x)', '1/x', 'floor(x)', 'sqrt(x)', '1/(x - 1)', 'abs(x)/x', 'ln(x)']) {
    assert.equal(why({ x: [-5, 5], y: [-5, 5], plots: [expr] }), null, expr);
  }
});

/* ---------- goals ---------- */

test('params goals: values on the sliders\' steps, or any values through given points', () => {
  const spec = graph.block(LINE);
  const t = graph.task(LINE, { type: 'params', through: [[2, 5]] });
  assert.ok(t, why(LINE, { type: 'params', through: [[2, 5]] }));
  assert.deepEqual(t.goal, { type: 'params', through: [[2, 5]], plot: 0, tol: 0.15 });
  assert.deepEqual(G.meets(t.goal, { m: 2, c: 1 }, spec), { correct: true });
  assert.deepEqual(G.meets(t.goal, { m: 1.5, c: 2 }, spec), { correct: true });
  assert.deepEqual(G.meets(t.goal, { m: 1, c: 1 }, spec), { correct: false, miss: [2, 5] });
  assert.equal(G.meets(t.goal, { m: 'two', c: 1 }, spec).invalid, true);
  assert.equal(G.meets(t.goal, null, spec).invalid, true);
  const sol = G.solve(t.goal, spec);
  assert.ok(G.meets(t.goal, sol, spec).correct, 'the solution it finds is right');
  assert.equal(sol.m, 1, 'it stays near the start where it can');

  const v = graph.task(QUAD, { type: 'params', values: { a: 2, k: -1 } });
  assert.deepEqual(v.goal, { type: 'params', values: { a: 2, k: -1 } });
  const qs = graph.block(QUAD);
  assert.equal(G.meets(v.goal, { a: 2, k: -1 }, qs).correct, true);
  assert.equal(G.meets(v.goal, { a: 2.5, k: -1 }, qs).correct, false, 'the slider’s own step, no other');
  assert.deepEqual(graph.task(QUAD, { type: 'params', values: { a: 2 }, tol: 0.5 }).goal, { type: 'params', values: { a: 2 }, vtol: 0.5 });
  // a cleaned goal cleans to itself (course files are checked again on import)
  assert.deepEqual(graph.task(clone(v.spec), clone(v.goal)).goal, v.goal);
  const tv = graph.task(LINE, { type: 'params', values: { m: 2 }, through: [[0, 3]], vtol: 0.5 });
  assert.deepEqual(graph.task(clone(tv.spec), clone(tv.goal)).goal, tv.goal);
});

test('range goals: any value in a span, where several are right (as the AI needed it)', () => {
  // "set a so the parabola is narrower than y = x^2 and still opens upward"
  const spec = { x: [-6, 6], y: [-6, 10], params: [{ name: 'a', min: -3, max: 3, step: 0.5, value: 1 }], plots: ['a*x^2', 'x^2'] };
  const t = graph.task(spec, { type: 'params', range: { a: [1.5, 3] } });
  assert.deepEqual(t.goal, { type: 'params', range: { a: [1.5, 3] } });
  for (const [a, right] of [[1.5, true], [2, true], [3, true], [1, false], [-2, false]]) assert.equal(G.meets(t.goal, { a }, t.spec).correct, right, `a = ${a}`);
  assert.deepEqual(G.solve(t.goal, t.spec), { a: 2 }, 'a whole number near the start');
  assert.deepEqual(graph.task(clone(t.spec), clone(t.goal)).goal, t.goal);
  assert.match(why(spec, { type: 'params', range: { a: [1.1, 1.4] } }), /can't be reached/, 'no step of the slider is in it');
  assert.match(why(spec, { type: 'params', range: { a: [0.5, 1.5] } }), /already met/);
  assert.match(why(spec, { type: 'params', range: { a: [3, 1] } }), /\[low, high\]/);
  assert.match(why(spec, { type: 'params', values: { a: 2 }, range: { a: [1, 3] } }), /both a value and a range/);
  // combined with "through": a line through (2, 5) that rises steeply
  const line = graph.task(LINE, { type: 'params', range: { m: [2.5, 4] }, through: [[2, 5]] });
  const sol = G.solve(line.goal, line.spec);
  assert.ok(sol.m >= 2.5 && Math.abs(sol.m * 2 + sol.c - 5) < 1e-9, JSON.stringify(sol));
});

test('goals that can\'t be met, or are met already, are left out', () => {
  const cases = [
    [QUAD, { type: 'params', values: { a: 1.25 } }, /can't be reached/],
    [QUAD, { type: 'params', values: { a: 9 } }, /outside its slider/],
    [QUAD, { type: 'params', values: { z: 1 } }, /isn't there/],
    [QUAD, { type: 'params', values: { a: 1 } }, /already met/],
    [QUAD, { type: 'params' }, /needs "values", "range" or "through"/],
    [LINE, { type: 'params', through: [[2, 0.3]], tol: 0.01 }, /can't be reached/],
    [LINE, { type: 'params', through: [[2, 2]] }, /already met/],
    [LINE, { type: 'params', through: [[9, 5]] }, /outside the window/],
    [LINE, { type: 'params', through: [[2, 5]], tol: 5 }, /too loose/],
    [{ x: [-5, 5], y: [-5, 5], plots: ['x'] }, { type: 'params', values: { a: 1 } }, /needs sliders/],
    [{ x: [-5, 5], y: [-5, 5], params: [{ name: 'a', min: 0, max: 100, step: 0.05 }, { name: 'b', min: 0, max: 100, step: 0.05 }], plots: ['a*x + b - 50'] }, { type: 'params', through: [[1, 1]] }, /too many settings/],
    [LINE, { type: 'point', at: [1, 1] }, /draggable point/],
    [{ ...LINE, points: [{ x: 0, y: 0, drag: true, snap: 0.5 }] }, { type: 'point', at: [1.2, 1.2], tol: 0.05 }, /can't be reached/],
    [{ ...LINE, points: [{ x: 0, y: 0, drag: true }] }, { type: 'point', at: [0, 0] }, /already met/],
    [{ ...LINE, points: [{ x: 0, y: 0, drag: true }] }, { type: 'point', at: [9, 0] }, /outside the window/],
    [LINE, { type: 'x', at: 7 }, /outside the window/],
    [LINE, { type: 'x', at: 'soon' }, /needs "at"/],
    [LINE, { type: 'x', at: 1, tol: 3 }, /too loose/],
    [LINE, { type: 'jump' }, /type must be/],
    [LINE, 'x', /must be an object/]
  ];
  for (const [spec, goal, re] of cases) {
    const reason = why(spec, goal);
    assert.ok(reason && re.test(reason), `${JSON.stringify(goal)} -> ${reason}`);
    assert.equal(graph.task(spec, goal), null);
  }
});

test('point and x goals: any of several right places, within the snap', () => {
  const spec = { x: [-4, 5], y: [-5, 6], plots: ['x^2 - 2x - 3'], points: [{ x: 1, y: 3, label: 'P', drag: true, snap: 0.5 }] };
  const t = graph.task(spec, { type: 'point', point: 0, at: [[-1, 0], [3, 0]] });
  assert.deepEqual(t.goal, { type: 'point', point: 0, at: [[-1, 0], [3, 0]], tol: [0.25, 0.25] });
  assert.equal(G.meets(t.goal, { x: 3, y: 0 }, t.spec).correct, true);
  assert.equal(G.meets(t.goal, { x: -1, y: 0 }, t.spec).correct, true);
  assert.equal(G.meets(t.goal, { x: 2.5, y: 0 }, t.spec).correct, false);
  assert.deepEqual(G.solve(t.goal, t.spec), { x: -1, y: 0 });

  // a point that slides along the curve: its x decides
  const glide = graph.task({ x: [-3, 3], y: [-3, 3], plots: ['x^3 - 3x'], points: [{ x: -2, on: 0, drag: true, snap: 0.1 }] }, { type: 'point', at: [1, -2] });
  assert.ok(glide);
  assert.equal(G.meets(glide.goal, { x: 1, y: -2 }, glide.spec).correct, true);

  const x = graph.task({ x: [0, 6.3], y: [-1.5, 1.5], plots: ['sin(x)'] }, { type: 'x', at: 'pi/2' });
  near(x.goal.at[0], Math.PI / 2);
  assert.equal(G.meets(x.goal, { x: 1.6 }, x.spec).correct, true);
  assert.equal(G.meets(x.goal, { x: 2 }, x.spec).correct, false);
  assert.equal(G.meets(x.goal, {}, x.spec).invalid, true);
  // with a tangent, the tapped x is the tangent's, in its steps
  const flat = graph.task({ x: [-2, 4], y: [-3, 5], plots: ['x^2 - 2x'], tangent: { plot: 0, x: 3 } }, { type: 'x', at: 1, tol: 0.05 });
  assert.equal(flat.goal.snap, flat.spec.tangent.snap);
  assert.deepEqual(G.solve(flat.goal, flat.spec), { x: 1 });
});

test('a dragged point may be a slider\'s: dragging the vertex sets h and k (as the AI wrote it)', () => {
  const ai = { x: [-8, 8], y: [-8, 8], params: [{ name: 'h', min: -5, max: 5, step: 1, value: 0, label: 'h' }, { name: 'k', min: -5, max: 5, step: 1, value: 0, label: 'k' }], plots: [{ expr: '(x - h)^2 + k', color: 'blue' }], points: [{ x: 'h', y: 'k', label: 'vertex', drag: true, on: 0 }] };
  const s = graph.block(ai);
  assert.deepEqual(s.points[0], { label: 'vertex', color: 'red', drag: true, snap: [1, 1], x: 'h', on: 0 });
  assert.deepEqual(graph.block(clone(s)), s);
  const m = G.model(s);
  assert.deepEqual(m.pointAt(s.points[0], { h: 2, k: -3 }, { x: 'h', y: null }), { x: 2, y: -3 });
  assert.ok(graph.task(ai, { type: 'params', values: { h: 4, k: -2 } }));
  const free = { ...ai, points: [{ x: 'h', y: 'k', drag: true }] };
  const t = graph.task(free, { type: 'point', at: [3, -2] });
  assert.ok(t, why(free, { type: 'point', at: [3, -2] }));
  assert.deepEqual(G.solve(t.goal, t.spec), { x: 3, y: -2 });
  assert.match(why(free, { type: 'point', at: [3, -2.5], tol: 0.1 }), /can't be reached/, 'only the sliders\' steps');
  // placed by any other expression, a point can't be dragged: it follows the sliders
  assert.equal(graph.block({ ...ai, points: [{ x: '-h', y: 'k + 1', drag: true }] }).points[0].drag, false);
});

test('the model: slopes, areas and points that follow sliders', () => {
  const s = graph.block({ x: [-1, 4], y: [-2, 2], params: [{ name: 'b', min: 0, max: 3.2, step: 0.1, value: 3.1 }], plots: ['sin(x)'], area: { from: 0, to: 'b' }, tangent: { x: 0 } });
  const m = G.model(s);
  near(m.slope(0, 0, m.start()), 1, 1e-6);
  near(m.integral(0, 0, Math.PI, m.start()), 2, 1e-9);
  near(m.integral(0, 0, m.val('b', { b: 3.1 }), { b: 3.1 }), 1 - Math.cos(3.1), 1e-9);
  assert.ok(Number.isNaN(G.model(graph.block({ x: [-2, 2], y: [-2, 2], plots: ['abs(x)'] })).slope(0, 0, {})), 'no slope at a corner');
  const q = graph.block(QUAD), mq = G.model(q);
  assert.deepEqual(mq.pointAt(q.points[0], { a: 1, k: 3 }), { x: 0, y: 3 });
});

/* ---------- the server module and the core ---------- */

test('match: graphs and functions, in English and the languages Primer serves, and not lookalikes', () => {
  const yes = [
    'quadratic functions', 'algebra: linear equations', 'graphs of functions', 'the derivative of x^2 in calculus', 'introduction to calculus',
    'slope and y-intercept', 'trigonometry: the sine rule', 'exponential growth', 'logarithms', 'coordinate geometry', 'the parabola',
    'integration by substitution in calculus', 'velocity-time graphs in physics', 'supply and demand', 'polynomials',
    'functions and their graphs', 'gradient of a straight line in maths',
    'द्विघात समीकरण', 'फलन और ग्राफ', 'अवकलज', 'समाकलन', 'गणित: समीकरण', 'சார்பு மற்றும் வரைபடம்', 'இருபடி சமன்பாடுகள்', 'நுண்கணிதம்',
    'función cuadrática', 'funciones y gráficas', 'fonction affine', 'les fonctions et leur courbe en mathématiques', 'функция и график', 'квадратичная функция', 'производная',
    'دالة تربيعية', 'المشتقة', 'ত্রিকোণমিতি', 'త్రికోణమితి', 'ಬಹುಪದ', 'ത്രികോണമിതി', 'દ્વિઘાત', 'função quadrática', 'Ableitung'
  ];
  const no = [
    'the function of the liver', 'executive function in children', 'python functions', 'chemical equations', 'graph theory: vertices and edges',
    'an integral part of indian culture', 'financial derivatives', 'cell differentiation in biology', 'reading bar graphs', 'world war ii',
    'photosynthesis', 'prime numbers', 'fractions and decimals', 'verb inflection in grammar', 'european integration', 'shakespeare\'s sonnets',
    'मुगल साम्राज्य', 'நீர் சுழற்சி', 'la revolución francesa', 'la función del hígado', 'фотосинтез'
  ];
  for (const s of yes) assert.equal(graph.match(s.toLowerCase()), true, s);
  for (const s of no) assert.equal(graph.match(s.toLowerCase()), false, s);
  assert.equal(graph.match(''), false);
});

test('the prompt is short and exact, and its examples pass its own checks', () => {
  assert.ok(graph.prompt.length < 6000, `${graph.prompt.length} characters`);
  for (const word of ['"kind": "graph"', '"params"', '"plots"', '"points"', '"tangent"', '"area"', '"through"', '"type": "point"', '"type": "x"', 'never LaTeX', 'radians']) assert.ok(graph.prompt.includes(word), word);
  const line = (k) => JSON.parse(graph.prompt.split('\n').find((l) => l.startsWith(k)).slice(k.length));
  const block = line('Example block: ');
  assert.equal(why(block.spec), null);
  const task = line('Example task: ');
  assert.equal(why(task.spec, task.goal), null);
  // and through the core, as a lesson's block and checkpoint question
  assert.equal(normWidgetBlock(block).kind, 'graph');
  const q = normTask(task, { prompt: task.prompt, hint: task.hint, explain: task.explain });
  assert.equal(q.type, 'task');
  assert.deepEqual(q.goal, { type: 'params', through: [[2, 5]], plot: 0, tol: 0.15 });
  assert.equal(normWidgetBlock({ t: 'widget', kind: 'graph', spec: { x: [1, 0] } }), null);
  assert.ok(widgetKinds({ topic: 'Quadratic functions' }).includes('graph'));
  assert.ok(!widgetKinds({ topic: 'The French Revolution' }).includes('graph'));
  assert.ok(widgetPrompt(['graph']).includes('Graph ("kind": "graph")'));
  assert.equal(typeof graph.label, 'string');
});
