---
title: Self-Improvement
description: The Skill-orchestrated evaluation, optimization, and promotion loop: score, improve, validate on held-out evidence, snapshot, and roll back.
---

Self-improvement in PenguinHarness uses Skills to orchestrate the ordinary Agent machinery: evaluations are ordinary Sessions, optimization is ordinary file editing, and promotion validation is a third independent top-level Session. Evaluation construction, optimization, and promotion validation run as separate phases, while individual evaluations are delegated through the built-in `run_subagent` tool. Top-level prompts provide the Agent, Benchmark, capability, score, and round settings for the task; Skills or the promotion workflow on this page own call relationships, calibration, Freeze, protocol, repair, rollback, and reporting.

## Roles and call relationships

| Role | Responsibility |
| --- | --- |
| Builder | Top-level Agent that directly follows `agent-creation` and then `benchmark-design` |
| Target Agent | The Agent being improved; runs evaluation tasks only inside its own Workspace |
| Evaluator | Leaf worker created through `run_subagent`; runs and scores one Benchmark Case run |
| Optimizer | New top-level Agent that directly follows `agent-optimization` |
| Promotion Validator | New top-level Agent after optimization; tests only whether the final Candidate passes a held-out promotion gate, then retains or restores Agent State |

The Builder and Optimizer directly follow their Skills in their own top-level Sessions. The Promotion Validator runs in a third top-level Session; for now it orchestrates `agent-evaluation` under the contract on this page and never returns held-out evidence to the Optimizer. Once stable, this contract may be extracted into an `agent-promotion` Skill. Evaluators are created through `run_subagent`; each follows `agent-evaluation` and uses the Penguin CLI to launch the specified Target Agent in an isolated Workspace identified by an absolute path. The Penguin CLI launches the Target Agent for the requested Case run.

## Three independent phases

PenguinHarness currently has no online traffic, real-user feedback, or other continuous production signal serving as a fitness function; Benchmarks are the complete measurement boundary for self-improvement. Production versions therefore advance in batches. The Optimizer may propose and evaluate Candidates continuously inside one batch, but only the batch's single final nominee may enter an independent promotion gate. Under this constraint, “continuous online climbing” merely shrinks a batch to one change and removes its promotion gate; it does not provide a different or more continuous source of capability evidence.

With only the first two phases, the Optimizer uses a Development Benchmark's scores and Traces both to propose Candidates and to decide which Candidate to retain. Freeze prevents the tasks and scoring standard from drifting during optimization, but it does not prove that gains after repeated adaptation transfer to tasks that did not participate in diagnosis. A strictly higher development score means only “better on this Development Benchmark”; it is not by itself a production-promotion decision.

The third phase separates those decisions. The Development Benchmark decides whether a Candidate is worth retaining during optimization; a held-out Promotion Benchmark decides whether the final Candidate may replace the pre-optimization production Reference. The Promotion Benchmark's Cases, Rubrics, scores, and Traces never enter the original Optimizer Session. After a failed promotion, held-out failures must not be fed back to the same Optimizer for another tuning round, or the held-out suite becomes another development set.

### Phase 1: Establish Development and Promotion Benchmarks

Before optimization begins, one or more top-level Builder Sessions establish two ordinary Benchmarks for the same Target Agent: a Development Benchmark for diagnosis and Candidate selection, and a held-out Promotion Benchmark used only for final promotion. Both are calibrated and frozen normally through `benchmark-design`, both receive their own Formal Baseline, and both are bound to the same pre-optimization Agent State version and evaluation Runtime. Only the Development Benchmark id may appear in the Optimizer request or context; the Promotion Benchmark id, Cases, Rubrics, scores, and Traces must not be provided to the Optimizer.

The Builder first uses `agent-creation`, then uses `benchmark-design` to build a multi-Case Benchmark. It may build the complete initial Case set before Pilot 1 and may refine multiple Cases or difficulty dimensions in a later iteration. The evaluation contract and private standard must be clear and fixed, while the public Statement need not uniquely determine the Gold. A Benchmark may use incomplete public information, conflicting signals, and a fixed private decision standard when that standard expresses a reusable policy, priority, or inference boundary and is not rewritten after seeing the run's answer.

