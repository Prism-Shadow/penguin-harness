# The shipped plugins carry no penguin block, and everything that read or described it follows their declarations

- **Date:** 2026-11-04
- **Type:** refactor
- **Scope:** `plugins`, `docs`, `landing`, `tooling`, `ci`
- **PR:** [#1479](https://github.com/Prism-Shadow/penguin-harness/pull/1479)

[中文版](2026-11-04-plugins-drop-penguin-block.zh.md)

The `penguin` block left the `package.json` of all 29 packages under `plugins/`: what it held is declared in each package's `src/index.ts` (penguin-harness-design [#421](https://github.com/Prism-Shadow/penguin-harness-design/pull/421)), and the library stopped reading it in [#1477](https://github.com/Prism-Shadow/penguin-harness/pull/1477). The readers and the prose that still went through the block now go through the declarations.

## Details

- The website's Plugins pages read each plugin's npm fields from `package.json` and its card, Skills, hook package and Workbenches from its built `ifaces.json`; a plugin without one fails the site build, naming the file. The landing lists the plugin packages as `workspace:*` devDependencies, so pnpm builds their tables before it; `pnpm build:site` builds core and the plugins first.
- The `plugin-porting` Skill writes a package in the new form. Its new `write-module.mjs` script declares the card, every Skill and the MCP servers in `src/index.ts`, writes `tsconfig.json`, and adds the `build` script and the build's devDependencies (`@prismshadow/penguin-core` at the PenguinHarness version the plugin is ported for, and `typescript`); the Skill then builds the package with `npm install` and `npm run build` before `penguin plugin install`. `port-mcp.mjs` prints `mcpServers` contribution entries, each with its `<plugin>.mcp.<name>` id. A package still in the retired form is ported into the new one.
- `scripts/check-plugin-versions.mjs` reads the hooks contribution from `src/index.ts` at the base and at the head: a changed hook script, or a changed command of the contribution, needs its `version` raised; a change to the card needs nothing.
- The import dialog's prompt for an Agent describes the package as `package.json`, `src/index.ts` and the `ifaces.json` its build writes.
- The Skills & Plugins, CLI and Server API docs, `plugins/README.md`, `.github/CONTRIBUTING.md` and the dev skill describe the declarations, the build, the kinds rule (a card alone does not make a library plugin) and the version rule in place of the block.
- The gallery's demo library spells its toolkits' cards as their modules declare them. The landing page's `rsi-stats.test.ts`, which pinned the hero's list to the block's categories and to another repository's catalogue, was removed.
