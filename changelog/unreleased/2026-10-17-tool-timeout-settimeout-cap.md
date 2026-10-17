# A timeout past the setTimeout cap keeps waiting until the deadline

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `core`

[中文版](2026-10-17-tool-timeout-settimeout-cap.zh.md)

A tool timeout, background wait or model idle budget that works out past 2^31-1 ms (about 24.8 days) no longer ends on the spot. Node clamps such a delay to ~1 ms; the timer is now held just under the cap and re-armed until the deadline actually arrives. Small budgets take the same path as before.

## Details

- Environment's per-tool `timeoutMs`, `WakeSignal.wait`, and the model's idle `requestTimeoutMs` share one re-arming helper.
- MCP still pushes the SDK's own per-request timeout out to that same cap so Environment stays the single timekeeper.
