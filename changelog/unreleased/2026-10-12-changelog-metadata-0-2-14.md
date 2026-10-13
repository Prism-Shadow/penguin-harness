# The unreleased changelog entries got complete metadata

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `changelog`
- **PR:** [#1079](https://github.com/Prism-Shadow/penguin-harness/pull/1079)

[中文版](2026-10-12-changelog-metadata-0-2-14.zh.md)

The metadata of the entries in `changelog/unreleased/` was brought in line with `changelog/README.md` before the folder is renamed and frozen at release. Apart from one wrong migration number, only metadata blocks, counterpart links and two compatibility sections' headings changed; no entry's account of its change was rewritten.

- **PR links.** Entries with no `PR` field got the PR that added them. An entry later amended by another PR that changed what it describes lists both. An entry that cited a PR closed unmerged, or merged into a stacked branch instead of `main`, also lists the PR that landed it on `main`.
- **Types.** Values outside the four (`feat`, `feature, fix`, `test`, `improvement`) became `feature` or `process`. Two compatibility records typed `feat` and `feature` became `process`, like every other one.
- **Shape.** One entry with a plain-text metadata block and no counterpart links got the standard block and both links. Bare scope identifiers were backticked, and one counterpart link read `[中文]` instead of `[中文版]`.
- **Compatibility sections.** The two compatibility records that set `Breaking` had their `## What users need to do` section renamed to `## Compatibility` (`## 兼容性`), and its opening "Nothing." became "Upgrading needs no action." to read under the new heading.
- **Migration number.** `2026-10-11-session-archive` gave the schema migration that added `kept_at` as 15; it was migration 16, `sessions-kept-at`.
