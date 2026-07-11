'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const childProcess = require('node:child_process');

test('skill index honors CODEX_HOME independently of package location', () => {
  const expected = path.join('/tmp', 'codex-home-for-skill-index-test');
  process.env.CODEX_HOME = expected;

  delete require.cache[require.resolve('../src/codex-app-server-skills')];
  delete require.cache[require.resolve('../src/skill-index')];
  const skillIndex = require('../src/skill-index');

  assert.equal(skillIndex.CODEX_DIR, expected);
});

test('skill index uses Codex app-server effective enabled skills when available', () => {
  const originalSpawnSync = childProcess.spawnSync;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalAppServerPath = process.env.CODEX_APP_SERVER_PATH;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skill-index-'));
  const fakeCodexAppServer = path.join(tempHome, 'codex');
  const pluginSkillsRoot = path.join(
    tempHome,
    'plugins',
    'cache',
    'openai-curated-remote',
    'superpowers',
    '6.1.1',
    'skills'
  );
  fs.mkdirSync(pluginSkillsRoot, { recursive: true });
  fs.writeFileSync(fakeCodexAppServer, '', 'utf8');

  const pluginList = {
    id: 2,
    result: {
      marketplaces: [{
        name: 'openai-curated-remote',
        plugins: [{
          id: 'superpowers@openai-curated-remote',
          name: 'superpowers',
          localVersion: '6.1.1',
          version: '6.1.1',
          installed: true,
          enabled: true,
        }],
      }],
      marketplaceLoadErrors: [],
      featuredPluginIds: [],
    },
  };
  const skillsList = {
    id: 3,
    result: {
      data: [{
        cwd: process.cwd(),
        skills: [{
          name: 'superpowers:systematic-debugging',
          description: 'Use when encountering any bug',
          path: path.join(pluginSkillsRoot, 'systematic-debugging', 'SKILL.md'),
          scope: 'user',
          enabled: true,
        }, {
          name: 'mzs-metrics:view-mzs-metrics',
          description: 'disabled skill',
          path: path.join(tempHome, 'disabled', 'SKILL.md'),
          scope: 'user',
          enabled: false,
        }],
        errors: [],
      }],
    },
  };

  childProcess.spawnSync = (_cmd, _args, options) => {
    const input = String((options && options.env && options.env.CODEX_APP_SERVER_REQUEST) || '');
    if (input.includes('"plugin/list"')) {
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ id: 1, result: {} }) + '\n' + JSON.stringify(pluginList) + '\n'),
        stderr: Buffer.alloc(0),
      };
    }
    if (input.includes('"skills/list"')) {
      assert.match(input, new RegExp(pluginSkillsRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ id: 1, result: {} }) + '\n' + JSON.stringify({ id: 2, result: {} }) + '\n' + JSON.stringify(skillsList) + '\n'),
        stderr: Buffer.alloc(0),
      };
    }
    throw new Error('unexpected app-server request: ' + input);
  };

  try {
    process.env.CODEX_HOME = tempHome;
    process.env.CODEX_APP_SERVER_PATH = fakeCodexAppServer;
    delete require.cache[require.resolve('../src/codex-app-server-skills')];
    delete require.cache[require.resolve('../src/skill-index')];
    const skillIndex = require('../src/skill-index');

    const entries = skillIndex.buildEntries();

    assert.deepEqual(entries.map((entry) => entry.skill_name), ['superpowers:systematic-debugging']);
    assert.equal(entries[0].plugin_name, 'superpowers');
    assert.equal(entries[0].scope, 'user');
  } finally {
    childProcess.spawnSync = originalSpawnSync;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    if (originalAppServerPath === undefined) delete process.env.CODEX_APP_SERVER_PATH;
    else process.env.CODEX_APP_SERVER_PATH = originalAppServerPath;
    delete require.cache[require.resolve('../src/codex-app-server-skills')];
    delete require.cache[require.resolve('../src/skill-index')];
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
