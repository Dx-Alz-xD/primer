// "Check my working" (server/working.mjs): the exact step checker (sums, chains of rewritings, an
// equation against the one before it, units, rounding, unreadable lines), putting it together with the
// model's judgement (carried-forward errors, the first wrong step, the final answer), and the routes
// (photos checked by their bytes, the question from the stored lesson, the daily limit, the learning
// loop). The vision and text models are fakes: no network, no real keys, a throwaway database.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { Readable } from 'node:stream';

const DB = path.join(os.tmpdir(), `primer-working-${process.pid}.db`);
process.env.PRIMER_DB = DB;
process.env.GEM_KEY = 'test-key-not-real'; // a provider that can read photos, so the routes are on; the calls are fakes
for (const k of ['GROQ_KEY', 'GROQ_API_KEY', 'ADAP', 'ADAPTION_API_KEY', 'REQ_KEY', 'REQUESTY_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'PRIMER_AI_ORDER', 'PRIMER_VISION_ORDER']) delete process.env[k];
const W = await import('../server/working.mjs');
const { db, q } = await import('../server/db.mjs');
const { AIError } = await import('../server/ai.mjs');
test.after(() => {
  db.close();
  for (const f of [DB, DB + '-wal', DB + '-shm']) rmSync(f, { force: true });
});

const steps = (...lines) => lines.map((l, i) => (typeof l === 'string' ? { n: i + 1, text: '', tex: l, unclear: false } : { n: i + 1, text: '', tex: '', unclear: false, ...l }));
const check = (...lines) => W.checkSteps(steps(...lines));
const statuses = (r) => r.map((o) => o.status);

/* ---------------- the exact checker: sums and chains ---------------- */

test('a correct solution: every line follows from the one before, exactly', () => {
  const r = check('2x + 3 = 11', '2x = 11 - 3', '2x = 8', 'x = \\frac{8}{2}', 'x = 4');
  assert.deepEqual(statuses(r), [null, 'ok', 'ok', 'ok', 'ok']);
  assert.ok(r.slice(1).every((o) => o.linked), 'each line is shown to follow from the one before it');
});

test('a chain of sums, carried on over lines that start with "="', () => {
  const r = check('v = 20 + 2 \\times 5', '= 20 + 10', '= 30\\,\\text{m/s}');
  assert.deepEqual(statuses(r), [null, 'ok', 'ok']);
  assert.ok(r[1].linked && r[2].linked);
  assert.deepEqual(statuses(check('3 \\times 4 = 12', '\\sqrt{16} + 2^{3} = 12', '3 \\times 10^{8} \\times 2 = 6 \\times 10^{8}', '\\sin 30^\\circ = 0.5')), ['ok', 'ok', 'ok', 'ok']);
});

test('an arithmetic slip is caught with certainty, and says what it should have been', () => {
  const [o] = check('3 \\times 4 = 13');
  assert.equal(o.status, 'wrong');
  assert.deepEqual({ kind: o.reason.kind, value: o.reason.value, wrote: o.reason.wrote }, { kind: 'arith', value: '12', wrote: '13' });
  const r = check('3 \\times 12 = 36', '4 \\times 25 = 110', '36 + 110 = 146');
  assert.deepEqual(statuses(r), ['ok', 'wrong', 'ok'], 'the later sum is right in itself');
  assert.equal(r[1].reason.value, '100');
  assert.equal(check('= 8 \\times 5', '= 45')[1].status, 'wrong', 'a slip on a line that carries on');
  // read as the words "Total" and the maths "= 36 + 110": the words are its left side, not the line above
  const named = W.checkSteps(steps('4 \\times 25 = 110', { text: 'Total', tex: '= 36 + 110' }, '= 146'));
  assert.deepEqual(statuses(named), ['wrong', null, 'ok']);
  assert.equal(W.checkSteps(steps('2x = 4', { text: 'so', tex: '= 5' }))[1].status, 'wrong', '"so = 5" does carry on');
});

test('a slip inside a chain of rewritings with letters', () => {
  const r = check('(x+1)^2', '= x^2 + 2x + 1', '= x^2 + x + 1');
  assert.deepEqual(statuses(r), [null, 'ok', 'wrong']);
  assert.equal(r[2].reason.kind, 'identity');
  assert.equal(r[2].reason.at, 'x = 2', 'shown at a tidy value');
  assert.deepEqual([r[2].reason.value, r[2].reason.wrote], ['9', '7']);
  assert.equal(check('2(x + 3) = 2x + 6 = 2x + 3')[0].status, 'wrong', 'an expansion slip in one line');
  assert.equal(check('x = 2a + 3a = 5a')[0].status, 'ok', '"5a" is 5 lots of a here, not 5 amperes');
});

test('rounding the way it was written counts as right; a real difference does not', () => {
  assert.deepEqual(statuses(check('\\frac{10}{3} = 3.33', '\\frac{10}{3} = 3.3', '\\pi \\times 7^{2} = 153.86', '3.14 \\times 49 = 153.86')), ['ok', 'ok', 'ok', 'ok']);
  assert.equal(check('\\frac{10}{3} = 3.33')[0].rounded, true);
  assert.equal(check('\\frac{7}{2} = 3')[0].status, 'wrong', '3.5 doesn’t round to 3');
  assert.equal(check('12.5 \\times 4 = 50.04')[0].status, 'wrong');
  assert.equal(check('x = \\frac{7}{3}', 'x = 2.33')[1].status, 'ok', 'an answer rounded from the line before');
});

/* ---------------- the exact checker: an equation against the one before ---------------- */

test('a broken transformation (2x + 3 = 7 to 2x = 10) is caught, and the line after it follows from it', () => {
  const r = check('2x + 3 = 7', '2x = 10', 'x = 5');
  assert.deepEqual(statuses(r), [null, 'wrong', 'ok']);
  assert.deepEqual({ kind: r[1].reason.kind, name: r[1].reason.name, before: r[1].reason.before, after: r[1].reason.after, prev: r[1].reason.prev },
    { kind: 'solve', name: 'x', before: '2', after: '5', prev: 1 });
  assert.equal(r[2].linked, true, 'x = 5 is right given 2x = 10: the slip carries forward');
  assert.equal(check('5x - 4 = 2x + 8', '3x = 4')[1].status, 'wrong');
  assert.deepEqual(statuses(check('5x - 4 = 2x + 8', '3x = 12', 'x = 4')), [null, 'ok', 'ok']);
});

test('formulas with several letters: a correct rearrangement is checked; a doubtful one is left to the model', () => {
  const r = check('v = u + at', 'v - u = at', 'a = \\frac{v - u}{t}', 'a = \\frac{v + u}{t}');
  assert.deepEqual(statuses(r), [null, 'ok', 'ok', null]);
  assert.equal(r[3].note.kind, 'follow', 'with two letters a new equation may be another given one');
  const sim = check('x + y = 5', 'x - y = 1', '2x = 6', 'x = 3');
  assert.ok(!sim.some((o) => o.status === 'wrong'), 'simultaneous equations are never marked wrong for not following each other');
  const lost = check('x^{2} = 9', 'x = 3');
  assert.equal(lost[1].status, null);
  assert.equal(lost[1].note.kind, 'lost', 'losing x = −3 is pointed out to the model, not marked wrong');
  assert.equal(check('x^2 - 5x + 6 = 0', '(x - 2)(x - 3) = 0')[1].status, 'ok', 'factorising keeps the solutions');
});

test('an unclear line breaks the chain: nothing is compared across it', () => {
  const r = W.checkSteps(steps('2x + 3 = 7', { tex: '2x = ?', unclear: true }, 'x = 7'));
  assert.deepEqual(statuses(r), [null, null, null]);
  assert.ok(!r[2].linked);
  const parts = W.checkSteps(steps('2x = 4', { text: '(b)', tex: '3x = 12' }));
  assert.notEqual(parts[1].status, 'wrong', 'a new part of the problem is not compared with the last one');
});

test('units: a change of units is not a sum; the same units are; words and labels are names', () => {
  const r = check('36\\,\\text{km/h} = 36 \\times \\frac{5}{18}\\,\\text{m/s}', '= 10\\,\\text{m/s}', '= 12\\,\\text{m/s}');
  assert.deepEqual(statuses(r), [null, 'ok', 'wrong']);
  assert.equal(check('\\frac{150\\,\\text{m}}{2\\,\\text{min}} = 75\\,\\text{m/s}')[0].status, null, 'm/min against m/s is the model’s to judge');
  assert.equal(check('8\\,\\text{cm} \\times 5\\,\\text{cm} = 45\\,\\text{cm}^{2}')[0].status, 'wrong', 'cm × cm against cm² is still a sum');
  assert.equal(check('8 \\times 5 = 45\\,\\text{वर्ग सेमी}')[0].status, 'wrong', 'a unit in Hindi');
  assert.equal(check('v = 2 \\times 5 = 10 m/s')[0].status, 'ok', 'a unit written without \\text');
  assert.deepEqual(statuses(check('\\text{Total} = \\text{₹}146', '\\text{क्षेत्रफल} = 8 \\times 5 = 40')), [null, 'ok']);
  assert.equal(W.unitKey('वर्ग सेमी').join(), 'सेमी');
  assert.deepEqual(W.unitKey('km/h'), ['km', 'h']);
});

test('digits in other scripts, mixed numbers, percentages, and LaTeX it can’t read', () => {
  assert.equal(check('८ \\times ५ = ४०')[0].status, 'ok');
  assert.equal(check('2\\frac{1}{2} + \\frac{1}{2} = 3')[0].status, 'ok', '2½ is a mixed number');
  assert.equal(check('20\\% \\times 50 = 10')[0].status, 'ok');
  assert.equal(check('1,000 + 250 = 1,250')[0].status, 'ok');
  for (const tex of ['x \\geq 2', 'x = \\pm 3', '\\lim_{x \\to 0} f(x)', 'process.exit()', '\\text{constructor} = 5', '__proto__ = 1', 'x = ']) {
    assert.doesNotThrow(() => check(tex), tex);
    assert.notEqual(check(tex)[0].status, 'wrong', tex);
  }
});

test('the final answer against a numeric question’s answer, with its units', () => {
  const Q = { type: 'numeric', answer: 10, tolerance: 0.1, unit: 'm/s' };
  assert.equal(W.finalMatches(Q, 'v = 10\\,\\text{m/s}'), true);
  assert.equal(W.finalMatches(Q, '10.05'), true);
  assert.equal(W.finalMatches(Q, 'v = 30\\,\\text{m/s}'), false);
  assert.equal(W.finalMatches(Q, '36\\,\\text{km/h}'), null, 'other units: left to the model');
  assert.equal(W.finalMatches({ type: 'subjective', prompt: 'x' }, '10'), null);
  assert.equal(W.finalMatches(Q, ''), null);
});

/* ---------------- the model's replies ---------------- */

test('a reading: steps as written, numbered, cleaned; unreadable photos say so', () => {
  const r = W.shapeReading({ readable: true, steps: ['2x + 3 = 7', { text: 'so', tex: '$2x = 10$' }, { tex: '', text: '' }, { tex: 'x = ?', unclear: 'true' }], final: '\\(x = 5\\)', language: 'EN' });
  assert.deepEqual(r.steps.map((s) => [s.n, s.tex, s.unclear]), [[1, '2x + 3 = 7', false], [2, '2x = 10', false], [3, 'x = ?', true]]);
  assert.equal(r.final, 'x = 5');
  assert.equal(r.language, 'en');
  assert.equal(r.readable, true);
  assert.equal(W.shapeReading({ readable: false, steps: [] }).readable, false);
  assert.equal(W.shapeReading({ steps: [{ tex: '?', unclear: true }] }).readable, false, 'nothing but unclear lines is unreadable');
  assert.throws(() => W.shapeReading({ text: 'hello' }), /no steps/);
  assert.equal(W.shapeReading({ steps: Array.from({ length: 60 }, (_, i) => `${i} = ${i}`) }).steps.length, W.LIMITS.steps);
  const dup = W.shapeReading({ steps: [{ text: 'क्षेत्रफल = लंबाई × चौड़ाई', tex: '\\text{क्षेत्रफल} = \\text{लंबाई} \\times \\text{चौड़ाई}' }, { text: '', tex: '\\text{उत्तर: } 45\\,\\text{वर्ग सेमी}' }, { text: 'Pens:', tex: '3 \\times 12 = 36' }] }).steps;
  assert.equal(dup[0].text, '', 'words that only repeat the maths are dropped');
  assert.deepEqual([dup[1].text, dup[1].tex], ['उत्तर:', '45\\,\\text{वर्ग सेमी}'], 'a label moves to the words');
  assert.equal(dup[2].text, 'Pens:');
  const ctl = W.shapeReading({ steps: [{ tex: 'x' + String.fromCharCode(12) + 'rac{1}{2}' }] }).steps[0].tex;
  assert.ok(![...ctl].some((ch) => ch.charCodeAt(0) < 32), 'no control characters survive');
});

test('a judgement: marks by step number, their synonyms, nothing out of range', () => {
  const j = W.shapeJudgement({ steps: [{ n: 1, mark: 'Correct' }, { n: 2, mark: 'incorrect', why: 'You added \\frac{1}{2}.' }, { n: 3, mark: 'carried forward' }, { n: 9, mark: 'wrong' }, { n: 2, mark: 'ok' }],
    first_wrong: '2', summary: 'You added 3.', final_matches: 'false', hint: 'Undo the +3.' }, 3);
  assert.deepEqual(Object.keys(j.marks), ['1', '2', '3']);
  assert.equal(j.marks[2].mark, 'wrong');
  assert.match(j.marks[2].why, /\\\(\\frac\{1\}\{2\}\\\)/, 'bare LaTeX gets its \\( \\)');
  assert.equal(j.marks[3].mark, 'carried');
  assert.equal(j.finalMatches, false);
  assert.equal(j.firstWrong, 2);
  assert.throws(() => W.shapeJudgement({ steps: [{ n: 1, mark: 'banana' }] }, 2), /no usable/);
});

/* ---------------- putting it together ---------------- */

const judged = (marks, extra = {}) => ({ marks, firstWrong: null, summary: 'Summary.', finalMatches: null, hint: 'A hint.', answer: '', ...extra });

test('combined: an exact slip is wrong whatever the model says, and the lines after it carry it forward', () => {
  const s = steps('2x + 3 = 7', '2x = 10', 'x = 5');
  const exact = W.checkSteps(s);
  const R = W.combine(s, exact, judged({ 1: { mark: 'ok', why: '' }, 2: { mark: 'ok', why: '' }, 3: { mark: 'wrong', why: 'x is 2.' } }), { finalExact: false });
  assert.deepEqual(R.steps.map((x) => [x.mark, x.by]), [['ok', 'ai'], ['wrong', 'exact'], ['carried', 'exact']]);
  assert.equal(R.firstWrong, 2);
  assert.equal(R.verdict, 'wrong');
  assert.equal(R.final.matches, false);
  assert.equal(R.final.by, 'exact');
  assert.deepEqual([R.counts.exact, R.counts.ai], [2, 1]);
  assert.equal(R.hint, 'A hint.');
  assert.equal(R.steps[1].exact.reason.kind, 'solve');
});

test('combined: the model judges what a calculator can’t (a wrong formula), and the right sums after it carry the error', () => {
  const s = steps('u = 20, a = -2, t = 5', 'v = u - at', 'v = 20 - (-2)(5)', 'v = 20 + 10', 'v = 30');
  const exact = W.checkSteps(s);
  assert.deepEqual(statuses(exact), [null, null, null, 'ok', 'ok']);
  const R = W.combine(s, exact, judged({ 1: { mark: 'ok' }, 2: { mark: 'wrong', why: 'It’s v = u + at.' }, 3: { mark: 'carried' }, 4: { mark: 'carried' }, 5: { mark: 'carried' } }, { finalMatches: false }),
    { finalExact: W.finalMatches({ type: 'numeric', answer: 10, tolerance: 0.1, unit: 'm/s' }, 'v = 30') });
  assert.deepEqual(R.steps.map((x) => x.mark), ['ok', 'wrong', 'carried', 'carried', 'carried']);
  assert.deepEqual(R.steps.map((x) => x.by), ['ai', 'ai', 'ai', 'exact', 'exact']);
  assert.equal(R.firstWrong, 2);
  assert.equal(R.steps[1].why, 'It’s v = u + at.');
});

test('combined: a line shown to follow from the one before keeps its tick, unless the model points at rounding', () => {
  const s = steps('2x + 3 = 11', '2x = 8', 'x = 4');
  const R = W.combine(s, W.checkSteps(s), judged({ 3: { mark: 'wrong', why: 'No.' } }), { finalExact: true });
  assert.equal(R.steps[2].mark, 'ok');
  assert.equal(R.verdict, 'right');
  assert.equal(R.hint, '', 'no hint when it is all right');
  const r2 = steps('x = \\frac{7}{3}', 'x = 2.3');
  const R2 = W.combine(r2, W.checkSteps(r2), judged({ 2: { mark: 'wrong', why: 'Rounded too early.' } }));
  assert.deepEqual([R2.steps[1].mark, R2.steps[1].by], ['wrong', 'ai'], 'rounding is the model’s call');
});

test('combined: unclear lines stay unclear, words-only lines aren’t marked, and the verdicts', () => {
  const s = steps({ text: 'Given', tex: '' }, '2x = 4', { tex: 'x = ?', unclear: true });
  const R = W.combine(s, W.checkSteps(s), judged({ 1: { mark: 'ok' }, 2: { mark: 'ok' }, 3: { mark: 'ok' } }));
  assert.deepEqual(R.steps.map((x) => x.mark), ['ok', 'ok', 'unclear']);
  assert.deepEqual(R.unclear, [3]);
  assert.equal(R.verdict, 'clean');
  const none = W.combine(s, W.checkSteps(s), null);
  assert.deepEqual(none.steps.map((x) => x.mark), ['note', 'unchecked', 'unclear'], 'without the model: nothing is guessed');
  assert.equal(none.judged, false);
  const fin = steps('2x = 4', 'x = 2');
  assert.equal(W.combine(fin, W.checkSteps(fin), judged({}, { summary: 'x' }), { finalExact: false }).verdict, 'final', 'right steps, wrong final answer');
  const unread = steps({ tex: '?', unclear: true });
  assert.equal(W.combine(unread, W.checkSteps(unread), null).verdict, 'unread');
});

/* ---------------- the routes ---------------- */

let uid = 0;
function user(lang = 'en') {
  uid++;
  const id = Number(q("INSERT INTO users (email, name, pass, lang, created_at) VALUES (?, 'Asha Verma', 'x', ?, 1)").run(`w${uid}-${process.pid}@test.invalid`, lang).lastInsertRowid);
  return { id, email: `w${uid}@test.invalid`, name: 'Asha Verma', lang };
}
const QUESTION = { id: 'q1', type: 'numeric', prompt: 'A car moving at \\(20\\) m/s slows down at \\(2\\) m/s² for \\(5\\) s. What is its final speed?', answer: 10, tolerance: 0.1, unit: 'm/s', hint: 'v = u + at', explain: 'The acceleration is negative: \\(v = 20 + (-2)(5) = 10\\) m/s.' };
function course(u, source = 'ai') {
  const id = 'c' + Math.random().toString(36).slice(2, 12);
  q('INSERT INTO courses (id, user_id, data, created_at, opened_at) VALUES (?, ?, ?, 1, 1)').run(id, u.id, JSON.stringify({ topic: 'Motion', title: 'Motion in a line', source, lang: 'en', units: [{ title: 'Kinematics', lessons: [{ title: 'Equations of motion' }] }] }));
  if (source !== 'sample') q('INSERT INTO lessons (course_id, n, data, created_at) VALUES (?, 1, ?, 1)').run(id, JSON.stringify({ sections: [{ id: 's1', title: 'v = u + at', blocks: [], recap: [], checkpoint: [QUESTION] }] }));
  return id;
}
// a small JPEG: its header, an EXIF block (where it was taken), then the picture
const APP1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x12]), Buffer.from('Exif'), Buffer.alloc(2), Buffer.from('GPS-SECRET')]);
const JFIF = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF'), Buffer.from([0, 1, 1, 0, 0, 1, 0, 1, 0, 0])]);
const JPEG = Buffer.concat([JFIF, APP1, Buffer.from([0xff, 0xda, 0x00, 0x08]), Buffer.alloc(400, 7), Buffer.from([0xff, 0xd9])]);
const PHOTO = 'data:image/jpeg;base64,' + JPEG.toString('base64');

