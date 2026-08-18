# Unreleased

- [2026-08-18] Models page group actions collapse to icon-only buttons instead of disappearing when the layout gets narrow. ([details](2026-08-18-models-header-icon-actions.md))
- [2026-08-14] Match the macOS app icon's visual size to neighbouring apps. ([details](2026-08-14-macos-app-icon-size.md))
- [2026-08-14] Unknown model IDs can be moved to Custom with the OpenAI-compatible client. ([details](2026-08-14-model-group-protocol.md))
- [2026-08-11] CLI: `penguin config model remove --model-id <id> --provider <group>` deletes a model entry and the credential inlined on it, matched on the exact pair so a same-id entry under another group is left alone; the `default_model` / `vision_model` settings are cleared when they named the removed entry, matching what the Web App's models page already does on delete. ([details](2026-08-11-cli-model-remove.md))
