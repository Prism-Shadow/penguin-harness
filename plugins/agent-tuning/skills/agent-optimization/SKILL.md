---
name: agent-optimization
description: Apply an RSI method to a Target Agent using training traces, with Penguin as the default and other method recipes in references.
---

# Agent Optimization

Act as the Optimizer: analyze training traces and improve the Target Agent
using the selected RSI method. This Skill specifies inputs, evaluation, versions
and output formats; each reference supplies a method recipe. Use Penguin by
default or select another recipe. Read only the selected method and keep its
selection policy intact.

The Target Agent is also called the Test Agent in Agent Tuning. The Optimizer
performs optimization; the Evaluator runs and scores each case. These are roles,
not dedicated built-in Agent identities.

## Before you start

Resolve an existing Test Agent, a published frozen training Benchmark and the
method. Ask for missing required inputs; do not ask again for information already
provided. With no method specified, use Penguin, preserving the ordinary
optimization entry point. Select names case-insensitively.

Available recipes are indexed below; this list can grow without changing the
evaluation protocol.

| Method | Reference | Source |
| --- | --- | --- |
| Penguin (default) | [penguin.md](references/penguin.md) | Penguin's existing optimization method |
| ACE | [ace.md](references/ace.md) | RSI method from a paper titled as Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models |
| AWM | [awm.md](references/awm.md) | RSI method from a paper titled as Agent Workflow Memory |

If another method is requested, resolve its supplied instructions or ask which
method to implement; do not silently substitute Penguin. Method-specific inputs
and defaults come from the reference. Initialization and benchmark construction
belong to `agent-initialization`, `benchmark-design` or `benchmark-reproduction`;
perform them first only when requested and allowed by the selected method.

## Inputs and run declaration

| Input | Contract |
| --- | --- |
| `test_agent_id` | Experimental Target Agent whose Harness is optimized |
| `benchmark_id` | Frozen training Benchmark; `train_benchmark_id` is an accepted alias, conflicting values are invalid |
| `case_ids` | Explicit training subset, or all cases; `train_case_ids` is an accepted alias |
| `method` | Penguin by default; otherwise the named reference/instructions |
| `runs`, `rounds`, `target_score` | Values required or defaulted by the method; record its baseline repeat policy too |
| Runtime | Complete Target Agent provider/model pair and configured thinking; Optimizer/Evaluator settings recorded separately |
| Test handoff | Optional separate testing Benchmark/cases for an independent Reporter after final freeze |

Resolve paths only from Environment App Data Dir and these IDs:

```text
TARGET = <app_data_dir>/agents/<test_agent_id>
STATE = <target>/agent_state
TRAIN = <app_data_dir>/benchmarks/<benchmark_id>
SNAPSHOTS = <target>/snapshots
OUT = <Optimizer workspace>/optimization/<experiment_id>
```

Reject traversal, symlink escape, conflicting IDs and concurrent edits to one
Target Agent State. OUT must be outside Target Agent State and task workspaces. Before any
run, write `OUT/experiment.yaml` with the resolved method, IDs, case set, data/State
hashes, runtime, budgets and the following declarations:

- `artifact`, `source`, `feedback`, `updater`, `frequency`, `topology`, `selection`,
  `mode`, `scope`: method characteristics, following Awesome-RSI's dimensions.
- Exact writable paths and separately permitted training scores, item feedback,
  Rubric and gold. A capability in a taxonomy is not blanket read/write permission.
- Baseline source/repeats, proposal and evaluation budgets, stopping conditions,
  and the method's final-version rule. Testing never selects versions.

Use an existing matching evaluation to resolve Target Agent runtime when the method
requires one. Otherwise accept an explicit complete provider/model pair, or
inherit both from the Optimizer Environment. Read thinking from the full Target Agent
config, defaulting to medium only if absent. Freeze this runtime for comparisons;
record any unequal sampling or method adaptation rather than hiding it.

## Common execution boundaries

`Optimizer = Optimizer Model + Optimizer Harness`;
`Target Agent = Target Harness + Target Model`.
Both models and the Optimizer Harness normally stay fixed. The
Target Harness is the optimization target. Target Agents have fresh contexts and
solve only their tasks; no persistent self-editing during execution. Analysis
workers propose changes, and the Optimizer publishes after all batch workers end.

Keep each batch's State, cases and runtime immutable. Hash all persistent State
except the vault before/after execution, including memory/tools/hooks. A workflow
may use multiple Optimizers or Target Agents without sharing their task conversations.
Rules learned from trace data need case/session evidence and applicable conditions.
Allowed training gold may support business rules, not case-answer lookup tables.

