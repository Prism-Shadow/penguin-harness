# Web App: chat UX batch — password notice, process list, draft conversations, panel sequencing, queued-send correctness

## Startup initial-password notice (server + CLI)

The seeded admin password is persisted in `<root>/initial-admin-password` (0600) while it remains the initial one. Every server start re-prints it framed in ASCII with a change-it reminder, and `penguin web` attaching to an already-running instance prints the same notice (new side-effect-free subpath export `@prismshadow/penguin-server/initial-password`). Any admin password update — self change, desktop set, or an admin reset — deletes the file; legacy roots without the file stay silent. Docs (`quickstart` / `web-app` / `server-api`, READMEs) updated.

## Conversation details: merged stats entry, process list, trace file row

The Token / cost / elapsed chips move to the toolbar's far right and are themselves the details trigger on `sm+` viewports (below `sm`, only the info icon shows). While the conversation has live background processes, a green running-services count rides right of the elapsed chip. The details card shows Model / Workspace / created time / stats one per line (tokens with an input / cached / output breakdown), then an interactive process list (cmd, start time, pid; the stop button kills the whole process group) and a trace-file row naming the actual `.jsonl` path with a deep link to the trace page (replacing the "view trace" button).

## Background-process plumbing and lifecycle (core + server)

`ManagedSession` keeps `cmd`/`cwd`/`startedAt` and exposes `pid`; the registries gain enumeration and kill-by-id; core `Session`/`Environment` expose `listBackgroundCommands()` / `killBackgroundCommand()`; new routes `GET /api/sessions/:id/processes` and `POST /api/sessions/:id/processes/:processId/kill` (active runtime only). Deleting a Session/Agent/Project now disposes the runtime after its drive settles — background processes die with the conversation — and idle eviction skips entries with live background processes (eviction would strand the OS process with no remaining stop control).

## Parked draft conversations

Clicking any new-chat entry point while the composer holds typed text parks the draft as a row in a new sidebar Drafts group (per user × Project in localStorage, newest first, cap 50). Rows open at `/chat/draft-<id>` with all selections restored, can be edited (auto-saved), sent (becomes a real session, row removed), or deleted (confirm dialog). The skills quick-invoke / import prompts park instead of silently overwriting typed text.

## Panel and stream polish

Opening the workspace panel while the agents panel is open (or vice versa) retracts the open panel fully before sliding the new one in, so the swap reads as a real retract instead of a wipe; mobile Sheets keep the instant switch. A ResizeObserver re-snaps the message stream to the bottom (under the existing follow guards) when the container or content resizes outside a stream commit — the initial-password banner no longer leaves a fresh conversation sitting a banner-height above the bottom. The benchmark case browser expands both material groups by default and pins the readme auto-preview to the statement group; clicking the composer's read-only model chip toasts that `/model` switches models.

## Queued follow-up correctness

Two races around the mid-run send path are fixed: a `/steer` that returns `409 not_running` during the completion boundary now re-routes the whole draft through the existing `queueIfBusy` Task path instead of a bare `POST /tasks` that could land `409 task_in_progress` and drop the draft (#227, closes #89); and the per-turn thinking level picked in the composer now rides the follow-up queue path too — previously `onQueueFollowUp` posted only the input, silently dropping the level on the very send it was picked for (#246).
