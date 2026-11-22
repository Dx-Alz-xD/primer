// The "arrange" cards: what the server keeps (server/widgets/arrange.mjs, through server/widgets.mjs
// and the lesson checks in server/ai.mjs), and how the browser half checks and describes an attempt
// (assets/js/widgets/arrange.js, run here without a page).   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import vm from 'node:vm';

const DB = path.join(os.tmpdir(), `primer-arrange-${process.pid}.db`);
process.env.PRIMER_DB = DB;
test.after(() => { for (const f of [DB, DB + '-wal', DB + '-shm']) rmSync(f, { force: true }); });

const arrange = await import('../server/widgets/arrange.mjs');
const widgets = await import('../server/widgets.mjs');
const ai = await import('../server/ai.mjs');

const ORDER = { mode: 'order', items: ['Seed', 'Sprout', 'Young plant', 'Flowering plant'] };
const MATCH = { mode: 'match', pairs: [['Lungs', 'Breathing'], ['Heart', 'Pumping blood'], ['Stomach', 'Digesting food']] };
const GROUP = { mode: 'group', groups: [{ name: 'Living', items: ['Tree', 'Cat'] }, { name: 'Non-living', items: ['Stone', 'Water'] }] };

test('good specs are kept as they are', () => {
  assert.deepEqual(arrange.block(ORDER), ORDER);
  assert.deepEqual(arrange.block(MATCH), MATCH);
  assert.deepEqual(arrange.block(GROUP), GROUP);
  assert.deepEqual(arrange.task(ORDER, {}), { spec: ORDER, goal: {} });
  // the mode can be worked out from the shape; HTML and stray spaces are taken out of cards
  assert.deepEqual(arrange.block({ items: ['<b>One</b>', ' Two  ', 'Three'] }), { mode: 'order', items: ['One', 'Two', 'Three'] });
  assert.deepEqual(arrange.block({ pairs: [{ left: 'a', right: '1' }, { left: 'b', right: '2' }, { left: 'c', right: '3' }] }).pairs[2], ['c', '3']);
});

test('specs that would not make a fair activity are left out', () => {
  assert.equal(arrange.block({ mode: 'order', items: ['One', 'Two'] }), null, 'too few');
  assert.equal(arrange.block({ mode: 'order', items: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }), null, 'too many');
  assert.equal(arrange.block({ mode: 'order', items: ['Same', 'same', 'Other'] }), null, 'two cards alike');
  assert.equal(arrange.block({ mode: 'order', items: ['One', '', 'Three'] }), null, 'an empty card');
  assert.equal(arrange.block({ mode: 'order', items: ['One', 'x'.repeat(91), 'Three'] }), null, 'a card far too long');
  assert.equal(arrange.block({ mode: 'match', pairs: [['a', '1'], ['b', '1'], ['c', '3']] }), null, 'two rights alike');
  assert.equal(arrange.block({ mode: 'group', groups: [{ name: 'Only', items: ['a', 'b', 'c', 'd'] }] }), null, 'one group');
  assert.equal(arrange.block({ mode: 'group', groups: [{ name: 'A', items: ['x', 'y'] }, { name: 'B', items: ['x', 'z'] }] }), null, 'an item in two groups');
  assert.equal(arrange.block({ mode: 'group', groups: [{ name: 'A', items: ['x'] }, { name: 'B', items: ['y'] }] }), null, 'too few items');
  assert.equal(arrange.block({ mode: 'spin' }), null);
  assert.equal(arrange.block('order'), null);
});

test('it is offered to every lesson, and the prompt asks for it only where it fits', () => {
  assert.ok(widgets.available().includes('arrange'));
  assert.ok(widgets.widgetKinds({ topic: 'The French Revolution', title: 'Causes' }).includes('arrange'));
  const alone = widgets.widgetPrompt(['arrange']);
  assert.match(alone, /Leave it out only if nothing in this lesson can be put in order/);
  assert.doesNotMatch(alone, /hands-on lesson/);
  assert.match(alone, /Kind "arrange"/);
});

