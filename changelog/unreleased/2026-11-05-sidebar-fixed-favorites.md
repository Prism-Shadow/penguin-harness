# Favorited sidebar entries stay put, and company-mode entries can be favorited

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1498](https://github.com/Prism-Shadow/penguin-harness/pull/1498)

[中文版](2026-11-05-sidebar-fixed-favorites.zh.md)

New chat and the favorite page entries moved into one fixed block under the Project or
organization switcher, and they no longer scroll away with the conversation list. The collapsible
entries and their fold bar still scroll with the list. Company mode's entries, including the
company-mode pages plugins add, can be favorited the same way.

## Details

- At rest every nav row is spaced the same, across the edge of the fixed block too. The extra gaps
  under New chat and under the last favorite are gone.
- Once the list is scrolled away from its top, a thin line in the theme's divider color marks
  where the fixed block ends. In company mode with no favorites, it marks the gap under the
  switcher. The line clears at the top again and moves nothing when it shows.
- When a window or the phone drawer is too short for both, the list keeps room for a few rows and
  the fixed block scrolls its own rows instead.
- In company mode the star, dragging between the areas, keyboard focus following a moved entry
  and the fold work as they do in development mode. No entry is a favorite by default, so the
  sidebar looks as before until one is starred.
- Company mode's choices are saved per browser in `penguin.sidebarModeNavPinned.company`, apart
  from development mode's `penguin.sidebarNavPinned`, so a star in one mode never moves an entry in
  the other.
- Before there is an organization, the six company entries stay disabled and show no star; each
  sits in the area its saved choice puts it in.
- The collapsed rail did not change.
- In the UI package, `SidebarFrame`'s `pinned` slot holds New chat and the favorites and never
  scrolls. `SidebarNavGroup` no longer takes `pinned` entries, and draws nothing when there is
  nothing to fold.
