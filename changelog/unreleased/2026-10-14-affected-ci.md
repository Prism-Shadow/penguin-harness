# Run CI for affected packages and validate releases in full

- **Date:** 2026-10-14
- **Type:** process
- **Scope:** `ci`, `tooling`, `web`
- **PR:** [#1120](https://github.com/Prism-Shadow/penguin-harness/pull/1120)

[中文版](2026-10-14-affected-ci.zh.md)

CI selected changed workspace packages and their downstream consumers with pnpm, built
their required dependencies, and skipped unrelated jobs. Shared or unclassified inputs
and missing comparison history triggered full validation.

## Checks and release gates

- Browser and site tests ran on Linux; affected native packages retained macOS and Windows tests.
- Core, server and web tests reported branch and line coverage during the existing Linux run.
- Three browser smoke scenarios covered login persistence, approval before command execution,
  reload recovery and follow-up messages against a local mock LLM.
- Packaging retained stamped-version, plugin-index, installer and bundled-CLI regression checks.
  The npm check used focused stamped suites, and Electron artifact uploads moved to manual CI runs.
- New releases required the complete three-platform workflow at the release ref before publishing.
  Existing immutable releases retained publisher and mirror retries.
- Manual release builds recorded the checked-out tag's commit instead of the dispatch branch's commit.
- The required `ci` gate accepted only planned skips and rejected missing or failed jobs.
- The icon-registry guard avoided parsing unrelated files while retaining its glyph checks.
- SSH timeout and workflow-session tests established their own connection and model prerequisites.
- Docker `latest` rebuilt for runtime or build-input changes on `main`; unrelated site and
  documentation edits stopped rebuilding both image architectures.
- A new PR push cancelled its obsolete site preview build while production deployments finished.
