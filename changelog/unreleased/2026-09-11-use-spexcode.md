# Add the SpexCode atlas plugin

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `skills`, `core`, `docs`

[中文版](2026-09-11-use-spexcode.zh.md)

The plugin library now includes `use-spexcode`, which brings SpexCode's atlas workflow to PenguinHarness without a local SpexCode installation.

## Details

- The plugin ships the `atlas` Skill, its icon, bilingual metadata, and the dated plugin version `2026.09.10.1`.
- The loader resolves it in the core, CLI, and desktop dependency surfaces, while the library tables and Skills documentation list it under Software Development.
- The plugin is opt-in (`preinstall: false`) because its workflow downloads SpexCode through `npx` when an Agent uses it.
