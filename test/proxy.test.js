'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function postJson(port, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/v1/responses',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function postStream(port, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/v1/responses',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        accept: 'text/event-stream',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function writeSse(res, event, data) {
  if (event) res.write('event: ' + event + '\n');
  res.write('data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n');
}

function parseSse(body) {
  return body.split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event:'));
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    return {
      event: event ? event.slice(6).trim() : null,
      data: data === '[DONE]' ? data : JSON.parse(data),
    };
  });
}

function assertSuccessfulTerminal(events) {
  const names = events.map((entry) => entry.event);
  assert.equal(names[0], 'response.created');
  assert.equal(names[1], 'response.in_progress');
  assert.equal(names.filter((name) => name === 'response.completed').length, 1);
  assert.equal(names.some((name) => name === 'response.failed'), false);
  assert.equal(names.at(-1), 'response.completed');
  assert.equal(events.some((entry) => entry.data === '[DONE]'), false);
  const added = names.lastIndexOf('response.output_item.added');
  const done = names.lastIndexOf('response.output_item.done');
  const completed = names.lastIndexOf('response.completed');
  assert.ok(added > names.lastIndexOf('response.in_progress'));
  assert.ok(done > added);
  assert.ok(completed > done);
}

async function withProxy(upstreamHandler, run, config = []) {
  const upstream = http.createServer(upstreamHandler);
  const upstreamPort = await listen(upstream);
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-proxy-stream-test-'));
  fs.mkdirSync(path.join(codexHome, 'ollama-shape-proxy'), { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'ollama-shape-proxy', 'proxy-models.toml'), [
    'text_model = "test-model"',
    `upstream_url = "http://127.0.0.1:${upstreamPort}/custom"`,
    ...config,
    '',
  ].join('\n'));

  const previousCodexHome = process.env.CODEX_HOME;
  const previousProxyPort = process.env.PROXY_PORT;
  process.env.CODEX_HOME = codexHome;
  process.env.PROXY_PORT = '0';
  delete require.cache[require.resolve('../src/proxy')];
  const proxy = require('../src/proxy');
  const server = proxy.startServer(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(server.address().port, proxy);
  } finally {
    await close(server);
    await close(upstream);
    delete require.cache[require.resolve('../src/proxy')];
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousProxyPort === undefined) delete process.env.PROXY_PORT;
    else process.env.PROXY_PORT = previousProxyPort;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
}

function withRouteConfig(config, run) {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-proxy-routing-test-'));
  const runtimeDir = path.join(codexHome, 'ollama-shape-proxy');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'proxy-models.toml'), [...config, ''].join('\n'));

  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  delete require.cache[require.resolve('../src/proxy')];
  try {
    return run(require('../src/proxy'));
  } finally {
    delete require.cache[require.resolve('../src/proxy')];
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
}

function textItem(id, text, attachments = []) {
  return {
    type: 'message',
    id,
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }, ...attachments],
  };
}

test('dedupeLargeInputBlocks keeps the newest large developer block', () => {
  const { dedupeLargeInputBlocks } = require('../src/proxy');
  const repeated = '<skills_instructions>' + 'x'.repeat(600) + '</skills_instructions>';
  const body = {
    input: [
      { type: 'message', id: 'old', role: 'developer', content: [
        { type: 'input_text', text: repeated },
        { type: 'input_text', text: 'old unique' },
      ] },
      { type: 'message', id: 'user', role: 'user', content: [
        { type: 'input_text', text: repeated },
      ] },
      { type: 'message', id: 'new', role: 'developer', content: [
        { type: 'input_text', text: repeated },
        { type: 'input_text', text: 'new unique' },
      ] },
    ],
  };

  const removed = dedupeLargeInputBlocks(body, 512);

  assert.deepEqual(removed, { blocks: 1, chars: repeated.length });
  assert.deepEqual(body.input.map((item) => item.id), ['old', 'user', 'new']);
  assert.deepEqual(body.input[0].content.map((block) => block.text), ['old unique']);
  assert.equal(body.input[1].content[0].text, repeated);
  assert.deepEqual(body.input[2].content.map((block) => block.text), [repeated, 'new unique']);
});

