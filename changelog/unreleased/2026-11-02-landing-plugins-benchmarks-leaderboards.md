# The site gains Plugins, Benchmarks and Leaderboards pages

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `landing`, `ui`, `docs`, `ui-gallery`, `plugins`, `ci`
- **PR:** [#1430](https://github.com/Prism-Shadow/penguin-harness/pull/1430)

[中文版](2026-11-02-landing-plugins-benchmarks-leaderboards.zh.md)

penguin.ooo gained three sections after Download — Plugins, Benchmarks and Leaderboards — each a searchable, filterable list with a page per entry. The pages read their source files at build time: the plugin packages under this repository's `plugins/`, and a fresh shallow clone of [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark) for benchmarks and leaderboards. No copy of that data was added to this repository.

## Details

- **Plugins** read each package's `package.json` (the RFC-0003 fields), its `icon.svg`, its Skills' frontmatter and its README. Filters: category, contents (Skills, Hooks, workbenches) and author. A plugin page shows the description, the quick-start prompt, the Skills, hook points, workbenches, references and the package facts.
- **Benchmarks** read `benchmark_config.toml` and every task's `task_config.toml` and statement (RFC-0001). Filters: the per-task time limit, whether a leaderboard measures on it, status and author. A benchmark page folds each task open to its budget and statement; `#<task-id>` opens one from a link. Rubrics stay in the repository.
- **Leaderboards** follow RFC-0005 over RFC-0002 experiments: a value is the op over the experiments' summary metrics, its standard deviation the sample deviation of the per-attempt composites, and its cost, time and tokens the sum of one run. The three charts are a ranking, score against cost / time / tokens with the Pareto frontier, and a per-task grid. Until the benchmark repository has its own `leaderboards/`, one written to the same format in `packages/landing/hub-placeholder/` stands in, over the repository's real GDPevo-Essential experiments.
- A source file that breaks its format fails the build. `PENGUIN_BENCHMARK_REPO` points the build at a local checkout instead of cloning.
- The site navigation, shared by the landing page, the docs and the gallery, lists the three pages after Download; below 1024px its links move into the menu.
- Every plugin's `package.json` gained an `author`; the SkillAdam, SkillOpt and TRACE toolkits gained a `title`, and the eight algorithm toolkits `penguin.references` with their paper.
- The Pages workflow also deploys when `plugins/` changes, and once a day to pick up the benchmark repository.
