# The Machines page, and a workspace on another machine

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `web`
- **PR:** [#448](https://github.com/Prism-Shadow/penguin-harness/pull/448)

[中文版](2026-09-01-machines-page.zh.md)

The page that drives all of it: install, connect, restart, disconnect, with the far side's own words in the log. Machines can also be picked in the workspace picker, so a Session can be started in a directory on another machine.

**Not reachable yet.** The sidebar row, the route and the picker's machine row are held back deliberately, and turned on in one change of their own once the feature has settled. What lands here is the page itself.

## The window never moves

A call that names a machine is rewritten to `/server/<machineId>/api/…`, which the local server forwards. There is deliberately **no window-wide "active server" mode**. One existed and was removed: pointing an entire window at another machine put every page behind a tunnel, `/api/me` included — so a tunnel that dropped left the app unable to answer whether anyone was logged in, and the control for getting back was rendered inside the layout that never mounted. An escape hatch behind the thing that breaks is not an escape hatch.

Naming the machine on the calls that actually concern it has no such failure: a dead tunnel breaks exactly the request that needed it, and says so. One string rule covers `fetch` and the SSE subscriptions alike.

## Probing on a widening schedule

Each probe is an ssh round trip per installed machine, so the interval widens as the answers stop changing: 15s, 30s, 45s, a minute, two, three… up to ten. **Any change resets it to the first step** — a server that just went down, or an install that just finished, is the moment the next few answers matter most.

The timestamp is deliberately not part of what counts as a change: every probe moves it, so including it would pin the interval at 15 seconds forever, which is the bug the fingerprint exists to avoid.

The schedule lives in the page, not the server. A timer over there would keep spawning ssh long after the last tab closed, and with nothing installed anywhere no timer runs at all.

## Picking a workspace on a machine

A workspace is a directory **on** a machine, so only one whose filesystem is reachable right now can be browsed: this one always, any other with a live forward. Every installed machine is **listed regardless**, the unreachable ones disabled with the reason at the row — a list that silently omits its answer is indistinguishable from a broken feature.

Machines are identified by their own id and labelled by ssh alias, so a renamed host keeps its workspaces.

## What the rows say

Install and adopt are one button: from where a person stands, both answer "make this machine usable here", and only one of them costs a transfer. A machine's row separates the three facts the server reports rather than merging them — the forward this side holds, the last probe of its server, and whether its API actually answered — because a live forward to a dead server reading as "connected" is the loop this whole feature was rebuilt around.
