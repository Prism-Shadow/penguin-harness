# APE

RSI method from a paper titled as [Large Language Models are Human-Level Prompt Engineers](https://arxiv.org/abs/2211.01910).

GitHub: [keirp/automatic_prompt_engineer](https://github.com/keirp/automatic_prompt_engineer).
Source: University of Toronto, Vector Institute and University of Waterloo;
[paper v2](https://arxiv.org/abs/2211.01910v2), §3 and §5.3. Verified implementation:
`eac521c79a78965245ce7745dcc9f6b0792c7ec7`, `automatic_prompt_engineer/ape.py`,
`generate.py`, `evaluate.py`, and
`experiments/evaluation/instruction_induction/exec_accuracy.py`.

Use the parent Skill's evaluation, supervision, snapshot and source-record rules.
This is **non-iterative, forward-generation APE with execution scoring**. The
paper uses non-iterative APE by default; §5.3 distinguishes optional iterative
resampling. This recipe does not implement Monte Carlo refinement, bandit/UCB
allocation or log-likelihood scoring. The public `simple_ape` helper uses UCB;
do not claim to reproduce that helper's profile with this exhaustive search.

## Declare examples and budget

Initialize through [APE initialization](../../agent-initialization/references/ape.md).
Only `skills/ape-instruction/instruction.md` changes during search, apart from
common version/snapshot bookkeeping. Keep model weights, tools and reader fixed.

Require a user-supplied or explicitly authorized set of **training input/output
pairs** for instruction generation. Private benchmark answers are not authorized
merely because they exist. Ask for examples or permission if missing, and wait
without opening Rubrics or starting generation. A named demonstration export
outside Rubric directories is sufficient; its permitted output fields must be
declared. Do not replace examples with unverified failed Target outputs or a
score-only history and still call the run APE.

Record the following before execution:

| Input | Rule |
| --- | --- |
| `prompt_gen_case_ids` or demonstration source | Approved training examples with input/output provenance |
| `num_subsamples` | Positive count of seeded demonstration subsets |
| `num_demos` | Positive examples per subset, no larger than the approved pool |
| `num_prompts_per_subsample` | Positive independent proposals from each subset |
| `eval_case_ids`, `runs` | Fixed nonempty training selection set; 1 run per case by default |
| Prompt/evaluation templates and runtime | Freeze before generating; record proposer and Target settings separately |

The source instruction-induction config uses 3 subsets, 5 examples per subset
and 30 prompts per subset. Do not run 90 candidates implicitly. Ask for the
proposal budget; a proposed smoke profile is 1 subset × 2 examples × 3 prompts,
with all declared selection cases evaluated once. Record reduced counts and any
different model settings. `rounds` is not a parameter of this non-iterative profile.

Keep generation and selection examples distinct when enough authorized training
data is available. The source API exposes these as separate datasets; its simple
helper reuses one. Declare any overlap before execution. Neither set may include
testing cases or outputs. A zero-shot Target receives no demonstration answers;
only the proposer may read the approved generation pairs. Scores are returned
to the controller, while Rubric and Evaluator private reasoning remain hidden.

## Generate once, evaluate, select

1. Measure the initialized H1 on the fixed selection set for comparison. The empty
   initial prompt is a diagnostic baseline, not an extra member of APE's generated
   candidate pool. Do not expose its errors or scores to the initial proposer.
2. Sample `num_subsamples` demonstration sets with a recorded seed, without
   replacement within each set. Format each with the fixed demonstration template.
   Ask the proposer to infer a general instruction that could have produced those
   input/output pairs, and return only that instruction. Generate the declared
   `num_prompts_per_subsample` independent continuations for each set. Complete
   generation before receiving any candidate evaluation scores; retain the prompt,
   raw response and originating demonstration IDs for every proposal in OUT.
3. Deduplicate exact instruction texts as `find_prompts` does. Keep stable IDs by
   first occurrence and retain the raw response separately. Reject empty or
   malformed responses and record why; do not add another LLM rewriting stage.
   No new candidates are generated from high scores in this profile.
4. Publish each distinct candidate as a unique State version, then delegate the
   complete fixed selection matrix to paired `agent-evaluation` workers. Use the
   same cases, runtime and repeats for every candidate. Evaluate sequentially when
   sharing a Target; only cases of the same frozen State may run in parallel.
   An execution score comes from the existing benchmark grader on actual saved
   Target outputs, not the proposer's judgment or token log probability.
5. Rank by the complete mean of case/run scores. Freeze the highest-scoring
   generated candidate. Match the source's tie ordering: sort by mean score,
   then instruction text, both descending using Python string ordering.
   There is **no strict-improvement acceptance gate against H1** in APE. If the
   winner scores below H1, report the regression; do not silently change methods
   by selecting H1 instead. Users can retain H1 as a separate deployment choice.

This recipe evaluates the whole declared selection set for each candidate: it
uses APE's exhaustive scoring path and skips optional staged filtering. The
source execution evaluator samples examples per prompt; using all examples on
the same set removes that sampling difference. Preserve the benchmark's scorer;
do not substitute exact match for a task that awards partial credit. Report the
objective as benchmark score when it differs from the paper's execution accuracy.

Keep source examples and case-specific answers out of the learned instruction.
Reject answer lookup tables or permissions that contradict the task contract
under the common integrity rules, with evidence. Do not invent a numeric score
for a refused candidate. Freeze each valid measured snapshot before replacement.
Infrastructure failures follow the parent repair/stop contract; a missing case
is not zero or permission to compare a partial mean. If the declared pool cannot
be completely evaluated within budget, restore the last clean baseline and
report the search incomplete. If no valid proposal exists, retain H1 and report
that generation failed, not that APE learned an empty instruction.

## Freeze and report

Restore the exact winning snapshot and its measured version; never relabel its
score as a new State. Hand frozen H1/final snapshots to an independent Reporter
for testing after selection. Testing cannot select prompts, trigger regeneration
or become demonstrations. Store the full candidate pool, raw proposal lineage,
measurements and failures in OUT; only complete retained measurements use the
existing scoreboard format. Include method/source links and revisions in each
experiment's provenance under the shared selection reference.

Report H1 and winner scores even on regression, generated/distinct/valid counts,
demonstration and selection coverage/overlap, snapshots, adaptations and costs.
With N proposal continuations, C selection cases and R repeats, the normal Target
budget is at most `(1 + N) × C × R` including H1, before duplicate filtering.
Proposal calls, final testing and companion recovery are separate costs.

APE learns an instruction from examples; it is not a trace-reflection algorithm.
Penguin's fixed file reader, business tasks, tool-using Target, exhaustive shared
selection set and supervision are adaptations. Explicitly distinguish this small
profile from the source likelihood/UCB defaults and published benchmark results.
