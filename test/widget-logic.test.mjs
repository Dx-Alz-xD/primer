// The logic gates lab: the circuit model, the expression reader, truth tables, latches and the goal checks
// (assets/js/widgets/logic-core.js), and the server's checks of what the AI writes (server/widgets/logic.mjs,
// through server/widgets.mjs).   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import L from '../assets/js/widgets/logic-core.js';
import * as logic from '../server/widgets/logic.mjs';
import { normWidgetBlock, normTask, widgetKinds, widgetPrompt, widgetWhy } from '../server/widgets.mjs';

const AB = ['A', 'B'], ABC = ['A', 'B', 'C'];
const col = (expr, names = ABC) => L.astTable(L.parse(expr, names), names);
const one = (type, ins, names = AB) => L.table(L.normSpec({ inputs: names, gates: [{ id: 'G1', type, in: ins }], outputs: { Y: 'G1' } })).Y;

test('each gate, with 1, 2 and 3 inputs; rows count in binary, the first input highest', () => {
  assert.equal(one('NOT', ['A'], ['A']), '10');
  assert.equal(one('AND', AB), '0001');
  assert.equal(one('OR', AB), '0111');
  assert.equal(one('NAND', AB), '1110');
  assert.equal(one('NOR', AB), '1000');
  assert.equal(one('XOR', AB), '0110');
  assert.equal(one('XNOR', AB), '1001');
  assert.equal(one('AND', ABC, ABC), '00000001');
  assert.equal(one('NOR', ABC, ABC), '10000000');
  assert.equal(one('XOR', ABC, ABC), '01101001', 'a 3-input XOR is 1 for an odd number of 1s');
  // names for the types
  assert.equal(one('ex-or', AB), '0110');
  assert.equal(one('inverter', ['A'], ['A']), '10');
  // A is the highest bit: row 2 is A=1, B=0
  assert.equal(L.rowName(L.normSpec({ inputs: AB, outputs: { Y: 'A' } }), 2), 'A=1, B=0');
  assert.deepEqual(L.rowBits(5, 3), [1, 0, 1]);
});

test('the expression reader: NOT forms, AND, OR, XOR and their order', () => {
  // the forms the task asks for
  assert.equal(col('A·B + ¬C'), col('(A AND B) OR (NOT C)'));
  assert.equal(col('A AND NOT B'), '00001100');
  assert.equal(col("A'B + C"), col('(NOT A AND B) OR C'));
  assert.equal(col('!A & B'), '00110000');
  assert.equal(col("(A+B)'"), col('A NOR B'));
  assert.equal(col('A ⊕ B'), col('A XOR B'));
  assert.equal(col('A ^ B'), '00111100');
  // every way of writing NOT
  for (const e of ["A'", '¬A', '!A', '~A', 'NOT A', 'not a', 'A’', 'A' + String.fromCharCode(0x305), 'Ā']) assert.equal(col(e, ['A']), '10', e);
  // NOT binds first, then AND, then XOR, then OR
  assert.equal(col('A + B·C'), col('A + (B·C)'));
  assert.notEqual(col('A + B·C'), col('(A + B)·C'));
  assert.equal(col('A ⊕ B·C'), col('A ⊕ (B·C)'));
  assert.equal(col('A + B ⊕ C'), col('A + (B ⊕ C)'));
  assert.equal(col("NOT A·B"), col("(A')·B"));
  assert.equal(col("(A·B)'"), col('A NAND B'));
  assert.equal(col("A'' "), col('A'), 'two NOTs cancel');
  // AB is A·B when A and B are inputs; Cin is one name
  assert.equal(col('AB + C'), col('A·B + C'));
  assert.equal(L.astTable(L.parse('A·B + Cin', ['A', 'B', 'Cin']), ['A', 'B', 'Cin']), '01010111');
  // gates written as calls, and the other symbols
  assert.equal(col('NAND(A, B)', AB), '1110');
  assert.equal(col('XOR(A, B, C)'), col('A ⊕ B ⊕ C'));
  assert.equal(col('A ∧ B ∨ C'), col('A·B + C'));
  assert.equal(col('A * B | C'), col('A·B + C'));
  assert.equal(col('A ⊙ B', AB), '1001');
  // written back as a textbook does
  assert.equal(L.show(L.parse('A AND NOT B OR C', ABC)), "A·B' + C");
  assert.equal(L.show(L.parse('NOT (A OR B)', AB)), "(A + B)'");
  // what can't be read
  assert.throws(() => L.parse('A + D', ABC), /"D" is not one of the inputs/);
  assert.throws(() => L.parse('A + * B', ABC), L.ParseError);
  assert.throws(() => L.parse('(A + B', ABC), L.ParseError);
  assert.throws(() => L.parse('', ABC), L.ParseError);
});

