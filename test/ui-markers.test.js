'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  emitOutputItemProgress,
  makeImageGenerationStartedMarker,
} = require('../src/ui-markers');

test('started image generation marker carries an animated GIF result', () => {
  const marker = makeImageGenerationStartedMarker({
    id: 'ig_test',
    arguments: JSON.stringify({ prompt: 'test image' }),
  });

  assert.equal(marker.type, 'image_generation_call');
  assert.equal(marker.id, 'ig_test');
  assert.equal(marker.status, 'in_progress');
  assert.match(marker.result, /^data:image\/gif;base64,/);
});

test('progress emitter sends the in-progress marker through output_item.done', () => {
  const frames = [];
  const clientRes = { write: (frame) => frames.push(frame) };
  const marker = makeImageGenerationStartedMarker({
    id: 'ig_test',
    arguments: JSON.stringify({ prompt: 'test image' }),
  });

  const outputIndex = emitOutputItemProgress(clientRes, marker, { index: 0, num: 10 });

  assert.equal(outputIndex, 0);
  assert.equal(frames.length, 2);
  assert.match(frames[0], /event: response\.output_item\.added/);
  assert.match(frames[1], /event: response\.output_item\.done/);
  assert.match(frames[1], /"status":"in_progress"/);
  assert.match(frames[1], /"result":"data:image\/gif;base64,/);
});
