# Cancel child requests when Session removal starts

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1361](https://github.com/Prism-Shadow/penguin-harness/pull/1361)

[中文版](2026-10-26-cancel-subagents-on-removal.zh.md)

A child whose creation or revival is still pending when its caller is cancelled releases its handle before the tool returns. Removing the parent during startup also prevents the child from starting its first model request.

When credentials change, a reloaded Session retains ownership of background work started by its previous runtime. Deleting the Session, Agent or Project, or shutting down the server, cancels that work and waits for cleanup. Stopping an ordinary Task leaves its detached children running.
