# Ship built-in plugins from a pinned GitHub release

- **Date:** 2026-11-23
- **Type:** feature
- **Scope:** `build`
- **PR:** [#1748](https://github.com/Prism-Shadow/penguin-harness/pull/1748)

[中文版](2026-11-23-builtin-release-source.zh.md)

Host packages can pin a plugin directly to a GitHub Release asset. Builds verify its SHA512 and package identity before staging it. Offline builds can read the same asset from the local tarball directory.
