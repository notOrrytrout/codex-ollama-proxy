'use strict';

// skill_find.js
//
// Self-fulfillment loop for the synthetic `find_skill` tool, mirroring the
// pattern used by web_search.js: the proxy injects a plain `function` tool so
// the model can emit function_call{name:"find_skill"}; this loop fulfills those
// calls locally (via skill_index.searchSkills) and feeds the results back as
// function_call_output, then re-runs the model so it can act on the matched
// SKILL.md paths. web_search is intentionally NOT touched here.

const http = require('http');
const skillIndex = require('./skill-index');

const FIND_SKILL = 'find_skill';
const MAX_LOOPS = 4;

// Synthetic function-tool definition injected into request.tools so Ollama/GLM
// can call it. The proxy fulfills it; the app-server never sees a pending call.
const FIND_SKILL_FN = {
  type: 'function',
  name: FIND_SKILL,
  description: 'Find available Codex skills by keyword. Searches the index of enabled skills (both plugin and non-plugin) by skill name, plugin name, and description, with plugin-name matches ranked highest, then skill name, then description. Returns the file paths of the top matching SKILL.md files (default 5). Call this when you need to locate a relevant skill before reading or invoking one.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What you are looking for: a plugin name, skill name, or topic. Plugin-name matches rank highest.' },
      limit: { type: 'number', description: 'Maximum number of matches to return (1-20). Defaults to 5.' },
    },
    required: ['query'],
  },
};

function hasFindSkillTool(body) {
  return !!(body && Array.isArray(body.tools) && body.tools.some((t) => t && (
    t.type === 'function' && t.name === FIND_SKILL
  )));
}

function parseArgs(v) {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return {}; }
}

function findSkillCalls(response) {
  const output = response && Array.isArray(response.output) ? response.output : [];
  return output.filter((item) => item && item.type === 'function_call' && item.name === FIND_SKILL);
}

function requestJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = http.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed == null ? data : parsed);
          return;
        }
        const msg = parsed && parsed.error ? parsed.error : (data || res.statusMessage);
        reject(new Error('HTTP ' + res.statusCode + ': ' + (typeof msg === 'object' ? JSON.stringify(msg) : msg)));
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function postResponses(upstream, body) {
  return requestJson('http://' + upstream.host + ':' + upstream.port + '/v1/responses', body);
}

// Fulfill one find_skill call: search the enabled-skill index and format paths.
function fulfillFindSkill(call, log) {
  const args = parseArgs(call.arguments);
  const query = String(args.query || args.q || '').trim();
  if (!query) {
    return { call_id: call.call_id, output: '[find_skill error] query is required' };
  }
  const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
  try {
    const matches = skillIndex.searchSkills(query, { limit });
    log && log('find_skill query="' + query + '" limit=' + limit + ' -> ' + matches.length + ' match(es)');
    return { call_id: call.call_id, output: skillIndex.formatSkillMatches(matches) };
  } catch (err) {
    log && log('find_skill failed: ' + err.message);
    return { call_id: call.call_id, output: '[find_skill error] ' + err.message };
  }
}

// Mirror of web_search.runResponsesLoop, but only for find_skill calls.
async function runFindSkillLoop(upstream, originalBody, options) {
  const log = options.log || (() => {});
  let body = JSON.parse(JSON.stringify(originalBody));
  body.stream = false;
  let fulfilled = false;

  for (let loop = 0; loop < MAX_LOOPS; loop += 1) {
    const response = await postResponses(upstream, body);
    const calls = findSkillCalls(response);
    if (calls.length === 0) return { response, fulfilled };

    fulfilled = true;
    log('find_skill loop: fulfilling ' + calls.length + ' call(s)');
    const outputs = calls.map((call) => {
      const r = fulfillFindSkill(call, log);
      return { type: 'function_call_output', call_id: r.call_id, output: r.output };
    });

    body = Object.assign({}, body, {
      input: [
        ...(Array.isArray(response.output) ? response.output : []),
        ...outputs,
      ],
      stream: false,
    });
  }

  throw new Error('find_skill loop exceeded ' + MAX_LOOPS + ' iterations');
}

module.exports = {
  FIND_SKILL,
  FIND_SKILL_FN,
  hasFindSkillTool,
  findSkillCalls,
  fulfillFindSkill,
  runFindSkillLoop,
};
