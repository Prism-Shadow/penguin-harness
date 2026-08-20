# penguin version reports which build is running

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `cli`, `core`, `server`, `docs`, `ci`
- **PR:** [#382](https://github.com/Prism-Shadow/penguin-harness/pull/382)

[中文版](2026-08-20-build-identity.zh.md)

Added `penguin version`, which prints the running build's identity as one line — `v0.2.3` for a release, and `git describe --tags --dirty` output such as `v0.2.3-14-g9e8f7d6-dirty` for a build made from a checkout. `-v, --version` prints that same line. `penguin version --json` prints the full record, and `GET /api/version` serves that same record, so the two cannot report different things about one install.

The record's `harness` half names what a hot update pushed to the machine: a pushed bundle lands outside any checkout, so it can only identify itself by the version it was compiled from, and the store's recorded provenance is the only thing that names the revision behind it.

## Details

- Core gained `buildInfo()`, the single producer of the `BuildInfo` record: `version`, `describe`, `channel` (`release` or `source`), `buildDate`, `commit`, `branch`, `dirty`, and a `runtime` block naming the Node version, platform and architecture. The CLI and the version route render it and add nothing of their own.
- A release carries its identity in constants: the release workflow already stamped `VERSION` and `BUILD_DATE`, and now stamps `BUILD_COMMIT` with the tag's commit sha from `GITHUB_SHA`. Both stamping jobs — release artifacts and npm publish — stamp it, so the two channels report the same commit. Tags cut before the constant existed, and replays outside Actions, are stamped as far as they can be and report the rest as unstamped rather than failing.
- An installed penguin never runs git; it reads those constants. Only an unstamped build consults git, and only about the checkout it was built from, located by walking up from the running module's own directory for a directory holding both `.git` and `pnpm-workspace.yaml`. Starting from the module rather than the working directory is what makes `penguin version` report the harness's revision when it is run inside another repository; requiring the workspace marker is what keeps an install that merely sits under an unrelated repository — a home directory that is itself a dotfiles repo — from reporting that repository's commits. A linked worktree, where `.git` is a file, is recognized.
- `dirty` is null rather than false for a release: the workflow stamps its constants into the tree before building, so cleanliness is not a property of a release artifact.
- `scripts/test-installer.sh` replays the workflow's stamping block against fixtures covering a stamped commit, a run with no `GITHUB_SHA`, and a tag whose source predates the constant.

## Harness provenance

- `scripts/deploy.mjs` now sends the `source` the upgrade protocol already carried, filling it from its own checkout: `revision` is spelled exactly as `describe`, `-dirty` included, because a deploy from an uncommitted tree is ordinary and the sha alone would name code that never existed. A push from outside a git checkout carries no `source` rather than a fabricated one.
- `HmrHost.persistVersion` commits that `source` to `harness.json` alongside a `pushedAt` timestamp, so provenance travels with the version it describes. The upgrade route accepts `source` only when both halves are non-empty strings — it now outlives the request, and a malformed record would outlive the push that sent it.
- `readHarnessInfo` in `hmr/manifest.ts` reads it back defensively, degrading to null fields rather than throwing: the command a user runs to find out what is wrong must not be the one that breaks. Versions committed before provenance existed report their bundle pointers with a null `source`.
- The `harness` field describes the data root's store, not the reporting process. `penguin` runs the packaged CLI while `penguin-hmr` runs the store's, so a non-null `harness` does not by itself mean the command printing it is the pushed code.
- `versionReport()` — a new `@prismshadow/penguin-server/version-report` entry point — joins core's `buildInfo()` with that reader, and both the CLI and the version route render it. Neither layer can produce the other half: core knows the artifact and nothing about data roots, the store knows the root and nothing about the process reading it.

## Compatibility

`GET /api/version` gained fields and removed none; `version` and `buildDate` keep their meanings, so existing clients are unaffected. `VersionResponse` became an alias of core's `VersionReport`, which is a widening for any TypeScript consumer that reads the two original fields.

`harness.json` gained two optional fields. Older records read back with `source` and `pushedAt` null and are never rewritten; nothing re-pushes on their behalf, so a root keeps reporting a null provenance until its next hot update. No migration is needed and none is performed.
