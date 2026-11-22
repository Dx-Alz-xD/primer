// The circuit widget: the DC solver (assets/js/widgets/circuit-core.js) and the server's checks of what
// the AI writes (server/widgets/circuit.mjs, through server/widgets.mjs).   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../assets/js/widgets/circuit-core.js';
import * as circuit from '../server/widgets/circuit.mjs';
import { normWidgetBlock, normTask, widgetKinds, widgetPrompt, widgetWhy } from '../server/widgets.mjs';

const near = (a, b, tol = 1e-4, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);

// a rectangle a-b-c-d with the cell on the left (d to a, so a is +)
const loop = (parts, extraNodes = {}, more = {}) => C.normSpec({ nodes: { a: [0, 0], b: [4, 0], c: [4, 3], d: [0, 3], ...extraNodes }, parts, ...more });

test('series: one current, the voltages add up, the meters read them', () => {
  const s = loop([
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 },
    { id: 'R1', type: 'resistor', from: 'a', to: 'b', value: 4 },
    { id: 'R2', type: 'resistor', from: 'b', to: 'c', value: 8 },
    { id: 'A1', type: 'ammeter', from: 'c', to: 'd' },
    { id: 'V1', type: 'voltmeter', from: 'b', to: 'c' }
  ]);
  const r = C.solve(s);
  assert.equal(r.short, null);
  near(r.read.A1, 0.5, 1e-5, 'I = 6 / 12');
  near(r.I.R1, 0.5, 1e-5);
  near(r.I.R2, 0.5, 1e-5);
  near(r.read.V1, 4, 1e-4, 'V across R2 = 0.5 x 8');
  near(r.I.B1, 0.5, 1e-5, 'the cell drives it');
  assert.ok(Math.abs(r.I.V1) < 1e-6, 'almost nothing through a voltmeter');
});

test('cells in series add; the same cells side by side share the current; different ones side by side are a short', () => {
  const two = C.normSpec({ nodes: { a: [0, 0], b: [4, 0], c: [4, 3], d: [0, 3], e: [0, 1.5] }, parts: [
    { id: 'B1', type: 'cell', from: 'd', to: 'e', value: 1.5 }, { id: 'B2', type: 'cell', from: 'e', to: 'a', value: 1.5 },
    { type: 'wire', from: 'a', to: 'b' }, { id: 'R1', type: 'resistor', from: 'b', to: 'c', value: 3 }, { id: 'A1', type: 'ammeter', from: 'c', to: 'd' }
  ] });
  near(C.solve(two).read.A1, 1, 1e-6, '3 V / 3 ohms');

  const side = (v2) => C.normSpec({ nodes: { a: [2, 0], b: [6, 0], c: [6, 3], d: [2, 3], e: [0, 0], f: [0, 3] }, parts: [
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 }, { id: 'B2', type: 'cell', from: 'f', to: 'e', value: v2 },
    { type: 'wire', from: 'e', to: 'a' }, { type: 'wire', from: 'f', to: 'd' },
    { id: 'R1', type: 'resistor', from: 'a', to: 'b', value: 6 }, { type: 'wire', from: 'b', to: 'c' }, { id: 'A1', type: 'ammeter', from: 'c', to: 'd' }
  ] });
  const r = C.solve(side(6));
  near(r.read.A1, 1, 1e-6);
  near(r.I.B1, 0.5, 1e-6, 'two equal cells share it');
  near(r.I.B2, 0.5, 1e-6);
  assert.throws(() => side(3), /short circuit/, 'a 6 V and a 3 V cell joined straight across');
});

test('parallel: each branch gets the whole voltage; bulbs in parallel stay bright, in series they dim', () => {
  const par = C.normSpec({ nodes: { a: [0, 0], b: [3, 0], c: [6, 0], d: [0, 4], e: [3, 4], f: [6, 4] }, parts: [
    { id: 'B1', type: 'battery', from: 'd', to: 'a', value: 6 }, { type: 'wire', from: 'a', to: 'b' },
    { id: 'L1', type: 'bulb', from: 'b', to: 'e', value: 12 }, { type: 'wire', from: 'b', to: 'c' },
    { id: 'L2', type: 'bulb', from: 'c', to: 'f', value: 12 }, { type: 'wire', from: 'f', to: 'e' }, { id: 'A1', type: 'ammeter', from: 'e', to: 'd' }
  ] });
  const r = C.solve(par);
  near(r.I.L1, 0.5, 1e-6);
  near(r.I.L2, 0.5, 1e-6);
  near(r.read.A1, 1, 1e-6, 'the branch currents add');
  near(r.glow.L1, 1, 1e-6, 'as bright as one bulb alone');
  assert.ok(r.lit.L1 && r.lit.L2);
  // the wire between the branches carries L2's share only
  const top = par.parts.find((p) => p.type === 'wire' && p.from === 'b' && p.to === 'c');
  near(Math.abs(r.I[top.id]), 0.5, 1e-6);

  const ser = loop([
    { id: 'B1', type: 'battery', from: 'd', to: 'a', value: 6 },
    { id: 'L1', type: 'bulb', from: 'a', to: 'b', value: 12 }, { id: 'L2', type: 'bulb', from: 'b', to: 'c', value: 12 }, { type: 'wire', from: 'c', to: 'd' }
  ]);
  const s = C.solve(ser);
  near(s.I.L1, 0.25, 1e-6);
  near(s.glow.L1, 0.25, 1e-6, 'a quarter of the power');
  assert.ok(s.lit.L1, 'dimmer, but still lit');
});

test('an open switch stops the current; a voltmeter across it reads the whole voltage', () => {
  const s = loop([
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 },
    { id: 'S1', type: 'switch', from: 'a', to: 'b', closed: false },
    { id: 'L1', type: 'bulb', from: 'b', to: 'c', value: 12 },
    { id: 'A1', type: 'ammeter', from: 'c', to: 'd' },
    { id: 'V1', type: 'voltmeter', from: 'a', to: 'b' }
  ]);
  const open = C.solve(s);
  assert.equal(open.lit.L1, false);
  assert.ok(open.read.A1 < 1e-6);
  near(open.read.V1, 6, 1e-3);
  const closed = C.solve(s, { s: { S1: true } });
  assert.equal(closed.lit.L1, true);
  near(closed.read.A1, 0.5, 1e-6);
  near(closed.read.V1, 0, 1e-9, 'nothing across a closed switch');
});

test('a short circuit: a warning, not numbers', () => {
  // S2 joins the cell's ends when it is closed
  const s = C.normSpec({ nodes: { a: [0, 0], b: [4, 0], c: [4, 3], d: [0, 3], e: [2, 0], f: [2, 3] }, parts: [
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 }, { type: 'wire', from: 'a', to: 'e' },
    { id: 'S2', type: 'switch', from: 'e', to: 'f', closed: false },
    { type: 'wire', from: 'e', to: 'b' }, { id: 'L1', type: 'bulb', from: 'b', to: 'c', value: 12 },
    { type: 'wire', from: 'c', to: 'f' }, { type: 'wire', from: 'f', to: 'd' }
  ] });
  assert.equal(C.solve(s).short, null);
  const r = C.solve(s, { s: { S2: true } });
  assert.ok(r.short, 'closing S2 shorts the cell');
  assert.deepEqual(r.short.cells, ['B1']);
  assert.ok(r.short.path.includes('S2'));
  assert.deepEqual(r.read, {});
  assert.deepEqual(r.lit, {});
  // an ammeter straight across a cell is a short too, and a circuit that starts shorted is left out
  assert.throws(() => loop([
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 }, { id: 'A1', type: 'ammeter', from: 'a', to: 'd' },
    { id: 'L1', type: 'bulb', from: 'a', to: 'b', value: 6 }, { type: 'wire', from: 'b', to: 'c' }, { type: 'wire', from: 'c', to: 'd' }
  ]), /short circuit/);
});

test('an LED lights one way only, with about 2 V across it', () => {
  const led = (from, to) => loop([
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 },
    { id: 'R1', type: 'resistor', from: 'a', to: 'b', value: 190 },
    { id: 'D1', type: 'led', from, to, color: 'green' },
    { id: 'A1', type: 'ammeter', from: 'c', to: 'd' },
    { id: 'V1', type: 'voltmeter', from: 'b', to: 'c' }
  ]);
  const fwd = C.solve(led('b', 'c'));
  assert.equal(fwd.lit.D1, true);
  near(fwd.read.A1, 4 / 200, 1e-5, '(6 - 2) / (190 + 10)');
  near(fwd.read.V1, 2 + 0.02 * 10, 1e-3);
  assert.deepEqual(fwd.burn, []);
  const back = C.solve(led('c', 'b'));
  assert.equal(back.lit.D1, false);
  assert.ok(back.read.A1 < 1e-6, 'no current the wrong way');
  near(back.read.V1, 6, 1e-3, 'it blocks the whole voltage');
  // straight across a cell with nothing to limit it: lit, and too much for a real one
  const bare = loop([{ id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 }, { id: 'D1', type: 'led', from: 'a', to: 'b' }, { type: 'wire', from: 'b', to: 'c' }, { type: 'wire', from: 'c', to: 'd' }]);
  assert.deepEqual(C.solve(bare).burn, ['D1']);
  // two in series need 4 V between them
  const two = (v) => C.normSpec({ nodes: { a: [0, 0], b: [3, 0], e: [6, 0], c: [6, 3], d: [0, 3] }, parts: [
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: v }, { id: 'D1', type: 'led', from: 'a', to: 'b' }, { id: 'D2', type: 'led', from: 'b', to: 'e' },
    { id: 'R1', type: 'resistor', from: 'e', to: 'c', value: 100 }, { type: 'wire', from: 'c', to: 'd' }
  ] });
  assert.equal(C.solve(two(3)).lit.D1, false);
  const ok = C.solve(two(6));
  assert.ok(ok.lit.D1 && ok.lit.D2);
  near(ok.I.R1, 2 / 120, 1e-6);
});

