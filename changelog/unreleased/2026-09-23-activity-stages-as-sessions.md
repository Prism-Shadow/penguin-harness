# Activity stages on a coding agent run as ordinary Sessions; the coding-agent runs screen is gone

- **Date:** 2026-09-23
- **Type:** refactor
- **Scope:** `server`, `web`

A spec generation, module assembly or media-text run on a coding agent is now an ordinary Session whose model is the coding agent, created and followed exactly as a Penguin agent's run is: the same Trace, approvals, usage and cost, completion signal, collection and cancellation. The separate path that drove the agent's own session directly, and the screen that existed only to watch it, are gone.

## Runs

- A coding-agent run's Session is filed under the Penguin agent the activity editor would use (or the Project's default Agent when an API client names none), so it appears in the sidebar, and **Open Session** opens it at `/chat/<id>` like any other run's.
- An agent that stops short still fails the run with its own reason (refused, ran out of output, lost its connection) rather than a missing-file message.
- A module assembly still keeps the agent out of the WAF checkout: the protected folder now reaches the agent's session through Session creation, and a permission ask touching it is refused whatever the Session's approval mode.
- `ActivityRun.agentId` is now the owning Penguin agent for coding-agent runs too, where it was empty.

## Removed from the Web App

- The **Coding agent runs** screen (`/coding-agents`) and its session viewer. Coding agents are configured on Models → Local CLI, and every session they run is in the sidebar.
- The Quick Switcher's coding-agent sessions section; its coding-agent entries remain and open Models → Local CLI.
- The add-agent dialog moved beside the Local CLI panel.

## Unchanged

- The server's `/api/coding-agents/sessions` routes still open agent sessions directly for API clients; they are in memory, have no Trace, and no screen uses them.
