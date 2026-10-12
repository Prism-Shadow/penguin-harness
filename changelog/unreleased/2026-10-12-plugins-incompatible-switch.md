# The Plugins page's incompatible-only filter moved into Settings › Plugins

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1049](https://github.com/Prism-Shadow/penguin-harness/pull/1049)

[中文版](2026-10-12-plugins-incompatible-switch.zh.md)

The "Incompatible" checkbox in the Plugins page header, which narrowed the list to the plugins this build cannot fully run, was removed from the page. The same filter became a switch at the top of Settings › Plugins, "Show only incompatible plugins", and the page follows it.

## Details

- The switch is a display preference of this browser, remembered in `localStorage` under `penguin.pluginsIncompatibleOnly` and kept when a data root is wiped, like the page's grouping. It commits when flipped, and the Plugins page under the open Settings dialog updates at once.
- In Settings › Plugins the switch sits above the server's plugin options, ruled off from the machine picker and the configuration cards.
- While the filter is on, the Plugins page says "Only incompatible plugins are shown." under its title, with a "Show all" button that turns it off. While it is off, the notice counting the plugins this build cannot fully run keeps its "Show" button, which now turns the stored filter on. The two notices never show together.
