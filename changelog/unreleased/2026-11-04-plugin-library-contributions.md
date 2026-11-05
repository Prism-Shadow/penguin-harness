# The plugin library reads what a plugin declares in its built ifaces.json, with the server as its host

- **Date:** 2026-11-04
- **Type:** refactor
- **Scope:** `core`, `server`, `cli`, `plugins`, `ci`
- **PR:** [#1477](https://github.com/Prism-Shadow/penguin-harness/pull/1477)
- **Breaking:** yes — the `penguin` block of a plugin's package.json is no longer read, a plugin package must be built (carry `ifaces.json`), and several SDK exports were renamed or removed

[中文版](2026-11-04-plugin-library-contributions.zh.md)

The plugin library stopped reading a package's `penguin` block and its directory conventions. A plugin's card, Skills, hook package, MCP servers and Workbench apps are now read from the contributions its module declares to the five data-only slots `PluginLibraryModule.{cards,skills,hooks,mcpServers,workbenches}`, which the package's build writes into its `ifaces.json` (penguin-harness-design [#421](https://github.com/Prism-Shadow/penguin-harness-design/pull/421)). `package.json` is read for npm's fields only. What an install writes into an Agent's Agent State did not change: for every shipped plugin, the library's output and the installed files hash the same before and after.

## Details

- Core's reader moved from `packages/core/src/plugins/` to `packages/core/src/plugin/`, one file per concern: the contract types (`library.ts`, exported as types from `@prismshadow/penguin-core/plugin`), the npm fields (`package-json.ts`), the table (`table.ts`), the contribution checks (`contributions.ts`), what kind a package is (`kinds.ts`), the icon, the dated versions, the SKILL.md frontmatter, where the library is (`library-host.ts`), the reader (`library-reader.ts`) and the categories. `legacy-skill-frontmatter.ts` moved unchanged.
- Each contribution is checked entry by entry; one that does not fit is dropped with a warning naming `<Module>.contributes["<slot>"][<i>]`. Only declared content installs: a directory under `skills/` or `workbenches/` that no contribution names, and a `hooks/` without a hooks contribution, are reported and left out. For a shipped plugin any warning fails the load, as before.
- What kind a package is follows from its table. A library plugin contributes at least one Skill, hook package, MCP server or Workbench app; a server module has a code entry and its table lists modules. A card alone is neither. The installed-plugins routes, the zip upload, the prefix's own registry rows and `penguin plugin install <dir>` all use this rule, and none of them reads the presence of `ifaces.json` as "server module" any more.
- A plugin zip without `ifaces.json` is refused before it installs, with the instruction to build it first; `penguin plugin install <dir>` refuses an unbuilt directory before it zips anything.
- The 25 `@penguinharness/*` dependencies moved from `packages/core` to `packages/server`. Core gained `useLibraryHost(dir)`, which names the package whose dependencies are the library; the server names its own package at boot. Without a named, pushed or found host, a library call fails naming where it looked.
- For a package on this machine, the plugin registry's title, descriptions and icon now come from its card contribution; a package without one keeps its index row's text and its root `icon.svg`.
- The hot push's library archive follows the server's dependencies, builds each plugin's `ifaces.json` before packing, and leaves each plugin's `src/` and `tsconfig.json` out. The desktop preflight checks that every plugin package carries its `ifaces.json`, and the `pnpm dev` prestep builds the content plugins' tables.
- The tests that read the shipped library and the README catalog check moved from core to `packages/server/test/plugin-library.test.ts`; core's reader tests run on fixture tables. The CI README catalog job runs that server suite, and a change under `plugins/` also selects the server suite.

## Compatibility

- A package an operator installed into `<root>/plugins` that still carries the `penguin` block and no `ifaces.json` is no longer listed in the plugin library; the server logs one line per such package. Copies already installed on Agents keep working. To list it again, port it again as a package whose `src/index.ts` declares its content, build its `ifaces.json`, and install it again.
- SDK: `parsePluginPackage`, `readPluginPackage`, `PluginPackageManifest`, `PluginPackageFields`, `PluginHooksDeclaration` and `declaresMcpServers` were removed. Use `parsePackageJson` / `readPackageJson` (`NpmPackage`) for npm's fields and `readPluginTable` with `libraryContributions` for what a package declares. `libraryParts` now reads the table and reports `modules` too.
- SDK: an embedder that creates `default_agent` or calls `provisionProjectAgents` must name its library host with `useLibraryHost(<package dir>)`, whose `package.json` depends on the `@penguinharness/*` packages; without one, that call throws instead of seeding from core's own dependencies.