Before the first dispatch of every new or changed Case, the Builder checks that the Statement is internally coherent, the Rubric agrees with the current Statement and fixed private standard, and every scoring item relies only on defined, provided, or explicitly private premises; this does not require the public materials to reproduce the private standard. It repeats the full review across all Cases before Freeze. Most points should rest on decisions or concise artifacts for which the intended behavior and a plausible shortcut produce different results, rather than giving a high floor for format, evidence enumeration, or analysis completeness.

Before each calibration dispatch, the Builder predicts the result produced by the observed Trace strategy, the different result produced by the desired behavior, and the score range affected. Adding another public rule, exception, source, or check that the model can directly execute does not automatically increase difficulty. If both strategies still reach the same scored result, the Builder chooses another refinement.

Every Pilot iteration runs each Case exactly once. The Pilot score is a desired target: meeting it permits an early Freeze; otherwise the Builder completes the configured number of valid Pilot iterations and freezes the lowest-scoring valid revision. The Builder temporarily retains only the current lowest valid revision and its complete result. After the final consistency review, it records that selected Pilot's one-Run result directly as the Formal Baseline without rerunning or backfilling more Runs, then removes the temporary copy and other calibration scaffolding. A Formal score that misses the desired target does not invalidate the Benchmark.

### Phase 2: Optimize on the Development Benchmark

After the user confirms that step is complete, they start the second top-level Session in a new conversation and specify `runs` per Case for every Candidate. The Optimizer checks the Benchmark and its first complete Formal Baseline before following `agent-optimization`:

1. orchestrate Evaluators in parallel through `run_subagent`, covering the Case × user-specified `runs` matrix;
2. use scores and linked Traces to propose one bounded Candidate;
3. edit the Target Agent's editable state — `AGENTS.md`, Skills, config — to produce version N+1;
4. keep the Candidate only when its Evaluation score strictly improves; otherwise roll it back;
5. stop early when the desired score is reached, or complete the configured number of valid Candidate rounds and retain the highest-scoring Reference.

Invalid evaluations and correction reruns do not count toward the round limit. On an execution failure, the Optimizer keeps the same Candidate and repairs only the missing cell; it keeps trying while each attempt follows a new diagnosis and applies a distinct safe repair. Both Builder and Optimizer validate that the complete Evaluator response is plain protocol YAML before reading status or score; if formatting is invalid, that same Evaluator resends from its existing result without rerunning the Target Agent.

Every accepted Candidate is appended to and verified in the Scoreboard immediately. A strictly higher Evaluation score decides acceptance; the first comparison directly compares the Candidate's multi-Run average with the Formal Baseline's one-Run score without backfilling the Baseline. Whether the predicted Case behavior changed is reported separately so unrelated single-run variation is not presented as causal evidence. Agent optimization requires a complete Formal Baseline in the Scoreboard — without one there is no improvement to compare against.

An **Optimization Batch** is exactly one independent top-level Optimizer Session. It starts from a promoted `production_reference_version`, uses only Development evidence, executes the configured Candidate rounds, and nominates one final version when the Session ends. Changing the Candidate, opening another Promotion Session, or switching among intermediate References saved by that same Optimizer Session does not create a new batch. Use the top-level Optimizer Session id as `optimization_session_id` for phase-3 binding and audit.

The highest-scoring Reference retained when the Optimizer stops is only a **Development-accepted Candidate**. It is already the active Agent State, but it must not be reported as production-promoted until it passes phase 3. The Optimizer's final report must include `optimization_session_id`, the pre-optimization `production_reference_version`, final `candidate_version`, Development Benchmark id, evaluation Runtime, and the recovery archive `snapshots/v<production_reference_version>.tar.gz`. Promotion validation must not begin without a verifiable production Reference Snapshot.

### Phase 3: Decide promotion on the held-out Benchmark

Start a new top-level Promotion Validator Session and give it only the Target Agent, `optimization_session_id`, final `candidate_version`, pre-optimization `production_reference_version`, Promotion Benchmark id, and the evaluation Runtime stored by that Benchmark's Formal Baseline. It must not inspect the Development Benchmark, the original Optimizer's diagnosis, or private Traces, and it must not modify the Candidate.

Before dispatching the first held-out cell, the Promotion Validator must ensure that `snapshots/v<candidate_version>.tar.gz` exists, its archived version matches the current Candidate, and no existing same-version Snapshot was overwritten. This Snapshot preserves the exact state of a failed Candidate for diagnosis and reconstruction by a later batch; it must not let the old Candidate bypass new Development evaluation and be nominated directly. Stop before any held-out evaluation if the Snapshot cannot be created or validated.

