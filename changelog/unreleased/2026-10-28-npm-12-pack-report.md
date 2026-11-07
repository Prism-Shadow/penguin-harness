# Plugin imports with npm 12

- **Date:** 2026-10-28
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1381](https://github.com/Prism-Shadow/penguin-harness/pull/1381)
- **Issue:** [#1366](https://github.com/Prism-Shadow/penguin-harness/issues/1366)

[中文版](2026-10-28-npm-12-pack-report.zh.md)

Importing a plugin from a zip failed on machines with npm 12 with "npm pack did not report the tarball it wrote". npm 12 prints the `npm pack --json` report as an object keyed by package name, where npm 11 printed an array, and the installer had read the report from the first `[` in the output, which in npm 12's report opens the package's `files` list. The installer read the tarball name from either shape, and still refused a report that named no tarball or a name with a directory part.
