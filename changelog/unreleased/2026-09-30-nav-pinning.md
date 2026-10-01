# Sidebar entries share one set of names and one order, and each is pinned or collapsible

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `web`, `ui`, `docs`
- **PR:** [#909](https://github.com/Prism-Shadow/penguin-harness/pull/909)

[中文版](2026-09-30-nav-pinning.zh.md)

The sidebar's nav entries got one set of names and one order in both languages. Every page entry
became either pinned or collapsible, and the chevron under the nav folds only the collapsible ones.
New chat is the exception: it is always pinned.

## Names and order

- The entries read 新建对话 · 智能体 · 模型库 · 插件市场 · 机器管理 · 成本中心 · 评估中心 in Chinese
  and New chat · Agents · Models · Plugins · Machines · Cost Center · Evaluation Center in English.
  Models moved ahead of Plugins in the page manifest. The Chinese Machines entry changed from 机器
  to 机器管理, and so did the Machines page heading and the one message that names the page. The
  chat page's empty-state button changed from 新对话 to 新建对话, the name of the nav entry it
  repeats.
- The collapsed rail builds its page icons from the same manifest. It follows the new order and
  shows Machines to admins, which it had left out.

## Pinned and collapsible entries

- New chat, Agents, Models and Plugins are pinned by default. Machines, Cost Center and Evaluation
  Center are collapsible, and the collapsible area starts expanded. Each area keeps manifest
  order, and with nothing collapsible the chevron is hidden.
- A pin button appears at the end of a row on hover or keyboard focus, and always on touch
  screens. It is filled while the entry is pinned, and its tooltip reads **Pin** or **Unpin**.
  Dragging a row into or out of the collapsible area does the same.
- New chat keeps its fixed slot above the scroll area; it has no pin button and cannot be dragged.
- The choices are saved per browser in `penguin.sidebarNavPinned`, as the entries whose state
  differs from the default. A key the manifest does not know is ignored, so a page with no stored
  choice takes its default. A folded state already stored in `penguin.sidebarNavGroupCollapsed`
  keeps folding, now only the collapsible area.
- Company mode's six entries still fold as one group, with no pins.
- The pieces are the UI package's: `SidebarNavGroup` takes the pinned entries above its fold, a
  drop target for the fold and a way to leave the fold out, `SidebarNavArea` is a run of pinned
  entries that takes a drop, and `SidebarNavEntry` is a `NavRow` with the pin toggle and the drag
  handle. `NavRow` gains `groupHover` and `draggable={false}` for a row inside such an entry.
- The docs' Web App page describes the entries, the pins and the Machines row (admins only).
