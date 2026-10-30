# PRFC-0008 Telemetry: Let the System Itself Say Where Time Went and Where Messages Stalled

[中文版](PRFC-0008-telemetry.zh.md)

> **Source**: `rfcs/PRFC-0008-telemetry.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — a draft, see design PR [#113](https://github.com/Prism-Shadow/penguin-harness-design/pull/113) (draft).
> **Rev**: v1.0.0 (migrated into the main repository, taking the draft's current version); the conventions for this surface are in [README.md](README.md), and changes from version to version are recorded in `## Changes` at the end.

- Feature Name: `telemetry`
- Start Date: 2026-09-03
- PRFC PR: [Prism-Shadow/penguin-harness-design#113](https://github.com/Prism-Shadow/penguin-harness-design/pull/113)
- Implementation PR: Not started
- Dependencies: PRFC-0001 "Module", PRFC-0005 "Depend on mechanisms, not implementations"

## Summary
[summary]: #summary

Add a telemetry module to the server that records three kinds of platform-level facts: how large and how long each request is; which layers each event passes through from publish to delivery, and at which layer it stalls; and how much time the server and the browser each spend on every session open. Samples record only shape (size, duration, counts, status), never content; they live only in a bounded in-memory ring buffer — nothing written to disk, nothing sent anywhere, all gone the moment the process exits. Integration rides on the module tree's wiring hook: the moment the booter injects an interface into a consumer can be wrapped, with method names and signatures both coming from `ifaces.json`, so the module being measured changes not a single line. The whole thing is off by default, with no runtime overhead while off; turning it on is a deliberate choice, and per-method wrapping is then enabled per module.

## Motivation
[motivation]: #motivation

### Two real incidents

**Opening a session takes ten seconds.** A session that has run for a long time carries several MB of history messages. Click it open and the page stays blank for ten seconds before appearing. Local development never ran into this, because local sessions are never long.

**The message was sent, but it isn't on screen.** Send a message in a session running on a remote Machine: the input box clears, but the message stream doesn't have it. Press F5 to refresh and it is there, and the model is already answering. In other words, the send did succeed; only the echo never arrived. This has never happened on a local Machine.

The two incidents share one thing: when they happen, the system cannot produce a single sentence telling us where the time went or at which layer the message stalled. All one can do is guess, change one spot after guessing, and wait for the next occurrence.

### What can be seen today

This system already has three observable pieces, each covering one thing:

- **Trace and performance profiling**: what the model did. Per-turn tokens, durations, tool-call counts, TPS; recently two more sub-items, model API time and tool wall time, were added.
- **Usage persistence**: how much money was spent. Tokens and cost per request go into the usage table.
- **Error persistence**: what blew up. Exceptions caught by HTTP, the Session driver, the LLM, tools, and the process-level fallback go into error_records — deduplicated, capped, and clearable by admins.

They all watch the Agent layer, and they all live only on the server. Below the Agent — the platform layer of HTTP, SSE, the proxy to remote machines, and Trace reads from disk — and on the browser side, there is exactly one thing: a middleware in `app.ts` printing `GET /api/sessions/x/messages 200 9800ms` to stdout. No response size, no breakdown, no request id, and not one word about what happens in the browser. That is the sole occurrence of `performance.now()` in the entire server; the frontend has none at all. Counting further down: no logger, no log levels, no debug switches like `PENGUIN_DEBUG`, no `/api/health`, no `doctor` in the CLI, no log files from the desktop app — the server's only output is the shell's stdout.

### Taking the first incident apart

Walk the "open a session" path once and you can list seven or eight suspects, each of them plausible:

- The history endpoint `GET /messages` windows by Task, and the frontend's first screen asks for the most recent 200 Tasks. There is no cap on how many messages or bytes a Task may hold.
- Tool output is embedded in messages as text, 16k or 64k characters per piece; images are embedded verbatim as base64 data URLs in `tool_call_output.images` — `read_image` allows up to 5 MB per image, pasted images up to 20 MB. Images have a per-item cap but no total cap. The comment in `attachment-limits.ts` says it itself: one large image is not one slow request, it is a Session that can never be recovered.
- Sub-session Traces are read from disk recursively on the server and inlined into the parent session's response, up to four levels deep.
- The server reads a shard by loading the entire file into one string and then `JSON.parse` line by line; when the pagination-stats cache is cold (the first open after a restart, or after a cache version bump), it must scan from the session's first shard to the last.
- Responses are not compressed. `app.ts` has no compression middleware; multi-MB JSON travels the network as-is.
- The browser takes the response through `text()` and then `JSON.parse`, crossing it twice on the main thread; the reducer folds all messages into items kept in memory; the message stream has no virtualization and renders all items at once; every piece of Markdown goes through micromark on first sight, code blocks through Shiki, formulas through KaTeX; images are plain `<img src="data:…">` with no `loading="lazy"`, all decoded immediately.

Which of these items takes the lion's share of the ten seconds? Today there is no answer. Some of the seven or eight are server-side, some are network, some are browser; changing any one of them is a round of work, and changing the wrong one is a round wasted. Fix a guessed item, guess wrong — another wasted round; this has to be measured first.

### Taking the second incident apart

First look at how a message travels. The browser `POST /tasks`; the server hands the input message to the Session to run, and the response body is only `{ sessionId, queued }` — the message itself is not in it. On receiving the response the frontend clears the input box and **puts nothing into the message stream**; there is no optimistic insertion either. The user sees their own message only because the server, inside `launchTask`, `channel.publish`es the input message onto that Session's SSE channel, and the browser receives it from the stream and renders it. It is visible after F5 because the history endpoint rebuilds from Trace and `pendingInputs`. So "send succeeded, echo never arrived" is a naturally possible event in this structure: persisting to disk and pushing to the stream are two separate paths, and the former's success does not mean the latter arrived.

Now look at the stream itself. By design it is quite thorough: event ids are `<epoch>-<seq>`, each channel has a ring buffer of 10k events or 8 MB, reconnects replay with `Last-Event-ID`, and when replay is impossible a `resync_required` is sent for the frontend to rebuild; the server writes a heartbeat comment line every 20 seconds. On a remote Machine this stream travels two more hops: browser to the local server, then the local server — via the `/server/<id>/api/…` proxy — dials a SOCKS connection out of the ssh session with node:http to the remote server, and the response stream is piped back verbatim.

The problem is that this set of guarantees rests on one premise: **the browser must know the connection broke**. The frontend uses the native `EventSource`, so reconnection happens only after it reports an error itself — and under the SSE spec, comment lines produce no events, so `EventSource` never sees the 20-second heartbeat at all. If a connection is half-dead — TCP still open, data no longer arriving — `EventSource`'s state stays OPEN forever, `onerror` never fires, `Last-Event-ID` is never sent, and not a single buffered event is ever requested back. The server side likewise has no write timeout: `writeSSE`'s promise chain queues one after another and queues without end when writes stall; `onAbort` never fires, and there is not one log line. The frontend's only error handling is a single probe of `/api/me` when `closed` is true — and a half-dead connection never turns `closed` true.

Locally this connection is a socket on the loopback and cannot go half-dead. Remotely it passes through the ssh session, the SOCKS dial, and the proxy's two stream conversions; whichever layer quietly stops, the description above holds: the POST goes over a new connection and succeeds as usual; the echo is written onto an old connection nobody is reading; and after a refresh everything is there.

This is the **most credible explanation** today's code can give, but it is still inference. Turning it into fact requires four moments: when the event was published to the channel, when it was written into that connection, when the browser received the last event, and on what basis the browser believes the connection is still alive. None of them is recorded today. The frontend has not one `console` line on SSE; the server has not one log line on subscription, disconnect, replay hit or miss, or `resync_required`; and not one test covers the "connection not broken but no longer delivering" case.

### Real environments differ from simulated ones

Both incidents happened in real environments: sessions that had run for weeks, the Machine on another host, ssh in between. CI and local development cannot reproduce them, and there is no need to — real environments are producing this data every day; what is missing is only recording it when it matters. What needs tuning is the system under heavy load and in unusual environments, so the data must come from those environments. Neither incident happens only once: long sessions are slow on every open, and remote connections go half-dead again after a while. So "turn telemetry on after an incident and wait for the next one" is a workable usage, and telemetry need not stay always-on just to catch the first occurrence.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### Three terms

A **probe** is a recording location in the code with a name, and the name states which layer it sits at: `http.request`, `sse.write`, `client.session.open`. A **sample** is one fact a probe writes down: timestamp, duration, byte count, count, status, plus a few attributes. A **correlation key** is an id that lets samples from different layers line up: request id, Session id, SSE event id, machine id.

Telemetry records only shape, not content. An `http.request` sample knows the request was `GET /api/sessions/:sessionId/messages`, 200, 9800 ms, with a 4.2 MB response; it does not know what was inside the response. A `client.send` sample knows how long the POST took and which number the echo's event id was; it does not know what the user said.

### Every sample names its own layer

This is the rule carried over from PRFC-0006: a fact must state clearly which layer it measures. The second incident cannot be investigated because none of the four moments — "published to the channel", "written to the socket", "received by the browser", "rendered" — is recorded, while "the message was lost" could have happened between any two of them. Telemetry's probes are named by layer, so one message's journey can be strung into a single row by its correlation keys:

| Layer | Probe | What it records |
| --- | --- | --- |
| Server channel | `sse.publish` | Event id, byte count, channel key |
| Server connection | `sse.write` | Which event id this connection has written up to, how many bytes written, when and why the connection closed |
| Proxy | `proxy.forward` | Which machine it forwards to, when and how the upstream ended, how many bytes relayed |
| Browser | `client.sse` | Connection open, close, error; the Last-Event-ID carried on reconnect; the last event id received |
| Browser | `client.send` | POST duration and status; the echo event id returned in the response; the moment the echo arrives; if it doesn't arrive in time, an `echo_missing` is recorded, carrying the last event id received at that point |

With this row, "the echo never arrived" becomes an answerable question: was it published? Onto which connection was it written? Did the browser receive it? When did the browser last receive anything at all?

The last question does not even have a data source today: `EventSource` cannot see the heartbeat comment line. So the probes, the moment they land, will point at the first thing to change — the heartbeat must be a named event (`event: heartbeat`), so that the browser has something to record and a basis for judging the connection half-dead. That is one fix telemetry drags out in passing; its real job lies elsewhere: making blind spots of this kind surface on their own.

### The row for a session open

The first incident works the same way. The server's `session.messages` sample records how many shards this open read, how many bytes, how many sub-sessions were inlined, whether the stats cache was cold, and how long each stage took; `http.request` records response byte count and total duration; the browser's `client.session.open` records how long download, parsing, the reducer, and first render each took, plus how many items, how many images, and how many image bytes this window holds. Lay the four numbers out and the ten seconds' whereabouts are clear.

### Switches

Telemetry is **off by default, with no runtime overhead while off**. This is a hard decision of this proposal, for two reasons: telemetry is an instrument for troubleshooting, not the system's record — nobody should be paying for it while nobody is looking; and "never written to disk" is one piece with it — with nothing on disk there is nothing to retain, migrate, clean up, or audit, and switching it off zeroes everything.

Three switches, all in the machine-level `server_settings` (per PRFC-0004's framing: these are operational facts of this machine, changed by admins in system settings, effective immediately). The master switch lives in "Settings → General", visible to admins only:

- `telemetry.enabled`: the fixed probes and the in-memory buffer. Off by default. While off, each probe costs only one boolean check, the buffer is not allocated, and `/api/telemetry` refuses input.
- `telemetry.client`: browser-side collection and reporting. Off by default. While off, the frontend times nothing, buffers no samples, and sends no requests; the switch rides down with existing first-screen requests like `/api/me`, and the frontend decides from it whether to collect.
- `telemetry.instrument`: a list of module names; every interface edge of a listed module gets wrapped and timed per method. Empty by default. When empty, `intercept` is not passed to the booter at all, and the tree contains not a single `Proxy`. This is the expensive kind — turn it on while investigating, turn it off when done.

### The wiring hook: touching nothing in the measured module

The implementation of the third switch is the part of this proposal most worth explaining. After PRFC-0001, every server-side node writes what it wants in its `@Use` fields; after PRFC-0005, those fields' types are all interface classes, with methods and signatures in `ifaces.json`. At startup the booter resolves these edges one by one and stuffs the provider's instance into the consumer's field — the line `use[alias] = apiOf(t.module, t.alias)` in `bootModules`.

That line is where the hook sits. The booter accepts one more optional `intercept(edge, value)`; `edge` describes the edge's consumer, provider, interface name, and method table, and the return value is injected in place of `value`. Telemetry's wrapper takes the method table and wraps each method in a timing shell: a synchronous return is recorded right away, a Promise-returning one after it settles. The consumer receives the shell, the provider never knows it was wrapped, and neither side's code changes by one line. To see which method of `SessionsModule` is slow, write it into `telemetry.instrument`, restart, and read the `module.call` samples.

This works thanks to that PRFC-0005 rule: `@Use` can only be an interface. If a field could still point at an implementation class, the hook would have to guess which properties are methods — a wrong guess either misses measurements or wraps something broken; with the method table coming from signature data, there is nothing left to guess.

### Where to look

The stats center already has "Usage" and "Errors"; telemetry adds a "Performance" page beside them: a "Clear" button at the top, and below it the current buffer's samples aggregated per probe as p50 / p95 / max. Every column is sortable by clicking its header, defaulting to p95 descending — complaints about slowness are about the tail, and a probe that is slow once in twenty attempts is invisible in the median. It can be filtered by Session, and clicking a row reveals the single chain its correlation keys string together. The page reads memory, so one server restart empties it; to keep a copy, the page has "Export" — download the buffer's current samples as a JSON file, stored wherever a human decides, never written by the system itself. Servers on remote Machines each record their own, and this page views that side's buffer through the existing `/server/<id>/api/…` proxy; the request id is forwarded verbatim by the proxy, so the samples on both sides line up.

The "Name" of each row is the probe's name; clicking it jumps to that probe's documentation on GitHub (its section in `packages/server/src/telemetry/probes.<lang>.md`, file chosen by interface language), and the "?" beside the name shows a one-sentence summary of that section. The documentation states clearly what one sample measures and links, with a relative link, to the line of code that records it; the relative link and the documentation sit at the same commit, so the line numbers match. Line numbers are written back by `pnpm gen:probe-docs` from the same scan the build uses, and tests fail when line numbers are stale or a probe's section is missing. The commit the links point to is captured at build time: the build script scans the probe calls in the source and writes the "name → file and line" mapping — together with the repo and commit the scan saw, and whether there were uncommitted changes within the scanned scope — into the build artifacts (the server's goes into the platform bundle; `web.*`'s goes into the frontend bundle together with each section's summary; each mapping to its own commit), and the read endpoint brings back the server's copy alongside the per-probe view. Template-generated names like `turn.${segment}` are recorded as `turn.*` and share one section. When the artifacts lack the table (an unpackaged dev run) or a name cannot be found, the name is plain text; when there are uncommitted changes within the scanned scope, the link is still given, with a note that the line numbers may not match.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Samples

```ts
interface Sample {
  ts: number;            // recording moment, epoch ms
  probe: string;         // probe name, named by layer
  durMs?: number;
  bytes?: number;
  n?: number;            // count-type probes
  status?: string;       // "ok" | "error" | a probe-defined status
  keys: {                // correlation keys, all optional
    request?: string;
    session?: string;
    event?: string;      // SSE event id
    machine?: string;
  };
  attrs?: Record<string, string | number | boolean>;  // the probe's own attributes, allow-listed
}
```

`attrs` is an allow-list, not an arbitrary object: HTTP records the route pattern (`/api/sessions/:sessionId/messages`) but not the actual path, and not query values; paths of file-type endpoints, message bodies, and any user content never enter. Samples are for humans reading performance, not a second Trace.

### Storage and limits

Samples live in a process-internal ring buffer shaped like the SSE channel's buffer: dual caps by count and bytes, evicting the oldest on overflow. Defaults are 50k samples or 16 MB. It writes nothing to web.db and no files; when `telemetry.enabled` is switched off, the whole buffer is released. Admins can clear it manually.

The cost of not persisting must be said plainly: a restart wipes it, and so does a hot push (the buffer belongs to this generation of the App; the new generation starts empty). This is deliberate. Telemetry answers questions about "now" and "just now"; a performance record that survives restarts would drag in a whole set of things this proposal does not want — migrations, capacity, retention policy, and who may view history. To keep a copy, export it — see "Where to look".

High-frequency probes do not record per event. A fast long reply under `sse.write` produces thousands of events, and recording each one would spin the buffer full in no time; it aggregates into one record per connection per 5 seconds: how many events and how many bytes were written in those 5 seconds, and the max publish-to-write latency. Connection open and close each record one sample, carrying the Last-Event-ID at open, whether replay hit, and the close reason (client disconnect, upstream disconnect, write error, server reclaim).

### Fixed probes

Server side:

| Probe | Location | What it records |
| --- | --- | --- |
| `http.request` | the existing request-logging middleware | method, route pattern, status code, duration, request and response byte counts, request id |
| `proxy.forward` | `machines/proxy.ts` | machine id, upstream status code, duration, bytes relayed, how the stream ended (normal / upstream error / client disconnect) |
| `sse.connection` | the subscription site of Session and user channels | channel key, Last-Event-ID, whether replay hit, replayed count, close reason, connection duration |
| `sse.write` | same site, aggregated | events written and bytes within 5 seconds, max publish-to-write latency |
| `sse.evict` | `Channel.publish` | one record when a buffer eviction happens: the seq evicted up to, and the buffer's size at that moment |
| `trace.read` | `TraceService.readShard` | hash of the shard path, byte count, record count, parse duration |
| `session.messages` | `TraceService.readMessagesPage` | window unit count, shards read, sub-sessions inlined, whether the stats cache hit, per-stage durations, response byte count |
| `session.resume` | session resume | replayed item count, duration |

The request id is generated in the request-logging middleware and written back as the `x-penguin-request-id` response header; the proxy forwards verbatim an id already present in the request headers, so the remote side carries the same one. `AsyncLocalStorage` carries the request id into the module calls that the request triggers, so `module.call` samples can attach to the request; this is the only transfer across an async boundary, and its cost must be measured during implementation.

Browser:

| Probe | What it records |
| --- | --- |
| `client.session.open` | download duration and byte count, `JSON.parse` duration, reducer duration, first-frame render duration (the next `requestAnimationFrame` after commit), item count, image count and image byte count |
| `client.sse` | open, close, error, reconnect and its Last-Event-ID, `resync_required` count, last event id received |
| `client.send` | POST duration and status, request id, the echo event id returned in the response, echo arrival time; after 30 seconds without it, record `echo_missing` carrying the last event id received and the time of the last heartbeat |
| `client.fetch` | duration, status, byte count, and request id of the remaining API calls, aggregated by route pattern |

Every 10 seconds the browser `POST /api/telemetry`s the samples it has accumulated, and on page unload it sends the last batch with `sendBeacon`. The server stamps each with the user id and drops it into the same buffer. While `telemetry.client` is off, the frontend neither collects nor sends, and the server does not accept.

The correlation key for echo matching needs no invention: in `launchTask`, every `channel.publish` of an input message returns an event with its id, and the `POST /tasks` and `POST /steer` responses carry the last one back (`{ sessionId, queued, echoEventId }`). The frontend waits on it: an event with an id not less than it appearing on the stream means the echo has arrived; if it never comes, `echo_missing` is recorded. This id has a second use — the moment the frontend sees its last received event id fall behind it, it knows the stream has fallen behind and can disconnect and reconnect on its own, rather than waiting for an `onerror` that never comes. That part belongs to the fixes and is written up in Future possibilities; telemetry only requires that id to appear in the response.

Once the heartbeat becomes a named event, `client.sse` records one more item: "the time of the last heartbeat". The frontend can build a watchdog on it: no activity for two heartbeat periods means reconnect proactively. The watchdog itself is also a fix; this document only defines the probe.

### The wiring hook

`bootModules` gains one more option:

```ts
interface BootModulesOptions {
  // …the existing ifaces, resources, parked, published
  intercept?: (edge: Edge, value: unknown) => unknown;
}
interface Edge {
  consumer: string;        // module name
  alias: string;           // the consumer's @Use field name
  provider: string;        // module name
  iface: string;           // `<module>#<iface>`
  methods: readonly string[];   // from the provides table
}
```

At `use[alias] = apiOf(…)`, the booter now routes through `intercept` first. It affects neither the re-export of exports nor the validation of `provides` — validation checks the provider's instance, while what gets wrapped is the reference the consumer receives. Today's resolver has no notion of decoration, replacement, or override: a requirement resolves to one provider, and two satisfying it together is an ambiguity error, so a telemetry module cannot wedge itself between consumer and provider by "also providing the same interface"; `intercept` is newly added and the only such opening. It holds only on the module-tree branch; on main it is still one `AppDeps` bundle with no edges to wrap.

Telemetry's wrapper: a `Proxy` whose `get` returns a timing shell when the name hits the method table and otherwise forwards verbatim (fields, `park`, anything not in the table — untouched). The shell records `module.call` samples, aggregated per 10 seconds by (consumer, iface, method): call count, total duration, max duration, throw count. Synchronous methods are recorded after returning; thenable returns are recorded after settling, with a rejection counting as one error. The shell swallows no exceptions and alters no return values.

Which edges get wrapped is decided by `telemetry.instrument`: a name in the list matching either consumer or provider means wrapped; `"*"` wraps everything and should be used only in development. `intercept` is passed in by the runtime shell on every App creation (where `hmr/platform.ts` calls `bootModules`), so after a hot push the new generation's tree is wrapped just the same; the buffer does not enter the parked document — hot push and rollback neither touch it nor carry it along.

Changing `telemetry.instrument` takes a restart or one hot push to take effect, and the page must say so. The switches for the fixed probes and browser reporting take effect immediately.

### Relation to existing mechanisms

- **The request-logging line stays** — it is the fastest glance on stdout; telemetry records byte counts and the request id in the same middleware.
- **Error persistence unchanged.** A failed request is one exception in error_records and one `status: "error"` sample in telemetry; they answer two different questions (what went wrong / how slow and how large) and are not merged.
- **Trace unchanged.** Trace is defined as one file corresponding to one complete model context; stuffing platform events in would break that definition. Telemetry has its own buffer, and it never touches disk.
- **The existing `ProxyReport` in `machines/proxy.ts`** — which, on each forward, conveniently records "did the other side's API answer" into the machine list — is a precedent of the same kind: passive measurement riding existing traffic. `proxy.forward` generalizes it.
- **The `observeShardRead` test hook in `TraceService`** records exactly what `trace.read` wants to record; at implementation time it can simply be that probe.

### Permissions

Telemetry is read by admins, for the same reason error persistence keeps "unattributed errors visible to admins only": samples carry other users' Session ids, request routes, and machine ids, and dropping them onto any member's page would be a cross-tenant leak. Ordinary members' stats centers never show this page. Switches, clearing, and export are admin-only.

The Agent's own commands are a different kind of reader. The `PENGUIN_API_TOKEN` a server-driven session hands to its tool subprocesses is not an admin token but that session's own credential: it authenticates with admin identity yet may only traverse a session-narrowed route table. Applied to telemetry:

- Reading `/api/telemetry` must carry `session=`, naming a session belonging to the credential's own Agent (or one it created itself), and returns only that session's samples; without it, or naming another Agent's session, the answer is `403 session_scope`.
- Clearing and switches (`DELETE /api/telemetry`, `PUT /api/admin/settings`) are 403 for session credentials, without exception.
- `penguin telemetry` in a session filters by `PENGUIN_SESSION_ID` by default, with `--all` canceling it; with session credentials, that default turns from a "filter" into a boundary, and `--all` in a session gets 403.

There is no longer a token on disk whose mere reading equals admin, either: the startup token lives only in memory, used to sign session credentials. The shape of session credentials and the full route table are not telemetry's business — see their implementation (proposal #146, `Myriad-Dreamin/penguin-harness#121`).

