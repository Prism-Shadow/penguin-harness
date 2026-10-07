# OPRO

RSI method from a paper titled as [Large Language Models as Optimizers](https://arxiv.org/abs/2309.03409).

GitHub: [google-deepmind/opro](https://github.com/google-deepmind/opro).
Source: Google DeepMind; [paper v3](https://arxiv.org/abs/2309.03409v3), §4–5,
especially §4.2 and §5.4. Verified implementation revision:
`a76bdce2cbf6d4a0d1e570a6fcfe17be9c2abdd7`,
`opro/optimization/optimize_instructions.py` and `opt_utils.py`.

Use the parent Skill's evaluation, snapshots, supervision and source-record rules.
This recipe implements prompt optimization: an Optimizer proposes instructions
from previously measured instruction/score pairs. Model weights, tools and the
rest of the Target harness stay fixed. OPRO does not require a Reflector, a Curator,
textual gradients or trace-based critiques; do not add those to this profile.

## Declare the search

Initialize through [OPRO initialization](../../agent-initialization/references/opro.md).
Own only `skills/opro-instruction/instruction.md` during search, plus the common
State version/snapshot bookkeeping. Keep its reader fixed before measuring H1.

Record these inputs in `OUT/experiment.yaml` before execution:

| Input | Rule |
| --- | --- |
| `num_search_steps` | Positive proposal-step budget; ask if missing |
| `num_generated_instructions_in_each_step` | Positive number of independent proposals per step; 8 in the source experiment |
| `max_num_instructions` | 20 best historical instructions in the source meta-prompt |
| `old_instruction_score_threshold` | 0 for this business-task profile; declare any other cutoff before seeing scores |
| `num_score_buckets` | 100 for the displayed history; selection uses unbucketed scores |
| `few_shot_qa_pairs` | False unless the user supplies or authorizes training input/output exemplars; source experiments normally use true |
| `num_exemplars` | With exemplars enabled, 3 per step in the source; require enough authorized examples |
| `case_ids`, `runs`, runtime | One fixed nonempty training set, positive repeats (1 by default), and a complete frozen Target runtime |
| Seed and sampling | Record exemplar sampling and proposer settings; the paper uses optimizer temperature 1 and scorer temperature 0 |

The released script uses 200 steps. Do not launch that budget implicitly. A proposed
smoke profile is 2 steps × 2 proposals on a small declared training subset, with
`runs = 1`; record it as reduced-budget OPRO. Penguin's `rounds`, desired score and
candidate-round form defaults do not supply these method parameters. Unsupported
model sampling settings must be disclosed, not assumed to have taken effect.

Use the source's history-plus-exemplars meta-prompt structure with the exemplar
block omitted when `few_shot_qa_pairs` is false, a supported option in `gen_meta_prompt`.
Without authorized gold, the proposer sees the public task description and scores,
not invented answers. With exemplars enabled, read only the approved training
input/output pairs; do not inspect Rubric code, Evaluator reasoning or test data.
Freeze that feedback choice. The Target sees the resulting instruction, not the
exemplar answers or optimization history.

## Evaluate and propose

1. Measure the initialized H1 instruction on the complete declared training set.
   A prior measurement is reusable only if its State, cases, runtime and repeats
   match. Record the instruction bytes/hash and all case/run session IDs. No
   existing baseline is required before this first measurement.
2. Build the history from all complete valid measurements in this experiment,
   including H1 and candidates that lost to H1. Take the highest-scoring
   `max_num_instructions`, then omit entries below the declared cutoff. Present
   the remaining entries in ascending score order, with the best last. Resolve
   ties by original candidate order. Never drop a valid low score from the ledger.
3. Make a fresh proposal context from that history, the fixed prompt-slot
   description and, if enabled, this step's seeded training exemplars. The prompt
   asks for a new generally applicable instruction expected to improve the score,
   returned as one delimited text. Save the exact prompt and raw response.
   Issue the declared number of independent proposal calls against the **same**
   history snapshot; do not let proposal 2 see proposal 1's new score in that step.
4. Parse one instruction per response and deduplicate against the experiment's
   previously evaluated instruction texts and the current batch. Apply the
   declared syntactic checks before testing: at most 500 characters and no
   unresolved `INS` placeholder. An explicitly proposed empty instruction is valid;
   a missing or malformed response is not an empty instruction. Keep the raw and
   parsed forms. The source's
   GSM8K digit filter is dataset-specific; enable it only for that source profile,
   not for arbitrary business instructions. Do not rewrite a proposal to rescue it.
5. For each new valid instruction, publish a unique candidate version and evaluate
   its complete fixed training matrix through paired `agent-evaluation` workers.
   Keep the same public task materials and private grader. Record the normalized
   objective `mean(case mean(run score)) / 100` in OUT. For the 100-bucket prompt,
   display `round(objective × 100)` using Python's source rounding; retain the
   unbucketed objective for ranking and the normal scoreboard averages separately.
6. Add all complete valid candidate measurements to the history for the next step.
   Duplicates, malformed proposals and infrastructure failures are not score-zero
   entries. A step with no new valid proposal still consumes its proposal budget;
   do not refill forever. An incomplete candidate follows the parent failure and
   rollback contract, never a partial-case mean.

Candidates sharing a Target State are evaluated sequentially. Cases within one
frozen candidate may run in parallel within capacity; independent replicas need
separate Targets. Snapshot each measured candidate before replacing it. Searching
a lower-scoring candidate is allowed: the parent contract's rollback protects
State integrity, while OPRO's history determines subsequent proposals.

## Select and freeze

At the declared stopping boundary, select the highest complete training objective
over H1 and every valid candidate. On an exact tie, retain the earliest candidate,
so H1 wins a tie with a new instruction. Keep this tie rule fixed. Restore the
selected measured snapshot with its recorded version; do not attach an old score
to a newly numbered or otherwise changed State. Preserve all other snapshots and
candidate records. If H1 wins, report no improvement.

Only complete retained measurements enter the ordinary scoreboard. The full
search history, including losing candidates and failures, stays in OUT. Stop
with the last clean measured State on budget exhaustion or integrity failure;
report incomplete search coverage. Independent testing starts only after final
selection, receives the frozen initial/final snapshots and cannot change the winner.
The paper also displays best-test examples; those tables do not authorize selecting
on this experiment's testing scores. Training-only selection follows §5.4.

Report the initial/final instruction, selected State version, full candidate/step
counts, repeated-text skips, per-case scores, source links, source revision and
all-role costs. Separate proposal calls, Target calls and companion recovery.
For K initial instructions (this initialization uses K = 1), C training cases,
R repeats, S steps and P proposals, at most `(K + S × P) × C × R` normal training
Target executions are needed before duplicate filtering; testing and recovery
have separate budgets.

The learned file and its fixed reader are Penguin storage adaptations, not the
source's literal Q_begin/Q_end/A_begin placement. Business grading replaces the
paper's QA accuracy only when declared; call it benchmark-score optimization,
not exact-match accuracy. Reduced budgets, omitted exemplars, provider settings
and supervision must be reported. This recipe does not reproduce published
GSM8K/BBH numbers merely by using the OPRO name.
