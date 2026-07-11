'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('skill index honors CODEX_HOME independently of package location', () => {
  const expected = path.join('/tmp', 'codex-home-for-skill-index-test');
  process.env.CODEX_HOME = expected;

  const skillIndex = require('../src/skill-index');

  assert.equal(skillIndex.CODEX_DIR, expected);
});
