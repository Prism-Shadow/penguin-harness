---
title: Plugins
description: What a PenguinHarness plugin is, the format a plugin package follows and how it is checked, where plugins come from, and how one is shared — through the plugin index, npm or a local link.
---

A plugin is a set of penguin modules: the unit the harness itself is built from (see [Server Boot](/server-boot#what-a-plugin-is) and the design documents PRFC-0001 "Module" and PRFC-0003 "Plugin", which the repository carries under `rfcs/`). A plugin is an npm package. Installing it puts its modules into the server's tree or its Skills, hook package, MCP servers and workbenches into an agent's Agent State — the tasks around that live on [Skills & Plugins](/skills#how-it-works). This page is about the package itself: its format, where plugins come from, and how one is shared — through the plugin index, npm or a local link.

## The format

A plugin package is an npm package whose `package.json` carries npm's own fields only. What the plugin carries is declared in its entry source: an empty class whose `@Component` decorator lists, as contributions to the server's `PluginLibraryModule`, the plugin's card, its Skills, its hook package, its MCP servers and its workbenches, and a default export `{ modules, replaces }` of the server modules it adds. The package's build runs `penguin-gen-ifaces` over its own tsconfig and writes that declaration into `ifaces.json` beside its `package.json`; that table is what the server reads, and it never runs the package. The field tables, the directory layout and a worked example are in [How it works](/skills#plugin-file-format).

All of these are plugins, and one format covers them all. What differs is where a package's contents land when installed: its contributions to `PluginLibraryModule` — Skills, hooks, MCP servers, workbenches, a card — land in an agent's Agent State, and a package carrying only those needs no code entry point (`goal` is the worked example); the server modules its default export lists — a sandbox backend, for example — land in the server's module tree. One package can carry both. A built-in plugin can also carry halves that the Web App and the CLI compile in when they are built — a `./web` entry and a `./cli` entry. `browser-automation` carries all of these: the agent browser's server module, its panel and settings pages, the `penguin browser` command and its Skill.

A server module needs a platform at least as new as the slots it contributes to. A slot is a named contribution point, such as a route group in `HttpModule.routes`. Every slot, and every field of a slot's data, arrives with some release. An older platform does not know a newer slot, or a newer field such as a route group's `origin`. Its check then drops every contribution that module makes to that slot. The plugin runs without that part of itself, and its row on the **Plugins** page says why. Built-in plugins ship with the server they run on. A package published to npm states the oldest release it needs in its README.

## What a server module reaches

A server module reaches the host through `@prismshadow/penguin-server/plugin` alone. It requires an interface by naming it in a `@Use` field, and the kernel wires it to whichever node of the tree has those members: the match is by structure, so a plugin may as well declare the same view in its own package, naming only the members it calls. A host that has no node with those members leaves the plugin out of the generation, and the **Plugins** page says which requirement it could not meet. That is how an older server refuses a plugin built for a newer one.

What a system app a plugin provides needs (PRFC-0036):

| Interface | Members | What it is |
| --- | --- | --- |
| `AppData` | `dataPaths(projectId, appId) → Promise<{ dataDir, cacheDir, stateDir }>` | The app's own folders in a Project: the system Agent's agent-level folders keyed by the app id (`agents/system_agent/app/{data,cache}/<appId>/`, the state folder under `run/`), each made before it is returned. Handlers read and write them with Node's `fs`. `400` for an id that is not one plain segment, `404` `project_not_found` for a Project the server does not have, `409` `system_agent_held` where the Project's `system_agent` is a user's own Agent. |
| `AgentTasks` | `start({ userId, projectId, agentId, prompt, approvalMode, skills?, model?, thinkingLevel?, title? }) → Promise<{ sessionId }>`, `status(userId, sessionId) → Promise<{ status, title, pendingApprovals } \| null>` | An Agent task started as a person, by the steps the Web App's Send takes: `404` when the person cannot reach the Project or the Agent does not exist, `409` `system_agent_no_sessions` for the system Agent, a fresh temporary Workspace, the Skills as a `[use_skills]` block in front of the text, the person as the run's driver, source `user` (their sidebar, approval badge and completion notice), and the approval mode given. `status` is `running`, `completed` or `failed`, with the approvals the task waits on; `null` for a Session that is gone or that the person cannot read. A route that starts one checks `requireHuman` first. |
| `Access` | `requireProjectAccess`, `requireProjectOwner`, `canAccess`, … | Who may see and who owns a Project. |
| `AgentSkills` | `installedSkills(projectId, agentId) → Promise<string[]>` | The names of the Skills installed on an Agent, sorted: its `skills/<name>/` folders that hold a SKILL.md. `404` `agent_not_found` for an Agent the Project does not have. |
| `ProjectModels` | `getModels(projectId)` | The Project's models, keys masked, and its default model. |
| `ProjectMachines` | `projectApis(projectId)` | The machines a Project uses, each with its alias and a client to its own API while it is connected; read for an administrator only, as the machine proxy is. |
| `WorkspaceFiles` | `list`, `read`, `resolvePath`, … | A Workspace's files, with the server's guards against links and sizes. |

The values a route of its own needs, bundled into the plugin as copies: `containedFile(dir, rel)` and `uiFileResponse(c, file)` serve the plugin's page files from its own folder, refusing a path that climbs out and any link; `unzipBounded`, `assertSafeEntryPath`, `assertDistinctPaths`, `specialEntries` and the archive limits (`MAX_ARCHIVE_BYTES`, `MAX_ARCHIVE_FILES`, `MAX_FILE_BYTES`, `MAX_TOTAL_BYTES`) read an uploaded zip safely.

Data slots a system app contributes to:

- `ProjectsModule.appSeeds` `{ app, path }`: every folder under the package's `<path>/` is copied into the app's `dataDir` when a Project is created, under its own name and only where that name is free. The host reads the declaration from `ifaces.json` and copies the files itself, for built-in packages only, once: a deleted seed does not come back, and an existing Project never gets them.
- `SemanticIdModule.kinds` `{ kind, access? }` with a code half `{ takenIds(projectId) }`: a kind of id `POST …/suggest-id` proposes, kebab-case, avoiding what `takenIds` names; `access: "owner"` limits it to the Project's owner.
- `StartPageModule.metrics` `{ key, title, titleZh?, icon?, order, value, app? }`: a count the start page shows after its own, fixed when the package is built; `app` is the page key of the system app a click opens. `GET /api/contributions` delivers them as `startMetrics`.

## A page in the App Center's window

A server module contributes Web App pages through `WebModule.pages`. A page drawn by an iframe (`renderer: { iframe: { src } }`, with `src` served by the module's own route) that carries a `title` and `app: { order }` is a system app of the system Agent. Its tile sits in the App Center, and it opens in the App Center's window like an agent's app: minimize keeps it running, full screen draws the same document with no window around it, and Close ends it.

- **Address.** The window is `/apps?app=system_agent/<page key>`. The page keeps its own location in `at`: the path and query inside the app, URL-encoded. The frame's `src` carries the starting location as its fragment (`#/<path>?<query>`). An address with no `at`, such as the tile, brings a running window back where its page is.
- **Old addresses.** The page's `path`, and every address under it, open the window and replace the history entry: `/reports/r1?tab=a` becomes `/apps?app=system_agent/reports&at=%2Fr1%3Ftab%3Da`.
- **Messages** (`postMessage`, same origin):
  - `{ type: "penguin:location", at }` goes both ways. The page posts it whenever it moves inside itself, and the host replaces `at` without adding a history entry, so the page should move with `history.replaceState` rather than `pushState`. The host posts it when its own address moves (Back, Forward, a pasted address), and the page goes there without reloading.
  - `{ type: "penguin:navigate", to }` asks the host to go to `to`, a path of this app outside `/api/`, such as `/chat/<sessionId>`. The window is minimized and keeps running.
  - The host takes a message only from its window's own frame. A page should take one only from `window.parent`.
- **Context.** The frame's root element carries `lang` (`zh-CN` or `en`) and `data-project-id`, updated when the interface language or the current Project changes. They sit beside the theme the host writes into every workbench page. The frame paints no background of its own.

An agent's workbench page keeps the same address, messages and context, in its window (`/apps?app=<agentId>/<workbenchId>&at=…`) and on its full page (`/app/<projectId>/<agentId>/<workbenchId>[/<tab key>]?at=…`); see [Workbench plugins](/skills#workbench-plugins).

A contributed iframe page without `app` opens as a page at its `path`, framed the same way. Safe mode draws no server contribution, so the app is absent there.

## Checking the format

Nothing loads a plugin package to find out what it is: the table says it. Two checks read that table and the package around it, and they agree because they read the same generated file.

- **The index CI** checks a submitted package: its manifest parses and its path spells its name, version and content hash; the metadata matches what npm serves; installing the lock produces exactly the content the hash names; the package is loadable ESM with an `activate` export; the license is allowed. These are the submission's rules, and [CONTRIBUTING](https://github.com/Prism-Shadow/penguin-harness-plugins/blob/main/CONTRIBUTING.md) in the plugin index repository is their authority.
- **Locally**, build the package (`penguin-gen-ifaces` regenerates `ifaces.json`; a stale table is refused by name) and load it the way the server does — through a Project's `[plugins]` table on a deployment, or through the loader the tests exercise. A declaration the table does not back, or a table the build did not write, is skipped with its reason reported.

## Where plugins come from

Four places, four rules:

1. **The harness's own modules** are not yours to list or submit: most live in the main packages, and a feature that can stand apart moves into a built-in plugin under `plugins/` — the agent browser was the first, as `browser-automation` — but either way they are part of PenguinHarness itself, not someone else's package. See [Architecture](/architecture) for the packages as they are today.
2. **Built-in plugins** ship with the repository under `plugins/` — one npm package per plugin, listed by category in the [built-in library](/skills#built-in-library). Installing one fetches it from npm or its repository, and the desktop app packs its own set of them into the bundle. A plugin built around someone else's product carries a `use-` prefix (`use-firecrawl`), and a self-evolution toolkit's name ends in `-rsi-toolkit`.
3. **Third-party plugins** are collected into the [plugin index](https://github.com/Prism-Shadow/penguin-harness-plugins) — one entry per pull request, under the submission protocol of that repository. The server merges the index with its built-in list on the **Plugins** page; an index entry is for discovery only, and the package still installs from the channel the entry names.
4. **Your own or unlisted plugins** need no index at all: link a local directory into the server's plugin prefix with `penguin plugin link` — the directory stays where it is and is referenced in place, loaded through the same path as an installed plugin; for a published package, install it by npm name.

## Sharing a plugin

The [CONTRIBUTING](https://github.com/Prism-Shadow/penguin-harness-plugins/blob/main/CONTRIBUTING.md) guide of the plugin index repository is the authority for listing; this page and the `penguin-plugin` skill point at it and do not restate its rules — when they disagree with it, it wins. In short: publish the package (npm is the whole channel story — an entry needs at least one source the harness can fetch the tarball from, with the bytes pinned by the entry's hash), let the tooling write the entry (`pnpm new-entry <name>@<version>`), fill in `categories` and `owners`, run the local checks, and open one pull request with exactly one entry. CI decides the mechanical questions; review is human.

The `penguin-plugin` skill carries the same steps for a harness session, together with the other ways — install by npm name, or link a local directory — and a separate instance with `PENGUIN_HOME` and `penguin plugin link` for testing a package before it is shared: it drives the protocol without copying it, and the two are updated in the same change, so the step-by-step edition never drifts from the rules it drives.
