# Project sandbox command policy

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#374](https://github.com/Prism-Shadow/penguin-harness/pull/374)
- **Breaking:** yes — every project starts denying the factory destructive commands (`rm -rf` and friends) under every approval mode; disable the offending rule (or the whole policy) in Project Settings to restore the old behavior

[中文版](2026-08-20-sandbox-command-policy.zh.md)

Added a Project-level sandbox command policy: a deny-rule list evaluated against every `exec_command` launch **before** the approval callback, so a hit is rejected under every approval mode — allow-all included — and the model is told which rule fired. The policy is stored as the `[command_policy]` block of `.project_config.toml` (Project-owned security config, outside anything the Agent's own tools can rewrite) and snapshotted into the Environment at Session creation. The Project settings dialog was rebuilt as a tabbed layout along the way.

## Details

- The rules are plain editable data with no special tiers. The factory set is seeded into each new project like the model presets (copied at creation, never rewritten afterward); a pre-seeding project with no stored list behaves as the factory set until its first saved edit materializes it. Every rule — name, pattern, optional description, per-rule switch — can be edited, disabled, deleted, or added; "Restore defaults" writes the factory set back.
- Factory set (deliberately small, each entry destructive with no undo): `rm` with recursive+force flags in any spelling, `mkfs`, `dd` writing straight to a block device, the classic fork bomb, and shell redirection onto a block device; `/dev/null` targets stay legal.
- Policy denials are recorded as an `approval_decision` with a new optional `policy_rule` field and fed back to the model as a `failed` tool output naming the rule — an additive Trace field; older Traces read unchanged, and older readers ignore it.
- New routes `GET|PUT /api/projects/:p/command-policy` (member read / owner write): the GET serves the effective list plus the factory set for restore; the PUT carries the full list and materializes it, rejecting uncompilable patterns up front.
- Matching is whitespace-normalized regex over the launch command: an accident guardrail, not a security boundary (deliberate obfuscation and `input_command` keystrokes are out of scope; documented in Configuration § Command policy).
- Project settings became a tabbed dialog — General (display name, project id, delete), Members (the permission table; the tab is hidden in the single-user desktop app), Defaults (the new-chat defaults block and default model), Security policy (the rule list above) — with a left tab rail and row-styled settings pages.

## Compatibility

Existing and new projects alike begin rejecting the factory destructive commands, even in allow-all mode — routine flows that relied on `rm -rf` (e.g. deleting `node_modules`) get a denial naming the rule, and the model is steered to safer spellings. To restore a specific behavior, disable or edit that one rule (or switch the whole policy off) in Project Settings → Security policy; no data migration is involved. Projects created before this change carry no `[command_policy]` block and follow the factory set until their first saved edit writes the list into `.project_config.toml`.