test('a part no cell can reach is floating: no current, and it is named', () => {
  // a bulb between two loose ends, beside a working loop (allowed only when loose ends are, as on paper)
  const s = C.normSpec({ nodes: { a: [0, 0], b: [4, 0], c: [4, 3], d: [0, 3], x: [6, 0], y: [6, 3] }, parts: [
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 }, { id: 'L1', type: 'bulb', from: 'a', to: 'b', value: 6 },
    { type: 'wire', from: 'b', to: 'c' }, { type: 'wire', from: 'c', to: 'd' }, { id: 'L2', type: 'bulb', from: 'x', to: 'y', value: 6 }
  ] }, { loose: true });
  const r = C.solve(s);
  assert.deepEqual(r.float, ['L2']);
  assert.equal(r.I.L2, 0);
  assert.equal(r.lit.L1, true);
});

test('a bulb with a closed switch beside it goes out', () => {
  const s = C.normSpec({ nodes: { a: [0, 0], b: [3, 0], c: [6, 0], d: [6, 3], e: [0, 3] }, parts: [
    { id: 'B1', type: 'cell', from: 'e', to: 'a', value: 6 },
    { id: 'L1', type: 'bulb', from: 'a', to: 'b', value: 6 }, { id: 'L2', type: 'bulb', from: 'b', to: 'c', value: 6 },
    { id: 'S1', type: 'switch', from: 'b', to: 'c', closed: false },
    { type: 'wire', from: 'c', to: 'd' }, { type: 'wire', from: 'd', to: 'e' }
  ] });
  const r = C.solve(s, { s: { S1: true } });
  assert.equal(r.lit.L2, false, 'S1 takes the current round L2');
  near(r.I.L1, 1, 1e-6, 'L1 has the whole 6 V now');
  near(r.I.S1, 1, 1e-6);
});

test('block(): a circuit is checked and cleaned; anything that does not hold together is left out', () => {
  const good = {
    nodes: { a: [0, 0], b: [4, 0], c: [4, 3], d: [0, 3] },
    parts: [
      { id: 'B1', type: 'Battery', from: 'd', to: 'a', voltage: '6 V', extra: 'dropped' },
      { id: 'S1', type: 'key', from: 'a', to: 'b', state: 'open' },
      { id: 'R1', type: 'lamp', from: 'b', to: 'c', value: '1 kΩ' },
      { type: 'wire', id: 'whatever', from: 'c', to: 'd' }
    ],
    labels: [{ at: [2, 1.5], text: 'a ‮loop‬<b>' }, { at: [40, 40], text: 'off the page' }],
    colour: 'not kept'
  };
  const out = circuit.block(good);
  assert.deepEqual(out, {
    nodes: { a: [0, 0], b: [4, 0], c: [4, 3], d: [0, 3] },
    parts: [
      { id: 'B1', type: 'battery', from: 'd', to: 'a', value: 6 },
      { id: 'S1', type: 'switch', from: 'a', to: 'b', closed: false },
      { id: 'R1', type: 'bulb', from: 'b', to: 'c', value: 1000 },
      { id: '~1', type: 'wire', from: 'c', to: 'd' }
    ],
    controls: [{ part: 'S1' }], // every switch, when none are named
    labels: [{ at: [2, 1.5], text: 'a loop <b>' }]
  });
  assert.deepEqual(circuit.block(out), out, 'checking it again changes nothing');

  const bad = (change, why) => {
    const s = structuredClone(good);
    change(s);
    assert.equal(circuit.block(s), null, why);
    assert.ok(circuit.why(s), 'it says why');
  };
  bad((s) => { s.parts[1].type = 'capacitor'; }, 'unknown part');
  bad((s) => { s.parts[2].type = 'resistor'; }, 'nothing to see: no bulb, LED or meter');
  bad((s) => { s.parts[2].to = 'z'; }, 'a node that does not exist');
  bad((s) => { s.parts[2].value = -5; }, 'a negative resistance');
  bad((s) => { s.parts[2].value = 1e9; }, 'too large');
  bad((s) => { delete s.parts[0].voltage; }, 'a cell with no voltage');
  bad((s) => { s.parts[0].type = 'resistor'; s.parts[0].value = 5; }, 'no cell at all');
  bad((s) => { s.parts.pop(); }, 'a loose end');
  bad((s) => { s.parts[2].id = 'S1'; }, 'two parts with one id');
  bad((s) => { s.parts[2].from = 'c'; }, 'a part joining a node to itself');
  bad((s) => { s.nodes.b = [0, 0]; }, 'two nodes at one point');
  bad((s) => { s.nodes.b = [11, 0]; }, 'off the grid');
  bad((s) => { s.parts[3] = { id: 'S2', type: 'switch', from: 'c', to: 'd', closed: true }; s.parts[2] = { type: 'wire', from: 'b', to: 'c' }; s.parts[1].closed = true; }, 'a short circuit as it starts');
  bad((s) => { s.controls = ['R1']; }, 'a bulb control with no slider range');
  bad((s) => { s.controls = [{ part: 'R1', min: 10, max: 5000, step: 1 }]; }, 'too many slider steps');
  bad((s) => { s.controls = ['X9']; }, 'a control for a part that is not there');
  bad((s) => { for (let i = 0; i < 17; i++) s.parts.push({ id: 'R' + (i + 10), type: 'resistor', from: 'b', to: 'c', value: 10 }); }, 'more than 16 parts');
  bad((s) => { s.nodes.e = [8, 0]; s.nodes.f = [8, 3]; s.parts.push({ id: 'B2', type: 'cell', from: 'e', to: 'f', value: 1.5 }, { type: 'wire', from: 'e', to: 'f' }); }, 'two separate circuits');
  assert.equal(circuit.block(null), null);
  assert.equal(circuit.block({ nodes: 'a', parts: [] }), null);
  assert.equal(circuit.block({ nodes: { toString: [0, 0] }, parts: [{ id: 'B1', type: 'cell', from: 'valueOf', to: 'toString', value: 1 }] }), null, 'no prototype names');
});

test('sliders: values on their steps, within the type\'s range', () => {
  const s = loop([
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 },
    { id: 'R1', type: 'resistor', from: 'a', to: 'b', value: 5 },
    { type: 'wire', from: 'b', to: 'c' }, { id: 'A1', type: 'ammeter', from: 'c', to: 'd' }
  ], {}, { controls: [{ part: 'R1', min: 2, max: 21, step: 2 }, 'R1'] });
  assert.deepEqual(s.controls, [{ part: 'R1', min: 2, max: 20, step: 2 }], 'the top falls on a step; a repeat is ignored');
  assert.equal(s.parts[1].value, 6, '5 moves to the nearest step');
  near(C.solve(s, { v: { R1: 12 } }).read.A1, 0.5, 1e-6);
  near(C.solve(s, { v: { R1: 12.9 } }).read.A1, 0.5, 1e-6, 'an attempt off the steps is put on one');
  near(C.solve(s, { v: { R1: 99 } }).read.A1, 0.3, 1e-6, 'or inside the range');
  near(C.solve(s, { v: { B1: 12 } }).read.A1, 1, 1e-6, 'what the learner may not change stays');
});

const parallelTask = () => ({
  nodes: { a: [0, 0], b: [3, 0], c: [6, 0], d: [0, 4], e: [3, 4], f: [6, 4] },
  parts: [
    { id: 'B1', type: 'battery', from: 'd', to: 'a', value: 6 }, { id: 'S1', type: 'switch', from: 'a', to: 'b' },
    { id: 'L1', type: 'bulb', from: 'b', to: 'e', value: 12 }, { id: 'S2', type: 'switch', from: 'b', to: 'c' },
    { id: 'L2', type: 'bulb', from: 'c', to: 'f', value: 12 }, { type: 'wire', from: 'f', to: 'e' }, { id: 'A1', type: 'ammeter', from: 'e', to: 'd' }
  ]
});

test('task(): a light goal must be reachable by the switches and not met at the start', () => {
  const t = circuit.task(parallelTask(), { type: 'light', on: ['L1'] });
  assert.deepEqual(t.goal, { type: 'light', on: ['L1'], off: ['L2'] }, 'the other lamps must be off');
  assert.deepEqual(C.solution(t.spec, t.goal), { s: { S1: true, S2: false }, v: {}, w: null });
  assert.equal(C.check(t.spec, t.goal, { s: { S1: true } }).correct, true);
  const both = C.check(t.spec, t.goal, { s: { S1: true, S2: true } });
  assert.equal(both.correct, false);
  assert.deepEqual(both.why, { lamp: 'L2', want: false });
  assert.equal(C.check(t.spec, t.goal, 'nonsense').invalid, true);

  assert.equal(circuit.task(parallelTask(), { type: 'light', on: ['L2'], off: ['L1'] }), null, 'L2 can never light without L1');
  assert.match(circuit.why(parallelTask(), { type: 'light', on: ['L2'], off: ['L1'] }), /no setting/);
  const lit = parallelTask(); lit.parts[1].closed = true;
  assert.equal(circuit.task(lit, { type: 'light', on: ['L1'] }), null, 'already done as it starts');
  assert.equal(circuit.task(parallelTask(), { type: 'light', on: ['Z9'] }), null, 'a lamp that is not there');
  assert.equal(circuit.task(parallelTask(), { type: 'light', on: ['A1'] }), null, 'a meter is not a lamp');
  assert.equal(circuit.task(parallelTask(), { type: 'dance' }), null, 'an unknown goal');
  assert.equal(circuit.task({ ...parallelTask(), controls: [] }, { type: 'light', on: ['L1'] }), null, 'nothing to change');
  const both2 = circuit.task(parallelTask(), { type: 'light', on: ['L1', 'L2'] });
  assert.deepEqual(C.solution(both2.spec, both2.goal).s, { S1: true, S2: true });
});