Only read selected training evidence and authorized feedback. Do not inspect
Evaluator private reasoning, other Agents, credentials or testing contents. For
detailed feedback, use a separate authorized training-feedback worker on the same
saved prediction and frozen scorer; do not rerun the Target Agent to obtain feedback.
Record what this feedback exposes and verify its score agrees with the evaluation.

Every scored cell goes through `agent-evaluation` in a fresh worker. The Optimizer
does not run or score the Target Agent directly. Use its unchanged request:

```text
protocol_version: 1
case_id: <case_id>
run: <one_based_run_index>
expected_version: <target_state_version>
test_agent_id: <test_agent_id>
benchmark_id: <benchmark_id>
provider: <target_provider>
model_id: <target_model_id>
```

Ask the evaluator to pass configured Target Agent thinking explicitly when launching
the Target Agent; for stored `none`, omit the unsupported flag and clear only
`PENGUIN_SESSION_ID` for that command, keeping explicit identity/model/workspace
flags and connection/auth environment. Use the benchmark's Runtime instructions
when present. Keep `--source benchmark` and bind the actual Target Agent trace.

Require one plain protocol YAML response and matching case/run/Agent/version/runtime,
finite `0..100` score, nullable cost, duration and session ID. A formatting repair
resends the saved result from the same worker without execution or rescoring.
Wrong/missing answers are scored behavior; infrastructure failure is not zero.
Require a nonempty unique case set and positive integer run/round/concurrency
values after applying method defaults. Optimizer and Evaluator runtimes default to the
controller unless explicitly overridden; record their requested and actual
identity separately, not from the Target Agent fields in the evaluator result.
Stop on `version_changed`, `benchmark_invalid`, runtime mismatch or unrepairable
evaluation failure. Repair an unstarted launch only with evidence, a specific
correction and remaining budget; never repeat a completed Target Agent for a better score.

## Version and output contract

Before changing a measured State, create or verify `snapshots/v<N>.tar.gz`, excluding
`.vault.toml`. Never overwrite a snapshot or reuse a rejected candidate number.
Record original bytes and created files, stage only allowed edits, publish while
all workers are idle, and increment the integer State version. Custom Skills use
`YYYY.MM.DD.N` versions as Agent Initialization specifies. Model settings stay fixed.

Apply the reference's accept/retain rule. If rollback is required, restore only
recorded files/version and remove only candidate-created files after workers stop.
If another process changed State, stop without overwriting it. Keep proposals,
raw cells, accepted/rejected versions, evidence, costs and failures in OUT.

Append complete retained evaluations under `TRAIN/scoreboard.yaml`'s `evaluations`
list using the established shape below. Partial/invalid or rejected matrices stay
in OUT. Do not change the schema to carry method-specific fields.

```yaml
- time: <actual UTC timestamp>
  agent_id: <test_agent_id>
  version: <measured State version>
  provider: <actual provider>
  model_id: <actual model>
  thinking_level: <configured thinking>
  summary_title: <public conclusion>
  summary: <public change and result>
  score: <mean of case scores>
  cost: <mean of known case costs or null>
  duration_ms: <mean case duration>
  cases:
    - case: <case_id>
      score: <mean of run scores>
      cost: <mean of known run costs or null>
      duration_ms: <mean run duration>
      runs:
        - score: <0_to_100>
          cost: <number_or_null>
          duration_ms: <integer>
          session_id: <Target Agent session ID>
```

Write run means per case and case means overall. Ignore null costs in means;
all unknown is null. Score means use two decimals, cost means six and duration
means integer milliseconds; preserve recorded run cost precision. Parse the full
scoreboard and verify identity, version, matrix and session references. Do not add
`max_score`, `aggregate` or another runtime that recomputes stored averages.

Finish with the retained State path/version/hash, snapshot, method and supervision,
baseline/candidate measurements, accepted/rejected decisions, evidence references,
all-role total cost, stop reason and limitations. Never report a score for an
unevaluated State. Scoreboard averages are not total experiment costs.

For independent testing, hand initial/final snapshots and matched runtime/repeats
to a separate Reporter. It restores each on an idle experimental Target Agent, runs
the declared testing matrix without learning, records test scores separately and
restores the final State. No testing feedback returns to the Optimizer or causes
more training. Without that handoff, report training results only.

These are Skill-level role boundaries, not guaranteed sandbox enforcement.
Root Agent is a proposed independent supervisory role, not another name for
`default_agent` or a root Session. Do not make the Optimizer its own supervisor
or claim an observer/control capability that is not available.
