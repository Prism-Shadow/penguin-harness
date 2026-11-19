# The App Center lists the apps of the Project's machines

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1637](https://github.com/Prism-Shadow/penguin-harness/pull/1637)

[中文版](2026-11-19-app-center-machines.zh.md)

For an administrator, the App Center listed the apps of the Agents on the Project's machines after this server's own. Each machine was read through this server's proxy, and its tiles appeared as soon as it answered, without waiting for the others.

## Details

- A machine's tile carried the machine's name under its own, and its key in the arrangement was `<machineId>:<agentId>/<workbenchId>`, so two machines' Agents with the same id and the same workbench made two tiles. The keys of this server's apps did not change.
- A tile opened its window, its full page and its Agent's settings on its own machine, and "Remove from App Center" wrote the setting on that machine. The Workbenches sub-page of a machine's Agent gained the "Show in the App Center" switch, so an app taken off the App Center could be put back.
- What each machine last answered was kept for the tab (`sessionStorage`), without icons or paths. A machine out of reach kept its tiles, greyed and not opened, and a note under the grid named it, with Retry when a read had failed. A machine that reconnected was read again at once.
- The copies were scoped to the data root, the account, the Project and the machine. They were dropped when the machine refused access or left the Project's list, on sign-out, and when the data root changed.
- Arranging the tiles before a machine had answered kept that machine's tiles after the tile they followed in the stored arrangement, and inside their folder when it was still there.
