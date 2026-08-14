# Unreleased

- [2026-08-14] Match the macOS app icon's visual size to neighbouring apps. ([details](2026-08-14-macos-app-icon-size.md))
- [2026-08-14] Unknown model IDs can be moved to Custom with the OpenAI-compatible client. ([details](2026-08-14-model-group-protocol.md))
- [2026-08-11] CLI: `penguin config model remove --model-id <id> --provider <group>` deletes a model entry and the credential inlined on it, matched on the exact pair so a same-id entry under another group is left alone; the `default_model` / `vision_model` settings are cleared when they named the removed entry, matching what the Web App's models page already does on delete. ([details](2026-08-11-cli-model-remove.md))
- [2026-08-11] Server: the Trace index's mtime gate now stats every known date directory instead of only the newest, so a compaction-rotated shard (`rotate()` writes to the session's original date dir, not necessarily the newest) is registered instead of silently missing — `GET /messages` returns the full post-compaction conversation instead of stopping at `compaction_end`. ([details](2026-08-11-trace-index-compaction-rotate.md))