The Promotion Validator completes one one-Run-per-Case matrix on the held-out Promotion Benchmark, symmetric with its Formal Baseline. Every cell is still delegated to `agent-evaluation`; Agent State version, `provider`, `model_id`, and `thinking_level` must all match. A wrong answer is a valid low score. Protocol, launch, version, Benchmark, or Trace-binding failures are not zero scores and must be repaired or reported as validation failures. If any cell returns `isolation_violated`, accept only that content-free failure category; do not read the violated path, content, or contaminated Trace, score or retry the cell, or continue filling the matrix.

The Candidate passes promotion if and only if the matrix is complete and valid, the Candidate remains unchanged throughout evaluation, and its held-out top-level average is no lower than the latest valid Evaluation for `production_reference_version` in the Promotion Scoreboard. On the first promotion that comparison target is the Formal Baseline; afterwards the current production version's held-out record is the Evaluation written when it was itself promoted. The symmetric one-Run matrix bounds cost but keeps run-to-run noise — a known trade-off, and the reason the gate is no-lower-than rather than strictly-higher. Whether promotion passes or fails, first append the complete held-out Evaluation and Session ids to the Promotion Benchmark's own Scoreboard and verify the write, then retain or restore. Write `evaluation_kind: promotion_candidate`, `optimization_session_id`, `production_reference_version`, and `promotion_decision` (`promoted` or `restored`) as structured fields; keep `summary_title` and `summary` as human-readable conclusions.

- **Pass:** retain the current Candidate Agent State and report promotion from `production_reference_version` to `candidate_version`.
- **Fail:** restore and verify `production_reference_version` from the pre-optimization Snapshot. Retain Development Benchmark scores and Traces, together with the Candidate Snapshot saved before the gate, as experimental evidence and diagnosis input for later batches.
- **Isolation violation:** terminate the current promotion attempt and its Optimization Batch; immediately restore and verify `production_reference_version`, quarantine the contaminated Trace, and never record it as a score or optimization evidence.
- **Validation cannot complete:** do not treat missing or invalid cells as zero and do not claim promotion; report the concrete blocker until validation or safe restoration can complete.

The promotion decision ends phase 3. Each `optimization_session_id` may bind at most one `candidate_version` and one promotion matrix; protocol correction, repair of a cell that never started, and resumption of the same incomplete matrix for that Candidate remain part of the same promotion attempt. Once a complete valid matrix decides pass or fail, do not re-nominate a sibling Candidate from the same batch — successive re-nomination lets the held-out suite select among versions, and the eventual winner's score is systematically optimistic. The next promotion must come from a new top-level Optimizer Session. Never return held-out Case-level failures, Traces, Rubrics, or the promotion result to the original Optimizer to generate another Candidate. If the team starts adjusting the Agent from this evidence, including strengthening the Agent's Workspace boundary after `isolation_violated`, the current Promotion Benchmark has become development evidence; build and freeze a new held-out Benchmark for the next independent promotion instead of fixing the Agent and retesting it on the old held-out suite. Long-term rotation of a fixed held-out suite belongs to the later successor-Benchmark outer loop; the current workflow does not prescribe a numeric use limit.

## Benchmark storage

Benchmarks are stored per Agent under `benchmarks/<id>/`:

```text
benchmarks/<id>/
├── benchmark_config.toml       # Benchmark configuration (Builder runs is fixed at 1)
├── <case-id>/
│   ├── statement/              # the task given to the Target Agent
│   └── rubric/                 # private scoring rubric, isolated from the Target Agent
└── scoreboard.yaml             # evaluation records (current format)
```

The separation of `rubric/` from `statement/` is deliberate: the evaluation protocol gives the Target Agent only the task statement, and the Evaluator must reject a run whose root or directly referenced child Traces show direct or indirect access to Benchmark or Rubric data. Directory separation alone is not proof that the Target never touched the scoring rubric.