test('circuits written as expressions become gates; truth tables of a half and a full adder', () => {
  const ha = L.normSpec({ inputs: AB, outputs: { S: 'A XOR B', C: 'A AND B' } });
  assert.deepEqual(ha.gates.map((g) => g.type), ['XOR', 'AND']);
  assert.deepEqual(L.table(ha), { S: '0110', C: '0001' });
  // a shared part is one gate
  const x = L.normSpec({ inputs: AB, outputs: { Y: 'NAND(NAND(A, NAND(A, B)), NAND(B, NAND(A, B)))' } });
  assert.equal(x.gates.length, 4, 'NAND(A, B) is used twice but built once');
  assert.equal(L.table(x).Y, '0110', 'four NANDs make XOR');
  // the ready blocks
  const fa = L.normSpec({ inputs: ['A', 'B', 'Cin'], gates: [{ id: 'U1', type: 'full adder', in: ['A', 'B', 'Cin'] }], outputs: { S: 'U1.S', Cout: 'U1.Cout' } });
  assert.deepEqual(L.table(fa), { S: '01101001', Cout: '00010111' });
  const ha2 = L.normSpec({ inputs: AB, gates: [{ id: 'U1', type: 'HA', in: { A: 'A', B: 'B' } }], outputs: { S: 'U1.sum', C: 'U1.carry' } });
  assert.deepEqual(L.table(ha2), { S: '0110', C: '0001' });
  // the wires written as a list
  const w = L.normSpec({ inputs: AB, outputs: ['Y'], gates: [{ id: 'G1', type: 'NOR' }], wires: [{ from: 'A', to: 'G1' }, { from: 'B', to: 'G1' }, { from: 'G1', to: 'Y' }] });
  assert.equal(L.table(w).Y, '1000');
});

test('NAND alone (and NOR alone) makes every gate: the textbook constructions', () => {
  const nand = {
    NOT: ['A', 'NAND(A, A)'],
    AND: ['A·B', 'NAND(NAND(A, B), NAND(A, B))'],
    OR: ['A + B', 'NAND(NAND(A, A), NAND(B, B))'],
    NOR: ["(A + B)'", 'NAND(NAND(NAND(A, A), NAND(B, B)), NAND(NAND(A, A), NAND(B, B)))'],
    XOR: ['A ⊕ B', 'NAND(NAND(A, NAND(A, B)), NAND(B, NAND(A, B)))'],
    XNOR: ['A ⊙ B', 'NAND(NAND(NAND(A, NAND(A, B)), NAND(B, NAND(A, B))), NAND(NAND(A, NAND(A, B)), NAND(B, NAND(A, B))))']
  };
  for (const [name, [want, built]] of Object.entries(nand)) {
    const names = name === 'NOT' ? ['A'] : AB;
    const s = L.normSpec({ inputs: names, outputs: { Y: built } });
    assert.ok(s.gates.every((g) => g.type === 'NAND'), name);
    assert.equal(L.table(s).Y, L.astTable(L.parse(name === 'NOT' ? "A'" : want, names), names), `${name} from NAND`);
  }
  assert.equal(L.table(L.normSpec({ inputs: AB, outputs: { Y: 'NOR(NOR(A, A), NOR(B, B))' } })).Y, '0001', 'AND from NOR');

  // the core's own circuit maker: NAND only, for many functions of three inputs, checked row by row
  const t0 = Date.now();
  for (let f = 1; f < 255; f += 7) {
    const tableCol = f.toString(2).padStart(8, '0');
    const tk = L.normTask({ inputs: ABC, outputs: ['Y'] }, { type: 'build', table: { Y: tableCol }, only: ['NAND'] });
    const sol = tk.goal.solution;
    assert.ok(sol.gates.every((g) => g.type === 'NAND'), 'only NAND gates');
    assert.equal(L.check(tk.spec, tk.goal, sol).correct, true, `the made circuit for ${tableCol}`);
    const nor = L.normTask({ inputs: ABC, outputs: ['Y'] }, { type: 'build', table: { Y: tableCol }, only: 'NOR gates' });
    assert.ok(nor.goal.solution.gates.every((g) => g.type === 'NOR'));
    assert.equal(L.check(nor.spec, nor.goal, nor.goal.solution).correct, true, `NOR only, ${tableCol}`);
  }
  assert.ok(Date.now() - t0 < 8000, 'quick enough for the server');
  // the smallest: XOR from four NAND gates, found without a solution given; three is too few
  const x4 = L.normTask({ inputs: AB, outputs: ['Y'] }, { type: 'build', expr: 'A ⊕ B', only: ['NAND'], max: 4 });
  assert.equal(x4.goal.solution.gates.length, 4);
  assert.throws(() => L.normTask({ inputs: AB, outputs: ['Y'] }, { type: 'build', expr: 'A ⊕ B', only: ['NAND'], max: 3 }), /no circuit from the palette/);
});

