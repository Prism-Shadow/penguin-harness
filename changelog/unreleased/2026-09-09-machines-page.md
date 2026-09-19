# The Machines page: use a machine, stop using it, and open a workspace on it

- **Date:** 2026-09-09
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#448](https://github.com/Prism-Shadow/penguin-harness/pull/448)

[中文版](2026-09-09-machines-page.zh.md)

The page that drives all of it. A machine is something this Project runs agents on: **Use** one and this server installs the program, starts it, connects, hands over the Model config and stays connected; **Stop using** it and the machine is let go. Machines can also be picked in the workspace picker, so a Session can be started in a directory on another machine.

**Not reachable yet.** The sidebar row, the route and the picker's machine row are held back deliberately, and turned on in one change of their own once the feature has settled. What lands here is the page itself.

## The window never moves

A call that names a machine is rewritten to `/server/<machineId>/api/…`, which the local server forwards. There is deliberately **no window-wide "active server" mode**. One existed and was removed: pointing an entire window at another machine put every page behind a tunnel, `/api/me` included — so a tunnel that dropped left the app unable to answer whether anyone was logged in, and the control for getting back was rendered inside the layout that never mounted. An escape hatch behind the thing that breaks is not an escape hatch.

Naming the machine on the calls that actually concern it has no such failure: a dead tunnel breaks exactly the request that needed it, and says so. One string rule covers `fetch` and the SSE subscriptions alike.

## Two verbs, one sentence per machine

**Use** does everything a machine needs to run agents — install or update the program, start its server, connect, hand over the Model config — as one job, and **Stop using** lets it go. Each card says where the machine is in plain words ("Connected and ready", "Its server is not running — Use starts it"), and every sentence that names a problem is fixed by the same button. Install, update, restart, connect and disconnect are not separate controls a person has to order by hand.

- One card per machine, this server first, sorted by name so an update or a probe never moves one. A card at rest is two lines: the name, and the state with the one detail beside it — when it was last checked, the build it carries when that is behind this server's, the far side's words when it failed. The dot at the card's edge is blue for a live connection, amber and red for what needs a person, grey for settled.
- Selection is the card: click one to select it. Select all, select none, **Use** (a plug) and **Stop using** (the plug pulled) are glyphs alone in a bar that keeps a fixed slot between the title and the cards, so nothing moves when a selection appears or goes; the word stays as the tooltip and the accessible name. A batch works several machines at once on the server; the rest queue behind them.
- A queued or working card grows a stepper under its name, one segment per step of the pipeline (check, install, hand over, restart, connect, sync), fed by the step the server says it is on.
- The chevron unfolds the card: the build, the install date, the server's state and port, the last check, the machine id, the **server root** on that machine (`PENGUIN_HOME` — the profile decides it, so a dev instance reaches a machine's dev installation and never the release one beside it), the job's full output, and the forced install when a job offers it. The forced install ("Install anyway and restart") is offered on every failed install or connect except the run that was itself that install and the one failure installing cannot mend — this server having no build of its own to send — and it still warns that it interrupts whoever is using that machine.
- Machines not yet in use live behind **Add machines…**, a search over the server's ssh config: the first matches, a fold for the rest, and a confirmation once something is picked. Picking several and confirming uses them all.
- Once a machine is connected, staying connected is the server's job: a machine that drops and does not come back is retried on a widening wait — from a minute up to fifteen — until it is held again or someone stops using it. Restarting the server no longer leaves machines disconnected until someone visits the page.
- The header shows this server's build and, when any machine in use is behind it, **Update all**, which brings every one of them forward and reconnects it in one tap.
- The server answers `POST /api/projects/:projectId/machines/use` with `{ machines: [...] }` (a few machines at once, the rest queued, `202`; refusals that need no ssh come back by id) and `POST .../machines/stop-using`. The list carries `jobs`: every queued, running and last-finished job per machine, each with the pipeline step it is on (`phase`). The per-machine install, connect, restart, release and disconnect routes remain.

## Declaring an ssh host from the page

A machine that is not in the server's ssh config yet can be declared from the page. The **+** at the foot of the **Add machines…** panel opens a short form — alias, address, and optionally user, port and key file — and the server appends the matching `Host` block to its own `~/.ssh/config`. The new host then appears under **Add machines…** like any other.

- The block is written in ssh's own syntax, led by a comment naming PenguinHarness and the time, so a person reading the file later knows which lines are not theirs. The directory and file are created with the modes ssh requires when they do not exist yet.
- Values must each be one word with no `#`, the alias must not be a pattern, and the port must be a whole number from 1 to 65535. The form says so under the field before anything is sent. An alias the config already declares is refused: ssh would take the earlier block and silently ignore the new one.
- A host this app wrote can be reconfigured: the gear in a card's details opens the same form on the block read back, and saving rewrites it in place. A block written by hand is shown but not saved — it may carry options the form does not know — and the form points at the file instead.
- The server answers `POST /api/projects/:projectId/machines/ssh-hosts` with the machines list (`201`), `400 ssh_host_invalid` naming the field, or `409 ssh_host_exists`; `GET …/ssh-hosts/:alias` reads a block back with whether it may be rewritten, and `PUT …/ssh-hosts/:alias` rewrites one this app wrote (`404` none, `409 ssh_host_foreign` hand-written). Admin only, like the rest of the group.

## Picking a workspace on a machine

A workspace is a directory **on** a machine, so only one whose filesystem is reachable right now can be browsed: this one always, any other with a held connection. Every machine in use is **listed regardless**, the unreachable ones disabled with the reason at the row — a list that silently omits its answer is indistinguishable from a broken feature.

Machines are identified by their own id and labelled by ssh alias, so a renamed host keeps its workspaces.

## A machines table from before its migration

A data root that ran the machines line before it was released has machines tables adopted with the columns they had — migration 4 creates them with `IF NOT EXISTS` — so a connect failed at "Opening the connection…" with `table machines has no column named session_pid`. Migration 5, `machines-columns`, adds `session_pid` and `platform` to a machines table that lacks them and leaves one that has them alone. Additive and swap-safe, so a hot push applies it; its undo does nothing, since migration 4 declares the same columns.

## Reach

Machines are an admin capability end to end: the page, every route in the group, and the proxy to a machine's API.
