# Plugins configure themselves on the Settings dialog

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#674](https://github.com/Prism-Shadow/penguin-harness/pull/674)

[中文版](2026-09-07-plugin-configuration.zh.md)

A plugin package can now declare the options it needs, and an admin fills them in on a new
**Plugins** page of the Settings dialog. Nobody edits a config file for a plugin's
token any more.

## Details

- **Declared in the manifest.** `package.json#penguin.configuration` is a small schema: a
  title and description (with `…Zh` halves for the Chinese UI) and `properties`, each field a
  `string`, `secret`, `boolean`, `number`, `project`, `enum` (with `options`) or `list` (lines,
  with an optional `maxItems`), with a title, a description, a default, a placeholder and
  `required`. The loader reads it without running the package, and a schema
  the page could not draw fails that plugin's load with the file named.
- **Stored server-wide.** Values live in the server settings under `plugin-config:<package
  name>`, one document per package — plugins load once per process, so their options are the
  process's too. A secret is stored beside the server's other settings and masked at every API
  surface; sending the mask back keeps the stored value, and an empty value clears it.
- **Read through a mechanism.** A module `requires` `PluginConfig` (from `PluginConfigModule`):
  `get(name)` answers the stored values merged onto the schema's defaults, `watch(name, cb)`
  fires after every save — how a plugin applies an edit without a restart or a re-assembly of
  the App.
- **Contributed groups.** A module contributes a settings group to
  `PluginConfigProvider.groups` — the same schema, plus live notices and a `parent` that draws
  one group inside another's card — so a core capability and the plugins extending it get
  their form from the same page code. The sandbox is the first (see the Sandbox settings entry).
- **The Plugins page.** In the Settings dialog's server group, admin only: one card per
  contributed group, then per loaded plugin that declares options, drawn from its schema — a secret
  starts empty with the stored mask and a clear checkbox under it, a Project field is a picker
  over the Projects, a boolean a switch, an enum a select, a list a box of lines. Each card saves
  on its own, one PUT per changed entry in it; a field the
  server refuses is marked under that field. The Plugins page's header (the plugin list) carries
  a gear icon button, for admins, that opens the dialog on this page.
- **API.** `GET /api/admin/plugin-config` lists every loaded package that declares options with
  its schema and masked values, contributed groups first; `PUT /api/admin/plugin-config
  {name, values}` saves one entry's — 400 `plugin_config_invalid` names the refused field, 404
  `plugin_config_unknown` for a name no entry answers to.
