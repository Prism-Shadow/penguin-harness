# Workflow artifact

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
case/session provenance in Teacher OUT; keep only public descriptions, hashes and
dependencies in the Student's `awm-index/workflows.json`.
For an observation/action workflow include, per step:

| Field | Required content |
| --- | --- |
| Observation | What the actor can verify in the current environment. |
| Decision | Why the next action follows from that observation, without invented hidden reasoning. |
| Action | An available tool operation with parameter bindings. |
| Check | Evidence needed before proceeding or declaring completion. |

Keep parameters explicit; a path or selector from an old task is not a default for
a new task. A workflow may compose an existing workflow by ID with explicit inputs
and completion checks, but circular dependencies invalidate the proposal.

# Primary source and adaptations

Source: Zora Zhiruo Wang, Jiayuan Mao, Daniel Fried and Graham Neubig,
**Agent Workflow Memory**, arXiv:2409.07429 (2024), subsequently ICML 2025.

- Paper: <https://arxiv.org/abs/2409.07429>
- Relevant passages: §2.1 experiences as instructions and observation/action traces;
  §2.2 workflow description and trajectory; §2.3 induction and integration,
  especially online neural success judgment; Appendix A for induction examples.

Offline AWM induces workflows from canonical training experiences before test
inference, then uses the same frozen memory on every test. That separation fits
the enterprise Teacher–Student protocol. This method generates its experiences
with a frozen Student batch, admits successful traces using a declared signal,
and lets a separate Teacher publish the induced workflows. Generating the
canonical experience pool this way is an adaptation. The default public success
judge borrows the paper's online admission signal; `training_score` instead uses
authorized supervised feedback and must be reported separately.

Target-owned skills, a reader instruction and trace-verified loading implement the
paper's integration into agent memory without executable workflow macros. This
packaging, parallel batch collection, extra consolidation worker and workflow/word
caps are harness adaptations. More than one induction round is also an extension.
The paper's setting
is web navigation; applying observation/action induction to other tasks should be
reported as a domain adaptation, not an exact benchmark reproduction.

## Fixed reader and public index

Before measuring H1, create a target-owned `skills/awm-index/SKILL.md` with a
custom `YYYY.MM.DD.N` version, and `workflows.json` containing
`{"workflows": []}`. Index rows contain `id`, `description`, `revision`,
`content_hash`, `parameters`, and `dependencies`; never include training answers
or trace paths. Record ownership and evidence separately in Teacher OUT.

Use this fixed AGENTS.md instruction for both base and final harnesses:

> Before substantive task actions, read the complete awm-index SKILL.md and
> workflows.json. Read the complete SKILL.md of any workflow whose preconditions
> match this task, including its dependencies, and bind its parameters to current
> observations. Use ordinary tools to execute it and verify completion. Record
> selected workflow IDs in a short task-workspace note, keeping the required final
> answer format. If none applies, solve normally. Do not modify persistent State,
> skills, memory, tools or hooks, and do not read experiment or private judge files.

Require a trace-visible file read before claiming a workflow was used. An empty
index or no matching workflow is valid. If the reader itself needs repair, start
a new baseline rather than confounding a reader change with learned workflows.