test('latches settle and remember; flip-flops change on the rising edge; a ring of NOTs is refused', () => {
  const run = (s, steps) => {
    const c = L.compile(s);
    let st = L.startState(s, c);
    return steps.map((v) => { st = L.settle(c, v, st); assert.equal(st.osc, false); return L.lampsOf(c, st).join(''); });
  };
  // the NOR latch: S sets Q, R resets it, both low keeps it
  const nor = L.normSpec({ inputs: ['S', 'R'], gates: [{ id: 'G1', type: 'NOR', in: ['R', 'G2'] }, { id: 'G2', type: 'NOR', in: ['S', 'G1'] }], outputs: { Q: 'G1', Qn: 'G2' } });
  assert.equal(nor.seq, true);
  assert.equal(nor.latch, true, 'a circuit written with a loop lets the learner make loops too');
  assert.deepEqual(run(nor, [[0, 0], [1, 0], [0, 0], [0, 1], [0, 0]]), ['01', '10', '10', '01', '01']);
  // the NAND latch (active-low S' and R')
  const nand = L.normSpec({ inputs: ['S', 'R'], set: { S: 1, R: 1 }, gates: [{ id: 'G1', type: 'NAND', in: ['S', 'G2'] }, { id: 'G2', type: 'NAND', in: ['R', 'G1'] }], outputs: { Q: 'G1', Qn: 'G2' } });
  assert.deepEqual(run(nand, [[1, 1], [0, 1], [1, 1], [1, 0], [1, 1]]), ['01', '10', '10', '01', '01']);
  // the SR latch block, and its forbidden state
  const sr = L.normSpec({ inputs: ['S', 'R'], gates: [{ id: 'U1', type: 'SR latch', in: ['S', 'R'] }], outputs: { Q: 'U1.Q', Qn: "U1.Q'" } });
  const c = L.compile(sr);
  const both = L.settle(c, [1, 1], L.startState(sr, c));
  assert.equal(both.bad, true);
  // a D flip-flop takes D as the clock rises, and only then
  const d = L.normSpec({ inputs: ['D', 'CLK'], gates: [{ id: 'U1', type: 'D flip-flop', in: ['D', 'CLK'] }], outputs: { Q: 'U1.Q' } });
  assert.deepEqual(run(d, [[1, 0], [1, 1], [0, 1], [0, 0], [0, 1], [1, 0]]), ['0', '1', '1', '1', '0', '0']);
  // fed its own Q', it toggles on each rising edge: a counter's first bit
  const t = L.normSpec({ inputs: ['CLK'], gates: [{ id: 'U1', type: 'DFF', in: ['U1.Qn', 'CLK'] }], outputs: { Q: 'U1.Q' } });
  assert.deepEqual(run(t, [[1], [0], [1], [0], [1]]), ['1', '1', '0', '0', '1']);
  // a gated D latch from gates settles too
  assert.doesNotThrow(() => L.normSpec({ inputs: ['D', 'E'], outputs: { Q: 'G3' }, gates: [
    { id: 'G1', type: 'NAND', in: ['D', 'E'] }, { id: 'N', type: 'NOT', in: ['D'] }, { id: 'G2', type: 'NAND', in: ['N', 'E'] },
    { id: 'G3', type: 'NAND', in: ['G1', 'G4'] }, { id: 'G4', type: 'NAND', in: ['G2', 'G3'] }] }));
  // three NOTs in a ring never settle
  assert.throws(() => L.normSpec({ inputs: ['A'], outputs: { Y: 'G1' }, gates: [{ id: 'G1', type: 'NOT', in: ['G3'] }, { id: 'G2', type: 'NOT', in: ['G1'] }, { id: 'G3', type: 'NOT', in: ['G2'] }] }), /never settles/);
});

