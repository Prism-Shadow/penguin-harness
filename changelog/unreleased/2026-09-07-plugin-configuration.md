# Plugins configure themselves on the System settings dialog

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383)

[中文版](2026-09-07-plugin-configuration.zh.md)

A plugin package can now declare the options it needs, and an admin fills them in on a new
**Plugins** page of the System settings dialog. Nobody edits a config file for a plugin's
token any more.

## Details

- **Declared in the manifest.** `package.json#penguin.configuration` is a small schema: a
  title and description (with `…Zh` halves for the Chinese UI) and `properties`, each field a
  `string`, `secret`, `boolean`, `number` or `project`, with a title, a description, a default,
  a placeholder and `required`. The loader reads it without running the package, and a schema
  the page could not draw fails that plugin's load with the file named.
- **Stored server-wide.** Values live in the server settings under `plugin-config:<package
  name>`, one document per package — plugins load once per process, so their options are the
  process's too. A secret is stored beside the server's other settings and masked at every API
  surface; sending the mask back keeps the stored value, and an empty value clears it.
- **Read through a mechanism.** A module `requires` `PluginConfig` (from `PluginConfigModule`):
  `get(name)` answers the stored values merged onto the schema's defaults, `watch(name, cb)`
  fires after every save — how a plugin applies an edit without a restart or a re-assembly of
  the App.
- **The Plugins page.** In the System settings dialog's server group, admin only, after
  Sandbox: one form per loaded plugin that declares options, drawn from its schema — a secret
  starts empty with the stored mask and a clear checkbox under it, a Project field is a picker
  over the Projects, a boolean a switch. Each plugin saves on its own in one PUT; a field the
  server refuses is marked under that field.
- **API.** `GET /api/admin/plugin-config` lists every loaded package that declares options with
  its schema and masked values; `PUT /api/admin/plugin-config {name, values}` saves one
  package's — 400 `plugin_config_invalid` names the refused field, 404
  `plugin_config_unknown` for a package that declares none.