## Drawbacks
[drawbacks]: #drawbacks

**Yet another page.** The stats center already has usage and errors; performance adds a third page, each with its own filters.

**Off by default means the first occurrence is missed.** At the moment of an incident telemetry is most likely off; all one can do is turn it on and wait for the next one. As said above, both classes of problems recur, but some things happen only once, and for those this system cannot help.

**A restart wipes it.** If the server restarts mid-investigation, the buffer clears and everything accumulated is gone. Export is the fallback, but someone has to remember to click it.

**Wrapping has real overhead.** A `Proxy` plus one function call is not free for a method called thousands of times per second. Nothing is wrapped by default and `"*"` is for development only, but that is a rule held up by documentation.

**Samples are not a replay.** Telemetry can say "`session.messages` spent 4 of the 6 seconds inlining sub-sessions", but not what was read that time; for content you still have to go to Trace.

**The word "telemetry" carries baggage.** A user's first reaction on seeing it is where the data will be sent. Documentation, the settings page, and first launch must put "stays on this machine, never sent anywhere" in the most prominent place, and that is a promise that must not be broken — if one day sending it out truly becomes necessary, that is another PRFC, off by default.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**Adopt the OpenTelemetry SDK outright.** It has mature spans, attributes, and export protocols, plus auto-instrumentation for Node. Three reasons not to: it assumes a collector standing nearby, which desktop apps and single-machine deployments do not have; its auto-instrumentation knows http and fetch but not SSE ring buffers, ssh-based proxies, or module-tree edges — exactly where our unknowns live; and it is a sizable dependency tree, a poor trade for two tables. The sample shape deliberately stays close to span, so a future OTLP export is only one more outlet (see Future possibilities).

