# ACE

RSI method from a paper titled as Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models

Use Agent Optimization's I/O, supervision and version contract. This reference
specifies the **sequential offline** training algorithm. Follow the pinned source
before adapting its transport; do not substitute a whole-batch advice-writing loop
and call it the original experiment.

## Source and profile

Paper: arXiv:2510.04618v1, §3–4 and Appendix B.
Reference implementation: `ace-agent/ace`, commit
`82709de050e1db6e6ef2f07bcb0393560b94992a`, especially
`ace/ace.py::_train_single_sample`, `_offline_train`, `ace/core/reflector.py`,
`ace/core/curator.py`, `ace/prompts/`, and `playbook_utils.py`.

The paper allows parallel delta merging, but its experiments use batch size 1
and up to five epochs/refinement rounds. The released sequential implementation
has these configurable defaults; record the chosen values before any run:

| Setting | Default in this recipe |
| --- | --- |
| `num_epochs` | 1 complete pass over the declared training order |
| `max_num_rounds` | Up to 3 reflection/regeneration cycles per incorrect training sample |
| `curator_frequency` | 1: curate after each sample |
| `playbook_token_budget` | 80000, reduced only as a declared model/context constraint |
| `use_bulletpoint_analyzer` | false, matching the implementation's optional analyzer default |
| `read_train_gold`, `read_train_rubric` | false; independently declare an authorized supervised variant |
| Final selection without validation | Final playbook, not training-score maximization |

`rounds` is not an alias for epochs or reflection cycles: ask to resolve an
ambiguous legacy request. Freeze model, thinking, sample order and all budgets.
A sequential run processes one sample at a time within a replica; independent
replicas may run in parallel. Every execution and analysis worker has a companion.

## Initialize and measure

Follow [ACE initialization](../../agent-initialization/references/ace.md) for the
empty playbook and fixed reader before H1. Own only `skills/ace-playbook/` plus
version/snapshot bookkeeping. Keep other State, model, tools and reader fixed.

Measure a full fixed-H1 training matrix separately when a baseline is requested.
Do not call the evolving per-sample pre/post trajectory a fixed-version matrix.
That trajectory uses different playbooks as training advances. Every saved
version has its own immutable snapshot and evidence manifest.

## Training loop

For every epoch, visit each training case in the declared order:

1. **Generate.** Run a fresh Target/Generator with the current playbook and no
   reflection. Save its actual trace, answer, used rule IDs and delegated
   correctness feedback. Use the benchmark's correctness predicate; a partial
   score is not automatically correct. The Generator never edits persistent State.
2. **Reflect and regenerate.** If incorrect, a separate Reflector receives this
   case, the observed Generator trace/prediction, current used bullets and only
   authorized feedback. It returns error identification, root-cause hypothesis,
   correct approach, reusable insight and helpful/harmful/neutral bullet tags.
   Record one feedback event per tagged existing bullet and execution. Apply
   helpful/harmful counter updates deterministically and publish the next State
   revision at the idle boundary before regeneration; neutral leaves source
   counters unchanged. The next Generator receives those updated counts.
   Run a fresh Generator on the **same training case** with that reflection as
   explicit training input, then check correctness. Stop on correctness or the
   predeclared `max_num_rounds`; never extend it because scores are disappointing.
   If the initial answer was already correct, still run one Reflector to obtain
   lessons and bullet tags, without the error-correction regeneration loop.
3. **Curate.** Pass the latest reflection, current playbook and question context
   to the Curator. It proposes only missing reusable insights as structured ADD
   operations (`section`, `content`). Apply them deterministically with fresh
   monotonic IDs, preserving existing text and counters. An empty ADD list is
   valid; continue to the next sample, not an early experiment stop.
4. **Measure after curation.** Run this case again with the new playbook and
   **without reflection**, as the released implementation does. Record this
   post-curation observation; it is not a score gate for retaining the update.
   Continue with the updated playbook for the next training case.

These algorithmic training generations are distinct from cheating retries.
Give each `(replica, epoch, case, phase, refinement)` its own logical execution
identity; its companion-recovery attempt counter is separate. Ordinary benchmark
runs still execute once. The method supplies training reflection through explicit
request metadata/task input; do not disguise it as a supervision repair or allow
it into final testing. With no gold permission, reflection must not contain gold
or private grader contents. A supervised variant must declare what reaches the
Generator through reflection; a permission flag is not automatic disclosure.

The maximum algorithmic Target calls are
`num_epochs × cases × (2 + max_num_rounds)`, plus separately declared frozen
baseline/final matrices. Budget Reflectors, Curators, optional refinement, both
companion roles and bounded cheating recovery as well. Stop on budget or integrity
failure with the last valid state; restore an owned unmeasured candidate once
workers settle. Do not publish partial or contaminated learning as complete.

## Playbook and refinement

Keep the established itemized `rules.yaml` format from this adaptation: stable
IDs, condition/instruction/exceptions and helpful/harmful counters. The existing
neutral field stays zero for this source profile; neutral tags remain diagnostic
events and do not increment a source counter. The fixed
reader loads the complete playbook before substantive task actions. A successful
file read proves loading, not correct use; cite actual actions for use claims.
Record trace/answer provenance privately in OUT rather than embedding case IDs,
customer answers, judge transcripts or test information in the playbook.

A Curator proposal has `operations: [{type: ADD, section: ..., content: ...}]`.
The deterministic publisher stores each bullet with `id`, `condition`,
`instruction`, `exceptions`, `helpful`, `harmful`, and `neutral` (zero). Preserve
Curator content verbatim as `instruction`; record explicit scope as condition,
or use “when relevant to the current task” if the source provided none. Do not
invent new restrictions while serializing. Initialize counters to zero.

Map a source ADD's content into the public rule fields without a second LLM rewrite;
retain its section in the evidence manifest. Each operation needs a reusable
lesson from the latest reflection. Do not fill an arbitrary rule quota, invent
policy premises, copy instance answers, or discard earlier useful content.
Counters describe observed feedback for bullets actually present in that run,
not retrospective credit for the traces that inspired a new rule.

The paper's grow-and-refine uses semantic embeddings. The pinned release makes
its BulletpointAnalyzer optional; the default ADD path does **not** implement
UPDATE/MERGE/DELETE (those are TODOs in `playbook_utils.py`). With the analyzer
explicitly enabled, use its actual embedding/cosine-similarity and merge procedure
and record the model/threshold. Do not silently replace it with an LLM similarity
judgment and claim the same algorithm. Without it, label deduplication disabled;
keep Curator's avoid-redundancy instruction but make no embedding-pruning claim.
Resource overflow stops the run or follows a declared source-supported profile,
not an unrecorded whole-playbook compression.

## Freeze and report

Save the final playbook after all declared training samples. If a separate
validation split was explicitly provided, source-style best-validation selection
is possible; testing never selects a version. With train/test only, use the final
playbook: the pinned implementation's unupdated `best_playbook` when validation
is absent is not an instruction to throw away learning.

Measure frozen initial/final harnesses under matched runtime and repeats using
independent Reporters. Report per-sample initial/refined/post-curation results
separately from frozen matrices, counter events, operations, snapshots, costs,
violations and every adaptation. Skill storage, clean-context Teacher/Student
execution, new model/domain, no-validation final selection and companion recovery
are Penguin/FDE adaptations. They are not a reproduction of ACE's published
AppWorld/finance numbers. Keep source algorithm settings fixed regardless of gain.
