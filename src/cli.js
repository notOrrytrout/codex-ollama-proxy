#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const CODEX_DIR = process.env.CODEX_HOME || path.join(process.env.HOME, '.codex');
const RUNTIME_DIR = path.join(CODEX_DIR, 'ollama-shape-proxy');
const ROUTE_CONFIG = path.join(RUNTIME_DIR, 'proxy-models.toml');
const DEFAULT_ROUTE_CONFIG = path.join(PACKAGE_DIR, 'config', 'proxy-models.default.toml');
const DEFAULT_MODEL_CATALOG = path.join(PACKAGE_DIR, 'config', 'model-catalogs', 'ollama-launch-models.default.json');
const MODEL_CATALOG = path.join(CODEX_DIR, 'ollama-launch-models-ollama-working.json');
const MODEL_CATALOG_COPY = path.join(CODEX_DIR, 'ollama-launch-models.json');
const PLIST = path.join(process.env.HOME, 'Library', 'LaunchAgents', 'com.user.codex-ollama-shape-proxy.plist');
const LABEL = 'com.user.codex-ollama-shape-proxy';
const PROXY_PORT = process.env.PROXY_PORT || '11436';

function usage() {
  console.log(`Usage:
  codex-ollama-proxy init [--force]
  codex-ollama-proxy serve
  codex-ollama-proxy status
  codex-ollama-proxy switch openai
  codex-ollama-proxy switch ollama [--model MODEL]
  codex-ollama-proxy route --text-model MODEL --image-model MODEL [--auto-image|--no-auto-image]
  codex-ollama-proxy logs [--tail N]
  codex-ollama-proxy install
  codex-ollama-proxy uninstall
  codex-ollama-proxy restart`);
}

function die(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: options.stdio || 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && options.check !== false) process.exit(result.status ?? 1);
  return result;
}

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = (eq >= 0 ? arg.slice(2, eq) : arg.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (eq >= 0) flags[key] = arg.slice(eq + 1);
    else if (['force', 'auto-image', 'no-auto-image'].includes(arg.slice(2))) flags[key] = true;
    else flags[key] = argv[++i];
  }
  return { flags, rest };
}

function init(options = {}) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  if (!fs.existsSync(ROUTE_CONFIG) || options.force) {
    fs.copyFileSync(DEFAULT_ROUTE_CONFIG, ROUTE_CONFIG);
    console.log(`created=${ROUTE_CONFIG}`);
  } else {
    console.log(`exists=${ROUTE_CONFIG}`);
  }
  if (!fs.existsSync(MODEL_CATALOG) || options.force) {
    fs.copyFileSync(DEFAULT_MODEL_CATALOG, MODEL_CATALOG);
    fs.copyFileSync(DEFAULT_MODEL_CATALOG, MODEL_CATALOG_COPY);
    console.log(`catalog_created=${MODEL_CATALOG}`);
    console.log(`catalog_copy=${MODEL_CATALOG_COPY}`);
  } else {
    console.log(`catalog_exists=${MODEL_CATALOG}`);
  }
}

function readRouteConfig() {
  if (!fs.existsSync(ROUTE_CONFIG)) init();
  return fs.readFileSync(ROUTE_CONFIG, 'utf8');
}

function writeRouteValue(text, key, value) {
  const rendered = typeof value === 'boolean' ? String(value) : `"${value}"`;
  const pattern = new RegExp(`^(\\s*${key}\\s*=\\s*)(?:\"[^\"]*\"|true|false).*`, 'm');
  if (pattern.test(text)) return text.replace(pattern, `$1${rendered}`);
  return `${text.replace(/\s+$/u, '')}\n${key} = ${rendered}\n`;
}

function route(flags) {
  let text = readRouteConfig();
  if (flags.textModel) text = writeRouteValue(text, 'text_model', flags.textModel);
  if (flags.imageModel) text = writeRouteValue(text, 'image_model', flags.imageModel);
  if (flags.autoImage) text = writeRouteValue(text, 'auto_route_image', true);
  if (flags.noAutoImage) text = writeRouteValue(text, 'auto_route_image', false);
  fs.writeFileSync(ROUTE_CONFIG, text, 'utf8');
  console.log(`updated=${ROUTE_CONFIG}`);
}

function codexConfig(args) {
  run(process.execPath, [path.join(PACKAGE_DIR, 'model_config.js'), ...args]);
}

function switchMode(mode, flags) {
  if (mode === 'openai') {
    codexConfig(['openai']);
    return;
  }
  if (mode !== 'ollama') die('switch mode must be "openai" or "ollama"');
  init();
  const args = ['ollama'];
  if (flags.model) args.push('--model', flags.model);
  codexConfig(args);
  console.log('Restart Codex or open a fresh thread so provider discovery reloads.');
}

function status() {
  codexConfig(['status']);
  console.log('');
  console.log(readRouteConfig().trim());
  const req = http.get(`http://127.0.0.1:${PROXY_PORT}/v1/models`, { timeout: 2000 }, (res) => {
    res.resume();
    console.log(`\nproxy=http://127.0.0.1:${PROXY_PORT} status=${res.statusCode}`);
  });
  req.on('timeout', () => {
    req.destroy();
    console.log(`\nproxy=http://127.0.0.1:${PROXY_PORT} status=timeout`);
  });
  req.on('error', (e) => console.log(`\nproxy=http://127.0.0.1:${PROXY_PORT} status=unreachable (${e.message})`));
}

function renderPlist() {
  const template = fs.readFileSync(path.join(PACKAGE_DIR, 'config', 'launchd.plist.template'), 'utf8');
  return template
    .replaceAll('__NODE__', process.execPath)
    .replaceAll('__BIN__', path.join(PACKAGE_DIR, 'bin', 'codex-ollama-proxy'))
    .replaceAll('__LOG__', path.join(RUNTIME_DIR, 'proxy.log'))
    .replaceAll('__PORT__', PROXY_PORT);
}

function install() {
  init();
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, renderPlist(), 'utf8');
  run('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { check: false });
  run('launchctl', ['bootstrap', `gui/${process.getuid()}`, PLIST]);
  run('launchctl', ['enable', `gui/${process.getuid()}/${LABEL}`], { check: false });
  run('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${LABEL}`], { check: false });
}

function uninstall() {
  run('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { check: false });
  if (fs.existsSync(PLIST)) fs.unlinkSync(PLIST);
  console.log(`removed=${PLIST}`);
}

function logs(flags) {
  const n = String(flags.tail || 100);
  run('tail', ['-n', n, path.join(RUNTIME_DIR, 'proxy.log')]);
}

function main() {
  const [command, subcommand, ...tail] = process.argv.slice(2);
  const parsed = parseFlags(command === 'switch' ? tail : process.argv.slice(3));
  if (!command || command === '-h' || command === '--help') return usage();
  if (command === 'init') return init(parseFlags(process.argv.slice(3)).flags);
  if (command === 'serve') return require('./proxy');
  if (command === 'status') return status();
  if (command === 'switch') return switchMode(subcommand, parsed.flags);
  if (command === 'route') return route(parseFlags(process.argv.slice(2)).flags);
  if (command === 'logs') return logs(parsed.flags);
  if (command === 'install') return install();
  if (command === 'uninstall') return uninstall();
  if (command === 'restart') {
    uninstall();
    return install();
  }
  usage();
  process.exit(1);
}

main();
