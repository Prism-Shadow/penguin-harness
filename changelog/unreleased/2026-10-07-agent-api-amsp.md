# External programs can talk to an Agent: the Agent API, the AMSP stream and the amsp client

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `amsp`, `docs`

[中文版](2026-10-07-agent-api-amsp.zh.md)

A Project owner can open one agent to programs outside PenguinHarness. A program sends its input to `POST /api/amsp/v1/agents/:projectId/:agentId/runs`, reads the run as it happens as an AMSP event stream, and continues the conversation by its Session id. The runs use the Project's models and credentials, are recorded like any conversation, and appear in the sidebar's **Background** folder. A new package, `@prismshadow/amsp`, carries the protocol's types and a TypeScript client for Node and browsers.

## The Agent API

- Each agent has its own switch, off by default, an optional **keyless access** switch, also off by default, and an **API approval mode**, `allow-all` by default. They are stored in the server's database, in the new `agent_api` and `agent_api_keys` tables, outside the agent's state and outside the Project file, so an agent can neither expose itself nor loosen its own approvals.
- Keys are minted per agent, named, and shown once: `penguin_` followed by 43 base64url characters, stored as SHA-256. A key runs its own agent and reads, aborts and answers the approvals of that agent's API conversations, and opens nothing else. Each run that presents a key stamps its last use.
- The public routes are under `/api/amsp/v1`, outside the sign-in cookie: `GET /agents/:projectId/:agentId`, `POST /agents/:projectId/:agentId/runs`, `GET /sessions/:sessionId`, `POST /sessions/:sessionId/abort` and `POST /sessions/:sessionId/approvals/:toolCallId`. Any other path under the prefix answers a JSON `404` `not_found`. The key and the switches are checked before the body is read.
- A run without `session_id` creates a conversation with `session_meta.source` `api` and the index row's `client` `api`, using the Project's default model, the server's new-chat sandbox and the agent's API approval mode, copied onto the conversation when it is created. `session_id` continues an API conversation of the same agent; any other id is `404` `session_not_found`.
- When the approval mode asks, the request streams to the caller as `approval.requested`, and the conversation in the Web App can answer it too; the first answer counts. A caller that disconnects aborts its run, and its pending approvals are denied. `POST …/abort` aborts while keeping the stream open for the final `run.done`.
- A busy conversation answers `409`; a fifth concurrent run of one agent answers `429` `too_many_runs` with `Retry-After: 2`.
- The CORS preflight is answered for any origin; `Access-Control-Allow-Origin: *` is sent only on a request carrying `Authorization`, so a page on another origin cannot drive an agent through keyless access.
- The administrator's `agentApiEnabled` setting in `/api/admin/settings`, on by default, refuses every Agent API request with `403` `agent_api_disabled` when off, keeping the agents' settings and keys.
- The owner's routes under `/api/projects/:projectId/agents/:agentId/api` read and change an agent's settings and create and delete its keys; the agents list carries `apiEnabled`.

## The AMSP stream

- AMSP (Agent Message Stream Protocol) streams one run of an agent, one Task, the way MMSP streams one model call: SSE `data:` lines, `data: [DONE]` at the end, `: keep-alive` after 15 seconds of silence, bytes as base64. Events are flat objects named `<subject>.<phase>`: `run.*`, `context.opened`, `mcp_connect.*`, `tools.ready`, `request.*`, `K.delta` / `K.done` items, `approval.*`, `compaction.*` and `hook.fired`.
- The server translates the Session's live stream into it: OmniMessage records and server events. Fragments and complete items are forwarded as the engine produced them, `partial_*` `stop` is not sent, and OmniMessage gained no field.
- `run.done` is the single terminal event and always arrives, errors included, with the run's status, error, Request count, token usage and the Session's running total. Errors before the stream use the server's error envelope with fixed status codes.
- New event types and optional fields are added within `/v1`; a change to a field's meaning would be `/v2`. Clients ignore event types they do not know.

## The amsp client

- `@prismshadow/amsp` is a new public package with no runtime dependencies, for Node 24 and browsers. It exports the AMSP wire types, which the server imports, and `AgentClient`.
- `client.run()` returns a run to iterate for its events, with `session`, `result()` and `abort()`; `client.ask()` returns the result alone. `onApproval` answers approval requests, and without it they are denied. The client also offers `agent()`, `session()`, `abort()` and `approve()`, the `AmspHttpError` and `AmspStreamError` errors, `parseArguments` for a tool call's JSON arguments, and `readSse`, the SSE reader.

## The Web App

- The agent settings page gained an **API** tab: **Enable API access**, the approval mode for API conversations, the Base URL and Agent ID to copy, keys created with a one-time display and deleted from a list, **Allow keyless access** with its warning, and curl and TypeScript examples.
- The Agents page marks an agent whose API is on with an API icon. **Settings** gained the administrator's **Allow the Agent API** switch.

## The CLI

- `penguin agent api` shows and changes an agent's API from a terminal: `status`, `enable`, `disable` and `set` (with `--open` / `--no-open` and `--approve <mode>`), `keys ls`, `keys create` (the key alone on stdout), `keys rm`, and `server on|off` for the administrator's switch.

## Docs

- Two new reference pages: **Agent API**, on turning an agent's API on, the approval mode, keys, keyless access, the routes, errors, curl, the client in Node and browsers, and the CLI; and **AMSP**, the protocol's transport, grammar, every event, examples, errors, the mapping from OmniMessage and the versioning rule.

## Compatibility

No compatibility code was added; these changes were accepted as they are:

- Two new tables, `agent_api` and `agent_api_keys` (migration 14). An earlier server never reads them and serves no `/api/amsp` route, so after a rollback callers get `404` until a build that knows the tables is back. Rolling the migration back deletes every agent's API settings and keys.
- Conversations the API creates store `client` `api` in the Session index, a column that takes new values without a migration.
