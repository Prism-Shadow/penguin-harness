# The Evaluation Center creates and optimizes Benchmarks

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#596](https://github.com/Prism-Shadow/penguin-harness/pull/596)

[中文版](2026-09-02-evaluation-center.zh.md)

The Evaluation Center was rebuilt around the loop a first-timer needs: create a Benchmark for an agent, read its scores, hand it to an optimizer — each step one click away, with the prompts written for the person. Benchmarks are listed under the agent they test, and every row carries the newest score with its change, a sparkline of the scoreboard, and the actions that matter.

## Details

- The page: a title with a one-line subtitle and a folded three-step guide naming the Skill behind each step; a search box over titles, descriptions and agents; collapsible per-agent groups with the agent's avatar and count; rows with the case and run counts, the last evaluation time, the newest score with its change, and a score sparkline. **View** opens the existing detail (chart, evaluation table, case browser) in a right pane on wide layouts and in place of the list on narrow ones. Empty states carry the guide and a "Create with AI" call to action. `?benchmark=<agent>/<id>` opens one Benchmark directly, and a selection writes it back; `?agentId=` still expands only that agent.
- **New Benchmark** is the shared split button. The AI mode adds a Test Agent picker above the prompt, four scenario examples, and a fixed tail that hands the `benchmark-design` Skill the agent id, a desired baseline score, a pilot-iteration limit and the layout to write. The manual mode is a form — title, id proposed from the title, description, runs per case, and per case a directory suffix, title, statement and rubric, with format hints on screen and a folded note on what makes a rubric discriminating — submitted to the new create route.
- **Optimize** on every row (and in the detail header) opens a dialog with two modes over one prompt tail for the `agent-optimization` Skill: a form (the optimizer agent, with a warning when it lacks the Skill; the model of the optimizer's own conversation; runs per case; round limit; a target score defaulting to ten above the baseline; an optional focus) or a free prompt with examples. Both end in the kit's send / edit-in-chat footer. A Benchmark without a baseline says so before anything is sent.
- The row's overflow menu copies the Benchmark's directory path or, for the owner, deletes it after confirmation.
- Server: `POST /api/projects/:p/agents/:a/benchmarks` (owner only) writes `benchmark_config.toml`, a `scoreboard.yaml` holding `evaluations: []`, and each case's `statement/README.md` (the title as its heading) and `rubric/README.md`, answering 409 `benchmark_exists` for a taken id; `DELETE …/benchmarks/:id` removes the directory whole.
- The list only returns directories holding a `benchmark_config.toml`. Deleting a Benchmark while an evaluation is still running leaves a directory behind — the run keeps writing to the paths it was deleted from — and that debris no longer appears as a Benchmark with a placeholder title. A Benchmark that has never been evaluated has its config and still lists.
- The "Create with AI" bridge accepts a `modelRef`, which the Optimize dialog uses to pin the model of the optimizer's conversation.
- The Web App, server API and self-improvement docs describe the page and the routes in both languages.
