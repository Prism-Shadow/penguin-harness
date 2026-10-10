# A hot push carries the plugin library it was built with

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `core`, `server`, `deploy`
- **PR:** [#798](https://github.com/Prism-Shadow/penguin-harness/pull/798)

[中文版](2026-09-19-pushed-plugin-library.zh.md)

A machine that installed a program older than company mode and was then hot-pushed a platform with company mode could not create an organization: every attempt answered *This plugin is not in the plugin library*. Creating an organization installs `agent-company` on its CEO, but the Agent plugin library (Skills and hooks, the `@penguinharness/*` packages) was the one beside the program that happened to boot the platform — 12 plugins, without `agent-company` — however new the pushed platform was. A hot push now carries its own library.

- Deploy produces one more content-addressed asset, `archives/library.tgz`: every Agent plugin core's package manifest declares, laid out as a host package (`library/package.json` naming the packages, plus `library/node_modules/@penguinharness/<name>/…`). A plugin core declares but the repository does not hold fails the deploy, instead of pushing a library with a plugin missing. Today that is 13 plugins, about 0.4 MB.
- Core adds `usePushedPluginLibrary(dir)`. Once it is set, the host package is looked up in this order: the pushed library, then the installation the loader sits in, then the installation of the running program; `null` goes back to the last two. It takes effect on the next library read.
- When the runtime loads the platform from a hot push, the platform finds the library among the unpacked assets (`pushedLibraryDir`) and hands it to core before anything reads the plugin library.
- A push without the asset, or a platform that was not pushed at all (a regular install, the desktop app, dev mode), behaves as before. The pushed library outranks the one beside the program even when the program is newer: the platform that runs is the pushed one, and the library that goes with it is its own. The lookup lives in the pushed core, so it works on runtimes that predate this change.
- An Agent's installed Skills and hooks are copies and are not rewritten: once the library is newer, the plugin shows *Update* on the Agent, and the user decides when to update.
