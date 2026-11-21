// The AI provider layer (server/ai.mjs) against a fake fetch: which providers are configured,
// the order models are tried in, what each provider is sent, and how failures are handled.
// No network, no real keys.   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

const ai = await import('../server/ai.mjs');

const KEYS = {
  GROQ_KEY: 'gsk_fake_groq_key_000000001',
  GEM_KEY: 'AIza_fake_gemini_key_000002',
  REQ_KEY: 'rq_fake_requesty_key_000003',
  OPENROUTER_API_KEY: 'sk-or-fake-openrouter-0004'
};
const VARS = ['GROQ_KEY', 'GROQ_API_KEY', 'GEM_KEY', 'GEMINI_API_KEY', 'REQ_KEY', 'REQUESTY_API_KEY', 'OPENROUTER_API_KEY',
  'PRIMER_AI_ORDER', 'GROQ_MODELS', 'GEMINI_MODELS', 'REQUESTY_MODELS', 'OPENROUTER_MODELS'];
function setEnv(vars) {
  for (const v of VARS) delete process.env[v];
  Object.assign(process.env, vars);
  ai.resetAI();
}

const URL_OF = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  requesty: 'https://router.requesty.ai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions'
};
const providerOf = (url) => Object.keys(URL_OF).find((k) => URL_OF[k] === url);

const CATALOGS = {
  'https://api.groq.com/openai/v1/models': { data: [
    { id: 'openai/gpt-oss-120b', max_completion_tokens: 65536 },
    { id: 'openai/gpt-oss-20b', max_completion_tokens: 65536 },
    { id: 'qwen/qwen3.8-27b', max_completion_tokens: 16384 },
    { id: 'old/retired-model', max_completion_tokens: 8192, active: false }
  ] },
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000': { models: [
    { name: 'models/gemini-3-flash-preview', outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-lite', outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-flash-lite-latest', outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash', outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] }
  ] },
  'https://router.requesty.ai/v1/models': { data: [
    { id: 'nvidia/nemotron-3-ultra-550b-a55b', max_output_tokens: 65536, supports_output_json_object: false, reasoning: { supported_efforts: ['none', 'low', 'high'] } },
    { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', max_output_tokens: 65536, supports_output_json_object: false, reasoning: { supported_efforts: ['none', 'low'] } },
    { id: 'mistral/leanstral-1-5', max_output_tokens: 32768, supports_output_json_object: true, reasoning: { supported_efforts: ['high'] } },
    { id: 'google/gemma-4-31b-it', max_output_tokens: 8192, supports_output_json_object: false, reasoning: { supported_efforts: ['high'] } }
  ] },
  'https://openrouter.ai/api/v1/models': { data: [
    { id: 'vendor/thinker:free', reasoning: { mandatory: false } },
    { id: 'vendor/always-thinks:free', reasoning: { mandatory: true, supported_efforts: ['high', 'medium', 'low'] } }
  ] }
};

const respond = (status, obj, headers = {}) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
const answer = (content, model) => respond(200, { model, choices: [{ message: { content }, finish_reason: 'stop' }], usage: { completion_tokens: 10 } });

let calls = [];
let reply = (c) => answer('{"html": "<p>Hello</p>"}', c.body.model);
let catalogDown = false;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (CATALOGS[url]) {
    calls.push({ kind: 'catalog', url, headers: init.headers || {} });
    return catalogDown && !url.startsWith('https://openrouter.ai') ? respond(500, { error: { message: 'down' } }) : respond(200, CATALOGS[url]);
  }
  const c = { kind: 'chat', url, provider: providerOf(url), headers: init.headers || {}, body: JSON.parse(init.body) };
  calls.push(c);
  return reply(c);
};
const chats = () => calls.filter((c) => c.kind === 'chat');
const tried = () => chats().map((c) => `${c.provider}:${c.body.model}`);

// every line the AI layer logs, to check none of them holds a key
const logged = [];
const realLog = console.log;
console.log = (...a) => logged.push(a.join(' '));
test.after(() => { console.log = realLog; });

const ask = (extra = {}) => ai.askJSON({ system: 'Return JSON.', user: 'Hi', maxTokens: 1200, validate: (raw) => { if (!raw.html) throw new Error('no html'); return raw.html; }, label: 'test', ...extra });

test.beforeEach(() => {
  calls = [];
  catalogDown = false;
  reply = (c) => answer('{"html": "<p>Hello</p>"}', c.body.model);
});

/* ---------------- configuration ---------------- */

test('no keys: AI is off and generate says how to add one', async () => {
  setEnv({});
  const cfg = ai.config();
  assert.equal(cfg.ai, false);
  assert.equal(cfg.key, false);
  assert.deepEqual(cfg.providers, []);
  await assert.rejects(ask(), (err) => err.status === 503 && /GROQ_KEY/.test(err.message));
  assert.equal(chats().length, 0);
});

