# Projects move under the data root's projects/ folder, and Benchmarks into the Evaluation Center's data

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `skills`, `desktop`
- **PR:** [#1669](https://github.com/Prism-Shadow/penguin-harness/pull/1669)
- **Breaking:** yes — a Project's folder is `<root>/projects/<project_id>/` and a Benchmark's is the Evaluation Center's data folder; a Project named `projects` keeps the server from starting

[中文版](2026-11-20-data-root-projects.zh.md)

The data root's top level now holds only the server's own files and folders (`web.db`, `server.lock`, `bin/`, `logs/`, `plugins/`, `machines/`, `app/`, `run/`, …), and every Project is a folder of `projects/`: `~/.penguin/data/projects/<project_id>/agents/<agent_id>/`. A Project's Benchmarks moved from `<project>/benchmarks/` into the Evaluation Center's data folder, the system Agent's agent-level app data `agents/system_agent/app/data/benchmark/<benchmark_id>/`. Existing data roots are moved by a one-time migration at start (design: [PRFC-0034](https://github.com/Prism-Shadow/penguin-harness-design/pull/494)).

## Details

- **Paths.** Core's `projectDir(root, id)` is `<root>/projects/<id>`, built on the new `projectsDir(root)`; every other path helper follows it. `benchmarksDir(root, projectId)` is the system Agent's `app/data/benchmark/`, built on the agent-level `workbenchDataDir`. `listProjectDirs(root)` lists the real folders of `projects/` that hold a `.project_config.toml`, skipping links; the plugin loader, the stored-config migrations, the resumed Agent deletions and the Trace adoption sweep list Projects through it.
- **Project ids.** The ids already taken are the folders of `projects/` and the rows of web.db; the names at the data root's top level take none. A new Project may be called `app` or `run` again, and may not be called `projects` (400 `invalid_project_id`). A workbench's shared folders under `<root>/app` and `<root>/run` are refused, with a sentence naming the Project, while an older Project called `app` or `run` keeps a link there.
- **The migration** (core's `state/layout-migration/`): every start of a server, and the SDK's `createAgent` and the CLI's `penguin config model` / `penguin config vault` on a root no server holds, check the root first.
  - Each real Project folder at the top level is renamed into `projects/` and leaves a link at its old place: a relative symbolic link on POSIX, a directory junction on Windows.
  - The absolute paths under the old folder that the Project's own files record are rewritten by prefix: `.project_config.toml`'s `[default_chat]`, an organization's `org_config.toml`, `desks.toml`, `org_chart.yaml` and calendar files, and each Agent's schedule files, with their comments kept.
  - The server rewrites the ones web.db stores in one transaction: the Sessions' Workspaces and sandbox masked paths, the Agent API Workspaces, the Trace cache's Workspaces, the sandbox settings' masked paths and the drafts' Workspaces. A run without the server (the SDK) keeps them in the journal, and the server's next start rewrites them.
  - Windows `workbenches` junctions are re-pointed, and a Workspace's Memory moves to the key of its new path.
  - Traces are never rewritten: the paths they record reach the same files through the links.
  - Then each Project's `benchmarks/` moves into the Evaluation Center's data folder and leaves a relative link; the system Agent is provisioned first where the Project has none. A Benchmark whose id the new folder already holds stays in the old folder with a warning.
  - `<root>/.layout-migration.json` journals what a run left half done, and the next start finishes it.
  - The server runs it holding `server.lock`, before the platform boots, and the platform runs it again before its plugin loader, so a platform pushed onto an older program migrates the root too.
  - A migration that stops ends the start with its sentence as an `Error:` line, which the desktop app's start dialog now shows and a machine reports as its start failure.
- **Prompts.** The Evaluation Center's prompts (create with AI, import, evaluate, optimize, a toolkit's run and both "Ask AI" questions) name the Benchmark's absolute folder as `BENCHMARK_DIR`, which the server hands the page: `BenchmarksResponse.dir` and `BenchmarkSummary.dir`. The Benchmark page's copy button copies that folder.
- **Skills.** `agent-evaluation` (its Harbor reference included), `benchmark-design`, `agent-optimization` and the RSI toolkits use the `BENCHMARK_DIR` a request names, else `<app_data_dir>/agents/system_agent/app/data/benchmark/<id>`, and pass it on to every evaluation request as `benchmark_dir`. They no longer set `PENGUIN_HOME` to the App Data Dir's parent; the Harbor helper and adapter's `host_penguin_home` is the folder holding the Project, so they still read its config. `penguin-config` and the Models and vault "Add with AI" prompts take the data root as two levels above the App Data Dir.
- **Docs.** The data layout, configuration, Evaluation Center and self-improvement pages describe the new places.

## Compatibility

Nothing needs to be done on an existing data root except one whose Project is named `projects`: see [backward compatibility](2026-11-20-backward-compatibility.md).
