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
