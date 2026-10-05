# AWM

RSI method from a paper titled as [Agent Workflow Memory](https://arxiv.org/abs/2409.07429).

GitHub: [zorazrw/agent-workflow-memory](https://github.com/zorazrw/agent-workflow-memory).

Use Agent Optimization's I/O, supervision and version rules. Keep offline and
online AWM distinct; a public-judge batch over newly generated experiences is not
the paper's canonical offline pipeline.

## Sources and mode

Paper: [arXiv:2409.07429v1](https://arxiv.org/abs/2409.07429v1), §2.1–2.3 and Appendix A.
Official implementation: `zorazrw/agent-workflow-memory`, commit
`8c0ff8cd11d648c8fceb99e4e42f37e3b75381b1`. Relevant paths:
`mind2web/offline_induction.py`, `mind2web/memory.py`, `mind2web/prompt/`,
`webarena/pipeline.py`, `webarena/induce_prompt.py`, `webarena/autoeval/`.

Select one mode before reading task evidence:

- **`online_train` (FDE default):** use the paper's online induce/integrate/use
  loop on the declared **training stream**, then freeze for independent testing.
  This preserves the update mechanism while moving adaptation away from testing
  to honor FDE's train/test separation. Declare this phase change explicitly.
- **`offline`:** require supplied canonical training experiences (task plus
  observed action/observation trajectories), annotated or model-synthesized with
  recorded provenance. Concatenate the domain's experiences for one induction
  before inference. Do not manufacture canonical success from arbitrary failed
  Target runs or switch to an online judge without changing the declared mode.

Use one pass over the training stream and one execution per case by default.
Independent replicas may run in parallel; queries within one online replica are
sequential, since later tasks use memory learned from earlier ones. Extra passes
are an explicitly requested extension, never a response to disappointing scores.

For online admission use the source's neural success evaluator on public task,
trajectory and outputs. Its binary success signal is independent of private
benchmark score. Insufficient evidence is non-success; do not admit uncertain
execution merely because its JSON is valid. Source code also permits `criteria=gt`;
when explicitly chosen, use the benchmark's success predicate, not a tuned partial
score threshold. Record judge and inducer runtime separately from the Target.

## Initialize

Follow [AWM initialization](../../agent-initialization/references/awm.md) for the
empty index and fixed full-memory reader before H1. Own the index and explicitly
allocated workflow Skills only; keep other State/model/tools unchanged.
Each work execution and analysis role gets an independent companion.

A requested frozen H1 training baseline is a separate diagnostic matrix. Do not
reuse it as a sequential online stream: the memory passed to later cases differs.
Do not read unrelated experiments or accept their libraries as an empty baseline.

## Online training stream

For each training task, in the declared order:

1. Run a fresh Target with **all current workflow memory** available. Save its
   actual task, action/observation trace and output. The Target does not alter
   persistent memory or analyze other trajectories while solving.
2. With neural admission, a separate success judge evaluates only that public
   experience; private scores may be collected for reporting but do not enter
   the judge/inducer or change admission. With explicitly selected `criteria=gt`,
   use delegated benchmark correctness directly and do not also run a neural
   admission vote. Freeze this choice and each role's visibility before execution.
3. On success, an inducer extracts reusable subroutines from the observed
   successful experience and current memory. Preserve the paper's granularity:
   parameterize instance values, keep an intelligible goal/description and a
   sequence of observations, decisions and available actions. A workflow has at
   least two steps, following the official induction prompt. Unsupported steps,
   unresolved assumptions and candidate-answer agreement are not demonstrated
   procedures. Do not import failed trajectories as successful demonstrations.
4. Integrate valid workflows before the **next** task. Avoid overlapping duplicates
   and preserve usable existing memory. Publish at an idle boundary using the
   common version/snapshot contract. A failed/non-success task leaves memory
   unchanged; continue through the remaining training tasks.

For the paper's incremental profile, induce from the current successful experience
and integrate into accumulated memory. The released WebArena pipeline instead
re-induces from accumulated successful experiences, sampling at most one per
provided template by default. If choosing that implementation profile, declare
it, preserve its template sampling/seed and re-induction behavior, and do not invent
missing template IDs. Do not silently mix these two profiles mid-run.

There is no reflection-driven retry of wrong tasks in AWM, no Curator architecture
from ACE, no best-training-score gate, and no fixed five-workflow quota. A
format/ownership/dependency validator may reject malformed artifacts, but must
not become an extra model that rewrites the algorithm's learned workflows.
Budget one judge per experience and one induction per admitted experience, plus
supervision and declared frozen evaluation matrices. End after the stream even
when no experiences qualified; an empty final library is a valid no-learning
outcome, not a reason to lower admission standards.

## Canonical offline induction

Read all declared canonical experiences from one domain and induce workflows once,
as in `mind2web/offline_induction.py`. The official prompts request common reusable
subroutines across examples and no overlapping workflows. This phase needs no
online success judge because its input pool is already canonical. Preserve the
pool, exact prompt, generated memory and any formatting transformation. If context
cannot hold it, stop or declare a chunked variant; do not silently summarize or
sample based on test performance. Test all tasks with the same frozen library.

## Skill representation and loading

Use `skills/awm-<id>/SKILL.md` for each workflow, with target-owned metadata,
parameters, applicability, and observation/decision/action/check steps.
`awm-index/workflows.json` lists IDs, descriptions, revisions, hashes, parameters
and dependencies. Instance IDs, paths and dates are bound from current inputs;
keep training case/session evidence in Optimizer OUT, not Target memory.

Load the **complete workflow library** in every Target execution, including
all dependencies, as the paper incorporates all induced memory. Selecting which
steps to execute is task-dependent; selective retrieval is a different variant.
Keep the full-memory reader fixed for empty H1 and final testing. Validate actual
file read outputs, not only usage notes. An index or directory list is not the
workflow text. Record read-but-unused workflows honestly.

Do not enforce an arbitrary count/word cap that truncates learned memory and
still claim the original profile. Honor the declared model context/output budget,
stop on overflow or report a separately named constrained variant. Existing
public policy scope remains attached to workflows; do not replace it with a
benchmark-case answer table.

## Freeze and evaluate

After the full training stream or canonical induction, freeze final memory. An
independent Reporter measures initial and final harnesses with no success judge,
induction or persistent writes during testing. Report source mode/profile,
admission verdicts, actual workflow additions/reuse/reads, immutable snapshots,
per-task results, costs, failures and no-op outcomes. Supervision retries are
separate from algorithmic executions and do not admit contaminated evidence.

The paper studies web navigation and its online mode learns on test queries.
Business APIs, Skill-file storage, a separate Optimizer, moving the online loop
onto a training split, and companion recovery are explicit FDE adaptations.
Preserve the mechanism and disclose these changes; do not claim identical
published benchmark results or present mixed offline/online behavior as original.
