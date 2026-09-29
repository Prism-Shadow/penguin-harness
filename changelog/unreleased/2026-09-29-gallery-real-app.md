# The gallery frames the real Web App

- **Date:** 2026-09-29
- **Type:** process
- **Scope:** `ui-gallery`, `ui`, `web`

[中文版](2026-09-29-gallery-real-app.zh.md)

The gallery used to rebuild the app's screens from stand-in compositions, which drifted from the real interface. It now mounts the Web App itself in a frame, against an in-browser demo API, and is still a static site with no server.

## What the gallery shows

- The home page is the real app, fully clickable. Each surface — conversations (idle, running, thinking, waiting for approval), a new conversation, agents and their settings, schedules, the plugin marketplace, models, machines, cost, evaluation, settings (including Appearance) and sign-in — has its own page, with a three-theme comparison.
- The demo data covers a signed-in admin, a Project with agents and Sessions, running tool calls and thinking, models from the built-in catalog, plugins, usage, benchmarks and schedules, in English and Chinese. Sending a message streams a scripted reply; actions that need a real server answer with a read-only notice. The terminal is not available.
- The top bar's theme, mode, accent, text size, font pairing, language and viewport controls drive the framed app through the same preferences the app reads, and the top bar states the Latin, CJK and monospaced families in use and the text size in pixels.

## Details

- The stand-in modules, screens, hero and fixtures in `packages/ui` are removed, along with the gallery's `/embed` and `/screens` routes; the Foundations boards and the fonts page stay.
- The Web App gained two small seams for this: `App` takes an optional initial route, and the Settings dialog can be opened on a given page by request.