test('dedupeLargeInputBlocks preserves short, distinct, and non-developer text', () => {
  const { dedupeLargeInputBlocks } = require('../src/proxy');
  const short = 'same short text';
  const long = 'y'.repeat(700);
  const body = { input: [
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: short }] },
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: short }] },
    { type: 'message', role: 'assistant', content: [{ type: 'input_text', text: long }] },
    { type: 'message', role: 'assistant', content: [{ type: 'input_text', text: long }] },
  ] };

  assert.deepEqual(dedupeLargeInputBlocks(body, 512), { blocks: 0, chars: 0 });
  assert.equal(body.input.length, 4);
});

function writeTextTurn(res, options = {}) {
  const id = options.id || 'resp_text';
  const text = options.text || 'done';
  const item = textItem('msg_' + id, text, options.attachments);
  res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
  writeSse(res, 'response.created', { type: 'response.created', response: { id, status: 'in_progress', output: [] } });
  writeSse(res, 'response.in_progress', { type: 'response.in_progress', response: { id, status: 'in_progress', output: [] } });
  writeSse(res, 'response.output_item.added', {
    type: 'response.output_item.added', output_index: 0, sequence_number: 0,
    item: Object.assign({}, item, { status: 'in_progress', content: [] }),
  });
  writeSse(res, 'response.content_part.added', {
    type: 'response.content_part.added', output_index: 0, content_index: 0, sequence_number: 1,
    part: { type: 'output_text', text: '', annotations: [] },
  });
  writeSse(res, 'response.output_text.delta', {
    type: 'response.output_text.delta', output_index: 0, content_index: 0, sequence_number: 2, delta: text,
  });
  writeSse(res, 'response.output_text.done', {
    type: 'response.output_text.done', output_index: 0, content_index: 0, sequence_number: 3, text,
  });
  writeSse(res, 'response.content_part.done', {
    type: 'response.content_part.done', output_index: 0, content_index: 0, sequence_number: 4,
    part: { type: 'output_text', text, annotations: [] },
  });
  writeSse(res, 'response.output_item.done', {
    type: 'response.output_item.done', output_index: 0, sequence_number: 5, item,
  });
  if (options.ending === 'completed') {
    writeSse(res, 'response.completed', {
      type: 'response.completed', response: { id, status: 'completed', output: [item] },
    });
  } else if (options.ending === 'done') {
    writeSse(res, null, '[DONE]');
  }
  res.end();
}

function writeFunctionTurn(res, item, ending) {
  const id = 'resp_' + item.call_id;
  res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
  writeSse(res, 'response.created', { type: 'response.created', response: { id, status: 'in_progress', output: [] } });
  writeSse(res, 'response.in_progress', { type: 'response.in_progress', response: { id, status: 'in_progress', output: [] } });
  writeSse(res, 'response.output_item.added', {
    type: 'response.output_item.added', output_index: 0, sequence_number: 0, item,
  });
  writeSse(res, 'response.output_item.done', {
    type: 'response.output_item.done', output_index: 0, sequence_number: 1, item,
  });
  if (ending === 'completed') {
    writeSse(res, 'response.completed', {
      type: 'response.completed', response: { id, status: 'completed', output: [item] },
    });
  } else if (ending === 'done') {
    writeSse(res, null, '[DONE]');
  }
  res.end();
}

function routeModel(body, autoRouteImage = true) {
  return withRouteConfig([
    'text_model = "text-model"',
    'image_model = "vision-model"',
    'auto_route_image = ' + autoRouteImage,
  ], ({ translateRequestBody }) => {
    translateRequestBody(body);
    return body.model;
  });
}

test('request translation converts replayed image_generation_call items for Ollama', () => {
  const { translateRequestBody } = require('../src/proxy');
  const body = {
    model: 'test-model',
    input: [{
      type: 'image_generation_call',
      status: 'completed',
      revised_prompt: 'a blue flower bot',
      saved_path: '/tmp/flower.png',
      result: 'data:image/png;base64,abcdef',
    }],
    tools: [],
  };

  translateRequestBody(body);

  assert.equal(body.input.length, 1);
  assert.equal(body.input[0].type, 'message');
  assert.equal(body.input[0].role, 'assistant');
  assert.equal(body.input[0].content[0].type, 'output_text');
  assert.match(body.input[0].content[0].text, /saved_path=\/tmp\/flower\.png/);
  assert.doesNotMatch(JSON.stringify(body), /"image_generation_call"/);
});

