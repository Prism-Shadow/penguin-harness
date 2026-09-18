# Plugin settings on the Settings dialog, the sandbox among them, and permissions per Session

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#769](https://github.com/Prism-Shadow/penguin-harness/pull/769)

[中文版](2026-09-07-plugin-configuration.zh.md)

A module, whether a plugin's or the harness's own, can declare the settings it needs, and an admin fills them in on a new **Plugins** page of the Settings dialog. The sandbox and its backends were the first to use it.

## Declaring and reading settings

- **A settings group is a contribution** to `PluginConfigProvider.groups`. It is manifest data, so a plugin's group lands in its generated `ifaces.json` and the page lists it without running the package. The contribution's id is the group's name. Its data is a title and description, with `…Zh` counterparts for the Chinese UI, and `properties`. Each field is a `string`, `secret`, `boolean`, `number`, `enum` (with `options`) or `list` (lines, with an optional `maxItems`), and carries a title, description, default, placeholder and `required`. A `number` may declare `minimum` and `maximum`, and a `string` or `list` a `pattern` (with `patternErrorMessage`) that every value, or every line, must match. A group may also set `parent`, which draws it inside another group's card, and `order`.
- **Live notices** come from a code contribution to `PluginConfigPage.status`, for a group whose state changes at run time. Its optional `saved()` runs after a save of the card and holds the PUT's answer until what it set in motion has settled. A malformed declaration drops that group with a warning, and the rest of the page still loads.
- **A status can offer actions and report work in progress.** It may list `actions()`, drawn as buttons under the group's notices, and `run(id)` runs one through `POST /api/admin/plugin-config/action`. A notice may carry the `progress` tone: the page shows it with a spinner and reads the card again every two seconds until it is gone. When an action's work ends, the card that draws it settles as after a save, so a sandbox backend that could not load before loads without one. The WSL backend's card is the first to use both.
- **Values are stored server-wide**, one document per group under `plugin-config:<group>` in the server settings, since plugins load once per process. A secret is masked at every API surface. Sending the mask back keeps the stored value, and an empty value clears it.
- **The declaring module reads its own group.** It `requires` `PluginConfig` from `PluginConfigModule`: `get(name)` returns the stored values merged onto the declared defaults, `watch(name, cb)` fires after every save, and `saved(name)` tells a stored choice from a default.
- **A data-only contribution does not order the boot.** The module tree creates a slot's owner after its contributors only when the slot takes code. A module can therefore declare a group and require `PluginConfig` in the same class.
- **API.** `GET /api/admin/plugin-config` lists every declared group in order, with its schema, masked values, `parent` and notices. `PUT /api/admin/plugin-config {name, values}` saves one group. A refused field returns 400 `plugin_config_invalid` naming the field, and an unknown name returns 404 `plugin_config_unknown`.

## The Plugins page

- **The System settings dialog was renamed Settings** (系统设置 became 设置), in the sidebar user menu, the docs and the other unreleased entries. Its server group gained the Plugins page.
- **The page is admin only**, with one card per group that has no parent and its child groups drawn inside. A secret field starts empty, with the stored mask and a clear checkbox under it. A boolean is a switch, an enum a select, and a list a box of lines.
- **Each card saves on its own**, one PUT per changed group in it, carrying only the fields that changed, so an untouched default is never stored as a value. A field the server refuses is marked under that field.
- **The plugin list's header** gained a gear button, for admins, that opens the dialog on this page.

## The sandbox card

- **The sandbox is a settings group**, drawn first on the page: the confinement mode (off, workspace-write or read-only), whether the network is cut off, whether the system temp directory stays writable (on by default, in either mode), and the absolute paths masked from confined commands. It is stored as `plugin-config:sandbox`. A change applies to the next command spawn without a restart, and survives one.
- **A backend declares its own group** with `parent: "sandbox"`, beside its `SandboxModule.providers` contribution, and reads it through `PluginConfig` at each spawn. bwrap declares its program and a probe timeout of 1–30 seconds, and Seatbelt its program. A named program is used first; empty, bwrap falls back to the bubblewrap it ships and then a `bwrap` on PATH, and Seatbelt to `/usr/bin/sandbox-exec`. A changed program is probed again. A backend binds a loader (`SandboxProviderSource` now also accepts a function), so one that failed its check at boot, such as a wrong program path, loads again after the Sandbox card is saved, with no restart.
- **The WSL backend's card** ([sandbox backends](2026-09-17-sandbox-backends.md)). Its group holds whether every Windows drive is shown read-only (off by default: only the Workspace is visible under `/mnt`), the base Linux (Ubuntu or Alpine), the package list, a package mirror for apt or apk, and the distro's name. The card says what the machine has, and offers the next step as a button, each showing its progress: Install WSL (one Windows consent prompt), Initialize sandbox distro, Check confinement, Remove distro.
- **The card says what enforces the mode.** It lists the backends in use and the isolation each implements. A backend that failed its load-time check ([sandbox backends](2026-09-17-sandbox-backends.md)) is named with its reason. A backend for another platform is named only when no backend serves. When the saved mode needs isolation no usable backend implements, the card warns that every agent command will be refused. With no usable backend at all, it says every mode but off refuses every agent command.

## Permissions per Session

The sandbox policy belongs to a Session now. A Session takes the server's Sandbox settings when it is created and keeps them, so changing those settings no longer reaches an agent that is already running. The composer's approval control becomes a permission button that shows the level at a glance.

- **The permission button** is an icon-only square, like the + button beside it, and the skills button now matches them: no text, no caret. The three sit as one tight cluster. It shows lucide's shield icon for the level, a different icon per level so the level never depends on colour alone. Red `shield-alert` is full access: full filesystem, network open, every call approved. Amber `shield-half` is partial: some write permission with something still holding it back. Green `shield-check` is read-only: commands cannot write. Grey `shield-off` is off: every tool call is denied. The accessible name and the tooltip spell out the level and all three settings.
- **A change of level is shown at once and animated.** The picked level shows immediately instead of after the save, and the button no longer dims while it saves, which together read as a flicker. The new icon turns and grows in; a refused save swaps back, with a toast saying why.
- **The menu has three sections.** Filesystem picks read-only, workspace write, or full access. Network allows or cuts off. Approval picks one of the four approval modes. For an administrator, a plain More… row opens the Settings page's Plugins tab scrolled to the Sandbox card. The draft page shows the same button, starting from the server's Sandbox settings, and the subagent panel edits its root Session's values.
- **Settings are defaults now.** The Sandbox card on the Settings page says so. A policy change on a Session applies from that Session's next command. A subagent runs under its root Session's policy, a fork and a model switch carry the policy over, and a handoff to another Agent carries it too.
- **An administrator's sandbox is still a ceiling for everyone else.** A non-admin may tighten a Session's policy but never pick a filesystem mode or network looser than the server's settings; the API answers `403 sandbox_forbidden`.
- **API.** `SessionInfo.sandbox` reports `{ mode, network }`. Session creation and `PATCH /api/sessions/:id` accept `sandbox`. `GET /api/projects/:p/chat-defaults` also serves the policy a new Session would start with. On the plugin side, `CreateAgentOptions.confineSpawn` is evaluated with the Session's coordinates, like `controlEnv`, and the sandbox service gains `confinerFor`.
- **Known gap:** Filesystem and Network confine commands only. The file-writing tools are still governed by the approval mode alone, as before.

Existing Sessions are handled as described in [backward compatibility](2026-09-16-backward-compatibility.md).
