# A Workspace is a directory on a machine

- **Date:** 2026-09-08
- **Type:** fix
- **Scope:** `web`
- **PR:** [#450](https://github.com/Prism-Shadow/penguin-harness/pull/450)

[中文版](2026-09-08-a-workspace-is-a-directory-on-a-machine.zh.md)

`/srv/app` on this server and `/srv/app` on a machine are two different directories. The sidebar keyed its Workspace groups on the path alone, so once the Session list started merging several machines, two of them arrived as one folder — and everything that folder does went to the wrong place. Its "+" opened a chat here, in whatever this machine happens to have at that path (nothing, or worse, something). Its badge was the two machines' counts added together, contradicting the rows underneath it. Its "load more" was asked of every machine, so it could offer more rows that belong to another machine's folder and never arrive in this one.

A group is now keyed by the machine and the path, one folder per machine, and it is named for the machine it is on: `app [SSH: prod-1]`, with the same form on its tooltip and on the Workspace line of a Session's detail panel. This server's own groups are written exactly as before — no suffix, and the same keys — so collapse state, pins and group order survive the change untouched. Each folder's "+" creates on its own machine, its badge counts only that machine's answer, and its pages are asked only of the machine it is on.

The sidebar's manually-added Workspaces store the machine already, but every lookup over them matched on the path: loading a Project kept whichever of two same-path entries came first and dropped the other for good, renaming one renamed the other machine's — and rewrote the entry without its machine, moving it here — and removing one removed both. Each of those now matches the pair.

An unlabelled machine (the machine list is admin-only, and a host can drop out of `~/.ssh/config`) falls back to its own id rather than inventing a name.
