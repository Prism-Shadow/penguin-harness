# Machines: add an ssh host from the page

- **Date:** 2026-09-05
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** _pending_

[中文版](2026-09-05-machines-ssh-hosts.zh.md)

A machine that is not in the server's ssh config yet can now be declared from the Machines page. The **+** beside **Add machines…** opens a short form — alias, address, and optionally user, port and key file — and the server appends the matching `Host` block to its own `~/.ssh/config`. The new host then appears under **Add machines…** like any other.

## Details

- The block is written in ssh's own syntax, led by a comment naming PenguinHarness and the time, so a person reading the file later knows which lines are not theirs.
- Values must each be one word with no `#`, the alias must not be a pattern, and the port must be a whole number from 1 to 65535. The form says so under the field before anything is sent.
- An alias the config already declares is refused: ssh would take the earlier block and silently ignore the new one.
- The directory and file are created with the modes ssh requires when they do not exist yet.
- The server answers `POST /api/projects/:projectId/machines/ssh-hosts` with the machines list (`201`), `400 ssh_host_invalid` naming the field, or `409 ssh_host_exists`. Admin only, like the rest of the group.
