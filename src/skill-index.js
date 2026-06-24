'use strict';

// skill_index.js
//
// Dynamically builds an index of the skills that are currently TURNED ON in
// this Codex installation, then ranks them by a weighted query match.
//
// Sources of skills (only enabled ones are indexed):
//   1. Plugin skills -> only from plugins enabled in ~/.codex/config.toml
//      ([plugins.name@set] enabled = true). The plugin name (from the
//      plugin plugin.json) is stored per skill.
//   2. User skills    -> ~/.codex/skills/<name>/SKILL.md (always on).
//   3. System skills  -> ~/.codex/skills/.system/<name>/SKILL.md (always on).
//
// Each index entry is { skill_name, plugin_name, description, path, scope }.
// Ranking weights (by design): plugin-name direct match is the highest signal,
// then skill-name, then description token overlap.

const fs = require('fs');
const path = require('path');

const CODEX_DIR = path.resolve(__dirname, '../..'); // ~/.codex
const SKILLS_DIR = path.join(CODEX_DIR, 'skills');
const SYSTEM_SKILLS_DIR = path.join(SKILLS_DIR, '.system');
const PLUGINS_CACHE_DIR = path.join(CODEX_DIR, 'plugins', 'cache');
const CONFIG_TOML = path.join(CODEX_DIR, 'config.toml');

const CACHE_TTL_MS = 60000;
let _cache = null; // { entries, builtAt, configMtime }

function readTextSafe(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function statMtimeSafe(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

function listDirs(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return ents.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => path.join(dir, e.name));
}

// Parse the YAML-ish frontmatter of a SKILL.md. We only need name and
// description, so a full YAML parser is overkill. Handles quoted values.
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[kv[1]] = val;
  }
  return out;
}

function readSkill(skillMdPath) {
  const text = readTextSafe(skillMdPath);
  if (!text) return null;
  const fm = parseFrontmatter(text);
  const name = (fm.name || path.basename(path.dirname(skillMdPath))).trim();
  const description = (fm.description || '').trim();
  return { skill_name: name, description, path: skillMdPath };
}

// Parse config.toml just for the [plugins.name@set] blocks with enabled=true.
function parseEnabledPlugins(tomlPath) {
  const raw = readTextSafe(tomlPath);
  if (!raw) return [];
  const enabled = [];
  const lines = raw.split(/\r?\n/);
  let current = null; // { id, seenEnabled }
  for (const line of lines) {
    const hdr = /^\s*\[plugins\.(?:'([^']+)'|"([^"]+)"|([^\]]+))\]/.exec(line);
    if (hdr) {
      if (current && current.seenEnabled) enabled.push(current.id);
      const id = hdr[1] || hdr[2] || hdr[3];
      current = id ? { id: id.trim(), seenEnabled: false } : null;
      continue;
    }
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      if (current && current.seenEnabled) enabled.push(current.id);
      current = null;
      continue;
    }
    if (current && /^\s*enabled\s*=\s*true\b/i.test(line)) {
      current.seenEnabled = true;
    }
  }
  if (current && current.seenEnabled) enabled.push(current.id);
  return enabled;
}

function splitPluginId(id) {
  const at = id.lastIndexOf('@');
  if (at <= 0) return { name: id, set: '' };
  return { name: id.slice(0, at), set: id.slice(at + 1) };
}