test('request translation exposes deferred tool_search namespace tools as callable functions', () => {
  const { translateRequestBody } = require('../src/proxy');
  const body = {
    model: 'test-model',
    input: [{
      type: 'tool_search_output',
      call_id: 'call_search',
      status: 'completed',
      execution: 'client',
      tools: [{
        type: 'namespace',
        name: 'mcp__storefront_builder',
        description: 'Storefront Builder tools',
        tools: [{
          type: 'function',
          name: 'list_storefront_build_sessions',
          description: 'List sessions',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        }],
      }],
    }],
    tools: [],
  };

  translateRequestBody(body);

  assert.ok(
    body.tools.some((tool) =>
      tool.type === 'function' &&
      tool.name === 'mcp__storefront_builder__list_storefront_build_sessions'
    ),
    'expected deferred namespace tool to be added to top-level tools'
  );
  assert.equal(body.input[0].type, 'function_call_output');
  assert.match(body.input[0].output, /mcp__storefront_builder__list_storefront_build_sessions/);
});

test('request translation converts native tool_search to callable function tool', () => {
  const { translateRequestBody } = require('../src/proxy');
  const body = {
    model: 'test-model',
    input: 'find the storefront builder tools',
    tools: [{
      type: 'tool_search',
      execution: 'client',
      description: 'Search deferred tool metadata',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    }],
  };

  translateRequestBody(body);

  assert.ok(
    body.tools.some((tool) =>
      tool.type === 'function' &&
      tool.name === 'tool_search' &&
      tool.parameters &&
      tool.parameters.properties &&
      tool.parameters.properties.query
    ),
    'expected native tool_search to be exposed as a function tool'
  );
  assert.equal(body.tools.some((tool) => tool.type === 'tool_search'), false);
});

test('request translation injects tool_search when Codex omits it', () => {
  const { translateRequestBody } = require('../src/proxy');
  const body = {
    model: 'test-model',
    input: 'list available tools',
    tools: [],
  };

  translateRequestBody(body);

  assert.ok(
    body.tools.some((tool) => tool.type === 'function' && tool.name === 'tool_search'),
    'expected tool_search to be injected as a function tool'
  );
});

function duplicateDeveloperBody(repeated) {
  return {
    model: 'test-model',
    input: [
      { type: 'message', id: 'd1', role: 'developer', content: [{ type: 'input_text', text: repeated }] },
      { type: 'message', id: 'd2', role: 'developer', content: [{ type: 'input_text', text: repeated }] },
    ],
    tools: [],
  };
}

function countRepeatedBlocks(body, repeated) {
  let n = 0;
  for (const item of body.input || []) {
    if (Array.isArray(item && item.content)) {
      for (const block of item.content) if (block && block.text === repeated) n += 1;
    }
  }
  return n;
}

test('translateRequestBody does not dedupe large developer blocks by default (protects provider caching)', () => {
  const repeated = '<skills_instructions>' + 'x'.repeat(600) + '</skills_instructions>';
  const retained = withRouteConfig(['text_model = "test-model"'], ({ translateRequestBody }) => {
    const body = duplicateDeveloperBody(repeated);
    translateRequestBody(body);
    return countRepeatedBlocks(body, repeated);
  });
  assert.equal(retained, 2, 'both copies retained when dedupe_large_input is not enabled');
});

test('translateRequestBody dedupes large developer blocks when enabled via route config', () => {
  const repeated = '<skills_instructions>' + 'x'.repeat(600) + '</skills_instructions>';
  const retained = withRouteConfig(['text_model = "test-model"', 'dedupe_large_input = true'], ({ translateRequestBody }) => {
    const body = duplicateDeveloperBody(repeated);
    translateRequestBody(body);
    return countRepeatedBlocks(body, repeated);
  });
  assert.equal(retained, 1, 'newest copy retained when dedupe_large_input = true');
});

test('PROXY_DEDUPE_LARGE_INPUT=1 opts in to large-input dedupe at proxy start (CLI flag path)', () => {
  const repeated = '<skills_instructions>' + 'x'.repeat(600) + '</skills_instructions>';
  const previous = process.env.PROXY_DEDUPE_LARGE_INPUT;
  process.env.PROXY_DEDUPE_LARGE_INPUT = '1';
  try {
    const retained = withRouteConfig(['text_model = "test-model"'], ({ translateRequestBody }) => {
      const body = duplicateDeveloperBody(repeated);
      translateRequestBody(body);
      return countRepeatedBlocks(body, repeated);
    });
    assert.equal(retained, 1, 'env opt-in enables dedupe even without a toml key');
  } finally {
    if (previous === undefined) delete process.env.PROXY_DEDUPE_LARGE_INPUT;
    else process.env.PROXY_DEDUPE_LARGE_INPUT = previous;
  }
});

