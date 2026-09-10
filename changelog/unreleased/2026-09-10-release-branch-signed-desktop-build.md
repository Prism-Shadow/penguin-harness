# A release branch builds its signed installers before the tag

- **Date:** 2026-09-10
- **Type:** ci
- **Scope:** `ci`, `desktop`
- **PR:** [#670](https://github.com/Prism-Shadow/penguin-harness/pull/670)

[中文版](2026-09-10-release-branch-signed-desktop-build.zh.md)

`desktop-build.yml` now also runs on every push to a `release/**` branch, with macOS and Windows
signing required, exactly as the release run will call it. Whether signing is required is decided
once at the workflow level from the event and the inputs, and the steps read that instead of the
inputs, which are empty on a push. The version stamp stays at the dev version on this path; the
tag's own run stamps the release version.

CI never exercised signing, and signing depends on the hosted runner image as much as on the
repository: 0.2.10 was tagged on a green CI and lost its macOS installers to a change in the
`macos-26` image two days old, so the code shipped again as 0.2.11. A release branch now proves
its installers on its final commit, before the tag exists.
