# Backward compatibility in this batch

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `core`, `server`, `web`, `db`
- **PR:** [#1644](https://github.com/Prism-Shadow/penguin-harness/pull/1644), [#1642](https://github.com/Prism-Shadow/penguin-harness/pull/1642), [#1656](https://github.com/Prism-Shadow/penguin-harness/pull/1656), [#1654](https://github.com/Prism-Shadow/penguin-harness/pull/1654)

[中文版](2026-11-19-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Runtimes and platforms on either side of the server seams

[Code plugins reach the server through one face](2026-11-19-plugin-server-seams.md). The agent browser's extension WebSocket became a contributed `HttpModule.upgrades` endpoint, and its pairing route's exemption from the same-origin write check became the route group's own `origin: "own"`. The runtime is not pushable and a platform is, so the two can be from either side of that change:

- **An older pushed platform under a newer runtime.** A runtime restores whatever platform was pushed last, older than itself included. Such a platform serves no WebSocket endpoints and cannot say which route groups judge their own origin. For it, the runtime still looks the extension's gate up by the names `BuiltinBrowserModule` / `BrowserExtensionGate` and runs the extension's handshake over it itself. It also still exempts `POST /api/builtin-browser/extension/pair` by its path. The handshake and the origin rule are a frozen copy in `packages/server/src/hmr/legacy-browser.ts`, so the runtime imports none of the browser's code.
- **A newer platform pushed onto an older runtime.** An installed runtime from before the seams only does that name lookup. So the browser module stays named `BuiltinBrowserModule` and keeps exporting `BrowserExtensionGate` with its `admit` / `connect` shape, beside its contributed endpoint.

### Scope

Every server whose runtime and pushed platform are from different sides of this change, on the extension's WebSocket (`/api/builtin-browser/extension/ws`) and its pairing route.

### What you need to do

Nothing.

### Lifetime

The server maintainers keep both until the next major version (1.0), and remove them together in that release's preparation:

- `packages/server/src/hmr/legacy-browser.ts`, the `fallback` it fills in `hmr/upgrade-seam.ts`, and the `legacyOwnOrigin` fallback in `src/app.ts`;
- the browser module's two names, which may then be renamed.

## Projects created before a module was preinstalled

[Preinstalled built-in modules are listed in Project config](2026-11-19-preinstalled-plugin-modules.md). A new Project lists them when it is created. A Project created earlier has no such listing. Without handling, once a feature moves into a preinstalled plugin, it would be missing from every Project that predates the move. The first boot of a build that ships a preinstalled module lists the module once in this server's own `[plugins.<machineId>]` table of every existing Project. Nothing else in the file changes. Each Project is recorded per package in web.db's `plugin_module_preinstalls`, and a recorded Project is never listed again. A Project the administrator later takes the module out of stays without it. In this batch the one such module is the agent browser's, from [browser-automation](2026-11-19-browser-use-plugin.md): without the listing, every existing Project would lose the browser on upgrade.

### Scope

Every `.project_config.toml` under the data root of a server that boots a build shipping a preinstalled module, once per package. A server whose build ships none changes nothing. A module the administrator stopped is not listed. A Project whose config cannot be read or written is logged and tried again at the next boot. One whose config is not valid TOML is logged and passed over for good.

### What you need to do

Nothing.

### Lifetime

The one-time listing stays until the next major version (1.0). Whoever prepares 1.0 removes it:

- `packages/server/src/services/preinstall-once.ts` and its call in `packages/server/src/hmr/platform.ts`;
- the record calls of Project creation and of the preinstalled enable in `packages/server/src/services/plugin-modules.ts`;
- `PluginModulePreinstalls` and `PluginModulePreinstallsRepo` in `library/setting`;
- the `plugin_module_preinstalls` table, through a new migration that drops it.

Listing at Project creation is the feature itself and stays. At that point it is also to be decided whether a module first preinstalled after 1.0 should still reach existing Projects; that would keep the mechanism as a standing one.

## An Agent already named `system_agent`

[Every Project gets a system Agent](2026-11-19-system-agent.md) under the id `system_agent`. Agent ids are the user's to choose, so a Project may already hold an Agent with that id. Such an Agent has no `system: true` key in its `system_config.yaml`, so it stays an ordinary Agent: it chats, deletes and exports as before, and provisioning never overwrites it. The Project has no system Agent while it holds the id. The Agents page shows the Project's owner a notice naming it.

### Scope

A Project of any server, desktop install or machine whose `agents/system_agent/` existed before the upgrade.

### What you need to do

To give that Project its system Agent: export the Agent, import it under another id, and delete the old one. The system Agent is added the next time the Project's Agents are listed.

### Lifetime

The owner of core's `state/system-agent.ts` keeps the key requirement documented there as this case's handling, and the Agents page's notice (`holdsSystemAgentId` in `packages/web/src/lib/builtin-agents.ts` and the `systemIdHeld` strings), until the next major version (1.0), and removes the notice in that release's preparation.
