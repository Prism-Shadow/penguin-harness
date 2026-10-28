# A machine conversation's scheduled tasks are read and written on that machine

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1160](https://github.com/Prism-Shadow/penguin-harness/pull/1160)

[中文版](2026-10-15-machine-session-schedules.zh.md)

The scheduled-tasks panel and the sidebar's alarm mark of a conversation that runs on a machine
read and write that machine's tasks.

## Details

- The scheduled-tasks panel of a conversation on a machine lists that machine's tasks for it; the
  switch, edit, delete and a task created by hand are written on the machine, with the form using
  the machine's models and Workspaces.
- The sidebar marks a conversation on a machine with the alarm clock when a task on that machine
  is still to fire; the marks read this server's task list and the list of every machine whose
  conversations the sidebar shows.
- A machine's `schedule_fired` / `schedule_queued` events, relayed by this server, refresh that
  machine's list, and a turn that ends in a machine conversation re-reads the machine's list.
