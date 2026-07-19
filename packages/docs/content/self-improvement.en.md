---
title: Self-Improvement
description: The Skill-orchestrated Benchmark and optimization loop: score, improve, snapshot, roll back.
---

Self-improvement in PenguinHarness is not carried by special-purpose engine code — it is carried by Skills orchestrating the ordinary Agent machinery: evaluations are ordinary Sessions, optimization is ordinary file editing, and orchestration uses the built-in `run_subagent` tool. The direct payoff is that the whole process shares the same observability and recovery machinery as everyday runs.

## Three roles

| Role | Responsibility |
| --- | --- |
| Target Agent | The Agent being improved; runs evaluation tasks only inside its own Workspace |
| Evaluator | Runs and scores one Benchmark Case run |
| Optimizer | Drives the whole optimization loop |

The roles are defined by Skills, not hardcoded: the Evaluator follows the `agent-evaluation` Skill, the Optimizer follows the `agent-optimization` Skill. This applies the design principle stated in the [Configuration Reference](/configuration) — an Agent's behavior is editable files on disk, which is what makes Agents improvable by Agents.

## The loop

1. `benchmark-design` builds a multi-Case capability Benchmark: repeated independent runs, with a traceable baseline calibrated first;
2. The Optimizer orchestrates Evaluators in parallel via the `run_subagent` tool, covering the Case × runs matrix;
3. Scores plus their linked Traces show where points were lost;
4. The Optimizer edits the Target Agent's editable state — `AGENTS.md`, Skills, config — to produce version N+1;
5. A Snapshot is taken before each round; the candidate version is kept only if the total score strictly improves, otherwise rolled back.

Benchmark optimization mode requires a complete baseline series in the scoreboard — without a calibrated baseline there is no improvement to compare against. Besides this loop, `agent-optimization` also supports a one-shot feedback mode: a concrete correction is applied directly as edits to the Target Agent's state, without going through the evaluation loop.

## Benchmark storage

Benchmarks are stored per Agent under `benchmarks/<id>/`:

```text
benchmarks/<id>/
├── benchmark_config.toml       # Benchmark configuration (e.g. runs per Case)
├── <case-id>/
│   ├── statement/              # the task given to the Target Agent
│   └── rubric/                 # private scoring rubric, isolated from the Target Agent
└── scoreboard.yaml             # evaluation records (v2 format)
```

The separation of `rubric/` from `statement/` is deliberate: the Target Agent sees only the task statement and never touches the scoring rubric.

Each evaluation record in `scoreboard.yaml` (v2 format) is timestamped and carries:

- the paired model reference `(provider, model_id)` used for the round;
- `summary_title` and `summary` (the round's conclusion and the hypothesis for the next one);
- total score, cost, and duration — Case-level metrics are the average over its runs, evaluation-level metrics are the sum over its Cases;
- per-Case run details, each run recording `score`, `cost`, `duration_ms`, and `session_id`.

The built-in `default_agent` ships with an example Benchmark (`packages/core/src/state/example-benchmark.ts`) so the evaluation pages have data out of the box; the whole directory can be deleted or replaced at any time.

## Snapshots and versions

Before each optimization round, the Agent State is packed into `snapshots/v<version>.tar.gz` (excluding the Vault — secrets never enter a snapshot). The `version` in `system_config.yaml` increments on successful optimization. The Web UI supports exporting and importing snapshots; importing a version not higher than the current one requires explicit confirmation.

## Auditable end to end

- Every Evaluator run is an ordinary Session with a full Trace;
- Scoreboard records link back to those Sessions via `session_id`; see [Sessions & Traces](/sessions-and-traces);
- The Web evaluation pages are read-only views of these files; see the [Web App Guide](/web-app).

Scores are not black-box output: every number can be traced back to the run that produced it.

## Related Skills

| Skill | Purpose |
| --- | --- |
| `agent-creation` | Turn a requirement into a working Agent: write its `AGENTS.md`, install the Skills it needs |
| `benchmark-design` | Design and calibrate a multi-Case capability Benchmark |
| `agent-evaluation` | Run and score one isolated Benchmark Case run |
| `agent-optimization` | Improve an Agent from feedback or Benchmark results |

How Skills are organized and installed is covered in the [Skill System](/skills).
