# AWM

RSI method from a paper titled as Agent Workflow Memory

Use the common Agent Optimization contract and read
[awm-workflow.md](awm-workflow.md) for the workflow artifact and paper mapping.
Offline AWM learns reusable parameterized subroutines from successful experiences,
then freezes them for testing. Experience admission and batch collection here are
declared adaptations, not a reproduction of the paper's numerical results.

## Method settings

| Setting | Default |
| --- | --- |
| `rounds`, `runs`, `concurrency` | 1 induction round, 1 run per case/version, up to 5 concurrent cells |
| `success_signal` | `public_judge`, optionally `training_score` |
| `success_score` | 100 when using `training_score` |
| `read_train_rubric`, `read_train_gold` | Both false; independently configurable |
| `max_new_workflows` | 5 per batch |
| `workflow_limit`, `workflow_words` | 20 active workflows, 400 words per workflow body |
| `wall_time_seconds` | 3600 including all roles and preparation |

Counts/time limits are positive integers; threshold is finite in `0..100`.
A lower threshold admits partial successes and must be labelled. Extra rounds
extend the paper-inspired offline pass. Do not switch admission signals after
seeing which one admits more traces. Target score does not change this policy.

Declare nonparametric Skill/memory artifacts, offline batch Teacher updates,
linear candidates, successful-experience plus artifact-validity admission. Own
`skills/awm-index/` and exactly the workflow directories in the experiment manifest.
Allocate unused `awm-<number>` IDs; never overwrite an unrelated Skill. State
version and snapshots are bookkeeping. Other State, tools, hooks and model stay fixed.

Budget `(rounds + 1) × cases × runs` Student starts. Each consumed trace permits
one public success judge if selected; each round permits one inducer and one
consolidator. Extra workers/calls require a declared budget, not hidden retries.

## Baseline and induction

Prepare the empty public workflow index and fixed reader before measuring H1.
Use one enterprise's training cases. Collect a full baseline via Agent Evaluation
unless an exact matching baseline already exists, with the same case set/repeats.
Preserve previous experiment records; do not silently import an old learned
library into an empty baseline or claim pre-reader scores tested this harness.

For each round:

1. Classify current batch experiences. A public judge sees only task, observed
   trace and outputs, returning success/failure/uncertain with evidence. It never
   sees private scores, rubric or gold. With `training_score`, use the declared
   threshold on delegated results instead. Uncertain traces are not admitted.
2. Give the inducer admitted successful traces, current workflows and explicitly
   permitted training information. Gold/rubric can explain a success, but cannot
   turn a failed execution into a claimed demonstrated workflow. Failed traces
   remain in the report; they do not seed recipes.
3. Extract at most `max_new_workflows` subroutines with inputs, preconditions,
   observations, actions, checks and failure boundaries. Parameterize instance
   IDs/paths/dates while preserving business policy scope. Every procedural claim
   must be supported by a successful trace, not invented or copied from an answer.
4. A consolidator verifies evidence, deduplicates, resolves dependencies and
   proposes complete files plus an index. Revise existing workflows only with
   supported successful evidence. Cycles, collisions, unsupported steps or size
   overflow reject the proposal. Workers never publish.
5. The Teacher checks exact write sets, stages the valid library/index, and
   publishes one new State version after all workers finish. Measure it on the
   same full training matrix and verify actual workflow-file reads. Keep a valid
   measured version even if its score falls; AWM has no strict-score gate.

No successful/useful experience, no-op, capacity without supported refinement or
invalid proposal ends with the last measured version. Invalid measurement uses
the common recovery rules. Do not regenerate wrong answers to create success
outside the declared matrix. Keep an empty learned library when that is the result.

Report admission signal, supervision, source experiences, learned/reused workflow
IDs, actual reads, scores and regressions. Freeze the latest valid measured
library and hand it to an independent Reporter; testing has no success judge,
induction or persistent writes.
