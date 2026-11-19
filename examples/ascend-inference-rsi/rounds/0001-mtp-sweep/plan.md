# Round 0001 — speculative token count

## Hypothesis

The reference configuration uses three MTP speculative tokens. On 950PR the draft and verify work per step may not be repaid by the accepted tokens: position 0 accepts about 70%, positions 1 and 2 about 45% and 34%. A lower count can reduce per-step overhead; a higher count can raise tokens per step. The optimum is measured, not assumed.

## Variants

| Variant | `num_speculative_tokens` |
| --- | --- |
| baseline | 3 |
| A | 1 |
| B | 2 |
| C | 4 |
| D | 5 |

All other settings stay at the baseline: Qwen3.8-27B-w8a8, TP=1 on NPU 0, 32768 context, `max-num-seqs` 32, `FULL_DECODE_ONLY`, random dataset, 32 prompts of 128/128, seed 0.

## Measurement

Three benchmark runs per variant. Compare the median mean TPOT and output throughput against the baseline; the noise floor is 8.04% for TPOT and 6.66% for throughput.

## Acceptance

A variant is retained only when it beats the floor for at least one primary metric, does not regress the other beyond its floor, and produces the same greedy outputs as the baseline on the fixed prompt set.

## Record

Results go to `metrics.json`; the verdict goes to `verdict.md`.
