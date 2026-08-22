# The terminal panel closes when something takes its place

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-20-terminal-panel-swap.zh.md)

Two ways the terminal stayed on screen after the user had, as far as they could tell,
closed it.

## Opening a chat panel closes a side pane, not parks it

A left or right terminal pane and the Agents/Workspace panel share one slot, and opening
the panel used to displace the pane behind it — so closing the panel again brought the
terminal back, unasked. From where the user sits, opening the panel is what closed the
terminal; closing the panel should leave the slot empty.

It closes now. The arrangement survives, so reopening the dock returns it to the edge it
was on with its screen intact — what does not survive is the showing of it. A top or
bottom pane is unaffected: it costs height, not width, and never competed for that slot.

## The dock stays with its conversation

A terminal opened in a conversation followed the user into Agents, Skills and user
management — pages with no conversation of their own, where a shell has nothing to do with
what is on screen. Those pages scope the dock to a placeholder that holds no arrangement,
so it is simply not there; returning to the conversation restores it, screen and all. The
shell keeps running throughout, as it does whenever the panel is closed.