test('why a spec is left out, in words the AI can fix it from', () => {
  assert.equal(arrange.why(ORDER), '');
  assert.match(arrange.why({ mode: 'order', items: ['One', 'Two'] }), /3 to 7 items; this has 2/);
  assert.match(arrange.why({ mode: 'order', items: ['One', 'Two', 'one'] }), /appears twice/);
  assert.match(arrange.why({ mode: 'match', pairs: [['a', '1'], ['b', '2']] }), /3 to 6 pairs/);
  assert.match(arrange.why({ mode: 'order', items: ['One', 'Two', 'x'.repeat(120)] }), /longer than 90 characters/);
  assert.match(arrange.why({ cards: [] }), /"mode" must be/);
  // through the registry, as the lesson writer asks
  assert.match(widgets.widgetWhy('arrange', { mode: 'group', groups: [{ name: 'A', items: ['x'] }] }, {}), /2 to 4 groups/);
  assert.match(widgets.widgetWhy('nope', {}), /no interactive part called "nope"/);
});

test('a lesson keeps the parts that failed, with where they were, so they can be sent back to be fixed', () => {
  const bad = { t: 'widget', kind: 'arrange', spec: { mode: 'order', items: ['One'] } };
  const badTask = { type: 'task', kind: 'arrange', prompt: 'Order them.', spec: { mode: 'match', pairs: [] }, goal: {} };
  const raw = {
    sections: [
      { title: 'One', blocks: [{ t: 'p', html: 'First.' }, bad, { t: 'p', html: 'After.' }], checkpoint: [{ type: 'numeric', prompt: '2 + 2?', answer: 4 }, badTask] },
      { title: 'Two', blocks: [bad], checkpoint: [{ type: 'choice', prompt: 'Pick', choices: ['a', 'b'], answer: 0 }] },
      { title: 'Three', blocks: [{ t: 'p', html: 'Last.' }], checkpoint: [] }
    ]
  };
  const failed = [];
  const lesson = ai.normalizeLesson(raw, 'Test', failed);
  assert.equal(failed.length, 3);
  assert.deepEqual(failed.map((f) => f.where), ['block', 'task', 'block']);
  assert.equal(failed[0].section, lesson.sections[0]);
  assert.equal(failed[0].after, lesson.sections[0].blocks[0]); // it came after "First."
  assert.equal(failed[1].after, lesson.sections[0].checkpoint[0]);
  assert.equal(failed[2].after, null); // first in its section
  assert.equal(failed[0].raw, bad);
  // without the array, nothing changes
  assert.equal(ai.normalizeLesson(raw, 'Test').sections.length, 3);
});

test('a task with no goal is kept: its answer is the spec', () => {
  const q = widgets.normTask({ type: 'task', kind: 'arrange', spec: ORDER }, { id: 'q1', prompt: 'Put them in order.' });
  assert.deepEqual(q, { type: 'task', kind: 'arrange', id: 'q1', prompt: 'Put them in order.', spec: ORDER, goal: {} });
  assert.equal(widgets.normTask({ type: 'task', kind: 'arrange', spec: { mode: 'order', items: ['a'] } }, {}), null);
});

test('a lesson keeps its card tasks and blocks through the lesson checks', () => {
  const lesson = ai.normalizeLesson({
    sections: [{
      title: 'How a plant grows',
      blocks: [{ t: 'p', html: 'Plants grow in stages.' }, { t: 'widget', kind: 'arrange', spec: GROUP, caption: 'Sort these.' }],
      checkpoint: [{ type: 'task', kind: 'arrange', prompt: 'Put the stages in order.', spec: ORDER, hint: 'Start small.', explain: 'A seed sprouts first.' }]
    }, {
      title: 'What a plant needs',
      blocks: [{ t: 'p', html: 'Water, light and air.' }]
    }, {
      title: 'Seeds travel',
      blocks: [{ t: 'p', html: 'Wind and animals carry seeds.' }]
    }]
  }, 'Plants');
  const s = lesson.sections[0];
  assert.deepEqual(s.blocks[1], { t: 'widget', kind: 'arrange', spec: GROUP, caption: 'Sort these.' });
  assert.equal(s.checkpoint[0].type, 'task');
  assert.deepEqual(s.checkpoint[0].spec, ORDER);
  assert.deepEqual(s.checkpoint[0].goal, {});
});