test('task(): a reading goal is reached by a slider step or a switch', () => {
  const spec = {
    nodes: { a: [0, 0], b: [4, 0], c: [4, 3], d: [0, 3] },
    parts: [
      { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 }, { id: 'A1', type: 'ammeter', from: 'a', to: 'b' },
      { id: 'R1', type: 'resistor', from: 'b', to: 'c', value: 4 }, { type: 'wire', from: 'c', to: 'd' }
    ],
    controls: [{ part: 'R1', min: 2, max: 20, step: 2 }]
  };
  const t = circuit.task(spec, { type: 'reading', meter: 'A1', value: '500 mA' });
  assert.deepEqual(t.goal, { type: 'reading', meter: 'A1', value: 0.5, tolerance: 0.01 });
  assert.deepEqual(C.solution(t.spec, t.goal).v, { R1: 12 });
  assert.equal(C.check(t.spec, t.goal, { v: { R1: 12 } }).correct, true);
  const off = C.check(t.spec, t.goal, { v: { R1: 10 } });
  assert.equal(off.correct, false);
  near(off.why.got, 0.6, 1e-6);
  assert.equal(circuit.task(spec, { type: 'reading', meter: 'A1', value: 0.7 }), null, 'no step gives 0.7 A');
  assert.equal(circuit.task(spec, { type: 'reading', meter: 'A1', value: 1.5 }), null, 'met as it starts');
  assert.equal(circuit.task(spec, { type: 'reading', meter: 'R1', value: 0.5 }), null, 'a resistor is not a meter');
});

test('task(): a connect goal needs a wire that works and others that don\'t', () => {
  // the wire from p to q is missing; r sits on the circuit as a wrong choice
  const spec = {
    nodes: { a: [0, 0], p: [2, 0], q: [4, 0], c: [4, 3], r: [2, 3], d: [0, 3] },
    parts: [
      { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 3 }, { type: 'wire', from: 'a', to: 'p' },
      { id: 'L1', type: 'bulb', from: 'q', to: 'c', value: 6 }, { type: 'wire', from: 'c', to: 'r' }, { type: 'wire', from: 'r', to: 'd' }
    ]
  };
  assert.equal(circuit.block(spec), null, 'with its loose ends it is no block');
  const t = circuit.task(spec, { type: 'connect', terminals: ['p', 'q', 'r'] });
  assert.ok(t);
  assert.deepEqual(t.goal, { type: 'connect', terminals: ['p', 'q', 'r'], on: ['L1'], off: [] });
  assert.deepEqual(t.spec.controls, []);
  assert.deepEqual(C.solution(t.spec, t.goal).w, ['p', 'q']);
  assert.equal(C.check(t.spec, t.goal, { w: ['q', 'p'] }).correct, true);
  assert.deepEqual(C.check(t.spec, t.goal, { w: ['p', 'r'] }).why, { short: true }, 'p to r shorts the cell');
  assert.equal(C.check(t.spec, t.goal, { w: [] }).invalid, true, 'no wire yet');
  assert.equal(C.check(t.spec, t.goal, { w: ['p', 'zz'] }).invalid, true, 'not a terminal');
  assert.equal(circuit.task(spec, { type: 'connect', terminals: ['p', 'q'] }), null, 'two terminals leave nothing to choose');
  assert.equal(circuit.task(spec, { type: 'connect', terminals: ['p', 'r', 'd'] }), null, 'no pair of these works');
});

test('the solver is quick enough to try every setting', () => {
  const s = C.normSpec(parallelTask());
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) C.solve(s, { s: { S1: i % 2 === 0, S2: i % 3 === 0 } });
  assert.ok(performance.now() - t0 < 2000);
});

test('through server/widgets.mjs: blocks, tasks and the lessons that are offered the circuit', () => {
  const b = normWidgetBlock({ t: 'widget', kind: 'circuit', spec: parallelTask(), caption: 'Close S1, then S2.' });
  assert.equal(b.kind, 'circuit');
  assert.equal(b.caption, 'Close S1, then S2.');
  assert.equal(normWidgetBlock({ t: 'widget', kind: 'circuit', spec: { nodes: {}, parts: [] } }), null);
  const q = normTask({ type: 'task', kind: 'circuit', spec: parallelTask(), goal: { type: 'light', on: ['L1'] } }, { prompt: 'Light only L1.', hint: '', explain: '' });
  assert.equal(q.type, 'task');
  assert.deepEqual(q.goal.on, ['L1']);
  assert.ok(widgetKinds({ topic: 'Physics', title: 'Electric current and Ohm\'s law' }).includes('circuit'));
  assert.ok(!widgetKinds({ topic: 'World history', title: 'The French Resistance' }).includes('circuit'));
  assert.match(widgetPrompt(['circuit']), /"kind": "circuit"/);
});

test('match(): electricity in the languages Primer serves, and not circuit training or current affairs', () => {
  const yes = [
    'electricity', 'ohm\'s law', 'series and parallel circuits', 'resistors in series', 'kirchhoff\'s laws', 'potential difference and voltage',
    'simple circuits with a battery and a bulb', 'leds and diodes', 'the electric circuit',
    'विद्युत धारा', 'परिपथ', 'सर्किट', 'विद्युत परिपथ और प्रतिरोध', 'ओम का नियम', 'धारा और प्रतिरोध',
    'மின்சுற்று', 'মৌলিক বর্তনী', 'বিদ্যুৎ', 'విద్యుత్ వలయాలు', 'വൈദ്യുതി', 'بجلی کا سرکٹ',
    'circuito eléctrico', 'la electricidad', 'le circuit électrique', 'loi d\'ohm', 'электрическая цепь', 'закон ома', 'دائرة كهربائية', 'التيار الكهربائي',
    'corrente elétrica'
  ];
  for (const s of yes) assert.ok(circuit.match(s.toLowerCase()), `should match: ${s}`);
  const no = [
    'circuit training for beginners', 'the french resistance', 'current affairs', 'the electric guitar', 'cell biology', 'the mughal empire',
    'arithmetic series', 'parallel lines and angles', 'monaco racing circuit', 'धारा 370', 'antibiotic resistance', 'tv series'
  ];
  for (const s of no) assert.ok(!circuit.match(s.toLowerCase()), `should not match: ${s}`);
});

test('texts() and withTexts(): only the notes and part names go to the translator, and come back in place', () => {
  const s = circuit.block({ ...parallelTask(), labels: [{ at: [3, 2], text: 'two branches' }] });
  s.parts[2].label = 'Bulb A';
  assert.deepEqual(circuit.texts(s), ['two branches', 'Bulb A']);
  const t = circuit.withTexts(s, ['दो शाखाएँ', 'बल्ब ‮A']);
  assert.equal(t.labels[0].text, 'दो शाखाएँ');
  assert.equal(t.parts[2].label, 'बल्ब A', 'no direction-changing characters');
  assert.equal(t.parts[2].id, 'L1', 'ids stay');
  assert.equal(s.labels[0].text, 'two branches', 'the original is not changed');
  assert.equal(circuit.withTexts(s, ['one']), null, 'a different number of words keeps the original');
  assert.deepEqual(circuit.texts(circuit.block(parallelTask())), []);
});

test('the prompt\'s own examples pass the checks', () => {
  const blocks = [...circuit.prompt.matchAll(/Block example: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]));
  const tasks = [...circuit.prompt.matchAll(/Task example: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 1);
  assert.equal(tasks.length, 1);
  assert.ok(normWidgetBlock(blocks[0]), circuit.why(blocks[0].spec));
  assert.ok(normTask(tasks[0], { prompt: tasks[0].prompt, hint: '', explain: '' }), circuit.why(tasks[0].spec, tasks[0].goal));
  assert.ok(circuit.prompt.length < 6000, 'short enough');
});

test('a block with nothing to try gets a slider on a value; one with no value to change is left out', async () => {
  const circuit = await import('../server/widgets/circuit.mjs');
  const still = { nodes: { a: [0, 0], b: [4, 0], c: [4, 3], d: [0, 3] }, parts: [
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 3 },
    { id: 'L1', type: 'bulb', from: 'a', to: 'b', value: 10 },
    { id: 'L2', type: 'bulb', from: 'b', to: 'c', value: 10 },
    { type: 'wire', from: 'c', to: 'd' }] };
  // no switch and no controls: the first bulb gets a slider, around the value it was written with
  const b = circuit.block(still);
  assert.deepEqual(b.controls, [{ part: 'L1', min: 2.5, max: 30, step: 2.5 }]);
  assert.equal(b.parts.find((p) => p.id === 'L1').value, 10);
  // a resistor is preferred; a circuit of a cell and an LED gets one on the cell
  const withR = { ...still, parts: [...still.parts.slice(0, 2), { id: 'R1', type: 'resistor', from: 'b', to: 'c', value: 200 }, still.parts[3]] };
  assert.deepEqual(circuit.block(withR).controls, [{ part: 'R1', min: 50, max: 600, step: 50 }]);
  const led = { nodes: still.nodes, parts: [still.parts[0], { id: 'D1', type: 'led', from: 'a', to: 'b' }, { type: 'wire', from: 'b', to: 'c' }, still.parts[3]] };
  assert.equal(circuit.block(led).controls[0].part, 'B1');
  // a switch, even with "controls" left out, is something to try
  const withSwitch = { ...still, parts: [...still.parts.slice(0, 3), { id: 'S1', type: 'switch', from: 'c', to: 'd', closed: true }] };
  assert.deepEqual(circuit.block(withSwitch).controls, [{ part: 'S1' }]);
  assert.equal(circuit.why(still), '', 'why() agrees with block()');
});

