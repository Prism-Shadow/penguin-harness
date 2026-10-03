# AWM

RSI method from a paper titled as Agent Workflow Memory

Follow the inputs, evaluation and output rules in `agent-optimization`.
This reference defines optimization, workflow format and paper differences;
baseline setup is linked under Fixed reader and public index.
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

Declare nonparametric Skill/memory artifacts, offline batch Optimizer updates,
linear candidates, successful-experience plus artifact-validity admission. Own
`skills/awm-index/` and exactly the workflow directories in the experiment manifest.
Allocate unused `awm-<number>` IDs; never overwrite an unrelated Skill. State
version and snapshots are bookkeeping. Other State, tools, hooks and model stay fixed.

Budget `(rounds + 1) × cases × runs` Target Agent starts. Each consumed trace permits
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
   Check substantive requirements against observed inputs and outputs, not just
   schema validity, a self-check or the Target's completion claim. If an unresolved
   conflict could change a required result, return uncertain. Distinguish harmless
   wording freedom from uncertainty about the business decision.
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
5. The Optimizer checks exact write sets, stages the valid library/index, and
   publishes one new State version after all workers finish. Measure it on the
   same full training matrix and verify actual workflow-file reads. Keep a valid
   measured version even if its score falls; AWM has no strict-score gate.

For every workflow step, keep its supporting trace action/output in OUT and check
that its preconditions hold there. A successful task label does not validate every
step in that trace. Do not generalize an unresolved assumption, a copied draft
value or agreement with a supplied candidate answer into an authoritative rule.
Omit unsupported steps; if the remaining subroutine has no demonstrated completion
check, reject it. A public judge's verdict remains evidence under that signal,
not a claim of gold correctness.

For `public_judge`, numeric scores may be collected for reporting, but must not
reach the judge, inducer or consolidator or affect admission. Declare separately
whether the Optimizer sees them; do not label the entire experiment score-blind
when only the analysis workers are. If score-blind optimization is requested,
follow the separate-controller handoff in the common Skill.

No successful/useful experience, no-op, capacity without supported refinement or
invalid proposal ends with the last measured version. Invalid measurement uses
the common recovery rules. Do not regenerate wrong answers to create success
outside the declared matrix. Keep an empty learned library when that is the result.
When admission is empty, skip induction and consolidation. Count trace-content
reads separately from file-existence checks; neither an empty proposal nor a
planned read proves a trace was inspected.

Report admission signal, supervision, source experiences, learned/reused workflow
IDs, actual reads, scores and regressions. Freeze the latest valid measured
library and hand it to an independent Reporter; testing has no success judge,
induction or persistent writes.

## Workflow artifact

Each `STATE/skills/awm-<id>/SKILL.md` contains a concise, independently usable
subroutine. This is an illustrative shape, not a script:

```markdown
---
name: awm-0001
description: Reconcile keyed records from two public files when stable record IDs and a conflict rule are available.
version: <YYYY.MM.DD.N>
---

# Reconcile keyed records

Inputs: left_path, right_path, id_field, conflict_rule, output_path.
Preconditions: both inputs can be parsed; id_field exists; the caller supplies the
conflict rule. Ask for the rule when it is missing rather than inventing one.

1. Observe each input's fields and record IDs. Check uniqueness before selecting a
   keyed merge; preserve duplicate records for explicit resolution.
2. Bind the public conflict rule and merge corresponding records with ordinary
   file tools. Do not assume that file order encodes recency.
3. Write output_path and verify every output ID against the inputs and rule.

Completion: the requested output exists and the reconciliation checks are recorded.
Failure boundary: missing IDs or an undefined conflict rule require clarification.
```

Only induce a workflow like this when its actual steps appear in a successful
training trajectory. The example grants no evidence for installing it. Store
case/session provenance in Optimizer OUT; keep only public descriptions, hashes and
dependencies in the Target Agent's `awm-index/workflows.json`.
For an observation/action workflow include, per step:

| Field | Required content |
| --- | --- |
| Observation | What the Target Agent can verify in the current environment. |
| Decision | Why the next action follows from that observation, without invented hidden reasoning. |
| Action | An available tool operation with parameter bindings. |
| Check | Evidence needed before proceeding or declaring completion. |

Keep parameters explicit; a path or selector from an old task is not a default for
a new task. A workflow may compose an existing workflow by ID with explicit inputs
and completion checks, but circular dependencies invalidate the proposal.

## Fixed reader and public index

Before H1, follow [the AWM initialization reference](../../agent-initialization/references/awm.md)
for the empty method artifacts and fixed reader. Verify those artifacts when
resuming; do not reinstall or change the reader during measured training.

Require a trace-visible file read before claiming a workflow was used. An empty
index or no matching workflow is valid. If the reader itself needs repair, start
a new baseline rather than confounding a reader change with learned workflows.
For claimed use, also cite an action and completion check using this task's
parameters. Record read-but-unused workflows separately. A note saying a check
passed is insufficient when its cited observations contradict it.

## Source and adaptations

Source: Zora Zhiruo Wang, Jiayuan Mao, Daniel Fried and Graham Neubig,
**Agent Workflow Memory**, arXiv:2409.07429 (2024), subsequently ICML 2025.

- Paper: <https://arxiv.org/abs/2409.07429>
- Relevant passages: §2.1 experiences as instructions and observation/action traces;
  §2.2 workflow description and trajectory; §2.3 induction and integration,
  especially online neural success judgment; Appendix A for induction examples.

Offline AWM induces workflows from canonical training experiences before test
inference, then uses the same frozen memory on every test. That separation fits
the enterprise Optimizer–Target Agent protocol. This method generates its experiences
with a frozen Target Agent batch, admits successful traces using a declared signal,
and lets a separate Optimizer publish the induced workflows. Generating the
canonical experience pool this way is an adaptation. The default public success
judge borrows the paper's online admission signal; `training_score` instead uses
authorized supervised feedback and must be reported separately.

Target-owned skills, a reader instruction and trace-verified loading implement the
paper's integration into agent memory without executable workflow macros. This
packaging, parallel batch collection, extra consolidation worker and workflow/word
caps are harness adaptations. More than one induction round is also an extension.
The paper studies web navigation; applying observation/action induction to other tasks should be
reported as a domain adaptation, not an exact benchmark reproduction.
