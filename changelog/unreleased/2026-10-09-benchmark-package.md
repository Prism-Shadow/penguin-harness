# Benchmarks are packages: benchmark.json replaced benchmark_config.toml and carries a date version

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `skills`, `tooling`
- **PR:** [#1008](https://github.com/Prism-Shadow/penguin-harness/pull/1008)

[中文版](2026-10-09-benchmark-package.zh.md)

A Benchmark's config became a manifest, `benchmark.json`, that describes the Benchmark as a package the way `plugin.json` describes a plugin: `id` (its directory name), `title`, `description`, a date `version` (`YYYY.MM.DD.N`), `status`, `runs` and `origin` (`builtin`, `manual`, `agent`, `git` with `url` / `ref` / `path` / `imported_at`, or `zip` with `imported_at`). A Benchmark's package is the manifest and its `CASE-*` directories; `scoreboard.yaml`, the `.jobs/` trials, other dot-entries and symlinks stay with the copy on disk. How the `benchmark_config.toml` files already on disk are read is recorded in [backward compatibility](2026-10-09-backward-compatibility.md).

## Details

- Core gained `packages/core/src/state/benchmark-manifest.ts`: the manifest's types, `parseBenchmarkManifest` (strict; `benchmark_manifest_invalid`, or `benchmark_id_mismatch` for an `id` that is not its directory's; unknown fields ignored), `readBenchmarkManifest`, `writeBenchmarkManifest` (atomic, two-space JSON, refusing what the reader would refuse), `nextDateVersion` (the day's `.1`, then the next number the same day, never backwards) and `compareDateVersions`.
- The example and the five built-in Benchmarks were seeded with `benchmark.json`, origin `builtin`, each at a version kept in core's data (`2026.10.09.1`). `BUILTIN_BENCHMARKS` was exported from core.
- The server's Benchmark list read through the manifest. A directory whose name is not an id (`.seeding/`, `.harbor/`) was never a Benchmark. One whose manifest could not be used (not JSON, a field out of shape, an `id` that is not its directory's) was listed under its directory name as `failed`, with `manifestError` giving the code and the reason; a filesystem error reading a manifest failed the request. A Benchmark created by hand was written with the day's first version and origin `manual`. `BenchmarkSummary` gained `version`, `origin` (`importedAt` in camelCase) and `manifestError`. An `origin.ref`, when present, had to be a 40-character commit id.
- The Web App's Benchmark page showed the version beside the directory path and, for a Benchmark an agent imported from a repository folder, a link to that folder (http and https links only). A Benchmark whose manifest could not be read was masked like a failed one, as **Manifest can't be read**, with the reason as an icon's hover hint on its card and in the notice on its page. The merged list took the version and the origin from the first machine that names them. The Create with AI prompt named `benchmark.json` and its fields.
- agent-tuning `2026.10.09.3`: `benchmark-design` wrote `benchmark.json` with a version and origin `agent`, and moved the version on whenever it changed a case or the status; `agent-evaluation` and `agent-optimization` read `benchmark.json`.
- `scripts/benchmark-packages.mjs --out <dir>` wrote the five built-in Benchmarks as packages, without scoreboards, for the benchmark repository's `packages/`. `scripts/check-plugin-versions.mjs` refused a change to the seeded Benchmarks' data or to the writer of their statements without a new version in the file that holds the versions; lines that are comments or blank did not count.
- The docs' Benchmark storage section described the manifest, the version rule and the package; the Evaluation Center and server API pages followed, and the gallery's Benchmarks carried versions.