/* ---------------- build mode: the learner places the parts ---------------- */

// a build from short lists: ['R1', 'resistor', [0, 0], [1, 0], 4] or ['wire', [0, 0], [1, 0]]
const parts = (...xs) => xs.map((x) => (x[0] === 'wire' ? { type: 'wire', from: x[1], to: x[2] }
  : { id: x[0], type: x[1], from: x[2], to: x[3], ...(typeof x[4] === 'number' ? { value: x[4] } : {}), ...(typeof x[4] === 'boolean' ? { closed: x[4] } : {}) }));
const build = (spec, ...xs) => C.readBuild(spec, parts(...xs), true);
const sandbox = (palette, more = {}) => C.normSpec({ build: true, palette, ...more });

test('build mode: the spec, its palette and its fixed parts, checked and cleaned', () => {
  const s = C.normSpec({
    build: true, grid: [5, 3], nodes: { P: [0, 1], Q: [5, 1] },
    parts: [{ id: 'B1', type: 'battery', from: [0, 3], to: 'P', value: '6 V' }, { type: 'lamp', from: [5, 1], to: [5, 3] }, { type: 'wire', from: [0, 3], to: [2, 3], locked: false }],
    palette: { resistor: [4, 4, { count: 1, values: [2, 6] }], bulb: 1, 'light emitting diode': ['green'], wire: 6, key: true },
    resistance: ['P', 'Q']
  });
  assert.equal(s.build, true);
  assert.deepEqual(s.grid, [5, 3]);
  assert.deepEqual(s.parts, [
    { id: 'B1', type: 'battery', from: [0, 3], to: [0, 1], value: 6, locked: true },
    { id: 'L1', type: 'bulb', from: [5, 1], to: [5, 3], value: 10, locked: true }, // named after the others, a bulb's default 10 ohms
    { id: '~1', type: 'wire', from: [0, 3], to: [2, 3], locked: false }
  ]);
  assert.deepEqual(s.palette, [
    { type: 'resistor', ids: ['R1', 'R2'], values: [4] }, // the same resistor twice is one group
    { type: 'resistor', ids: ['R3'], values: [2, 6] },    // a choice
    { type: 'bulb', ids: ['L2'], values: [10] },          // numbered after the spec's own L1
    { type: 'led', ids: ['D1'], color: 'green' },
    { type: 'switch', ids: ['S1'] },
    { type: 'wire', count: 6 }
  ]);
  assert.deepEqual(s.resistance, ['P', 'Q']);
  assert.deepEqual(C.normSpec(s), s, 'checking it again changes nothing');
  assert.deepEqual(C.pools(s).wires, 7, 'the palette\'s wires and the spec\'s movable one');
  // a palette alone says build mode; wires default to plenty; the grid to 6 by 4
  const p = C.normSpec({ palette: { cell: [3], bulb: 1 } });
  assert.deepEqual(C.normSpec({ palette: { cells: [3], bulbs: 2, switches: 1, batteries: [6] } }).palette.map((g) => g.type), ['cell', 'bulb', 'switch', 'battery', 'wire'], 'plurals');
  assert.equal(p.build, true);
  assert.deepEqual(p.grid, [6, 4]);
  assert.deepEqual(p.palette.at(-1), { type: 'wire', count: 30 });
  // through the server: a sandbox is a block as it is (no slider added), and needs something to see
  assert.deepEqual(circuit.block({ build: true, palette: { cell: [3], bulb: 2 } }).palette.length, 3);
  assert.equal(circuit.block({ build: true, palette: { resistor: 3 } }), null, 'nothing to see and no source');
  assert.match(circuit.why({ build: true, palette: { resistor: 3 } }), /nothing to see/);
  assert.ok(circuit.block({ build: true, nodes: { P: [0, 0], Q: [3, 0] }, resistance: ['P', 'Q'], palette: { resistor: 3 } }), 'a resistance readout is something to see');
  assert.equal(circuit.why({ build: true, palette: { cell: [3], bulb: 2 } }), '');
});

test('build mode: what may go where on the grid', () => {
  const s = C.normSpec({ build: true, grid: [4, 3], nodes: { P: [2, 3] }, palette: { cell: [6], resistor: [4, 4, 4], voltmeter: 1, wire: 10 } });
  const R = (from, to, id = 'Rx') => ({ id, type: 'resistor', from, to });
  const Wr = (from, to) => ({ id: '~x', type: 'wire', from, to });
  const on = [R([0, 0], [2, 0], 'R1'), Wr([0, 1], [3, 1])];
  assert.equal(C.placeWhy(s, on, R([0, 2], [5, 2])), 'off');
  assert.equal(C.placeWhy(s, on, R([1, 2], [1, 2])), 'same');
  assert.equal(C.placeWhy(s, on, R([0, 2], [1, 3])), 'bent', 'parts go along a row or a column');
  assert.equal(C.placeWhy(s, on, R([1, 0], [1, 1])), 'covered', 'an end on the middle of R1');
  assert.equal(C.placeWhy(s, on, Wr([1, 0], [1, 2])), 'covered', 'a wire across the middle of R1');
  assert.equal(C.placeWhy(s, on, R([1, 3], [3, 3])), 'covered', 'over the labelled dot P');
  assert.equal(C.placeWhy(s, on, R([1, 0], [3, 0])), 'overlap', 'along part of R1');
  assert.equal(C.placeWhy(s, on, Wr([2, 1], [3, 1])), 'overlap', 'along part of a wire');
  assert.equal(C.placeWhy(s, on, R([1, 1], [1, 2])), '', 'a part may end on the middle of a wire: they join there');
  assert.equal(C.placeWhy(s, on, Wr([2, 0], [2, 2])), '', 'a wire may cross a wire (they join)');
  const across = { id: 'V1', type: 'voltmeter', from: [2, 0], to: [0, 0] };
  assert.equal(C.placeWhy(s, on, across), '', 'a voltmeter on R1\'s two ends, drawn alongside');
  assert.equal(C.placeWhy(s, on.concat(across), R([0, 0], [2, 0])), 'full', 'two parts per span at most');
  assert.equal(C.placeWhy(s, on, Wr([3, 1], [0, 1])), 'full', 'a second wire on the same span');
  assert.equal(C.placeWhy(s, on, R([0, 0], [2, 0], 'R1'), 'R1'), '', 'a part being moved ignores itself');
  // a wire turns one corner, where there is room
  assert.deepEqual(C.wireRoute(s, on, [3, 0], [4, 2]), [[[3, 0], [4, 0]], [[4, 0], [4, 2]]]);
  assert.deepEqual(C.wireRoute(s, on, [3, 0], [1, 2]), [[[3, 0], [3, 2]], [[3, 2], [1, 2]]], 'the other corner, when the first runs along R1');
  assert.equal(C.wireRoute(s, on, [1, 0], [3, 2]), null, 'from the middle of R1: nowhere');
});

test('build mode: a build is solved as it is built', () => {
  const s = sandbox({ cell: [6], resistor: [4, 8], ammeter: 1, voltmeter: 1, wire: 6 });
  const open = build(s, ['B1', 'cell', [0, 2], [0, 0]], ['R1', 'resistor', [0, 0], [2, 0], 4], ['R2', 'resistor', [2, 0], [2, 2], 8], ['A1', 'ammeter', [2, 2], [1, 2]]);
  const r0 = C.solveBuild(s, open);
  assert.equal(r0.open, true, 'a gap: no current');
  assert.equal(r0.total, 0);
  // close the loop with a wire, and put the voltmeter across R2
  const done = build(s, ['B1', 'cell', [0, 2], [0, 0]], ['R1', 'resistor', [0, 0], [2, 0], 4], ['R2', 'resistor', [2, 0], [2, 2], 8], ['A1', 'ammeter', [2, 2], [1, 2]],
    ['wire', [1, 2], [0, 2]], ['V1', 'voltmeter', [2, 2], [2, 0]]);
  const r = C.solveBuild(s, done);
  assert.equal(r.short, null);
  assert.equal(r.open, false);
  near(r.read.A1, 0.5, 1e-4, '6 V / 12 ohms');
  near(r.read.V1, 4, 1e-3, '0.5 A x 8 ohms');
  near(r.total, 0.5, 1e-4);
  assert.deepEqual(r.misplaced, []);
  // a wire straight across the cell: a short circuit
  const shorted = C.readBuild(s, parts(['B1', 'cell', [0, 2], [0, 0]], ['wire', [0, 0], [0, 2]], ['R1', 'resistor', [0, 0], [1, 0], 4]), true);
  assert.ok(C.solveBuild(s, shorted).short);
  // wires that cross join: the current goes from one to the other
  const s2 = sandbox({ cell: [3], bulb: 1, wire: 6 });
  const cross = build(s2, ['B1', 'cell', [0, 3], [0, 1]], ['wire', [0, 1], [3, 1]], ['wire', [2, 0], [2, 2]], ['L1', 'bulb', [2, 2], [2, 3]], ['wire', [2, 3], [0, 3]]);
  assert.equal(C.solveBuild(s2, cross).lit.L1, true);
  // and a crossing that joins + to - is a short circuit
  assert.ok(C.solveBuild(s2, build(s2, ['B1', 'cell', [0, 2], [0, 0]], ['wire', [0, 0], [2, 0]], ['wire', [1, 0], [1, 3]], ['wire', [2, 2], [0, 2]])).short);
  // two cells in series: their current is the total
  const s3 = sandbox({ cell: [1.5, 1.5], resistor: [3], wire: 6 });
  const two = build(s3, ['B1', 'cell', [0, 2], [0, 1]], ['B2', 'cell', [0, 1], [0, 0]], ['R1', 'resistor', [0, 0], [2, 0]], ['wire', [2, 0], [2, 2]], ['wire', [2, 2], [0, 2]]);
  near(C.solveBuild(s3, two).total, 1, 1e-9, '3 V / 3 ohms');
});

