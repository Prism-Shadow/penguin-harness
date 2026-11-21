# One install control walks a plugin onto the server and then onto Agents, and an install never hangs

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `ui-gallery`, `docs`, `plugins`, `scripts`
- **PR:** [#1672](https://github.com/Prism-Shadow/penguin-harness/pull/1672)

[中文版](2026-11-20-plugin-install-model.zh.md)

A plugin's card keeps one install control, which opens a two-step install flow: the server first
when the plugin is not there yet, then the Agents. A bar across the top says where it stands
(1/2, then 2/2), and the server step shows each step of its install in words. A member's flow ends
at the server step with a request to an admin. Manage installs is now Install on Agent.
Uninstalling from the server moves to the plugin's detail and uninstalls the plugin from every
Agent on that server first; the confirm names how many Agents lose it, and which ones. A failure
says why on the step that ran it and offers what to do next.

## Details

- **The install flow.** The card's install control keeps the market's labels (Install, N Agents
  installed, Update) and opens the flow. Step 1 installs the plugin on the server: an admin's
  button runs the install without a second confirm, since the step says what it does, and the
  flow moves on by itself when it lands; a server module the build ships is enabled there instead.
  Already on the server, the flow opens on step 2, the Agents, with the 「新建空白 Agent」 row first.
  A plugin of server modules alone has one step. Closing the flow does not stop the install; the
  card's control says the current step meanwhile.
- **In the detail.** An admin's changes to the server: Uninstall from server, a shipped module's
  Disable server module, and the package update. A plugin the build ships cannot be uninstalled
  from the server, and its tag says so.
- **Uninstalling from the server.** `DELETE /api/admin/plugins?package=…` (admin) removes the
  plugin from every Agent of every Project on that server, local edits and workbench data
  included. It then takes the plugin out of each Project's table for that server and uninstalls
  the package. `GET /api/admin/plugins/holders?package=…` lists the Agents for the confirm, which
  names up to five and counts the rest. A Project whose shared table lists the plugin blocks the
  uninstall (`409 plugin_shared`), and a plugin the build ships is refused (`409
  plugin_shipped`). With the machine picker on a machine, the uninstall runs on that machine
  through its tunnel.
- **A member and a plugin not on the server.** Step 1's Ask an admin to install records a request
  (`POST /api/projects/:projectId/plugins/modules` with `package` and the current Agent). The
  administrator's request list holds Enable until the package is on the server.
- **The install stream.** It sends `stage` events (`checking` while a name's registry is asked,
  each source tried, then `loading` before the App re-assembles) and the channel's `download` progress, which it had never sent before. A
  `ping` every 20 s means the 40 s idle cut of event streams no longer drops an install that is
  still running. An answer waits at most 60 s for the re-assembly, and a module that starts
  longer than that is reported as still starting (`loading`).
- **Specific failures.** Before a package installs by name, npm asks the registry about it
  (`npm view`, with the install's own registry and proxy), with a 10 s request window and no
  retry, and is stopped at 12 s. A package that is not on the registry then answers
  `400 plugin_not_published` ("… is not published on <registry> yet"), and a registry that does
  not answer, or a proxy that cannot reach it, gives `400 plugin_source_unreachable`, both within
  seconds and without starting the install; an offline archive is installed instead when the build
  carries one. On a machine without npm the server asks the same question itself: it reads the
  package's registry document, each address within 10 s, and the refusals name the registry's
  host. Once the registry has answered, the install runs with
  `--fetch-timeout=60000 --fetch-retries=1`. The index lookup an install makes tries each address
  once, for 10 s. The failure note on the flow's server step links to Plugin Sources and to
  Import from file.
- **Offline archives carried by the build.** A repository plugin that the market lists but the
  build does not ship is packed into `offline/` beside the builtin prefix, with its sha512
  recorded. When the registry lacks the package, cannot be reached, or npm is missing, the market
  installs that archive after checking it; on a machine without npm it is placed without npm. In
  a workspace checkout the repository's own plugin is
  packed instead. Nothing is preinstalled or loaded from an archive. Market entries carry
  `offline` so the card knows what such a plugin brings before it is installed.
- **UI package.** `ImpactList` names what a destructive action reaches inside its confirm, and
  the gallery's data board shows it.
