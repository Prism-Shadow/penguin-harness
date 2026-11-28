# The command policy is off unless a Project switches it on

- **Date:** 2026-11-28
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1942](https://github.com/Prism-Shadow/penguin-harness/pull/1942)
- **Breaking:** yes — a Project whose config does not say `enabled = true` under `[command_policy]` runs with the command policy off

[中文版](2026-11-28-command-policy-default-off.zh.md)

The Project's sandbox command policy, the **Enable policy** switch on the **Security policy** tab of Project settings, became off by default. Only `enabled = true` in the `[command_policy]` block turns it on; a block without the key, or no block at all, reads as off. New Projects are still seeded with the factory rules, with the policy off.

## Details

- Core matched no rule unless the policy said `enabled: true`. A Session handed no policy, as an SDK embedder that passes none gets, applied no rule. A policy source that throws still fell back to the factory rules, switched on.
- `GET …/command-policy` served `enabled: false` for a block without the key. `PUT …/command-policy` wrote the switch on every save, as `enabled = true` or `enabled = false`, so a policy switched on stays on with the rules untouched; a PUT without `enabled` stored it off.
- Config sync handed a block without the key to the Project's machines as `enabled: false`, and the machine stored it as such.
- The switch's description on the settings page said the policy is off by default, what off means, and what turning it on does.
- The configuration, tools, Web App, server API and interfaces docs stated the new default.

## Compatibility

Earlier releases stored a policy that was left on with no `enabled` key, so an existing Project runs with the command policy off after the upgrade unless its owner had switched it off (it stays off) or its file says `enabled = true`. The stored rules are kept.

With the policy off, no rule asks or refuses, under any approval mode:

- Under `allow-all`, the factory rules' commands run without waiting for a person: `rm` with recursive and force flags, `mkfs`, `dd` or a redirection onto a block device, fork bombs, their Windows counterparts, `gh pr merge` and `close`, `gh release create`, `delete` and `edit`, `git push` with a force flag or to `main` or `master`, and `npm`, `pnpm` or `yarn publish`. An organization's unattended Sessions under `allow-all`, which denied those calls at once, run them.
- A rule the Project switched to `deny` no longer refuses: under `allow-all` the command runs, under `read-only` and `always-ask` it is put to a person like any other shell command.
- `deny-all` is unchanged.

To restore the policy, the Project owner turns on **Enable policy** on the **Security policy** tab of Project settings, which writes `enabled = true` and syncs to the Project's machines. Over the API, it is `PUT /api/projects/<projectId>/command-policy` with `enabled: true` and the rules `GET` serves.
