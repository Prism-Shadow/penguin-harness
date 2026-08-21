# Project sandbox command policy

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#374](https://github.com/Prism-Shadow/penguin-harness/pull/374)
- **Breaking:** yes — every project starts denying the factory destructive commands (`rm -rf` and friends) under every approval mode; disable the offending rule (or the whole policy) in Project Settings to restore the old behavior

[中文版](2026-08-20-sandbox-command-policy.zh.md)

Added a Project-level sandbox command policy: a deny-rule list applied to every `exec_command` launch at the approval boundary, so a hit is rejected under every approval mode — allow-all included — and the model is told which rule fired. `Session.run` wraps the injected approval callback with the policy, so the refusal happens before any host is asked and `context_engine` keeps handling nothing but OmniMessage. The rules are stored as the `[command_policy]` block of `.project_config.toml` (Project-owned, so an Agent editing its own configuration cannot reach them) and snapshotted into the Session at creation. The Project settings dialog was rebuilt as a tabbed layout along the way.

## Details

- The rules are plain editable data with no special tiers. The factory set is seeded into each new project like the model presets (copied at creation, never rewritten afterward); a pre-seeding project with no stored list behaves as the factory set until its first saved edit materializes it. Every rule — name, pattern, optional description, per-rule switch — can be edited, disabled, deleted, or added; "Restore defaults" loads the factory set back into the editor and Save writes it.
- Factory set (deliberately small, each entry destructive with no undo): `rm` carrying both a recursive and a force flag, `mkfs`, `dd` writing straight to a block device, the classic fork bomb, and shell redirection onto a block device; a leading path (`/bin/rm`) and `sudo` match too, and `/dev/null` targets stay legal.
- `ApproveFn` may now answer a denial with an `ApprovalRefusal` — decision plus the message and stop reason to report — instead of the bare `"deny"`. A policy refusal rides back as a `failed` tool output naming the rule, distinct from the `aborted` output a person's cancellation still produces; an existing callback returning `"allow"` / `"deny"` behaves exactly as before.
- New routes `GET|PUT /api/projects/:p/command-policy` (member read / owner write): the GET serves the effective list plus the factory set for restore; the PUT carries the full list and materializes it, rejecting uncompilable patterns up front.
- Matching is whitespace-normalized regex over one tool's launch command: an accident guardrail, not a security boundary. A nested interpreter (`sh -c`, `eval`, a pipe into `bash`), shell-level indirection (quoting the command word, `$IFS`, a variable), `input_command` keystrokes into an already-running shell, an MCP server's own shell, and every command not on the list all walk past it. Documented in Configuration § Command policy.
- Project settings became a tabbed dialog — General (display name, project id, delete), Members (the permission table; the tab is hidden in the single-user desktop app), Defaults (the new-chat defaults block and default model), Security policy (the rule list above) — with a left tab rail and row-styled settings pages.

## Compatibility

Existing and new projects alike begin rejecting the factory destructive commands, even in allow-all mode — routine flows that relied on `rm -rf` (e.g. deleting `node_modules`) get a denial naming the rule. To restore a specific behavior, disable or edit that one rule (or switch the whole policy off) in Project Settings → Security policy; no data migration is involved. Projects created before this change carry no `[command_policy]` block and follow the factory set until their first saved edit writes the list into `.project_config.toml`.
