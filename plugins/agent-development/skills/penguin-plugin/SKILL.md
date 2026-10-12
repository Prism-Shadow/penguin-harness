---
name: penguin-plugin
description: Use for workflows — the tabs and pages beside the chat, with server code behind them, that an Agent keeps in its own `workflows/` folder inside PenguinHarness — building one, changing it, showing it as the whole app, restoring an earlier version, and removing a tab or a whole workflow when the user wants the custom UI gone.
version: 2026.10.12.1
---

# Penguin plugins: workflows

Inside PenguinHarness an Agent can hold *workflows*: small plugin packages in its own directory, written in TypeScript, that the server boots as module trees, shows as tabs beside the chat, reloads on every file change, and versions so any edit can be undone. This is the same module mechanism the server itself is built from — manifests as data, everything checked before any code runs — so a workflow that does not type-check, that was written against an interface version this server no longer fits, or whose manifests do not hold together fails to load with the problem named, while the previous version keeps serving.

A workflow is a plugin of the server's own kind, which is where this skill's name comes from. It is not a program that reaches an agent from outside, so it takes neither of the penguin-sdk skill's two ways, and that skill's question does not apply to it.

## Before you start

If the user's message only invokes this skill (e.g. "use penguin-plugin skill") without saying what the workflow is for, ask the user what they want it to do. Once the request is concrete, do **not** ask follow-up questions: build it end to end and list the assumptions you made in your final reply. A request to undo, revert or remove the UI is the exception: work out which of the four in *Undoing, reverting, removing* is meant first.

## Start here — the whole loop is files

You need nothing but your file tools: no HTTP API, no port, no login, no server source. Do not go looking for the running server, its bundle or a checkout of the repository, and do not probe its API — everything you need to know is written into the workflow folder by the server itself.

1. *Where:* your Agent directory is `<App Data Dir>/agents/<Agent ID>/` — both values are in the Environment section of your system prompt. Workflows live in its `workflows/` folder (create it if it is missing); `ls` it to see what already exists before you add or change anything.
2. *Scaffold:* write the three files below — `package.json`, a minimal `index.ts`, one page under `ui/`. The server notices the folder within a second or two.
3. *Read what the server wrote back:* `.build/status.json` is the result of the last load — `{ ok, revision, checkedAt, error, tabs, hints }`. `ok: false` carries the compiler's or the checker's message with file, line and reason; fix that and look again. `ok: true` with an empty `tabs` means NOTHING shows in the user's chat page, however finished the page under `ui/` is: a page is only a file until `package.json` contributes a tab for it (see *Tabs are contributions* below), and `hints` spells out the entry to add. `.harness/README.md` is this same contract in the harness's own words — trust it over this skill if the two ever differ. `.harness/plugin.d.ts` is the exact `WorkflowHost` and `WorkflowMain` THIS harness offers — read it once instead of guessing at an interface.
4. *Iterate:* edit, wait a moment, read `.build/status.json` again. `checkedAt` changing tells you the server saw your edit. When it says `ok: true`, lists your tab under `tabs` and has no `hints`, the tab is already in the user's chat page — and not before. If `status.json` never appears, ask the user to open this Agent's chat page once (that is what starts the server watching the folder) rather than hunting for another way in.

What you do not need to find out by experiment: `host.run` resolves as soon as the turn has STARTED (not when it ends) with `{ sessionId, queued }`; `host.sessionStatus(id)` returns `"idle"`, `"running"` or `"compacting"`, so a run is finished when its Session is back to `"idle"`; `host.getState()` is synchronous and returns whatever was last passed to `setState` (`null` before the first one).

## Layout

Layout, under `<root>/<project_id>/agents/<agent_id>/workflows/<workflow_id>/` (beside `agent_state/`):

```
package.json    "type": "module" and "penguin": { "modules": [ …manifests ] } — no dependency to install
index.ts        default export { modules: { <Name>: { create(ctx) } } } satisfies WorkflowPackage — TypeScript only
ui/             the workflow's pages and their assets; which of them are tabs is what the manifest contributes
state.json      the workflow's own document, kept by the server across reloads and rollbacks
.harness/       the server's: the types this workflow was written against (plugin.d.ts) and their interface table — read plugin.d.ts, never edit it
.build/         the server's: emitted JavaScript per revision, and status.json — the result of the last load; read it, never edit it
```

## The manifest and the handler

The root manifest is named `Workflow`; it requires the host, provides the handler, and contributes its tabs:

```json
{
  "name": "demo",
  "version": "0.1.0",
  "type": "module",
  "penguin": {
    "modules": [
      {
        "name": "Workflow",
        "requires": { "host": { "iface": "@prismshadow/penguin-server#WorkflowHost", "from": "Host" } },
        "provides": { "main": "@prismshadow/penguin-server#WorkflowMain" },
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
import type { WorkflowPackage } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workflow: {
      create({ use }) {
        const host = use.host;
        return {
          api: {
            main: {
              async handle(req) {
                // req = { method, path, query, body }; path is below the workflow's api/ mount
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
} satisfies WorkflowPackage;
```

## TypeScript, checked by the server

There is no build step to run, no `tsconfig.json` to write and nothing to `npm install`: the server builds one program from `index.ts` (and the `.ts` files it imports, with `.js` in the import specifier as NodeNext asks) under options it fixes itself — `strict` among them — refuses the load on any diagnostic, reporting file, line and reason, and otherwise emits into `.build/<revision>/` and imports that. `satisfies WorkflowPackage` is what types `use.host` and `req`; without it `strict` refuses the untyped parameters. A folder holding `index.js` or `index.mjs` instead is refused outright.

## Types come from the harness that runs you

One machine can run several harnesses — a release, a checkout, a platform someone pushed with interfaces of its own — and none of them is a version on npm, so `@prismshadow/penguin-server/plugin` is not a package here: the first time the server loads the folder it writes `.harness/plugin.d.ts`, rendered from ITS OWN interface table, and that is what the import resolves to. Create `package.json` and a minimal `index.ts`, let the server load it once, then read `.harness/plugin.d.ts` for the exact `WorkflowHost` this harness offers. The server then leaves `.harness/` alone: it is the record of what the workflow was written against, and a later generation of the platform is COMPARED with it, by the TypeScript compiler, both for what the workflow requires and what it provides — a host method you rely on that has since gone is a load error naming it, not a failure on the first call. To move a workflow onto the harness that runs it now, delete `.harness/` and fix what the compiler then reports.

## Tabs are contributions

Each entry under `WebModule.sessionTabs` is one tab beside the chat: `key` (unique in the workflow, part of the full-page URL), `title` / `titleZh`, and a `renderer` whose `iframe.src` is a file under `ui/`. Several entries make several tabs; none makes a server-only workflow. It is the same slot, written the same way, a plugin contributes to — the host opens it to workflows and scopes the tab to this Agent. A slot the host has not opened (`WebModule.pages`, say) is refused by name.

## The host

`WorkflowHost` (published as module `Host`) speaks the SDK's verbs, scoped to the workflow's Project: `listAgents()` returns the Project's Agents as `{ agentId }[]`; `createSession({ agentId? })` opens a Session of this Agent — or of another Agent of the same Project — and returns `{ sessionId }`; `run(sessionId, [{ text: "…" }])` — the SDK's `session.run`, its input items spelled out because a workflow has no package to import `userText` from — runs one turn in a Session, new or existing, and returns `{ sessionId, queued }` once it has started (a busy Session queues it as a follow-up; the Agent hears it as a message from the server, not from a person); `sessionStatus(sessionId)` says `idle` / `running` / …; `getState()` / `setState(doc)` over `state.json` (`getState()` is `unknown`: narrow it); `log(text)`. More modules may be listed in `penguin.modules` and named as `children` of `Workflow`, with their own `requires` between them — the tree is checked as a whole.

## HTTP

HTTP, all under `/api/projects/:projectId/agents/:agentId/workflows` (Project members only): `GET /` lists the workflows with their `revision`, `uiRev`, `tabs` (each page's URL resolved) and current load `error`; `GET /:id/ui/*` serves a file of `ui/` (there is no default document — a tab names its page); any method on `/:id/api/*` reaches `handle` — JSON by default in both directions (`req.body` parsed, `{ status?, body? }` answered as JSON), and anything else when you say so: a non-JSON request body arrives as `req.bytes` (a `Uint8Array`; `req.headers` has its `content-type`, never the app's cookie), and a response that names a `content-type` in `headers` sends `body` as the string you wrote, or `bytes` for binary, or `stream` — an async iterable (an `async function*`) of strings or `Uint8Array`s, each chunk written to the client as you yield it, which is how server-sent events and a model's token-by-token answer get through without waiting for the end (relay an upstream stream by yielding its chunks; a `finally` in the generator runs when the client goes away — though a generator parked inside an `await` only gets there once that await settles, so give a relay its own timeout rather than trusting the disconnect) — with `location` + a 3xx status for a redirect. That is how a handler serves a page it renders, an upload, a download, or the pages of a program it runs on this machine: fetch `http://127.0.0.1:<port>/…` from the HANDLER and return what came back — never put `127.0.0.1` in a page, because the page runs in the user's browser, which may be on another machine than you are; `POST /:id/reload`; `GET /:id/history` lists recorded versions; `POST /:id/rollback { revision }` restores one (code only — `state.json` stays) and reloads. `DELETE /:id` removes the workflow together with its recorded versions. From a page directly under `ui/`, call your handler with a relative `fetch("../api/…")`; the Web App shows each page in its tab and reloads it when `uiRev` changes.