test('keys under the short and the conventional names, default order, no keys in config()', () => {
  setEnv({ GROQ_API_KEY: KEYS.GROQ_KEY, GEMINI_API_KEY: KEYS.GEM_KEY, REQUESTY_API_KEY: KEYS.REQ_KEY, OPENROUTER_API_KEY: KEYS.OPENROUTER_API_KEY });
  let cfg = ai.config();
  assert.equal(cfg.ai, true);
  assert.deepEqual(cfg.providers.map((p) => p.id), ai.DEFAULT_ORDER);
  assert.equal(cfg.models[0], 'groq:openai/gpt-oss-120b');
  const shown = JSON.stringify(cfg);
  for (const k of Object.values(KEYS)) assert.ok(!shown.includes(k), 'config() must not contain a key');

  setEnv({ GROQ_KEY: KEYS.GROQ_KEY, GEM_KEY: KEYS.GEM_KEY });
  cfg = ai.config();
  assert.deepEqual(cfg.providers.map((p) => p.id), ['groq', 'gemini']);
});

test('PRIMER_AI_ORDER sets the order and leaves out providers it does not name; *_MODELS override the lists', () => {
  setEnv({ ...KEYS, PRIMER_AI_ORDER: 'Gemini, openrouter, nope, gemini', GEMINI_MODELS: 'gemini-3.1-flash-lite, gemini-3-flash-preview', OPENROUTER_MODELS: 'vendor/thinker:free' });
  const cfg = ai.config();
  assert.deepEqual(cfg.providers.map((p) => p.id), ['gemini', 'openrouter']);
  assert.deepEqual(cfg.models, ['gemini:gemini-3.1-flash-lite', 'gemini:gemini-3-flash-preview', 'openrouter:vendor/thinker:free']);
});

/* ---------------- order and skipping ---------------- */

test('busy and failing models are skipped in order until one answers', async () => {
  setEnv({ ...KEYS, PRIMER_AI_ORDER: 'groq,gemini,requesty,openrouter', GROQ_MODELS: 'openai/gpt-oss-120b,openai/gpt-oss-20b', GEMINI_MODELS: 'gemini-3-flash-preview' });
  reply = (c) => {
    if (c.provider === 'groq' && c.body.model === 'openai/gpt-oss-120b') return respond(429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '7' });
    if (c.provider === 'groq') return respond(500, { error: { message: 'internal' } });
    if (c.provider === 'gemini') return respond(503, [{ error: { code: 503, message: 'This model is currently experiencing high demand.' } }]);
    return answer('{"html": "<p>From Requesty</p>"}', c.body.model);
  };
  const out = await ask();
  assert.equal(out.value, '<p>From Requesty</p>');
  assert.equal(out.provider, 'requesty');
  assert.equal(out.model, 'nvidia/nemotron-3-ultra-550b-a55b');
  assert.deepEqual(tried(), ['groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b', 'gemini:gemini-3-flash-preview', 'requesty:nvidia/nemotron-3-ultra-550b-a55b']);
  assert.ok(logged.some((l) => l.includes('Groq openai/gpt-oss-120b failed (429)')), 'log lines name the provider and model');
  assert.ok(logged.some((l) => l.includes('Requesty nvidia/nemotron-3-ultra-550b-a55b answered')));

  // the busy ones (gpt-oss-120b's 429, Gemini's 503) go to the back of the queue for the next
  // request; one that merely failed (gpt-oss-20b's 500) keeps its place
  calls = [];
  reply = (c) => respond(500, { error: { message: 'collecting' } });
  await assert.rejects(ask());
  assert.deepEqual(tried(), ['groq:openai/gpt-oss-20b', 'requesty:nvidia/nemotron-3-ultra-550b-a55b', 'requesty:nvidia/nemotron-3.5-lightning-30b-a3b',
    'openrouter:openrouter/free', 'groq:openai/gpt-oss-120b', 'gemini:gemini-3-flash-preview']);
});

test('an unusable reply falls through to the next model', async () => {
  setEnv({ GROQ_KEY: KEYS.GROQ_KEY, GEM_KEY: KEYS.GEM_KEY });
  reply = (c) => (c.provider === 'groq' ? answer('{"nothing": true}', c.body.model) : answer('{"html": "<p>Gemini</p>"}', c.body.model));
  const out = await ask();
  assert.equal(out.provider, 'gemini');
  assert.equal(chats().filter((c) => c.provider === 'groq').length, 3);
});

