// The number tools: exact fractions, Indian and international grouping and the checks
// (assets/js/widgets/numbers-core.js), what the server keeps of what the AI writes and why it leaves
// the rest out (server/widgets/numbers.mjs, through server/widgets.mjs and the lesson checks in
// server/ai.mjs), and how the browser half checks, describes and draws (assets/js/widgets/numbers.js,
// run here without a page).   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import vm from 'node:vm';
import N from '../assets/js/widgets/numbers-core.js';

const DB = path.join(os.tmpdir(), `primer-numbers-${process.pid}.db`);
process.env.PRIMER_DB = DB;
test.after(() => { for (const f of [DB, DB + '-wal', DB + '-shm']) rmSync(f, { force: true }); });

const numbers = await import('../server/widgets/numbers.mjs');
const widgets = await import('../server/widgets.mjs');
const ai = await import('../server/ai.mjs');
const plain = (x) => JSON.parse(JSON.stringify(x));
const q = (v) => N.key(N.value(v));

/* ---------------- exact fractions ---------------- */

test('numbers are read exactly, in the forms the AI and textbooks write them', () => {
  assert.deepEqual(plain(N.parse('3/5')), { q: { n: 3, d: 5 }, dec: false });
  assert.deepEqual(plain(N.parse('-2.5')), { q: { n: -5, d: 2 }, dec: true });
  assert.deepEqual(plain(N.parse(0.1)), { q: { n: 1, d: 10 }, dec: true }, 'a JS number is read from its digits: 0.1 is exactly 1/10');
  assert.equal(q('1 1/2'), '3/2');
  assert.equal(q('−2 1/4'), '-9/4', 'a typographic minus and a mixed number');
  assert.equal(q('2½'), '5/2');
  assert.equal(q('6/8'), '3/4', 'kept in lowest terms');
  assert.equal(q('1,23,456'), '123456');
  assert.equal(q('123,456'), '123456');
  assert.equal(N.parse('12,3,45'), null, 'commas in the wrong places');
  assert.equal(N.parse('1/0'), null);
  assert.equal(N.parse('abc'), null);
  assert.equal(N.parse(Infinity), null);
  assert.equal(N.parse('3 3/2'), null, 'a mixed number has a proper fraction');
});

test('arithmetic with fractions is exact', () => {
  const v = N.value;
  assert.equal(N.key(N.add(v('1/2'), v('1/4'))), '3/4');
  assert.equal(N.key(N.add(v(0.1), v(0.2))), '3/10', '0.1 + 0.2 is 0.3 exactly');
  assert.equal(N.key(N.sub(v('1/3'), v('1/2'))), '-1/6');
  assert.equal(N.key(N.mul(v('2/3'), v(6))), '4');
  assert.equal(N.key(N.div(v('3/4'), v('1/4'))), '3');
  assert.equal(N.cmp(v('2/3'), v('3/5')), 1);
  assert.ok(N.eq(v('2/4'), v('0.5')));
  assert.equal(N.key(N.gcdQ(v('1/4'), v('2/5'))), '1/20');
  const s = N.parseSum('1/2 + 1/4');
  assert.equal(N.key(s.q), '3/4');
  assert.equal(N.showSum(s.terms, s.signs), '1/2 + 1/4');
  assert.equal(N.key(N.parseSum('3 - 5').q), '-2');
  assert.equal(N.key(N.parseSum('-2.5').q), '-5/2');
  assert.throws(() => N.mul(N.Q(2 ** 40), N.Q(2 ** 40)), N.NumError, 'too big to be exact: an error, never a wrong answer');
});

test('numbers are shown as fractions, mixed numbers or decimals', () => {
  const v = N.value;
  assert.equal(N.show(v('7/2')), '7/2');
  assert.equal(N.show(v('7/2'), 'mixed'), '3 1/2');
  assert.equal(N.show(v('-7/2'), 'decimal'), '−3.5');
  assert.equal(N.show(v('1/3'), 'decimal'), '1/3', 'a decimal that never ends stays a fraction');
  assert.equal(N.decimal(v('3/8')), '0.375');
  assert.equal(N.decimal(v('1/3')), null);
  assert.deepEqual(plain(N.pieces(v('5/4'), 'mixed')), { sign: '', whole: '1', num: '1', den: '4' });
});

/* ---------------- grouping and words ---------------- */

test('Indian and international grouping', () => {
  assert.equal(N.group(123456, 'indian'), '1,23,456');
  assert.equal(N.group(123456, 'international'), '123,456');
  assert.equal(N.group(12345678, 'indian'), '1,23,45,678');
  assert.equal(N.group(12345678, 'international'), '12,345,678');
  assert.equal(N.group(1000, 'indian'), '1,000');
  assert.equal(N.group(999, 'indian'), '999');
  assert.equal(N.group(-100000, 'indian'), '−1,00,000');
  assert.equal(N.group(1000000000, 'indian'), '1,00,00,00,000');
});