const route = (p) => W.routes.find((r) => r[1].test(p))[2];
async function post(p, u, body) {
  const buf = Buffer.from(JSON.stringify(body));
  const req = Readable.from([buf]);
  req.headers = { 'content-type': 'application/json', 'content-length': String(buf.length) };
  req._user = u;
  const res = { status: 0, body: '', headersSent: false, writeHead(s) { this.status = s; this.headersSent = true; }, end(b) { this.body = b ? String(b) : ''; } };
  try {
    await route(p)({ req, res, params: {}, url: new URL('http://x' + p) });
    return { status: res.status, ...JSON.parse(res.body) };
  } catch (err) {
    return { status: err.status || 500, error: err.message };
  }
}

// The fakes: what the vision model "read", and how the text model "judged".
const seen = { vision: [], judge: [] };
let reading = null, judging = null;
W.deps.askVision = async ({ system, user: prompt, images, validate }) => {
  seen.vision.push({ system, prompt, images });
  if (reading instanceof Error) throw reading;
  return { value: validate(reading), model: 'fake-vision', provider: 'gemini' };
};
W.deps.askJSON = async ({ system, user: prompt, validate }) => {
  seen.judge.push({ system, prompt });
  if (judging instanceof Error) throw judging;
  return { value: validate(judging), model: 'fake-judge', provider: 'groq' };
};
const SIGN_SLIP = { readable: true, problem: '', steps: [{ text: 'Given', tex: 'u = 20\\,\\text{m/s}, a = -2\\,\\text{m/s}^{2}, t = 5\\,\\text{s}' }, { text: 'Using', tex: 'v = u - at' }, { tex: 'v = 20 - (-2)(5)' }, { tex: 'v = 20 + 10' }, { tex: 'v = 30\\,\\text{m/s}' }], final: 'v = 30\\,\\text{m/s}', language: 'en' };
const SIGN_JUDGED = { steps: [{ n: 1, mark: 'ok' }, { n: 2, mark: 'wrong', why: 'The formula is \\(v = u + at\\); the minus sign belongs to a.' }, { n: 3, mark: 'carried' }, { n: 4, mark: 'carried' }, { n: 5, mark: 'carried' }],
  first_wrong: 2, summary: 'You used v = u − at, so the slowing down was counted twice.', final_matches: false, hint: 'Which sign does a already carry?', answer: '10 m/s' };