test('build mode: the learner\'s build is read leniently; an answer strictly', () => {
  const s = C.normSpec({ build: true, grid: [4, 2], parts: [{ id: 'B1', type: 'cell', from: [0, 2], to: [0, 0], value: 3 }, { id: 'S1', type: 'switch', from: [0, 0], to: [1, 0] }], palette: { bulb: 1, wire: 2 } });
  // a learner's value: the fixed parts stay where the spec has them (only the switch counts), extra parts are left out
  const b = C.readBuild(s, { parts: [{ id: 'S1', type: 'switch', from: [3, 0], to: [4, 0], closed: true }, { id: 'L1', type: 'bulb', from: [1, 0], to: [2, 0] }, { id: 'L9', type: 'bulb', from: [2, 1], to: [3, 1] },
    { type: 'wire', from: [2, 0], to: [2, 2] }, { type: 'wire', from: [2, 2], to: [0, 2] }, { type: 'wire', from: [3, 0], to: [3, 2] }] }, false);
  assert.deepEqual(b.map((p) => p.id), ['B1', 'S1', 'L1', '~w1', '~w2']);
  assert.deepEqual(b[1].from, [0, 0], 'S1 did not move');
  assert.equal(b[1].closed, true, 'but it closed');
  assert.equal(C.solveBuild(s, b).lit.L1, true);
  assert.equal(C.readBuild(s, 'nonsense', false), null);
  // strictly, the same build says what is wrong
  assert.throws(() => C.readBuild(s, [{ id: 'S1', type: 'switch', from: [3, 0], to: [4, 0] }], true), /S1 is fixed in the spec/);
  assert.throws(() => C.readBuild(s, [{ type: 'bulb', from: [1, 0], to: [2, 0] }, { type: 'bulb', from: [2, 0], to: [3, 0] }], true), /more bulbs than the palette has \(1\)/);
  assert.throws(() => C.readBuild(s, [{ type: 'resistor', from: [1, 0], to: [2, 0] }], true), /uses a resistor, but the palette has none/);
  assert.throws(() => C.readBuild(s, [{ type: 'wire', from: [1, 0], to: [4, 0] }, { type: 'wire', from: [1, 1], to: [4, 1] }, { type: 'wire', from: [1, 2], to: [4, 2] }], true), /more wires than the palette has \(2\)/);
  assert.throws(() => C.readBuild(s, [{ type: 'bulb', from: [1, 0], to: [2, 1] }], true), /not along a row or a column/);
  assert.throws(() => C.readBuild(s, [{ type: 'bulb', from: [0, 1], to: [1, 1] }], true), /crosses the middle of another part/);
  assert.throws(() => C.readBuild(s, [{ type: 'bulb', from: [1, 0], to: [9, 0] }], true), /off the grid/);
  // parts the spec places but doesn't lock: an answer may move them; a learner may take them away and put them back
  const m = C.normSpec({ build: true, grid: [4, 2], locked: false, parts: [{ id: 'B1', type: 'cell', from: [0, 2], to: [0, 0], value: 3, locked: true }, { id: 'L1', type: 'bulb', from: [1, 0], to: [2, 0] }], palette: { wire: 4 } });
  assert.deepEqual(m.parts.map((p) => p.locked), [true, false]);
  assert.deepEqual(C.pools(m).groups.map((g) => g.ids), [['L1']], 'L1 is in the pool');
  const moved = C.readBuild(m, [{ id: 'L1', type: 'bulb', from: [1, 0], to: [1, 2] }, { type: 'wire', from: [0, 0], to: [1, 0] }, { type: 'wire', from: [1, 2], to: [0, 2] }], true);
  assert.deepEqual(moved.find((p) => p.id === 'L1').to, [1, 2]);
  assert.equal(C.solveBuild(m, moved).lit.L1, true);
  assert.equal(C.readBuild(m, { parts: [{ id: 'B1', type: 'cell', from: [0, 2], to: [0, 0] }] }, false).length, 1, 'the learner took L1 away');
});

test('topology: series and parallel, whatever the layout', () => {
  const s = sandbox({ cell: [6], bulb: 3, resistor: [4, 4, 4], ammeter: 1, switch: 1, wire: 20 }, { grid: [6, 4] });
  // a ladder: L1 and L2 each across the rails, R1 in the supply line
  const ladder = build(s, ['B1', 'cell', [0, 3], [0, 0]], ['R1', 'resistor', [0, 0], [1, 0]], ['wire', [1, 0], [4, 0]], ['L1', 'bulb', [2, 0], [2, 3]],
    ['A1', 'ammeter', [4, 0], [4, 1]], ['L2', 'bulb', [4, 1], [4, 3]], ['wire', [0, 3], [4, 3]]);
  const net = C.netOf(ladder, 'goal');
  assert.equal(C.inParallel(net, 'L1', 'L2'), true, 'the ammeter in L2\'s branch doesn\'t change that');
  assert.equal(C.inSeries(net, 'L1', 'L2'), false);
  assert.equal(C.inSeries(net, 'R1', 'B1'), true, 'R1 carries the whole current, as the cell does');
  assert.equal(C.inSeries(net, 'R1', 'L1'), false);
  assert.equal(C.inSeries(C.netOf(ladder, 'amm'), 'A1', 'L2'), true, 'the ammeter is in series with L2');
  assert.equal(C.inSeries(C.netOf(ladder, 'amm'), 'A1', 'L1'), false);
  // one loop, drawn crookedly: in series
  const loop = build(s, ['B1', 'cell', [0, 3], [0, 0]], ['L1', 'bulb', [0, 0], [1, 0]], ['wire', [1, 0], [3, 2]], ['L2', 'bulb', [3, 2], [3, 3]], ['wire', [3, 3], [0, 3]]);
  const n2 = C.netOf(loop, 'goal');
  assert.equal(C.inSeries(n2, 'L1', 'L2'), true);
  assert.equal(C.inParallel(n2, 'L1', 'L2'), false);
  // a wire across L2 shorts it: L2 is in neither any more
  const bypass = C.readBuild(s, parts(['B1', 'cell', [0, 3], [0, 0]], ['L1', 'bulb', [0, 0], [1, 0]], ['wire', [1, 0], [3, 2]], ['L2', 'bulb', [3, 2], [3, 3]], ['wire', [3, 3], [0, 3]], ['wire', [3, 2], [3, 3]]), true);
  assert.equal(C.inSeries(C.netOf(bypass, 'goal'), 'L1', 'L2'), false);
  assert.equal(C.solveBuild(s, bypass).lit.L2, false);
  // R1 + (R2 || R3)
  const mixed = build(s, ['B1', 'cell', [0, 2], [0, 0]], ['R1', 'resistor', [0, 0], [1, 0]], ['wire', [1, 0], [1, 1]], ['R2', 'resistor', [1, 0], [2, 0]], ['R3', 'resistor', [1, 1], [2, 1]],
    ['wire', [2, 0], [2, 2]], ['wire', [2, 2], [0, 2]]);
  const n3 = C.netOf(mixed, 'goal');
  assert.equal(C.inParallel(n3, 'R2', 'R3'), true);
  assert.equal(C.inSeries(n3, 'R1', 'B1'), true);
  assert.equal(C.inSeries(n3, 'R1', 'R2'), false);
  // an open switch takes a branch away; closed, it is just a join
  const sw = (closed) => build(s, ['B1', 'cell', [0, 3], [0, 0]], ['wire', [0, 0], [3, 0]], ['L1', 'bulb', [1, 0], [1, 3]], ['S1', 'switch', [3, 0], [3, 1], closed], ['L2', 'bulb', [3, 1], [3, 3]], ['wire', [0, 3], [3, 3]]);
  assert.equal(C.inParallel(C.netOf(sw(true), 'goal'), 'L1', 'L2'), true);
  assert.equal(C.inParallel(C.netOf(sw(false), 'goal'), 'L1', 'L2'), false);
});

