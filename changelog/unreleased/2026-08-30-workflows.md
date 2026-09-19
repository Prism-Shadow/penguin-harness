# Workflows: an Agent's own page and server code, hot-reloaded and versioned

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `skills`

[中文版](2026-08-30-workflows.zh.md)

An Agent can now keep *workflows* in its own directory: `workflows/<id>/` holds a plugin package — `package.json#penguin.modules` manifests, an `index.ts` whose default export pairs them with code, its pages under `ui/` — that the server boots as a module tree of its own. It is the same mechanism the server is built from and that plugins use, and everything is checked before any of the workflow's code runs: a workflow that does not type-check, that was written against an interface version this server no longer fits, or whose manifests do not hold together fails to load with the problem named, and the previous version keeps serving.

## Contract

The root module `Workflow` requires `WorkflowHost` (published by the server as module `Host`: the SDK's verbs scoped to the Project — `createSession({ agentId? })` for this Agent or another of the same Project, `run(sessionId, [userText("…")])` for a turn in a new or existing Session, queued as a follow-up when it is busy — plus `sessionStatus`, `getState` / `setState` over the workflow's `state.json`, `log`) and provides `WorkflowMain` — a JSON handler `handle({ method, path, query, body })` the server mounts at `/api/projects/:p/agents/:a/workflows/:id/api/*`. The workflow's `ui/` is served at `…/workflows/:id/ui/*`. Nothing is added to any Agent's system prompt: the `penguin-sdk` skill carries the layout and the contract, loaded when an Agent is asked for a workflow.

## TypeScript, checked by the server

A workflow is TypeScript — `index.ts`; a folder with `index.js` or `index.mjs` is refused. The server builds one compiler program from the entry under options it fixes itself (`strict`; a `tsconfig.json` in the folder is not consulted), with `@prismshadow/penguin-server/plugin` resolved from the workflow's own `node_modules`, and also assigns the default export to `WorkflowPackage`, so the shape is checked whether or not the author wrote `satisfies WorkflowPackage`. Any diagnostic fails the load, reported as file, line, column and reason; a clean program is emitted into `<workflow>/.build/<revision>/`, a dot-directory that is no part of the revision, the recorded versions or what the watcher reacts to, and that is what gets imported. The compiler is now a runtime dependency of the server, loaded when the first workflow needs it; an installation without it loads no workflow and says so.

## Interfaces, compared across versions

Looking a required interface up in the platform's own table compares a declaration with itself, which can never fail. Each side now brings its own: the workflow's is the `ifaces.json` of the package version installed in its `node_modules` — the server package ships its table as a file for this — and the platform's is its own generation's. Each table is rendered as a self-contained `.d.ts` and the TypeScript compiler decides, in both directions: the platform's interface must be assignable to the version the workflow requires, and the version the workflow provides must be assignable to what the platform asks for. A host method the workflow was written against that has since gone is a load error naming it; an addition on the platform's side breaks nothing. A package that is not installed, or whose version ships no table, is a problem and never a pass; an expression the renderer cannot write as TypeScript is refused by name rather than widened. Plugins get the same comparison at load, with the table each plugin package already carries as its side; on an installation whose program predates the compiler being a dependency, plugins load as before and the log says the comparison was not made.

## Tabs are contributions

A workflow's manifest contributes its tabs to `WebModule.sessionTabs` — the slot a plugin contributes to, written the same way, which the host publishes into the workflow's tree and scopes to the Agent: `key`, `title` / `titleZh`, and a `renderer` whose `iframe.src` is a file under `ui/`. Several entries are several tabs; none is a server-only workflow; a slot the host has not opened is refused by name. The list returns them as `tabs`, each page's URL resolved, and keeps the serving instance's tabs while a broken edit is reported. The slot's shape gains `title` / `titleZh` and its renderer drops the unused `namespace`. `ui/` no longer has a default document: a tab names its page.

## Reload and rollback

The server watches the Agent's `workflows/` folder and reloads a workflow when its files change (also `POST …/:id/reload`); the emitted code lives under the folder's content hash, so an edited module is a new import URL and never served from the module cache. Loads of one workflow run one at a time, since each now takes a compiler run. Every successful load is recorded under `workflows-history/<id>/<revision>/` (twenty kept, `GET …/:id/history`), and `POST …/:id/rollback { revision }` restores that version's files — `state.json` untouched — and reloads. `DELETE …/:id` removes the workflow together with its versions. Users of the Project hear `workflow_updated` and `workflow_removed` on their event stream, so a tab appears, refreshes or disappears without a reload.

## Web App

Each contributed tab sits beside *Chat* at the top of the chat page, titled in the user's language; the tab shows its page in an iframe (reloaded when the UI's revision changes, the chat staying mounted underneath), with the workflow's version and revision, its load error when the current files do not boot, a *Reload* button, a *History* fold with a *Restore* button per recorded version, and a two-click *Remove*.

## Filling the app

A page can be the whole app: `/app/:projectId/:agentId/:workflowId[/:tabKey]` shows one workflow page — the tab that key names, or the workflow's first — with no sidebar, chat or tab strip. The tab's *Fill the app* button navigates there, the page itself can ask with `parent.postMessage({ type: "penguin:fill-app" }, "*")`, and `penguin web --app <project>/<agent>/<workflow>[/<tab>]` opens the browser straight onto it (`Invalid --app` before anything starts when the spec is not three or four segments). The route has no chrome to leave by on purpose; the command palette is the way out — it now answers **Ctrl+Shift+P as well as Ctrl+P** (⌘ on macOS), so a page that takes one chord for itself cannot trap the user — and on that route carries *Exit full page (back to chat)*, which remembers the Project and Agent and lands on their chat.

## Theme

A workflow page is its own document, so the app's stylesheet reaches none of it. The frame now stamps `light` / `dark` on the page's root, copies the app's *resolved* tokens onto it — the gray scale, the accent pair, the font stack, the root font size — and injects `/workflow-ui.css` first in its head: a base stylesheet that styles plain HTML (headings, lists, forms, tables, code) to match the app and exposes `--wf-bg`, `--wf-fg`, `--wf-muted`, `--wf-border`, `--wf-surface`, `--wf-accent`, `--wf-accent-fg` plus the classes `wf-primary`, `wf-card`, `wf-rows`, `wf-row`, `wf-muted`. The page's own rules still win, and the palette keeps one definition: the app copies what it already resolved instead of the stylesheet restating it. Switching theme or accent re-themes an open page without reloading it. The skill asks for markup written against those variables, so a workflow an Agent writes matches the user's theme in both directions.

The `penguin-sdk` skill documents the layout and the contract.