test('reading: photos are checked by their bytes and sizes, at most 3', async () => {
  const u = user();
  const c = course(u);
  const base = { courseId: c, n: 1, qid: 'q1' };
  seen.vision.length = 0;
  assert.equal((await post('/api/working/read', u, { ...base, images: [] })).status, 400);
  assert.equal((await post('/api/working/read', u, { ...base, images: [PHOTO, PHOTO, PHOTO, PHOTO] })).status, 400);
  assert.equal((await post('/api/working/read', u, { ...base, images: ['data:text/html;base64,PGgxPg=='] })).status, 415);
  const png = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300)]).toString('base64');
  assert.equal((await post('/api/working/read', u, { ...base, images: [png] })).status, 415, 'a PNG that says it is a JPEG');
  assert.equal((await post('/api/working/read', u, { ...base, images: ['data:image/jpeg;base64,' + Buffer.alloc(50, 0xff).toString('base64')] })).status, 400, 'too small to be a photo');
  const big = 'data:image/jpeg;base64,' + Buffer.concat([JPEG, Buffer.alloc(W.LIMITS.image)]).toString('base64');
  assert.equal((await post('/api/working/read', u, { ...base, images: [big] })).status, 413);
  assert.equal(seen.vision.length, 0, 'nothing reached the model');
});