test('the words on the cards go to the translator and come back into the spec', () => {
  assert.deepEqual(widgets.widgetTexts('arrange', MATCH), ['Lungs', 'Breathing', 'Heart', 'Pumping blood', 'Stomach', 'Digesting food']);
  assert.deepEqual(widgets.widgetTexts('arrange', GROUP), ['Living', 'Tree', 'Cat', 'Non-living', 'Stone', 'Water']);
  assert.deepEqual(widgets.widgetWithTexts('arrange', GROUP, ['सजीव', 'पेड़', 'बिल्ली', 'निर्जीव', 'पत्थर', 'पानी']),
    { mode: 'group', groups: [{ name: 'सजीव', items: ['पेड़', 'बिल्ली'] }, { name: 'निर्जीव', items: ['पत्थर', 'पानी'] }] });
  assert.equal(widgets.widgetWithTexts('arrange', GROUP, ['only', 'three', 'words']), null, 'a short list keeps the original');
  assert.deepEqual(widgets.widgetTexts('chess', { fen: 'x' }), [], 'other kinds have no words to translate');
});

test('the same cards shown as a block and asked as a task are kept once, as the task', () => {
  const para = (html) => ({ t: 'p', html });
  const lesson = ai.normalizeLesson({
    sections: [
      { title: 'One', blocks: [para('a'), { t: 'widget', kind: 'arrange', spec: ORDER, caption: 'Order these.' }, { t: 'widget', kind: 'arrange', spec: GROUP }, { t: 'widget', kind: 'arrange', spec: GROUP }] },
      { title: 'Two', blocks: [para('b')], checkpoint: [{ type: 'task', kind: 'arrange', prompt: 'Order them.', spec: ORDER }] },
      { title: 'Three', blocks: [para('c')] }
    ]
  }, 'Test');
  const kept = lesson.sections[0].blocks.filter((b) => b.t === 'widget');
  assert.equal(kept.length, 1, 'the order block (asked later) and the second group block go');
  assert.equal(kept[0].spec.mode, 'group');
  assert.equal(lesson.sections[1].checkpoint[0].type, 'task');
});

/* ---------------- the browser half ---------------- */

const impls = {};
const sandbox = { window: { Primer: { t: (s) => s, esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), widgets: { register: (k, impl) => { impls[k] = impl; } } } } };
vm.runInNewContext(readFileSync(new URL('../assets/js/widgets/arrange.js', import.meta.url), 'utf8'), sandbox);
const A = impls.arrange;
const plain = (x) => JSON.parse(JSON.stringify(x)); // objects from the sandbox, compared as plain data

test('the browser half registers and checks an attempt', () => {
  assert.ok(A && typeof A.block === 'function' && typeof A.task === 'function');
  assert.deepEqual(plain(A.check({}, { at: [0, 1, 2, 3] }, ORDER)), { correct: true });
  const wrong = A.check({}, { at: [1, 0, 2, 3] }, ORDER);
  assert.equal(wrong.correct, false);
  assert.equal(wrong.note, '2 of 4 are in the right place.');
  const half = A.check({}, { at: [0, null, 2, 3] }, ORDER);
  assert.equal(half.invalid, true);
  assert.equal(half.note, 'Place every card first.');
  assert.equal(A.check({}, { at: [0, 1] }, ORDER).invalid, true, 'a value of the wrong size is not an attempt');
  assert.equal(A.check({}, { at: [0, 1, 1] }, MATCH).note, '2 of 3 pairs are right.');
  assert.deepEqual(plain(A.check({}, { at: [0, 0, 1, 1] }, GROUP)), { correct: true });
  assert.equal(A.check({}, { at: [0, 1, 1, 1] }, GROUP).note, '3 of 4 cards are in the right group.');
});

test('the browser half says the attempt and the answer in words, and draws a still', () => {
  assert.equal(A.answer({}, ORDER), 'Seed → Sprout → Young plant → Flowering plant');
  assert.equal(A.describe({ at: [1, 0, null, null] }, ORDER), 'Sprout → Seed → … → …');
  assert.equal(A.answer({}, MATCH), 'Lungs – Breathing; Heart – Pumping blood; Stomach – Digesting food');
  assert.equal(A.answer({}, GROUP), 'Living: Tree, Cat; Non-living: Stone, Water');
  const pic = A.still({ mode: 'order', items: ['<i>a</i>', 'b', 'c'] });
  assert.match(pic, /arr-still--order/);
  assert.ok(!pic.includes('<i>'), 'card words are escaped');
  assert.match(A.still(MATCH), /\(a\)/);
});
