# A hot push carries the plugin library it was built with

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `core`, `server`, `deploy`

[中文版](2026-09-19-pushed-plugin-library.zh.md)

Core reads the skill and hook plugin library through Node from a host package — the package whose `dependencies` name the `@penguinharness/*` packages. A hot-pushed platform sits in the data root's store, where nothing above it is a package, so it fell back to the library installed beside the program that booted it. A machine installed before a plugin existed therefore never offered that plugin, however new its platform was: creating an organization installs `agent-company` on its CEO, and on a program older than company mode every attempt answered *This plugin is not in the plugin library*. The same gap kept an updated skill from ever reaching a pushed instance's library.

`scripts/deploy.mjs` now packs the library core declares — 13 plugins, about 0.4 MB, content-addressed like every other asset — as `archives/library.tgz`, laid out as a host package (`library/package.json` naming the packages, `library/node_modules/@penguinharness/<name>/…`). At boot the platform points core at it (`usePushedPluginLibrary`), and core looks there before it looks above its own module and above the running program. A push without the archive, or a platform that was not pushed at all, reads the library where it did before.

An Agent's installed skills are copies, as they were: a newer library shows up as the plugin's *Update* on the Agent, it does not rewrite what is installed.
