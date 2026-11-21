// "Start from…" (server/sources-in.mjs): splitting material into passages, screening it a sentence
// at a time, giving every passage to some lesson, and the vision path in ai.mjs (askVision) against
// a fake fetch. No network, no real keys, a throwaway database.   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';

const DB = path.join(os.tmpdir(), `primer-sources-in-${process.pid}.db`);
process.env.PRIMER_DB = DB;
const S = await import('../server/sources-in.mjs');
const ai = await import('../server/ai.mjs');
const { screen } = await import('../server/safety.mjs');
const { db } = await import('../server/db.mjs');
test.after(() => {
  db.close();
  for (const f of [DB, DB + '-wal', DB + '-shm']) rmSync(f, { force: true });
});

/* ---------------- passages ---------------- */

const para = (n, words = 40) => Array.from({ length: words }, (_, i) => `word${n}x${i}`).join(' ') + '.';

test('passages: short paragraphs are joined, long ones split at sentence ends, nothing is lost', () => {
  const text = [para(1, 10), para(2, 10), '# A heading', para(3, 400), 'एक छोटा अनुच्छेद। दूसरा वाक्य।'].join('\n\n');
  const a = S.passagesOf(text);
  assert.deepEqual(a, S.passagesOf(text), 'the same text always gives the same passages');
  assert.ok(a.every((p) => p.length <= 1600), 'no passage is over the limit');
  assert.ok(a[0].includes('word1x0') && a[0].includes('word2x0'), 'short neighbours are joined');
  assert.ok(a.some((p) => p.startsWith('# A heading')), 'a heading starts a new passage');
  const words = (s) => s.split(/\s+/).filter(Boolean).join(' ');
  assert.equal(words(a.join(' ')), words(text.replace(/\n+/g, ' ')), 'every word is still there, in order');
  assert.ok(a.length >= 4);
});

test('material is cleaned: control characters out, line breaks kept, at most 30,000 characters', () => {
  const s = S.cleanMaterial('a' + String.fromCharCode(0) + 'b\r\nc' + String.fromCharCode(7) + '\n\n\n\nd ' + 'x'.repeat(40_000));
  assert.ok(s.startsWith('ab\nc\n\nd x'));
  assert.equal(s.length, S.MAX_MATERIAL);
  assert.equal(S.cleanMaterial(42), '');
});

/* ---------------- screening ---------------- */

test('screening goes a sentence at a time, so words from two sentences don’t add up', () => {
  const text = 'We make rangoli at Diwali. Grandfather told us about the bombs that fell in 1971.';
  assert.ok(screen(text), 'as one piece of text the word check would flag it');
  assert.equal(S.screenMaterial('Our village', text), null);
  const risky = S.screenMaterial('Our fair', 'The fair has a giant wheel. Here is how to make a pipe bomb from the powder. The money goes to the school.');
  assert.equal(risky.kind, 'harm');
  assert.equal(risky.area, 'explosives');
  assert.equal(S.screenMaterial('Notes', 'Some notes. Where to find child porn online.').kind, 'refuse');
});

/* ---------------- outlines and the plan ---------------- */

test('outline shape: a single lesson is allowed, passage numbers are checked, the size is capped', () => {
  const one = S.shapeOutline({ title: 'T', units: [{ title: 'U', lessons: [{ title: 'L', passages: ['[2]', 9, 1, 1, 'x'] }] }] }, { passages: 3 });
  assert.equal(one.units[0].lessons.length, 1);
  assert.deepEqual(one.units[0].lessons[0].passages, [2, 1]);
  assert.throws(() => S.shapeOutline({ units: [] }, { min: 1 }));
  const many = S.shapeOutline({ units: [{ lessons: Array.from({ length: 9 }, (_, i) => ({ title: 'L' + i })) }] }, { max: 5 });
  assert.equal(many.units[0].lessons.length, 5);
});

test('every passage reaches a lesson: the AI’s list, then shared words, then the nearest lesson', () => {
  const passages = ['the bamboo frame of the lantern', 'the order of the families', 'the river and the leaf boats', 'the flood of 1971', 'the register kept since 2019'];
  const units = [{ lessons: [
    { title: 'Making the frame', desc: '', passages: [1] },
    { title: 'Who walks first', desc: 'the order of families', passages: [] },
    { title: 'At the river', desc: '', passages: [3, 4] }
  ] }];
  const plan = S.planOf(units, passages);
  assert.deepEqual(plan[1], [1]);
  assert.ok(plan[2].includes(2), 'matched by its words');
  assert.ok(plan[3].includes(5), 'a passage no lesson took goes to the lesson just before it');
  const used = new Set(Object.values(plan).flat());
  assert.equal(used.size, passages.length);
});

/* ---------------- vision ---------------- */

const CATALOGS = {
  'https://api.groq.com/openai/v1/models': { data: [{ id: 'qwen/qwen3.8-27b', max_completion_tokens: 16384 }, { id: 'openai/gpt-oss-120b', max_completion_tokens: 65536 }] },
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000': { models: [
    { name: 'models/gemini-3-flash-preview', outputTokenLimit: 65536 }, { name: 'models/gemini-3.1-flash-lite', outputTokenLimit: 65536 }, { name: 'models/gemini-flash-lite-latest', outputTokenLimit: 65536 }
  ] }
};
const respond = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

