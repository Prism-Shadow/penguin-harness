# A web-only or CLI-only push reaches the machines

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `server`
- **PR:** [#799](https://github.com/Prism-Shadow/penguin-harness/pull/799)

[中文版](2026-09-19-handover-harness-identity.zh.md)

A server that was hot-pushed hands its build over to the machines it holds, and decides which of them are behind by comparing versions (`<release>+hmr.<sha>`). The sha was read off the platform bundle alone, so a push that changed only the web app or only the CLI left the version as it was: every machine counted as up to date, the Machines page agreed, and the push was never handed over.

The suffix now identifies the harness — the platform bundle, the CLI bundle and the web artifact folded into one sha. Assets are deliberately no part of it: they are what a harness loads (plugins, the native modules it pins), not the harness.

The sweep that finds the machines behind also ran too early to see a push at all: a pushed platform boots before its version is committed to the store, and the sweep runs as part of that boot, so it read the previous version off the disk, found every machine already carrying it and handed nothing over — the push then reached the machines one push late. It now runs a second time shortly after boot, when the commit has landed; with nothing behind that is a no-op.

Versions recorded for machines before this change carry the old suffix, so each held machine is handed the current build once more after the upgrade. Nothing has to be done by hand.