**Log more.** The cheapest option, and what is being done today. Logs have no correlation keys; the server and the browser each speak their own language, and the ten-second breakdown has to be stitched by hand from scattered lines — what is more, the browser's logs never reach the server at all.

**Just fix these two problems.** Compressing responses, lazy-loading images, adding send confirmation — each could well be the right one, but picking which is a guess. This proposal does not reject those fixes; it first says which one to fix, and after the fix it can measure whether it worked. When the next problem comes, there is no need to start guessing from zero again.

**Write platform events into Trace.** Trace already has a profiling page, so adding a few event kinds there looks cheapest. But one Trace file corresponds to one model context — a definition that both recovery and compression rely on; HTTP requests and SSE connections belong to no model context, and stuffing them in breaks the definition.

**Hand-write timing inside every module.** It invades every place you want to measure; unmeasured places remain forever uninvestigable, and the next module to measure means another round of edits. The wiring hook changes only the booter in one place; after that, measuring someone new is a config change. This too is a practice that only became possible after PRFC-0005's "depend on mechanisms, not implementations" — interfaces became data, so wrapping has nothing to guess.

**Persist to disk, always on.** Into web.db like error_records: survives restarts, history browsable at any time. The price is that always-on carries always-on costs — a few more writes per request, caps and cleanup for the table, someone to manage history permissions — costs every deployment pays forever, in exchange for the occasional investigation made convenient. Telemetry is an instrument, and an instrument should be taken out when in use; to keep a copy, export it.

