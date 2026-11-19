# Round 0002 — serving-mode switch

## Hypothesis

The MTP sweep (round 0001) found a regime split: three speculative tokens win for single-stream latency, one token wins at high concurrency. The runtime dynamic scheduler that would switch per step forces `PIECEWISE` graphs on this stack and loses the gain, and the V2 model runner fails to initialize. An operator-level switch keeps `FULL_DECODE_ONLY` and picks the right static budget for the workload.

## Implementation

`VLLM_ASCEND_SERVING_MODE` is read in `vllm_ascend/platform.py::check_and_update_config`:

- `latency` sets the MTP speculative-token count to 3.
- `throughput` sets it to 1.
- Unset leaves the command line value untouched.

The patch is `patches/0001-ascend-serving-mode.patch`.

## Validation

- Latency mode: three runs at concurrency 1 (8 prompts), accuracy gate saved as the reference.
- Throughput mode: three runs at concurrency 32, one at concurrency 1, accuracy gate checked against the reference.
- Compare against the static results from round 0001.

## Acceptance

The switch must reproduce the static results in each mode, keep the accuracy gate within one question, and leave `FULL_DECODE_ONLY` in effect.
