# The chat area stops saying "No Sessions yet" over a list that is about to arrive

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-24-chat-empty-state.zh.md)

Two windows where the conversation area claimed there was nothing to show, in front of a list
that was seconds from appearing. Both are gone.

## An Agent set still being fetched is a list still loading

The Session list cannot be fetched without an Agent set, and the fetch returns early when there
is none — deliberately leaving the loading flag alone, since nothing was loaded. Nothing else
covered that window, so after the first successful load it read "loaded". Every Project switch
clears the Agents and refetches them, which meant a stretch of "loaded, and there is nothing
here" over an emptied list. Three consumers gated on that flag and all three were wrong for its
duration, including a redundant lookup for a Session the list had merely not fetched yet.

## A routed Session is not a missing one

The list is paged, so an id in the route that is not among the loaded rows is ordinary — a deep
link, a Session just created, a row beyond the first page — and it is settled by a direct
lookup, not by assuming the Session is gone. The auto-select effect already refused to conclude
anything while that lookup was outstanding; the render concluded it anyway and drew the empty
state for however long the lookup took. It now waits on exactly what the effect waits on.
