# The default model idle timeout is ten minutes

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `core`, `docs`
- **PR:** [#1221](https://github.com/Prism-Shadow/penguin-harness/pull/1221)

[中文版](2026-10-19-model-timeout-ten-minutes.zh.md)

The default `model.timeoutMs` rose from 300000 to **600000**. The value is the idle budget between upstream events, not a cap on the whole request. Some relays consume a model's thinking stream upstream and send nothing until the answer starts. A model reached through one spends its whole thinking phase inside the wait for the first event, and five minutes cut a long one off before it answered.

## Details

- `GenerativeModel` falls back to 600000 when no `requestTimeoutMs` is given.
- This is a kernel change (generation `2026-10-19`, runtime tab). An existing Agent whose runtime tab is still the built-in default picks the new value up on a kernel update; one whose runtime tab was edited keeps what it says. Setting **Model response timeout (ms)** on the **Runtime** tab to 600000 does the same by hand. **Restore default configuration** also brings the new value, but resets every other tab with it.
- The configuration reference and the interface listing state the new default.
