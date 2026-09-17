# Plugin settings on the Settings dialog, the sandbox among them

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#769](https://github.com/Prism-Shadow/penguin-harness/pull/769)

[中文版](2026-09-07-plugin-configuration.zh.md)

A module, whether a plugin's or the harness's own, can declare the settings it needs, and an admin fills them in on a new **Plugins** page of the Settings dialog. The sandbox and its backends were the first to use it.

## Declaring and reading settings

- **A settings group is a contribution** to `PluginConfigProvider.groups`. It is manifest data, so a plugin's group lands in its generated `ifaces.json` and the page lists it without running the package. The contribution's id is the group's name. Its data is a title and description, with `…Zh` counterparts for the Chinese UI, and `properties`. Each field is a `string`, `secret`, `boolean`, `number`, `enum` (with `options`) or `list` (lines, with an optional `maxItems`), and carries a title, description, default, placeholder and `required`. A group may also set `parent`, which draws it inside another group's card, and `order`.
- **Live notices** come from a code contribution to `PluginConfigPage.status`, for a group whose state changes at run time. A malformed declaration drops that group with a warning, and the rest of the page still loads.
- **Values are stored server-wide**, one document per group under `plugin-config:<group>` in the server settings, since plugins load once per process. A secret is masked at every API surface. Sending the mask back keeps the stored value, and an empty value clears it.
- **The declaring module reads its own group.** It `requires` `PluginConfig` from `PluginConfigModule`: `get(name)` returns the stored values merged onto the declared defaults, `watch(name, cb)` fires after every save, and `saved(name)` tells a stored choice from a default.
- **A data-only contribution does not order the boot.** The module tree creates a slot's owner after its contributors only when the slot takes code. A module can therefore declare a group and require `PluginConfig` in the same class.
- **API.** `GET /api/admin/plugin-config` lists every declared group in order, with its schema, masked values, `parent` and notices. `PUT /api/admin/plugin-config {name, values}` saves one group. A refused field returns 400 `plugin_config_invalid` naming the field, and an unknown name returns 404 `plugin_config_unknown`.

## The Plugins page

- **The System settings dialog was renamed Settings** (系统设置 became 设置), in the sidebar user menu, the docs and the other unreleased entries. Its server group gained the Plugins page.
- **The page is admin only**, with one card per group that has no parent and its child groups drawn inside. A secret field starts empty, with the stored mask and a clear checkbox under it. A boolean is a switch, an enum a select, and a list a box of lines.
- **Each card saves on its own**, one PUT per changed group in it. A field the server refuses is marked under that field.
- **The plugin list's header** gained a gear button, for admins, that opens the dialog on this page.

## The sandbox card

- **The sandbox is a settings group**, drawn first on the page: the confinement mode (off, workspace-write or read-only), whether the network is cut off, whether the system temp directory stays writable (on by default, in either mode), and the paths masked from confined commands. It is stored as `plugin-config:sandbox`. A change applies to the next command spawn without a restart, and survives one.
- **A backend declares its own group** with `parent: "sandbox"`, beside its `SandboxModule.providers` contribution, and reads it through `PluginConfig` at each spawn. bwrap declares its program and probe timeout, and Seatbelt its program. A changed program is probed again.
- **The card says what enforces the mode.** It lists the backends in use and the isolation each implements. A backend that failed its load-time check ([sandbox backends](2026-09-17-sandbox-backends.md)) is named with its reason. A backend for another platform is named only when no backend serves. When the saved mode needs isolation no usable backend implements, the card warns that every agent command will be refused. With no usable backend at all, it says a mode confines nothing.
