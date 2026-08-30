# Workflows: an Agent's own page and server code, hot-reloaded and versioned

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`, `skills`

[中文版](2026-08-30-workflows.zh.md)

An Agent can now keep *workflows* in its own directory: `workflows/<id>/` holds an extension package — `package.json#penguin.modules` manifests, an `index.mjs` default export pairing them with code, an optional `ui/` — that the server boots as a module tree of its own, checked against the server's interface table before any code runs. It is the same mechanism the server is built from and that user extensions use: a workflow that requires what the host does not publish, or provides a handler of the wrong shape, fails to load with a named problem, and the previous version keeps serving.

## Contract

The root module `Workflow` requires `WorkflowHost` (published by the server as module `Host`: `runAgent({ text, sessionId? })`, `sessionStatus`, `getState` / `setState` over the workflow's `state.json`, `log`) and provides `WorkflowMain` — a JSON handler `handle({ method, path, query, body })` the server mounts at `/api/projects/:p/agents/:a/workflows/:id/api/*`. The workflow's `ui/` is served at `…/workflows/:id/ui/*`. Every Agent's system prompt gains a *Workflows* section describing the layout, so an Agent can write, change and fix its own workflow.

## Reload and rollback

The server watches the Agent's `workflows/` folder and re-imports a workflow when its files change (also `POST …/:id/reload`); the import is keyed by the folder's content hash, so an edited module is never served from the module cache. Every successful load is recorded under `workflows-history/<id>/<revision>/` (twenty kept, `GET …/:id/history`), and `POST …/:id/rollback { revision }` restores that version's files — `state.json` untouched — and reloads. Users of the Project hear `workflow_updated` on their event stream.

## Web App

A workflow with a UI is a tab beside *Chat* at the top of the chat page; the tab shows the page in an iframe (reloaded when the UI's revision changes, the chat staying mounted underneath), with the workflow's version and revision, its load error when the current files do not boot, a *Reload* button and a *History* fold with a *Restore* button per recorded version.

## Theme

A workflow page is its own document, so the app's stylesheet reaches none of it. The frame now stamps `light` / `dark` on the page's root, copies the app's *resolved* tokens onto it — the gray scale, the accent pair, the font stack, the root font size — and injects `/workflow-ui.css` first in its head: a base stylesheet that styles plain HTML (headings, lists, forms, tables, code) to match the app and exposes `--wf-bg`, `--wf-fg`, `--wf-muted`, `--wf-border`, `--wf-surface`, `--wf-accent`, `--wf-accent-fg` plus the classes `wf-primary`, `wf-card`, `wf-rows`, `wf-row`, `wf-muted`. The page's own rules still win, and the palette keeps one definition: the app copies what it already resolved instead of the stylesheet restating it. Switching theme or accent re-themes an open page without reloading it. The Agent's prompt section asks for markup written against those variables, so a workflow an Agent writes matches the user's theme in both directions.

The `penguin-sdk` skill documents the layout and the contract.
