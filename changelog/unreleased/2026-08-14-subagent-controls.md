# Live subagent controls and authoritative status

The Web agents panel can now steer a running child, continue an idle child in the same context, or stop only its current round. Stopping the parent Task also cascades to every running child. A stopped child stays retained and can be continued later instead of being permanently disposed.

Child lifecycle state now comes from the core runtime (`running` / `stopping` / `idle`) over a `subagent_state` SSE snapshot instead of being inferred from the original `run_subagent` tool card. This fixes a resumed child remaining checked as done, with a frozen duration, after `input_subagent` starts it again (#274). Background output, approvals, live-tail refresh, usage and errors keep flowing through the parent channel after the parent tool window or Task has returned.

The Server adds parent-owned child message and abort endpoints under `/api/sessions/:parentId/subagents`; unknown and inaccessible children retain the Session API's non-leaking 404 behavior.