test('a model missing from the provider\'s own list is skipped without a request', async () => {
  setEnv({ GROQ_KEY: KEYS.GROQ_KEY, GROQ_MODELS: 'made/up-model,old/retired-model,openai/gpt-oss-20b' });
  const out = await ask();
  assert.equal(out.model, 'openai/gpt-oss-20b');
  assert.deepEqual(tried(), ['groq:openai/gpt-oss-20b']);
});

test('when a model list can\'t be fetched, models are tried unchecked', async () => {
  setEnv({ GROQ_KEY: KEYS.GROQ_KEY, GROQ_MODELS: 'made/up-model' });
  catalogDown = true;
  const out = await ask();
  assert.equal(out.model, 'made/up-model');
});

test('every model busy: the old "busy" message with status 429', async () => {
  setEnv({ GROQ_KEY: KEYS.GROQ_KEY, GEM_KEY: KEYS.GEM_KEY });
  reply = (c) => (c.provider === 'groq' ? respond(429, { error: { message: 'slow down' } }) : respond(503, { error: { message: 'high demand' } }));
  await assert.rejects(ask(), (err) => err.status === 429 && /Every free model is busy/.test(err.message));
});

test('other failures: the old "no usable answer" message', async () => {
  setEnv({ GROQ_KEY: KEYS.GROQ_KEY });
  reply = () => respond(500, 'oops');
  await assert.rejects(ask(), (err) => err.status === 502 && /None of the free models/.test(err.message));
});

/* ---------------- keys refused, credit ---------------- */

test('a rejected key skips the rest of that provider and moves on', async () => {
  setEnv({ GROQ_KEY: KEYS.GROQ_KEY, GEM_KEY: KEYS.GEM_KEY });
  reply = (c) => (c.provider === 'groq' ? respond(401, { error: { message: 'Invalid API Key' } }) : answer('{"html": "<p>Gemini</p>"}', c.body.model));
  const out = await ask();
  assert.equal(out.provider, 'gemini');
  assert.deepEqual(tried(), ['groq:openai/gpt-oss-120b', 'gemini:gemini-3-flash-preview']);
});

test('every key rejected: the message names the setting', async () => {
  setEnv({ GROQ_API_KEY: KEYS.GROQ_KEY });
  reply = () => respond(401, { error: { message: 'Invalid API Key' } });
  await assert.rejects(ask(), (err) => err.status === 502 && err.message === 'Groq rejected the key. Check GROQ_API_KEY in .env, then restart the server.');
});

test('OpenRouter alone keeps its old key and credit messages', async () => {
  setEnv({ OPENROUTER_API_KEY: KEYS.OPENROUTER_API_KEY, OPENROUTER_MODELS: 'vendor/thinker:free,vendor/always-thinks:free' });
  reply = () => respond(401, { error: { message: 'No auth credentials found', code: 401 } });
  await assert.rejects(ask(), (err) => err.message === 'OpenRouter rejected the key. Check OPENROUTER_API_KEY in .env, then restart the server.');
  assert.equal(chats().length, 1);

  setEnv({ OPENROUTER_API_KEY: KEYS.OPENROUTER_API_KEY, OPENROUTER_MODELS: 'vendor/thinker:free,vendor/always-thinks:free' });
  calls = [];
  reply = () => respond(402, { error: { message: 'Insufficient credits', code: 402 } });
  await assert.rejects(ask(), (err) => /credit balance is below zero/.test(err.message));
  assert.equal(chats().length, 1);
});

test('Requesty without credit: paid models are skipped, free ones still answer', async () => {
  setEnv({ REQ_KEY: KEYS.REQ_KEY, REQUESTY_MODELS: 'mistral/leanstral-1-5,nvidia/nemotron-3-ultra-550b-a55b' });
  reply = (c) => (c.body.model === 'mistral/leanstral-1-5' ? respond(402, { error: { message: 'balance is too low' } }) : answer('{"html": "<p>free</p>"}', c.body.model));
  const out = await ask();
  assert.equal(out.model, 'nvidia/nemotron-3-ultra-550b-a55b');
});

/* ---------------- what each provider is sent ---------------- */