test('equivalent resistance between two labelled dots', () => {
  const s = C.normSpec({ build: true, grid: [4, 2], nodes: { P: [0, 1], Q: [4, 1] }, resistance: ['P', 'Q'], palette: { resistor: { count: 5, value: 4 }, cell: [6], wire: 12 } });
  const R = (...xs) => C.resistanceBetween(s, build(s, ...xs), 'P', 'Q');
  assert.equal(R(), Infinity, 'nothing between them');
  near(R(['R1', 'resistor', [0, 1], [1, 1]], ['R2', 'resistor', [1, 1], [2, 1]], ['R3', 'resistor', [2, 1], [3, 1]], ['wire', [3, 1], [4, 1]]), 12, 1e-9, 'three in series');
  near(R(['wire', [0, 0], [0, 2]], ['R1', 'resistor', [0, 0], [4, 0]], ['R2', 'resistor', [0, 1], [4, 1]], ['R3', 'resistor', [0, 2], [4, 2]], ['wire', [4, 0], [4, 2]]), 4 / 3, 1e-7, 'three in parallel');
  const six = build(s, ['R1', 'resistor', [0, 1], [1, 1]], ['wire', [1, 0], [1, 2]], ['R2', 'resistor', [1, 0], [2, 0]], ['R3', 'resistor', [1, 2], [2, 2]], ['wire', [2, 0], [2, 2]], ['wire', [2, 1], [4, 1]]);
  near(C.resistanceBetween(s, six, 'P', 'Q'), 6, 1e-9, '4 + 4 || 4');
  assert.deepEqual(C.seriesParallel(s, six, 'P', 'Q'), { text: 'R1 + (R2 ∥ R3)', ohms: 6 });
  near(C.solveBuild(s, six).ohms, 6, 1e-9, 'the live readout');
  assert.equal(R(['wire', [0, 1], [4, 1]]), 0, 'joined by a wire');
  // a cell between them is taken out, as for an ohmmeter
  assert.equal(R(['B1', 'cell', [0, 1], [0, 0]], ['R1', 'resistor', [0, 0], [4, 0]], ['wire', [4, 0], [4, 1]]), Infinity, 'only through the cell');
  // a bridge is not series-parallel, but still has a resistance: 1, 2 / 2, 1 with 4 across the middle
  const s5 = C.normSpec({ build: true, grid: [4, 2], nodes: { P: [0, 1], Q: [4, 1] }, resistance: ['P', 'Q'], palette: { resistor: [1, 2, 2, 1, 4], wire: 6 } });
  const bridge = C.readBuild(s5, parts(['wire', [0, 0], [0, 2]], ['R1', 'resistor', [0, 0], [2, 0], 1], ['R2', 'resistor', [0, 2], [2, 2], 2], ['R3', 'resistor', [2, 0], [4, 0], 2], ['R4', 'resistor', [2, 2], [4, 2], 1],
    ['R5', 'resistor', [2, 0], [2, 2], 4], ['wire', [4, 0], [4, 2]]), true);
  // by hand: P (a), the top middle (b), the bottom middle (c), Q at 0 volts, one ampere in at P
  const g = (r) => 1 / r;
  const A = [[g(1) + g(2), -g(1), -g(2)], [-g(1), g(1) + g(2) + g(4), -g(4)], [-g(2), -g(4), g(2) + g(1) + g(4)]];
  const rhs = [1, 0, 0];
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const f = A[j][i] / A[i][i]; for (let k = i; k < 3; k++) A[j][k] -= f * A[i][k]; rhs[j] -= f * rhs[i]; }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) { let t = rhs[i]; for (let k = i + 1; k < 3; k++) t -= A[i][k] * x[k]; x[i] = t / A[i][i]; }
  near(C.resistanceBetween(s5, bridge, 'P', 'Q'), x[0], 1e-6, 'an unbalanced bridge');
  assert.equal(C.seriesParallel(s5, bridge, 'P', 'Q'), null);
});

test('meters in the wrong place are caught: an ammeter across a part, a voltmeter in series', () => {
  const s = sandbox({ cell: [6], resistor: [4, 8], ammeter: 1, voltmeter: 1, wire: 10 });
  const base = [['B1', 'cell', [0, 2], [0, 0]], ['R1', 'resistor', [0, 0], [2, 0]], ['R2', 'resistor', [2, 0], [2, 2]]];
  const across = build(s, ...base, ['wire', [2, 2], [0, 2]], ['A1', 'ammeter', [0, 0], [2, 0]]);
  assert.deepEqual(C.meterProblems(across), [{ id: 'A1', type: 'ammeter', across: 'R1' }]);
  near(C.solveBuild(s, across).read.A1, 0.75, 1e-6, 'R1 is bypassed: 6 V / 8 ohms');
  assert.equal(C.solveBuild(s, across).misplaced.length, 1, 'the live solve says so');
  const inSeries = build(s, ...base, ['A1', 'ammeter', [2, 2], [1, 2]], ['wire', [1, 2], [0, 2]]);
  assert.deepEqual(C.meterProblems(inSeries), []);
  const vSeries = build(s, ...base, ['V1', 'voltmeter', [2, 2], [1, 2]], ['wire', [1, 2], [0, 2]]);
  assert.deepEqual(C.meterProblems(vSeries), [{ id: 'V1', type: 'voltmeter' }]);
  const r = C.solveBuild(s, vSeries);
  near(r.read.V1, 6, 1e-3, 'it reads nearly the whole supply');
  assert.ok(r.I.R1 < 1e-5, 'and almost no current flows');
  const vAcross = build(s, ...base, ['wire', [2, 2], [0, 2]], ['V1', 'voltmeter', [0, 2], [0, 0]]);
  assert.deepEqual(C.meterProblems(vAcross), [], 'across the cell is right');
  // across an open switch, a voltmeter reads the supply, and is in the right place
  const s2 = sandbox({ cell: [6], bulb: 1, switch: 1, voltmeter: 1, wire: 4 });
  const sw = build(s2, ['B1', 'cell', [0, 2], [0, 0]], ['S1', 'switch', [0, 0], [1, 0], false], ['L1', 'bulb', [1, 0], [1, 2]], ['wire', [1, 2], [0, 2]], ['V1', 'voltmeter', [1, 0], [0, 0]]);
  assert.deepEqual(C.meterProblems(sw), []);
  near(C.solveBuild(s2, sw).read.V1, 6, 1e-3);
});

// a build task from a spec, a goal and its answer, checked through the server
const buildTask = (spec, goal) => {
  const t = circuit.task(spec, goal);
  assert.ok(t, circuit.why(spec, goal));
  assert.equal(C.check(t.spec, t.goal, { parts: t.goal.answer }).correct, true, 'its own answer meets it');
  assert.equal(C.check(t.spec, t.goal, { parts: C.startBuild(t.spec) }).correct, false, 'the start does not');
  assert.deepEqual(circuit.task(t.spec, t.goal), t, 'checking it again changes nothing');
  return t;
};
const tryBuild = (t, ...xs) => C.check(t.spec, t.goal, { parts: parts(...xs) });

test('build goals: lit, with equal brightness or in order', () => {
  const spec = { build: true, grid: [4, 2], palette: { cell: [6], bulb: { count: 2, value: 12 }, wire: 8 } };
  const parallel = parts(['B1', 'cell', [0, 2], [0, 0]], ['wire', [0, 0], [2, 0]], ['L1', 'bulb', [1, 0], [1, 2]], ['L2', 'bulb', [2, 0], [2, 2]], ['wire', [0, 2], [2, 2]]);
  const t = buildTask(spec, { type: 'lit', on: ['L1', 'L2'], equal: true, answer: parallel });
  assert.deepEqual({ ...t.goal, answer: null }, { type: 'lit', on: ['L1', 'L2'], off: [], equal: ['L1', 'L2'], answer: null });
  const series = [['B1', 'cell', [0, 2], [0, 0]], ['L1', 'bulb', [0, 0], [1, 0]], ['L2', 'bulb', [1, 0], [2, 0]], ['wire', [2, 0], [2, 2]], ['wire', [2, 2], [0, 2]]];
  assert.equal(tryBuild(t, ...series).correct, true, 'equal in series too');
  assert.deepEqual(tryBuild(t, ...series.slice(0, 4)).why, { lamp: 'L1', want: true }, 'not a loop');
  assert.deepEqual(tryBuild(t, ['B1', 'cell', [0, 2], [0, 0]], ['L1', 'bulb', [0, 0], [1, 0]], ['wire', [1, 0], [1, 2]], ['wire', [1, 2], [0, 2]]).why, { missing: 'L2' });
  // brighter: L1 alone across the cell, L2 behind a resistor
  const order = { build: true, grid: [4, 2], palette: { cell: [6], bulb: { count: 2, value: 12 }, resistor: [12], wire: 8 } };
  const t2 = buildTask(order, { type: 'lit', order: ['L1', 'L2'], answer: parts(['B1', 'cell', [0, 2], [0, 0]], ['wire', [0, 0], [3, 0]], ['L1', 'bulb', [1, 0], [1, 2]],
    ['R1', 'resistor', [3, 0], [3, 1]], ['L2', 'bulb', [3, 1], [3, 2]], ['wire', [0, 2], [3, 2]]) });
  assert.deepEqual(t2.goal.on, ['L1', 'L2']);
  assert.equal(tryBuild(t2, ['B1', 'cell', [0, 2], [0, 0]], ['wire', [0, 0], [3, 0]], ['L2', 'bulb', [1, 0], [1, 2]], ['R1', 'resistor', [3, 0], [3, 1]], ['L1', 'bulb', [3, 1], [3, 2]], ['wire', [0, 2], [3, 2]]).correct, true,
    'the two bulbs are alike: the other way round is just as right');
  assert.deepEqual(tryBuild(t2, ...series).why, { order: ['L1', 'L2'] }, 'in series they are equal');
});

