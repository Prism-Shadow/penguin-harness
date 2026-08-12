# Release tooling: the repo version can no longer drift behind a shipped release

v0.2.1 was tagged from a repo still versioned 0.2.0 — its prep PR moved the changelog and wrote RELEASE.md but skipped the version bump that 0.2.0's prep performed — so every dev/source build compared itself against the published v0.2.1 and prompted about an update indefinitely, while release artifacts (stamped from the tag at build time) looked fine.

- Root and every `packages/*/package.json` version, plus core's `VERSION` constant, are bumped to 0.2.1 to match the shipped release.
- Both `release.yml` stamp steps (the release job and the parallel npm publish job) now refuse a tag push whose version does not match the repo's `package.json`, with the fix spelled out in the error. Manual `workflow_dispatch` only warns, so a legacy tag whose Release went missing can still be rebuilt from its own source; the installer-test fixtures self-skip the check (no `package.json` in the replay dirs), keeping the stamp block replayable by `scripts/test-installer.sh`.
- `CONTRIBUTING.md` documents the version bump as an explicit release-prep step alongside the changelog rename and RELEASE.md.
