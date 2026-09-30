# Frost and Console polish: folds, banners, tabs, the streaming veil and the list heading

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `ui`, `web`

[中文版](2026-09-30-theme-polish-r11.zh.md)

A round of fixes to the Frost and Console themes, plus one change for every theme.

## Changes

- **Folds:** the transcript's work groups, thinking rows and tool rows fold differently per theme.
  - Frost puts the chevron right after the row's words.
  - Console drops the chevron: the leading status mark is the fold, ▸ closed and ▾ open, in the row's state colour. A running row keeps its spinner.
  - Primer keeps the chevron at the row's far edge.
- **Banners:** in Frost, an edge-to-edge notice such as the initial-password banner is drawn as a card set in from the column's edges, so its rounded corners no longer butt against the edges and the header.
- **Tabs:** Frost and Console show only their own marker under the selected tab. The agent settings tabs no longer show a second, dark underline.
- **Streaming:** Frost's fade-in veil covers only about the newest line and a half, washes more lightly, and glows without colour. Text already received always reads at full ink.
- **Session list:** its heading follows the grouping: Workspaces, Agents, or Recent.
