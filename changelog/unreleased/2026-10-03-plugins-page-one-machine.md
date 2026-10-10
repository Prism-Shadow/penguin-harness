# The Plugins page views one machine at a time

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `web`, `docs`
- **PR:** [#1014](https://github.com/Prism-Shadow/penguin-harness/pull/1014)

[中文版](2026-10-03-plugins-page-one-machine.zh.md)

The Plugins page had opened on an "All machines" view that judged Installed and Available by the shared `[plugins]` table alone, and its machine picker appeared only when there was another machine. A plugin written into this machine's own `[plugins.<machineId>]` table — as the Sandbox card's install of a backend does — read "only on This server" under Installed and "not installed" under Available at once, and a single-machine deployment could not switch to its own view. The page now always views one machine, this server by default.

## Details

- The picker's "All machines" choice was removed; it lists this server first, then the machines the Project reaches and any a table names, and stays hidden when there is only one machine. When the picked machine leaves the choices (its last session ends, or no table names it any more), the page views this server again instead of staying on a machine the hidden picker cannot leave.
- Installed lists the viewed machine's own table together with the shared one. A shared row carries the tag **Shared by all machines** and cannot be removed from the page; its tooltip says it is managed in the Project config for every machine. A shared plugin that the machine's own table also pins, as a per-machine override, shows as shared and read-only: removing it from the machine's table would leave it running. The machine's own rows carry no tag and can be removed. Agents and the API still edit the shared table. A shared row's disabled Remove is linked by `aria-describedby` to the tag and its hint, so a screen reader says why.
- Available lists the index's and the machine's shipped plugins that neither table runs there; a plugin listed only for another machine is offered as usual.
- Install and Remove on the page always write the viewed machine's own table, and stay unavailable until this server's machine id has been read.
- The "only on …" tag and the "not on this server" state were removed, with the strings `allMachines`, `onlyOn`, `notHere` and `sharedCannotRemove`; `sharedTag` and `sharedHint` were added.
- The Plugins guide (`packages/docs/content/plugins.*.md`) describes the one-machine view: Install and Remove write the viewed machine's own table, and shared rows are read-only.
