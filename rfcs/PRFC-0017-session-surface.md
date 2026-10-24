# PRFC-0017 Session Surface

[中文版](PRFC-0017-session-surface.zh.md)

> **Source**: `rfcs/PRFC-0017-session-surface.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — a draft, see design PR [#123](https://github.com/Prism-Shadow/penguin-harness-design/pull/123) (draft).
> **Rev**: v1.0.0 (migrated into the main repository, taking the draft's current version); the conventions for this surface are in [README.md](README.md), and changes from version to version are recorded in `## Changes` at the end.

- Feature Name: `session_surface`
- Start Date: 2026-09-05
- PRFC PR: [Prism-Shadow/penguin-harness-design#123](https://github.com/Prism-Shadow/penguin-harness-design/pull/123)
- Implementation PR: [Prism-Shadow/penguin-harness#626](https://github.com/Prism-Shadow/penguin-harness/pull/626)

## Summary
[summary]: #summary

A Session has a **surface**: what the session page renders for it, and where its "idle / running" state comes from. The built-in surface is the OmniMessage conversation. A plugin adds another kind of surface as **one contribution** — in the manifest, a kind, a label, and a renderer name; in code, open, query, and close. The frontend reads the surface list via `GET /api/contributions`, draws it with a renderer it recognizes, and "New conversation" gains one extra entry per surface. The first surface plugin is `claude-code`: it opens Claude Code's TUI in the Session's Workspace. Along with it comes the plugin integration test framework `@prismshadow/penguin-plugin-test`: like VS Code's `@vscode/test-electron`, it brings up the real server together with the plugin under test, and tests run against it.

## Motivation
[motivation]: #motivation

The need itself is concrete: customize the session page to open Claude Code's TUI. It should not be a kernel feature — Claude Code is someone else's product, and whether it is installed or wanted varies per deployment — so it has to be a plugin. This forces the session page to give up three things it has always owned by default; on re-examination, their current state is:

- **State**. The `status` on a Session row (`idle` / `running` / `compacting`) has exactly one source: the entry inside `SessionManager`. It flips as Tasks start and finish, and is pushed to the browser via `task_state` on the Session channel and `session_state` on the user channel; the sidebar's running dot and "unread" dot are both derived from it. A Session not driven by `SessionManager` is forever `idle` on this chain.
- **Frontend UI**. The frontend's slots (pages, Agent settings tabs, Session tabs) are already declared on the server (`WebShell`), `GET /api/contributions` already returns contributions as data, and the frontend even has a registry for looking up renderers by name and a `mergePages` that merges remote pages into the local manifest — but the frontend **never requests** this endpoint: the registry only serves local `module.json`, and `mergePages` has no caller. In other words, the door is half open: the server can speak, but the frontend does not listen.
- **New conversation**. The "New conversation" in the sidebar and the collapsed rail is hard-wired to the draft page (`/chat/new`), and the draft page can only create an OmniMessage conversation: pick a model, pick a Workspace, send the first message. There is nowhere for a plugin to insert an entry here.

These three together are the "session surface". They are made into one concept and one contribution, rather than three independent patches, because they always appear together: a new conversation form needs its own state source, its own rendering, and its own creation entry.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

**For users.** After the `claude-code` plugin is installed (the operator lists it in the deployment manifest on the plugins page, effective after restart — as with other plugins, being bundled in the build does not mean being installed), the sidebar's "New conversation" gains a "Claude Code" row beneath it. Click it to enter the draft page: pick an Agent, pick a Workspace, optionally write a sentence as the first prompt, then "Open". The session page is no longer a message stream and an input box, but a terminal running Claude Code's TUI, with this Workspace as the working directory. While Claude is thinking, the sidebar dot spins as in a regular conversation; when it stops and waits for you, the dot turns into the "has new content" look. This conversation sits in the sidebar alongside the others and can be renamed, archived, and deleted the same way; close the browser and come back later — the terminal is still there, ready to continue.

**For plugin authors.** A surface is one contribution in the module manifest plus its code half:

```json
{
  "penguin": {
    "modules": [
      {
        "name": "ClaudeCode",
        "requires": {
          "terminals": { "iface": "@prismshadow/penguin-server#Terminals", "from": "TerminalModule" }
        },
        "contributes": {
          "SessionSurfacesModule.surfaces": [
            {
              "id": "claude-code.surface",
              "kind": "claude-code",
              "label": "Claude Code",
              "renderer": { "builtin": "TerminalSurface" }
            }
          ]
        }
      }
    ]
  }
}
```

```ts
const plugin: Plugin = {
  modules: {
    ClaudeCode: {
      create: ({ use }) => ({
        api: {},
        bind: { "claude-code.surface": claudeCodeSurface(use.terminals as Terminals) },
      }),
    },
  },
};
```

`kind` is the key of this surface (written into the Session row), `label` is the text of that row under "New conversation", and `renderer` is what the frontend uses to draw it — `builtin` names an entry in the frontend registry, while `iframe` means the plugin provides the page itself. The code half implements `SessionSurface`: `open` is called once when the Session opens (idempotent: if already open, it stays as is) and returns the view data the renderer needs; `status` answers whether this Session is idle or running right now; `close` winds things down when the Session is deleted or the user closes it explicitly. The surface itself decides what "running" means — for a program running in a pty, it is "has had output within a recent short window".

**For the frontend.** The session page no longer assumes every Session is a conversation. It looks at `SessionInfo.surface`: when empty, it is today's conversation page; otherwise it looks up this kind in the surface list and uses its renderer to draw the whole content area (the toolbar and docked panels stay as they are). The surface list comes from `GET /api/contributions`, fetched once after login; the `pages` in the same response finally get merged into the routes too — a page pushed up by a platform or contributed by a plugin can be opened as long as the frontend has its renderer.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Data

- The `sessions` table gains `surface TEXT`, where `NULL` means the built-in conversation (all existing rows are `NULL`, semantics unchanged); `SessionRow.surface` corresponds to `SessionInfo.surface` and appears in the DTO only when non-null. This column travels on **two** tracks at once, and neither can be omitted: the `ensureColumn` declarative list in `openDatabase` (at process startup), and a `swapSafe` numbered migration (`sessions-surface`). The migration is the one that matters — the declarative list only runs at **process** startup, while hot pushes never restart the runtime (see `migrate(caps.db, { swapPath: true })` in hmr/platform.ts): without it, a pushed platform would write `surface` into a table that lacks the column, so every session write would fail (creation, fork, sub-agent registration, and the Trace ingestion that session-list backfill goes through). The migration's `down` is deliberately a no-op rather than `DROP`: dropping the column would throw away which surface each surface Session is. An older platform pushed back onto a data root that already has the column simply does not see it.
- **A surface Session carries no model reference and no core Session is created for it**: `provider` / `model_id` are stored as empty strings, `SessionManager` never adopts it and thus never drives it — Tasks, compaction, approvals, and steer all return 409 for it (the paths other than `session_not_found` already presuppose an entry). In every other respect it is a Session: listing, renaming, archiving, deleting, and grouping by Workspace all work as before; deletion additionally calls the surface's `close`.
- `POST …/sessions` accepts `surface` (it must be one loaded in the current process, otherwise 400 `unknown_surface`); when `surface` is present, `modelId` / `provider` are ignored, and Workspace validation is unchanged.

### Server

- The vocabulary lives on the SDK's type surface (`@prismshadow/penguin-core/plugin`): `SessionSurfaceContribution` (`kind` / `label` / `labelZh?` / `renderer`), `SessionSurface` (`open` / `status` / `close`), `SurfaceSessionRef` (`sessionId` / `projectId` / `agentId` / `workspace` / `ownerUserId`), `SurfaceOpenOptions` (`prompt?` / `cols?` / `rows?`), and `SurfaceView` (`alive` plus the `view` document the renderer reads).
- The slot `SessionSurfacesModule.surfaces: Slot<SessionSurfaceContribution, SessionSurface>` is owned by the new node `SessionSurfacesModule` in the session runtime group; it provides the mechanism `SessionSurfaces` (`list` / `has` / `statusOf` / `open` / `view` / `close`). The same `kind` appearing twice is a startup error (naming both plugins), because `kind` is a key written into data and cannot follow the "last one wins" rule the way syntax highlighting does.
- State: `SessionService.toInfo` asks `SessionSurfaces.statusOf` for rows whose `surface` is non-null; the surface reports flips through the `report(state)` callback it received at `open` time, and `SessionSurfacesModule` sends the flips as `session_state` on the user channel (same shape as before), calling `markDriven` on entering `running` and `touchLastActive` on returning to `idle` — the sidebar's "running" and "unread" dots therefore need not know surfaces exist. A surface Session has no `task_state` on the Session channel, and the frontend opens no SSE stream for it.
- Routes (session runtime group, `/api/sessions/:sessionId/surface`, login plus Project access required): `GET` returns `{ kind, status, opened, alive, view }` (`opened: false` when never opened); `POST { prompt? }` opens or reuses, returning the same shape; `DELETE` closes. Non-surface Sessions get 404 `not_a_surface_session` across the board.
- `GET /api/contributions` gains a `sessionSurfaces` array (manifest data plus `id` / `from`), read by `WebModule` from `SessionSurfaces.list()` — the same source, no additional slot.
- Terminals: `CreateTerminalRequest` gains `command?: string[]` and `env?` — when `command` is present, the pty runs it directly (argv passed through as-is, no `-l` appended), mutually exclusive with `shell`. It exists only on the `Terminals` mechanism and is not exposed over HTTP: what a surface plugin needs is "run a program in a Workspace", not an arbitrary exec handed to the browser.
- Hot updates: plugin modules are rebuilt per App, while ptys survive via the resource registry; the surface records `sessionId → terminalId` in `park()` and reclaims it by id from `Terminals.get` on rebuild, treating an unclaimable one as never opened.

### Frontend

- `ContributionsProvider`, inside `RequireAuth`, fetches `GET /api/contributions` once after login; `useContributions()` exposes `sessionSurfaces` and the merged page table. Routes are now generated from the merged table (the first caller of `mergePages`); the navigation bar still lists only local pages — contributed pages' labels and icons have no source yet, so this step waits until page contributions carry their own labels.
- The renderer registry splits in two: one for pages (existing) and one for surfaces. The surface registry's first member is `TerminalSurface`: on mount it `POST`s to `…/surface` and hands the returned `view.terminalId` to `TerminalView` (the same component as the docked terminal, same WebSocket protocol); after exit it shows the exit code and a "Reopen" button, and one more `POST` regenerates it. The `iframe` renderer substitutes the actual id for `:sessionId` in `src`.
- Session page: when `selected.surface` is non-null, the content area renders the surface instead of the message stream and input box; `useSessionStream` receives a `null` id (no stream is opened); the toolbar's model-related controls do not appear for surface Sessions.
- New conversation: the sidebar and the collapsed rail add one row per surface beneath "New conversation" (`label`, falling back to `labelZh` in the Chinese UI); clicking enters the draft page with route state `{ surface }`. In surface mode the draft page swaps the input card for a one-line prompt and an "Open" button, with Agent and Workspace selection unchanged; "Open" = create the Session (with `surface`) → `POST …/surface { prompt }` → navigate. The prompt text is handed to the surface as the first prompt (`claude-code` passes it as `claude`'s initial argument); if empty, it just opens.

### The `claude-code` plugin

- Package `@prismshadow/penguin-plugin-claude-code` (`plugins/claude-code`), one module `ClaudeCode`, requires `Terminals`, contributes one surface. `open` creates a pty in the Workspace with `command: [claudeBin, ...(prompt ? [prompt] : [])]`; `claudeBin` comes from the environment variable `PENGUIN_CLAUDE_BIN`, defaulting to `claude` (this is also the seam where integration tests substitute a fake program).
- The running state is a heuristic: output from the pty means `running`, silence past a fixed window returns to `idle`, and exit means `idle`. Claude Code repaints continuously while working (spinner) and stops repainting while waiting for input, so this rule holds in practice; it is **this plugin's** judgment, not the platform's — when a second pty surface appears, we can consider lifting "pty activity means running" to the platform layer.
- Bundled in the build (packed by `scripts/build-plugins.mjs` like the other `plugins/*`) and listed in the built-in index (`builtin-index.json` + README), but **not in `plugins.json`** — whether to install it is the operator's decision, which is exactly what "not enabled by default" means precisely under the existing mechanism.

### Plugin integration test framework

- Package `@prismshadow/penguin-plugin-test` (`packages/plugin-test`). `startHarness({ plugins, ... })` writes a `plugins.json` in a temporary data root (each plugin listed by the absolute path of its entry file — the loader's direct `import` path, with the manifest found by walking up from the entry to `package.json#penguin`), starts the **real server** as a child process (the build output of `@prismshadow/penguin-server`, `PENGUIN_HOME` pointing at the temporary root, random port, fixed seeded admin password, plugin index disabled), and once `/api/install` responds returns a `Harness`: `baseUrl`, `root`, `admin`, a Cookie-carrying `api` (`login` / `get` / `post` / `put` / `delete`), and `stop()`.
- Going through the real loader rather than in-process assembly is deliberate: what a plugin author wants to verify is precisely "my package can be resolved, loaded, and brought into the tree by this server", and in-process assembly skips that half.
- Two common helpers ship with it: `installedPlugins()` (reads `/api/plugins/installed`, asserts `active`) and terminal helpers (`capture` / `keys`, against `/api/terminals/:id`). The `claude-code` integration test uses it: with a fake `claude` (prints first, "thinks" for a second, then waits for input) it walks the whole chain of "create surface Session → open → state `running` → back to `idle` → close".
- It is a dev dependency and ships in no release artifact.

### Compatibility

`sessions.surface` is an appended column, requiring nothing from users; existing rows read as built-in conversations. It reaches existing databases via a `swapSafe` numbered migration, so a **hot push** (no process restart) can also grow the column — that is why it must be a migration and not just an `ensureColumn`. `GET /api/contributions` only gains fields. Pushing the new platform onto an old runtime: `SessionSurfacesModule` is a node inside the platform, independent of the runtime.

## Drawbacks
[drawbacks]: #drawbacks

- A surface Session is a "Session without a model", and storing empty strings in `provider` / `model_id` is a compromise: both columns are `NOT NULL` and are grouped by `(provider, model_id)` in the cost center — surface Sessions have no usage records, so they never appear there, but any new reader has to know what the empty strings mean.
- The running state is a heuristic for pty surfaces: a poorly chosen window constant makes it flicker or lag; it has no intermediate state like "compacting".
- The frontend makes one extra request after login, and the route table goes from static to depending on one fetch (before the fetch, only local pages exist, same as today).

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Terminal only, no Session**: make "Claude Code" just another terminal tab in the dock. Cheapest to build, but what users want is precisely for it to appear in the conversation list, with its own status dot, archivable and deletable — these are all properties of a Session, not of a terminal.
- **iframe only**: the plugin provides the whole-page UI itself and the frontend adds no renderer. Terminal rendering needs xterm, the WebSocket protocol, and a touch-screen key strip, all of which the frontend already has; making every pty surface carry its own copy is wasteful, and keyboard focus and shortcuts inside an iframe would fight with the outer layer. `iframe` is still kept, for surfaces that are not terminals.
- **Put the state into `SessionManager`**: give it an "external state source". `SessionManager` is already large, and its entries are tightly bound to core Sessions; a surface Session has no core Session at all, and wedging it in would only add a pile of branches where `entry.session` is null. Routing at `toInfo` instead means `SessionManager` need not know about surfaces.
- **Put pty activity detection into the platform**: with only one pty surface today, the rule is most honestly kept on the surface itself; the platform-level abstraction can wait for a second use case.
- **Do nothing**: the session page keeps recognizing only conversations, Claude Code can only be started by manually typing `claude` in a docked terminal, and plugins can do nothing about it — which is exactly the problem we were asked to solve.

## Prior art
[prior-art]: #prior-art

- VS Code's Custom Editors: a resource can be opened by an editor provided by an extension; the editor is declared as data in `package.json#contributes.customEditors` with the code living in the extension, and the host decides when to create and destroy it. Surfaces are isomorphic to this: the Session is the resource, the surface is the editor.
- `@vscode/test-electron`: downloads and launches the real VS Code, installs the extension under development, and runs tests inside it. `penguin-plugin-test` is the same idea in a server-side shape.
- This repository's language and sandbox plugins: the same door (manifest data + `bind` code); this RFC merely opens one more slot for the session page.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- How long the silence window for pty surfaces should be; whether surfaces need to report states other than `idle` / `running`.
- Whether surface Sessions can be created on other Machines (currently only on this server: the pty has to live on whatever machine the Workspace is on).
- Where contributed pages' navigation labels and icons come from (this RFC only merges them into the routes).

## Future possibilities
[future-possibilities]: #future-possibilities

- The same surface contract can host other TUI agents (Codex CLI, Gemini CLI): each would be a few-dozen-line plugin.
- Lifting "pty activity means running" into a platform-level pty surface helper, where plugins only supply the argv.
- Surfaces opened on a Machine, going through the terminal relay.
- Adding a browser layer to `penguin-plugin-test` (Playwright against the harness's `baseUrl`), putting surface rendering inside the plugin's own tests too.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the current version of the draft carried by design PR [#123](https://github.com/Prism-Shadow/penguin-harness-design/pull/123), identical to the source file.
