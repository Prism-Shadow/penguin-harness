# ACE

RSI method from a paper titled as Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models

Use the common Agent Optimization contract and read
[ace-playbook.md](ace-playbook.md) for rule artifacts and paper differences.
This is offline FDE adaptation: fresh Students generate traces, Reflectors extract
lessons, a Curator consolidates deltas, and the Teacher publishes between batches.

## Method settings

| Setting | Default |
| --- | --- |
| `rounds`, `runs`, `concurrency` | 3 updates, 1 run per case/version, up to 5 concurrent cells |
| `training_feedback` | `score_only`, or `detailed` when requested |
| `read_train_rubric`, `read_train_gold` | Both false; independently configurable |
| `max_delta_entries` | 5 semantic rule changes per round |
| `max_entries`, `max_playbook_chars` | 40 active entries, 16000 Unicode characters including instructions |
| `wall_time_seconds` | 3600 for all roles and preparation |

Counts/time limits are positive integers. Target score is optional and does not
change the selection rule. Declare nonparametric Skill/context edits, offline
batch updates by Teacher, linear candidates and evidence/structure admission.
Only `STATE/skills/ace-playbook/` is behaviorally writable; State version and
snapshots are bookkeeping exceptions. Tools, hooks, model and reader remain fixed.

The launch cap is `(rounds + 1) × cases × runs`. Each update permits one Reflector
per case (all repeats together), one Curator, and at most one detailed-feedback
worker per consumed execution. Count all started/failed calls and keep within the
declared resource budget.

## Baseline and update

Create the empty playbook and fixed reader before baseline measurement. A Reader
repair is a new baseline, not a learned gain. Require one enterprise's explicit
training cases and a complete matching baseline at the same repeat count, or
collect it through Agent Evaluation if absent. Reject unrelated/conflicting
pre-existing playbook state; resume only from verified experiment records.

For each update:

1. Reflectors inspect successful and failed training traces, current rules and
   only authorized feedback. Return observed behavior, evidence, responsible
   decision, applicable conditions, proposed lessons and rule usefulness labels.
   Unknown causes stay hypotheses; workers cannot edit Student State.
2. The Curator merges lessons, resolves contradictions by condition, preserves
   supported behavior and proposes a bounded delta. It can inspect cited training
   evidence and may consolidate duplicates; it cannot use testing or rewrite the
   full playbook indiscriminately.
3. The Teacher validates parent version/hash, IDs, evidence, operations, limits
   and write set. Reject unsupported procedures, answer tables and runtime edits.
   Preserve unchanged rule text and feedback history. Publish the staged delta
   using the common version/snapshot contract after all workers finish.
4. Measure the candidate on the same full training matrix. If valid and complete,
   retain it even when score falls, append its evaluation and use its new traces
   next. ACE admits supported deltas, not only score improvements. Report score
   change and whether the intended behavior changed.

An invalid proposal ends with the last measured version. A no-op or full capacity
without supported consolidation also stops. Invalid candidate measurement uses
the common stop/rollback rules. Do not extend rounds after disappointing results.
Retain the latest valid measured playbook, its evidence and deltas; hand frozen
initial/final versions to the independent Reporter without further learning.