**Do nothing.** These two incidents keep happening, each investigated by guesswork. Users in real environments will find the next one before we do.

## Prior art
[prior-art]: #prior-art

**OpenTelemetry**'s spans and attributes are the source of the sample shape: timestamp, duration, a set of flat attributes, correlated by id. Its SDK and collector are not taken here, for the reasons above.

**The browser's Navigation Timing and Resource Timing** slice one load into DNS, connection, download, parsing, and rendering, giving each a moment. `client.session.open` is the same idea moved onto "open a session", an application-level action.

**VS Code's "Show Running Extensions" panel** lists each extension's activation time and its most recent call's duration, made possible by the host timing at the edge where extension APIs are called — the extension itself unaware. `module.call` has the same shape: measure at the edge, the measured party unaware.

**Go's `net/http/httptrace`** lets the caller attach callbacks at each stage of a request (got a connection, request headers written, first byte received) without changing the request logic itself. Naming probes by stage and letting the caller decide whether to attach comes from it.

**Spring AOP and Java's dynamic proxies** wrap interfaces at injection time — the wiring hook's elder predecessors. The difference is that they find methods by runtime reflection, while here the method table comes from signature data, which holds across hot-push boundaries too.

**Precedents in this repository**: the SSE channel's ring buffer (dual caps by count and bytes, evict the oldest) is the direct prototype of the sample buffer; error_records' "visible to admins only" is copied as-is; `machines/proxy.ts`'s `ProxyReport` is already a passive measurement point; PRFC-0006's "a fact names its own layer" is the rule for naming probes.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- The buffer caps and aggregation windows (50k samples, 16 MB, 5 s, 10 s) are educated guesses; settle them after running enabled in real environments for a few days.
- The overhead of carrying the request id through `AsyncLocalStorage` has not been measured. If it proves significant, fall back to enabling it only when `telemetry.instrument` is non-empty.
- Once the heartbeat becomes a named event, old frontends will take it as an unrecognized `event:` and ignore it, so there is no compatibility problem; but it enters the ring buffer and consumes seqs — whether to take a `sendTo`-style path that bypasses the buffer is decided at implementation time.
- Whether `module.call` should record argument shapes (say, the byte count of the first argument). Useful, but close to the "no content" red line; the first version does not record them.
- Whether the CLI should get a `penguin telemetry` subcommand to view the same buffer and do the same export. Useful; not decided in this document.