function readPluginManifest(pluginRoot) {
  const json = readTextSafe(path.join(pluginRoot, '.codex-plugin', 'plugin.json'));
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

// Loose version comparison (handles 0.1.0, 0.1.0+codex.2026..., 26.616).
function cmpVer(a, b) {
  const pa = String(a).split(/[.+]/);
  const pb = String(b).split(/[.+]/);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const na = parseInt(pa[i], 10);
    const nb = parseInt(pb[i], 10);
    const va = Number.isNaN(na) ? pa[i] : na;
    const vb = Number.isNaN(nb) ? pb[i] : nb;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return String(a).localeCompare(String(b));
}

function pickLatestVersionDir(setDir) {
  let ents = [];
  try { ents = fs.readdirSync(setDir, { withFileTypes: true }); } catch { return null; }
  const dirs = ents.filter((e) => e.isDirectory()).map((e) => e.name);
  if (dirs.length === 0) return null;
  dirs.sort((a, b) => cmpVer(b, a));
  return path.join(setDir, dirs[0]);
}

function indexUserSkills(entries) {
  for (const dir of listDirs(SKILLS_DIR)) {
    const s = readSkill(path.join(dir, 'SKILL.md'));
    if (!s) continue;
    entries.push({
      skill_name: s.skill_name, plugin_name: '', description: s.description,
      path: s.path, scope: 'user',
    });
  }
}

function indexSystemSkills(entries) {
  for (const dir of listDirs(SYSTEM_SKILLS_DIR)) {
    const s = readSkill(path.join(dir, 'SKILL.md'));
    if (!s) continue;
    entries.push({
      skill_name: s.skill_name, plugin_name: '', description: s.description,
      path: s.path, scope: 'system',
    });
  }
}

function indexPluginSkills(entries) {
  const enabled = parseEnabledPlugins(CONFIG_TOML);
  for (const id of enabled) {
    const parts = splitPluginId(id);
    const pluginRoot = pickLatestVersionDir(path.join(PLUGINS_CACHE_DIR, parts.set, parts.name));
    if (!pluginRoot) continue;
    const manifest = readPluginManifest(pluginRoot) || {};
    const pluginName = (manifest.name || parts.name).trim();
    const skillsDir = path.join(pluginRoot, 'skills');
    for (const dir of listDirs(skillsDir)) {
      const s = readSkill(path.join(dir, 'SKILL.md'));
      if (!s) continue;
      entries.push({
        skill_name: s.skill_name, plugin_name: pluginName, description: s.description,
        path: s.path, scope: 'plugin',
      });
    }
  }
}

function buildEntries() {
  const entries = [];
  indexUserSkills(entries);
  indexSystemSkills(entries);
  indexPluginSkills(entries);
  return entries;
}

function getEntries(force) {
  const now = Date.now();
  const cfgMtime = statMtimeSafe(CONFIG_TOML);
  if (!force && _cache && _cache.entries &&
      now - _cache.builtAt < CACHE_TTL_MS &&
      _cache.configMtime === cfgMtime) {
    return _cache.entries;
  }
  const entries = buildEntries();
  _cache = { entries, builtAt: now, configMtime: cfgMtime };
  return entries;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'skill',
  'find', 'me', 'please', 'show', 'get', 'use', 'do',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9._-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function scoreEntry(entry, queryTokens, queryNorm) {
  const pName = String(entry.plugin_name || '').toLowerCase();
  const sName = String(entry.skill_name || '').toLowerCase();
  const desc = String(entry.description || '').toLowerCase();
  const pTokens = new Set(tokenize(entry.plugin_name));
  const sTokens = new Set(tokenize(entry.skill_name));
  const dSet = new Set(tokenize(entry.description));
  let score = 0;

  // plugin name: highest weight
  if (entry.plugin_name && pName === queryNorm) score += 100;
  for (const qt of queryTokens) {
    if (pTokens.has(qt)) score += 40;
    else if (entry.plugin_name && (pName.includes(qt) || qt.includes(pName))) score += 15;
  }

  // skill name: next
  if (sName === queryNorm) score += 80;
  if (sName.startsWith(queryNorm) && queryNorm) score += 25;
  for (const qt of queryTokens) {
    if (sTokens.has(qt)) score += 30;
    else if (sName.includes(qt)) score += 12;
  }

  // description: lowest weight
  if (queryNorm && desc.includes(queryNorm)) score += 20;
  for (const qt of queryTokens) {
    if (dSet.has(qt)) score += 4;
  }

  return score;
}

function searchSkills(query, opts) {
  const limit = Math.max(1, Math.min(50, Number((opts && opts.limit) || 5)));
  const entries = getEntries(opts && opts.force);
  const queryTokens = tokenize(query);
  const queryNorm = String(query || '').toLowerCase().trim();
  const scored = entries
    .map((e) => ({ entry: e, score: scoreEntry(e, queryTokens, queryNorm) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.skill_name.localeCompare(b.entry.skill_name));
  return scored.slice(0, limit);
}

function formatSkillMatches(matches) {
  if (!matches || matches.length === 0) return '[find_skill] No matching skills found.';
  const lines = ['[find_skill] top ' + matches.length + ' skill match(es):'];
  matches.forEach((m, i) => {
    const e = m.entry;
    const who = e.plugin_name ? ('plugin=' + e.plugin_name) : ('scope=' + e.scope);
    const desc = e.description ? (e.description.length > 240 ? e.description.slice(0, 240) + '...' : e.description) : '';
    lines.push(
      (i + 1) + '. ' + e.skill_name + ' (' + who + ', score=' + m.score + ')' +
      '\n   path: ' + e.path + (desc ? '\n   desc: ' + desc : '')
    );
  });
  return lines.join('\n');
}

module.exports = {
  CODEX_DIR,
  getEntries,
  buildEntries,
  searchSkills,
  formatSkillMatches,
  parseEnabledPlugins,
};
