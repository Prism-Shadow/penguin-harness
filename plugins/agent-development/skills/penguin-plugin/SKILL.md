---
name: penguin-plugin
description: Use for workbenches — the tabs and pages beside the chat, with server code behind them, that an Agent keeps in its own `workbenches/` folder inside PenguinHarness — building one, changing it, showing it as the whole app, restoring an earlier version, and removing a tab or a whole workbench when the user wants the custom UI gone.
version: 2026.10.26.1
---

# Agent Workbench with Penguin Plugins

Inside PenguinHarness an Agent can hold *workbenches*: small plugin packages in its own directory, written in TypeScript, that the server boots as module trees, shows as tabs beside the chat, reloads on every file change, and versions so any edit can be undone. This is the same module mechanism the server itself is built from — manifests as data, everything checked before any code runs — so a workbench that does not type-check, that was written against an interface version this server no longer fits, or whose manifests do not hold together fails to load with the problem named, while the previous version keeps serving.

A workbench is a plugin of the server's own kind, which is where this skill's name comes from. It is not a program that reaches an agent from outside, so it takes neither of the penguin-sdk skill's two ways, and that skill's question does not apply to it.

## Before you start

If the user's message only invokes this skill (e.g. "use penguin-plugin skill") without saying what the workbench is for, ask the user what they want it to do. Once the request is concrete, do **not** ask follow-up questions: build it end to end and list the assumptions you made in your final reply. A request to undo, revert or remove the UI is the exception: work out which of the four in *Undoing, reverting, removing* is meant first.

## Build a new Agent and its workbench

For an app inside PenguinHarness, use this skill with `agent-initialization`. The Plugin host already runs the Agent; do not ask the user to choose SDK/API architecture or enable Agent API keys. If the request says **new Agent**, create that target first and put all workbench files in **its** directory, not the Builder's. Keep the resolved target path for the whole task.

1. Read the Environment's App Data Dir and Agent ID; use `agent-initialization` to create the requested target. List existing agent ids, choose an unused id (letters, digits and underscores), and write its role. Give a contract reviewer domain instructions, not app-building skills. Inherit the current runtime unless the user specified another.
2. Under `<App Data Dir>/agents/<target_agent_id>/workbenches/<workbench_id>/`, write the three-file scaffold below. Every visible app needs a `WebModule.sessionTabs` contribution.
3. **Activate and check the target**, including a new Agent nobody has opened yet:
   ```bash
   node "<this skill directory>/scripts/check.mjs" <target_agent_id> <workbench_id>
   ```
   The helper uses only this Session's injected server URL/token/Project and registers Agents created through file tools, then starts the target watcher. It bypasses shell HTTP proxies. Never print tokens, scan ports, read project credentials, or use another running Penguin instance. If the injected variables are unavailable, ask the user to open the target Agent's new conversation once.
4. Read the target's `.harness/plugin.d.ts` for exact host types and `.build/status.json` for compiler feedback. `.harness/README.md` is the running server's contract. Fix named diagnostics; re-run the helper after edits. Success means `error: null`, your contributed tab present and no hints, not merely an HTML file on disk.
5. Exercise a real request through your handler, wait for a terminal result, and inspect the returned answer or downloaded report. For HTTP tests use the injected URL with `curl --noproxy '*'`, bearer token only in the header. Check malformed input and empty/loading/failed states too. A compiler pass is not an end-to-end test. If browser automation is unavailable, report that limitation; finish the HTTP and script-syntax checks and state that the visual check remains unverified. Do not launch a separate system browser or install a DOM/browser test environment for a one-off workbench.
6. Hand off through **Agents → target Agent → New chat → the named workbench tab**. The workbench works in a new conversation before the user sends a chat message. Include the target Agent's link (`/agents/<target_agent_id>`) and tab name. Full-page mode is optional.

## Background jobs: launch, poll, persist

`await host.run(...)` resolves when a turn **starts**. `await host.sessionResult(id)` is also a **snapshot**, never a wait. Its `status` is `running`, `completed` or `failed`; `text` is the final assistant answer only on success, and `error` explains failure. `sessionStatus() === "idle"` alone does not prove success.

Use this pattern for uploads, research and support tickets:

- On POST, validate input, create a Session and persist a job containing its `sessionId` and `status: "running"` with `host.setState`. Start the turn and return the job immediately. Catch launch failures and persist `failed`.
- On GET, for each running job call `host.sessionResult(sessionId)`. Leave `running` jobs alone. Persist `completed` plus the returned text, or `failed` plus the error. Never mark a running snapshot failed because its text is empty.
- Let the page poll GET every few seconds while visible; to show the answer as it is written, follow the Session too (*Follow the Agent live*). Reopening the tab or reloading code resumes from persisted session ids. Do not keep the only job state in a detached promise or a timer that disappears on reload.
- For text reports, ask the Agent to put the complete report in its **final answer**; store that returned text and serve it with a download content type and `Content-Disposition: attachment`. Link directly to the same-origin report route with an `<a download>`; avoid fetching a Blob and clicking an object URL, which did not download in the embedded browser. Verify the saved file, not a toast saying it started. No Trace parsing or cross-workspace report-file probe is needed.
- `host.getState()` is synchronous, `unknown`, initially `null`. Clone before editing; serialize read/modify/write handlers to avoid lost updates. Await `host.setState` before returning success.
- Store large upload bytes outside the watched source folder, e.g. the target Agent's `scratchpad/<workbench_id>/uploads/`. Keep metadata in host state. Source changes trigger reloads; runtime files in `workbenches/<id>/` trigger needless rebuilds and enter version history. `import.meta.url` points into `.build/<revision>/`, not the source root.

## Follow the Agent live (AMSP)

Polling shows a job only once it is done. To show the answer while the Agent writes it, and to learn the moment a turn ends, follow the job's Session over AMSP: the records its Trace holds plus the streamed fragments, the same ones the chat view reads. AMSP carries the Agent's conversation and nothing else. Starting a turn, follow-ups, saving results and every other side effect stay in your handler.

**The page** imports the page SDK the server serves beside your workbench, relative to the page just like `../api/…`: `../sdk/workbench.js` from a page directly under `ui/`, one more `../` for each folder deeper:

```js
let reader = null;

async function openItem(item) {
  if (item.status !== "running") return;
  let sdk;
  try {
    sdk = await import("../sdk/workbench.js");
  } catch {
    return startPolling(); // an older server has no page SDK: keep polling GET
  }
  let draft = "";
  reader = sdk.followSession(item.sessionId, { tailLimit: 1 });
  reader.on("event", ({ record }) => {
    if (record.origin) return; // a subagent's record, not the main conversation
    const p = record.payload;
    if (p.type === "request_begin") draft = "";
    if (p.type === "partial_text") showDraft((draft += p.text));
    if (p.type === "tool_call") showActivity(p.name);
    if (p.type === "task_end") refresh(); // the saved answer replaces the draft
  });
  reader.on("reset", () => showDraft((draft = "")));
  stopButton.onclick = () => sdk.abortSession(item.sessionId);
}

function closeItem() {
  reader?.close();
  reader = null;
}
```

- Open one reader for the item on screen (its dialog or detail view), never one per list row: each reader holds a connection, and a browser allows only a few per origin. Close it when the dialog closes and when the page is hidden (`visibilitychange`).
- `followSession(sessionId, options?)` returns the SDK's `SessionReader` on the Session's stream, taking `tailLimit` and the reader's other options: it reads the latest Tasks of the history (events with `source: "history"`), then the live tail, and reconnects on its own. On `reset`, drop what you drew; the history follows again. Records of subagents come through with an `origin`; skip them yourself.
- `task_end` is a hint, not the result: on it, refresh from your handler, whose saved answer is what stays. Keep the polling path from *Background jobs* as the fallback for a failed import, and keep the list itself on (slower) polling.
- `abortSession(sessionId)` stops the running task, for a Stop button, and resolves `true` when there was one to stop, `false` when nothing was running.
- `workbench.js` re-exports everything `@prismshadow/amsp` does, plus `apiBase` and `transport` for other reads of the signed-in user's door. Never write an absolute `/api/…` path into a page: a workbench on a machine is served under `/server/<machine>/api/…`, a reverse proxy may add a prefix of its own, and `apiBase` already says which.

