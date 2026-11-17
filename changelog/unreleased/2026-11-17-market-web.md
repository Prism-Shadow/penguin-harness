# The Plugins page becomes a market of cover cards, and a plugin's detail a product page

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`

[中文版](2026-11-17-market-web.zh.md)

The Web App's Plugins page (`/plugins`) now reads the plugin market's curation
(`GET /api/plugins/market`) and is laid out as a market: the selected carousel under the header,
a row of tabs, and a grid of cover cards, with a ranking beside the grid when the server sends
popularity figures. A plugin's detail is a product page in a large layer over the market, with
an address of its own.

## Details

- **Selected carousel**: the plugins the curation selects, in its order, one at a time with its
  cover, name, one line, description, "View details" and, for a plugin with a quick start, "Quick
  start"; a rail of every selected plugin's thumbnail under it. The plugin that leads changes by
  calendar day among those the curation allows to lead. It shows on the All tab with no search
  and without the incompatible-only filter; a server without the curation shows none.
- **Tabs**: All, then the groups of the chosen grouping (by category, by status, by contents; no
  tabs without a grouping). The tab is in the address (`?tab=<group>`). The grouping and a new
  sort select sit at the tab row's end, and take a line of their own above the tabs in a narrow
  window. The collapsible sections and their remembered folds are gone.
- **Sort** (remembered per browser): selected first (default), recently updated (the newest
  dated version among a plugin's Skills, hook package and workbenches; a server module's index
  update time), most used in this Project, name, and popular (all-time installs) while the
  server sends popularity figures.
- **Search** narrows the tab on show; when it finds nothing there but something in another tab,
  the empty line says how many plugins match across all of them and offers "Show all results".
- **Cover card**: the plugin's cover (the curation's picture through this server, else a cover
  drawn from its icon and hue), its name, its one line on two lines, the tags ("Selected" first
  for a selected plugin, the category on the All tab, "built in", where a module runs), and a
  facts line: `v<version>`, the status as its glyph and the number of Agents using it, their
  words on hover and for assistive technology, with the card's actions as glyph buttons at its
  end. In a phone-width column the card lies down.
- **Ranking**: when the server sends popularity figures, a panel beside the grid (under it in a
  narrow column) lists up to ten plugins on two tabs, Popular (all-time installs) and Rising
  (installs this week); a row opens that plugin's detail. Without figures there is no panel.
- **Detail**: a large layer over the market (the whole screen on a phone), opened from a card,
  the carousel or the ranking, and named in the address (`/plugins?plugin=<name>`): opening it
  adds a history entry, so Back closes it, and a pasted link opens it even when the tab or the
  search hides that card. Top to bottom: the hero (cover, icon, "Selected", name, package, one
  line, tags, the main actions — Open for a workbench installed on an Agent of this server, else
  Manage installs, then Update, Quick start, a module's Install or Remove, Repair — and a facts
  line), the screenshots (each opens large), then About with the README, What it installs (each
  Skill, hook point, MCP server and workbench), Quick start and MCP servers beside a column of
  the package's facts (version, category, author, licence, package with a copy button, links),
  and Files. Export and Delete stay in the footer. A server module this build cannot fully run
  says why under the hero.
- Grouped by contents, a package the index lists and this server does not have yet sits under
  what its index keywords name (`workbenches`, `skills`, `hooks`, `mcp`) instead of under Server
  modules.
- An Agent's settings show the same product page for a plugin, with that Agent's status and the
  market's cover.
- Browser storage: `penguin.pluginsSort` remembers the sort; `penguin.pluginsGroupsFolded` is no
  longer read.
- The UI package's `StatusMark` takes `wordless`: the glyph alone, its word leading the tooltip
  and kept for assistive technology. The component gallery's demo answers
  `GET /api/plugins/market` from the built-in curation with placeholder popularity figures, and
  its library lists the market's plugins in their real categories.
