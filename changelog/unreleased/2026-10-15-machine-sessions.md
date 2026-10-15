# A machine's Sessions read from that machine, and its earlier Sessions are filed as CLI tasks

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `server`, `web`, `ui`
- **PR:** [#1155](https://github.com/Prism-Shadow/penguin-harness/pull/1155)

[中文版](2026-10-15-machine-sessions.zh.md)

A conversation that runs on a machine now reads that machine's memory and models, the archive page
lists the archived chats of an admin's machines with a source pill on every row, and the Sessions
a machine already held when this server adopted it are filed away as CLI tasks.

## Details

- The memory panel of a Session on a machine lists and opens that machine's memory for its Agent;
  its "manage" link goes to that Agent's settings page on the machine (`?machine=`).
- A new chat whose workspace is on a machine offers that machine's models, default model, and its
  Agent's thinking level and skills; picking a local workspace switches back. A conversation on a
  machine switches and prices models by the machine's list, reads and writes the thinking level and
  compaction threshold of the machine's Agent, and opens that Agent's settings page.
- A machine's Workspace group in the sidebar keeps `[SSH: alias]` visible in a narrow column and
  shortens the name instead (`GroupHeader` takes a `qualifier`).
- The first config sync to a freshly installed machine waits for the machine to finish provisioning
  `default_project` instead of failing with `project_exists`, so this server's models land there on
  the first connect.
- The archive page shows the source of every row in a pill, a person's conversation included.
  For an admin it also lists the archived chats of the connected machines that their Projects use,
  each machine group marked `[SSH: alias]`; unarchive and delete act on the machine, and a machine
  that could not be read is named above the list. Archive is offered again on machine rows in the
  sidebar.
- This server records when it adopted a machine (`machines.adopted_at`, migration 19, written when
  it first records the machine, and again when the alias answers with another machine's id) and
  sends it as `X-Penguin-Adopted-At` on every proxied or own call. The machine reads Sessions created before that time — a person's, or one whose source
  is not resolved — as source `cli` for that request, so they appear archived with the CLI pill until
  unarchived. Nothing stored on either side is rewritten, and the machine's own pages and CLI see
  what they saw before. Machines recorded before this change keep no adoption time and nothing on
  them is archived; no later connection or sync gives them one.