test('numbers in words, with lakh and crore', () => {
  assert.equal(N.words(52, 'indian'), 'fifty-two');
  assert.equal(N.words(3452, 'indian'), 'three thousand four hundred fifty-two');
  assert.equal(N.words(123456, 'indian'), 'one lakh twenty-three thousand four hundred fifty-six');
  assert.equal(N.words(123456, 'international'), 'one hundred twenty-three thousand four hundred fifty-six');
  assert.equal(N.words(12345678, 'indian'), 'one crore twenty-three lakh forty-five thousand six hundred seventy-eight');
  assert.equal(N.words(12345678, 'international'), 'twelve million three hundred forty-five thousand six hundred seventy-eight');
  assert.equal(N.words(1500000000, 'indian'), 'one hundred fifty crore');
  assert.equal(N.words(0, 'indian'), 'zero');
});

/* ---------------- fraction shapes ---------------- */

const BAR4 = { mode: 'fraction', shape: 'bar', parts: 4 };

test('fraction specs: shapes, parts and starting shading', () => {
  assert.deepEqual(N.cleanSpec(BAR4), { mode: 'fraction', shapes: [{ shape: 'bar', parts: 4, shaded: [] }] });
  assert.deepEqual(N.cleanSpec({ shape: 'pie', parts: 8, shaded: 3 }).shapes[0], { shape: 'circle', parts: 8, shaded: [0, 1, 2] }, 'the mode is worked out; a pie is a circle');
  assert.deepEqual(N.cleanSpec({ mode: 'fraction', shape: 'grid', parts: 12 }).shapes[0], { shape: 'grid', parts: 12, rows: 3, cols: 4, shaded: [] });
  assert.deepEqual(N.cleanSpec({ mode: 'fraction', shape: 'grid', rows: 10, cols: 10, shaded: '37/100' }).shapes[0].shaded.length, 37);
  const two = N.cleanSpec({ mode: 'fraction', shapes: [{ shape: 'bar', parts: 2, shaded: [1], fixed: true }, { shape: 'bar', parts: 4 }], join: 'add' });
  assert.equal(two.join, 'add');
  assert.equal(two.shapes[0].fixed, true);
  assert.deepEqual(N.cleanSpec(two), two, 'a clean spec stays the same when checked again');
});

