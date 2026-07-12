# Codex Image Generation Binary Patch Design

## Goal

Produce a reversible patched copy of the installed ARM64 Codex app-server binary that allows the standalone `image_gen.imagegen` extension to be exposed to code mode for the configured Ollama provider, without modifying `/Applications/ChatGPT.app`.

## Scope

- Read and disassemble `/Applications/ChatGPT.app/Contents/Resources/codex`.
- Preserve the installed executable byte-for-byte.
- Create all artifacts under `/Users/home/.codex/ollama-shape-proxy/output/binary-patch/`.
- Patch only the provider-authorization decision used by the image-generation runtime gate.
- Preserve the feature, namespace, model-image-modality, extension-registration, and selected-capability-root gates.
- Do not install, replace, or re-sign the ChatGPT application in this phase.

## Approach

Use differential analysis rather than guessing at branch opcodes. Build two matching ARM64 Codex binaries from the inspected Rust revision: one with the original `image_generation_runtime_enabled` authorization expression and one with only that expression changed to accept the configured Ollama provider. Compare their disassembly to identify a minimal instruction-level signature, then locate and validate the corresponding instruction sequence in the installed `codex-cli 0.144.0-alpha.4` binary.

If compiler or revision differences prevent an unambiguous match, stop without producing a runnable patch. Do not fall back to scanning for arbitrary conditional branches.

## Artifacts

- `codex.original.sha256`: hash of the installed binary.
- `codex.patched`: patched copy; never used as an in-place replacement.
- `codex.patched.sha256`: hash of the patched copy.
- `patch-manifest.json`: source and destination paths, architecture, file offsets, original bytes, replacement bytes, expected instruction decoding, source revision, and hashes.
- `before.asm` and `after.asm`: focused disassembly surrounding the patched instructions.
- `verify-patch.sh`: read-only verifier for hashes, byte expectations, Mach-O structure, and decoded instructions.

## Safety Invariants

- Abort unless the source binary SHA-256 matches the manifest.
- Abort unless the target architecture is ARM64.
- Abort unless exactly one candidate instruction sequence matches.
- Abort unless the original bytes at the target offset match the manifest.
- Keep file length and Mach-O layout unchanged.
- Never write to `/Applications/ChatGPT.app`.
- Do not weaken unrelated authentication or authorization checks.

## Validation

1. Compare Mach-O headers, load commands, segment sizes, and file size between original and patched copies.
2. Disassemble the patched region and confirm only the intended control-flow decision changed.
3. Verify all non-target bytes are identical.
4. Launch the patched executable in an isolated temporary `CODEX_HOME` with `--version` and app-server initialization smoke checks.
5. Run a controlled Responses request and confirm the executor tool surface contains `image_gen__imagegen` when `image_gen.generation` is selected.
6. Confirm the installed application and executable hashes remain unchanged.

## Failure Handling

Any ambiguous symbol match, multiple byte-pattern matches, build mismatch, signing-related launch failure, or unexpected tool exposure ends the experiment with a diagnostic report and no installation action.
