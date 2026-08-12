# Skills, Vault and Schedules adopt Memory's prompt-injection pattern

The three remaining prompt-borne subsystems now follow the shape Memory established (#257): the system-prompt template carries only a section placeholder, the section's wording is per-agent editable config, and an on/off switch decides whether the section is injected at all.

## Template and config

The default template's hardcoded `# Vault` and `# Skills` sections are replaced by `{{VAULT}}` and `{{SKILLS}}` placeholders in the same positions, and a new `{{SCHEDULES}}` placeholder lands after `{{MEMORY}}`. Each expands to its feature's prompt — `vault.prompt`, `skills.prompt`, `schedules.prompt` in `system_config.yaml`, defaulting to the previous built-in wording for Vault and Skills — gated by `vault.enabled` / `skills.enabled` / `schedules.enabled` (default on). The former inline data placeholders keep working inside those prompts: `{{VAULT_KEYS}}` and `{{SKILL_METADATA}}` render the key-name list and the installed-skill lines, and the new `{{SCHEDULE_LIST}}` renders the roster of existing schedule files (with an explicit "no scheduled tasks defined yet" note when empty). All four section placeholders expand in a single pass, so content arriving through one section can never smuggle another section's token into a second expansion.

## The model learns to manage schedules

The new default Schedules prompt teaches the model to CRUD scheduled tasks the same way Memory taught it to keep notes: through the ordinary file tools, no dedicated tool added. It names the directory (`agent_state/schedule/`, one TOML per task), shows the file format, and states the field rules — `prompt` required, `enabled` defaults to false so an active task sets it explicitly, ISO 8601 `start_at`/`end_at`, `period` like `30m`/`12h`/`7d` with a 5-minute floor, `session_id` and `workspace`+`provider`+`model_id` mutually exclusive — plus the hygiene rules (check the roster before creating, edit in place, delete obsolete files) and that the server reconciles the directory within ~30 seconds with no registration step.

## Tabs

The Skills, Vault and Schedules tabs each gain the Memory tab's controls: an enable switch on top (启用技能 / 启用密钥保险柜 / 启用定时任务, the Memory switch's shape — written immediately, not joining the tab's Save), an alert strip when the template lacks the section's placeholder (one-click insert, or one-click migration on a legacy template — see the [compat notes](2026-08-11-backward-compatibility.md)), and an editable prompt section at the bottom with the feature's inner placeholders as click-to-insert chips. Vault and Schedules keep their owner-only editing convention. The schedules table also stops wrapping mid-cell: headers and compact columns are nowrap, name and target truncate with hover titles, and the next/last fire times stack as a deliberate two-line cell over the existing horizontal-scroll container.

The switches govern prompt injection only — stated in the configuration docs rather than as tab copy: Vault values are still injected into shell subprocesses as environment variables when the section is off (the model just loses the key-name listing), the scheduler still fires existing tasks, and installed Skills remain explicitly usable via `[use_skills]`.
