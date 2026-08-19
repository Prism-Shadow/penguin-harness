# Backward compatibility: legacy baked templates, section placeholders, kernel version

- **Date:** 2026-08-11
- **Type:** process
- **Scope:** `core`, `web`
- **PR:** [#257](https://github.com/Prism-Shadow/penguin-harness/pull/257), [#263](https://github.com/Prism-Shadow/penguin-harness/pull/263)

[中文版](2026-08-11-backward-compatibility.zh.md)

## Prompt-injection section placeholders ([#257](https://github.com/Prism-Shadow/penguin-harness/pull/257)) `system_config.yaml` is baked at agent creation and never auto-upgraded, so every agent created before this change carries the old template text — hardcoded `# Vault` and `# Skills` sections with inline `{{VAULT_KEYS}}` / `{{SKILL_METADATA}}` placeholders, and no schedules section.

**What old shape is tolerated.** Template-level substitution of the inline `{{VAULT_KEYS}}` and `{{SKILL_METADATA}}` placeholders continues to work, now honoring the new toggles: `vault.enabled: false` / `skills.enabled: false` blanks the inline list. On such templates the toggle cannot remove the baked section wording around the list — that text is literal template content; the tab explains this on legacy templates.

**How far it reaches.** Every agent created before [#257](https://github.com/Prism-Shadow/penguin-harness/pull/257). New agents get the placeholder-only template and are unaffected.

**Does the user need to act?** No — existing agents keep rendering the prompt they always had. To adopt the new per-feature prompts and full toggle behavior, each tab offers a one-click migration that replaces the legacy default section with the placeholder, available when the baked wording is byte-identical to the old default (the frozen `LEGACY_VAULT_SECTION` / `LEGACY_SKILLS_SECTION` constants; a test pins that a migrated legacy default template equals the current default). A hand-edited section is never rewritten — the alert strip directs those templates to the System Prompt tab instead. Schedules has no legacy shape; its placeholder is a plain one-click insert, as Memory's was.

**When it can be removed.** The legacy inline-substitution path and the frozen section constants carry retirement comments (the `withShellLineFallback` convention): remove once pre-`{{SKILLS}}`-era agent configs are no longer expected in the wild — realistically after a migration nudge has shipped in a release or two and telemetry/user reports show no legacy templates remaining.

## Kernel version ([#263](https://github.com/Prism-Shadow/penguin-harness/pull/263))

`system_config.yaml` predating the change carries no `kernel_version` stamp and is therefore reported **outdated** — that is the feature working, not breakage; nothing changes until the user clicks Update (or Restore). The smart merge recognizes the current and the pre-[#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) generations by hash; a value matching neither — older generations, or user edits — is conservatively kept, so an update can never destroy a customization it cannot prove is stock. No user action is required.

**When it can be removed.** The seeded pre-[#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) history entry shares [#257](https://github.com/Prism-Shadow/penguin-harness/pull/257)'s retirement horizon (drop both together once legacy configs are gone); the guard test and history table themselves are permanent machinery, growing one row per deliberate defaults change.