**The handler** gets the same records from `host.subscribe(sessionId, listener)`, which returns the function that stops them. It is live only: nothing from before the call, no history, so subscribe before `host.run`. A record is a `WorkbenchRecord` (`{ timestamp, type, payload: { type?, … }, origin? }`, from `@prismshadow/penguin-server/plugin`). Treat it as a trigger and keep `await host.sessionResult(sessionId)` as the authoritative snapshot:

```ts
create({ use }) {
  const host = use.host;
  const watching = new Map<string, () => void>();
  const watch = (sessionId: string) => {
    if (watching.has(sessionId)) return;
    const stop = host.subscribe(sessionId, (record) => {
      if (record.origin || record.payload.type !== "task_end") return;
      void settleWhenIdle(sessionId).then((done) => {
        if (!done) return; // a queued follow-up started: wait for its task_end
        stop();
        watching.delete(sessionId);
      });
    });
    watching.set(sessionId, stop);
  };
  // create runs again whenever the workbench loads, and a reload ends every subscription.
  for (const job of runningJobs(host.getState())) watch(job.sessionId);
  // …and call watch(sessionId) before host.run, when a job starts and on every follow-up.
}
```

- The main `task_end` arrives a moment before the Session reads idle, and until then `sessionResult` still says `running`. So `settleWhenIdle` waits a little for `host.sessionStatus(sessionId)` to read `idle`, then reads `sessionResult` and saves `completed` or `failed` with `host.setState` under the same read/modify/write lock as your routes. If the Session stays busy, a queued follow-up has started: return `false` and keep watching.
- Keep the GET-time reconcile from *Background jobs*. Nothing is replayed: subscriptions end with a reload, a rollback, removal or a server restart (and `create` runs again only when the workbench next loads), and on their own once the Session has sat idle with nothing published for a while.
- A listener that throws is logged once and keeps receiving. A Session outside this Project throws at `subscribe`.
- If `.harness/plugin.d.ts` has no `subscribe`, the workbench was written against an older harness: delete `.harness/` and let the server write it again, then fix what the compiler reports.

Never reach the Agent from a workbench through the Agent API: not `/api/amsp/v1`, not an Agent key, not the Agent's API switch or the key door. That door needs the owner to open the Agent, refuses the Sessions a workbench creates, and a key in a page is readable by everyone who opens it. The page SDK reads the signed-in user's own door, which needs nothing.

To see what a page will see, start a turn through your handler and run `node "<this skill directory>/scripts/check.mjs" --follow <sessionId>`: it prints the Session's records as they arrive, one JSON line each, until the main conversation's `task_end` or for a minute at most.

## Layout

Layout, under `<root>/<project_id>/agents/<agent_id>/workbenches/<workbench_id>/` (beside `agent_state/`):

```
package.json    "type": "module" and "penguin": { "modules": [ …manifests ] } — no dependency to install
index.ts        default export { modules: { <Name>: { create(ctx) } } } satisfies WorkbenchPackage — TypeScript only
ui/             the workbench's pages and their assets; which of them are tabs is what the manifest contributes
state.json      the workbench's own document, kept by the server across reloads and rollbacks
.harness/       the server's: the types this workbench was written against (plugin.d.ts) and their interface table — read plugin.d.ts, never edit it
.build/         the server's: emitted JavaScript per revision, and status.json — the result of the last load; read it, never edit it
```

## The manifest and the handler

The root manifest is named `Workbench`; it requires the host, provides the handler, and contributes its tabs:

```json
{
  "name": "demo",
  "version": "0.1.0",
  "type": "module",
  "penguin": {
    "modules": [
      {
        "name": "Workbench",
        "requires": { "host": { "iface": "@prismshadow/penguin-server#WorkbenchHost", "from": "Host" } },
        "provides": { "main": "@prismshadow/penguin-server#WorkbenchMain" },
        "contributes": {
          "WebModule.sessionTabs": [
            { "id": "demo.main", "key": "main", "title": "Demo", "titleZh": "演示", "renderer": { "iframe": { "src": "ui/index.html" } } }
          ]
        }
      }
    ]
  }
}
```

```ts
import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host = use.host;
        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                // req = { method, path, query, body }; path is below the workbench's api/ mount
                if (req.path === "/ask" && req.method === "POST") {
                  const { question } = req.body as { question: string };
                  // The SDK's two verbs: open a Session, run a turn in it.
                  const { sessionId } = await host.createSession();
                  await host.run(sessionId, [{ text: question }]);
                  return { body: { sessionId } };
                }
                return { status: 404, body: { error: "no such route" } };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
```

