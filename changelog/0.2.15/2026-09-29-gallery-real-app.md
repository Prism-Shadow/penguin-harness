# The gallery frames the real Web App

- **Date:** 2026-09-29
- **Type:** process
- **Scope:** `ui-gallery`, `ui`, `web`, `landing`
- **PR:** [#892](https://github.com/Prism-Shadow/penguin-harness/pull/892)

[中文版](2026-09-29-gallery-real-app.zh.md)

The gallery used to rebuild the app's screens from stand-in compositions, which drifted from the real interface. It now mounts the Web App itself in a frame, against an in-browser demo API, and is still a static site with no server.

## What the gallery shows

- The home page is the real app, fully clickable. Each surface — conversations (idle, running, thinking, waiting for approval), a new conversation, agents and their settings, schedules, the plugin marketplace, models, machines, cost, evaluation, settings (including Appearance) and sign-in — has its own page.
- The demo data covers a signed-in admin, a Project with agents and Sessions, running tool calls and thinking, models from the built-in catalog, plugins, usage, benchmarks and schedules, in English and Chinese. Sending a message streams a scripted reply; actions that need a real server answer with a read-only notice. The terminal is not available.
- The top bar keeps to one row: theme, language and mode sit in it, and accent, text size, the labelled Latin and CJK font pickers and the viewport sit in a popover. They drive the framed app through the same preferences the app reads, and the popover names the Latin, CJK and monospaced faces actually rendering and the text size in pixels.
- Its pickers and hints follow the app's own select and tooltip, and its dark mode shares one neutral palette with the landing site.

## Sections

- The site has four sections — Home, Surfaces, Foundations and Fonts — each with its own navigation. Surfaces opens straight onto the conversation page.
- Foundations is a component library: one page per topic (buttons, inputs, pickers, toasts, notices, dialogs, tooltips, tabs, badges, empty states, loading, charts, avatars, files, and the colour, type, shape, density, focus, motion, icon and hook boards), each rendering the Web App's own components in a themed frame.
- Fonts lists each theme's default Latin, CJK and monospaced faces, the current pairing and the licences.

## Details

- A Foundations frame grows to hold whatever is open in it — a select panel, a menu, a tooltip, a toast or a dialog — and shrinks back when it closes, so nothing is clipped.
- The stand-in modules, screens, hero and fixtures in `packages/ui` are removed, along with the gallery's `/embed` and `/screens` routes; the Foundations boards and the fonts page stay.
- The Web App gained two small seams for this: `App` takes an optional initial route, and the Settings dialog can be opened on a given page by request.
