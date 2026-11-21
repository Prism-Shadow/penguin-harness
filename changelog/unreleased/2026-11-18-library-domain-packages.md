# Server domain code moves into library packages

- **Date:** 2026-11-18
- **Type:** refactor
- **Scope:** `server`, `core`, `web`, `cli`, `desktop`
- **PR:** [#1574](https://github.com/Prism-Shadow/penguin-harness/pull/1574)

[中文版](2026-11-18-library-domain-packages.zh.md)

The server's domain code moved out of the server package into thirteen library packages under `library/`: one package per domain (`db`, `setting`, `machine`, `messaging`, `organization`, `trace`, `observability`, `auth`, `project`, `session`, `agent-api`, `model`, `workbench`), each holding that domain's contracts and its repos, with a one-way dependency rule — a library package never imports the server. The server keeps assembling them and consumes them as plain workspace packages: they are private and are bundled into the server build, so no new package is published.

## Compatibility

The public HTTP/SSE API is unchanged, and the client-facing type entry points (`@prismshadow/penguin-server/api` and the other server subpaths) keep exporting the same names; the moved shapes are re-exported from where they used to live. One hot-push upgrade across this change rebuilds the running Agent state instead of adopting the predecessor's, because the state contract's interface identity changes with the move: that upgrade interrupts the sessions running at push time (a reload of the same page resumes them), and later pushes adopt state as before.
