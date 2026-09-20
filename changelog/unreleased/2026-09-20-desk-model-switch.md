# Company mode: switching the model on a desk moves the desk

- **Date:** 2026-09-20
- **Type:** fix
- **Scope:** `web`
- **PR:** [#807](https://github.com/Prism-Shadow/penguin-harness/pull/807)

[中文版](2026-09-20-desk-model-switch.zh.md)

`/model` in a desk conversation forked it like any other conversation: a new ordinary Session of the employee's Agent on the picked model, which the window then moved to. The employee's model in the chart and the desk recorded in `desks.toml` stayed as they were — so the organization kept sending its calendar rounds and @mentions to the old Session on the old model, the sidebar's desk still opened that one, and the Session the person was now talking in was listed by no page of the organization.

On the employee's current desk the switch is now the employee's: the picked model is written to its chart entry (what every later desk and ticket Session of that employee is opened on), the desk is renewed onto it, and the carried-over first input goes to the new desk. The chart and the desk list are reloaded, so the sidebar follows. A ticket's work Session, or a desk that has already been replaced, still forks as before.