test('reading: the question must be in the stored lesson; the language must be real', async () => {
  const u = user();
  const c = course(u);
  assert.equal((await post('/api/working/read', u, { courseId: c, n: 1, qid: 'q9', images: [PHOTO] })).status, 404);
  assert.equal((await post('/api/working/read', u, { courseId: c, n: 7, qid: 'q1', images: [PHOTO] })).status, 400);
  assert.equal((await post('/api/working/read', u, { courseId: c, n: 1, qid: 'q1', images: [PHOTO], lang: 'xx' })).status, 400);
  assert.equal((await post('/api/working/read', user(), { courseId: c, n: 1, qid: 'q1', images: [PHOTO] })).status, 404, 'someone else’s course');
});

test('reading then checking: the steps come back with exact marks, then the whole result; the mistake is remembered', async () => {
  const u = user();
  const c = course(u);
  reading = SIGN_SLIP;
  judging = SIGN_JUDGED;
  seen.vision.length = 0; seen.judge.length = 0;
  const r = await post('/api/working/read', u, { courseId: c, n: 1, qid: 'q1', images: [PHOTO], answer: '30', lang: 'hi' });
  assert.equal(r.status, 200);
  assert.equal(r.readable, true);
  assert.equal(r.steps.length, 5);
  assert.deepEqual(r.steps.map((s) => s.exact && s.exact.status), [null, null, null, 'ok', 'ok']);
  assert.equal(r.left, W.LIMITS.daily - 1);
  // what the vision model got: the photo without its EXIF block, the question, nothing about the learner
  const sent = seen.vision[0];
  const bytes = Buffer.from(sent.images[0].split(',')[1], 'base64');
  assert.ok(!bytes.includes(Buffer.from('GPS-SECRET')), 'the photo’s metadata never leaves the server');
  assert.ok(bytes.includes(Buffer.from([0xff, 0xda])), 'the picture itself is kept');
  assert.match(sent.prompt, /final speed/);
  assert.ok(!/Asha|Verma|test\.invalid/.test(sent.prompt + sent.system), 'no personal data');

  const k = await post('/api/working/check', u, { id: r.id });
  assert.equal(k.status, 200);
  const R = k.result;
  assert.deepEqual(R.steps.map((s) => s.mark), ['ok', 'wrong', 'carried', 'carried', 'carried']);
  assert.equal(R.firstWrong, 2);
  assert.equal(R.final.matches, false);
  assert.equal(R.final.by, 'exact');
  assert.equal(R.verdict, 'wrong');
  assert.match(R.hint, /sign/);
  assert.deepEqual(R.models, { reader: 'fake-vision', judge: 'fake-judge' });
  const judgePrompt = seen.judge[0];
  assert.match(judgePrompt.prompt, /Correct answer: 10 m\/s/);
  assert.match(judgePrompt.prompt, /The answer they typed into the app: 30/);
  assert.match(judgePrompt.prompt, /4\. .*checked exactly by the app: the calculation is right and follows from the line before/);
  assert.match(judgePrompt.system, /in Hindi/, 'feedback in the lesson’s language');
  assert.ok(!/Asha|Verma|test\.invalid/.test(judgePrompt.prompt + judgePrompt.system), 'no personal data');
  // the learning loop: the tutor's memory, and Review
  const m = q('SELECT * FROM mistakes WHERE user_id = ?').all(u.id);
  assert.equal(m.length, 1);
  assert.match(m[0].given, /step 2: Using v = u - at/);
  assert.equal(m[0].correct, '10 m/s (answers within 0.1 of it count as right)');
  assert.equal(q('SELECT COUNT(*) AS n FROM review_items WHERE user_id = ? AND qid = ?').get(u.id, 'q1').n, 1, 'the question comes back in Review');
  // checked again: not remembered twice
  await post('/api/working/check', u, { id: r.id });
  assert.equal(q('SELECT COUNT(*) AS n FROM mistakes WHERE user_id = ?').get(u.id).n, 1);
  // the photo is not stored anywhere
  const row = q('SELECT * FROM working_checks WHERE id = ?').get(r.id);
  assert.ok(!JSON.stringify(row).includes(JPEG.toString('base64').slice(0, 40)));
});

