# Installing a plugin on an Agent also enables its server module

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `core`, `db`
- **PR:** [#1636](https://github.com/Prism-Shadow/penguin-harness/pull/1636)

[中文版](2026-11-19-plugin-module-on-agent-install.zh.md)

A library plugin that also ships server modules now brings them along when it is installed on an Agent ([PRFC-0031](https://github.com/Prism-Shadow/penguin-harness-design/pull/479)). The Agent part is written as before. The module is then handled by one rule on the Agent's server: a built-in module (the running build ships the package, and it only adds modules) is listed in the Project's own `[plugins.<machineId>]` table and loaded at once. A non-built-in package whose module already runs needs nothing. One whose module does not run is listed when the administrator installs it, and becomes a request for the administrator when a member does.

## Details

- `POST /api/projects/:p/agents/:a/plugins` brings the modules along as its last step. The answer carries `moduleActions` (enabled, requested, blocked or failed). It and the Agent's `GET` carry `modules`: every library plugin with server modules, with its state on this server, whether this Project lists it, and the standing request. `skipModules: true` writes the Agent part only.
- `GET /api/projects/:p/plugins/installed` carries `modules` too, and `GET /api/plugins` marks a hybrid plugin with `modules: true`.
- `POST /api/projects/:p/plugins/modules { plugin }` (any member) applies the same rule as a button press. `GET /api/admin/plugin-modules` lists the requests and decisions with each module's state, and `POST /api/admin/plugin-modules/decide { package, decision }` enables or declines one. Neither administrator route requires membership of the Project. Declining an enabled module stops it: it leaves this server's own table of every Project, and installs no longer bring it back until the administrator enables it again.
- A new web.db table, `plugin_module_requests`, holds one row per package: who asked, for which Project and Agent, and how the module was enabled (`builtin`, `admin` or `approval`) or that it was declined. Every change also writes a log line naming its actor. The `plugin_modules_changed` event tells the administrator and the Project's users to read again.
- The listing re-assembles the App at once, in the same queue as the administrator's plugin edits. Running Tasks, pending approvals and queued follow-ups carry over. A module that breaks the boot is undone, and the install still answers. Uninstalling a plugin leaves its module running.
- Creating an Agent with a `plugins` list brings their modules along. Company mode does the same once a hire or an organization's creation is finished, and its reconcile pass enables built-in modules only.
- The installed-plugins routes' header no longer says that a plugin change stops running Tasks. Their table edits moved, unchanged, into `services/plugin-tables.ts`, shared with the new service.
