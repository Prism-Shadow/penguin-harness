# Run an agent on another machine, and see its Sessions in one list

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `web`
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

## Reach

Machines are an admin capability end to end: the Machines page, the proxy to a machine's API, and therefore everything here. A non-admin's list is this server's Sessions, exactly as before.
