---
name: agent-optimization
description: Apply an RSI method to a Target Agent using training traces, with Penguin as the default and other method recipes in references.
---

# Agent Optimization

If an applicable reference conflicts with this SKILL.md, follow the reference
because it is more specific. Within its scope, a method or benchmark recipe also
takes precedence over Penguin defaults; user instructions take precedence over
both. Read only applicable references, record overrides, and report any behavior
that Penguin's actual interfaces cannot support.

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

Record hashes or copies of the Skills/references actually loaded, including any
controller instructions that override them. Keep instruction revisions fixed
within an experiment; a later repair does not retroactively validate its traces.
Feedback permissions apply per role: receiving a score in an Evaluator response
counts as seeing it even when it is excluded from an inducer's prompt. If the
Optimizer itself must be score-blind, use a separate controller to collect scored
results and give the Optimizer only its permitted evidence.

Resolve feedback permissions before opening any case material. With
`read_train_rubric: false`, the Optimizer must not open `rubric/README.md`,
`scoring.json`, grader code or private control logs, even to prepare a launch.
The Evaluator reads Runtime instructions privately. Hashing files for identity
may return digests, but must not expose their contents. If forbidden information
enters Optimizer context, stop that run and mark it contaminated; changing the
permission afterward cannot make it valid. A repaired run starts in a fresh
Optimizer context from a verified uncontaminated snapshot.

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

For raw JSONL traces, `session_meta.payload` identifies the execution.
`model_msg.payload.type` distinguishes `text`, `thinking`, `tool_call` and
`tool_call_output`; parse a tool call's `arguments` JSON and match its output by
`tool_call_id`. Cite actual actions and outputs, not a claimed action in thinking
or a forbidden path merely mentioned in authored text. Session `token_usage`
records token counts; they do not establish a monetary cost.

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

Require the Evaluator to use the selected evaluation references for the exact
Target runtime, launch and trace binding, plus this Benchmark's Runtime
instructions. Do not substitute Optimizer or Project defaults for Target settings.

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
Build and verify an archive in temporary storage before publishing it at that
path. Keep archive and content hashes separately; repacking the same content
still changes a published archive and must be recorded as a protocol deviation.
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
Concurrent writers use the same `scoreboard.yaml.lock`: acquire it once, reread
and parse the latest YAML, append the evaluation object, then atomically replace
the file. Do not concatenate YAML text or nest a second lock on the same file.
Preserve unrelated rows inside the append operation without printing them or
their summaries into a role that may not read other experiments. Display only
the authorized records and append verification.

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
For each update, report changed files and rules/workflows, source trace evidence,
the predicted behavior and the observed behavior. Distinguish a file being read,
a rule being followed and a score improving; none proves the next. Include
per-case regressions and unsupported hypotheses, not just an aggregate delta.
If no new version is produced, report one measured State; reusing its score is
not an independent before/after comparison.
Use observed UTC timestamps, never a guessed completion time. Report cost coverage
and the accounting cutoff; a running role's cost is a partial snapshot.

Keep an append-only record of failures, interventions and repairs: evidence,
affected sessions/versions, what changed, why, the lesson and verification status.
Separate score reproducibility, protocol compliance and learning benefit. State
audit coverage and unresolved checks instead of calling unchecked runs clean.
Keep each replacement linked to its original logical cell, invalidated attempt,
authorization and changed instructions. One retained score does not mean one
Target start; report both counts. A replacement must pass the full applicable
contract, not just the check that failed previously.

For independent testing, hand initial/final snapshots and matched runtime/repeats
to a separate Reporter. It restores each on an idle experimental Target Agent, runs
the declared testing matrix without learning, records test scores separately and
restores the final State. No testing feedback returns to the Optimizer or causes
more training. Without that handoff, report training results only.
If method instructions are revised after examining testing traces or scores,
record that exposure. Those cases can support regression checks, but a new claim
of held-out improvement needs testing data not used to develop the revision.

These are Skill-level role boundaries, not guaranteed sandbox enforcement.
A dedicated Supervisor may be created by `default_agent` or another orchestrator
to observe the experiment continuously in a separate context. It need not be the
root Session or a built-in Agent type. Keep supervision separate from optimization;
record which observation and stop controls are actually available, and distinguish
live monitoring from an audit performed after execution.
