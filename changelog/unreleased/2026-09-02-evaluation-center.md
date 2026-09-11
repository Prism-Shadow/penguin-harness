# The Evaluation Center creates and optimizes Benchmarks

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#596](https://github.com/Prism-Shadow/penguin-harness/pull/596)

[中文版](2026-09-02-evaluation-center.zh.md)

The Evaluation Center was rebuilt around the loop a first-timer needs: create a Benchmark for an agent, read its scores, hand it to an optimizer — each step one click away, with the prompts written for the person. Benchmarks are listed under the agent they test, and every row carries the newest score with its change, a sparkline of the scoreboard, and the actions that matter.

## Details

- The page: a title with the search box (over titles, descriptions and agents) and the two create buttons beside it, and the folded three-step guide naming the Skill behind each step under them; collapsible per-agent groups with the agent's avatar and count; one card per Benchmark carrying its title and directory name, the case and run counts, the last evaluation time, the newest score with its change, and a score sparkline — the list column, the header and the cards in the Agents page's shape.
- Opening a Benchmark **enters** it. A card, or its **View** button, navigates to that Benchmark's own page at `/benchmark/:agentId/:benchmarkId` — the existing detail (chart, evaluation table, case browser) under the agent it tests and a back button to the list — instead of expanding a second pane beside the list. A pair that resolves to nothing, a deleted Benchmark or a stale link, says so and keeps the way back. Empty states carry the guide and the same pair of buttons, and `?agentId=` still expands only that agent.
- **Create with AI** and **Create manually** are the kit's two buttons, side by side, each opening its own path. The AI one adds a Test Agent picker above the prompt, four scenario examples, and a fixed tail that hands the `benchmark-design` Skill the agent id, a desired baseline score, a pilot-iteration limit and the layout to write; the composed prompt is prefilled into a new conversation and sending stays the user's move. The manual one is a form — title, id proposed from the title, description, runs per case, and per case a directory suffix, title, statement and rubric, with format hints on screen and a folded note on what makes a rubric discriminating — submitted to the new create route.
- **Optimize with AI** and **Optimize manually** in the Benchmark page's header are the same pair over one prompt tail for the `agent-optimization` Skill: the manual one is a form (the optimizer agent, with a warning when it lacks the Skill; the model of the optimizer's own conversation; runs per case; round limit; a target score defaulting to ten above the baseline; an optional focus), the AI one a free prompt with examples. A card has no space for a pair, so its **Optimize** button opens the form. Either path ends the same way: the full prompt is prefilled into a new conversation for the user to read and send. A Benchmark without a baseline says so first.
- The card's overflow menu copies the Benchmark's directory path or, for the owner, deletes it after confirmation.
- Server: `POST /api/projects/:p/agents/:a/benchmarks` (owner only) writes `benchmark_config.toml`, a `scoreboard.yaml` holding `evaluations: []`, and each case's `statement/README.md` (the title as its heading) and `rubric/README.md`, answering 409 `benchmark_exists` for a taken id; `DELETE …/benchmarks/:id` removes the directory whole.
- The list only returns directories holding a `benchmark_config.toml`. Deleting a Benchmark while an evaluation is still running leaves a directory behind — the run keeps writing to the paths it was deleted from — and that debris no longer appears as a Benchmark with a placeholder title. A Benchmark that has never been evaluated has its config and still lists.
- The "Create with AI" bridge accepts a `modelRef`, which the Optimize dialog uses to pin the model of the optimizer's conversation.
- The Web App, server API and self-improvement docs describe the page and the routes in both languages.
