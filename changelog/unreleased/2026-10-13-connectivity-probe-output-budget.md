# The connectivity probe gives a reasoning model enough output tokens to answer

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`

[中文版](2026-10-13-connectivity-probe-output-budget.zh.md)

The model connectivity test sent `maxTokens: 16`. A reasoning model spends that entire budget on hidden thinking — it ends `finish_reason: "length"` with no visible content, and the probe reports a failure although the endpoint is fine.

## The budget

`MODEL_PROBE_MAX_TOKENS` is the plain probe's output budget, 1024 by default and overridable with `PENGUIN_MODEL_PROBE_MAX_TOKENS`. On a model that answers directly the probe still costs a handful of tokens; on one that thinks first it now has room to finish and be judged. Speed mode keeps its own 64-token cap, which is what its TTFT/TPS reading is calibrated against.

## Details

- The probe prompt, the `maxTokens` argument and the two comments that described the old budget — including the one on the speed-mode flag in `api/types.ts` — now say what each mode actually spends.
