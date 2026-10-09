# External programs can talk to an Agent: the Agent API, the AMSP stream and the amsp client

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `amsp`, `docs`
- **PR:** [#1000](https://github.com/Prism-Shadow/penguin-harness/pull/1000)

[中文版](2026-10-07-agent-api-amsp.zh.md)

A Project owner could open one agent to programs outside PenguinHarness. A program sent its input to `POST /api/amsp/v1/agents/:projectId/:agentId/runs`, read the run as it happened as an AMSP event stream, and continued the conversation by its Session id. The runs used the Project's models and credentials, were recorded like any conversation, and appeared in the sidebar's **Background** folder. A new package, `@prismshadow/amsp`, carried the protocol's types and a TypeScript client for Node and browsers.

## The Agent API

- Each agent got its own switch, off by default, an optional **keyless access** switch, also off by default, and an **API approval mode**, `allow-all` by default. They were stored in the server's database, in the new `agent_api` and `agent_api_keys` tables, outside the agent's state and outside the Project file, so an agent could neither expose itself nor loosen its own approvals.
- Keys were minted per agent, named, and shown once: `penguin_` followed by 43 base64url characters, stored as SHA-256 and listed by their first 16 characters. A key ran its own agent and read, aborted and answered the approvals of that agent's API conversations, and opened nothing else. Each run that presented a key stamped its last use.
- The public routes were mounted under `/api/amsp/v1`, outside the sign-in cookie: `GET /agents/:projectId/:agentId`, `POST /agents/:projectId/:agentId/runs`, `GET /sessions/:sessionId`, `POST /sessions/:sessionId/abort` and `POST /sessions/:sessionId/approvals/:toolCallId`. Any other path under the prefix answered a JSON `404` `not_found`. The key and the switches were checked before the body was read.
- A run without `session_id` created a conversation with `session_meta.source` `api` and the index row's `client` `api`, using the Project's default model, the server's new-chat sandbox and the agent's API approval mode, copied onto the conversation when it was created. `session_id` continued an API conversation of the same agent; any other id was `404` `session_not_found`. A conversation whose first run had not written its Trace read as `api` from its row, in the list and when it was rebuilt after a restart.
- When the approval mode asked, the request streamed to the caller as `approval.requested`, and the conversation in the Web App could answer it too; the first answer counted. A caller that disconnected aborted its run, and its pending approvals were denied. `POST …/abort` aborted while keeping the stream open for the final `run.done`.
- A busy conversation answered `409`; a fifth concurrent run of one agent answered `429` `too_many_runs` with `Retry-After: 2`.
- The CORS preflight was answered for any origin. `Access-Control-Allow-Origin: *` went only on a request carrying `Authorization`, the server-wide `413` and `415` refusals included, so a page on another origin could not drive an agent through keyless access.
- The administrator's `agentApiEnabled` setting in `/api/admin/settings`, on by default, refused every Agent API request with `403` `agent_api_disabled` when off, keeping the agents' settings and keys.
- The routes under `/api/projects/:projectId/agents/:agentId/api` let any member read an agent's settings, the administrator's switch included as `serverEnabled`, and let the owner change them and create and delete keys; `POST …/api/try` ran the agent for the owner's sign-in and streamed the same AMSP response. The agents list carried `apiEnabled`.
- Changing an agent's exposure took a person's sign-in. The local API token, which every tool subprocess of a server-driven Session holds, could read an agent's settings and keys, but `PUT …/api`, `POST …/api/keys`, `DELETE …/api/keys/:keyId`, `POST …/api/try` and a `PUT /api/admin/settings` carrying `agentApiEnabled` refused it with `403` `human_required`, the code the agent browser already gave the token, and wrote nothing, so an agent could not switch on its own exposure from its shell. This narrowed the credential the harness handed an agent; the sandbox remained the boundary.

## The AMSP stream

- AMSP (Agent Message Stream Protocol) streamed one run of an agent, one Task, the way MMSP streams one model call: SSE `data:` lines, `data: [DONE]` at the end, `: keep-alive` after 15 seconds of silence, bytes as base64. Events were flat objects named `<subject>.<phase>`: `run.*`, `context.opened`, `mcp_connect.*`, `tools.ready`, `request.*`, `K.delta` / `K.done` items, `approval.*`, `compaction.*` and `hook.fired`.
- The server translated the Session's live stream into it: OmniMessage records and server events. Fragments and complete items were forwarded as the engine produced them, `partial_*` `stop` was not sent, and OmniMessage gained no field.
- `run.done` was the single terminal event and always arrived, errors included, with the run's status, error, Request count, token usage and the Session's running total. Errors before the stream used the server's error envelope with fixed status codes.
- New event types and optional fields were to be added within `/v1`, and a change to a field's meaning would be `/v2`; clients were required to ignore event types they did not know.

## The amsp client

- `@prismshadow/amsp` was a new public package with no runtime dependencies, for Node 24 and browsers. It exported the AMSP wire types, which the server imported, and `AgentClient`.
- `client.run()` returned a run to iterate for its events, with `session`, `result()` and `abort()`; `client.ask()` returned the result alone. `onApproval` answered approval requests, and without it they were denied. The client also offered `agent()`, `session()`, `abort()` and `approve()`, the `AmspHttpError` and `AmspStreamError` errors, `parseArguments` for a tool call's JSON arguments, `readSse`, the SSE reader, and `RunCollector`, which folded the events a program read itself into the same result.

## The Web App

- The agent settings page gained an **API** tab: **Enable API access**, the approval mode for API conversations, the Base URL and Agent ID to copy, keys created with a one-time display and deleted from a list, **Allow keyless access** with its warning, and curl and TypeScript examples. While the administrator had the Agent API off, the tab disabled its switch and said why, to every member.
- The API tab ended with **Try it**, for the owner: an input prefilled with "What time is it now?" and a Run button that sent one real API run through `POST /api/projects/:projectId/agents/:agentId/api/try` — the owner's sign-in standing in for a key, the same handler behind it — and showed the stream as a program would receive it, as a readable event log or the raw `data:` lines, with the answer, the `run.done` status, Request count, tokens (cache reads and writes inline when there were any) and elapsed time, and the `session_id`; running again continued that conversation, Stop aborted it through the Session's abort route, and an approval the mode asked for was answered inline.
- The Agents page marked an agent whose API was on with an API icon. **Settings › Server** gained an **Agent API** page with the administrator's **Allow the Agent API** switch, which asked before turning off.

## The CLI

- `penguin agent api` showed and changed an agent's API from a terminal: `status`, `enable`, `disable` and `set` (with `--open` / `--no-open` and `--approve <mode>`), `keys ls`, `keys create` (the key alone on stdout), `keys rm`, and `server on|off` for the administrator's switch. `--agent-id` was required, with no default, and `status` showed the administrator's switch to any member.
- The CLI still authenticated with `PENGUIN_API_TOKEN`, else the `api-token` file. When the server refused a request to that token with `403` `human_required`, the CLI sent the same request once more with the person's stored sign-in, the `<root>/cli-session.json` session written by `penguin auth login` or `penguin auth token`, as the session cookie. It did so only for a loopback server, only with a sign-in to a loopback server, and never from inside a Session. The `penguin agent api` writes therefore worked after `penguin auth login`; with no sign-in, or one the server no longer accepted, they printed the command to run and exited 1.

## Docs

- Two new reference pages: **Agent API**, on turning an agent's API on, the approval mode, keys, keyless access, the routes, errors, curl, the client in Node and browsers, and the CLI; and **AMSP**, the protocol's transport, grammar, every event, examples, errors, the mapping from OmniMessage and the versioning rule.
- **Server API** gained the agent API settings routes, `agentApiEnabled`, `apiEnabled`, `client` `api` and the CORS exception for `/api/amsp/v1`; **CLI Reference** gained `penguin agent api`; **Agents** gained the **API** tab; **Settings** gained the **Agent API** page; **OmniMessage** said that AMSP is a projection of it and changed nothing in it.
- **Agent API**, **Server API**, **CLI Reference** and **Security Model** said that changing an agent's exposure took a person's sign-in and was refused to the local API token with `human_required`, that this was not a boundary, and when the CLI sent a stored sign-in instead.
- The `penguin-sdk`, `penguin-orchestration` and `agent-initialization` skills said that the server refused the `penguin agent api` writes to an agent's token, told the agent never to sign in to get past that, and put `penguin auth login` first in the steps for the user. The `agent-tuning` plugin moved to `2026.10.09.2`.

## Compatibility

No compatibility code was added; these changes were accepted as they are:

- Two new tables, `agent_api` and `agent_api_keys` (migration 14). An earlier server never reads them and serves no `/api/amsp` route, so after a rollback callers get `404` until a build that knows the tables is back. Rolling the migration back deletes every agent's API settings and keys.
- Conversations the API creates store `client` `api` in the Session index, a column that takes new values without a migration.
