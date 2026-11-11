# PRFC-0020 Agent Workbench: App Naming, Plugin Distribution, and Product Support

[中文版](PRFC-0020-agent-workbench.zh.md)

> **Source**: `rfcs/PRFC-0020-agent-workbench.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — landed (default branch `main`, commit [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)).
> **Rev**: v1.3.0 (the App Center as a personal home screen, from design PR [#425](https://github.com/Prism-Shadow/penguin-harness-design/pull/425)); the conventions for this surface are in [README.md](README.md), and changes from version to version are recorded in `## Changes` at the end.

- Feature Name: `agent_workbench`
- Start Date: 2026-10-14
- PRFC PR: [Prism-Shadow/penguin-harness-design#331](https://github.com/Prism-Shadow/penguin-harness-design/pull/331)
- Implementation PR: [Prism-Shadow/penguin-harness#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)
- Status: implementation PR #1133 was merged into main on 2026-10-14.
- Status note (2026-11-03): app folders moved into the Agent State (`agent_state/workbenches/<id>/`), their versions are commits of the Agent State's git repository, and the settings page imports and exports zips ([#1442](https://github.com/Prism-Shadow/penguin-harness/pull/1442)–[#1445](https://github.com/Prism-Shadow/penguin-harness/pull/1445)). The body below keeps its earlier shape for those parts; the design repository's copy carries the full text.
- Status note (2026-11-04): an app can declare `penguin.appCenter` in its manifest to have a shortcut in the Project's App Center, and the settings page's switch rewrites its `show`; see "App Center" below. The "Names and boundaries" table gains an "App Center" row and the route table gains `PATCH /:id/app-center`; the rest of the body keeps its earlier shape.
- Status note (2026-11-09): the App Center becomes a personal home screen. A shortcut carries its build state (`build`), and a load that starts sends `workbench_building`; the icon is served as an image by `GET /:id/app-center/icon`, its format told by its bytes; the viewer's order and folders are kept in their account (`ui_prefs.appCenterLayouts`, written through `PUT /api/projects/:projectId/app-center/layout`); see "App Center" below. The route table gains the icon route.

## Summary
[summary]: #summary

The former Workflow capability is renamed **Agent Workbench**: an app owned by an Agent, composed of server-side modules, pages contributed by its manifest, and persistent state. Apps can be written by an Agent in its own directory, or distributed by a Plugin. The default Project provides PenguinHarness Support through the `penguin-support` plugin, where users ask and follow up on questions in a question list. The directory, interfaces, routes, events, and styles adopt the Workbench naming, and existing apps keep their state and history through a one-time migration.

This document follows the merged [PRFC-0014](PRFC-0014-workflow.md) and records the changes of implementation #1133. The module tree, source inspection, and the base mechanism of keeping the previous instance after a failure carry over from the original design.

## Motivation
[motivation]: #motivation

These pages host apps in continuous use: the user selects an Agent and opens the page directly, driving tasks through forms, lists, and buttons. Workbench unifies the naming used in the UI and in the development interfaces. Allowing only source written in place by Agents would make reusable apps of the product-support kind regenerate every time; installed through the existing plugin chain, an app and its guiding Skill can be distributed, checked for updates, and removed together.

After an app starts a round of an Agent task, it needs to read the result out. `sessionStatus` alone cannot tell a successful answer from a run that ended without one, nor can it let the page restore a previous question. The app therefore saves the Session id and reads the result of the most recent main-task round.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

- The home-page AI app examples require creating a dedicated Agent and Workbench. The user selects this Agent, and opening a new-conversation draft is enough to switch to the app tab, without sending a message first. Switching examples replaces the preselected Skills.
- App source lives in `<agentDir>/workbenches/<id>/`, a sibling of `agent_state/`. `package.json` declares the modules and tabs, `index.ts` implements the backend, and `ui/` holds the HTML, CSS, and JavaScript; when there are only static files and no tab contribution, no page is shown.
- The backend starts tasks with `host.createSession` and `host.run`, saves the Session id with `host.setState`, and then polls via `host.sessionResult`. Uploaded files and generated reports are placed outside the source-watch scope; downloads use server-side attachment links.
- Saving sources reloads the app; on failure the old instance keeps serving, and `.build/status.json` gives the error and hints. A failed history load offers a retry; restoring a code revision does not restore the old run data.
- The Workbench tab in Agent settings can open, reload, restore revisions of, and remove apps; the Agent cards and the searchable Agent-picker dialog show the workbench count. A new conversation shows only the currently selected Agent's apps; after switching Agents, the previous Agent's tabs are not carried over.
- A tab can fill the app; the floating exit button and the command palette return to the original conversation path and reselect the previous workbench tab. When a full-page address is opened directly, exiting selects the same workbench in a new conversation of that Agent. The existing `/app/<project>/<agent>/<id>[/<tab>]` and `penguin web --app` address shapes stay stable.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Names and boundaries

| Object | Workbench contract |
| --- | --- |
| Source / history | `<agentDir>/workbenches/<id>/`, `<agentDir>/workbenches-history/<id>/` |
| Root module / types | `Workbench`, `WorkbenchPackage`, `WorkbenchHost`, `WorkbenchMain` |
| Platform machinery | `Workbenches`, `WorkbenchService`, `WorkbenchRoutes` |
| Tab contribution | `WebModule.sessionTabs`; provided by the app manifest with `id`, `key`, `title`, optional `titleZh`, and a renderer |
| App Center | Manifest `penguin.appCenter`; `WorkbenchInfo.appCenter` and `icon`, `AppCenterShortcut`, `AppCenterLayout`; the Project-level `GET /api/projects/:projectId/app-center` and `PUT …/app-center/layout` (see "App Center") |
| Styles | `/workbench-ui.css`, `--wb-*` variables and `wb-*` classes; shared styles honor HTML's `[hidden]` |
| Update / removal events | `workbench_updated { projectId, agentId, workbench }`, `workbench_removed { projectId, agentId, workbenchId }` |

The slot name keeps `WebModule.sessionTabs` from #1133; the WebApp module renaming of [design PR #317](https://github.com/Prism-Shadow/penguin-harness-design/pull/317) is separate in-flight work and is not pre-adopted here as a new slot name.

The HTTP prefix is `/api/projects/:projectId/agents/:agentId/workbenches`, authorized under the existing Project access rules:

| Method and suffix | Behavior |
| --- | --- |
| `GET /` | List apps and load changed sources |
| `POST /:id/reload` | Reload |
| `GET /:id/history` | Read the revision list |
| `POST /:id/rollback` | Restore sources per `{ revision }` and reload |
| `PATCH /:id/app-center` | Rewrite the manifest's `penguin.appCenter.show` per `{ show }` and reload |
| `GET /:id/app-center/icon` | The icon the manifest's `appCenter.icon` names, typed by its bytes, under a sandboxing CSP |
| `DELETE /:id` | Remove the app |
| `GET /:id/ui/*` | Serve the UI's static files |
| `ALL /:id/api/*` | Call backend handlers |

`WorkbenchMain.handle` handles JSON and non-JSON request bytes and optional binary or streaming responses. `WorkbenchHost` provides the Agent list within the Project, Session creation and running, status, title, the latest result, plus the app's own state read/write and logs. `run` accepts a non-empty list of `{ text }` entries, delivered to the Agent as user text with `sender = server` and queued when busy; it returns once the task has started or been queued, without waiting for completion; `sessionResult` returns `{ status: running | completed | failed, text, error }`, reading only the final answer or failure of the most recent main-task round — tools, thinking, sub-session output, or earlier answers are not taken as the current result. Empty text while a run is in progress does not equal failure; when idle and the round has no final answer, it returns `failed` and does not fall back to an old answer. The host can only access Sessions of the same Project; when creating one, an Agent within that Project may be chosen, and the approval mode is fixed to `allow-all`, the same as unattended tasks.

Sessions created by the host write `session_meta.source = workbench`, and their index rows write `client = workbench`; rows that have not yet run and carry no Trace also get their source identified this way. A source with an existing Trace takes precedence over the index row; old `user` sessions must not be relabeled `workbench`. Such sessions are listed under "Archived conversations" by default; the archive filter supports `source=workbench`, and the app can still read and run them; once the user unarchives one, it stays in the sidebar with a workbench source badge and is no longer auto-archived in later runs. The source does not change with the archive action, and an existing Trace is not rewritten because the app was renamed.

`AgentSummary.workbenchCount` counts apps whose name is valid and whose directory contains a `package.json` file; it does not parse whether the manifest is valid, so it includes apps with manifest errors or failed builds; when listing Agents, no app is compiled and no full asset traversal happens just to obtain the count.

Concurrent reads of the same app revision share a single load. App discovery starts at the first listing: while the directory does not yet exist it is rechecked periodically, and once it appears the system switches to source watching; the first creation of an app does not depend on a file event happening to arrive. The development entry `tsx watch` excludes the configured data directory and its normalized absolute path; app sources are handled by the Workbench's own watcher, and writes to `.build/` must not restart the whole server.

### Apps carried by plugins

A plugin package carries sources under `workbenches/<name>/`, passing through plugin-library reading, zip import validation, Agent installation, update detection, file browsing, and uninstallation; a package containing only Workbenches is a plugin-library plugin too. The in-library form is `LibraryWorkbench { name, version, files }`; the name matches `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, the manifest must declare a non-empty `penguin.modules` and a `YYYY.MM.DD.N` version, and it must not carry `state.json`, hidden files, or `node_modules`; invalid apps are warned about and skipped. The app's own `package.json#penguin.version` uses the date version; installed copies record plugin ownership and the file manifest via `.plugin.json`; after a rollback, whether the copy lags behind is judged by the current source version. The Plugin's npm version and the app's date version respectively take care of package release and installed-copy updates.

Before installation, name conflicts across the entire request are checked: an app of the same name that belongs to another plugin or was hand-written by the user is rejected with `409 workbench_name_taken` (a recovery directory holding only `state.json` allows the installation to resume), rather than erroring only after some Skills or config have already been written. Writes replace files atomically one file at a time; a source path that escapes its bounds or writes out the app directory through a symlinked parent is refused, and a transactional rollback of the whole batch is not promised. Before the first source write, an ownership record with an empty version is noted first, so that after a failure the same plugin can retry and still show as pending update; the final version and the file manifest are written only after everything completes. An update by the same plugin replaces its sources and removes source files that the old manifest listed but are no longer present, keeping `state.json` and the version history; it clears the `.harness/` it generated, which the next load regenerates per the current host. Hand-written apps keep their own interface basis. When uninstalling from an Agent, the removal interface is invoked only for apps whose installation record still belongs to that plugin; removal deletes the whole app directory (including `state.json`) and its history. The guarantee of keeping state and history applies to updates and code rollbacks, not to app removal.

The app metadata in `GET /api/plugins` contains only the name and version; `GET /api/plugins/:plugin/files` serves the manifest and sources. The Agent-level `GET …/agents/:agentId/plugins` and the installing `POST` both return `{ skills, hooks, mcpServers, workbenches? }`, with an app item being `{ name, plugin, version }`; a failed MCP config read does not block returning the installed contents from the files. The installed criterion covers all of the plugin's parts plus app ownership; the update criterion compares each part's date version, and the summary version takes the newest among them. The plugin library page groups by content, and file preview, update confirmation, and uninstallation all include Workbench; deleting a plugin package on the server does not delete the installed copies on each Agent.

### App Center

An app declares in the `penguin` block of its own `package.json` whether it appears in the App Center, beside `version` and `modules` (camelCase, like the tab contribution):

```json
"penguin": {
  "version": "2026.11.04.1",
  "appCenter": { "show": true, "title": "Support", "titleZh": "客服工作台", "icon": "ui/icon.svg", "tab": "support" },
  "modules": [ … ]
}
```

| Field | Rule |
| --- | --- |
| `show` | Required when the object is present; `false`, or no object, means not shown |
| `title` / `titleZh` | Optional, at most 60 characters; default to the first tab's `title` / `titleZh`, then to the npm `name` |
| `icon` | Optional relative path under `ui/` (no `..`; at most 256 KB) to an SVG, PNG, JPEG, WebP, GIF or AVIF file, recognised by its bytes, which must agree with its extension (`.jpg` and `.jpeg` are both JPEG); served by `GET /:id/app-center/icon`; defaults to a letter tile coloured by id |
| `tab` | Optional key of the tab to open; defaults to the first tab |

An object that does not hold up (a wrong type, an `icon` out of bounds, over the limit or whose bytes disagree with its extension, a `tab` that is not one of the app's tabs) is a load hint (`hints`), not an error: the app loads as usual and only has no App Center shortcut. The parsed result is `WorkbenchInfo.appCenter?: WorkbenchAppCenter { show, title?, titleZh?, icon?, tab? }`, absent when nothing is declared; when it names an icon that reads clean, `WorkbenchInfo.icon?: IconRef` names it the way the shortcut does (below), shown or not, and the settings row leads with it. A workbench that a PRFC-0025 switch turns off reads both from its manifest too; it has no shortcut, and the switch's rewrite of its manifest does not load it.

The Agent writes the key when it writes an app (the `penguin-plugin` Skill's layout conventions, and after the `web-design` Skill has asked "Workbench or a standalone app"). The switch on the app's row in the settings page rewrites it through `PATCH /:id/app-center { show }`: the server changes only `penguin.appCenter.show` (creating `{ show }` when there is no object), rewrites `package.json` with 2-space indentation and a final newline, and leaves every other key as it was; the watcher reloads, the load commits a version as usual, and the answer is `{ workbench }`; the permission is that of reload and removal. A `package.json` that is not a JSON object is answered 409 `workbench_manifest_invalid` and left untouched. When the switch and the Agent rewrite the file at the same time the last writer wins, and the watcher loads whatever landed. A plugin update that replaces the sources overwrites the key along with them.

The Project-level list `GET /api/projects/:projectId/app-center` (Project members) answers `{ shortcuts: AppCenterShortcut[]; layout: AppCenterLayout | null }`:

```ts
interface AppCenterShortcut {
  agentId: string;
  agentName: string;
  workbenchId: string;
  title: string;
  titleZh?: string;
  icon?: IconRef;   // { url: /api/projects/:p/agents/:a/workbenches/:id/app-center/icon?rev=<content digest>, tint }
  path: string;     // /app/:p/:a/:id[/:tab]
  tab?: string;     // the declared tab
  build: "ready" | "building" | "failed";
  error?: string;   // with build "failed": the error .build/status.json records
}
```

It reads only each app's manifest and `.build/status.json`, without compiling or loading any source (unlike `GET /`), so opening the App Center starts no build; it starts the file watcher of each Agent it lists (once), so an edit made while the App Center is open loads as usual. The server's order is the Agent list's, then by title within one Agent. Only the Agents of this server are listed: the full-page address of an Agent on a machine cannot name the machine yet, which is left for later.

`build` is where the app's build stands on this server: `building` while a load of it is under way in this process or queued behind one (the watcher's settle window does not count: the event behind it may change nothing, and then no event follows); otherwise `failed` when `.build/status.json` records a failure, with its error; else `ready`, which includes an app this process has not loaded yet (opening it loads it). Whenever a new load starts (a caller sharing a load of the same revision in flight does not count), the server sends the Project's users `{ type: "workbench_building", projectId, agentId, workbenchId }`, and `workbench_updated` when it ends, as before. The page reads the list again on those two, on `workbench_removed` and when the Agent list changes, gathering a burst of them into one read.

The icon follows the plugin icons' rules and modules: core's `iconImage` checks it (one of six formats told by its bytes and agreeing with its extension, at most 256 KB, an SVG past the deny-list, and `tint` for a monochrome SVG whose every paint is `currentColor` or `none`), and the list names it as `IconRef { url, tint }`. The icon route `GET /:id/app-center/icon` reads and checks the declared icon again on every request and answers with the server's shared icon response: the `Content-Type` its bytes say, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `Cross-Origin-Resource-Policy: same-origin`; `rev` is a digest of the bytes, so a new icon is a new address. The Web App draws it with the UI package's `ImageIcon` (a mask in the text colour when `tint`, else an `<img>`) and never puts SVG markup into the page.

The viewer's arrangement of the App Center (its order and folders) belongs to their account, per Project, in `ui_prefs.appCenterLayouts[projectId]`:

```ts
interface AppCenterLayout {
  v: 1;
  items: Array<
    | { type: "app"; app: string }                                  // `<agentId>/<workbenchId>`
    | { type: "folder"; id: string; name: string; apps: string[] }
  >;
}
```

`PUT /api/projects/:projectId/app-center/layout { layout: AppCenterLayout | null }` (Project members) stores it and answers `{ layout }`; `null` removes the Project's entry (restore the default order), and `PUT /api/me/prefs` answers 400 to `appCenterLayouts`. Only the shape is checked, and a write that does not hold up is refused whole with 400 and stores nothing: at most 500 items; an app key is at most 200 characters with exactly one `/` and both sides non-empty; a folder id is `[A-Za-z0-9_-]{1,32}`, a folder name is non-empty once trimmed and at most 40 characters (stored trimmed), and a folder holds 1–500 app keys; at most 1,000 app keys in all, with no app key and no folder id twice. The server does not compare a layout with the apps there are, and drops the entries of Projects that no longer exist when it writes; a stored value that does not hold up reads as `null`. The Web App lays a layout over the grid: an app the layout does not name is appended in the server's order, an app that is gone drops out, a folder stays while it holds an app (one is enough) and goes once it is empty, and the next write stores the result. A folder made from the page's new-folder dialog holds the apps checked there, in the grid's order, at the place of the first of them.

The `penguin-support` Support app declares `appCenter: { show: true, icon: "ui/icon.svg" }` and raises `penguin.version`, so installed copies show one update.

The design of PR [#595](https://github.com/Prism-Shadow/penguin-harness/pull/595) is not adopted: the Project-level registry of external apps (`<project>/apps/<id>.toml`), health probes, the `[app_center]` origin block with restart / stop routed to the owning Session, the `penguin app` CLI and the `app-center` Skill. The App Center holds only Workbench shortcuts: external processes are not among them; the page a shortcut opens is served by the server itself, so there is nothing to probe; reloading already exists as `POST /:id/reload`; and the manifest key plus the Skill's layout conventions suffice, without a Skill of its own. Only the navigation position (after Agents) and the name are kept.

### PenguinHarness Support

Every Project still provides `default_agent`; the default Project additionally provides `penguin_support`, which cannot be deleted from the Web. The provisioning flow for built-in Agents is idempotent; existing Agents are not overwritten by presets. This Agent installs the `penguin-support` plugin, with the Skill, backend, and pages all coming from the plugin package — no second copy of the app is replicated in initialization code.

The page is a centered, searchable question list. New questions and details open in dialogs; a new question needs only a body, and the title is read from the associated Session's title and follows renames. Questions and replies persist, supporting follow-ups, retries, resolving, and reopening. Clicking outside a dialog closes it, and unsubmitted drafts are kept. While running, elapsed time and an estimated wait are shown, switching to an explicit timeout-estimate note once the estimate is exceeded; an empty API response shows a readable error and keeps the draft. Answers use inline numbered source links. The Skill reuses the Agent-level reference-repository checkout, and retrieval also takes the historical Workflow name into account.

The app-building Skill requires the list and the details to be separate, the dialogs to have accessible names and focus management, and task progress feedback; browser acceptance uses two independent conversations to confirm that records and results do not get cross-linked.

### One-time migration

On first access, the old `workflows/` and `workflows-history/` are converted to the new directories; modules, interfaces, paths, and style references are converted in a staging copy first, the history revisions are recomputed, and only then is the result published. `state.json` bytes are unchanged, and the originals stay in `<agentDir>/.workbench-migration/backup/`. If publishing is interrupted, the next access resumes it; on a target conflict or an invalid history it stops and does not overwrite the original files.

External callers must switch to `/workbenches` and the new event names; no old API aliases are kept. App ids, full-page addresses, and already-published tutorial and media URLs stay stable. The migration is kept by the Workbench maintainers until the end of 0.2.x; the minimum supported data version rises to 0.3, and the migration code is removed once upgrading from Workflow builds is no longer needed. The backup stays on disk for recovery and is not deleted automatically along with the code removal. This records the compatibility approach already in #1133; no additional long-running dual format is introduced.

## Drawbacks
[drawbacks]: #drawbacks

External API callers need to change names, and the migration code needs maintaining for as long as old data is supported. A plugin update replaces the installed app's sources, so the user's own modifications need to be recovered through history. The backend still runs inside the server process, and the pages are still same-origin iframes; this rename and distribution did not change the execution-isolation boundary.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

Reusing the Plugin installation mechanism gives Skills and apps the same ownership, avoiding two sets of sources to maintain between preset initialization and plugin updates. Run state is independent of the source-file version, so updating or rolling back an app does not wipe existing questions. The one-time conversion concentrates the old naming at the migration entry; keeping both sets of interfaces forever would make every later change maintain the old paths as well.

## Prior art
[prior-art]: #prior-art

[PRFC-0001](PRFC-0001-module.md) provides the module and interface boundaries, and [PRFC-0003](PRFC-0003-plugin.md) provides plugin assembly; [PRFC-0014](PRFC-0014-workflow.md) records Workflow's separate module tree, type checking, tab contributions, and source history. On top of these mechanisms, this document adds app naming, distribution, result reading, and the built-in support entry.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

Backend execution isolation and iframe permissions remain tracked by the unresolved items of the original Workflow design. This change promises no expanded isolation.

## Future possibilities
[future-possibilities]: #future-possibilities

Other reusable Agent apps can be distributed under the same plugin convention; new host methods or UI slots are to be designed separately and are not automatically opened by this rename.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the landed version from the design repository's default branch, identical to the source file.

### v1.1.0

- Added: the "App Center" subsection — the manifest's `penguin.appCenter`, `WorkbenchAppCenter` and `AppCenterShortcut`, the switch's manifest rewrite, the Project-level list, the Support default, and the parts of #595 that are not adopted.
- Added: an "App Center" row in "Names and boundaries" and `PATCH /:id/app-center` in the route table.
- Added: Status notes for 2026-11-03 (apps in the Agent State) and 2026-11-04 (the App Center).

### v1.2.0

- Changed: `AppCenterShortcut` carries `build` (`ready` / `building` / `failed`), `error` and `tab` in place of `broken`, and `icon: IconRef` (`{ url, tint }`, the new icon route with a content revision) in place of `iconUrl`.
- Added: the `workbench_building` event, the App Center's watchers, the icon route `GET /:id/app-center/icon` with its headers, and the icon formats told apart by their bytes.
- Added: `AppCenterLayout`, kept per account and Project in `ui_prefs.appCenterLayouts`, and `PUT /api/projects/:projectId/app-center/layout`; the list answers `layout` beside `shortcuts`.
- Added: a Status note for 2026-11-09.

### v1.3.0

- Changed: a folder of the arrangement goes only once it is empty; a folder of one app stays.
- Added: `WorkbenchInfo.icon` (the declared icon as an `IconRef`, shown or not), and where a folder made from the new-folder dialog goes.
- Changed: a workbench turned off by its own or the Agent-wide switch (PRFC-0025) has no shortcut, and the App Center switch rewrites its manifest without loading it.
