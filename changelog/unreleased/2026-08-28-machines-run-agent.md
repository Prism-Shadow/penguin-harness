# Run an agent on another machine, and see its Sessions in one list

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#450](https://github.com/Prism-Shadow/penguin-harness/pull/450)

[中文版](2026-08-28-machines-run-agent.zh.md)

Pick a workspace that lives on another machine and the conversation runs there: that machine's server drives the agent, holds the messages and writes the trace. The window never moves — it stays on this server and names the machine on the calls that concern it.

## A Session's calls follow the machine that owns it

A Session lives on the server whose filesystem its workspace is on, so **every** call about it has to reach that machine, and there are two dozen such endpoints. Rather than thread a machine argument through all of them, the routing is a rule over the path: a request to `/api/sessions/<id>/…` goes wherever `<id>` was last seen. Call sites are unchanged, and a Session's machine is recorded in exactly two places — when a list hands one back, and when one is created. The output stream follows the same rule.

The mapping is in memory: it is rebuilt by the very list that displays the Sessions, and an entry surviving a reload would route a call at a machine that may no longer own — or no longer have — that Session.

Deliberately narrow: the project-scoped `…/agents/:a/sessions` listing is **not** session-scoped. It asks a server which Sessions it has, and answering it from another machine would be that machine answering a question about this one.

## The composer follows the machine

Agents are per-server, so the composer offers the Agents that exist on the machine the chosen workspace is on — not this server's, which would name one the target cannot run. Starting a chat from a Workspace group keeps that group's machine, since a workspace path without its machine names a different directory on every host.

## One list, several machines

The sidebar's Session list is every machine's, merged: each server pages its own rows with its own offsets, so the merge walks one page from each and orders them together rather than sharing a cursor that would ask one machine for rows only another had reached.

A machine that cannot be asked is recorded as such. That is what separates "this server has not got that Session" from "nobody who might have it answered" — so a Session on a machine that is down reads as out of reach rather than gone, and a machine that flaps does not empty the list.

## Connected on first need, updated on connect

Picking a workspace on an installed machine connects to that machine by itself: the composer asks it for its Agents, and a machine with no live forward is raised rather than reported. The attempt retries on a doubling schedule — 2 s, 4 s, … 64 s — and then gives up, once per machine per page load; the composer says which of the three it is in (connecting, reachable, beyond reach), and the Machines page is where a person takes over after that. The Session list re-asks which machines answer the moment one comes up, so its Sessions join the list without a reload.

Connecting also hands the machine this server's build when it carries a different one — over the forward just raised, before the Model config is synced. Only the hot channel is automatic: a swap is seconds and stops nothing. A hand-over the machine will not take is reported as the connect job's failure, with the reinstall offered as the next step; the forward stays up, since the machine is connected either way. That step remains a person's, because it restarts a server other people may be on.

## A terminal, and the files behind it

A terminal opens on the machine its Workspace is on, and it survives this app restarting: the shell lives on that machine's server, so what is restored is the tab. The list that restores it is assembled from every reachable machine, and it only prunes a conversation's stored tabs once every source has answered — a fresh page that has reached this server alone knows nothing yet about shells alive elsewhere. Opening a terminal adopts a shell already running on that conversation's own machine before it starts a second one beside it.

A Workspace file's address follows the Session too. Content URLs and a message attachment's scratchpad URL are addresses rather than calls, so the routing rule above never touched them, and every preview, image, PDF and download asked this server for a file on another machine. They now carry the machine themselves. (One gap remains: "open in new tab" for an isolated HTML preview is a redirect to a preview origin, and the proxy deliberately drops `Location`. The preview inside the app is unaffected.)

## The list stays true without a reload

A Session created anywhere — the CLI, another tab, a schedule, an agent spawning a child — is announced on the user channel, and the list fetches the row rather than inventing it. Titles set through the API are announced the same way.

For Sessions on machines the list listens to each reachable machine's own event stream through the proxy: a Session there changes state on **that** machine's server, and nothing else knows. The streams follow the reachable set — closed when a machine drops out, opened when one comes up — and a machine's own `web_updated` is ignored, since that is its web and not this window's.

## Connecting is confirmed, not assumed

An attempt counts as connected only once the machine itself has answered, not when the machine list reports a forward: a forward is an ssh child on this side and outlives the far server, so trusting it declared success over a dead machine — and, since success is deliberately not remembered, the next need started another attempt, forever. A machine that never answers now takes the connect job, which is what starts a server that is down, and then walks the widening schedule to its remembered give-up.

## Reach

Machines are an admin capability end to end: the Machines page, the proxy to a machine's API, and therefore everything here. A non-admin's list is this server's Sessions, exactly as before.
