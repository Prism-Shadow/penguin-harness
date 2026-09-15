# Plugins configure themselves on the Settings dialog

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#674](https://github.com/Prism-Shadow/penguin-harness/pull/674)

[中文版](2026-09-07-plugin-configuration.zh.md)

A module — a plugin's or the harness's own — can now declare the settings it needs, and an
admin fills them in on a new **Plugins** page of the Settings dialog. Nobody edits a config
file for a plugin's token any more.

## Details

- **Declared as a contribution.** A settings group is a contribution to
  `PluginConfigProvider.groups`: pure manifest data, so a plugin's lands in its generated
  `ifaces.json` with its other contributions and the page lists it without running the package.
  The contribution's id is the group's name; the data is a small schema — a title and
  description (with `…Zh` halves for the Chinese UI) and `properties`, each field a `string`,
  `secret`, `boolean`, `number`, `enum` (with `options`) or `list` (lines, with an optional
  `maxItems`), with a title, a description, a default, a placeholder and `required` — plus an
  optional `parent`, which draws the group inside another group's card, and `order`. A group
  whose status changes at run time contributes live notices to `PluginConfigPage.status`. A
  malformed declaration drops that group with a warning, not the page.
- **Stored server-wide.** Values live in the server settings under `plugin-config:<group>`,
  one document per group — plugins load once per process, so their options are the process's
  too. A secret is stored beside the server's other settings and masked at every API surface;
  sending the mask back keeps the stored value, and an empty value clears it.
- **Read by the declaring module.** The module `requires` `PluginConfig` (from
  `PluginConfigModule`) and pulls its own group: `get(name)` answers the stored values merged
  onto the declared defaults, `watch(name, cb)` fires after every save, `saved(name)` tells a
  stored choice from a default. Nothing carries the values on a module's behalf, so each turns
  the document into its own typed settings.
- **Data orders nothing.** The module tree creates a slot's owner after its contributors only
  where the slot takes code: a data-only contribution is there before anything is created, so
  a module may declare a group and require `PluginConfig` in the same class.
- **The Plugins page.** In the Settings dialog's server group, admin only: one card per group
  with no parent, its children inside, drawn from the schema — a secret starts empty with the
  stored mask and a clear checkbox under it, a boolean is a switch, an enum a select, a list a
  box of lines. Each card saves on its own, one PUT per changed group in it; a field the server
  refuses is marked under that field. The Plugins page's header (the plugin list) carries a gear
  icon button, for admins, that opens the dialog on this page.
- **API.** `GET /api/admin/plugin-config` lists every declared group, in order, with its schema,
  masked values, `parent` and notices; `PUT /api/admin/plugin-config {name, values}` saves one
  group's — 400 `plugin_config_invalid` names the refused field, 404 `plugin_config_unknown`
  for a name no group answers to.
