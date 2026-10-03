# Playbook and algorithm fidelity

Source: [Agentic Context Engineering, arXiv:2510.04618v1](https://arxiv.org/html/2510.04618v1),
sections 3–4. ACE separates Generator, Reflector and Curator; maintains itemized
rules with feedback; applies localized deltas; and grows/refines the context.
Its experiments include offline and online adaptation.

This method uses offline enterprise training, a batch of fresh Students, and one
Teacher publisher. It preserves trace reflection, successful and failed experience,
rule IDs, feedback counters, incremental updates and redundancy control. It replaces
embedding-based deduplication with Curator text comparison, moves the playbook into
a Skill, and uses whole-training-batch updates rather than the paper's experimental
batch size 1. Record these adaptations. There is no test-time memory update, Pareto
search, or validation-score acceptance gate in this method.

## Baseline artifact

Create `STATE/skills/ace-playbook/SKILL.md` as a target-owned custom Skill. Its
frontmatter has `name: ace-playbook`, a domain-specific description, and a
`YYYY.MM.DD.N` version following Agent Initialization. Keep custom Skill versions
separate from the integer Agent State version and rule revisions.

The stable body instructs the Student to read `rules.yaml` in full, apply rules only
when their conditions match public evidence, check current authoritative business
sources, and solve normally where no rule applies. Start `rules.yaml` with
`entries: []`. Do not copy the Teacher's reflection prompts into the Student.

Before measuring H1, put this fixed instruction in the experimental Student's
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

An active entry in Student `rules.yaml` has:

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

Keep case IDs, gold answers, judge text, trace paths and source sessions in Teacher
`OUT/evidence.yaml`, not in the Student artifact. Evidence rows identify rule ID,
measurement/version, case/run, Student session, exact observation/artifact location,
feedback visibility, claim and confidence. A single example can support a tentative
rule; do not claim repeated validation without independent observations.

Business policy constants may be learned when authorized training evidence supports
them. Label the policy's scope and effective date when relevant. Do not create
tables keyed by benchmark case IDs, customer IDs or output hashes. Examples must
illustrate a procedure without reproducing an answer to a held-out task.

Reflector helpful/harmful/neutral labels are diagnostic feedback, not a causal
proof. Count each `(measurement, case, run, rule_id)` at most once. Reuse of one
trace by several Reflectors never multiplies its count. Keep feedback events in
Teacher records, derive cumulative counters from those events, and archive retired
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
    evidence_ids: [<Teacher evidence row ID>]
```

Support `add`, `revise`, and `retire`. `add` uses a never-used monotonic ID;
`revise`/`retire` name an existing active ID. A revision supplies all textual fields
and preserves previous feedback history. Retirement supplies evidence and a reason;
it cannot silently discard a unique supported rule. Feedback-counter updates are
derived separately and do not count as semantic rule edits. A truly unchanged delta
has neither operations nor new feedback events.

Resolve duplicate operations and contradictions before publication; do not guess
merge order. No model directly rewrites the target file. The Teacher uses parsed
operations and a deterministic edit/serialization step, then checks that rule
text outside the delta remains unchanged and counters match recorded feedback.
An implementation can use ordinary Python or
Node tools for this small step; do not introduce an LLM-based second rewrite.

Enforce both the entry count and the total character limit including frontmatter
and stable instructions. Curator can inspect only training evidence. If a rule
needs unavailable verification, keep it as an unresolved hypothesis in OUT rather
than publishing it as an established business constraint.
