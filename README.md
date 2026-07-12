# codex-ollama-proxy

Unofficial experimental local compatibility proxy for testing Ollama-compatible Responses API shapes with local Codex config.

This will Let you use ollama model with the codex app and use the codex plugins in codex app environment.

## Install

Install the latest release from npm:

```bash
npm install -g codex-ollama-proxy
codex-ollama-proxy init
codex-ollama-proxy install
```

The proxy listens on `127.0.0.1:11436` and forwards to Ollama on `127.0.0.1:11434`.

To pin a specific release, install from the npm tarball:

```bash
npm install -g https://registry.npmjs.org/codex-ollama-proxy/-/codex-ollama-proxy-0.2.0.tgz
```

## Configure

Separate text and image models:

```bash
codex-ollama-proxy route --text-model "TEXT_MODEL" --image-model "IMAGE_MODEL" --auto-image
codex-ollama-proxy switch ollama --model "TEXT_MODEL"
```

One model for both:

```bash
codex-ollama-proxy route --text-model "MODEL" --image-model "MODEL" --auto-image
codex-ollama-proxy switch ollama --model "MODEL"
```

After switching, restart Codex or open a fresh thread.

## Codex Skill

Copy this skill link into Codex:

```text
https://raw.githubusercontent.com/bharat2808/codex-ollama-proxy/main/skills/codex-ollama-proxy/SKILL.md
```

Then ask:

```text
Install this skill and use it to set up codex-ollama-proxy.
```

## Useful Commands

```bash
codex-ollama-proxy status
codex-ollama-proxy logs --tail 100
codex-ollama-proxy restart
codex-ollama-proxy switch openai
```

## Uninstall

```bash
codex-ollama-proxy switch openai
codex-ollama-proxy uninstall
npm uninstall -g codex-ollama-proxy
```

## Files

Runtime config and logs:

```text
~/.codex/ollama-shape-proxy/proxy-models.toml
~/.codex/ollama-shape-proxy/proxy.log
```

Debug flags are off by default:

```toml
verbose_tools = false
log_upstream_body = false
```
