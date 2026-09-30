# A machine connected after a tab opened joins that tab's machine event stream

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `server`

[中文版](2026-09-30-machine-events-attach-a-machine-connected-later.zh.md)

A tab's aggregate machine event stream (`GET /api/projects/:projectId/machines/events`) now picks up a machine this server connects to after the stream opened. Before, the stream subscribed only the machines connected, with a readable connection, at the moment it opened. The tab keeps that one stream for as long as it shows the Project, so a machine brought into use from the tab, re-held after a restart or a hot push, or whose ssh session was being reopened at that moment, sent none of its events to the tab until the page was reloaded.

- On each of its heartbeats (20 s) the stream reads again which of the Project's machines this server holds a connection to, and attaches any it does not carry yet.
- A machine already attached is not read again on each beat; once attached it is re-dialled after a failure as before.
- The aggregate stream's code moved out of `machines/event-hub.ts` into `machines/aggregate-stream.ts`.
