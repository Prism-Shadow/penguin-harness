# A status bar across the bottom of the Web App

- **Date:** 2026-10-22
- **Type:** feat
- **Scope:** `web`, `server`, `ui`
- **PR:** [#1286](https://github.com/Prism-Shadow/penguin-harness/pull/1286)

[中文版](2026-10-22-webui-bottom-status-bar.zh.md)

The Web App's window now ends in a status bar that spans its whole bottom — under the
navigation column and the dock alike, not only the main column. Its left side reads the machine
you are working on: whole-machine CPU utilization and used/total memory, nothing else (no disk),
refreshed by one request every 10 seconds and paused while the tab is hidden. Its right side
shows the counts `session: ${active} / ${viewed}` alone.

## Details

- The counts read as "how many sessions are active across every machine, added together" and
  "how many I have viewed". `active` is summed over this server and every connected machine:
  one poll (`POST /api/harness-status`, admin-only — a non-admin gets 403 and the bar never
  renders) asks each machine's own copy of the route, which answers its own sessions and its
  own machine's load and never fans out further. A machine that is not connected, or that runs
  a build from before this route existed, contributes nothing until it is connected and
  current — the same deal every other machine surface makes with an unreachable server.
- `viewed` is this browser's own count of the sessions you have opened — the same bookkeeping
  that decides the list, kept in localStorage and capped at 200 ids. A row's x stops keeping a
  session: it leaves the list and the count goes down by one. The session itself is untouched.
- The list is the sessions you have opened that the harness still holds — wherever in the
  harness they live, each row stamped with the machine it is on, and with the organization
  that holds it when one does — together with every active session, opened or not: a row you
  never opened rides the list only while the poll still reports it active, carries no x and
  no mark, and one click opens it with every current semantic. A session you opened that a
  poll first reads idle after a running one carries a one-time "Went idle" mark, until you
  open it again.
- Clicking a row moves the shell onto that session and asks the left column to catch up: a
  row of a company the sidebar is not on takes it there first (entering company mode if the
  shell is in development), a row no organization holds takes the shell back to the
  development list (leaving company mode when it stands in it), and then the sidebar unfolds
  the group the row lives in — its desk's group for a company session, or a ticket entry
  listed exactly as if it had been opened from its ticket — and brings the row into view. A
  company this shell's own organization list cannot show leaves everything as it was.
- The left side follows the machine of the session you viewed most recently: the load that
  matters is the load of whatever you last worked on, which for a company on its own machine
  is that machine. A machine that did not answer the poll shows no numbers rather than another
  machine's.
- CPU utilization is a ratio of two `os.cpus()` readings taken on demand on whichever machine
  is read; the first read of a process answers null and the bar shows a placeholder, and
  reads closer than 2 seconds apart serve a cached answer — no background timer, no dense
  polling.
- This round the bar is a fixed part of the Web App's layout; the seam is one component, so a
  plugin-provided bar can follow later.
