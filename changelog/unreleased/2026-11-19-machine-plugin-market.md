# The plugin market lists the plugins of the Project's machines

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1618](https://github.com/Prism-Shadow/penguin-harness/pull/1618)

[中文版](2026-11-19-machine-plugin-market.zh.md)

For an administrator, the plugin market read every machine of the Project: its plugin library, its registry index and the server modules it runs, each through this server's proxy. The machine picker gained "All machines", which became the default: this server's cards first, then each machine's card that differed from this server's, named after its machine.

## Details

- A server module installed or removed from a machine's card was recorded in this server's Project tables (`[plugins.<machineId>]`), and the fleet sync handed it to the machine, which downloaded the package from its own sources. A module the Project listed for one machine alone could be removed from that machine's card, and was no longer shown as managed for every machine.
- A library plugin installed from a machine's card went to an Agent on that machine, and quick start opened a draft on it.
- Each machine's answers were kept for the tab without paths or MCP setup. A machine out of reach kept its cards, and a note under the title named it, with Retry after a failed read. Its Agent installs waited for it to reconnect; its server modules did not.
- A detail link naming a machine that no longer had the plugin opened this server's card.
- A machine's card named its machine on the shared cover card's `origin` line, under the title (the line itself is part of [the showcase family](2026-11-17-market-showcase-ui.md)).

The App Center half of this change shipped separately; see [the App Center across machines](2026-11-19-app-center-machines.md).
