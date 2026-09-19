# Run an agent on another machine — its Sessions, Workspaces, Agents, Benchmarks, plugins and terminal, in this window

- **Date:** 2026-09-09
- **Type:** feature
- **Scope:** `core`, `server`, `web`
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

A machine that cannot be asked is recorded as such, and what it last held is shown from a cache until it answers again. That is what separates "this server has not got that Session" from "nobody who might have it answered" — so a Session on a machine that is out of reach reads as out of reach rather than gone, and the open conversation is not dropped for a Session whose machine is merely down. Opening one whose machine is down says which machine it is waiting on, and opens it once the connection is back.

## A Workspace is a directory on a machine

`/srv/app` on this server and `/srv/app` on a machine are two different directories, so a Workspace group in the sidebar is keyed by the machine and the path — one folder per machine, named for the machine it is on: `app [SSH: prod-1]`, with the same form on its tooltip and on the Workspace line of a Session's detail panel. This server's own groups are written as before — no suffix, the same keys — so collapse state, pins and group order carry over. Each folder's "+" creates on its own machine, its badge counts only that machine's answer, and its pages are asked only of the machine it is on.

The manually-added Workspaces match the pair as well: loading a Project keeps both machines' entries for one path, and renaming or removing one acts on that machine's entry alone, keeping its machine. An unlabelled machine (the machine list is admin-only, and a host can drop out of `~/.ssh/config`) falls back to its own id rather than inventing a name.

## The list stays true without a reload

A Session created anywhere — the CLI, another tab, a schedule, an agent spawning a child — is announced on the user channel, and the list fetches the row rather than inventing it. Titles set through the API are announced the same way.

For Sessions on machines the list listens to each connected machine's own event stream through the proxy: a Session there changes state on **that** machine's server, and nothing else knows. A machine's own `web_updated` is ignored, since that is its web and not this window's.

## The Agents page lists every machine's Agents

An Agent belongs to the Project, but its state directory is created on whichever machine it has run on, so one that has only ever run on a machine exists only over there. The Agents page asks this server and every machine it holds a connection to, and merges the answers by agent id: this server describes an Agent it also has, and one that lives on exactly one machine is named for it — `[SSH: prod-1]` beside the name, in the machine's own casing.

What such a card can do is what the machine can answer. **New chat** opens the draft against that machine, with the temporary workspace on it, so the conversation starts where the Agent's state is. Settings and its stat shortcuts, usage and delete read or write a state directory this server does not have, so they are inert, with the reason on hover rather than a 404 after the click.

## The Evaluation Center reads every machine this server holds

A Benchmark belongs to the Project, and the Project is the same on every machine it is lent to. Its `benchmarks/` directory is not: it is written on whichever machine created or evaluated the Benchmark, so one Benchmark's cases and scoreboard are spread over as many disks as it has run on. The card list and a Benchmark's own page ask this server and every connected machine and fold the answers by benchmark id: one card per Benchmark, one history under it. The machine rides along as attribution rather than as a grouping key — an evaluation row names the machine whose scoreboard recorded it (`[SSH: prod-1]`) when the Benchmark is held in more than one place, a Benchmark only one machine has is named for that machine, and its tested Agents are those of every scoreboard.

A scoreboard's append order *is* its evaluation sequence, and the page trusts it over the timestamps — but two scoreboards on two disks share no append order at all, so a joined history is ordered by time, and a Benchmark that came from a single machine is left exactly as its file had it. A Benchmark's Cases are the union of what the machines holding it have, and a Case's files are read from the machine its listing came from. A machine that cannot answer is left out of the merge; everything this server holds still renders, and only when no source answered at all is there an error to report. Creating and deleting stay on this server: delete is offered only for a Benchmark this server holds, and removes this server's copy.

## A terminal, and the files behind it

A terminal opens on the machine its Workspace is on, including the fall-back to home, which is home *there*, and it survives this app restarting: the shell lives on that machine's server, so what is restored is the tab. The list that restores it is assembled from every connected machine, and it only prunes a conversation's stored tabs once every source has answered. Opening a terminal adopts a shell already running on that conversation's own machine before it starts a second one beside it. The stream is this server's own: a remote pty is named in the terminal id as `<terminalId>@<machineId>@<userId>`, and the platform relays the socket through the held connection.

## Plugins, per machine

A Project's plugin list gained per-machine tables: a plugin listed for certain machines runs only on those machines. The Plugins page and the plugin settings in the Settings dialog each gained a machine picker, for viewing and editing each machine in turn.

### Configuration

- **`[plugins.<machineId>]`** sits under the shared `[plugins]` table in `.project_config.toml` and lists what one machine runs in addition to the shared table. For a name both tables list, the machine's entry wins. The key is the machine's own 16-character id, minted by its server on first boot, never an ssh alias. This server uses its own id too.
- **Loading** reads this server's effective list: the shared table plus its own table. A plugin listed only for other machines is not loaded here.

### API

- `POST /api/projects/:projectId/plugins/installed` accepts `machineId`, which lists the package in that machine's table. Like the shared table, it takes only a plugin the build ships.
- `DELETE …?specifier=…&machineId=…` drops the package from that machine's table. Without `machineId`, it drops it from every table.
- An edit that does not change what this server runs is written without re-assembling the App here.
- `GET` rows carry `everywhere`, `machines` and `here`, and the response carries this server's `machineId`.

### Fleet sync

- A machine is handed the shared table plus its own table. There, the list lands as that Project's shared table.
- A plugin the machine lacks is added through that machine's own `POST`, which takes only what its build ships. A plugin not listed for a machine is never sent there.
- A plugin the machine refuses is reported in the connect log and left out of that sync. The other plugins still arrive.

### Plugins page

- **Machine picker.** A picker beside the settings button switches between **All machines**, **This server** and each machine the Project reaches. It appears once there is any machine besides this server.
- **All machines** lists every plugin. A plugin listed for some machines only is tagged with their names.
- **A machine's view** lists what that machine is asked to run, in the state that machine itself reports. Installing there enables the plugin on that machine only. A plugin from the shared table cannot be removed there, and its row says so.

### Plugin settings

The Plugins page of the Settings dialog shows its picker once the Project holds a connection to another machine. Picking a machine reads, saves and runs actions on that machine's own plugin settings through `/server/<machineId>/api/admin/plugin-config`. Each server keeps its settings in its own database, and nothing is copied between machines. A machine that cannot answer shows an empty page with the reason.

## Reach

Machines are an admin capability end to end: the Machines page, the proxy to a machine's API, and therefore everything here. A non-admin's list is this server's Sessions, exactly as before.
