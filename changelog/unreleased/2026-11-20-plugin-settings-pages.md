# Plugins get their own group in Settings, and a plugin's options read as a status page

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `web`, `ui`, `server`, `ui-gallery`
- **PR:** [#1670](https://github.com/Prism-Shadow/penguin-harness/pull/1670)

[中文版](2026-11-20-plugin-settings-pages.zh.md)

The Settings dialog's rail ends with a **Plugins** group: each plugin that has options gets a page
of its own, named and drawn with the plugin's icon and version. A page holds the plugin's personal
options, which every signed-in user sees, and its server options, which only admins see, as two
ruled parts. The browser's Browser and Chrome extension pages are now the two parts of the Browser
Automation page. Server › Plugins is renamed **Plugin admin** and keeps the server-wide
plugin settings: sources, mirrors, the sandbox, and any plugin's options that have no page here.

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
  plugin's page; its key still opens it. `plugin:<package>` opens a plugin page.
- A report from a plugin built against another version of the contract degrades rather than
  breaks: a state this build does not know reads as unknown, a malformed field is dropped, and a
  status contributor that throws costs only its own group, which says its status could not be
  read.
- Shared UI: `InstalledVersion`, `Checklist` / `ChecklistRow` and `StatusStrip`, shown on the
  gallery's new **Status page** board. `HelpFold` exports its trigger as `HelpFoldToggle`
  (which takes a full accessible `name`). `PagedDialog` items may carry a `heading`.
