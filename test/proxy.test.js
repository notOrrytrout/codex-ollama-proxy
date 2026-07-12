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
