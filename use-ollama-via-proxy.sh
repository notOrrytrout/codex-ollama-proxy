#!/usr/bin/env bash
set -euo pipefail

exec "$(dirname "$0")/scripts/use-ollama-via-proxy.sh" "$@"
