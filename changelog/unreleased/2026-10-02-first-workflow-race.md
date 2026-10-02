# A workflow written while its watcher was starting is loaded anyway

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `server`

[中文版](2026-10-02-first-workflow-race.zh.md)

The workflow service re-reads what a watcher covers once, a settle window after creating it: the Agent's directory (has `workflows/` appeared?) for the watcher that waits for a first workflow, and every folder under `workflows/` (loaded where its content is not what is loaded or loading) for the watcher on that folder. On macOS a watcher is blind in the first moments after it is created — libuv recreates the process's one FSEvents stream on another thread each time a watcher is added — and an Agent writing its first workflow in one burst used to land in that window: the folder appeared, nothing reported it, and it was never loaded until somebody listed the workflows again.

## Details

- Directory watching is a runtime capability (`FileWatch`, `fs.watch` by default) that a test replaces; the server suite stands in real watchers whose events reach nobody and shows both re-reads loading the workflow.
- The first-workflow case creates an Agent with an id of its own per attempt, so the retry CI gives a macOS failure no longer fails on the Agent the first attempt made.
