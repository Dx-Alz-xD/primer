// The circuit widget: the DC solver (assets/js/widgets/circuit-core.js) and the server's checks of what
// the AI writes (server/widgets/circuit.mjs, through server/widgets.mjs).   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../assets/js/widgets/circuit-core.js';
import * as circuit from '../server/widgets/circuit.mjs';
import { normWidgetBlock, normTask, widgetKinds, widgetPrompt } from '../server/widgets.mjs';

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