test('build goals: series and parallel', () => {
  const spec = { build: true, grid: [4, 2], parts: [{ id: 'B1', type: 'cell', from: [0, 2], to: [0, 0], value: 3 }], palette: { bulb: { count: 2, value: 6 }, wire: 8 } };
  const series = [['L1', 'bulb', [0, 0], [1, 0]], ['L2', 'bulb', [1, 0], [2, 0]], ['wire', [2, 0], [2, 2]], ['wire', [2, 2], [0, 2]]];
  const parallel = [['wire', [0, 0], [2, 0]], ['L1', 'bulb', [1, 0], [1, 2]], ['L2', 'bulb', [2, 0], [2, 2]], ['wire', [0, 2], [2, 2]]];
  const tp = buildTask(spec, { type: 'parallel', parts: ['L1', 'L2'], answer: parts(...parallel) });
  const ts = buildTask(spec, { type: 'series', parts: ['L1', 'L2'], answer: parts(...series) });
  assert.deepEqual(tryBuild(tp, ...series).why, { parallel: ['L1', 'L2'], ser: true });
  assert.deepEqual(tryBuild(ts, ...parallel).why, { series: ['L1', 'L2'], par: true });
  assert.deepEqual(tryBuild(ts, ...series.slice(0, 3)).why, { nocurrent: 'L1' }, 'a loop not closed');
  assert.equal(tryBuild(tp, ...parallel).correct, true);
  // a series answer that is really parallel: the app makes its own (one loop), and keeps the task
  const fixedUp = circuit.task(spec, { type: 'series', parts: ['L1', 'L2'], answer: parts(...parallel) });
  assert.ok(fixedUp);
  assert.equal(C.inSeries(C.netOf(C.readBuild(fixedUp.spec, fixedUp.goal.answer, true), 'goal'), 'L1', 'L2'), true);
  // where it can't (the cell is not in column 0), the reason says what is wrong
  const right = { ...spec, parts: [{ id: 'B1', type: 'cell', from: [3, 2], to: [3, 0], value: 3 }] };
  assert.match(circuit.why(right, { type: 'series', parts: ['L1', 'L2'], answer: parts(['wire', [3, 0], [1, 0]], ['L1', 'bulb', [1, 0], [1, 2]], ['L2', 'bulb', [2, 0], [2, 2]], ['wire', [1, 2], [3, 2]]) }),
    /the goal's "answer" does not meet it: L1 and L2 are not in series \(they are in parallel\)/);
});

test('build goals: when the AI\'s answer is missing or wrong, the app makes one on a plain board', () => {
  const made = (spec, goal) => {
    const t = buildTask(spec, goal);
    return C.readBuild(t.spec, t.goal.answer, true);
  };
  // in series, from an empty board: the palette's cell and both bulbs in one loop
  const s1 = made({ build: true, palette: { cell: [3], bulb: 2, wire: 10 } }, { type: 'series', parts: ['L1', 'L2'] });
  assert.deepEqual(s1.filter((p) => p.type !== 'wire').map((p) => p.id), ['B1', 'L1', 'L2']);
  // in parallel, beside the prompt's fixed cell
  const s2 = made({ build: true, grid: [4, 2], parts: [{ id: 'B1', type: 'cell', from: [0, 2], to: [0, 0], value: 3 }], palette: { bulb: { count: 2, value: 6 }, wire: 8 } }, { type: 'parallel', parts: ['L1', 'L2'] });
  assert.equal(C.inParallel(C.netOf(s2, 'goal'), 'L1', 'L2'), true);
  // L1 brighter than L2: L2 behind the resistor
  made({ build: true, palette: { battery: [6], bulb: { count: 2, value: 12 }, resistor: [12], wire: 10 } }, { type: 'lit', order: ['L1', 'L2'] });
  // S1 turns only L2 on and off: S1 and L2 in one branch, L1 in another
  const s4 = made({ build: true, palette: { battery: [6], bulb: { count: 2, value: 12 }, switch: 1, wire: 12 } }, { type: 'control', switch: 'S1', on: ['L2'] });
  assert.equal(C.inParallel(C.netOf(s4, 'goal'), 'L1', 'L2'), true);
  // a voltmeter across R2, and a reading that needs the right resistor from a choice
  made({ build: true, palette: { battery: [6], resistor: [4, 8], voltmeter: 1, wire: 6 } }, { type: 'measure', meter: 'V1', across: 'R2' });
  const s6 = made({ build: true, palette: { battery: [6], resistor: { count: 1, values: [4, 8, 12, 24] }, ammeter: 1, wire: 6 } }, { type: 'reading', meter: 'A1', value: 0.5 });
  assert.equal(s6.find((p) => p.id === 'R1').value, 12);
  // an LED points the way the current goes, with the cell's + at the bottom too
  made({ build: true, grid: [3, 2], parts: [{ id: 'B1', type: 'cell', from: [0, 0], to: [0, 2], value: 6 }], palette: { led: ['green'], resistor: [200], wire: 6 } }, { type: 'lit', on: ['D1'] });
  // an equivalent resistance is left to the AI: its dots are where it put them
  assert.match(circuit.why({ build: true, grid: [4, 2], nodes: { P: [0, 1], Q: [4, 1] }, palette: { resistor: { count: 3, value: 4 }, wire: 6 } }, { type: 'equivalent', between: ['P', 'Q'], value: 6 }), /needs "answer"/);
  // and nothing the palette can't make: two bulbs in parallel from one bulb
  assert.match(circuit.why({ build: true, palette: { cell: [3], bulb: 1 } }, { type: 'lit', on: ['L1', 'L2'] }), /names L2, which is not a part/);
});

test('build goals: a reading, an equivalent resistance, a meter in the right place', () => {
  // Ohm's law by building: 0.5 A from 6 V, choosing the resistor
  const tr = buildTask({ build: true, grid: [3, 2], palette: { battery: [6], resistor: { count: 1, values: [4, 8, 12, 24] }, ammeter: 1, wire: 6 } },
    { type: 'reading', meter: 'A1', value: 0.5, answer: parts(['B1', 'battery', [0, 2], [0, 0]], ['A1', 'ammeter', [0, 0], [3, 0]], ['R1', 'resistor', [3, 0], [3, 2], 12], ['wire', [3, 2], [0, 2]]) });
  assert.equal(tr.goal.answer.find((p) => p.id === 'R1').value, 12);
  const meterBuild = (r) => tryBuild(tr, ['B1', 'battery', [0, 2], [0, 0]], ['A1', 'ammeter', [0, 0], [3, 0]], ['R1', 'resistor', [3, 0], [3, 2], r], ['wire', [3, 2], [0, 2]]);
  assert.deepEqual(meterBuild(4).why, { meter: 'A1', got: 1.5 });
  assert.equal(meterBuild(12).correct, true);
  assert.deepEqual(tryBuild(tr, ['B1', 'battery', [0, 2], [0, 0]], ['R1', 'resistor', [0, 0], [3, 0], 12], ['A1', 'ammeter', [0, 0], [3, 0]], ['wire', [3, 0], [3, 2]], ['wire', [3, 2], [0, 2]]).why,
    { short: true }, 'an ammeter across the only resistor shorts the battery');
  // 6 ohms from three 4 ohm resistors
  const eqSpec = { build: true, grid: [4, 2], nodes: { P: [0, 1], Q: [4, 1] }, palette: { resistor: { count: 3, value: 4 }, wire: 6 } };
  const te = buildTask(eqSpec, { type: 'equivalent', between: ['P', 'Q'], value: 6,
    answer: parts(['R1', 'resistor', [0, 1], [1, 1]], ['wire', [1, 0], [1, 2]], ['R2', 'resistor', [1, 0], [2, 0]], ['R3', 'resistor', [1, 2], [2, 2]], ['wire', [2, 0], [2, 2]], ['wire', [2, 1], [4, 1]]) });
  assert.deepEqual(tryBuild(te, ['R1', 'resistor', [0, 1], [1, 1]], ['R2', 'resistor', [1, 1], [2, 1]], ['R3', 'resistor', [2, 1], [3, 1]], ['wire', [3, 1], [4, 1]]).why, { req: 12 });
  assert.deepEqual(tryBuild(te).why, { req: Infinity });
  assert.match(circuit.why(eqSpec, { type: 'equivalent', between: ['P', 'Q'], value: 5, answer: te.goal.answer }), /the resistance between P and Q is 6 ohms, not 5/);
  // a voltmeter across R2, an ammeter in series with L1
  const loop = [{ id: 'B1', type: 'cell', from: [0, 2], to: [0, 0], value: 6 }, { id: 'R1', type: 'resistor', from: [0, 0], to: [2, 0], value: 4 }, { id: 'R2', type: 'resistor', from: [2, 0], to: [4, 0], value: 8 }, { type: 'wire', from: [4, 0], to: [4, 2] }];
  const tv = buildTask({ build: true, grid: [4, 2], parts: loop, palette: { voltmeter: 1, wire: 4 } },
    { type: 'measure', meter: 'V1', across: 'R2', answer: parts(['wire', [4, 2], [0, 2]], ['V1', 'voltmeter', [2, 0], [4, 0]]) });
  assert.deepEqual({ ...tv.goal, answer: null }, { type: 'measure', meter: 'V1', part: 'R2', answer: null });
  assert.deepEqual(tryBuild(tv, ['wire', [4, 2], [0, 2]], ['V1', 'voltmeter', [0, 0], [2, 0]]).why, { across: ['V1', 'R2'] }, 'across R1 instead');
  assert.deepEqual(tryBuild(tv, ['V1', 'voltmeter', [4, 2], [0, 2]]).why, { misplaced: 'V1', across: null }, 'in series, closing the loop');
  const ta = buildTask({ build: true, grid: [4, 2], parts: [loop[0], { type: 'wire', from: [0, 0], to: [2, 0] }, { id: 'L1', type: 'bulb', from: [2, 0], to: [4, 0], value: 12 }, loop[3]], palette: { ammeter: 1, wire: 4 } },
    { type: 'measure', meter: 'A1', through: 'L1', answer: parts(['A1', 'ammeter', [4, 2], [2, 2]], ['wire', [2, 2], [0, 2]]) });
  assert.equal(tryBuild(ta, ['A1', 'ammeter', [4, 2], [0, 2]]).correct, true, 'anywhere in the loop is in series');
  assert.deepEqual(tryBuild(ta, ['wire', [4, 2], [0, 2]], ['A1', 'ammeter', [2, 0], [4, 0]]).why, { short: true }, 'across the only bulb, it shorts the cell');
});

test('build goals: a switch that controls only one lamp', () => {
  const spec = { build: true, grid: [4, 3], palette: { battery: [6], bulb: { count: 2, value: 12 }, switch: 1, wire: 12 } };
  const ladder = (...branch) => [['B1', 'battery', [0, 3], [0, 0]], ['wire', [0, 0], [3, 0]], ['L1', 'bulb', [1, 0], [1, 3]], ...branch, ['wire', [0, 3], [3, 3]]];
  const right = ladder(['S1', 'switch', [3, 0], [3, 1], true], ['L2', 'bulb', [3, 1], [3, 3]]);
  const t = buildTask(spec, { type: 'control', switch: 'S1', on: ['L2'], answer: parts(...right) });
  assert.equal(tryBuild(t, ...ladder(['S1', 'switch', [3, 0], [3, 1], false], ['L2', 'bulb', [3, 1], [3, 3]])).correct, true, 'open or closed, the switch is tried both ways');
  // the switch in the main line turns both off
  const main = [['B1', 'battery', [0, 3], [0, 1]], ['S1', 'switch', [0, 1], [0, 0], true], ['wire', [0, 0], [3, 0]], ['L1', 'bulb', [1, 0], [1, 3]], ['L2', 'bulb', [3, 0], [3, 3]], ['wire', [0, 3], [3, 3]]];
  assert.deepEqual(tryBuild(t, ...main).why, { ctl: 'other', lamp: 'L1' });
  // ... which is right when it should control both
  buildTask(spec, { type: 'control', switch: 'S1', on: ['L1', 'L2'], answer: parts(...main) });
  assert.deepEqual(tryBuild(t, ...ladder(['wire', [3, 0], [3, 1]], ['L2', 'bulb', [3, 1], [3, 3]]), ['S1', 'switch', [2, 1], [2, 2]]).why, { ctl: 'off', lamp: 'L2' }, 'a switch beside the circuit controls nothing');
});

test('why(): reasons for a build task the AI can act on', () => {
  // the cell stands in column 3, so the app makes no answer of its own here: the AI's must be right
  const spec = { build: true, grid: [4, 2], parts: [{ id: 'B1', type: 'cell', from: [3, 2], to: [3, 0], value: 3 }], palette: { bulb: { count: 2, value: 6 }, wire: 8 } };
  const answer = parts(['wire', [3, 0], [1, 0]], ['L1', 'bulb', [1, 0], [1, 2]], ['L2', 'bulb', [2, 0], [2, 2]], ['wire', [1, 2], [3, 2]]);
  const why = (s, g) => circuit.why(s, g);
  assert.equal(why(spec, { type: 'parallel', parts: ['L1', 'L2'], answer }), '');
  assert.match(why(spec, { type: 'parallel', parts: ['L1', 'L2'] }), /needs "answer"/);
  assert.match(why(spec, { type: 'parallel', parts: ['L1', 'L3'], answer }), /names L3, which is not a part \(the spec's and palette's are B1, L1, L2\)/);
  assert.match(why(spec, { type: 'parallel', parts: ['L1', 'L2'], answer: answer.concat(parts(['L3', 'bulb', [0, 0], [0, 2]])) }), /more bulbs than the palette has \(2\)/);
  assert.match(why(spec, { type: 'parallel', parts: ['L1', 'L2'], answer: parts(['wire', [3, 0], [1, 0]], ['L1', 'bulb', [1, 0], [1, 2]], ['L2', 'bulb', [2, 0], [2, 2]]) }), /no current flows through L1/);
  assert.match(why(spec, { type: 'parallel', parts: ['L1', 'L2'], answer: parts(['L1', 'bulb', [2, 1], [3, 1]]) }), /crosses the middle of another part/);
  assert.match(why(spec, { type: 'dance', answer }), /unknown goal type "dance" for a build/);
  const lit = { build: true, grid: [4, 2], parts: [{ id: 'B1', type: 'cell', from: [0, 2], to: [0, 0], value: 3 }, { id: 'L1', type: 'bulb', from: [0, 0], to: [1, 0] }, { type: 'wire', from: [1, 0], to: [1, 2] }, { type: 'wire', from: [1, 2], to: [0, 2] }], palette: { wire: 2 } };
  assert.match(why(lit, { type: 'lit', on: ['L1'], answer: [] }), /already meets the goal as it starts/);
  assert.match(why({ ...spec, grid: [9, 2] }, { type: 'lit', answer }), /"grid" is \[width, height\]/);
  assert.match(why({ ...spec, parts: [{ id: 'B1', type: 'cell', from: [0, 0], to: [1, 1] }] }, { type: 'lit', answer }), /B1 from \[0, 0\] to \[1, 1\] is not along a row or a column/);
  assert.match(why({ ...spec, parts: [{ id: 'B1', type: 'cell', from: [0, 0.5], to: [0, 2] }] }, { type: 'lit', answer }), /not on a dot: build points are whole numbers/);
  assert.match(why({ ...spec, resistance: ['P', 'Q'] }, { type: 'lit', answer }), /"resistance" names two labelled points/);
  assert.match(why({ ...spec, palette: { capacitor: 1 } }, { type: 'lit', answer }), /the palette has an unknown part "capacitor"/);
  assert.match(why({ nodes: { a: [0, 0] }, parts: [] }, { type: 'series', parts: ['L1', 'L2'] }), /"series" is a build goal: give the spec "build": true/);
  // a short circuit as it starts says what makes it (a real model's block: the ammeter straight across the battery)
  const shorted = { nodes: { a: [0, 0], b: [3, 0], c: [6, 0], d: [0, 4], e: [3, 4], f: [6, 4] }, parts: [{ id: 'B1', type: 'battery', from: 'd', to: 'a', value: 6 }, { id: 'R1', type: 'resistor', from: 'a', to: 'b', value: 10 },
    { id: 'R2', type: 'resistor', from: 'b', to: 'c', value: 20 }, { type: 'wire', from: 'c', to: 'f' }, { type: 'wire', from: 'f', to: 'e' }, { type: 'wire', from: 'e', to: 'd' }, { id: 'A1', type: 'ammeter', from: 'd', to: 'a' }] };
  assert.match(why(shorted), /short circuit as it starts: nothing but the ammeter A1 and wires joins the two ends of B1 \(an ammeter goes in series, in the loop, never straight across a cell\)/);
  assert.match(why({ build: true, parts: [{ id: 'B1', type: 'cell', from: [0, 1], to: [0, 0] }, { type: 'wire', from: [0, 0], to: [0, 1] }], palette: { bulb: 1 } }), /nothing but wires joins the two ends of B1/);
  // through the repair round's door (server/ai.mjs sends this back to the model)
  assert.match(widgetWhy('circuit', spec, { type: 'parallel', parts: ['L1', 'L2'] }), /needs "answer"/);
  assert.ok(widgetWhy('circuit', spec, { type: 'series', parts: ['L1', 'L2'], answer }).length <= 300);
});

test('build mode through server/widgets.mjs, and the prompt\'s build example', () => {
  const b = normWidgetBlock({ t: 'widget', kind: 'circuit', caption: 'Build any circuit.', spec: { build: true, palette: { cell: [3], bulb: 2, switch: 1, wire: 10 } } });
  assert.equal(b.spec.build, true);
  const ex = JSON.parse(/Task example: (\{.*\})$/m.exec(circuit.prompt)[1]);
  assert.equal(ex.spec.build, true, 'the task example is a build task');
  const q = normTask(ex, { prompt: ex.prompt, hint: '', explain: '' });
  assert.ok(q, circuit.why(ex.spec, ex.goal));
  assert.equal(q.goal.type, 'parallel');
  assert.ok(circuit.prompt.length <= 3900, `the prompt is ${circuit.prompt.length} characters`);
  for (const g of ['"lit"', '"series"', '"parallel"', '"equivalent"', '"measure"', '"control"', '"answer"', '"palette"', '"light"', '"reading"', '"connect"']) assert.ok(circuit.prompt.includes(g), g);
  // a build spec's words for the translator: its notes and its parts' names
  const s = circuit.block({ build: true, palette: { cell: [3], bulb: 1 }, parts: [{ id: 'L9', type: 'bulb', from: [2, 0], to: [3, 0], label: 'Lamp A' }], labels: [{ at: [1, 1], text: 'build here' }] });
  assert.deepEqual(circuit.texts(s), ['build here', 'Lamp A']);
  assert.equal(circuit.withTexts(s, ['यहाँ बनाइए', 'लैंप A']).parts[0].label, 'लैंप A');
});

test('a part only the breadboard has sends the AI there', async () => {
  const circuit = await import('../server/widgets/circuit.mjs');
  const spec = { nodes: { a: [0, 0], b: [4, 0], c: [4, 3], d: [0, 3] }, parts: [
    { id: 'B1', type: 'cell', from: 'd', to: 'a', value: 6 }, { id: 'C1', type: 'capacitor', from: 'a', to: 'b', value: 100 },
    { id: 'R1', type: 'resistor', from: 'b', to: 'c', value: 10 }, { type: 'wire', from: 'c', to: 'd' }] };
  assert.match(circuit.why(spec), /use|rebuild this part with the "breadboard" kind/);
  assert.match(circuit.why({ ...spec, parts: [spec.parts[0], { id: 'X1', type: 'flux capacitor', from: 'a', to: 'b' }, ...spec.parts.slice(2)] }), /breadboard/);
  assert.doesNotMatch(circuit.why({ ...spec, parts: [spec.parts[0], { id: 'X1', type: 'banana', from: 'a', to: 'b' }, ...spec.parts.slice(2)] }), /breadboard/);
});
