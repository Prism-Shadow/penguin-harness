# Cancel child requests when Session removal starts

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1361](https://github.com/Prism-Shadow/penguin-harness/pull/1361)

[中文版](2026-10-26-cancel-subagents-on-removal.zh.md)

Session, Agent, and Project deletion and server shutdown cancelled live subagent runs before waiting for the main Task's interrupt cleanup. A slow main Task no longer left those children free to finish a tool turn and open another model request during that wait.

Environment disposal kept its existing order after the main Task settled. An ordinary Task stop continued to leave background subagents running.

Cancellation during child creation or initial metadata delivery now prevents the child from starting. A credential refresh keeps ownership of the replaced runtime's background work, so later Session, Agent, Project deletion and shutdown still cancel it and wait for cleanup. Failed reloads keep the previous runtime reachable.

Host and model requests that resumed a released child after cancellation or removal released the returned handle before answering, without starting another run.
