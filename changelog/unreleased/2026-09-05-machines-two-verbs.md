# Machines: use it, or stop using it

- **Date:** 2026-09-05
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#622](https://github.com/Prism-Shadow/penguin-harness/pull/622)

[中文版](2026-09-05-machines-two-verbs.zh.md)

The Machines page is now two verbs and one sentence per machine. **Use** does everything a machine needs to run agents — install or update the program, start its server, connect, hand over the Model config — as one job, and **Stop using** lets it go. Each row says where the machine is in plain words ("Connected and ready", "Its server is not running — Use starts it"), and every sentence that names a problem is fixed by the same button. Install, update, restart, connect and disconnect are no longer separate controls a person has to order by hand.

## Details

- The page is a table: machine, its state in one word, the build it carries, when it was last checked. This server is the first row. A build behind this server's is an amber chip, and **Use** sits at the end of only the rows that need it.
- Selection is the row: click one to select it, and every machine in use starts selected, so "make them all work" and "let them all go" are one tap each from the bar that floats over the table while something is selected. A batch is queued on the server one machine after another.
- A queued or working row grows a stepper under its name, one segment per step of the pipeline (check, install, hand over, restart, connect, sync), fed by the step the server says it is on.
- The ⓘ at a row's end opens the machine's record and the job's full output in a pane beside the table, or a sheet on a phone.
- Machines not yet in use live behind **Add machines…**, a search over the server's ssh config. Picking several and confirming uses them all.
- Once a machine is connected, staying connected is the server's job: a machine that drops and does not come back is retried on a widening wait — from a minute up to fifteen — until it is held again or someone stops using it. Restarting the server no longer leaves machines disconnected until someone visits the page.
- The forced install ("Install anyway and restart") is offered only on a row whose job failed, as before, and still warns that it interrupts whoever is using that machine.
- The header shows this server's build and, when any machine in use is behind it, **Update all**, which brings every one of them forward and reconnects it in one tap.
- The server answers `POST /api/projects/:projectId/machines/use` with `{ machines: [...] }` (queued, `202`; refusals that need no ssh come back by id) and `POST .../machines/stop-using`. The list now carries `jobs`: every queued, running and last-finished job per machine, each with the pipeline step it is on (`phase`). The per-machine install, connect, restart, release and disconnect routes remain.
