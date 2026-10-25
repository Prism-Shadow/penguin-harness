PenguinHarness 0.2.17 rebuilds the Agent API around the Session's own records: `/api/amsp/v1` now streams what the Trace stores, and the `@prismshadow/amsp` SDK reads it. Replies can carry charts and full forms, the Trace panel is rebuilt, and a conversation on a remote machine reads that machine's agents, Sessions, memory and models. On Windows, the desktop app of 0.2.16 or earlier cannot update itself to this release: install it by hand once.

## Install

**Desktop app**: get your platform's installer from [penguin.ooo/download](https://penguin.ooo/download) — the page measures both sources on every visit and keeps GitHub unless the OSS mirror is measurably faster. A manual selector sits beside the result. The macOS builds are Developer ID signed and notarized, and the Windows installers are Authenticode-signed. Neither platform needs a first-launch unblock.

**Windows desktop app of 0.2.16 or earlier: install 0.2.17 by hand once.** This release's Windows installers are signed with a new certificate, and the updater of 0.2.16 and earlier refuses them. Download the installer from [penguin.ooo/download](https://penguin.ooo/download) and run it. Later updates install normally.

CLI / server (Linux, macOS; bundled Node runtime):

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/penguin-cli
```

Or the official Docker image (`linux/amd64` and `linux/arm64`):

```sh
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:0.2.17
```

`0.2.17` is built from this release's tag. `latest` follows changes to the image's runtime or build inputs on `main`. The example publishes the port on the host's loopback, so a fresh deployment answers only on the machine running Docker.

## Highlights

### The Agent API streams the Session's own records

`/api/amsp/v1` keeps its path, but its stream is now the records the Session's Trace stores, in their envelope `{timestamp, type, payload, origin?}`, plus the `partial_*` fragments. The only control frames are `event: ping` (`{}`, at once and every 20 s) and a run stream's closing `data: [DONE]`. A new Session's id is in its first `session_meta` record.

A program can now follow a Session it did not start; the paths below are under `/api/amsp/v1`:

- `GET /sessions/:id/stream` resumes from `Last-Event-ID`. When that id has left the buffer or the server restarted, it answers `409 resync_required`.
- `GET /sessions/:id/messages` and `GET /sessions/:id/trace-image` read the history.
- `GET /sessions/:id/approvals[?wait=1–60]` long-polls the tool calls waiting on a decision.
- `POST /sessions/:id/tasks` starts a run without holding the connection: `202`, or `409` while the Session is busy. It is never queued.

A signed-in reader gets the same stream at `GET /api/sessions/:id/amsp` and the approvals at `GET /api/sessions/:id/approvals`.

The `@prismshadow/amsp` SDK ships at 0.2.17. `stream()` and `run()` keep their 0.2.16 meaning, and `RunResult` is read from the records. Approvals are long-polled and handed to `onApproval`; with no callback the answer is `deny`. New in the SDK: `messages()`, `approvals()`, `SessionReader`, `HttpTransport` and the `Transport` interface, `readSse`, `readAmsp`, and a browser bundle. An agent's **API** tab runs **Try it** through the SDK.

Behind the stream, every Task is wrapped in `task_begin` / `task_end`, a Request's end is its `request_end.status`, and every `tool_call_output` carries a required `status`. The record types and markers now live in `@prismshadow/amsp` under one name, the AMSP record, and [penguin.ooo/amsp](https://penguin.ooo/amsp) presents the protocol.

![The API tab's Try it after one run: the records labelled by type, and the run's result](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-17-agent-api-en.png)

### Charts and forms in replies

A reply can draw a `chart` block: `line`, `area` (optionally stacked), `bar` (grouped, stacked or horizontal), `pie` (optionally a donut), `scatter`, `histogram` or `gauge`, with categories × 1–6 series and units on the axes. A `resources` block shows one machine's CPU, memory, swap, disks, network, load and uptime, and the `a2ui` skill's `scripts/sysinfo.mjs` prints one. The metrics and weather widgets were rebuilt on the same charts.

![A reply with a bar chart of last week's CI build times and a resources board for build-01](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-17-a2ui-charts-en.png)

Forms gain eleven field kinds: `text`, `textarea`, `number`, `slider`, `single`, `multiple`, `select`, `switch`, `date`, `time` and `datetime`, with `hint`, `maxLength`, `pattern` and `default`, and one rule for whether an answer is valid. They are drawn with the UI package's controls in all three themes. An answered form or choice shows the answers after a reload, in older conversations too; nothing new is stored.

The checker no longer grades the prose outside the blocks. Agents get all of this by updating the `a2ui` plugin.

![An answered form after a reload, showing the answers that were sent](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-17-a2ui-form-en.png)

### A rebuilt Trace view

The **Trajectories** panel has one sticky toolbar, and the turn index opens from a button that names the turn in view. Turns are ruled rows, and a turn's context ring opens its exact token figures. Each event row carries one pill, toned by its record family. Every request now records its thinking level on `request_begin`, and the view shows the level as text where it changes.

A command that exits non-zero or is killed by a signal is now an ordinary completed tool call in the chat, the Trace and the CLI. Task boundaries are recorded with `task_begin` / `task_end`; Traces written before them are read as before.

![The Trajectories panel: the sticky toolbar, the Overall summary, the turn rows and an opened turn's timeline and events](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-17-trace-en.png)

### Remote machines read as themselves

A connected machine's agents are listed, opened, edited, chatted with, deleted and installed into as that machine's own, beside this server's. A conversation on a machine reads its Sessions, memory, models, scheduled tasks and Skills from that machine. When this server adopts a machine, the Sessions the machine already held are filed as CLI tasks.

A machine out of reach is named by its alias, with where its reconnect stands. Automatic reconnects stop after eight failures in a row, or at the first ssh refusal that retrying cannot fix, and the **Machines** page offers **Retry**. Machine cards show their state in a labelled pill.

Messaging on a machine's conversation says where its bot runs, and a bot is checked against every server before it is turned on. Admins reach a machine's Session at `/api/sessions/:id/…` without the `/server/<machineId>` prefix. Each Web App tab sends its API calls over one WebSocket and shares machine event streams.

![The Agents page listing a machine's agents beside this server's](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-17-machines-en.png)

## Notable in this release

- **Markdown reader:** plugin READMEs, Benchmark cases and the Files panel's preview open in one reader with an outline and in-page find, and the organization handbook is the Files panel. Markdown tables share one style everywhere and scroll sideways inside their own box when they are wide.
- **Appearance:** the accent tints your own messages. With a custom background, streaming text, loading states, the transcript's pinned rows, your message bubbles and notices show the image instead of covering it.
- **Terminals** belong to the conversation that opened them. In the dock, a conversation's shells are tabs of one "Command-line terminal" panel.
- **Models:** MMSP 0.5.6. New presets include MiniMax M3.1 Flash, Kimi K3.1 Pro on TokenDance, Moonshot and OpenRouter, and further OpenRouter, TokenDance and SiliconFlow rows; **Add new models** brings them into an existing Project. Penguin Go's sync refreshes its prices and promotions. The vision check works on endpoints with strict image decoders. The default model idle timeout, `model.timeoutMs`, is 600000 (10 minutes); an existing agent picks it up on a kernel update unless its runtime tab was edited. Blank base URL, API key and price fields say what a blank field does.
- **Scheduled tasks** that can never fire again move to `schedule/expired/`.
- **Sign-in:** two instances on one host stay signed in, because the browser's session cookie name carries the port (`penguin_session_<port>`).
- **Goal mode** on an agent without the goal plugin says so in the composer and installs the plugin in one click.
- **Fixes:** copying pastes plain text; scrolling up while a reply streams stays put; typing in the built-in browser lands in the page; switching Projects shows only that Project's agents; a messaging bot on a conversation that has not run yet keeps answering after a server restart; a failed Agent State import keeps the previous State; long memory rows keep their actions; Software Update shows a recovery hint; Benchmark export works in any time zone; the bottom dock at its largest docked size stops above the composer; `SKILL.md` frontmatter is read and written as YAML so quoted and multi-line values read as written; authorizing a TokenDance key from a Web App opened on a LAN address or a hostname uses the paste-the-code step instead of failing; the `@prismshadow/amsp` SDK's `stream()` stops delivering buffered events, a buffered `[DONE]` included, once its signal aborts.
- **Security:** Electron 43.8.3 and dependency updates close open Dependabot alerts.

### Upgrading

- **Windows desktop app: install 0.2.17 by hand once.** The app of 0.2.16 or earlier checks the old signing certificate and refuses this release's installers. Download the installer from penguin.ooo/download; later updates install normally.
- **Agent API callers:** the v1 stream changed shape. Upgrade the server and `@prismshadow/amsp` together, or pin `@prismshadow/amsp@0.2.16`: a `^0.2.16` range picks up the new client. The `run.*`, `K.delta` and `K.done` events become records, the keep-alive becomes `event: ping`, and a stale `Last-Event-ID` answers `409 resync_required`. The docs' [AMSP page](https://penguin.ooo/docs/amsp) maps every old event to the record that replaces it.
- **Records carry no `stop_reason`:** read a Request's end from `request_end.status` and a tool result's from `tool_call_output.status` (`completed`, `fatal` or `aborted`); the turn cap is an `abort` with `error_code: "max_turns"`. A response cut off at its output cap ends `retryable` with `output_truncated` and is retried. A turn gives up after 10 attempts (it was 20). In old Traces, a tool result without `status` reads as `completed`.
- **TypeScript and SDK code:** `OmniMessage`, `OmniPayload` and `OmniMessageType` are renamed `AmspRecord`, `AmspPayload` and `AmspRecordType`. `@prismshadow/penguin-core/omnimessage` and `@prismshadow/penguin-core/markers` are removed: import from `@prismshadow/amsp` or the core root. The docs page `/docs/omni-message` moved to `/docs/amsp-records` without a redirect. The model catalog moved to `@prismshadow/penguin-server/model-catalog`, and a data root only the SDK touches starts with no models. `resolveEntryCredential` and `effectiveConnection` replace the removed credential helpers. The record builders lost their stop-reason parameters, and a tool's `execute` returns `{ status }`.
- **Environment keys:** a keyless model on a vendor's second official host (`open.bigmodel.cn`, `api.moonshot.ai`, `api.minimaxi.com`) is refused instead of using the vendor's variable. Put the key on the model or its group, or clear the base URL and set the vendor's `*_BASE_URL`. `PENGUIN_GO_API_KEY` and `PENGUIN_GO_BASE_URL` are no longer read: reconnect Penguin Go from its group header.
- **vLLM** reads `VLLM_BASE_URL` and `VLLM_API_KEY`, with the default endpoint `http://127.0.0.1:8000/v1`, instead of `OPENAI_*`.
- **Schedules:** a one-shot task whose start time has passed is refused with `400`, and so is switching one back on. Give it a future start time.
- **Behind a TLS-terminating reverse proxy:** start the server with `PENGUIN_TRUST_PROXY=1`, keep the external `Host` header, and overwrite `X-Forwarded-Proto` with `https`. Otherwise every write from the Web App is refused with `403 cross_origin_write`. A write with a body and no `Content-Type` is refused with `415`.
- **Remote machines:** update each machine to this release from the **Machines** page (**Update**, or **Update all**). A machine on an older build sends the Web App no live events; its lists still load.
- **Update installed plugins** whose content changed: `a2ui` (charts and forms), `agent-development` (`penguin-sdk` for the new stream, `unified-llm-api`, `penguin-orchestration`), `goal` and `continual-learning` (the new record shape), `browser-automation` and `use-bento-slides`.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime. Installing from npm needs Node >= 24; the official Docker image carries its own. Running the built-in Benchmarks needs Docker with Compose v2 and [uv](https://docs.astral.sh/uv/) on the server's machine. The Browser extension needs Chrome 116 or later. All data stays under `~/.penguin/data` — the `/data` volume in the container.

Full detail: [changelog/0.2.17/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.17).
