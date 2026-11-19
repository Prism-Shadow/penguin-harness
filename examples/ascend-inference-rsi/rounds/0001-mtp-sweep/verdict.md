# Round 0001 verdict — variant 1 retained for validation

Three runs per variant, 32 prompts of 128/128 at `max-num-seqs` 32.

| Speculative tokens | Mean TPOT (ms) | Output throughput (tok/s) | Acceptance (%) |
| --- | --- | --- | --- |
| 3 (baseline) | 26.16 | 814.2 | 50.2 |
| **1** | **25.91** | **910.4** | **76.6** |
| 2 | 26.26 | 865.9 | 62.1 |
| 4 | 26.72 | 769.8 | 43.2 |
| 5 | 28.58 | 717.7 | 35.9 |

Variant 1 beats the throughput floor (6.66%) with +11.8% and does not regress TPOT beyond its floor. The gain comes from a higher accepted-token ratio per draft: one draft token is accepted 76.6% of the time, while the third position accepts only about 34%.

## Status

Provisional. Before retention, variant 1 must:

- produce the same greedy outputs as the baseline on `assets/prompts.jsonl`;
- hold the gain at other concurrency levels and not regress single-stream TPOT by more than its floor.

Those checks are round 0002.