## Design the interaction before writing the UI

Treat the workbench as an application people return to. Before coding, choose its main list,
its item detail, and how a person creates and revisits an item. Use that structure even when the
request only says “build a Q&A app”. Do not turn independent conversations into one ever-growing
page of complete answers.

- For questions, requests and jobs, start with a compact, centered list of titles, statuses and
  update times. Open one item's conversation in a dialog or detail panel. Keep follow-up messages
  within that item's Session. Add search or pagination when a growing list needs it; long replies
  scroll inside the detail view instead of stretching the main page.
- A new-question dialog asks for the question only. Derive its title from
  `host.sessionTitle(sessionId)` once available, with a short question preview while waiting.
  Do not ask people to type both a title and the same question. Keep drafts when they dismiss and
  reopen the dialog. Persist the list and its Session IDs with `host.setState`.
- Dialogs need an obvious close button, Escape, and dismissal by clicking the surrounding blank
  backdrop. Only dismiss when the pointer starts and ends outside the dialog; dragging selected
  text out of it must not close it. Trap focus while open and restore focus to the opener on close.
  Native `<dialog>.showModal()` provides the keyboard and focus foundation, but implement and test
  backdrop dismissal yourself.
- Show submission and generation progress immediately, prevent duplicate submits, and keep a
  retry path for failures. For a long task, show elapsed time and optionally a clearly approximate
  remaining-time estimate; if the estimate runs out, say it is still processing instead of claiming
  completion. Better still, show the answer as the Agent writes it and what it is doing
  (*Follow the Agent live*), with a Stop button. Preserve the question on failure. Do not hide
  useful actions behind an indefinite loading screen.
- Keep the code small: separate UI, styles and handler logic, reuse the host's theme variables,
  and prefer native controls before adding dependencies. Use real empty, loading and error states;
  never leave blank alert boxes or display internal errors as a successful answer.

Verify the interaction, not just compilation: create **two independent items**, follow up in one,
close it by the backdrop and Escape, reopen each, and reload the page. Confirm the items remain
separate, saved answers return, drafts survive dismissal, and a long answer does not push the list
far down the page. Also check a narrow viewport, dark mode, keyboard focus and the way back from
full-app mode. Use a real browser when available; report any interaction you could not run. A
successful TypeScript load alone is not UI/UX validation.

## TypeScript, checked by the server

There is no build step to run, no `tsconfig.json` to write and nothing to `npm install`: the server builds one program from `index.ts` (and the `.ts` files it imports, with `.js` in the import specifier as NodeNext asks) under options it fixes itself — `strict` among them — refuses the load on any diagnostic, reporting file, line and reason, and otherwise emits into `.build/<revision>/` and imports that. `satisfies WorkbenchPackage` is what types `use.host` and `req`; without it `strict` refuses the untyped parameters. A folder holding `index.js` or `index.mjs` instead is refused outright.

## Types come from the harness that runs you

One machine can run several harnesses — a release, a checkout, a platform someone pushed with interfaces of its own — and none of them is a version on npm, so `@prismshadow/penguin-server/plugin` is not a package here: the first time the server loads the folder it writes `.harness/plugin.d.ts`, rendered from ITS OWN interface table, and that is what the import resolves to. Create `package.json` and a minimal `index.ts`, let the server load it once, then read `.harness/plugin.d.ts` for the exact `WorkbenchHost` this harness offers. The server then leaves `.harness/` alone: it is the record of what the workbench was written against, and a later generation of the platform is COMPARED with it, by the TypeScript compiler, both for what the workbench requires and what it provides — a host method you rely on that has since gone is a load error naming it, not a failure on the first call. To move a workbench onto the harness that runs it now, delete `.harness/` and fix what the compiler then reports.

## Tabs are contributions

Each entry under `WebModule.sessionTabs` is one tab beside the chat: `key` (unique in the workbench, part of the full-page URL), `title` / `titleZh`, and a `renderer` whose `iframe.src` is a file under `ui/`. Several entries make several tabs; none makes a server-only workbench. It is the same slot, written the same way, a plugin contributes to — the host opens it to workbenches and scopes the tab to this Agent. A slot the host has not opened (`WebModule.pages`, say) is refused by name.

