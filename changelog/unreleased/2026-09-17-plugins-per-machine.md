# A plugin can run on some machines only, and the Plugins page switches between machines

- **Date:** 2026-09-17
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#450](https://github.com/Prism-Shadow/penguin-harness/pull/450)

[中文版](2026-09-17-plugins-per-machine.zh.md)

A Project's plugin list gained per-machine tables. A plugin listed for certain machines runs only on those machines. The Plugins page gained a machine picker for viewing and editing each one.

## Configuration

- **`[plugins.<machineId>]`** sits under the shared `[plugins]` table in `.project_config.toml` and lists what one machine runs in addition to the shared table. For a name both tables list, the machine's entry wins. The key is the machine's own 16-character id, minted by its server on first boot, never an ssh alias. This server uses its own id too.
- **Loading** reads this server's effective list: the shared table plus its own table. A plugin listed only for other machines is not loaded here.

## API

- `POST /api/projects/:projectId/plugins/installed` accepts `machineId`, which lists the package in that machine's table. Like the shared table, it takes only a plugin the build ships.
- `DELETE …?specifier=…&machineId=…` drops the package from that machine's table. Without `machineId`, it drops it from every table.
- An edit that does not change what this server runs is written without re-assembling the App here.
- `GET` rows carry `everywhere`, `machines` and `here`, and the response carries this server's `machineId`.

## Fleet sync

- A machine is handed the shared table plus its own table. There, the list lands as that Project's shared table.
- A plugin the machine lacks is added through that machine's own `POST`, which takes only what its build ships. A plugin not listed for a machine is never sent there.
- A plugin the machine refuses is reported in the connect log and left out of that sync. The other plugins still arrive.

## Plugins page

- **Machine picker.** A picker beside the settings button switches between **All machines**, **This server** and each machine the Project reaches. It appears once there is any machine besides this server.
- **All machines** lists every plugin. A plugin listed for some machines only is tagged with their names.
- **A machine's view** lists what that machine is asked to run, in the state that machine itself reports. Installing there enables the plugin on that machine only. A plugin from the shared table cannot be removed there, and its row says so.
