# Machine Agent lists are read once and shared, and the Agents page and sidebar hold still

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1291](https://github.com/Prism-Shadow/penguin-harness/pull/1291)

[中文版](2026-10-22-machine-lists-cache.zh.md)

Each remote machine's Agent list is now read once and shared by the Agents page, the plugin
market and the sidebar, and kept across navigation and reloads. Nothing on these surfaces goes
back to a placeholder while a machine is asked again, connects, or answers slowly: shown text
changes only when the data does.

## Details

- One browser-side cache, keyed by Project, server and object, holds every per-machine read. Each
  key has at most one request in flight, and a late answer never replaces a newer one. A failed
  or pending read keeps the last answer on screen. An answer that carries the same data changes
  nothing that is shown.
- A machine is asked when a page mounts (unless it answered moments ago), when it connects, and
  after a write there. The Agents page and the sidebar share that request. A second machine
  connecting no longer re-asks the first, and the sidebar does not re-ask a machine that stayed
  connected.
- A machine's last list is remembered in browser storage as before, and is now shown from the
  first paint. A machine out of reach, or one whose read fails, keeps its cards as last seen,
  with the reason on the plug mark.
- On the Agents page, a connected machine's cards are greyed and inert until the machine answers
  in this page load. They carry no plug mark; their controls say the machine is being read. Back
  on the page later, they are live at once and re-read in the background.
- Deleting an Agent, a kernel update or an employment error no longer swaps the Agents page for
  its skeleton: the list stays on screen while it is read again.
- The sidebar shows its skeleton only before its first list. With no Sessions yet, a machine
  connecting, dropping out or naming its Agents no longer swaps "No Sessions yet" for skeleton
  rows and back.
- What each Agent has installed can now be remembered in browser storage
  (`penguin.agentInstalls.*`), for the plugin market. Like the machine lists, it belongs to this
  installation and is not carried to a new data root.