test('fraction specs that would not work say what to change', () => {
  const why = (s, g) => numbers.why(s, g);
  assert.match(why({ mode: 'fraction', shape: 'bar', parts: 20 }), /a bar has at most 12 parts .*use a "grid"/);
  assert.match(why({ mode: 'fraction', shape: 'grid', parts: 13 }), /13 parts can't be laid out as a grid/);
  assert.match(why({ mode: 'fraction', shape: 'bar', parts: 1 }), /cut it into 2 or more/);
  assert.match(why({ mode: 'fraction', shape: 'hexagon', parts: 4 }), /"shape" is "bar", "circle" or "grid"/);
  assert.match(why({ mode: 'fraction', shape: 'bar', parts: 4, shaded: 5 }), /"shaded" is how many of its 4 parts/);
  assert.match(why({ mode: 'fraction', shape: 'bar', parts: 4, fixed: true }), /every shape is "fixed", so there is nothing to try/);
  assert.match(why({ mode: 'fraction', shape: 'grid', rows: 2, cols: 3, parts: 8 }), /2 rows of 3 make 6 parts, but "parts" is 8/);
});

test('fraction tasks: the goal must fit the parts, and not be done already', () => {
  const t = N.cleanTask(BAR4, { type: 'shade', value: '3/4' });
  assert.deepEqual(t.goal, { type: 'shade', value: '3/4', shape: 0 });
  assert.equal(numbers.why({ ...BAR4, parts: 6 }, { type: 'shade', value: '3/4' }),
    'the bar is cut into 6 equal parts, so 3/4 can\'t be shaded on it (it would be 4.5 parts); cut it into 4, 8 or 12 parts');
  assert.deepEqual(N.cleanTask({ mode: 'fraction', shape: 'circle', parts: 6 }, { type: 'shade', value: '2/3' }).goal.value, '2/3', 'a fraction equal to 2/3 on a shape cut into 6');
  assert.deepEqual(N.cleanTask(BAR4, { type: 'shade', value: '1/2 + 1/4' }).goal, { type: 'shade', value: '3/4', shape: 0, as: '1/2 + 1/4' });
  assert.match(numbers.why({ ...BAR4, shaded: 3 }, { type: 'shade', value: '3/4' }), /already show the answer/);
  assert.match(numbers.why(BAR4, { type: 'shade', value: '5/4' }), /at most 1 whole/);
  assert.match(numbers.why(BAR4, { type: 'shade', value: 0 }), /more than 0/);
  assert.match(numbers.why({ mode: 'fraction', shapes: [{ shape: 'bar', parts: 3 }, { shape: 'bar', parts: 4 }] }, { type: 'equal' }), /3 parts and 4 parts can't show equal fractions/);
  assert.match(numbers.why({ mode: 'fraction', shapes: [{ shape: 'bar', parts: 2, shaded: 1, fixed: true }, { shape: 'bar', parts: 3 }] }, { type: 'equal' }), /fixed at 1\/2, which a bar of 3 parts can't show/);
  const sum = N.cleanTask({ mode: 'fraction', shapes: [{ shape: 'bar', parts: 4 }, { shape: 'bar', parts: 4 }] }, { type: 'shade', value: '5/4', sum: true });
  assert.deepEqual(sum.goal, { type: 'shade', value: '5/4', sum: true });
  assert.deepEqual(plain(N.solution(sum.spec, sum.goal)), { shaded: [[0, 1, 2, 3], [0]] });
});

test('fraction attempts are checked as fractions, whichever parts are shaded', () => {
  const t = N.cleanTask({ mode: 'fraction', shape: 'circle', parts: 6 }, { type: 'shade', value: '2/3' });
  assert.equal(N.check(t.spec, t.goal, { shaded: [[5, 1, 3, 0]] }).correct, true, 'any 4 of the 6 parts');
  const wrong = N.check(t.spec, t.goal, { shaded: [[0, 1, 2]] });
  assert.deepEqual(plain(wrong), { correct: false, empty: false, why: { code: 'shade', shape: 0, k: 3, n: 6, got: '1/2', want: '2/3', as: '' } });
  assert.equal(N.check(t.spec, t.goal, { shaded: [[]] }).invalid, true, 'nothing shaded is not an attempt');
  assert.equal(N.check(t.spec, t.goal, { shaded: [[0, 0, 1, 2]] }).invalid, true, 'a part twice: not a real attempt');
  assert.equal(N.check(t.spec, t.goal, { shaded: [[9]] }).invalid, true);
  assert.equal(N.check(t.spec, t.goal, null).invalid, true);
  const eq = N.cleanTask({ mode: 'fraction', shapes: [{ shape: 'bar', parts: 3 }, { shape: 'bar', parts: 6 }] }, { type: 'equal' });
  assert.equal(N.check(eq.spec, eq.goal, { shaded: [[0, 1], [0, 1, 2, 3]] }).correct, true);
  assert.equal(N.check(eq.spec, eq.goal, { shaded: [[0], [0]] }).why.code, 'equal');
  assert.equal(N.check(eq.spec, eq.goal, { shaded: [[0, 1, 2], [0, 1, 2, 3, 4, 5]] }).why.code, 'equal-edge', 'all of each is not the point');
});

/* ---------------- the number line ---------------- */

test('number lines: ticks that fit, labels, decimals and negatives', () => {
  const s = N.cleanSpec({ mode: 'line', from: -5, to: 5, step: 0.5, labels: 'whole' });
  assert.deepEqual(s, { mode: 'line', from: '-5', to: '5', step: '1/2', labels: 'whole', format: 'decimal' });
  assert.equal(N.ticksOf(s).length, 21);
  assert.equal(N.tickOf(s, N.value(-2.5)), 5);
  assert.equal(N.cleanSpec({ from: 0, to: 1, step: '1/5' }).format, 'fraction');
  assert.equal(N.cleanSpec({ from: 0, to: 3, step: '1/4' }).labels, 'all', 'a short line labels every tick...');
  assert.equal(N.cleanSpec({ from: 0, to: 5, step: '1/4' }).labels, 'whole', '...a longer one the whole numbers...');
  assert.equal(N.cleanSpec({ from: 0, to: 30, step: 1 }).labels, 5, '...and a long one every 5th');
  assert.match(numbers.why({ mode: 'line', from: 0, to: 1, step: '1/3', format: 'decimal' }), /can't be written as a decimal that ends/);
  assert.match(numbers.why({ mode: 'line', from: 0, to: 10, step: 3 }), /doesn't end on a tick/);
  assert.match(numbers.why({ mode: 'line', from: 0, to: 100, step: 1 }), /makes 100 steps; at most 40/);
  assert.match(numbers.why({ mode: 'line', from: 5, to: 1, step: 1 }), /"from" \(5\) must be less than "to" \(1\)/);
  assert.match(numbers.why({ mode: 'line', from: 0, to: 4, step: 1, hops: ['1/2'] }), /a jump of 1\/2 doesn't land on the ticks/);
});

test('number line tasks: the value must be on a tick (and the reason says how to fix it)', () => {
  assert.equal(numbers.why({ mode: 'line', from: 0, to: 1, step: '1/4' }, { type: 'place', value: '2/5' }),
    'the line runs from 0 to 1 in steps of 1/4, so 2/5 is not on any tick; use steps of 1/5 or 1/10');
  assert.match(numbers.why({ mode: 'line', from: 0, to: 5, step: 1 }, { type: 'place', value: 7 }), /7 is outside the line/);
  assert.match(numbers.why({ mode: 'line', from: 0, to: 5, step: 1, start: 3 }, { type: 'place', value: 3 }), /already the answer/);
  // the labels follow how the task writes its number, unless the spec says
  assert.equal(N.cleanTask({ mode: 'line', from: 0, to: 1, step: 0.2 }, { type: 'place', value: '3/5' }).spec.format, 'fraction');
  assert.equal(N.cleanTask({ mode: 'line', from: 0, to: 1, step: '1/5' }, { type: 'place', value: 0.6 }).spec.format, 'decimal');
  assert.equal(N.cleanTask({ mode: 'line', from: 0, to: 1, step: 0.2, format: 'decimal' }, { type: 'place', value: '3/5' }).spec.format, 'decimal');
  assert.equal(N.cleanTask({ mode: 'line', from: 0, to: 2, step: '1/3' }, { type: 'place', value: '1.0' }).spec.format, 'fraction', 'thirds never become decimals');
  const half = N.cleanTask({ mode: 'line', from: 0, to: 6, step: '1/2', labels: 'whole' }, { type: 'place', value: 3.5 });
  assert.deepEqual(half.goal, { type: 'place', at: ['7/2'] });
  assert.equal(N.check(half.spec, half.goal, { at: '7/2', hops: [] }).correct, true);
  assert.deepEqual(plain(N.check(half.spec, half.goal, { at: '3', hops: [] })), { correct: false, why: { code: 'place', got: '3', dir: -1 } });
  assert.equal(N.check(half.spec, half.goal, { at: '13/4', hops: [] }).invalid, true, 'between ticks: not a real attempt');
  assert.equal(N.check(half.spec, half.goal, { at: null }).invalid, true);
});

test('jumps: start, direction, size and total are each checked', () => {
  const t = N.cleanTask({ mode: 'line', from: 0, to: 10, step: 1, hops: [1, 2] }, { type: 'jumps', sum: '3 + 4' });
  assert.deepEqual(t.goal, { type: 'jumps', start: '3', by: '4' });
  const c = (v) => plain(N.check(t.spec, t.goal, v));
  assert.equal(c({ at: '3', hops: ['1', '1', '1', '1'] }).correct, true);
  assert.equal(c({ at: '3', hops: ['2', '2'] }).correct, true, 'any jumps that add up');
  assert.equal(c({ at: '3', hops: ['2', '1', '1'] }).correct, true);
  assert.equal(c({ at: '2', hops: ['2', '2'] }).why.code, 'start');
  assert.equal(c({ at: '3', hops: ['2', '2', '2', '-2'] }).why.code, 'direction', 'adding is jumping right');
  assert.equal(c({ at: '3', hops: ['2'] }).why.code, 'total');
  assert.equal(c({ at: '3', hops: [] }).invalid, true);
  assert.equal(c({ at: '3', hops: ['3'] }).invalid, true, 'a jump size the line does not offer');
  assert.equal(c({ at: '9', hops: ['2'] }).invalid, true, 'off the end of the line');
  const back = N.cleanTask({ mode: 'line', from: -5, to: 5, step: 1, hops: [1] }, { type: 'jumps', sum: '2 - 5', hop: 1 });
  assert.deepEqual(back.goal, { type: 'jumps', start: '2', by: '-5', hop: '1' });
  assert.deepEqual(plain(N.solution(back.spec, back.goal)), { at: '2', hops: ['-1', '-1', '-1', '-1', '-1'] });
  assert.match(numbers.why({ mode: 'line', from: 0, to: 10, step: 1, hops: [2] }, { type: 'jumps', sum: '3 + 5' }), /jumps of 2 can't add up to exactly 5/);
  assert.match(numbers.why({ mode: 'line', from: 0, to: 10, step: 1, hops: [1] }, { type: 'jumps', sum: '8 + 4' }), /the end, 8 \+ 4 = 12, is outside the line/);
  assert.match(numbers.why({ mode: 'line', from: 0, to: 10, step: 1 }, { type: 'jumps', sum: '3 + 4' }), /needs "hops" in the spec/);
  assert.deepEqual(plain(N.fewestHops([N.Q(1), N.Q(5)], N.Q(7), N.Q(1))).map(N.key), ['5', '1', '1']);
});

/* ---------------- place-value blocks ---------------- */

test('blocks: places, a start as a number or as counts, grouping', () => {
  assert.deepEqual(N.cleanSpec({ mode: 'blocks' }), { mode: 'blocks', places: 4, start: [0, 0, 0, 0], edit: true, trade: true });
  assert.deepEqual(N.cleanSpec({ mode: 'blocks', start: '1,23,456', grouping: 'lakh' }), { mode: 'blocks', places: 6, start: [6, 5, 4, 3, 2, 1], edit: true, trade: true, grouping: 'indian' });
  assert.deepEqual(N.cleanSpec({ mode: 'blocks', places: 2, start: { tens: 4, ones: 12 } }).start, [12, 4]);
  assert.deepEqual(N.cleanSpec({ mode: 'blocks', places: ['lakhs', 'thousands', 'ones'] }).places, 6);
  assert.match(numbers.why({ mode: 'blocks', places: 3, start: 3452 }), /needs 4 places, but "places" is 3/);
  assert.match(numbers.why({ mode: 'blocks', places: 9 }), /"places" is how many columns there are, 1 to 8/);
  assert.match(numbers.why({ mode: 'blocks', start: { tens: 40 } }), /a count of blocks from 0 to 30/);
  assert.match(numbers.why({ mode: 'blocks', start: { dozens: 2 } }), /"dozens" is not a place/);
  assert.match(numbers.why({ mode: 'blocks', edit: false, trade: false }), /nothing to do/);
});

test('blocks tasks: build a number, with the fewest blocks, or as given counts', () => {
  const b = N.cleanTask({ mode: 'blocks' }, { type: 'build', value: '3,452' });
  assert.deepEqual(b.goal, { type: 'build', value: 3452 });
  assert.equal(N.check(b.spec, b.goal, { counts: [2, 5, 4, 3] }).correct, true);
  assert.equal(N.check(b.spec, b.goal, { counts: [12, 4, 4, 3] }).correct, true, 'any blocks that make it');
  assert.deepEqual(plain(N.check(b.spec, b.goal, { counts: [5, 2, 4, 3] }).why), { code: 'value', counts: [5, 2, 4, 3], got: 3425, want: 3452 });
  assert.equal(N.check(b.spec, b.goal, { counts: [0, 0, 0, 0] }).invalid, true);
  assert.equal(N.check(b.spec, b.goal, { counts: [0, 0, 0] }).invalid, true);
  const auto = N.cleanTask({ mode: 'blocks' }, { type: 'build', value: 123456 });
  assert.equal(auto.spec.places, 6, 'with no "places", there are enough for the goal');
  const few = N.cleanTask({ mode: 'blocks', start: { hundreds: 10 } }, { type: 'build', value: 1000, fewest: true });
  assert.equal(N.check(few.spec, few.goal, { counts: [0, 0, 10, 0] }).why.code, 'fewest');
  assert.equal(N.check(few.spec, few.goal, { counts: [0, 0, 0, 1] }).correct, true);
  const trade = N.cleanTask({ mode: 'blocks', places: 2, start: 52, edit: false }, { type: 'build', counts: { tens: 4, ones: 12 } });
  assert.deepEqual(trade.goal, { type: 'build', counts: [12, 4], value: 52 });
  assert.equal(N.check(trade.spec, trade.goal, { counts: [2, 5] }).why.code, 'counts-same');
  assert.equal(N.check(trade.spec, trade.goal, { counts: [12, 4] }).correct, true);
  assert.match(numbers.why({ mode: 'blocks', start: 52, edit: false }, { type: 'build', value: 53 }), /can only bundle and break, so the number stays 52/);
  assert.match(numbers.why({ mode: 'blocks', start: 52 }, { type: 'build', value: 52 }), /already show the answer/);
  assert.match(numbers.why({ mode: 'blocks' }, { type: 'build', counts: { tens: 4, ones: 12 }, value: 53 }), /"counts" make 52, not 53/);
});

test('a clean spec and goal come out the same when checked again (as the page does with what the server kept)', () => {
  const blocks = [BAR4, { mode: 'fraction', shapes: [{ shape: 'circle', parts: 2, shaded: 1, fixed: true, label: 'Roti' }, { shape: 'grid', parts: 12 }], join: 'add', labels: true },
    { mode: 'line', from: -5, to: 5, step: 0.5, labels: 'whole', marks: [{ at: -3, label: 'A' }], start: 1, hops: [1, 2], unit: '°C', grouping: 'indian' },
    { mode: 'blocks', places: 8, start: 123456, grouping: 'indian' }, { mode: 'blocks', start: { tens: 3, ones: 14 }, edit: false }];
  for (const b of blocks) { const once = N.cleanBlock(b); assert.deepEqual(N.cleanBlock(once), once); }
  const tasks = [
    [BAR4, { type: 'shade', value: '1/2 + 1/4' }],
    [{ mode: 'fraction', shapes: [{ shape: 'bar', parts: 4 }, { shape: 'bar', parts: 4 }] }, { type: 'shade', value: '5/4', sum: true }],
    [{ mode: 'fraction', shapes: [{ shape: 'bar', parts: 3 }, { shape: 'bar', parts: 6 }] }, { type: 'shade', values: ['2/3', null] }],
    [{ mode: 'fraction', shapes: [{ shape: 'bar', parts: 3 }, { shape: 'bar', parts: 6 }] }, { type: 'equal' }],
    [{ mode: 'line', from: 0, to: 1, step: 0.2 }, { type: 'place', value: '3/5' }],
    [{ mode: 'line', from: -5, to: 5, step: 1, hops: [1] }, { type: 'jumps', sum: '-3 + 4', hop: 1 }],
    [{ mode: 'blocks', places: 8, grouping: 'indian' }, { type: 'build', value: 123456 }],
    [{ mode: 'blocks', places: 2, start: 52, edit: false }, { type: 'build', counts: { tens: 4, ones: 12 } }],
    [{ mode: 'blocks', start: { hundreds: 10 } }, { type: 'build', value: 1000, fewest: true }]
  ];
  for (const [s, g] of tasks) {
    const once = N.cleanTask(s, g);
    assert.deepEqual(N.cleanTask(once.spec, once.goal), once, JSON.stringify(g));
    const q = widgets.normTask({ type: 'task', kind: 'numbers', spec: s, goal: g }, { prompt: 'x' });
    assert.deepEqual(widgets.normTask({ type: 'task', kind: 'numbers', spec: q.spec, goal: q.goal }, { prompt: 'x' }), q, 'through the server twice');
  }
  assert.equal(N.cleanTask(BAR4, { type: 'shade', value: '3/4', as: '1/2 + 1/4' }).goal.as, '1/2 + 1/4', 'the sum it was written as is kept');
  assert.equal(N.cleanTask(BAR4, { type: 'shade', value: '3/4', as: '1/2 + 1/2' }).goal.as, undefined, '...only when it adds up');
});

/* ---------------- the server: which lessons, the prompt, the checks ---------------- */

test('it is offered to lessons on numbers, in many languages, and not to others', () => {
  const yes = ['Class 4 maths: fractions', 'Integers and the number line', 'Place value: lakhs and crores', 'class 3 maths', 'Equivalent fractions',
    'Tens and ones', 'Counting and addition', 'Decimals for grade 5 math', 'भिन्न और गणित', 'संख्या रेखा', 'स्थानीय मान', 'दशमलव संख्याएँ', 'पूर्णांक', 'लाख और करोड़',
    'ভগ্নাংশ', 'பின்னங்கள்', 'Fracciones equivalentes', 'Les nombres décimaux', 'Десятичные дроби', 'Negative numbers', 'Numerator and denominator'];
  const no = ['A fraction of the cost', 'Line of best fit in statistics', 'The French Revolution', 'The Mughals: lakhs of people', 'The first half of the twentieth century',
    'Python integers and floats', 'Fractional distillation of crude oil', 'Class 10 maths: trigonometry', 'Ohm\'s law', 'Photosynthesis', 'भिन्न-भिन्न प्रकार के पौधे', 'Music: note values'];
  for (const t of yes) assert.ok(numbers.match(t.toLowerCase()), 'should match: ' + t);
  for (const t of no) assert.ok(!numbers.match(t.toLowerCase()), 'should not match: ' + t);
  assert.ok(widgets.available().includes('numbers'));
  assert.ok(widgets.widgetKinds({ topic: 'Class 4 maths', title: 'Fractions of a whole' }).includes('numbers'));
});

test('the prompt is short, and its examples pass the checks', () => {
  assert.ok(numbers.prompt.length <= 2600, `prompt is ${numbers.prompt.length} characters`);
  const block = JSON.parse(numbers.prompt.match(/Example block: (.*)/)[1]);
  const task = JSON.parse(numbers.prompt.match(/Example task: (.*)/)[1]);
  assert.ok(widgets.normWidgetBlock(block), 'the example block');
  assert.ok(widgets.normTask(task, { prompt: task.prompt }), 'the example task');
  assert.equal(numbers.why(block.spec), '');
  assert.equal(numbers.why(task.spec, task.goal), '');
  assert.match(widgets.widgetPrompt(['numbers']), /at least two in the lesson/);
});

test('blocks and tasks through server/widgets.mjs; why() names what to fix', () => {
  assert.deepEqual(widgets.normWidgetBlock({ t: 'widget', kind: 'numbers', spec: BAR4, caption: 'Tap to shade.' }),
    { t: 'widget', kind: 'numbers', spec: { mode: 'fraction', shapes: [{ shape: 'bar', parts: 4, shaded: [] }] }, caption: 'Tap to shade.' });
  assert.equal(widgets.normWidgetBlock({ t: 'widget', kind: 'numbers', spec: { mode: 'line', from: 0, to: 1, step: 0.3 } }), null);
  const tq = widgets.normTask({ type: 'task', kind: 'numbers', spec: BAR4, goal: { type: 'shade', value: '3/4' } }, { prompt: 'Shade 3/4.' });
  assert.equal(tq.goal.value, '3/4');
  assert.equal(widgets.normTask({ type: 'task', kind: 'numbers', spec: { ...BAR4, parts: 6 }, goal: { type: 'shade', value: '3/4' } }, { prompt: 'x' }), null);
  assert.equal(numbers.why(BAR4), '');
  assert.equal(numbers.why('nonsense'), 'the spec must be an object');
  assert.match(numbers.why({ mode: 'pie chart' }), /"mode" is "fraction", "line" or "blocks"/);
  assert.match(numbers.why(BAR4, { type: 'spin' }), /"type" is "shade" or "equal"/);
  assert.equal(numbers.block({ mode: 'line', from: 0, to: 1 }), null, 'block() and task() still give null');
});

test('a lesson keeps its number parts through the lesson checks', () => {
  const para = (html) => ({ t: 'p', html });
  const lesson = ai.normalizeLesson({
    sections: [
      { title: 'Parts of a whole', blocks: [para('A whole cut into equal parts.'), { t: 'widget', kind: 'numbers', spec: BAR4, caption: 'Shade some parts.' }],
        checkpoint: [{ type: 'task', kind: 'numbers', prompt: 'Shade 3/4.', spec: BAR4, goal: { type: 'shade', value: '3/4' }, hint: 'Three of four.', explain: '3 of the 4 equal parts.' },
          { type: 'task', kind: 'numbers', prompt: 'Shade 3/4.', spec: { ...BAR4, parts: 6 }, goal: { type: 'shade', value: '3/4' } }] },
      { title: 'On a line', blocks: [para('b')] },
      { title: 'Adding', blocks: [para('c')] }
    ]
  }, 'Fractions');
  const s = lesson.sections[0];
  assert.equal(s.checkpoint.filter((x) => x.type === 'task').length, 1, 'the task that cannot be done is left out');
  assert.equal(s.blocks.filter((b) => b.t === 'widget').length, 0, 'the block alike the task is kept once, as the task');
});

test('the words on a line and on shapes go to the translator and come back', () => {
  const line = { mode: 'line', from: -10, to: 10, step: 2, marks: [{ at: -4, label: 'Shimla' }, { at: 6 }], unit: '°C' };
  assert.deepEqual(widgets.widgetTexts('numbers', line), ['Shimla', '°C']);
  const back = widgets.widgetWithTexts('numbers', line, ['शिमला', '°से']);
  assert.equal(back.marks[0].label, 'शिमला');
  assert.equal(back.unit, '°से');
  assert.equal(widgets.widgetWithTexts('numbers', line, ['one']), null);
  assert.deepEqual(widgets.widgetTexts('numbers', { mode: 'fraction', shapes: [{ parts: 2, label: 'Pizza' }, { parts: 4 }] }), ['Pizza']);
  assert.deepEqual(widgets.widgetTexts('numbers', BAR4), []);
});

/* ---------------- the browser half ---------------- */

const impls = {};
const sb = { document: { currentScript: null } };
sb.window = sb;
sb.Primer = { t: (s) => s, lang: 'en', esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), widgets: { register: (k, impl) => { impls[k] = impl; } } };
vm.createContext(sb);
vm.runInContext(readFileSync(new URL('../assets/js/widgets/numbers-core.js', import.meta.url), 'utf8'), sb);
vm.runInContext(readFileSync(new URL('../assets/js/widgets/numbers.js', import.meta.url), 'utf8'), sb);
await new Promise((r) => setTimeout(r, 20)); // it registers once its core is there
const W = impls.numbers;

test('the browser half registers, and checks attempts with kind notes', () => {
  assert.ok(W && typeof W.block === 'function' && typeof W.task === 'function' && typeof W.still === 'function');
  const goal = { type: 'shade', value: '3/4' };
  assert.deepEqual(plain(W.check(goal, { shaded: [[0, 1, 2]] }, BAR4)), { correct: true, note: '' });
  assert.equal(W.check(goal, { shaded: [[0, 1]] }, BAR4).note, 'You shaded 2 of 4 parts: that is 2/4 = 1/2. The task asks for 3/4.');
  assert.equal(W.check({ type: 'shade', value: '1/2 + 1/4' }, { shaded: [[0]] }, BAR4).note, 'You shaded 1 of 4 parts: that is 1/4. The task asks for 1/2 + 1/4.');
  assert.equal(W.check(goal, { shaded: [[]] }, BAR4).note, 'Shade some parts first.');
  assert.equal(W.check(goal, { shaded: [[]] }, BAR4).invalid, true);
  const line = { mode: 'line', from: 0, to: 6, step: '1/2', labels: 'whole' };
  assert.equal(W.check({ type: 'place', value: 3.5 }, { at: '3', hops: [] }, line).note, 'You put the marker at 3. That is too far left.');
  const jl = { mode: 'line', from: 0, to: 10, step: 1, hops: [1] };
  assert.equal(W.check({ type: 'jumps', sum: '3 + 4' }, { at: '2', hops: ['1', '1'] }, jl).note, 'Your jumps start at 2, but 3 + 4 starts at 3.');
  assert.equal(W.check({ type: 'jumps', sum: '3 + 4' }, { at: '3', hops: ['-1'] }, jl).note, 'To add, jump to the right.');
  assert.equal(W.check({ type: 'jumps', sum: '3 + 4' }, { at: '3', hops: ['1', '1'] }, jl).note, 'Your jumps make 2 in all, so you land on 5. For 3 + 4, they should make 4.');
  const bl = { mode: 'blocks', places: 2, start: 52, edit: false };
  const g = { type: 'build', counts: { tens: 4, ones: 12 } };
  assert.equal(W.check(g, { counts: [2, 5] }, bl).note, 'You have 5 tens and 2 ones: that is 52, but the task asks for 4 tens and 12 ones.');
  assert.equal(W.check({ type: 'build', value: 3452 }, { counts: [5, 2, 4, 3] }, { mode: 'blocks', grouping: 'indian' }).note, 'You made 3,425. The task asks for 3,452.');
  assert.equal(W.check({ type: 'build', value: 123456 }, { counts: [6, 5, 4, 3, 2, 2] }, { mode: 'blocks', grouping: 'indian' }).note, 'You made 2,23,456. The task asks for 1,23,456.');
  assert.equal(W.check({ type: 'build', value: 123456 }, { counts: [6, 5, 4, 3, 2, 2] }, { mode: 'blocks', grouping: 'international' }).note, 'You made 223,456. The task asks for 123,456.');
  assert.deepEqual(plain(W.check(goal, { shaded: [[0, 1, 2]] }, { mode: 'nonsense' })), { correct: false, invalid: true });
});

test('the browser half says the attempt and the answer in words', () => {
  assert.equal(W.describe({ shaded: [[0, 1]] }, BAR4), '2 of 4 parts shaded (2/4 = 1/2)');
  assert.equal(W.answer({ type: 'shade', value: '2/3' }, { mode: 'fraction', shape: 'circle', parts: 6 }), 'Shade 4 of the 6 parts: 4/6 = 2/3.');
  assert.equal(W.answer({ type: 'shade', value: '1/2 + 1/4' }, BAR4), 'Shade 3 of the 4 parts: 1/2 + 1/4 = 3/4.');
  const jl = { mode: 'line', from: 0, to: 10, step: 1, hops: [1] };
  assert.equal(W.describe({ at: '3', hops: ['1', '1'] }, jl), '3 + 1 + 1 = 5');
  assert.equal(W.answer({ type: 'jumps', sum: '3 + 4', hop: 1 }, jl), 'Start at 3 and make 4 jumps of 1 to the right: 3 + 4 = 7.');
  assert.equal(W.answer({ type: 'place', value: -2.5 }, { mode: 'line', from: -5, to: 5, step: 0.5 }), 'The marker at −2.5.');
  assert.equal(W.answer({ type: 'place', value: '7/2' }, { mode: 'line', from: 0, to: 6, step: '1/2' }), 'The marker at 7/2 = 3 1/2.');
  assert.equal(W.answer({ type: 'build', value: 3452 }, { mode: 'blocks' }), '3 thousands, 4 hundreds, 5 tens, and 2 ones: 3,452.');
  assert.equal(W.answer({ type: 'build', value: 1000, fewest: true }, { mode: 'blocks', start: { hundreds: 10 } }), '1 thousand: 1,000.');
  assert.equal(W.describe({ counts: [12, 4] }, { mode: 'blocks', places: 2 }), '4 tens and 12 ones: 52');
});

test('still pictures for the book: plain SVG, words escaped', () => {
  for (const spec of [BAR4, { mode: 'fraction', shapes: [{ shape: 'circle', parts: 2, shaded: 1, label: '<b>Roti</b>' }, { shape: 'grid', rows: 2, cols: 5 }] },
    { mode: 'line', from: -5, to: 5, step: 1, marks: [{ at: -3, label: 'A&B' }], start: 2 }, { mode: 'line', from: 0, to: 6, step: '1/2', marks: [{ at: 2 }, { at: 5, label: '5' }] },
    { mode: 'blocks', start: 123456, grouping: 'indian' }]) {
    const svg = W.still(spec, null);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.ok(!/<b>|<script|on\w+=/i.test(svg), 'no markup from the spec');
  }
  assert.match(W.still({ mode: 'fraction', shapes: [{ shape: 'circle', parts: 2, label: '<b>Roti</b>' }, { shape: 'bar', parts: 2 }] }), />Roti</, 'tags are taken out of labels');
  assert.match(W.still({ mode: 'line', from: 0, to: 4, step: 1, marks: [{ at: 1, label: 'A&B' }] }), /A&amp;B/);
  assert.equal(W.still({ mode: 'line', from: 0, to: 1, step: 0.3 }), '', 'a spec that does not hold together draws nothing');
});
