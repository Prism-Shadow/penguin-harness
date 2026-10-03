# Penguin

Penguin's default optimization method. Use the common Agent Optimization input,
evaluation, snapshot and output contracts; this reference defines its search and
acceptance policy. It preserves the original method's behavior.

## Requirements and declaration

Require a published training Benchmark, a complete Formal Baseline matching the
current Student State, desired `target_score`, positive candidate `runs` and
positive `rounds`. Read Student runtime from that baseline; do not create a missing
Agent, benchmark or baseline inside this method.

Require a finite target in `0..100`. Use the baseline's complete case set, not a
new subset, and verify its State/runtime before beginning. Existing prompts that
describe a desired score and round limit without field names keep the same meaning.

Declare nonparametric State edits, offline training, one candidate per round,
Teacher updates, training scores/public traces, and strict aggregate-score selection.
Rubrics, gold, private scoring conditions and Evaluator internals are forbidden.
If they enter Teacher context, stop as contaminated and restore an owned active
candidate. An experiment requiring such supervision must choose another method.

Editable behavior lives in AGENTS.md, target-owned Skills and safe runtime-limit
fields. Keep model/thinking fixed. Do not edit `system_prompt` unless requested
or overwrite library Skills for task-specific behavior. Protect each Reference
with the shared snapshot/rollback protocol.

The initial Formal Baseline has one run per case. Preserve its recorded repeat
count, even when candidate `runs` is larger; do not backfill it. Compare stored
aggregate scores directly and disclose this unequal-repeat policy. It is a
property of Penguin's original method, not a common requirement for ACE or AWM.

## Search and acceptance

The Reference is the highest-scoring accepted State and its complete evaluation.
For each round:

1. Verify Reference identity, version, case coverage and runtime. Read its public
   statements, scores and bound Student traces, plus earlier rejected candidates.
2. Diagnose observable capability gaps. State a falsifiable hypothesis connecting
   a bounded general edit to a predicted change in decisions or outputs. Merely
   adding more analysis without a behavioral prediction is not a useful proposal.
3. Create one candidate from the Reference, excluding rejected edits. Check its
   evidence, allowed write set and absence of private/instance-answer content.
4. Evaluate the complete frozen case × candidate-runs matrix through Agent
   Evaluation, with no State changes while any cell is running.
5. Accept only an admissible, completely evaluated candidate whose aggregate
   score is strictly higher than Reference. Otherwise restore Reference.
   Acceptance follows score even if the behavioral hypothesis was not supported;
   report the two judgments separately.
6. Append each accepted evaluation immediately and use it as the next Reference.
   Rejected traces remain evidence for the next hypothesis, outside scoreboard.

One complete valid candidate evaluation consumes a round whether accepted or
rejected. Safe repairs do not consume a candidate round, but still count toward
declared time/cost limits. Do not abandon a candidate with a repairable unstarted
cell to try another hypothesis.

Stop when Reference reaches the target, the candidate-round budget ends, or a
concrete infrastructure/contamination/concurrency/admissibility blocker arises.
Retain the highest-scoring accepted Reference. Report baseline and candidate
repeat counts explicitly, along with each change, score, decision and hypothesis
outcome. The common independent Reporter owns any final held-out testing.
