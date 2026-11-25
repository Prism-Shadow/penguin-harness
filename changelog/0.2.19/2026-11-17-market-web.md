# Browse the plugin market as cards or a list

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `ui-gallery`
- **PR:** [#1584](https://github.com/Prism-Shadow/penguin-harness/pull/1584)

[中文版](2026-11-17-market-web.zh.md)

The Plugins page opens directly to search, filters and results. Switch between cover cards and a compact list with the two icons at the end of the controls row (a grid and a list, each named on hover), or group plugins by category, status or contents. The browser remembers the layout and sort. A search that only matches other tabs offers a link to all matches.

Both views open plugin details, manage installations and launch installed workbenches. Each detail has a shareable address. Back returns to the market, and details open full-screen on a phone.

Categories supplied only by the remote registry, including Utilities and Entertainment, appear as soon as they have a plugin to browse.

Each card shows the version in its top right and two one-line actions along its foot. The install action names one state: Install while no Agent has the plugin; once any Agent has it, how many do, which opens Manage installs, where the Agents still without it can install it; Update when the selected Agent's copy is behind; Installed on server for a running server plugin. A package update names the new version. Quick start opens an example on the selected Agent. In the list each plugin is one compact row (its icon, its name over a one-line description, then the install action and Quick start on the same row), two rows abreast at a usual desktop width and one on a narrow window. The card, its version chip and its two actions are the UI package's cover card, the one the public catalog draws.
