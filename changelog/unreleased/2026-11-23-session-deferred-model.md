# Change a Session’s model after its current task

- **Date:** 2026-11-23
- **Type:** feat
- **Scope:** `server`, `core`
- **PR:** [#1723](https://github.com/Prism-Shadow/penguin-harness/pull/1723)

[中文版](2026-11-23-session-deferred-model.zh.md)

Callers can confirm a model change while a Session is busy by sending `whenIdle: true` to the model switch endpoint. Session details show the pending target alongside the current model. The handoff keeps its place among queued inputs. Choosing another model updates that target and leaves the active request running.