## Future possibilities
[future-possibilities]: #future-possibilities

**Where the data will point first.** With data in hand, the first incident will most likely land on one or two of these: response compression, image lazy-loading with a total cap, sub-session inlining made on demand, browser-side parsing moved to a Worker, message-stream virtualization. Which one — wait for the samples to say.

**The fix for the second incident already shows its outline**, three small things each: the heartbeat becomes a named event; the frontend gains a watchdog that reconnects proactively after two periods without a heartbeat; the `POST /tasks` response carries back the echo event id, from which the frontend can tell whether the stream has fallen behind. On the server side, add one more thing — a write timeout: if writing stalls, close the connection and record a sample. These need not wait for telemetry to land, but once done they need telemetry to prove they actually work.

**Performance regression in CI.** Run the same probes in e2e, compare the `client.session.open` and `session.messages` numbers against the previous run, and go red past a threshold. This line does not exist today because there are no numbers.

**An OTLP outlet.** The sample shape is close to span, so one optional exporter would connect to the user's own collector. Off by default; a separate PRFC.

**Per-Task budget alerts.** When a Task's tool wall time, request count, or response byte count passes some number, hint in the session. The data is all there; what is missing is deciding the threshold.

**The frontend tree.** PRFC-0001 mentions the frontend has its own module manifest too; today's browser-side probes are a few hand-written spots, and they could go through the same wiring hook in the future.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the current version of the draft carried by design PR [#113](https://github.com/Prism-Shadow/penguin-harness-design/pull/113), identical to the source file.
