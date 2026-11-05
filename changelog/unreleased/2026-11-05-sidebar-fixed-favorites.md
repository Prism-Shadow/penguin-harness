# Favorited sidebar entries stay put, and company-mode entries can be favorited

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `web`, `ui`

[中文版](2026-11-05-sidebar-fixed-favorites.zh.md)

New chat and the favorite page entries moved into one fixed block under the Project or
organization switcher, and they no longer scroll away with the conversation list. The collapsible
entries and their fold bar still scroll with the list. Company mode's six entries can be favorited
the same way.

## Details

- The rows in the fixed block are spaced like the rows in the fold. The extra gap under New chat
  is gone, and the gap between the block and the list is unchanged.
- When a window or the phone drawer is too short for both, the list keeps room for a few rows and
  the fixed block scrolls its own rows instead.
- In company mode the star, dragging between the areas, keyboard focus following a moved entry
  and the fold work as they do in development mode. No entry is a favorite by default, so the
  sidebar looks as before until one is starred.
- Company mode's choices are saved per browser in `penguin.sidebarCompanyNavPinned`, apart from
  development mode's `penguin.sidebarNavPinned`, so a star in one mode never moves an entry in the
  other.
- Before there is an organization, the six company entries stay disabled and show no star; each
  sits in the area its saved choice puts it in.
- The collapsed rail did not change.
- In the UI package, `SidebarFrame`'s `pinned` slot holds New chat and the favorites and never
  scrolls. `SidebarNavGroup` no longer takes `pinned` entries, and draws nothing when there is
  nothing to fold.
