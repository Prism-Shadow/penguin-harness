# Every contributed surface is drawn in an iframe: the `builtin` renderers were removed

- **Date:** 2026-11-26
- **Type:** refactor
- **Scope:** `server`, `web`, `library/workbench`, `plugins`, `ui-gallery`
- **Breaking:** yes — a workbench tab or server page naming a `builtin` renderer no longer loads or draws, and file renderer rules and the `audio` renderer were removed

[中文版](2026-11-26-no-builtin-renderers.zh.md)

Every plugin app is one kind of workbench, a handler plus a page under `ui/` drawn in an iframe. The `builtin` renderers, which let a contribution name a component of the Web App instead, were removed, with the slots that existed only for them.

## What was removed

- **Workbench tabs.** `WorkbenchTabRenderer` (`WebModule.sessionTabs`) became `{ iframe: { src, pointerLock? } }` only. A manifest tab naming another renderer fails the workbench's load with an error naming the contribution, and the previous instance keeps serving. The Web App's native workbench page went with it; a tab an older machine lists without an iframe shows no page.
- **Server pages and Agent settings tabs.** `RendererRef` (`WebModule.pages`, `WebModule.agentTabs`) became `{ iframe: { src, namespace } }` only. A contribution naming `builtin` no longer fits its slot: the server drops it at boot and names it in the log, and the plugin runs without it. The Web App's `WebAppModule.pageRenderers` slot was removed.
- **File renderer rules.** `WebModule.fileRenderers`, the `fileRenderers` field of `GET /api/contributions` (with `WebFileRendererData` and `WebFileRendererContribution`), the chat's `ChatModule.fileRenderers` slot and the `audio` renderer, which played a linked audio file below a reply's paragraph, were removed. A link to a Workspace file stays a link that opens it in the Files panel, and the files card under a Task still lists the files a reply names.
- The `penguin-plugin` Skill (2026.11.26.2) and the `.harness/README.md` the host writes into a workbench say that a tab's renderer is always `iframe`.

## Compatibility

- **A plugin or workbench that names `builtin`.** Contribute an iframe page instead: a workbench tab `{ "iframe": { "src": "ui/index.html" } }`, a server page or Agent settings tab `{ "iframe": { "src": …, "namespace": … } }` whose `src` the module's own route serves. No plugin in the Prism-Shadow organization named one. The one in-repo user, `agent-evaluation`'s Self-Evolution Workbench, is replaced at the next start by the migration in [backward compatibility](2026-11-26-backward-compatibility.md); an edited copy of it fails to load until its plugin card's update is taken.
- **File renderer rules.** A `WebModule.fileRenderers` contribution names no slot and is dropped at boot, and `GET /api/contributions` no longer answers `fileRenderers`. Nothing replaces them.
