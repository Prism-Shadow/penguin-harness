# Release: the npm job's stamping and tests run in CI too

- **Date:** 2026-10-13
- **Type:** process
- **Scope:** `ci`, `tooling`
- **PR:** [#1085](https://github.com/Prism-Shadow/penguin-harness/pull/1085)

[中文版](2026-10-13-release-npm-path-in-ci.zh.md)

The v0.2.14 release run failed in its npm job before anything was published: the job stamps the tag's version into every package it publishes, the sandbox backends included, but not into the server's embedded index of those backends, and a server test compares the two. CI never stamped, so it was green. The release ships as 0.2.15.

## Details

- The npm job's stamping and its test suites moved into `scripts/release-npm.sh` (`stamp <tag>`, `test`). `release.yml` calls it, and so does CI's `npm packaging` job on every pull request: it stamps with the repo's own version, builds the whole workspace and runs the same suites, so a test that only fails on the stamped tree fails before a tag.
- The stamping now also writes the version into `packages/server/src/plugin/builtin-index.json`, so the published server lists the sandbox backends at the version that is published.
- The release job's own stamp step is unchanged; `scripts/test-installer.sh` replays it.
