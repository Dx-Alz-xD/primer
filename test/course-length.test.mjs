// Course length (server/length.mjs) and how an AI outline is held to it (normalizeOutline in
// server/ai.mjs). Pure functions: no network, no database.   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLength, lengthKey, lengthRule, enforceLength, fitLength } from '../server/length.mjs';
import { normalizeOutline } from '../server/ai.mjs';

// An AI-style reply: `sizes` lessons per unit, each `minutes` long.
const reply = (sizes, minutes = 15) => ({
  title: 'Test course',
  units: sizes.map((k, u) => ({ title: `Unit ${u + 1}`, lessons: Array.from({ length: k }, (_, i) => ({ title: `U${u + 1} L${i + 1}`, desc: 'x', minutes })) }))
});
const titles = (o) => o.units.flatMap((u) => u.lessons.map((l) => l.title));
const total = (o) => titles(o).length;
const minutes = (o) => o.units.reduce((m, u) => m + u.lessons.reduce((a, l) => a + l.minutes, 0), 0);

test('cleanLength accepts the three kinds and nothing else', () => {
  assert.deepEqual(cleanLength({ kind: 'concise' }), { kind: 'concise' });
  assert.deepEqual(cleanLength({ kind: 'lessons', n: '20' }), { kind: 'lessons', n: 20 });
  assert.deepEqual(cleanLength({ kind: 'lessons', n: 900 }), { kind: 'lessons', n: 150 });
  assert.deepEqual(cleanLength({ kind: 'minutes', n: 3 }), { kind: 'minutes', n: 10 });
  assert.deepEqual(cleanLength({ kind: 'minutes', n: 99999 }), { kind: 'minutes', n: 3000 });
  for (const bad of [null, '', 'concise', { kind: 'lessons' }, { kind: 'lessons', n: 0 }, { kind: 'lessons', n: 'many' }, { kind: 'pages', n: 3 }]) {
    assert.equal(cleanLength(bad), null, JSON.stringify(bad));
  }
});

test('the cache key only changes when a length is set', () => {
  assert.deepEqual(lengthKey(null), {});
  assert.deepEqual(lengthKey({ kind: 'concise' }), { len: 'concise' });
  assert.deepEqual(lengthKey({ kind: 'lessons', n: 8 }), { len: 'l8' });
  assert.deepEqual(lengthKey({ kind: 'minutes', n: 180 }), { len: 'm180' });
});

test('the prompt states the length as a firm rule', () => {
  assert.equal(lengthRule(null), '');
  assert.match(lengthRule({ kind: 'concise' }), /Exactly ONE unit with 1 to 5 lessons/);
  assert.match(lengthRule({ kind: 'lessons', n: 20 }), /exactly 20 lessons in all/);
  assert.match(lengthRule({ kind: 'minutes', n: 180 }), /about 3 hours .*between 162 and 198/);
  assert.match(lengthRule({ kind: 'minutes', n: 45 }), /about 45 minutes/);
  assert.match(lengthRule({ kind: 'lessons', n: 8 }, { syllabus: true }), /syllabus/);
});

test('without a length nothing changes: a reply under 5 lessons is still refused', () => {
  assert.throws(() => normalizeOutline(reply([4])), /only 4 lessons/);
  assert.equal(total(normalizeOutline(reply([8, 8, 8]))), 24);
});

test('concise: one unit of at most 5 lessons', () => {
  const o = normalizeOutline(reply([3, 3]), { kind: 'concise' });
  assert.equal(o.units.length, 1);
  assert.equal(total(o), 5);
  assert.equal(titles(o)[0], 'U1 L1'); // the first lesson stays
  assert.equal(titles(o).at(-1), 'U2 L3'); // and the last
  assert.equal(o.units[0].title, 'Test course'); // several units become one, named after the course
  assert.equal(total(normalizeOutline(reply([3]), { kind: 'concise' })), 3); // 3 lessons is fine (1 to 5)
  assert.throws(() => normalizeOutline(reply([4, 5]), { kind: 'concise' }), /concise/); // far off: ask again
  assert.equal(total(normalizeOutline(reply([4, 5]), { kind: 'concise' }, { lenient: true })), 5);
});

