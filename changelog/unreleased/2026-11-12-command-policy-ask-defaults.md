# Every factory command-policy rule asks for a go-ahead

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `core`, `docs`, `skills`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)
- **Breaking:** yes — a command a factory rule matches now waits for a person instead of being refused

[中文版](2026-11-12-command-policy-ask-defaults.zh.md)

Switched the nine factory command-policy rules that refused a command (`rm-recursive-force`, `mkfs`, `dd-to-block-device`, `fork-bomb`, `overwrite-block-device` and the four Windows counterparts) from `deny` to `ask`, so every factory rule now puts a matching command to a person, whatever the approval mode. A Project can still switch any rule to Deny on its Security policy page.

## Details

- New Projects are seeded with the all-`ask` set, **Restore defaults** loads it, and a Project whose `.project_config.toml` has no `[command_policy]` rules list reads as it.
- Existing Projects that store their rule list keep it untouched, `deny` rules included, until someone clicks **Restore defaults** and saves.
- `deny-all` still denies an `ask` hit, and an organization's unattended Sessions deny it at once.
- Updated the configuration, Web App and server API docs, and the Harbor guidance in the `agent-evaluation` skill.

## Compatibility

- An SDK host whose approval callback ignores `context.reason` (a one-argument callback that answers by mode alone) now decides a factory-rule hit like any other call, so an allow-all callback lets `rm -rf` through. To keep a refusal, pass a `commandPolicy` with `deny` rules, or put calls that carry a policy reason to a person.
