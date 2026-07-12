'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('searchWeb falls back to DuckDuckGo when Ollama direct and local search fail', async () => {
  const webSearch = require('../src/web-search');
  const calls = [];
  const logs = [];
  const previousKey = process.env.OLLAMA_API_KEY;
  process.env.OLLAMA_API_KEY = 'test-key';
  webSearch.__setSearchBackendsForTest({
    requestJson: async (url) => {
      calls.push(url);
      throw new Error('forced failure for ' + url);
    },
    duckDuckGoSearch: async (query, maxResults) => {
      calls.push('duckduckgo:' + query + ':' + maxResults);
      return {
        source: 'duckduckgo',
        results: [{ title: 'Fallback result', url: 'https://example.test', content: 'fallback ok' }],
      };
    },
  });

  try {
    const result = await webSearch.searchWeb({ query: 'fallback check', max_results: 2 }, (msg) => logs.push(msg));

    assert.equal(result.source, 'duckduckgo');
    assert.deepEqual(calls, [
      'https://ollama.com/api/web_search',
      'http://127.0.0.1:11434/api/experimental/web_search',
      'duckduckgo:fallback check:2',
    ]);
    assert.match(logs.join('\n'), /ollama direct web_search failed/);
    assert.match(logs.join('\n'), /ollama local web_search failed/);
  } finally {
    webSearch.__resetSearchBackendsForTest();
    if (previousKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = previousKey;
  }
});