test('request translation removes duplicate function definitions', () => {
  const { translateRequestBody } = require('../src/proxy');
  const duplicate = {
    type: 'function',
    name: 'duplicate_tool',
    parameters: { type: 'object', properties: {} },
  };
  const body = {
    model: 'test-model',
    input: 'use a tool',
    tools: [duplicate, JSON.parse(JSON.stringify(duplicate))],
  };

  translateRequestBody(body);

  assert.equal(body.tools.filter((tool) => tool.name === 'duplicate_tool').length, 1);
});

test('turn-local additional_tools override stale same-name top-level schemas', () => {
  const { translateRequestBody } = require('../src/proxy');
  const stale = {
    type: 'function',
    name: 'changing_tool',
    description: 'stale definition',
    parameters: { type: 'object', properties: { oldArgument: { type: 'string' } } },
  };
  const current = {
    type: 'function',
    name: 'changing_tool',
    description: 'current turn definition',
    parameters: { type: 'object', properties: { currentArgument: { type: 'number' } } },
  };
  const body = {
    model: 'test-model',
    input: [{ type: 'additional_tools', role: 'developer', tools: [current] }],
    tools: [stale],
  };

  translateRequestBody(body);

  const definitions = body.tools.filter((tool) => tool.name === 'changing_tool');
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].description, 'current turn definition');
  assert.deepEqual(definitions[0].parameters, current.parameters);
});

test('image auto-routing sends a current user attachment to the vision model', () => {
  const model = routeModel({
    model: 'text-model',
    input: [{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'Describe this image.' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
      ],
    }],
    tools: [],
  });

  assert.equal(model, 'vision-model');
});

test('image auto-routing sends a current Computer Use screenshot to the vision model', () => {
  const model = routeModel({
    model: 'text-model',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'What is visible in the current window?' }],
      },
      { type: 'function_call', name: 'ComputerUse', call_id: 'call_computer', arguments: '{}' },
      {
        type: 'function_call_output',
        call_id: 'call_computer',
        output: [{ type: 'input_image', file_id: 'file_screenshot' }],
      },
    ],
    tools: [],
  });

  assert.equal(model, 'vision-model');
});

test('image auto-routing ignores screenshots from earlier user turns', () => {
  const model = routeModel({
    model: 'vision-model',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe this screenshot.' },
          { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
        ],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'It shows the settings window.' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Now explain the keyboard shortcut.' }],
      },
    ],
    tools: [],
  });

  assert.equal(model, 'text-model');
});

test('disabled image auto-routing preserves the selected model', () => {
  const model = routeModel({
    model: 'manually-selected-model',
    input: [{
      type: 'message',
      role: 'user',
      content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }],
    }],
    tools: [],
  }, false);

  assert.equal(model, 'manually-selected-model');
});