test('the learner\'s attempts: build, fill, find and fix, with what went wrong', () => {
  const b = L.normTask({ inputs: AB, outputs: ['Y'], palette: { NAND: 4 } }, { type: 'build', expr: 'A XOR B', only: ['NAND'] });
  assert.equal(L.check(b.spec, b.goal, b.goal.solution).correct, true);
  assert.deepEqual(L.check(b.spec, b.goal, { gates: [{ id: 'G1', type: 'NAND', in: ['A', 'B'] }], outputs: { Y: 'G1' } }).why, { kind: 'row', row: 0, out: 'Y', got: 1, want: 0 });
  assert.equal(L.check(b.spec, b.goal, { gates: [{ id: 'G1', type: 'NAND', in: ['A', null] }], outputs: { Y: 'G1' } }).invalid, true, 'a loose input is not an attempt yet');
  assert.equal(L.check(b.spec, b.goal, { gates: [{ id: 'G1', type: 'NAND', in: ['A', 'B'] }], outputs: {} }).why.kind, 'lamp');
  assert.equal(L.check(b.spec, b.goal, { gates: [{ id: 'G1', type: 'XOR', in: ['A', 'B'] }], outputs: { Y: 'G1' } }).why.kind, 'only', 'XOR itself is not allowed');
  const five = { gates: [{ id: 'G1', type: 'NAND', in: ['A', 'B'] }, { id: 'G5', type: 'NAND', in: ['A', 'A'] }].concat(b.goal.solution.gates.slice(1)), outputs: b.goal.solution.outputs };
  const mx = L.normTask({ inputs: AB, outputs: ['Y'] }, { type: 'build', expr: 'A XOR B', only: ['NAND'], max: 4 });
  assert.equal(L.check(mx.spec, mx.goal, five).why.kind, 'max');
  // a loop in a build is wrong, not a crash
  assert.equal(L.check(b.spec, b.goal, { gates: [{ id: 'G1', type: 'NAND', in: ['A', 'G2'] }, { id: 'G2', type: 'NAND', in: ['B', 'G1'] }], outputs: { Y: 'G1' } }).why.kind, 'loop');
  assert.equal(L.check(b.spec, b.goal, { gates: 'nonsense' }).invalid, true);

  const f = L.normTask({ inputs: AB, outputs: { Y: "(A + B)'" } }, { type: 'fill' });
  assert.equal(f.goal.out.Y, '1000');
  assert.equal(L.check(f.spec, f.goal, { cells: { Y: [1, 0, 0, 0] } }).correct, true);
  assert.deepEqual(L.check(f.spec, f.goal, { cells: { Y: [1, 0, 1, 1] } }).why, { kind: 'fill', row: 2, out: 'Y', wrong: 2 });
  assert.equal(L.check(f.spec, f.goal, { cells: { Y: [1, 0, null, 0] } }).invalid, true);

  const fd = L.normTask({ inputs: ABC, outputs: { Y: "A·B'·C" } }, { type: 'find', want: { Y: 1 } });
  assert.deepEqual(fd.goal.solution.set, { A: 1, B: 0, C: 1 });
  assert.equal(L.check(fd.spec, fd.goal, { set: { A: 1, B: 0, C: 1 } }).correct, true);
  assert.deepEqual(L.check(fd.spec, fd.goal, { set: { A: 1, B: 1, C: 1 } }).why, { kind: 'out', out: 'Y', got: 0, want: 1 });
  // on a latch: store a 1, then let go of S; the path is played through
  const latch = { inputs: ['S', 'R'], gates: [{ id: 'G1', type: 'NOR', in: ['R', 'G2'] }, { id: 'G2', type: 'NOR', in: ['S', 'G1'] }], outputs: { Q: 'G1' } };
  const fl = L.normTask(latch, { type: 'find', want: { Q: 1 }, inputs: { S: 0, R: 0 } });
  assert.deepEqual(fl.goal.solution.path, ['10', '00']);
  assert.equal(L.check(fl.spec, fl.goal, { set: { S: 0, R: 0 }, path: ['10', '00'] }).correct, true);
  assert.equal(L.check(fl.spec, fl.goal, { set: { S: 1, R: 0 }, path: ['10'] }).why.kind, 'keep', 'Q is 1, but S is still on');
  assert.equal(L.check(fl.spec, fl.goal, { set: { S: 0, R: 0 }, path: ['10', '00', '01', '00'] }).why.kind, 'out', 'reset again');

  const fx = L.normTask({ inputs: AB, gates: [{ id: 'G1', type: 'OR', in: ['A', 'B'] }, { id: 'G2', type: 'NOT', in: ['G1'] }], outputs: { Y: 'G2' } }, { type: 'fix', expr: "(A·B)'" });
  assert.deepEqual(fx.goal.solution, { G1: 'AND' });
  assert.equal(L.check(fx.spec, fx.goal, { types: { G1: 'AND' } }).correct, true);
  assert.equal(L.check(fx.spec, fx.goal, { types: { G1: 'XOR' } }).why.kind, 'row');
  assert.equal(L.check(fx.spec, fx.goal, { types: {} }).invalid, true);
});