test('askVision sends the photo as an image_url part, to image models only, and falls through busy ones', async () => {
  const realFetch = globalThis.fetch, realLog = console.log;
  const keys = ['GEM_KEY', 'GROQ_KEY', 'OPENROUTER_API_KEY', 'REQ_KEY', 'PRIMER_AI_ORDER', 'PRIMER_VISION_ORDER', 'GEMINI_VISION_MODELS', 'GROQ_VISION_MODELS'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const calls = [];
  console.log = () => {};
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (CATALOGS[url]) return respond(200, CATALOGS[url]);
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.includes('generativelanguage')) return respond(429, { error: { message: 'busy', code: 429 } });
    return respond(200, { model: body.model, choices: [{ message: { content: '{"name": "Qutub Minar"}' }, finish_reason: 'stop' }] });
  };
  try {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, { GEM_KEY: 'AIza_fake_gemini_key_000002', GROQ_KEY: 'gsk_fake_groq_key_000000001' });
    ai.resetAI();
    assert.equal(ai.visionReady(), true);
    const out = await ai.askVision({ system: 'S', user: 'What is this?', images: ['data:image/jpeg;base64,AAAA'], validate: (r) => r.name, label: 'test' });
    assert.equal(out.value, 'Qutub Minar');
    assert.equal(out.provider, 'groq');
    const models = calls.map((c) => c.body.model);
    assert.deepEqual(models, ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'qwen/qwen3.8-27b'], 'Gemini first, then Groq’s vision model; never a text-only model');
    const part = calls[0].body.messages[1].content;
    assert.deepEqual(part[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
    assert.equal(part[0].text, 'What is this?');

    // a provider left out of PRIMER_AI_ORDER isn't used for photos either
    process.env.PRIMER_AI_ORDER = 'gemini';
    assert.equal(ai.visionReady(), true);
    process.env.PRIMER_VISION_ORDER = 'groq';
    assert.equal(ai.visionReady(), false);
    // Requesty alone: its vision models all cost credit, so none is tried unless REQUESTY_VISION_MODELS lists one
    for (const k of keys) delete process.env[k];
    process.env.REQ_KEY = 'rq_fake_requesty_key_000003';
    assert.equal(ai.visionReady(), false);
    await assert.rejects(ai.askVision({ system: 'S', user: 'U', images: [], validate: (r) => r, label: 't' }), (e) => e.status === 503);
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    ai.resetAI();
  }
});

/* ---------------- the Sources list of a course built from the learner's material ---------------- */

test('a knowledge course cites only its material, with no outside lookups', async () => {
  const { q } = await import('../server/db.mjs');
  const { hooks, insertCourse } = await import('../server/data.mjs');
  const realFetch = globalThis.fetch, realLog = console.log;
  const asked = [];
  globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error('no network in tests'); };
  console.log = () => {};
  try {
    const uid = Number(q(`INSERT INTO users (email, name, pass, created_at) VALUES ('own@test.invalid', 'Asha', 'x', ?)`).run(Date.now()).lastInsertRowid);
    q(`INSERT INTO source_material (sid, user_id, kind, title, material, created_at) VALUES ('sid-own-1', ?, 'knowledge', 'Sohar songs of Bhojpur', 'Sung at a birth.', ?)`).run(uid, Date.now());
    const meta = {
      topic: 'Sohar songs', title: 'Sohar songs', source: 'ai', lang: 'en',
      units: [{ title: 'Songs', lessons: [{ title: 'What a sohar is' }] }],
      startedFrom: { kind: 'knowledge', sid: 'sid-own-1', by: 'Asha', at: Date.UTC(2026, 10, 20) }
    };
    const row = insertCourse({ id: uid }, meta);
    const lesson = { title: 'What a sohar is', sections: [
      { title: 'When it is sung', blocks: [{ type: 'p', text: 'At a birth.' }] },
      { title: 'Who sings it', blocks: [{ type: 'p', text: 'The women of the family.' }] }
    ] };
    const out = await hooks.refs(row, meta, 1, lesson, true);
    assert.equal(out.refs.mode, 'own');
    assert.equal(out.refs.status, 'found');
    assert.deepEqual(out.refs.sources, [{ n: 1, kind: 'own', from: 'knowledge', title: 'Sohar songs of Bhojpur', contributor: 'Asha', date: '2026-11-20' }]);
    assert.deepEqual(out.refs.tags, { 0: [1], 1: [1] }, 'every part is tagged with the material');
    assert.ok(!asked.some((u) => /wikipedia|wikimedia|openalex/i.test(u)), 'no outside lookups: ' + asked.join(', '));

    // a textbook-page course is labelled as pages; an ordinary AI course is not given any own material
    const page = { ...meta, startedFrom: { kind: 'page', by: 'Asha', at: 0 } };
    const prow = insertCourse({ id: uid }, page);
    const p = await hooks.refs(prow, page, 1, lesson, true);
    assert.equal(p.refs.sources[0].from, 'page');
    const plain = { ...meta, startedFrom: undefined };
    const r2 = insertCourse({ id: uid }, plain);
    const o = await hooks.refs(r2, plain, 1, lesson, false);
    assert.ok(!o.refs || o.refs.mode !== 'own');
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
});
