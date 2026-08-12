const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBackground(storageState = {}) {
  const listeners = [];
  const context = {
    console,
    URL,
    Uint8Array,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    importScripts() {},
    fetch: async () => { throw new Error('Unexpected fetch'); },
    chrome: {
      storage: {
        local: {
          get(keys, callback) {
            const names = Array.isArray(keys) ? keys : Object.keys(keys || {});
            const result = Object.fromEntries(names.filter(key => key in storageState).map(key => [key, storageState[key]]));
            if (callback) callback(result);
            return Promise.resolve(result);
          },
          set(changes, callback) {
            Object.assign(storageState, changes);
            if (callback) callback();
            return Promise.resolve();
          }
        }
      },
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener(listener) { listeners.push(listener); } },
        lastError: null
      },
      action: { setIcon() {}, setTitle() {} },
      contextMenus: { removeAll(callback) { callback(); }, create() {}, onClicked: { addListener() {} } },
      tabs: { query(_query, callback) { callback([]); }, sendMessage() { return Promise.resolve(); } }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context);
  return { context, storageState };
}

test('migrates the legacy Anthropic key without overwriting it', async () => {
  const { context } = loadBackground({ apiKey: 'sk-ant-legacy' });
  const config = await context.getApiConfig();
  assert.deepEqual(
    { provider: config.provider, key: config.key, model: config.model },
    { provider: 'anthropic', key: 'sk-ant-legacy', model: 'claude-sonnet-5' }
  );
});

test('stores OpenAI credentials separately', async () => {
  const { context, storageState } = loadBackground({ anthropicApiKey: 'sk-ant-existing' });
  await context.saveApiConfig({
    provider: 'openai', key: 'sk-proj-test',
    model: 'gpt-5.6-luna', summaryModel: 'gpt-5.6-sol'
  });
  assert.equal(storageState.anthropicApiKey, 'sk-ant-existing');
  assert.equal(storageState.openaiApiKey, 'sk-proj-test');
  assert.equal(storageState.openaiModel, 'gpt-5.6-luna');
  assert.equal(storageState.openaiSummaryModel, 'gpt-5.6-sol');
  assert.equal(storageState.provider, 'openai');
});

test('translates text, image, and web search requests to Responses API', async () => {
  const { context } = loadBackground();
  let request;
  context.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }]
      })
    };
  };

  const response = await context.callOpenAI('sk-proj-test', {
    model: 'gpt-5.6-luna',
    system: 'Return JSON.',
    max_tokens: 100,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } },
      { type: 'text', text: 'Analyze this.' }
    ] }]
  });

  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.options.headers.Authorization, 'Bearer sk-proj-test');
  assert.deepEqual(JSON.parse(JSON.stringify(request.body.tools)), [{ type: 'web_search' }]);
  assert.equal(request.body.input[0].content[0].type, 'input_image');
  assert.equal(request.body.input[0].content[0].image_url, 'data:image/png;base64,YWJj');
  assert.equal(request.body.input[0].content[1].type, 'input_text');
  assert.equal(request.body.reasoning.effort, 'none');
  assert.equal(request.body.store, false);
  assert.equal(context.extractModelText('openai', response), '{"ok":true}');
});

test('omits reasoning options for non-GPT-5 custom models', async () => {
  const { context } = loadBackground();
  let body;
  context.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output: [] }) };
  };
  await context.callOpenAI('sk-test', {
    model: 'gpt-4.1-mini', system: 'Test', max_tokens: 10,
    messages: [{ role: 'user', content: 'Hello' }]
  });
  assert.equal('reasoning' in body, false);
});

test('routes long-form video summaries to Sol with low reasoning and a strict schema', async () => {
  const { context } = loadBackground({
    provider: 'openai',
    openaiApiKey: 'sk-proj-test',
    openaiModel: 'gpt-5.6-luna',
    openaiSummaryModel: 'gpt-5.6-sol'
  });
  let body;
  context.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify({
            kind: 'video', content_type: 'explainer', tldr: 'Summary', points: ['Point'],
            why_it_matters: null, notable_details: [], caveats: [], timeline: [],
            ai_score: null, ai_note: null, copycat_score: null, copycat_note: null,
            bias_score: 0, bias_note: null
          }) }]
        }]
      })
    };
  };

  const result = await context.analyzePage({
    kind: 'video', title: 'Test video', domain: 'youtube.com',
    text: '[0:00] A sufficiently long transcript for the adapter test.',
    meta: { wordCount: 10, language: 'en', captionKind: 'creator captions' }
  });

  assert.equal(result.data.kind, 'video');
  assert.equal(body.model, 'gpt-5.6-sol');
  assert.equal(body.reasoning.effort, 'low');
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.store, false);
});
