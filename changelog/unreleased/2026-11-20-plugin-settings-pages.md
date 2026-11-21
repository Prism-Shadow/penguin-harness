# Plugins get their own group in Settings, and a plugin's options read as a status page

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `web`, `ui`, `server`, `plugins`, `ui-gallery`
- **PR:** [#1670](https://github.com/Prism-Shadow/penguin-harness/pull/1670)

[中文版](2026-11-20-plugin-settings-pages.zh.md)

The Settings dialog's rail ends with a **Plugins** group that holds every plugin-related
setting; the Server group no longer has a plugins page. The group opens with two pages of the
host's own, for admins: **Plugin sources** (the npm registry, the plugin index and the mirrors)
and **Agent Sandbox** (the sandbox switch and presets, with a line per sandbox backend linking to
that backend's page). Then each plugin with options gets a page of its own, named and drawn with
the plugin's icon and version, holding its personal options (every signed-in user) and its server
options (admins only) as two ruled parts. A page exists only because the plugin contributes it:
the browser's Browser and Chrome extension pages are now the two parts of the Browser Automation
page, and the four sandbox backends (bubblewrap, Seatbelt, WSL, DSH) each have their own page,
with their own icon and version, instead of sitting inside the sandbox card. A plugin that only a
connected machine has gets a page too, once that machine answers, and it opens on that machine.

The Plugins page's "only incompatible plugins" filter moved from Settings to the page itself: an
**Incompatible only** chip beside the search box, remembered in this browser as before.

A plugin's server options are laid out as a status page: a status strip with the version of the
program the plugin installs beside itself (name, version, platform and state, with progress, the
failure reason and Retry), a summary pill and the plugin's main actions; one checks list with a
single **Check again** and each row's own action, with a tool's own words folded under the row;
then the options, with security settings under their own heading.

## Details

- Plugin-config entries name the package whose server module declared them (`plugin`), and a
  status contributor may answer `report()` — `summary`, `version`, `checks[]` and `recheck` —
  sent as the entry's `report`. A settings field may set `security: true`. Plugins that report
  only notices and actions look as they did.
- A web half's Settings page may set `group: "plugin"` with `plugin: <package>` to join that
  plugin's page; its key still opens it. `plugin:<package>` opens a plugin page, `plugins` the
  plugin sources page and `sandbox` the Agent Sandbox page; `plugins` focused on the sandbox (the
  composer's old link) opens the Agent Sandbox page.
- Entries also carry the declaring plugin's card title (`pluginTitle`, `pluginTitleZh`), version
  (`pluginVersion`) and icon (`pluginIcon`, served at `GET /api/admin/plugin-config/icon`), which
  name and draw the page of a plugin the library does not list. A check may link to another
  Settings page (`page`), drawn as an Open link on its row.
- The OS's default sandbox backends, which the sandbox offers to install when it is turned on
  with no backend, come from the plugin index embedded in the server: each backend package
  declares the platforms it is the default for on its `SandboxModule.providers` contribution
  (`defaultFor`), and its index row repeats them (`sandboxDefaultFor`). The host names no backend
  of its own; the defaults are unchanged (Linux: bubblewrap and DSH; macOS: Seatbelt; Windows:
  WSL).
- The sandbox backend plugins declare their groups on their own (no `parent`) and report their
  state with `report()`: the program they run as the version element and their load check, with
  "not applicable" on another platform; saving a backend's page or Check again loads a refused
  backend again. The DSH backend declares an empty group to carry its status.
- A report from a plugin built against another version of the contract degrades rather than
  breaks: a state this build does not know reads as unknown, a malformed field is dropped, and a
  status contributor that throws costs only its own group, which says its status could not be
  read.
- Shared UI: `InstalledVersion`, `Checklist` / `ChecklistRow` and `StatusStrip`, shown on the
  gallery's new **Status page** board. `HelpFold` exports its trigger as `HelpFoldToggle`
  (which takes a full accessible `name`). `PagedDialog` items may carry a `heading`.
