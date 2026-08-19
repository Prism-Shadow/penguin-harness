# Release pipeline: a version test that could only fail where it mattered

- **Date:** 2026-07-27
- **Type:** fix
- **Scope:** `ci`, `server`
- **PR:** [#97](https://github.com/Prism-Shadow/penguin-harness/pull/97), [#99](https://github.com/Prism-Shadow/penguin-harness/pull/99)

[中文版](2026-07-27-release-pipeline.zh.md)

`packages/server/test/version.test.ts` asserted the `/api/version` body against `{ version: VERSION, buildDate: null }`. The version came from core's constant; the build date was a hard-coded literal — and `null` is only ever true of a source build. The release workflow **stamps both constants before it builds and tests**: `VERSION` from the tag, `BUILD_DATE` with the run's UTC date. So the assertion held in every ordinary CI run, in every local run, and in the `release` job that builds the tarballs (it runs no tests at all), and failed in exactly one place — the `publish-npm` job's build-and-test step, the gate in front of the registry.

That is what happened to v0.1.3. Its GitHub Release published in full: all 15 assets, the first-ever `penguin-win32-x64.zip`, `install.ps1`. The npm chain never moved, leaving `@prismshadow/penguin-{skills,core,server,cli}` at 0.1.2 on the registry. The two jobs are independent and parallel by design — a deliberate property, so a registry outage cannot cost a Release — which also means a green Release says nothing about npm, and the gap was invisible until someone went looking for it.

The assertion now compares `buildDate` against `BUILD_DATE`, the same constant the endpoint serves, so it is true of a stamped release build and a source build alike, and the endpoint's contract is still pinned end to end. The v0.1.3 tag could not be moved to pick the fix up — the repo's protected-tag rules forbid it — so 0.1.4 is the delivery vehicle: for anyone installing from npm, this is the release that carries the entire 0.1.3 feature set.
