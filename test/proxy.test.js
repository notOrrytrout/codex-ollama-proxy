'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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
