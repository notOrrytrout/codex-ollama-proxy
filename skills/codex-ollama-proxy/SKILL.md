---
name: codex-ollama-proxy
description: Install, configure, run, test, debug, and uninstall the unofficial codex-ollama-proxy local compatibility tool for experimenting with Ollama-compatible Responses API shapes through local Codex config. Use when the user asks to install the proxy from npm or a repo link, configure text/image model routing, use one model for both text and image, enable or restore the local Ollama/proxy workflow, inspect proxy status/logs, restart the launchd service, or remove the proxy.
---

# Codex Ollama Proxy

Use this skill to install and manage `codex-ollama-proxy`.

This is an unofficial, experimental local compatibility tool. It depends on local Codex configuration behavior that may change.

## Install

Prefer npm for the actual software install:

```bash
npm install -g codex-ollama-proxy
codex-ollama-proxy init
codex-ollama-proxy install
codex-ollama-proxy status
```

If working from a local checkout instead:

```bash
npm link
codex-ollama-proxy init
codex-ollama-proxy install
codex-ollama-proxy status
```

## Configure Models

For separate text and image models:

```bash
codex-ollama-proxy route --text-model "TEXT_MODEL" --image-model "IMAGE_MODEL" --auto-image
codex-ollama-proxy switch ollama --model "TEXT_MODEL"
```

For one model used for both text and image:

```bash
codex-ollama-proxy route --text-model "MODEL" --image-model "MODEL" --auto-image
codex-ollama-proxy switch ollama --model "MODEL"
```

If the user does not want image request rewriting:

```bash
codex-ollama-proxy route --text-model "MODEL" --image-model "MODEL" --no-auto-image
codex-ollama-proxy switch ollama --model "MODEL"
```

After changing modes, tell the user to restart Codex or open a fresh thread so local provider and tool discovery reload.

## Status And Validation

Run:

```bash
codex-ollama-proxy status
codex-ollama-proxy logs --tail 100
```

If working from the source checkout, also run:

```bash
npm run check
npm run smoke
```

## Switch Back

Use:

```bash
codex-ollama-proxy switch openai
```

Tell the user to restart Codex or open a fresh thread afterward.

## Uninstall

Use:

```bash
codex-ollama-proxy switch openai
codex-ollama-proxy uninstall
npm uninstall -g codex-ollama-proxy
```

If installed with `npm link`, replace the final command with:

```bash
npm unlink -g codex-ollama-proxy
```

Only remove `~/.codex/ollama-shape-proxy` if the user explicitly wants to delete runtime config and logs.

## Notes

- `install`, `uninstall`, and `restart` manage a macOS launchd service.
- The proxy listens on `127.0.0.1:11436` and forwards to Ollama on `127.0.0.1:11434`.
- Runtime config lives at `~/.codex/ollama-shape-proxy/proxy-models.toml`.
- Sensitive debug flags are off by default: `verbose_tools = false` and `log_upstream_body = false`.