test('checking: a misread line fixed by the learner is checked again; the judge failing leaves the exact checks', async () => {
  const u = user();
  const c = course(u);
  reading = { readable: true, steps: [{ tex: '2x + 3 = 7' }, { tex: '2x = 4' }, { tex: 'x = 3', unclear: true }], final: '' };
  judging = new AIError('Every free model is busy.', 429);
  const r = await post('/api/working/read', u, { courseId: c, n: 1, qid: 'q1', images: [PHOTO] });
  const k = await post('/api/working/check', u, { id: r.id });
  assert.equal(k.status, 200);
  assert.equal(k.result.judged, false);
  assert.match(k.result.error, /busy/);
  assert.deepEqual(k.result.steps.map((s) => s.mark), ['unchecked', 'ok', 'unclear']);
  judging = { steps: [{ n: 1, mark: 'ok' }, { n: 2, mark: 'ok' }, { n: 3, mark: 'ok' }], summary: 'Well done.', final_matches: true, hint: '' };
  const fixed = await post('/api/working/check', u, { id: r.id, steps: [{ text: '', tex: '2x + 3 = 7' }, { text: '', tex: '2x = 4' }, { text: '', tex: 'x = 3' }] });
  assert.equal(fixed.result.edited, true);
  assert.deepEqual(fixed.result.steps.map((s) => s.mark), ['ok', 'ok', 'wrong'], 'x = 3 doesn’t follow from 2x = 4, whatever the model says');
  assert.equal(fixed.result.steps[2].by, 'exact');
  assert.equal((await post('/api/working/check', u, { id: r.id, steps: [] })).status, 400);
  assert.equal((await post('/api/working/check', u, { id: 'nope' })).status, 404);
  assert.equal((await post('/api/working/check', user(), { id: r.id })).status, 404, 'someone else’s check');
  q('UPDATE working_checks SET checks = ? WHERE id = ?').run(W.LIMITS.rechecks, r.id);
  assert.equal((await post('/api/working/check', u, { id: r.id })).status, 429);
});