test('proxy forwards responses requests to configured upstream URL with bearer auth', async () => {
  const received = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp_test', output: [], status: 'completed' }));
    });
  });
  const upstreamPort = await listen(upstream);
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-proxy-test-'));
  fs.mkdirSync(path.join(codexHome, 'ollama-shape-proxy'), { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'ollama-shape-proxy', 'proxy-models.toml'), [
    'text_model = "test-model"',
    `upstream_url = "http://127.0.0.1:${upstreamPort}/custom"`,
    'upstream_api_key = "secret-token"',
    '',
  ].join('\n'));

  const previousCodexHome = process.env.CODEX_HOME;
  const previousProxyPort = process.env.PROXY_PORT;
  process.env.CODEX_HOME = codexHome;
  process.env.PROXY_PORT = '0';
  delete require.cache[require.resolve('../src/proxy')];
  const proxy = require('../src/proxy');
  const server = proxy.startServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const proxyPort = server.address().port;

  try {
    const response = await postJson(proxyPort, {
      model: 'test-model',
      input: 'hello',
      tools: [],
      stream: false,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, 'POST');
    assert.equal(received[0].url, '/custom/responses');
    assert.equal(received[0].authorization, 'Bearer secret-token');
    assert.equal(received[0].body.model, 'test-model');
  } finally {
    await close(server);
    await close(upstream);
    delete require.cache[require.resolve('../src/proxy')];
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousProxyPort === undefined) delete process.env.PROXY_PORT;
    else process.env.PROXY_PORT = previousProxyPort;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('streaming SSE preserves ordering and translates tool_search_call', async () => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
    res.write('event: response.created\n');
    res.write('data: ' + JSON.stringify({ type: 'response.created', response: { id: 'resp_sse' } }) + '\n\n');
    res.write('event: response.output_item.added\n');
    res.write('data: ' + JSON.stringify({
      type: 'response.output_item.added',
      output_index: 0,
      sequence_number: 0,
      item: {
        type: 'function_call',
        id: 'item_search',
        call_id: 'call_search',
        name: 'tool_search',
        arguments: '{"query":"node_repl"}',
        status: 'completed',
      },
    }) + '\n\n');
    res.write('event: response.output_item.done\n');
    res.write('data: ' + JSON.stringify({
      type: 'response.output_item.done',
      output_index: 0,
      sequence_number: 1,
      item: {
        type: 'function_call',
        id: 'item_search',
        call_id: 'call_search',
        name: 'tool_search',
        arguments: '{"query":"node_repl"}',
        status: 'completed',
      },
    }) + '\n\n');
    res.write('event: response.completed\n');
    res.write('data: ' + JSON.stringify({
      type: 'response.completed',
      response: {
        id: 'resp_sse',
        output: [{
          type: 'function_call',
          id: 'item_search',
          call_id: 'call_search',
          name: 'tool_search',
          arguments: '{"query":"node_repl"}',
          status: 'completed',
        }],
      },
    }) + '\n\n');
    res.end();
  });
  const upstreamPort = await listen(upstream);
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-proxy-test-'));
  fs.mkdirSync(path.join(codexHome, 'ollama-shape-proxy'), { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'ollama-shape-proxy', 'proxy-models.toml'), [
    'text_model = "test-model"',
    `upstream_url = "http://127.0.0.1:${upstreamPort}/custom"`,
    '',
  ].join('\n'));

  const previousCodexHome = process.env.CODEX_HOME;
  const previousProxyPort = process.env.PROXY_PORT;
  process.env.CODEX_HOME = codexHome;
  process.env.PROXY_PORT = '0';
  delete require.cache[require.resolve('../src/proxy')];
  const proxy = require('../src/proxy');
  const server = proxy.startServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const proxyPort = server.address().port;

  try {
    const response = await postStream(proxyPort, {
      model: 'test-model',
      input: 'search tools',
      tools: [],
      stream: true,
    });
    assert.equal(response.statusCode, 200);
    assert.ok(response.body.indexOf('event: response.output_item.added') < response.body.indexOf('event: response.output_item.done'));
    assert.ok(response.body.indexOf('event: response.output_item.done') < response.body.indexOf('event: response.completed'));
    assert.match(response.body, /"type":"tool_search_call"/);
  } finally {
    await close(server);
    await close(upstream);
    delete require.cache[require.resolve('../src/proxy')];
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousProxyPort === undefined) delete process.env.PROXY_PORT;
    else process.env.PROXY_PORT = previousProxyPort;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('normal streamed text ending with [DONE] gets one ordered response.completed', async () => {
  await withProxy((req, res) => {
    req.resume();
    writeTextTurn(res, { id: 'resp_done', text: 'hello from DONE', ending: 'done' });
  }, async (proxyPort) => {
    const response = await postStream(proxyPort, {
      model: 'test-model', input: 'hello', tools: [], stream: true,
    });
    const events = parseSse(response.body);
    assert.equal(response.statusCode, 200);
    assertSuccessfulTerminal(events);
    assert.equal(events.filter((entry) => entry.event === 'response.output_text.delta').length, 1);
    assert.equal(events.at(-1).data.response.output[0].content[0].text, 'hello from DONE');
  });
});

test('normal streamed text ending by EOF gets response.completed before closure', async () => {
  await withProxy((req, res) => {
    req.resume();
    writeTextTurn(res, { id: 'resp_eof', text: 'hello from EOF', ending: 'eof' });
  }, async (proxyPort) => {
    const response = await postStream(proxyPort, {
      model: 'test-model', input: 'hello', tools: [], stream: true,
    });
    const events = parseSse(response.body);
    assertSuccessfulTerminal(events);
    assert.equal(events.at(-1).data.response.id, 'resp_eof');
    assert.equal(events.at(-1).data.response.output[0].content[0].text, 'hello from EOF');
  });
});

