# The gallery becomes a docs-style site you can click through

- **Date:** 2026-09-27
- **Type:** process
- **Scope:** `ui-gallery`, `ui`

[中文版](2026-09-27-gallery-docs-site.zh.md)

The component gallery was one long page of heavy cards, variant pills and drawers. It is now a home
page and one page per module, laid out like the product's documentation site, and the demos that are
about interaction can actually be used.

## The site

- The home page opens on a clickable app shell: a real-proportion window whose sidebar switches between
  Chat, Agents, Plugins, Models, Cost, Evaluation and Settings, built from the modules' own compositions.
  Sessions open, the sidebar folds to its rail, the composer takes a prompt and streams the scripted reply,
  and the dock's tabs switch. Below it, the modules are indexed by group.
- Each module has its own page at `/c/<module>`: a grouped navigation with search on the left, the module's
  title and one-line description, a section per variant, and Parts, Tokens and Source at the end, with an
  "On this page" list on the right. Compare across the three themes is per section.
- The top bar carries the theme (通用 / 白领 / 极客), accent, root size, language, viewport, compare and
  reduced-motion controls. At phone width the navigation moves into a drawer.

## Three kinds of demo

- **Animation** — a running process worth watching (a streaming reply, a run finishing, numbers counting
  up). It rests on its finished state and plays once when asked, as before.
- **Interactive** — the reader drives it: menus and dialogs open and close, the sidebar folds, the
  composer takes typing and sends, folders expand, the models table sorts and filters, forms validate.
  These no longer pretend with a timed scene; a Reset puts them back.
- **Still** — a single frame.

## Primer's group labels

The app's group labels (the Sessions label, time groups) are small uppercase tracked text; Primer's
eyebrow now reproduces them, so the gallery's sidebars read like the app's.
