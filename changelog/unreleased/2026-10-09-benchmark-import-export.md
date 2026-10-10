# Benchmarks import from a zip or through an agent, and export as a package

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `core`, `skills`, `docs`
- **PR:** [#1011](https://github.com/Prism-Shadow/penguin-harness/pull/1011)

[中文版](2026-10-09-benchmark-import-export.zh.md)

The Evaluation Center gained **Import benchmark**, open to every member of the Project, and a Benchmark's page gained **Export**. Both move a Benchmark as its [package](2026-10-09-benchmark-package.md), `benchmark.json` and the `CASE-*` folders, and never its scores.

## Import

- The dialog took the Skills tab's two paths. The recommended one turned a pasted source (a folder link in a repository such as Prism-Shadow/penguin-harness-benchmark, a local path or a description) into a prompt for the Project's default agent and opened it as a new chat's draft. The prompt asked the agent to resolve the link to a 40-hex commit, fetch only that folder into a temporary directory, read every file, import it with `penguin benchmark import` into this Project with the folder as its origin, and ask before overwriting; it never wrote under `benchmarks/` itself. The server fetched nothing.
- `penguin benchmark import <dir-or-zip> [--overwrite] [--origin-url <link> --origin-ref <commit> --origin-path <folder>]` posted a zip as it was, or a folder zipped whole with every entry as it was, to the zip route of the current Project, so an agent's import went through the same checks as an upload and the server wrote the copy. Given together, the three origin options made the copy's origin `git` with the link, the commit and the folder; the route took them as `origin` and refused any other. The command held a folder to the import's caps before sending, and answered a taken id with the Benchmark's name and `--overwrite`.
- The other path uploaded a zip to `POST /api/projects/:p/benchmarks/archive`, which any member may call. The server took `benchmark.json` and `CASE-*` directories only, at the root or in one top-level directory named by the id. It refused zip-slip paths, names with a control character or differing from another only in letter case, links, `scoreboard.yaml`, `.jobs/` and other top-level entries, a status other than `published`, and cases without both READMEs with 400, and archives over 14MB, 1000 files, 5MB in one file or 20MB inflated with 413 `benchmark_too_large`, the sizes read before anything inflated. It wrote the cases as they were, the manifest with origin `zip` and the import time, and `evaluations: []`.
- A taken id answered 409 `benchmark_exists`, with the id in `details.benchmarkId`. The dialog then asked before overwriting, naming the evaluation records and run results that would be deleted, and resent the zip with `overwrite`, which replaced the directory whole. An import or an overwrite whose id another import took first, between the check and the write, answered the same 409. An overwrite answered 409 `benchmark_busy` instead while the Benchmark's `.jobs/` held a trial without its `result.json` or a Test Agent State packed for one, the marks of an evaluation that would go on writing into the new copy; the dialog showed that refusal under the upload button.

## Export

- `GET /api/projects/:p/benchmarks/:benchmarkId/archive`, open to any member, returned `<id>-v<version>.zip`: `benchmark.json` as it read on disk and the cases, without the scoreboard, `.jobs/`, dot-entries or symlinks. Every entry carried one fixed time, so exporting an unchanged Benchmark again gave the same bytes. A draft, a failed Benchmark and one whose manifest could not be read answered 409.
- A published Benchmark's page showed an Export icon beside the copy-path button. It downloaded from the server or machine holding the copy the page described.

## Details

- agent-tuning `2026.10.09.5`: `benchmark-design` gained `reference/package.md`, which defines the package and walks through importing one from a repository folder with `penguin benchmark import`, and a one-line pointer to it.
- The server published `@prismshadow/penguin-server/benchmark-package`, which reads a folder or a zip as the upload the CLI sends, held to the import's caps.
- Core exported `placeBenchmark`, the staged write behind seeding, with a mode that replaces a Benchmark already under the id. When another writer's copy took the id first, it failed with `EEXIST` on every platform, Windows included, where the rename itself reports `EPERM`. The server's archive limits gained `MAX_BENCHMARK_ARCHIVE_FILES` (1000) and took over the zip-slip check and the 14MB cap from the Skills route.
- The server's error body gained an optional `details` object beside `code` and `message`, for the facts a client acts on, and the Web App's `ApiError` carried it.
- The Evaluation Center, server API and CLI docs pages described both, and the gallery's mock API answered the two routes.