test('multiple proxy-fulfilled model turns finish only after the final assistant response', async () => {
  const received = [];
  await withProxy((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      received.push(body);
      if (received.length <= 2) {
        if (received.length === 2) {
          assert.equal(body.input[0].name, 'ollama_proxy_status');
          assert.equal(body.input[1].type, 'function_call_output');
        }
        writeFunctionTurn(res, {
          type: 'function_call',
          id: 'item_status_' + received.length,
          call_id: 'call_status_' + received.length,
          name: 'ollama_proxy_status',
          arguments: '{}',
          status: 'completed',
        }, received.length === 1 ? 'done' : 'eof');
        return;
      }
      assert.equal(body.input[0].name, 'ollama_proxy_status');
      assert.equal(body.input[1].type, 'function_call_output');
      writeTextTurn(res, { id: 'resp_internal_final', text: 'Computer Use is ready.', ending: 'done' });
    });
  }, async (proxyPort) => {
    const response = await postStream(proxyPort, {
      model: 'test-model', input: 'inspect app state', tools: [], stream: true,
    });
    const events = parseSse(response.body);
    assert.equal(received.length, 3);
    assertSuccessfulTerminal(events);
    assert.equal(events.filter((entry) => entry.event === 'response.created').length, 1);
    assert.equal(events.filter((entry) => entry.event === 'response.in_progress').length, 1);
    assert.equal(events.at(-1).data.response.output.at(-1).content[0].text, 'Computer Use is ready.');
  });
});

test('upstream errors emit response.failed instead of closing silently', async () => {
  await withProxy((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    writeSse(res, 'response.created', {
      type: 'response.created', response: { id: 'resp_broken', status: 'in_progress', output: [] },
    });
    writeSse(res, 'response.in_progress', {
      type: 'response.in_progress', response: { id: 'resp_broken', status: 'in_progress', output: [] },
    });
    writeSse(res, 'response.output_item.added', {
      type: 'response.output_item.added', output_index: 0, sequence_number: 0,
      item: { type: 'message', id: 'msg_broken', role: 'assistant', status: 'in_progress', content: [] },
    });
    setImmediate(() => res.destroy());
  }, async (proxyPort) => {
    const response = await postStream(proxyPort, {
      model: 'test-model', input: 'break', tools: [], stream: true,
    });
    const events = parseSse(response.body);
    assert.equal(events.at(-1).event, 'response.failed');
    assert.equal(events.filter((entry) => entry.event === 'response.failed').length, 1);
    assert.equal(events.some((entry) => entry.event === 'response.completed'), false);
    assert.equal(events.at(-1).data.response.status, 'failed');
  });
});

test('upstream HTTP errors emit a complete failed lifecycle', async () => {
  await withProxy((req, res) => {
    req.resume();
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'temporarily unavailable' }));
  }, async (proxyPort) => {
    const response = await postStream(proxyPort, {
      model: 'test-model', input: 'fail before streaming', tools: [], stream: true,
    });
    const events = parseSse(response.body);
    assert.deepEqual(events.map((entry) => entry.event), [
      'response.created',
      'response.in_progress',
      'response.failed',
    ]);
    assert.equal(events.at(-1).data.response.status, 'failed');
    assert.match(events.at(-1).data.response.error.message, /upstream 503/);
  });
});

test('client disconnect aborts the active upstream stream', async () => {
  let resolveUpstreamClosed;
  const upstreamClosed = new Promise((resolve) => { resolveUpstreamClosed = resolve; });
  await withProxy((req, res) => {
    req.resume();
    res.on('close', resolveUpstreamClosed);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    writeSse(res, 'response.created', {
      type: 'response.created', response: { id: 'resp_disconnect', status: 'in_progress', output: [] },
    });
  }, async (proxyPort) => {
    await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ model: 'test-model', input: 'disconnect', tools: [], stream: true });
      const req = http.request({
        host: '127.0.0.1', port: proxyPort, method: 'POST', path: '/v1/responses',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      }, (res) => {
        res.once('data', () => {
          res.destroy();
          req.destroy();
          resolve();
        });
      });
      req.on('error', (error) => {
        if (error.code === 'ECONNRESET') resolve();
        else reject(error);
      });
      req.end(payload);
    });
    await upstreamClosed;
  });
});
