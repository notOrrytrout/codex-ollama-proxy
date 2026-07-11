'use strict';

// proxy_ui_markers.js
//
// Synthetic UI marker for the proxy-fulfilled `web_search` tool.
//
// The shape proxy self-fulfills `web_search` locally (DDG / Ollama local)
// instead of handing it to the Codex app for execution. Because the app never
// sees a *pending* call for it, the UI would go silent while the proxy works.
// This module fabricates a completed `web_search_call` (the native
// server-completed shape) plus the SSE plumbing to emit it live and fold it
// into the terminal response.completed event, so the app renders a "Searched
// for …" chip without re-executing.
//
// `find_skill` is also self-fulfilled by the proxy but emits NO marker: the
// Codex app has no skill-search chip (no ThreadItem::ToolSearch), reasoning is
// suppressed under model_reasoning_effort="none", and agent_message output
// items are dropped by the app-server, so there is no renderable shape for it.
// The proxy still fulfills find_skill and feeds the results back to the model;
// it just stays invisible, same as the native tool_search.
//
// Interception detection, response translation (namespace/custom splitting),
// and loop orchestration live in proxy.js; this module is only concerned with
// marker shaping + emission.

const WEB_SEARCH = 'web_search';

function parseArgs(v) {
  if (v == null) return {};
  if (typeof v !== 'string') return v && typeof v === 'object' ? v : {};
  const s = v.trim();
  if (s === '') return {};
  try { return JSON.parse(s); } catch { return {}; }
}


// Write one SSE event frame to the client response stream.
function writeSseEvent(clientRes, event, obj) {
  const data = JSON.stringify(obj);
  const prefix = event ? 'event: ' + event + '\n' : '';
  clientRes.write(prefix + 'data: ' + data + '\n\n');
}

// Emit one output item to the client as added+done, mirroring the frame shape
// sendSseCompleted produces. `seq` carries the shared output_index + sequence
// counters across all marker emissions in a turn.
function emitOutputItem(clientRes, item, seq) {
  const idx = seq.index++;
  writeSseEvent(clientRes, 'response.output_item.added', {
    type: 'response.output_item.added', output_index: idx, sequence_number: seq.num++, item,
  });
  writeSseEvent(clientRes, 'response.output_item.done', {
    type: 'response.output_item.done', output_index: idx, sequence_number: seq.num++, item,
  });
}

// Build the { callItem, outputItem } marker pair for a fulfilled call.
// `web_search` -> web_search_call + web_search_output (matching the shape
// proxy.js emits for a passthrough web_search call). `find_skill` -> tool_search_call
// + tool_search_output, since find_skill is a proxy alias of the native tool_search.
// Build the native web_search_call `action` object from the proxy function-tool
// args. Response-item action types are snake_case (search / open_page /
// find_in_page); the app-server converts them to the camelCase thread-item action.
function buildWebSearchAction(args) {
  const action = String((args && args.action) || 'search').trim();
  if (action === 'open_page' || action === 'open') {
    return { type: 'open_page', url: String((args && args.url) || '') };
  }
  if (action === 'find_in_page') {
    const a = { type: 'find_in_page', pattern: String((args && args.pattern) || '') };
    if (args && args.url) a.url = String(args.url);
    return a;
  }
  return { type: 'search', query: String((args && (args.query || args.q)) || '') };
}

function makeWebSearchMarker(call, outputStr) {
  // Native server-completed shape: the app renders the chip from `action` alone.
  // Results live inside the call (encrypted, which we can't produce), so no
  // separate output item is emitted; the model already received the results via
  // the proxy's internal function_call_output fed back into the next turn.
  const args = parseArgs(call.arguments);
  const item = {
    type: 'web_search_call',
    status: call.status || 'completed',
    action: buildWebSearchAction(args),
  };
  if (call.id) item.id = call.id;
  return item;
}

function makeImageGenerationMarker(call, outputStr) {
  // Build the native image_generation_call item (matching the shape
  // ResponseItem::ImageGenerationCall in the Codex Rust server).
  // Fields: id, status, revised_prompt, result, saved_path.
  // The app renders an "Image generated" chip from saved_path + revised_prompt.
  let parsed = {};
  try { parsed = JSON.parse(outputStr); } catch {}

  const item = {
    type: 'image_generation_call',
    status: 'completed',
  };
  if (call.id) item.id = call.id;
  if (parsed.enhancedPrompt) item.revised_prompt = parsed.enhancedPrompt;
  else if (parsed.originalPrompt) item.revised_prompt = parsed.originalPrompt;
  if (parsed.path) item.saved_path = parsed.path;
  // result.b64_json: we don't inline the image bytes (they're saved to disk);
  // the app uses saved_path to display the image.
  if (parsed.mimeType || parsed.bytes) {
    item.result = {};
    if (parsed.mimeType) item.result.mimeType = parsed.mimeType;
    if (parsed.bytes) item.result.bytes = parsed.bytes;
  }
  return item;
}

function makeProxyStatusMarker(call, outputStr) {
  // ollama_proxy_status is fulfilled silently — no renderable chip in the Codex app.
  // The result is fed back to the model as function_call_output but no marker
  // is emitted to the UI (same as find_skill).
  return null;
}

function makeMarker(call, outputStr) {
  // web_search -> web_search_call chip
  // generate_image -> image_generation_call chip
  // ollama_proxy_status -> no chip (fulfilled silently, same as find_skill)
  if (call.name === WEB_SEARCH) return makeWebSearchMarker(call, outputStr);
  if (call.name === 'generate_image') return makeImageGenerationMarker(call, outputStr);
  if (call.name === 'ollama_proxy_status') return makeProxyStatusMarker(call, outputStr);
  return null;
}

// Prepend already-emitted marker items into a buffered response.completed event
// so the terminal event's response.output reflects everything the app saw
// stream (markers first, then the real turn output).
function injectMarkersIntoCompleted(completedEvent, markerItems) {
  if (!completedEvent || !completedEvent.response || !markerItems || !markerItems.length) return;
  const out = Array.isArray(completedEvent.response.output) ? completedEvent.response.output : [];
  completedEvent.response.output = [...markerItems, ...out];
}

module.exports = {
  writeSseEvent,
  emitOutputItem,
  makeMarker,
  makeWebSearchMarker,
  makeImageGenerationMarker,
  makeProxyStatusMarker,
  injectMarkersIntoCompleted,
};
