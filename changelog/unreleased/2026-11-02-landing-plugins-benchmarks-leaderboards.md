# The site gains Plugins, Benchmarks and Leaderboards pages

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `landing`, `ui`, `docs`, `ui-gallery`, `plugins`, `ci`
- **PR:** [#1430](https://github.com/Prism-Shadow/penguin-harness/pull/1430)

[中文版](2026-11-02-landing-plugins-benchmarks-leaderboards.zh.md)

penguin.ooo gained three sections after Download — Plugins, Benchmarks and Leaderboards — each a searchable, filterable list with a page per entry. The pages read their source files at build time: the plugin packages under this repository's `plugins/`, and a fresh shallow clone of [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark) for benchmarks and leaderboards. No copy of that data was added to this repository.

## Details

- Each list puts its search box and order beside the title, filters by facet in a side column, and shows two cards a row: a tinted tile (each plugin category and each benchmark family has its own colour), the title, and the author with a few facts. An entry's page has its tile, title, tags and GitHub link on top, its content in panels with titled bars that rise in on load, and the facts in a side column. References come last.
- **Plugins** read each package's `package.json` (the RFC-0003 fields), its `icon.svg`, its Skills' frontmatter and its README. Filters: category, contents (Skills, Hooks, workbenches) and author. A plugin page shows the description, the quick-start prompt, the Skills, hook points and workbenches, and the README.
- **Benchmarks** read `benchmark_config.toml` and every task's `task_config.toml`, statement and rubric (RFC-0001). Filters: the per-task time limit, whether a leaderboard measures on it, status and author. A task folds open to its budget and three tabs: the statement, the rubric and, when the task has a folder under `data/`, the instruction the agent receives and the folder's files. `#<task-id>` opens one from a link. A Data panel shows the benchmark's `data/` README. From `data/` the clone downloads only each README and instruction; the file lists come from git.
- **Leaderboards** read one `leaderboard.yaml` each (RFC-0005) over RFC-0002 experiments. A value is the op over the experiments' summary metrics. Its standard deviation is the sample deviation of the per-attempt composites, or, when the attempts do not line up, composed from each experiment's `score_std`. Its cost, time and tokens are the sum of one run. The results take the page's full width, with the facts and the benchmarks below. A toolbar switches the view and opens a Filter menu (model, harness, algorithm, thinking level, offered when entries differ on it) and, for the ranking, a Columns menu. The ranking lists rank (the top three tinted), model and thinking level, harness, algorithm, score with an error bar, release date and cost. Each header sorts, cells keep to one line with the full text on hover, and a score opens the entry's raw data: each experiment's summary and the harness settings. Entries are named by what the board compares (the algorithm, else the harness, else the model) and keep one colour across the ranking, the Pareto chart of score against cost / time / tokens, and the per-task grid, which has methods across and tasks down, each task linking to its benchmark. A Method panel shows the calculation in real values: each benchmark's experiment value per entry, then the result, the ± and the summed cost and time, with links to the `leaderboard.yaml` and the experiments.
- Only published benchmarks and leaderboards appear; a `draft` is left out.
- A source file that breaks its format fails the build. `PENGUIN_BENCHMARK_REPO` points the build at a local checkout instead of cloning.
- The site navigation, shared by the landing page, the docs and the gallery, lists the three pages after Download; below 1024px its links move into the menu.
- Every plugin's `package.json` gained an `author`; the SkillAdam, SkillOpt and TRACE toolkits gained a `title`, and the eight algorithm toolkits `penguin.references` with their paper.
- The Pages workflow also deploys when `plugins/` changes, and once a day to pick up the benchmark repository.