## The host

`WorkbenchHost` (published as module `Host`) speaks the SDK's verbs, scoped to the workbench's Project: `listAgents()` returns the Project's Agents as `{ agentId }[]`; `createSession({ agentId? })` opens a Session of this Agent — or of another Agent of the same Project — and returns `{ sessionId }`. These Sessions carry source `workbench` and are automatically archived from the main chat sidebar; your list still reads and runs them through the host. `sessionTitle(sessionId)` returns the current generated title (or `null` before one exists); `run(sessionId, [{ text: "…" }])` — the SDK's `session.run`, its input items spelled out because a workbench has no package to import `userText` from — runs one turn in a Session, new or existing, and returns `{ sessionId, queued }` once it has started (a busy Session queues it as a follow-up; the Agent hears it as a message from the server, not from a person); `sessionStatus(sessionId)` says `idle` / `running` / …; `await sessionResult(sessionId)` returns a snapshot of the latest task (see *Background jobs*); `subscribe(sessionId, listener)` hands the listener the Session's AMSP records as they are written, live only, and returns the function that stops it (see *Follow the Agent live*); `getState()` / `setState(doc)` over `state.json` (`getState()` is `unknown`: narrow it); `log(text)`. More modules may be listed in `penguin.modules` and named as `children` of `Workbench`, with their own `requires` between them — the tree is checked as a whole.

## HTTP

HTTP, all under `/api/projects/:projectId/agents/:agentId/workbenches` (Project members only): `GET /` lists the workbenches with their `revision`, `uiRev`, `tabs` (each page's URL resolved) and current load `error`; `GET /:id/ui/*` serves a file of `ui/` (there is no default document — a tab names its page); any method on `/:id/api/*` reaches `handle` — JSON by default in both directions (`req.body` parsed, `{ status?, body? }` answered as JSON), and anything else when you say so: a non-JSON request body arrives as `req.bytes` (a `Uint8Array`; `req.headers` has its `content-type`, never the app's cookie), and a response that names a `content-type` in `headers` sends `body` as the string you wrote, or `bytes` for binary, or `stream` — an async iterable (an `async function*`) of strings or `Uint8Array`s, each chunk written to the client as you yield it, which is how server-sent events and a model's token-by-token answer get through without waiting for the end (relay an upstream stream by yielding its chunks; a `finally` in the generator runs when the client goes away — though a generator parked inside an `await` only gets there once that await settles, so give a relay its own timeout rather than trusting the disconnect) — with `location` + a 3xx status for a redirect. That is how a handler serves a page it renders, an upload, a download, or the pages of a program it runs on this machine: fetch `http://127.0.0.1:<port>/…` from the HANDLER and return what came back — never put `127.0.0.1` in a page, because the page runs in the user's browser, which may be on another machine than you are; `GET /:id/sdk/workbench.js` and `GET /:id/sdk/amsp.js` serve the page SDK (the `@prismshadow/amsp` browser build of the server answering, see *Follow the Agent live*); `POST /:id/reload`; `GET /:id/history` lists recorded versions; `POST /:id/rollback { revision }` restores one (code only — `state.json` stays) and reloads. `DELETE /:id` removes the workbench together with its recorded versions. From a page directly under `ui/`, call your handler with a relative `fetch("../api/…")` and import the page SDK with `import("../sdk/workbench.js")`; the Web App shows each page in its tab and reloads it when `uiRev` changes.

## Undoing, reverting, removing (撤销 / 还原 / 清掉界面)

When the user asks to undo the UI, revert it, clean it up or get the chat page back the way it was, they are asking you to TAKE SOMETHING AWAY — never to build something. Do not answer such a request by adding a feature (a reset button, an undo stack, a new route). Work out which of the four below they mean; if it is not obvious from what they said, ask in one line before touching anything. Everything about a workbench is files in your own Agent directory, so each of these is a file operation you make yourself — list `workbenches/` first to see what exists. The server notices within a moment and the user's tabs follow without a refresh.

