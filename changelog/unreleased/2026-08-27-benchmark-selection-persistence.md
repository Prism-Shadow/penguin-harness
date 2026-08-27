# Preserve benchmark selection across navigation

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `web`
- **Issue:** [#181](https://github.com/Prism-Shadow/penguin-harness/issues/181)

[中文版](2026-08-27-benchmark-selection-persistence.zh.md)

The Benchmark page now keeps the selected Agent and Benchmark in the URL, so returning from a Session trace restores the previous view for the current project.

## Details

- Selecting a benchmark updates `agentId` and `benchmarkId` query parameters.
- A matching selection is restored after the page mounts again.
