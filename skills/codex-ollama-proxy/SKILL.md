---
name: codex-ollama-proxy
description: Install and manage the unofficial codex-ollama-proxy local compatibility tool. Use when the user wants Codex to install it from npm, clone/download the repo, configure model routing, start/restart/inspect the proxy, switch the local experimental Ollama/proxy workflow on or off, or uninstall it.
---

# Codex Ollama Proxy

This is an unofficial, experimental local compatibility tool. It is not affiliated with, endorsed by, or supported by OpenAI, and it depends on local Codex configuration behavior that may change.

Use the project README as the source of truth:

```text
https://github.com/bharat2808/codex-ollama-proxy
```

## Minimal Install

Prefer the GitHub release tarball:

```bash
npm install -g https://github.com/bharat2808/codex-ollama-proxy/releases/download/v0.1.0/codex-ollama-proxy-0.1.0.tgz
codex-ollama-proxy init
codex-ollama-proxy install
codex-ollama-proxy status
```

Or from a cloned repo:

```bash
git clone https://github.com/bharat2808/codex-ollama-proxy.git
cd codex-ollama-proxy
npm link
codex-ollama-proxy init
codex-ollama-proxy install
codex-ollama-proxy status
```

## Minimal Model Setup

Separate text/image models:

```bash
codex-ollama-proxy route --text-model "TEXT_MODEL" --image-model "IMAGE_MODEL" --auto-image
codex-ollama-proxy switch ollama --model "TEXT_MODEL"
```

Single model:

```bash
codex-ollama-proxy route --text-model "MODEL" --image-model "MODEL" --auto-image
codex-ollama-proxy switch ollama --model "MODEL"
```

After switching, tell the user to restart Codex or open a fresh thread.

## Image Generation (imagine)

The proxy can inject a synthetic `generate_image` function tool that lets the model generate or edit images via cloud APIs (Gemini or OpenAI). No separate MCP server needed — the proxy fulfills image generation calls locally, same as web_search and find_skill.

### Enable

updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
removed=/Users/home/Library/LaunchAgents/com.user.codex-ollama-shape-proxy.plist
exists=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
catalog_exists=/Users/home/.codex/ollama-launch-models-ollama-working.json

### Configuration

updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
Image generation configuration:
  imagine_enabled = true
  imagine_service = "openai"
  imagine_api_key = (set)
  imagine_quality = "quality"
  imagine_enhance = false
  imagine_aspect_ratio = "16:9"

### Runtime Tools

When image generation is enabled, the proxy injects two synthetic function tools:

- **generate_image** — Generate a new image from a text prompt, or edit an existing image (image-to-image). Parameters: prompt, inputImagePath (optional), aspectRatio, quality.
- **proxy_status** — Check the current image generation configuration at runtime. Returns active provider, quality, enhancement status, and API key status.

The model can call `proxy_status` to check the configuration before generating images. The model can also run `codex-ollama-proxy imagine --status` or `--doctor` via shell commands.

### Config Fields (proxy-models.toml)



### Disable

updated=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
removed=/Users/home/Library/LaunchAgents/com.user.codex-ollama-shape-proxy.plist
exists=/Users/home/.codex/ollama-shape-proxy/proxy-models.toml
catalog_exists=/Users/home/.codex/ollama-launch-models-ollama-working.json

## Uninstall

```bash
codex-ollama-proxy switch openai
codex-ollama-proxy uninstall
npm uninstall -g codex-ollama-proxy
```