In the current workflow, Development and Promotion remain two ordinary `benchmark_id` values under the same Agent. Optional `role = "development" | "promotion"` and `paired_benchmark_id` fields in `benchmark_config.toml` explicitly identify the workflow relationship; missing roles remain backward-compatible as `general`. These fields support API, UI, and workflow orchestration only and are not access controls. This separation remains a **contract-level soft seal**. Skills forbid the Target Agent and Optimizer from reading private or unspecified Benchmark surfaces, but local tools do not technically confine absolute-path access to the intended directory. Ordinary product workflows maintain the boundary through independent top-level Sessions, minimal inputs, and Target/Evaluator/Optimizer Trace auditing. A formal non-leakage claim additionally requires auditing direct and indirect file access in these root and referenced child Traces or placing private and Promotion data behind a boundary those Sessions cannot technically access.

Each evaluation record in `scoreboard.yaml` is timestamped and carries:

- the evaluation runtime: a user-specified `(provider, model_id)` pair takes priority, otherwise the pair is inherited from the Builder Session; `thinking_level` is read from the Target Agent config and does not depend on Trace metadata;
- optional workflow metadata: `evaluation_kind` (Formal Baseline, Development Candidate, or Promotion Candidate), `optimization_session_id`, `production_reference_version`, and `promotion_decision` on Promotion records; old records may omit these fields;
- `summary_title` and `summary` (the round's conclusion and the hypothesis for the next one);
- Score, cost, and duration averages written by the model — Case-level values average Runs and Evaluation-level values average Cases; Run cost preserves its recorded precision, cost averages ignore `null` inputs and remain `null` only when every contributing cost is unknown; Score uses two decimals, cost averages use six decimals, and `duration_ms` is an integer;
- per-Case run details, each run recording `score`, `cost`, `duration_ms`, and `session_id`.

Every Run and every Case has a fixed maximum Score of 100, so Scoreboard entries do not carry `max_score`. The server and Web UI trust the stored aggregate values and do not recompute or cross-check them. Old Scoreboard formats are not migrated or backfilled.

The built-in `default_agent` ships with an example Benchmark (`packages/core/src/state/example-benchmark.ts`) so the evaluation pages have data out of the box; the whole directory can be deleted or replaced at any time.

## Snapshots and versions

Before each optimization round, the Agent State is packed into `snapshots/v<version>.tar.gz` (excluding the Vault — secrets never enter a snapshot). The `version` in `system_config.yaml` increments on successful optimization. The Web UI supports exporting and importing snapshots; importing a version not higher than the current one requires explicit confirmation. On a phase-3 failure, restore the `production_reference_version` from before the entire Optimization Session, not the intermediate Reference before the final Candidate round; then reread and verify the Agent State version and files. Restoration does not recycle version numbers: every version already written to any Scoreboard or `snapshots/` is consumed. The next Optimization Session after a failed promotion must number Candidates from one above the highest recorded version, even though the restored production version is lower — otherwise the old and new lines share a version number in the Scoreboard and the failed line's same-named snapshot gets wrongly reused. The Candidate numbering rule in `agent-optimization` encodes this convention.

## Auditable end to end

- Every Evaluator run is an ordinary Session with a full Trace;
- Scoreboard records link back to those Sessions via `session_id`; see [Sessions & Traces](/sessions-and-traces);
- The Web evaluation pages read these files directly; the trend chart shows Score only, while the detail table separates workflow status, model ID, and thinking level. A Development header distinguishes active from production versions. When structured metadata shows a pending gate, “Start promotion validation” only pre-fills and opens a new top-level Session; the frontend does not mutate Agent State or the Scoreboard itself. See the [Web App Guide](/web-app).

Scores are not black-box output: every number can be traced back to the run that produced it.

## Related Skills

| Skill | Purpose |
| --- | --- |
| `agent-creation` | Turn a requirement into a working Agent: write its `AGENTS.md`, install the Skills it needs |
| `benchmark-design` | Design and calibrate a multi-Case capability Benchmark |
| `agent-evaluation` | Run and score one isolated Benchmark Case run |
| `agent-optimization` | Improve an Agent from Benchmark results |

The current Promotion Validator does not yet correspond to another built-in Skill. It follows the phase-3 contract on this page to orchestrate existing `agent-evaluation` workers, write the held-out Scoreboard, and restore the production Reference through existing Snapshots after a failure. Once this workflow is stable, it may be extracted into `agent-promotion` without adding a new core runtime mechanism.

How Skills are organized and installed is covered in the [Skill System](/skills).
