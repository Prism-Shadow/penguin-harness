# Builtin plugins ship bundled

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `plugins`, `build`
- **PR:** pending

[中文版](2026-09-15-builtin-plugins-bundled.zh.md)

The builtin plugin prefix a hot push carries was an npm install of every plugin's dependency
tree, and every installed file is a separate blob on the push: about 1,700 files, most of them
the whole Shiki grammar collection behind the languages plugin's five grammars and Hono's ESM,
CommonJS and type copies behind the Discord bot's route. Enough small transfers to stall a push.

- The Discord bot compiles in Hono, the languages plugin its five grammars, and sandbox-dsh the
  DSH chain; those packages move to `devDependencies`. The prefix is now 167 files (6MB).
- What stays a runtime dependency is a native module: `koffi` and the landlock launcher, both
  sandbox-dsh's, whose per-platform binaries cannot live inside a bundle.
- `scripts/build-plugins.mjs` refuses a builtin plugin that declares any other runtime
  dependency, naming it, before anything is packed.
