# Command-policy denials name the rule

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1835](https://github.com/Prism-Shadow/penguin-harness/pull/1835)

[中文版](2026-11-24-command-policy-denial-rule.zh.md)

When a command-policy rule refused a tool call, the model read "Tool call denied by user." — a person's cancellation — even when nobody had been asked: a `deny` rule answered `"forbidden"` directly, and an unattended session (a desk or ticket session with no frontend to ask) denied an `ask` hit on the spot. The refusal now names the rule that caused it, so the model reads a rule refusal and changes course instead of treating it as a person's cancellation.

## Details

- A `deny` rule's `"forbidden"` and the unattended deny of a policy-reasoned call carry the matched rule's name to the engine, which renders ``Tool call denied by policy under rule `<rule>`.`` for the `"forbidden"` and ``Tool call denied by rule `<rule>`.`` for the `"deny"`.
- A person's own denial still reads "Tool call denied by user.", a bare `"forbidden"` reads "Tool call denied by policy.", and a `pre_tool_use` hook denial still names the hook and its reason.
- The `approval_decision` event is unchanged: it carries the plain decision string, and the rule is named where the model reads it, in the denied call's output.
