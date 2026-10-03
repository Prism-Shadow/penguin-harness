# ACE

RSI method from a paper titled as Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models

Follow the inputs, evaluation and output rules in `agent-optimization`.
The complete method, playbook format and paper differences are defined here.
This is offline FDE adaptation: fresh Target Agents generate traces, Reflectors extract
lessons, a Curator consolidates deltas, and the Optimizer publishes between batches.

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
batch updates by Optimizer, linear candidates and evidence/structure admission.
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
   Unknown causes stay hypotheses; workers cannot edit Target Agent State.
2. The Curator merges lessons, resolves contradictions by condition, preserves
   supported behavior and proposes a bounded delta. It can inspect cited training
   evidence and may consolidate duplicates; it cannot use testing or rewrite the
   full playbook indiscriminately.
3. The Optimizer validates parent version/hash, IDs, evidence, operations, limits
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

## Baseline artifact

Create `STATE/skills/ace-playbook/SKILL.md` as a target-owned custom Skill. Its
frontmatter has `name: ace-playbook`, a domain-specific description, and a
`YYYY.MM.DD.N` version following Agent Initialization. Keep custom Skill versions
separate from the integer Agent State version and rule revisions.

The stable body instructs the Target Agent to read `rules.yaml` in full, apply rules only
when their conditions match public evidence, check current authoritative business
sources, and solve normally where no rule applies. Start `rules.yaml` with
`entries: []`. Do not copy the Optimizer's reflection prompts into the Target Agent.

Before measuring H1, put this fixed instruction in the experimental Target Agent's
AGENTS.md:

> Read the complete ace-playbook SKILL.md and rules.yaml before substantive task
> actions. Apply applicable entries using the current business evidence. In a brief
> tool-side note in this task workspace, record rule IDs used and any conflicting
> observations; preserve the required answer format. Never modify Agent State,
> persistent memory, Skills, hooks or tool definitions. Do not read other cases,
> experiment records, judge endpoints or private scoring files.

Every execution must show actual file reads in its public trace. A claimed usage
note alone is insufficient. With an empty playbook, a read followed by ordinary
task solving is valid. Keep this reader identical for initial and final testing.

## Rules and evidence

An active entry in the Target Agent's `rules.yaml` has:

```yaml
entries:
  - id: ace-0001
    condition: <business circumstances in which this applies>
    instruction: <procedure, check, or domain rule>
    exceptions: <known limits; empty string if none established>
    helpful: 0
    harmful: 0
    neutral: 0
```

Keep case IDs, gold answers, judge text, trace paths and source sessions in Optimizer
`OUT/evidence.yaml`, not in the Target Agent artifact. Evidence rows identify rule ID,
measurement/version, case/run, Target Agent session, exact observation/artifact location,
feedback visibility, claim and confidence. A single example can support a tentative
rule; do not claim repeated validation without independent observations.

Business policy constants may be learned when authorized training evidence supports
them. Label the policy's scope and effective date when relevant. Do not create
tables keyed by benchmark case IDs, customer IDs or output hashes. Examples must
illustrate a procedure without reproducing an answer to a held-out task.

Reflector helpful/harmful/neutral labels are diagnostic feedback, not a causal
proof. Count each `(measurement, case, run, rule_id)` at most once. Reuse of one
trace by several Reflectors never multiplies its count. Keep feedback events in
Optimizer records, derive cumulative counters from those events, and archive retired
entries rather than reassigning their IDs.

## Delta contract

Curator output is a plain YAML artifact:

```yaml
parent_version: <integer>
parent_hash: <State content hash>
operations:
  - op: add
    id: ace-0001
    condition: <condition>
    instruction: <instruction>
    exceptions: <limits>
    evidence_ids: [<Optimizer evidence row ID>]
```

Support `add`, `revise`, and `retire`. `add` uses a never-used monotonic ID;
`revise`/`retire` name an existing active ID. A revision supplies all textual fields
and preserves previous feedback history. Retirement supplies evidence and a reason;
it cannot silently discard a unique supported rule. Feedback-counter updates are
derived separately and do not count as semantic rule edits. A truly unchanged delta
has neither operations nor new feedback events.

Resolve duplicate operations and contradictions before publication; do not guess
merge order. No model directly rewrites the target file. The Optimizer uses parsed
operations and a deterministic edit/serialization step, then checks that rule
text outside the delta remains unchanged and counters match recorded feedback.
Use ordinary Python or Node tools for this step; do not introduce an LLM-based second rewrite.

Enforce both the entry count and the total character limit including frontmatter
and stable instructions. Curator can inspect only training evidence. If a rule
needs unavailable verification, keep it as an unresolved hypothesis in OUT rather
than publishing it as an established business constraint.

## Source and adaptations

Source: [Agentic Context Engineering, arXiv:2510.04618v1](https://arxiv.org/html/2510.04618v1),
sections 3–4. ACE separates Generator, Reflector and Curator; maintains itemized
rules with feedback; applies localized deltas; and grows/refines the context.
Its experiments include offline and online adaptation.

This method uses offline enterprise training, a batch of fresh Target Agents, and one
Optimizer publisher. It preserves trace reflection, successful and failed experience,
rule IDs, feedback counters, incremental updates and redundancy control. It replaces
embedding-based deduplication with Curator text comparison, moves the playbook into
a Skill, and uses whole-training-batch updates rather than the paper's experimental
batch size 1. Record these adaptations. There is no test-time memory update, Pareto
search, or validation-score acceptance gate in this method.
