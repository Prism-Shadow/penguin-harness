# The left menu keeps three entries

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1660](https://github.com/Prism-Shadow/penguin-harness/pull/1660)

[中文版](2026-11-19-three-item-nav.zh.md)

The sidebar's fixed block is now New chat, Agents and App Center, and nothing else. The favourites (the star on each entry), dragging an entry and the fold under the favourites are gone. The update dots that sat on Models, Plugins and Cost Center now sit on App Center, then on the app's tile (design: [PRFC-0033](https://github.com/Prism-Shadow/penguin-harness-design/pull/496)).

## Details

- **Development mode.** The fixed block holds the three entries as plain rows, with no star, no drag and no fold. The collapsed rail shows the last conversation, New chat, Agents and App Center.
- **Company mode.** The organization's pages are plain rows at the top of the scroll area, above the channel list.
- **Update dots.** The plugin update, new preset model and unexpected error trails now share one dot on App Center, in the expanded sidebar and on the rail, and its hint joins their sentences with a semicolon. In the expanded sidebar that hint now shows on hover over the entry, as the rail's always did. In the App Center, the Plugins, Models and Cost Center tiles each carry their own dot and sentence, and a folder holding one of them carries the dot too. Each page's notice clears its trail as before, which takes the dot off App Center and off the tile. The Agents dot is unchanged.
- **Stored choices.** The favourites and fold choices an earlier version kept in the browser are no longer read. They stay in browser storage, where they do nothing.
- **UI package.** `SidebarNavGroup`, `SidebarDropTarget` and the star (`SidebarNavPin`) are removed. `SidebarNavEntry` is a nav row with an optional badge, `SidebarNavArea` is a plain run of rows, and `NavRow` no longer takes `draggable`.
