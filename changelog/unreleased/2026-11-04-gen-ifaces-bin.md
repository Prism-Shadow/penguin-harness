# Plugin packages build their interface table with `penguin-gen-ifaces`

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `tooling`
- **PR:** [#1475](https://github.com/Prism-Shadow/penguin-harness/pull/1475)

[中文版](2026-11-04-gen-ifaces-bin.zh.md)

The interface generator shipped with `@prismshadow/penguin-core` as the `penguin-gen-ifaces` command, so a plugin package outside this repository could build its `ifaces.json` the way the shipped plugins do: `penguin-gen-ifaces --project tsconfig.json --out ifaces.json`, with core and `typescript` in its `devDependencies`. The generator also refused a `contributes` value it could not read as data.

## Details

- The generator moved from `scripts/gen-ifaces.mjs` to `packages/core/bin/gen-ifaces.mjs` and joined core's published `files`. `scripts/gen-ifaces.mjs` became a shim that runs it, so the build lines of the server and the plugin packages did not change, and every table the repository generates stayed byte for byte the same.
- It compiled with the `typescript` of the package being built, resolved from the working directory, and fell back to the one core resolves.
- Every value under a `@Component` or `@Module` class's `contributes` had to be written out. A reference to a constant, a spread or a shorthand property stopped the build with the file, line and key of each, for example `src/index.ts:12: GoalPlugin contributes["PluginLibraryModule.skills"]: 'SKILLS' is a reference`, and no table was written. A constant there used to crash the generator with `Converting circular structure to JSON` and no location.
- A decorator whose whole argument was a constant (`@Component(META)`) was refused the same way. Its contributions used to be left out of the table without a warning.
