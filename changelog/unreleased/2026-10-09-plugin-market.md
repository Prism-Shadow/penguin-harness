# One plugin market: every plugin a card grouped by category, and versions per Skill and hook package

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `web`, `server`, `core`, `skills`, `ci`
- **PR:** [#1009](https://github.com/Prism-Shadow/penguin-harness/pull/1009)

[中文版](2026-10-09-plugin-market.zh.md)

The Plugins page shows every plugin the same way, the library's Skill and hook plugins and the server modules such as the sandbox backends alike, grouped by category, with each plugin's details in a dialog. A plugin's version became its npm version, and the date versions moved down to the parts an agent may edit locally: each Skill, and each hook package.

## Versions

- A plugin's version is its npm version, the `version` of the `package.json` beside its `plugin.json`. `plugin.json` no longer carries `version`; one left there is ignored, so a plugin written for an older harness still loads.
- Each library Skill carries its own date version (`YYYY.MM.DD.N`) in its `SKILL.md` frontmatter, and a hook package carries `hooks.version` in `plugin.json`, which the installer writes into `hooks.json`. The loader keeps a Skill's own version when it stamps the short descriptions and the icon into the installable copy.
- Every part started at the date version its plugin carried before, so a copy installed by an earlier release compares equal and no update is offered after the upgrade.
- The Agent list's `pluginUpdates` compares each installed Skill and hook package with the library's same part, and reports a plugin once when any part is behind; its `version` is the newest date version among the plugin's parts. The organization runtime's per-employee plugin check answers with the same per-part pair.
- `scripts/check-plugin-versions.mjs` checks parts: a change under `plugins/<p>/skills/<s>/` needs that Skill's `version` raised, and a change to the hook scripts or the `hooks` commands needs `hooks.version` raised; `package.json`, `README.md`, `icon.svg` and the rest of `plugin.json` need nothing. It also refuses a `plugin.json` that keeps a top-level `version`, and a part started below the version its plugin carried at the base commit.
- The skill-porting Skill gives a ported Skill a date version in its frontmatter, in place of the natural number and the `updated` timestamp it used to write.

## The Plugins page

- The cards are grouped by category by default — the library's categories, then a new **Agent Sandbox** category for the sandbox backends, then Other. A row of small selects under the title switches the grouping ("Group by category", "Group by status", "Group by content" or "No grouping") and filters by category, content and status, beside the search box; each option says what it does on its own — unfiltered, the filters read "All categories", "Any content" and "All statuses", and a chosen value shows as its own name. It replaced the filter column and the separate "installed" and "available" lists. The browser remembers the grouping (`penguin.pluginsGroupBy`) and which sections are folded (`penguin.pluginsGroupsFolded`).
- The header's **Settings** button (admin only) takes the Agents page header's button look: the small rung, the gear before words that always show.
- Every plugin has the same card: its icon, name and short description, a line `v<npm version> · <status> · used by N agents`, and tags such as "built in", plus the category when the cards are grouped another way. The status is a tone icon with its word and a hover sentence: a plugin of Skills or hooks is installed when an agent in the Project has all of it (or a copy listed as behind), has an update when an agent is behind, and is available otherwise; a server module is installed when the server has installed and loaded it, and otherwise waits for a restart, failed to load, runs on other machines only, or is available.
- The four sandbox backends gained a `plugin.json` (descriptions, short descriptions, the `sandbox` category) and a shield `icon.svg`, both published with the package. The built-in index rows repeat them, and the listing takes them from the package itself when it is on the server.
- Installing or removing a server module, an admin's action, opens a confirm that names the plugin and says it goes on the whole server and is shared by every Project; that the agent runs in progress stop now sits under it in small type. A member sees the card and its details without those buttons.
- Every plugin's details open in a dialog: version, status and tags, an About section with the full description and the package's README when it ships one (a package not on this server says the README shows once installed), and, for a plugin with Skills or hooks, the file browser. The full-page `/plugins/registry/*` route was removed.
- The update dialog lists, for each agent, the Skills and hook package whose installed version differs from the library's, with both versions.
- The Settings dialog's sandbox card is titled **Agent Sandbox**, and the prompt that offers a backend reads "Install an Agent Sandbox backend" and says it goes on the whole server.

## API

- `GET /api/plugins/:plugin/readme` returns the `README.md` at a library plugin's package root, or 404 `readme_not_found`.
- `PluginItem.version` is the npm version; `PluginItem` gained `source` and `hookVersion`, and each Skill's `version` is its own.
- `PluginIndexEntry` gained the optional card fields `descriptionZh`, `shortDescription`, `shortDescriptionZh` and `icon`. Only the built-in index and a package on the server supply `icon`; the server drops it from every entry of a remote index, since the Web App inlines the SVG.
