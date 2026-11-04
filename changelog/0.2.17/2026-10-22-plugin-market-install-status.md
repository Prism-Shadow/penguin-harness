# The plugin market's install status no longer flips while a machine connects or answers slowly

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1289](https://github.com/Prism-Shadow/penguin-harness/pull/1289)

[中文版](2026-10-22-plugin-market-install-status.zh.md)

With a remote machine added, a plugin card's status and its "used by N agents" went back and forth: each time a machine's Agents joined or left the reachable set, every Agent's install snapshot was cleared and read again, this server's included; an Agent whose machine timed out counted as "not installed"; and the rows of the machine in view read "not on this server" after every read of the Project's list. The market's reads now keep their last answer, and a status or a count changes only when an answer says something different.

## Details

- **Per-Agent installs.** Each Agent's installed lists are read on the server it lives on and kept per Project, machine and Agent, in memory and in browser storage, so the market comes back on what it last showed (after a reload, as soon as this server lists its Agents), and an answer equal to the last changes nothing. A change to the list of Agents reads only the Agents it adds; this server's Agents are not read again because a machine connected, dropped out or answered.
- **Unknown is not "not installed".** An Agent whose installs have not been answered, or could not be read, counts neither way. An Agent on a machine out of reach counts with what that machine last answered, and the status hover says how many were counted as last seen.
- **First visit.** Until this server has answered for its own Agents, the card's status and "used by" are fixed-width placeholders; a machine's answer never holds them up.
- **Manage installs.** Every Agent keeps its row. A machine out of reach greys its rows with the reason; an Agent whose installs are not known yet holds its Install button until they arrive, naming the machine it waits for.
- **Machine in view.** A machine's module list keeps its last answer while it is asked again. After a module install for that machine, the row keeps its state until the machine answers, then shows what the machine reports.
- **Machine picker.** The header's machine picker stays in its place while a machine is out of reach: the machine keeps its entry, marked "out of reach", and the machine in view keeps its plain name, so the header controls never shift. It takes its place on the first paint, before this server's id is read.
- **Library, registry and Project tables.** Kept across visits and read again on each; after an import they are read again without a placeholder in between, and a failed re-read keeps the rows on screen.
