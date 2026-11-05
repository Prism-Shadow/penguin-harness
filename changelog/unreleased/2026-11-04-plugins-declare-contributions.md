# The shipped content plugins declare what they carry as module contributions

- **Date:** 2026-11-04
- **Type:** refactor
- **Scope:** `plugins`
- **PR:** [#1471](https://github.com/Prism-Shadow/penguin-harness/pull/1471)

[中文版](2026-11-04-plugins-declare-contributions.zh.md)

Each of the 25 content plugins under `plugins/` (every package without a code entry) gained a `src/index.ts`: one empty `@Component` class whose `contributes` literal declares what the package carries, slot by slot, for the plugin library module of the plugin unification design (penguin-harness-design [#421](https://github.com/Prism-Shadow/penguin-harness-design/pull/421)). The slots are `PluginLibraryModule.cards` (the card), `.skills`, `.hooks` (the hook package), `.mcpServers` and `.workbenches`. A package's `build` runs `scripts/gen-ifaces.mjs`, which writes that declaration into its `ifaces.json`.

## Details

- The card carries the `penguin` block's display fields in camelCase: `title`, `titleZh`, `descriptionZh`, `shortDescription`, `shortDescriptionZh`, `category`, `icon`, `preinstall`, `quickStart` (`prompt`, `promptZh`, `skills`, `goal`) and `references`. The hook points keep their `hooks.json` spelling: `stop`, `pre_tool_use` and `user_prompt`.
- Every Skill, hook package and Workbench app is named by its path inside the package (`skills/<name>`, `hooks`, `workbenches/<name>`). Contribution ids start with the plugin name: `<plugin>.card`, `<plugin>.skill.<name>`, `<plugin>.hooks`, `<plugin>.workbench.<name>`.
- Each package gained a `tsconfig.json`, a `build` script, a devDependency on `@prismshadow/penguin-core` for the decorators, and `ifaces.json` in its `files`.
- The `penguin` block and the `skills/`, `hooks/` and `workbenches/` directories were left in place, and the library kept reading them. What an install writes into Agent State did not change, and no dated version moved.
- The four sandbox backends were not changed.