## Undoing, reverting, removing (撤销 / 还原 / 清掉界面)

When the user asks to undo the UI, revert it, clean it up or get the chat page back the way it was, they are asking you to TAKE SOMETHING AWAY — never to build something. Do not answer such a request by adding a feature (a reset button, an undo stack, a new route). Work out which of the four below they mean; if it is not obvious from what they said, ask in one line before touching anything. Everything about a workflow is files in your own Agent directory, so each of these is a file operation you make yourself — list `workflows/` first to see what exists. The server notices within a moment and the user's tabs follow without a refresh.

1. *"Get rid of it" / "back to before there was any custom UI" / 回到没定义 UI 的状态* — remove the workflow entirely: delete the folder `workflows/<id>/` **and** its recorded versions `workflows-history/<id>/`. That is everything there is; the tabs disappear and nothing else of the Agent is touched. It cannot be undone, so say so in one line first, and never delete a workflow you were not asked to remove. (The user can do the same from the tab's bar: *Remove*, two clicks.)
2. *"Undo your last change" / "it was better before"* — go back to an earlier version of the CODE: the recorded versions are full copies under `workflows-history/<id>/<revision>/` (`versions.json` lists them, newest first); copy that version's files over the folder and the server reloads it. The tab's bar offers the same as *History → Restore*.
3. *"Remove that tab" / "I only want the first page"* — delete its entry under `WebModule.sessionTabs` in `package.json` (and its page under `ui/` if nothing else uses it). With `"contributes": {}` the workflow keeps its server code and has no UI at all.
4. *"Bring back the data"* — you cannot: `state.json` is never part of a version (restoring code leaves the data as it is) and it has no history of its own. Say so plainly rather than inventing a recovery.

One constraint follows from 4, and it is a constraint on you, not a task to go and do: the workflow's data is only ever changed through `host.setState` from its handler. Never edit or delete `state.json` by hand — not to reset a board, not to fix a record — because what you overwrite is gone for good.

Your handler's responses are served from the app's own origin, so anything you echo back from a request is executed there: escape what you put into HTML, and treat a value that came in over `/api/*` as untrusted even though only Project members can reach it.

## Theme

A workflow page is a separate document, so it inherits nothing from the app's stylesheet by itself. The Web App stamps `light`/`dark` on the page's root, copies its resolved palette (the gray scale, the accent pair, the font stack, the root font size) onto it, and injects `/workflow-ui.css` first in the head — a base stylesheet that styles plain HTML (headings, lists, forms, tables, code) to match the app and exposes `--wf-bg`, `--wf-fg`, `--wf-muted`, `--wf-border`, `--wf-surface`, `--wf-accent`, `--wf-accent-fg`, plus the classes `wf-primary` (a button), `wf-card`, `wf-rows`, `wf-row`, `wf-muted`. Write plain markup, take every colour and font from those variables, and the page follows the user through a theme or accent change; hardcode them and it clashes in one theme or the other. The page's own rules always win, and linking `/workflow-ui.css` yourself makes it look right when opened outside the app too.

## Filling the app

A page can be shown as the whole app — no sidebar, no chat, no tab strip — at `/app/<project>/<agent>/<workflow>[/<tab key>]` (the workflow's first tab when no key is given): the tab's *Fill the app* button goes there, `penguin web --app <project>/<agent>/<workflow>[/<tab key>]` opens the browser straight onto it, and the page itself can ask with `parent.postMessage({ type: "penguin:fill-app" }, "*")`. The way back is the command palette — Ctrl+P or Ctrl+Shift+P (⌘ on macOS), both, so a page may take one of them for itself but never both — whose *Exit full page* lands on that Agent's chat.
