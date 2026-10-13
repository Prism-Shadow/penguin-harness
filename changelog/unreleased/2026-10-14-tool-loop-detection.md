# A model stuck on the same tool calls stops the run

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1116](https://github.com/Prism-Shadow/penguin-harness/pull/1116)

[中文版](2026-10-14-tool-loop-detection.zh.md)

A model that keeps issuing the same tool calls with the same arguments never reaches a final reply, and the ReAct loop is bounded only by `maxTurns` — which defaults to unlimited. A run that gets there does not fail: it works, forever, on the same call, and nothing in the stream says why.

## What it does

The engine keeps the **signature** of the last few turns that issued tool calls (the turn's `name:argsDigest` pairs, sorted, so the same calls in another order are the same signature). Four consecutive identical turns — a run of three plus the one before it — end the run with a **`tool_loop` cutoff**, and the stream says what stopped it:

```
[tool loop detected: the same tool calls (exec_command, exec_command) repeated across consecutive turns — stopping]
```

- **Four, not one.** A legitimate retry with the same arguments (a transient failure, a re-read) is not a loop; the window is what tells them apart.
- **Turn boundaries only.** The signature is taken from the calls a turn issued, so a model varying its arguments — or its tools — is untouched however long it works.
- **A new context is a fresh start**: the window is cleared when a context opens, like the turn count it sits beside.
- **`maxTurns` is unchanged** and still applies; this catches the case where it is unlimited, which is the default.

## Compatibility

`RunCutoff.kind` gains `"tool_loop"`. A consumer that switches exhaustively on the kind must handle it; the existing kinds behave exactly as before.