test('request bodies and headers per provider', async () => {
  setEnv({ ...KEYS,
    GROQ_MODELS: 'openai/gpt-oss-120b,qwen/qwen3.8-27b',
    GEMINI_MODELS: 'gemini-3-flash-preview,gemini-2.5-flash',
    REQUESTY_MODELS: 'nvidia/nemotron-3-ultra-550b-a55b,mistral/leanstral-1-5,google/gemma-4-31b-it',
    OPENROUTER_MODELS: 'vendor/thinker:free,vendor/always-thinks:free' });
  reply = (c) => respond(500, { error: { message: 'collecting' } }); // every model fails, so every one is sent a request
  await assert.rejects(ask({ maxTokens: 20000 }));
  const by = Object.fromEntries(chats().map((c) => [`${c.provider}:${c.body.model}`, c]));
  assert.equal(chats().length, 9);

  for (const c of chats()) {
    assert.equal(c.url, URL_OF[c.provider]);
    const want = { groq: KEYS.GROQ_KEY, gemini: KEYS.GEM_KEY, requesty: KEYS.REQ_KEY, openrouter: KEYS.OPENROUTER_API_KEY }[c.provider];
    assert.equal(c.headers.Authorization, `Bearer ${want}`);
    assert.deepEqual(c.body.messages.map((m) => m.role), ['system', 'user']);
    assert.equal(c.body.temperature, 0.4);
    if (c.provider === 'openrouter') {
      assert.equal(c.headers['X-Title'], 'Primer');
      assert.ok(c.headers['HTTP-Referer']);
    } else {
      assert.equal('reasoning' in c.body, false, `${c.provider} must not get OpenRouter's reasoning field`);
      assert.equal('X-Title' in c.headers, false);
    }
  }

  const g = by['groq:openai/gpt-oss-120b'].body;
  assert.equal(g.reasoning_effort, 'low');
  assert.equal(g.include_reasoning, false);
  assert.deepEqual(g.response_format, { type: 'json_object' });
  assert.equal(g.max_tokens, 20000);
  const q = by['groq:qwen/qwen3.8-27b'].body;
  assert.equal(q.reasoning_effort, 'none');
  assert.equal(q.max_tokens, 16384, 'capped at the model\'s own limit');

  assert.equal(by['gemini:gemini-3-flash-preview'].body.reasoning_effort, 'low');
  assert.equal(by['gemini:gemini-2.5-flash'].body.reasoning_effort, 'none');
  assert.deepEqual(by['gemini:gemini-3-flash-preview'].body.response_format, { type: 'json_object' });

  const r1 = by['requesty:nvidia/nemotron-3-ultra-550b-a55b'].body;
  assert.equal(r1.reasoning_effort, 'none');
  assert.equal('response_format' in r1, false, 'no JSON mode where the model doesn\'t support it');
  const r2 = by['requesty:mistral/leanstral-1-5'].body;
  assert.equal('reasoning_effort' in r2, false, 'a model that can only think hard gets no effort setting');
  assert.deepEqual(r2.response_format, { type: 'json_object' });
  assert.equal(by['requesty:google/gemma-4-31b-it'].body.max_tokens, 8192);

  assert.deepEqual(by['openrouter:vendor/thinker:free'].body.reasoning, { effort: 'none', exclude: true });
  assert.deepEqual(by['openrouter:vendor/always-thinks:free'].body.reasoning, { effort: 'low', exclude: true });
  assert.deepEqual(by['openrouter:vendor/thinker:free'].body.response_format, { type: 'json_object' });

  // model lists are fetched with each provider's own key (Gemini's in a header, never in the URL)
  const cat = calls.filter((c) => c.kind === 'catalog');
  assert.equal(cat.find((c) => c.url.includes('generativelanguage')).headers['x-goog-api-key'], KEYS.GEM_KEY);
  assert.ok(cat.every((c) => !Object.values(KEYS).some((k) => c.url.includes(k))));
  assert.equal(cat.find((c) => c.url.includes('groq')).headers.Authorization, `Bearer ${KEYS.GROQ_KEY}`);
});

test('Groq\'s refused JSON-mode reply is repaired instead of thrown away', async () => {
  setEnv({ GROQ_KEY: KEYS.GROQ_KEY });
  const broken = String.raw`{"html": "<p>The slope is \(\frac{dy}{dx}\)</p>"}`; // single backslashes: not valid JSON
  reply = () => respond(400, { error: { message: 'Failed to validate JSON', type: 'invalid_request_error', code: 'json_validate_failed', failed_generation: broken } });
  const out = await ask();
  assert.equal(out.value, String.raw`<p>The slope is \(\frac{dy}{dx}\)</p>`);
  assert.equal(chats().length, 1);
});

test('keys never reach the logs, even when a provider echoes one back', async () => {
  setEnv({ ...KEYS, PRIMER_AI_ORDER: 'groq,gemini' });
  reply = (c) => (c.provider === 'groq'
    ? respond(400, { error: { message: `Bad key ${KEYS.GROQ_KEY} for organization \`org_01k3abcdefgh\`` } })
    : answer('{"html": "<p>ok</p>"}', c.body.model));
  await ask();
  assert.ok(logged.some((l) => l.includes('[key]')));
  assert.ok(!logged.join('\n').includes('org_01k3abcdefgh'), 'account ids are hidden too');
  const all = logged.join('\n');
  for (const k of Object.values(KEYS)) assert.ok(!all.includes(k), 'a key was logged');
});
