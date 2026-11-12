# The Plugins page's card, status mark and detail rows move into the shared UI package

- **Date:** 2026-11-12
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1545](https://github.com/Prism-Shadow/penguin-harness/pull/1545)

[中文版](2026-11-12-ui-entity-card-and-sub-page-bar.zh.md)

The pieces the Plugins page drew by hand became modules of `@prismshadow/penguin-ui`, and the page was rebuilt on them, so an Agent's settings can show plugins with the same parts. The page reads as it did.

## Details

- New UI-package modules, props only, each with a gallery group and a behaviour test: `EntityCard`, `EntityCardGrid` and `EntityCardAction` (a thing's card in a grid with its controls), `MetaLine` (the facts line), `StatusMark` (a status as a toned glyph and a muted word), `GlyphAction` (a flat glyph link or button), `FactList` / `FactRow` (a detail section's one-line rows) and `SubPageBar` (a tab's sub-pages as a segmented switch, with the current sub-page's controls at the row's end).
- `ListRow` gained `titleTrail`, marks and chips right after the title that wrap under it when the row is narrow; `SettingsList` gained `loading` and `empty`.
- The Plugins page's card, its buttons, its status mark, the detail dialog's facts line, package links and MCP server rows, and the card grid now come from those modules. The status glyph takes the theme's tone tokens instead of the app's own palette pairs, and the card grid, its loading placeholders included, puts two cards to a row once its own column has room for two rather than once the window is wide, so a column narrower than two cards shows one per row.
- The detail dialog's Workbenches section lists each workbench as a fact row with the workbench glyph, as the MCP servers section lists its servers.
- Shared web modules for an Agent's settings: `PluginUpdateParts` (what an update rewrites, per Agent), `agent-plugin-writes.ts` (install and uninstall on one Agent, writing the shared installs store) and `agentInstallable`. The detail dialog takes the status mark from its caller, an `afterAbout` section and a `machineId`, from which it reads the README and the files; `getPluginFiles` and `getLibraryPluginReadme` take an optional `machineId`.
