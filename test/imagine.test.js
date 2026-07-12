'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Gemini image generation config nests aspect ratio under imageConfig', () => {
  const { buildGeminiGenerationConfig } = require('../src/imagine');

  const config = buildGeminiGenerationConfig({ aspectRatio: '16:9', imageSize: '2K' });

  assert.deepEqual(config, {
    responseModalities: ['IMAGE'],
    imageConfig: {
      aspectRatio: '16:9',
      imageSize: '2K',
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'aspectRatio'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'imageSize'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'responseFormat'), false);
});
