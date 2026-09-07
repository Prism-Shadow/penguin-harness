# Two things the Machines page said during an outage that were not true

- **Date:** 2026-09-07
- **Type:** fix
- **Scope:** `server`, `web`

[中文版](2026-09-07-machine-linked-but-stopped.zh.md)

A machine card read **Connected** whenever this server held an ssh session to it — even when the last probe had found no server running over there, which the card's own unfolded details said in the next breath.

The two facts are deliberately separate: the connection is a process on *this* side and outlives the far server, so it says the tunnel has somewhere to go, never that anything answers. Reading one for the other is what once produced a reconnect loop. The card was making the same mistake in the other direction — and worse, silently: because the row looked ready, **Enable** was withheld, so the one action that would start the far server again was hidden by the same bug that hid the fault.

A held connection over a stopped server now reads *Connected, not serving* in the attention tone, and offers Enable. A held connection over an unreachable machine reads Unreachable, with ssh's own words.

Found on a real fleet: a machine's server could not bind its port, and the page insisted everything was fine while nothing on it worked.

## …and a plugin sync that contradicted the line above it

A connect printed both of these, one after the other:

```
Models synced: default_project.
Plugins of default_project not synced — that machine has no such Project
```

Both cannot be true, and the second was wrong. A machine on a build older than the Project plugin list answers 404 to a route it has never heard of, and the sync read every 404 as a missing Project. It now asks the one question every build can answer — does it list the Project? — and says which of the two it is: an older build to update, or a Project that really is not there.