1. *"Get rid of it" / "back to before there was any custom UI" / 回到没定义 UI 的状态* — remove the workbench entirely: delete the folder `workbenches/<id>/` **and** its recorded versions `workbenches-history/<id>/`. That is everything there is; the tabs disappear and nothing else of the Agent is touched. It cannot be undone, so say so in one line first, and never delete a workbench you were not asked to remove. (The user can do the same from the tab's bar: *Remove*, two clicks.)
2. *"Undo your last change" / "it was better before"* — go back to an earlier version of the CODE: the recorded versions are full copies under `workbenches-history/<id>/<revision>/` (`versions.json` lists them, newest first); copy that version's files over the folder and the server reloads it. The tab's bar offers the same as *History → Restore*.
3. *"Remove that tab" / "I only want the first page"* — delete its entry under `WebModule.sessionTabs` in `package.json` (and its page under `ui/` if nothing else uses it). With `"contributes": {}` the workbench keeps its server code and has no UI at all.
4. *"Bring back the data"* — you cannot: `state.json` is never part of a version (restoring code leaves the data as it is) and it has no history of its own. Say so plainly rather than inventing a recovery.

One constraint follows from 4, and it is a constraint on you, not a task to go and do: the workbench's data is only ever changed through `host.setState` from its handler. Never edit or delete `state.json` by hand — not to reset a board, not to fix a record — because what you overwrite is gone for good.

Your handler's responses are served from the app's own origin, so anything you echo back from a request is executed there: escape what you put into HTML, and treat a value that came in over `/api/*` as untrusted even though only Project members can reach it.

## Theme

A workbench page is a separate document, so it inherits nothing from the app's stylesheet by itself. The Web App stamps the app's look onto the page's root on every load and every appearance change: `light`/`dark`, `data-theme` (`modern`, `geek` or `github`), `data-accent` (only when the theme paints that accent), `data-font-latin` and `data-font-cjk`, the root font size, every `--ui-*` token of the app's token contract resolved as an inline style, and the app's bundled fonts. It injects `/workbench-ui.css` first in the head: a base stylesheet that styles plain HTML (headings, lists, forms, tables, code) to match the app and exposes `--wb-bg`, `--wb-surface`, `--wb-fg`, `--wb-muted`, `--wb-border`, `--wb-hover`, `--wb-accent`, `--wb-accent-fg`, `--wb-radius` (a box radius, not a pill), `--wb-font`, `--wb-mono`, the tone colours `--wb-tone-<tone>-fg`, `-bg` and `-line`, plus the classes `wb-primary` (a button), `wb-card`, `wb-rows`, `wb-row`, `wb-muted` and `wb-badge`, a status pill coloured by `data-tone` (`neutral` without one). Pick the tone the way the app does: there is no busy tone, so a running item is `success` with the word "Running", waiting or queued is `attention`, failed is `danger`, and finished is `done` or `neutral`, e.g. `<span class="wb-badge" data-tone="done">Resolved</span>`. Write plain markup, take every colour and font from those variables, and the page follows the user through every theme, accent, font and light/dark change; hardcode them and it clashes in one theme or another. The `--wb-*` names are only ever added to, never renamed. The `--ui-*` tokens underneath are readable too, but they follow the app's token contract and can be renamed with it, and as inline styles on the root no stylesheet of yours overrides them: to restyle, redeclare `--wb-*` on `:root`. The page's own rules always win over `/workbench-ui.css`, and linking `/workbench-ui.css` yourself makes it look right when opened outside the app too.

Keep empty alerts hidden. A component rule such as `.notice { display: flex }` overrides the browser's default `[hidden]` styling; the shared stylesheet preserves `[hidden]`, and standalone custom CSS should do the same. Check both empty and populated states.

## Filling the app

A page can be shown as the whole app — no sidebar, no chat, no tab strip — at `/app/<project>/<agent>/<workbench>[/<tab key>]` (the workbench's first tab when no key is given): the tab's *Fill the app* button goes there, `penguin web --app <project>/<agent>/<workbench>[/<tab key>]` opens the browser straight onto it, and the page itself can ask with `parent.postMessage({ type: "penguin:fill-app" }, "*")`. The floating *Exit full screen* button returns to the same Agent and workbench tab. The command palette also offers *Exit full page*. Its chord is Ctrl+Alt+P (⌥⌘P on macOS) unless the user rebound it under Settings › Keyboard shortcuts. A key pressed inside the page reaches the app only when the page has not handled it, so a page must not intercept that chord.