test('limits: 20 readings a day, with a clear message; an unreadable photo counts', async () => {
  const u = user();
  const c = course(u);
  reading = { readable: false, steps: [] };
  const r = await post('/api/working/read', u, { courseId: c, n: 1, qid: 'q1', images: [PHOTO] });
  assert.equal(r.status, 200);
  assert.equal(r.readable, false);
  for (let i = 0; i < W.LIMITS.daily - 1; i++) q("INSERT INTO working_checks (id, user_id, context, steps, created_at) VALUES (?, ?, '{}', '{}', ?)").run(`old${uid}x${i}`.padEnd(16, 'z'), u.id, Date.now());
  const over = await post('/api/working/read', u, { courseId: c, n: 1, qid: 'q1', images: [PHOTO] });
  assert.equal(over.status, 429);
  assert.match(over.error, /20 workings today/);
  q('UPDATE working_checks SET created_at = ? WHERE user_id = ?').run(Date.now() - 25 * 3600_000, u.id);
  reading = SIGN_SLIP;
  assert.equal((await post('/api/working/read', u, { courseId: c, n: 1, qid: 'q1', images: [PHOTO] })).status, 200, 'yesterday’s readings don’t count');
});

test('a sample course’s question comes with the request; any working needs no question at all', async () => {
  const u = user();
  const c = course(u, 'sample');
  reading = SIGN_SLIP;
  assert.equal((await post('/api/working/read', u, { courseId: c, n: 1, qid: 'q1', images: [PHOTO] })).status, 404, 'no question given');
  const r = await post('/api/working/read', u, { courseId: c, n: 1, qid: 'q1', images: [PHOTO], question: { type: 'numeric', prompt: 'Find v.', answer: 10, unit: 'm/s' } });
  assert.equal(r.status, 200);
  seen.vision.length = 0; seen.judge.length = 0;
  reading = { readable: true, problem: 'Solve 2x + 3 = 7', steps: [{ tex: '2x = 10' }, { tex: 'x = 5' }], final: 'x = 5' };
  judging = { steps: [{ n: 1, mark: 'wrong', why: 'Take 3 away.' }, { n: 2, mark: 'carried' }], summary: 'Subtract, don’t add.', final_matches: false, hint: 'What undoes + 3?', answer: 'x = 2' };
  const any = await post('/api/working/read', u, { images: [PHOTO, PHOTO], problem: 'Solve 2x + 3 = 7' });
  assert.equal(any.status, 200);
  assert.equal(seen.vision[0].images.length, 2);
  const k = await post('/api/working/check', u, { id: any.id });
  assert.equal(k.result.firstWrong, 1);
  assert.match(seen.judge[0].prompt, /There is no answer key/);
  assert.ok(!JSON.stringify(k.result).includes('x = 2'), 'the model’s own answer is never sent back');
  assert.equal(q('SELECT COUNT(*) AS n FROM mistakes WHERE user_id = ? AND course_id IS NULL').get(u.id).n, 1, 'remembered by the tutor too');
});
