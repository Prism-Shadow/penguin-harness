---
title: Self-Improvement
description: The Skill-orchestrated Benchmark and optimization loop: score, improve, snapshot, roll back.
---

Self-improvement in PenguinHarness is not carried by special-purpose engine code — it is carried by Skills orchestrating the ordinary Agent machinery: evaluations are ordinary Sessions and optimization is ordinary file editing. Evaluation construction and optimization run in two independent top-level Sessions; only individual evaluations are delegated through the built-in `run_subagent` tool. The direct payoff is that the whole process shares the same observability and recovery machinery as everyday runs.

## Roles and call relationships

| Role | Responsibility |
| --- | --- |
| Builder | Top-level Agent that directly follows `agent-creation` and then `benchmark-design` |
| Target Agent | The Agent being improved; runs evaluation tasks only inside its own Workspace |
| Evaluator | Leaf worker created through `run_subagent`; runs and scores one Benchmark Case run |
| Optimizer | New top-level Agent that directly follows `agent-optimization` |

The Builder and Optimizer follow their Skills themselves instead of delegating those workflows to subagents. Only Evaluators are created through `run_subagent`; each follows `agent-evaluation` and uses the Penguin CLI to launch the specified Target Agent. The CLI does not create another Builder, Optimizer, or Evaluator.

## Two independent steps

The first top-level Session creates the Agent and its capability evaluation. The Builder first uses `agent-creation`, then uses `benchmark-design` to build a multi-Case Benchmark. The Pilot score is a desired target: meeting it permits an early Freeze; otherwise the Builder completes no more than five valid Pilot iterations and freezes the lowest-scoring valid revision. Freeze is followed by a fresh complete Formal matrix. Every valid Formal Baseline is recorded even when its score misses the desired target.

After the user confirms that step is complete, they start the second top-level Session in a new conversation. The Optimizer checks the Benchmark and its first complete Formal Baseline before following `agent-optimization`:

1. orchestrate Evaluators in parallel through `run_subagent`, covering the Case × runs matrix;
2. use scores and linked Traces to propose one bounded Candidate;
3. edit the Target Agent's editable state — `AGENTS.md`, Skills, config — to produce version N+1;
4. keep the Candidate only when its total score strictly improves; otherwise roll it back;
5. stop early when the desired score is reached, or complete no more than five valid Candidate rounds and retain the highest-scoring Reference.

Invalid evaluations and correction reruns do not count toward the five-round limit. Agent optimization requires a complete Formal Baseline in the Scoreboard — without one there is no improvement to compare against.

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
| `agent-optimization` | Improve an Agent from Benchmark results |

How Skills are organized and installed is covered in the [Skill System](/skills).