test('a number of lessons: trimmed when a little long, asked again when far off', () => {
  const len = { kind: 'lessons', n: 20 };
  const o = normalizeOutline(reply([6, 6, 6, 4]), len);
  assert.equal(total(o), 20);
  assert.equal(titles(o)[0], 'U1 L1');
  assert.equal(titles(o).at(-1), 'U4 L4');
  assert.equal(total(normalizeOutline(reply([5, 5, 5, 5]), len)), 20);
  assert.throws(() => normalizeOutline(reply([10, 10, 10]), len), /asked for 20 lessons, got 30/);
  assert.equal(total(normalizeOutline(reply([10, 10, 10]), len, { lenient: true })), 20);
  assert.throws(() => normalizeOutline(reply([9, 9]), len), /got 18/); // short: the first reply must have them all
  assert.equal(total(normalizeOutline(reply([9, 9]), len, { lenient: true })), 18); // a later one may be a little short
  assert.throws(() => normalizeOutline(reply([5, 5]), len, { lenient: true }), /got 10/);
  // a few lessons go in one unit, and fewer than 5 is allowed
  const three = normalizeOutline(reply([2, 2]), { kind: 'lessons', n: 3 });
  assert.equal(total(three), 3);
  assert.equal(three.units.length, 1);
  assert.equal(total(normalizeOutline(reply([60, 60, 30]), { kind: 'lessons', n: 150 })), 150);
});

test('a time budget: lesson minutes add up to it, within 15%', () => {
  const len = { kind: 'minutes', n: 180 };
  assert.equal(minutes(normalizeOutline(reply([4, 4, 4]), len)), 180);
  const long = normalizeOutline(reply([5, 5, 5]), len); // 225 minutes
  assert.ok(minutes(long) <= 207 && minutes(long) >= 153, `got ${minutes(long)}`);
  assert.throws(() => normalizeOutline(reply([5, 5]), len), /asked for 180 minutes, got 150/);
  assert.equal(minutes(normalizeOutline(reply([5, 5]), len, { lenient: true })), 150);
  assert.throws(() => normalizeOutline(reply([4, 4], 15), len, { lenient: true }), /got 120/);
  assert.throws(() => normalizeOutline(reply([10, 10, 10]), len), /got 450/); // far over: ask again
  // a short budget: 45 minutes is three lessons of 15
  const short = normalizeOutline(reply([2, 2]), { kind: 'minutes', n: 45 });
  assert.equal(minutes(short), 45);
  assert.equal(total(short), 3);
});

test('enforceLength keeps each unit\'s opening lesson where it can', () => {
  const units = reply([3, 3, 3]).units.map((u) => ({ ...u, lessons: u.lessons.map((l) => ({ ...l })) }));
  const out = enforceLength(units, { kind: 'lessons', n: 6 });
  assert.deepEqual(out.map((u) => u.lessons[0].title), ['U1 L1', 'U2 L1', 'U3 L1']);
  assert.equal(units.reduce((n, u) => n + u.lessons.length, 0), 9); // the input isn't changed
});

test('fitLength says whether an existing outline (a library slice) fits, without cutting it', () => {
  const u = (sizes, m) => reply(sizes, m).units;
  assert.equal(fitLength(u([3, 2]), { kind: 'concise' }, { title: 'All of it' })[0].title, 'All of it');
  assert.equal(fitLength(u([3, 3]), { kind: 'concise' }), null);
  assert.ok(fitLength(u([10, 10]), { kind: 'lessons', n: 20 }));
  assert.ok(fitLength(u([10, 9]), { kind: 'lessons', n: 20 })); // within 10%
  assert.equal(fitLength(u([10, 5]), { kind: 'lessons', n: 20 }), null);
  assert.ok(fitLength(u([6, 6], 15), { kind: 'minutes', n: 180 }));
  assert.equal(fitLength(u([10, 10], 15), { kind: 'minutes', n: 180 }), null);
  assert.ok(fitLength(u([10, 10], 15), null));
});
