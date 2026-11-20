# A plugin's server install and its Agent installs each get a control, and an install never hangs

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `ui-gallery`, `scripts`

[中文版](2026-11-20-plugin-install-model.zh.md)

The Plugins page card replaces the side-by-side Install and Manage installs with two named
controls. **Server** installs the plugin on the server or uninstalls it from there. **Install on
Agent** opens the per-Agent dialog. Uninstalling from the server now uninstalls the plugin from
every Agent on that server first, and the confirm names how many Agents lose it, and which ones.
Installing on an Agent a plugin the server does not have yet installs it on the server first; a
member's click asks an admin instead. A server install shows its step on the control that was
clicked and never sits on a frozen button. A failure says why under the card and offers what to
do next.

## Details

- **Server control.** A market package shows Install on server, or Uninstall from server once it
  is there; a member sees the control held, saying only an admin changes the server. A plugin the
  build ships cannot be uninstalled from the server: its tag says so, and an admin enables or
  disables its server module for the Project instead.
- **Uninstalling from the server.** `DELETE /api/admin/plugins?package=…` (admin) removes the
  plugin from every Agent of every Project on that server, local edits and workbench data
  included. It then takes the plugin out of each Project's table for that server and uninstalls
  the package. `GET /api/admin/plugins/holders?package=…` lists the Agents for the confirm, which
  names up to five and counts the rest. A Project whose shared table lists the plugin blocks the
  uninstall (`409 plugin_shared`), and a plugin the build ships is refused (`409
  plugin_shipped`). With the machine picker on a machine, the uninstall runs on that machine
  through its tunnel.
- **Installing on an Agent before the server has it.** The Agent dialog says first how it relates
  to the server. For an admin, Install runs the server install, showing each step on that row,
  and then installs on the Agent. For a member, it records a request
  (`POST /api/projects/:projectId/plugins/modules` with `package`). The administrator's request
  list holds Enable until the package is on the server.
- **The install stream.** It sends `stage` events (each source tried, then `loading` before the
  App re-assembles) and the channel's `download` progress, which it had never sent before. A
  `ping` every 20 s means the 40 s idle cut of event streams no longer drops an install that is
  still running. An answer waits at most 60 s for the re-assembly, and a module that starts
  longer than that is reported as still starting (`loading`).
- **Specific failures.** npm runs with `--fetch-timeout=60000 --fetch-retries=1`. A package that
  is not on the registry answers `400 plugin_not_published` ("… is not published on <registry>
  yet"). A registry that does not answer gives `400 plugin_source_unreachable`. The index lookup
  an install makes tries each address once, for 10 s. The note under the card links to Plugin
  Sources and to Import from file.
- **Offline archives carried by the build.** A repository plugin that the market lists but the
  build does not ship is packed into `offline/` beside the builtin prefix, with its sha512
  recorded. When the registry lacks the package, cannot be reached, or npm is missing, the market
  installs that archive after checking it. In a workspace checkout the repository's own plugin is
  packed instead. Nothing is preinstalled or loaded from an archive. Market entries carry
  `offline` so the card knows what such a plugin brings before it is installed.
- **UI package.** `ImpactList` names what a destructive action reaches inside its confirm, and
  the gallery's data board shows it.