test('the server: blocks and tasks that hold together are kept, the rest left out with a reason to fix', () => {
  // a block: the prompt's half adder
  const blk = normWidgetBlock({ t: 'widget', kind: 'logic', caption: 'Flip A and B.', spec: { inputs: ['A', 'B'], outputs: { S: 'A XOR B', C: 'A AND B' } } });
  assert.ok(blk && blk.spec.gates.length === 2);
  assert.equal(normWidgetBlock({ t: 'widget', kind: 'logic', spec: blk.spec }).spec.gates.length, 2, 'a checked spec checks again the same');
  // the prompt's own task example is kept
  const ex = normTask({ type: 'task', kind: 'logic', prompt: 'Make XOR from NAND gates only.', spec: { inputs: ['A', 'B'], outputs: ['Y'], palette: { NAND: 4 } }, goal: { type: 'build', expr: 'A XOR B', only: ['NAND'], solution: { Y: 'NAND(NAND(A, NAND(A, B)), NAND(B, NAND(A, B)))' } } }, { prompt: 'Make XOR', hint: '', explain: '' });
  assert.ok(ex, 'the example task');
  assert.equal(ex.goal.solution.gates.length, 4);
  // and checks again the same, as the page does
  assert.ok(L.normTask(ex.spec, ex.goal));
  const fillAgain = L.normTask({ inputs: AB, outputs: ['Y'] }, { type: 'build', table: { Y: [0, 1, 1, 1] } });
  assert.ok(L.normTask(fillAgain.spec, fillAgain.goal), 'a goal given as a table checks again too');

  const why = (spec, goal) => widgetWhy('logic', spec, goal);
  assert.equal(why({ inputs: AB, outputs: { Y: 'A AND B' } }), '');
  assert.match(why({ inputs: AB, outputs: ['Y'] }, { type: 'build', expr: 'A·C' }), /the expression for Y: "C" is not one of the inputs \(A, B\)/);
  assert.match(why({ inputs: AB, outputs: ['Y'] }, { type: 'build', table: { Y: [0, 1, 1] } }), /3 rows; with 2 inputs it needs 4/);
  assert.match(why({ inputs: AB, outputs: ['Y'] }, { type: 'build', expr: 'A + A\'' }), /always 1/);
  assert.match(why({ inputs: AB, outputs: { Y: 'A AND B' } }, { type: 'build', expr: 'A·B' }), /already makes the goal/);
  assert.match(why({ inputs: AB, outputs: ['Y'], palette: { NAND: 3 } }, { type: 'build', expr: 'A XOR B', only: ['NAND'] }), /no circuit from the palette \(NAND ×3\)/);
  assert.match(why({ inputs: AB, outputs: ['Y'], gates: [{ id: 'G1', type: 'AND', in: ['A', 'B'] }], wires: [{ from: 'B', to: 'G1.2' }] }), /two wires go into G1's input 2/);
  assert.match(why({ inputs: AB, outputs: { Y: 'G1' }, gates: [{ id: 'G1', type: 'ANDY', in: ['A', 'B'] }] }), /has type "ANDY"/);
  assert.match(why({ inputs: AB, outputs: { Y: 'G1' }, gates: [{ id: 'G1', type: 'AND', in: ['A', 'Q'] }] }), /"Q", which is not an input or a gate/);
  assert.match(why({ inputs: AB, outputs: { Y: 'G1' }, gates: [{ id: 'G1', type: 'AND', in: ['A'] }] }), /with 1 input/);
  assert.match(why({ inputs: AB, outputs: { Y: 'G1' }, gates: [{ id: 'G1', type: 'AND', in: ['A', null] }] }), /G1's input 2 has no wire/);
  assert.match(why({ inputs: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], outputs: ['Y'] }), /at most 6 inputs/);
  assert.match(why({ inputs: ['A', 'A'], outputs: ['Y'] }), /used twice/);
  assert.match(why({ inputs: ['A'], outputs: { Y: 'G1' }, gates: [{ id: 'G1', type: 'NOT', in: ['G1'] }] }), /never settles/);
  assert.match(why({ inputs: ['A', 'B', 'C', 'D', 'E'], outputs: { Y: 'A AND B' } }, { type: 'fill' }), /at most 4 inputs/);
  assert.match(why({ inputs: AB, set: { A: 1, B: 1 }, outputs: { Y: 'A AND B' } }, { type: 'find', want: { Y: 1 } }), /already shows Y = 1/);
  assert.match(why({ inputs: AB, outputs: { Y: 'A AND B' } }, { type: 'find', want: { Z: 1 } }), /"Z", which is not a lamp/);
  assert.match(why({ inputs: ABC, outputs: { Y1: 'A + B·C', Y2: '(A + B)·(A + C)' } }, { type: 'find', want: { Y1: 0, Y2: 1 } }), /Y1 and Y2 are equal in every row/);
  assert.match(why({ inputs: AB, outputs: { Y: 'G1' }, gates: [{ id: 'G1', type: 'AND', in: ['A', 'B'] }] }, { type: 'fix', expr: "A'" }), /no change of one gate's type/);
  assert.match(why({ inputs: AB, outputs: ['Y'] }, { type: 'guess' }), /"type": "build", "fill", "find" or "fix"/);

  // what the AI writes naturally: lamps named after their gate, the kind of task as a key, a lamp straight from a switch
  const named = logic.task({ inputs: AB, outputs: { AND: 'A AND B', OR: 'A OR B' } }, { find: { AND: 1, OR: 1 } });
  assert.ok(named, 'the AND lamp and the OR lamp');
  assert.deepEqual(named.goal.want, { AND: 1, OR: 1 });
  assert.equal(logic.task({ inputs: AB, outputs: ['Y'] }, { build: 'A NAND B' }).goal.type, 'build');
  assert.match(why({ inputs: ['AND'], outputs: ['Y'] }), /can't be the name of the input/);
  const desc = logic.block({ inputs: AB, outputs: { Original: '(A AND B) OR (A AND (NOT B))', "(A+B)'": 'NOT (A OR B)' } });
  assert.deepEqual(desc.outputs.map((o) => [o.name, o.label]), [['Y', 'Original'], ['Z', "(A+B)'"]], 'a description for a name becomes the label');
  assert.deepEqual(logic.task({ inputs: AB, outputs: { Original: 'A AND B' } }, { type: 'find', want: { Original: 1 } }).goal.want, { Y: 1 }, 'and the goal can name the lamp by it');
  assert.equal(logic.block({ inputs: ['A'], outputs: { Y: 'A' } }).edit, false, 'a lamp on a switch is to look at, not a board to build on');
  assert.equal(logic.block({ inputs: ['A'], outputs: ['Y'] }).edit, true, 'nothing built yet: a board to build on');

  // a wrong solution from the AI is replaced by a right one, when the palette allows
  const fixed = logic.task({ inputs: AB, outputs: ['Y'], palette: { NAND: 4 } }, { type: 'build', expr: 'A XOR B', only: ['NAND'], solution: { Y: 'NAND(A, B)' } });
  assert.ok(fixed);
  assert.equal(L.check(fixed.spec, fixed.goal, fixed.goal.solution).correct, true);
  // the full adder from the goal's own expressions, with exactly the palette's gates
  const fa = logic.task({ inputs: ['A', 'B', 'Cin'], outputs: ['S', 'Cout'], palette: { XOR: 2, AND: 2, OR: 1 } }, { type: 'build', expr: { S: 'A ⊕ B ⊕ Cin', Cout: 'A·B + Cin·(A ⊕ B)' } });
  assert.ok(fa);
  assert.equal(fa.goal.solution.gates.length, 5);
});

test('which lessons are offered it, and the prompt', () => {
  const yes = ['Class 12 physics: logic gates', 'Boolean algebra and truth tables', 'digital electronics', 'and gates, or, nor gates and all', 'NAND as a universal gate',
    'half adder and full adder', 'SR latch and D flip-flop', 'Karnaugh maps', "De Morgan's theorems", 'combinational circuits', 'semiconductor electronics: the AND gate and OR gate',
    'लॉजिक गेट', 'तर्क द्वार और सत्यता सारणी', 'बूलियन बीजगणित', 'লজিক গেট', 'தர்க்க வாயில்கள்', 'లాజిక్ గేట్లు', 'ಲಾಜಿಕ್ ಗೇಟ್‌ಗಳು', 'ലോജിക് ഗേറ്റുകൾ', 'લોજિક ગેટ', 'ਲਾਜਿਕ ਗੇਟ',
    'منطقی گیٹ', 'البوابات المنطقية', 'puertas lógicas', 'portas lógicas', 'portes logiques', 'таблица истинности'];
  const no = ['the logic of the argument', 'the gate of the city', 'Bill Gates and the digital revolution', 'walls and gates of the fort', 'flip-flops and sandals for summer',
    'Python: if statements and Boolean values', "De Morgan's laws for sets", 'the French Revolution', 'door latch repair', 'photosynthesis'];
  for (const s of yes) assert.equal(logic.match(s.toLowerCase()), true, s);
  for (const s of no) assert.equal(logic.match(s.toLowerCase()), false, s);
  assert.ok(widgetKinds({ topic: 'Class 12 Physics', title: 'Logic gates', desc: 'AND, OR and NOT gates and their truth tables' }).includes('logic'));
  assert.ok(logic.prompt.length <= 3000, `the prompt is ${logic.prompt.length} characters`);
  assert.match(widgetPrompt(['logic']), /"kind": "logic"/);
});

test('labels to translate, and put back', () => {
  const s = logic.block({ inputs: [{ name: 'D', label: 'door open' }, { name: 'K', label: 'key in' }], outputs: [{ name: 'Y', label: 'alarm', from: 'D AND NOT K' }] });
  assert.deepEqual(logic.texts(s), ['door open', 'key in', 'alarm']);
  const t = logic.withTexts(s, ['दरवाज़ा खुला', 'चाबी लगी', 'अलार्म']);
  assert.deepEqual(logic.texts(t), ['दरवाज़ा खुला', 'चाबी लगी', 'अलार्म']);
  assert.ok(logic.block(t), 'still holds together');
  assert.equal(logic.withTexts(s, ['one']), null);
});
