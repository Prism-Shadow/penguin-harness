# A2UI moves out of core into its own package

- **Date:** 2026-11-04
- **Type:** refactor
- **Scope:** `a2ui`, `core`, `ui`, `cli`, `server`
- **PR:** [#1474](https://github.com/Prism-Shadow/penguin-harness/pull/1474)
- **Breaking:** yes — `@prismshadow/penguin-core/a2ui` is removed; import from `@prismshadow/a2ui`

[中文版](2026-11-04-a2ui-package.zh.md)

The A2UI grammar moved from `packages/core/src/a2ui/` into a new workspace package, `packages/a2ui`, published as `@prismshadow/a2ui`. Core no longer exports `@prismshadow/penguin-core/a2ui`, and no alias was kept. The design is in [penguin-harness-design #421](https://github.com/Prism-Shadow/penguin-harness-design/pull/421).

## Details

- The package has no dependencies, builds one ESM entry with its declarations, and runs in Node 24 and in browsers. It exports the same names the core subpath did.
- `packages/ui`, `packages/cli`, `packages/server` (the messaging bridge's text fallback) and `packages/ui-gallery` import it. Core does not.
- `packages/ui` lists `@prismshadow/a2ui` as a devDependency in place of `@prismshadow/penguin-core`, and bundles it into its published `dist/` with its types inlined into `index.d.ts`, so the UI tarball keeps its shape. `scripts/check-ui-package.mjs` fails a declaration file that names `@prismshadow/a2ui` or `@prismshadow/penguin-core`.
- The eleven A2UI suites moved from `packages/core/test/` to `packages/a2ui/test/`. The one scenario that read the a2ui plugin's place in the plugin library stayed out: the package does not depend on core, and core's plugin library test lists the plugin.
- A change under `plugins/` also runs the A2UI suite, which checks the a2ui Skill and its bundled checker. `scripts/release-npm.sh` stamps and tests the package, the npm job publishes it after `@prismshadow/amsp` and before core, and CI's packaging job packs it with the rest. The site build and the dev prestep build it.

## The a2ui Skill

- `scripts/check.mjs` was rebuilt from `packages/a2ui/src/`. Its header and the path comment above each bundled file name the new directory, and its source hash changed with the package's module comment. The checker's code is unchanged.
- `references/components.md` names `@prismshadow/a2ui` as where the grammar lives. The Skill's version is `2026.11.04.1`; its description is unchanged.

## Compatibility

- SDK code that imports from `@prismshadow/penguin-core/a2ui` fails to resolve that subpath. Change the specifier to `@prismshadow/a2ui`, which ships in the same release with the same exports.
- An Agent with the a2ui Skill installed shows an update for it. Applying it installs the rebuilt checker and the reference's new sentence.
