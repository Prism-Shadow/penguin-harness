# Run an agent on another machine — its Sessions, Workspaces, Agents, Benchmarks and terminal, in this window

- **Date:** 2026-09-09
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#450](https://github.com/Prism-Shadow/penguin-harness/pull/450)

[中文版](2026-09-09-machines-run-agent.zh.md)

Pick a workspace that lives on another machine and the conversation runs there: that machine's server drives the agent, holds the messages, writes the trace, serves the terminal. The window never moves — it stays on this server and names the machine on the calls that concern it. The machine has to be connected, and connecting is the server's: a held connection never idles out, is re-established on its own when it drops, and is restored after a restart or a hot push, so once a machine is connected on the Machines page it stays reachable from every window.

## A Session's calls follow the machine that owns it

A Session lives on the server whose filesystem its workspace is on, so **every** call about it has to reach that machine, and there are two dozen such endpoints. Rather than thread a machine argument through all of them, the routing is a rule over the path: a request to `/api/sessions/<id>/…` goes wherever `<id>` was last seen. Call sites are unchanged, and a Session's machine is recorded in exactly two places — when a list hands one back, and when one is created. The output stream follows the same rule.

Two kinds of address escape a rule over the path and carry the machine by hand: the Trace endpoints, which name a Session inside an Agent-level path, and a Workspace file's content URL or a message attachment's scratchpad image, which are addresses rather than calls. Without that, every preview, image, PDF and download of a Session on a machine asked this server for a file it does not have.

Deliberately narrow: the project-scoped `…/agents/:a/sessions` listing is **not** session-scoped. It asks a server which Sessions it has, and answering it from another machine would be that machine answering a question about this one.

## The composer follows the machine

Agents are per-server, so the composer offers the Agents that exist on the machine the chosen workspace is on — not this server's, which would name one the target cannot run. What that machine was last seen running is offered while it is asked, and stays on offer if it cannot be reached, with the row saying so. Starting a chat from a Workspace group keeps that group's machine, since a workspace path without its machine names a different directory on every host.

Switching the model stays on the machine too. The switch opens a new Session for the same Agent on the picked model and carries the source Session's Workspace so the files it refers to stay reachable — and that Workspace is a directory on the machine, so the new Session is created there, its first task (the `[model_switch_from]` block and the user's text) is posted there, and the trace the model reads for context is on the disk it is served from.

## One list, several machines

The sidebar's Session list is every connected machine's, merged: each server pages its own rows with its own offsets, so the merge walks one page from each and orders them together rather than sharing a cursor that would ask one machine for rows only another had reached. Folder counts are summed across the servers that answered.

A machine that cannot be asked is recorded as such, and what it last held is shown from a cache until it answers again. That is what separates "this server has not got that Session" from "nobody who might have it answered" — so a Session on a machine that is out of reach reads as out of reach rather than gone, and the open conversation is not dropped for a Session whose machine is merely down.

## A Workspace is a directory on a machine

`/srv/app` on this server and `/srv/app` on a machine are two different directories, so a Workspace group in the sidebar is keyed by the machine and the path — one folder per machine, named for the machine it is on: `app [SSH: prod-1]`, with the same form on its tooltip and on the Workspace line of a Session's detail panel. This server's own groups are written as before — no suffix, the same keys — so collapse state, pins and group order carry over. Each folder's "+" creates on its own machine, its badge counts only that machine's answer, and its pages are asked only of the machine it is on.

The manually-added Workspaces match the pair as well: loading a Project keeps both machines' entries for one path, and renaming or removing one acts on that machine's entry alone, keeping its machine. An unlabelled machine (the machine list is admin-only, and a host can drop out of `~/.ssh/config`) falls back to its own id rather than inventing a name.

## The list stays true without a reload

A Session created anywhere — the CLI, another tab, a schedule, an agent spawning a child — is announced on the user channel, and the list fetches the row rather than inventing it. Titles set through the API are announced the same way.

For Sessions on machines the list listens to each connected machine's own event stream through the proxy: a Session there changes state on **that** machine's server, and nothing else knows. A machine's own `web_updated` is ignored, since that is its web and not this window's.

## The Agents page lists every machine's Agents

An Agent belongs to the Project, but its state directory is created on whichever machine it has run on, so one that has only ever run on a machine exists only over there. The Agents page asks this server and every machine it holds a connection to, and merges the answers by agent id: this server describes an Agent it also has, and one that lives on exactly one machine is named for it — `[SSH: prod-1]` beside the name, in the machine's own casing.

What such a card can do is what the machine can answer. **New chat** opens the draft against that machine, with the temporary workspace on it, so the conversation starts where the Agent's state is. Settings and its stat shortcuts, usage and delete read or write a state directory this server does not have, so they are inert, with the reason on hover rather than a 404 after the click.

## The Evaluation Center reads every machine the Agent runs on

An Agent is one identity across the machines it runs on — this Project's `default_agent` here and on a machine is that Agent, not two of them. Its `benchmarks/` directory is not: it is written on whichever machine the evaluation ran, so one Agent's case library and scoreboard are spread over as many disks as it has been evaluated on. The Evaluation Center asks this server and every connected machine and folds the answers by benchmark id: one entry per Benchmark, one history under it. The machine rides along as attribution rather than as a grouping key — an evaluation row names the machine whose scoreboard recorded it (`[SSH: prod-1]`) when the Benchmark was evaluated in more than one place, and a Benchmark only one machine has is named for that machine.

A scoreboard's append order *is* its evaluation sequence, and the page trusts it over the timestamps — but two scoreboards on two disks share no append order at all, so a joined history is ordered by time, and a Benchmark that came from a single machine is left exactly as its file had it. The tree is the union too, built from the same merged Agent list as the Agents page, so an Agent that only exists on a machine has a row to hang its Benchmarks off. A Benchmark's Cases are the union of what those machines hold, and a Case's files are read from the machine its listing came from. A machine that cannot answer is left out of the merge, which is what "could not read it" means; everything this server holds still renders, and only when no source answered at all is there an error to report.

## A terminal, and the files behind it

A terminal opens on the machine its Workspace is on, including the fall-back to home, which is home *there*, and it survives this app restarting: the shell lives on that machine's server, so what is restored is the tab. The list that restores it is assembled from every connected machine, and it only prunes a conversation's stored tabs once every source has answered. Opening a terminal adopts a shell already running on that conversation's own machine before it starts a second one beside it. The stream is this server's own: a remote pty is named in the terminal id as `<terminalId>@<machineId>@<userId>`, and the platform relays the socket through the held connection.

## Reach

Machines are an admin capability end to end: the Machines page, the proxy to a machine's API, and therefore everything here. A non-admin's list is this server's Sessions, exactly as before.
