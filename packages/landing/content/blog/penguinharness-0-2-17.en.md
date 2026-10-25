---
title: "PenguinHarness 0.2.17: Agent API record streams, A2UI charts and forms, remote machines"
date: 2026-10-26
category: news
excerpt: "The Agent API now streams a Session's own records, and the old v1 events are gone. Replies gain charts, forms gain new field kinds, the Trajectories panel is rebuilt, and a conversation on a remote machine reads that machine."
---

PenguinHarness 0.2.17 is out — an open-source TypeScript harness for AI agents: a Web App, a CLI, a desktop app, a server and an SDK. The Agent API streams a Session's own records, replies can draw `chart`, `resources` and form blocks, the "Trajectories" panel is rebuilt, and a conversation on a remote machine reads that machine. **If you call the Agent API, start with Upgrading**.

**TL;DR**
- The Agent API stream is now the Session's records; `run.*`, `K.delta` and `K.done` are gone — upgrade the server and the SDK together
- Replies can draw `chart`, `resources` and forms with eleven field kinds; update the `a2ui` plugin
- The "Trajectories" panel is rebuilt: turns, context rings, thinking levels
- Remote machines: a machine's agents are listed as its own, and its conversations read that machine

## The Agent API streams the Session's records

**The path `/api/amsp/v1` is unchanged, and the stream is the Session's records as the Trace stores them**. Each record is the envelope `{timestamp, type, payload, origin?}`, with `partial_*` fragments while a message streams. The old v1 events `run.*`, `K.delta` and `K.done` are gone, and nothing translates records into them any more.

The control frames are `event: ping` (data `{}`, sent at once and every 20 s) and the closing `data: [DONE]` of a run stream. On a new Session's first message, the first record is `session_meta`, and its `session_id` names the new Session.

A caller with an agent key (sent as `Bearer`) gains routes under `/api/amsp/v1`. `GET sessions/:id/stream` resumes from `Last-Event-ID`; when that id has left the buffer or the server restarted, it answers `409 resync_required`. `GET sessions/:id/messages` serves the history, `GET sessions/:id/trace-image` an image the history references, and `GET sessions/:id/approvals[?wait=1–60]` long-polls the tool calls waiting on a decision. `POST sessions/:id/tasks` starts a run that does not hold the connection; it answers 202 or 409 when the Session is busy, and it is never queued.

`@prismshadow/amsp` ships at 0.2.17: `AgentClient.stream()` and `AgentClient.run()` keep their 0.2.16 meaning, and `RunResult` is read from the records. The SDK hands each waiting tool call to `onApproval`; with no callback the answer is `deny`. It adds `messages()`, `approvals()`, `SessionReader`, `HttpTransport` and the `Transport` interface, `readSse`, `readAmsp`, and a browser bundle (`@prismshadow/amsp/browser`).

In the Web App, "Try it" on an agent's "API" tab now runs through the SDK and lists the run's records.

