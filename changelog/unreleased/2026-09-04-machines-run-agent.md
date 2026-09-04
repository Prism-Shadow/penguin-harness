# Run an agent on another machine, and see its Sessions in one list

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-04-machines-run-agent.zh.md)

Pick a workspace that lives on another machine and the conversation runs there: that machine's server drives the agent, holds the messages, writes the trace, serves the terminal. The window never moves — it stays on this server and names the machine on the calls that concern it. The machine has to be connected, and connecting is the server's: a held connection never idles out, is re-established on its own when it drops, and is restored after a restart or a hot push, so once a machine is connected on the Machines page it stays reachable from every window.

## A Session's calls follow the machine that owns it

A Session lives on the server whose filesystem its workspace is on, so **every** call about it has to reach that machine, and there are two dozen such endpoints. Rather than thread a machine argument through all of them, the routing is a rule over the path: a request to `/api/sessions/<id>/…` goes wherever `<id>` was last seen. Call sites are unchanged, and a Session's machine is recorded in exactly two places — when a list hands one back, and when one is created. The output stream follows the same rule.

Two kinds of address escape a rule over the path and carry the machine by hand: the Trace endpoints, which name a Session inside an Agent-level path, and a Workspace file's content URL or a message attachment's scratchpad image, which are addresses rather than calls. Without that, every preview, image, PDF and download of a Session on a machine asked this server for a file it does not have.

Deliberately narrow: the project-scoped `…/agents/:a/sessions` listing is **not** session-scoped. It asks a server which Sessions it has, and answering it from another machine would be that machine answering a question about this one.

## The composer follows the machine

Agents are per-server, so the composer offers the Agents that exist on the machine the chosen workspace is on — not this server's, which would name one the target cannot run. What that machine was last seen running is offered while it is asked, and stays on offer if it cannot be reached, with the row saying so. Starting a chat from a Workspace group keeps that group's machine, since a workspace path without its machine names a different directory on every host.

## One list, several machines

The sidebar's Session list is every connected machine's, merged: each server pages its own rows with its own offsets, so the merge walks one page from each and orders them together rather than sharing a cursor that would ask one machine for rows only another had reached. Folder counts are summed across the servers that answered.

A machine that cannot be asked is recorded as such, and what it last held is shown from a cache until it answers again. That is what separates "this server has not got that Session" from "nobody who might have it answered" — so a Session on a machine that is out of reach reads as out of reach rather than gone, and the open conversation is not dropped for a Session whose machine is merely down.

## The list stays true without a reload

A Session created anywhere — the CLI, another tab, a schedule, an agent spawning a child — is announced on the user channel, and the list fetches the row rather than inventing it. Titles set through the API are announced the same way.

For Sessions on machines the list listens to each connected machine's own event stream through the proxy: a Session there changes state on **that** machine's server, and nothing else knows. A machine's own `web_updated` is ignored, since that is its web and not this window's.

## A terminal, and the files behind it

A terminal opens on the machine its Workspace is on, including the fall-back to home, which is home *there*, and it survives this app restarting: the shell lives on that machine's server, so what is restored is the tab. The list that restores it is assembled from every connected machine, and it only prunes a conversation's stored tabs once every source has answered. Opening a terminal adopts a shell already running on that conversation's own machine before it starts a second one beside it. The stream is this server's own: a remote pty is named in the terminal id as `<terminalId>@<machineId>@<userId>`, and the platform relays the socket through the held connection.

## Reach

Machines are an admin capability end to end: the Machines page, the proxy to a machine's API, and therefore everything here. A non-admin's list is this server's Sessions, exactly as before.
