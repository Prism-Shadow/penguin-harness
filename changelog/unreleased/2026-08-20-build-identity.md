# penguin version reports which build is running

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `cli`, `core`, `server`, `docs`, `ci`

[中文版](2026-08-20-build-identity.zh.md)

Added `penguin version`, which prints the running build's identity as one line — `v0.2.3` for a release, and `git describe --tags --dirty` output such as `v0.2.3-14-g9e8f7d6-dirty` for a build made from a checkout. `-v, --version` prints that same line. `penguin version --json` prints the full record, and `GET /api/version` serves that same record, so the two cannot report different things about one install.

## Details

- Core gained `buildInfo()`, the single producer of the `BuildInfo` record: `version`, `describe`, `channel` (`release` or `source`), `buildDate`, `commit`, `branch`, `dirty`, and a `runtime` block naming the Node version, platform and architecture. The CLI and the version route render it and add nothing of their own.
- A release carries its identity in constants: the release workflow already stamped `VERSION` and `BUILD_DATE`, and now stamps `BUILD_COMMIT` with the tag's commit sha from `GITHUB_SHA`. Both stamping jobs — release artifacts and npm publish — stamp it, so the two channels report the same commit. Tags cut before the constant existed, and replays outside Actions, are stamped as far as they can be and report the rest as unstamped rather than failing.
- An installed penguin never runs git; it reads those constants. Only an unstamped build consults git, and only about the checkout it was built from, located by walking up from the running module's own directory for a directory holding both `.git` and `pnpm-workspace.yaml`. Starting from the module rather than the working directory is what makes `penguin version` report the harness's revision when it is run inside another repository; requiring the workspace marker is what keeps an install that merely sits under an unrelated repository — a home directory that is itself a dotfiles repo — from reporting that repository's commits. A linked worktree, where `.git` is a file, is recognized.
- `dirty` is null rather than false for a release: the workflow stamps its constants into the tree before building, so cleanliness is not a property of a release artifact.
- `scripts/test-installer.sh` replays the workflow's stamping block against fixtures covering a stamped commit, a run with no `GITHUB_SHA`, and a tag whose source predates the constant.

## Compatibility

`GET /api/version` gained fields and removed none; `version` and `buildDate` keep their meanings, so existing clients are unaffected. `VersionResponse` became an alias of core's `BuildInfo`, which is a widening for any TypeScript consumer that reads the two original fields.