![An agent's "API" tab after one completed "Try it" run, with record rows and the outcome strip](/blog-assets/penguinharness-0-2-17-agent-api-en.png)

The record set changed too: every Task is wrapped in a `task_begin` / `task_end` pair, and no record carries `stop_reason` any more (Upgrading has what to read instead and the TypeScript renames). The protocol has its own page: penguin.ooo/amsp.

## Charts and forms in replies

This release adds a `chart` block and a `resources` block to A2UI, the set of blocks an agent writes into a reply and the chat draws as interface elements; it comes from the `a2ui` plugin.

The `chart` block has seven kinds: `line`, `area` (optionally stacked), `bar` (grouped, stacked or horizontal), `pie` (optionally a donut), `scatter`, `histogram` and `gauge`. All kinds share one data model: categories × 1–6 series, with units on the axes.

![A reply with a grouped bar chart and a machine's resources board](/blog-assets/penguinharness-0-2-17-a2ui-charts-en.png)

The `resources` block shows one machine's CPU, memory, swap, disks, network, load and uptime.

Forms, the blocks that ask the reader several questions at once, now have eleven field kinds: `text`, `textarea`, `number`, `slider`, `single`, `multiple`, `select`, `switch`, `date`, `time` and `datetime`. One rule decides whether an answer is valid, and the form's button stays off until every required field is answered and every answer is valid.

An answered form or choice shows the answers that were sent, also after a page reload and in older conversations. The answers are read back from the message that followed the reply; nothing new is stored.

![A form block answered and then reloaded, showing the answers read-only](/blog-assets/penguinharness-0-2-17-a2ui-form-en.png)

**Updating the `a2ui` plugin gives agents the new blocks (see Upgrading); the same update stops the A2UI checker from grading the prose outside the blocks**.

## A rebuilt Trajectories panel

**A conversation's "Trajectories" panel is rebuilt around one sticky toolbar: the Trace file picker, the turn button, and an export icon**.

The turn button names the turn in view and opens the turn navigator ("Turn index"); picking a turn opens it and scrolls to it.

Turns are ruled rows (number, tool calls, cache hit rate, cost, duration), each ending in a context ring. Clicking the ring opens "Turn readings", the turn's token figures and context use.

Each event row shows one pill naming the record's kind, toned by its record family. The thinking level of each request is now recorded on `request_begin` (`thinking_level`), and the view shows it as text where it changes, for example `thinking_level=medium → high`.

![The "Trajectories" panel: toolbar, ruled turn rows with context rings, event rows with pills](/blog-assets/penguinharness-0-2-17-trace-en.png)

A command that exits non-zero, or is killed by a signal, now ends as an ordinary completed tool call in chat, Trace and CLI. Its output still ends with `[exit code: N]` or `[terminated by signal X]`. `fatal` remains for the tool's own failures.

## Agents and conversations on remote machines

**Agents and conversations on a remote machine are now that machine's own**. A remote machine is another computer this server reaches over ssh (the "Machines" page). The "Agents" page lists every connected machine's agents beside this server's, each card named `[SSH: <alias>]`. A machine's agents can be opened, edited, chatted with, deleted and given plugins. The create dialog asks for a location: this server or a connected machine.

![The "Agents" page listing a machine's agents beside this server's](/blog-assets/penguinharness-0-2-17-machines-en.png)

A conversation on a machine reads that machine's memory, models, scheduled tasks and Skills (the composer's Skills list).

When a machine is out of reach, the conversation names it by alias, says where its reconnect stands, and loads by itself once the machine is back. Automatic reconnects stop after eight failed attempts in a row, or at the first ssh refusal that retrying cannot fix. The machine card offers "Retry", and a stopped machine's status pill reads "Reconnect stopped".

## Also in this release

- **Markdown:** an outline and in-page find in plugin READMEs, Benchmark cases and the Files panel; tables share one style everywhere.
- **Appearance:** the accent colour tints your own messages; a custom background image now shows through while replies stream and pages load.
- **Terminals:** a terminal belongs to the conversation that opened it; the dock terminal is one "Command-line terminal" panel per conversation, with that conversation's shells as tabs.
- **Models:** MMSP 0.5.6; MiniMax M3.1 Flash and Kimi K3.1 Pro (TokenDance, Moonshot, OpenRouter) in the catalog; "Add new models" brings the presets; `model.timeoutMs` is now 600000 (10 minutes, up from 300000).
- **Tasks and goal mode:** scheduled tasks that can never fire again move to `schedule/expired/`; goal mode without the plugin says so and offers "Install on this Agent".
- **Sign-in:** two instances on one host stay signed in at the same time; the cookie name carries the port.
- **Fixes and security:** copied text pastes as plain text, scrolling up during a streaming reply stays put, a failed Agent State import keeps the previous State, and Benchmark export works in any time zone; the desktop app moves to Electron 43.8.3, and dependency updates close Dependabot alerts.

## Upgrading

- **Windows desktop app.** Installers are signed with a new certificate, so apps of 0.2.16 and earlier refuse the update. Install 0.2.17 once by hand from penguin.ooo/download; later updates install normally.
- **Agent API callers.** The v1 stream changed shape. Upgrade the server and `@prismshadow/amsp` together, or pin `@prismshadow/amsp@0.2.16` (a `^0.2.16` range picks up the new client). The `run.*`, `K.delta` and `K.done` events become records, the heartbeat is `event: ping`, and a stale `Last-Event-ID` answers `409 resync_required`. The AMSP docs page maps every old event to its record.
- **Records.** Records no longer carry `stop_reason`: read `request_end.status` and `tool_call_output.status` (`completed` / `fatal` / `aborted`). The turn cap is an `abort` record with `error_code: "max_turns"`. A response cut off at its output cap ends `retryable` with `output_truncated` and is retried. A turn gives up after 10 attempts (it was 20). Old Traces' tool results without `status` read as `completed`.
- **TypeScript.** `OmniMessage` / `OmniPayload` / `OmniMessageType` are now `AmspRecord` / `AmspPayload` / `AmspRecordType`. `@prismshadow/penguin-core/omnimessage` and `@prismshadow/penguin-core/markers` are removed: import from `@prismshadow/amsp` or the core root. `/docs/omni-message` moved to `/docs/amsp-records` and is not redirected. The model catalog moved to `@prismshadow/penguin-server/model-catalog`. Record builders lost their stop-reason parameters, and a tool returns `{ status }`.
- **Environment keys.** `PENGUIN_GO_API_KEY` and `PENGUIN_GO_BASE_URL` are no longer read. If you set only the key variable, reconnect Penguin Go from its group header or paste the key into its group settings. A keyless model on a vendor's second official host (`open.bigmodel.cn`, `api.moonshot.ai`, `api.minimaxi.com`) is refused instead of using the vendor's environment variable.
- **vLLM.** vLLM models read `VLLM_BASE_URL` and `VLLM_API_KEY` (default `http://127.0.0.1:8000/v1`), no longer `OPENAI_*`.
- **Scheduled tasks.** A one-shot task whose start time has passed is refused (400), and so is re-enabling one. Give it a future start time.
- **Reverse proxy.** Behind a TLS-terminating proxy, set `PENGUIN_TRUST_PROXY=1`, keep the external `Host` header, and have the proxy overwrite `X-Forwarded-Proto`. Otherwise every Web App write is refused with `403 cross_origin_write`. A write with a body and no Content-Type is refused with 415.
- **Remote machines.** Update each machine to this release (the "Machines" page, the machine's "Update"). A machine on an older build loses live events in the Web App; its rows still load.
- **Plugins.** Update installed plugins whose content changed: `a2ui` (charts, forms), `agent-development`, `goal` and `continual-learning`, `browser-automation` and `use-bento-slides`.

Installers are available at [penguin.ooo/download](https://penguin.ooo/download). Full details are in [the 0.2.17 changelog](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.17).
