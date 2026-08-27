# The Files panel refreshes after every turn, and SVG renders

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [#460](https://github.com/Prism-Shadow/penguin-harness/pull/460)

[中文版](2026-08-24-file-preview-svg-refresh.zh.md)

Three things were wrong with the Web App's Files panel: it went stale the moment the Agent
wrote anything, `.svg` was a broken image everywhere it appeared, and a Markdown file with an
SVG in it could shake without settling.

## The listing and the open file re-read when a turn settles

The panel refreshed on mount, on navigation, and when it went from hidden to visible — never
on the one event that changes a Workspace: a Task ending. It now re-reads on that edge (the
same active→idle transition that reloads the session and agent lists), and so does whatever
file is open in the preview: watching a file the Agent is editing is why the panel sits next
to the conversation.

A re-read leaves the user's own state alone — the rendered/source choice stays, the mobile
sheet does not jump — and a re-read that fails (the file was deleted mid-turn) keeps the
preview that is on screen instead of replacing it with "unsupported". Image and PDF previews
remount so the bytes are actually re-fetched, images inside a Markdown preview carry the read
number so a rewritten diagram repaints, and `/files/content` is now `Cache-Control: no-store`
— a Workspace path holds whatever the Agent last wrote to it.

## SVG renders again

Inline `/files/content` downgraded every scriptable type to `text/plain` as a same-origin XSS
defense, which covers HTML but also made every `.svg` — as a preview and as an `<img>` inside
a Markdown preview — a broken image. SVG now keeps `image/svg+xml` inline: an `<img>` never
runs an SVG's scripts. What the real type re-opens is a direct visit to that URL rendering it
as a same-origin document, and a `Content-Security-Policy: sandbox` (no `allow-scripts`, no
`allow-same-origin`) closes that — the sandbox directive is ignored for a subresource, so the
`<img>` path is unaffected. HTML keeps its plain-text downgrade. Benchmark case material,
which is browsed the same way, gets the same treatment.

## The shake

An SVG carries no pixel size, so its rendered height is whatever its width divides to — which
makes the preview's content height a function of whether a scrollbar is present. That closes a
loop: content overflows → the scrollbar takes width → the image shrinks → content fits → the
scrollbar goes → content overflows again, forever. The preview's scroll container now reserves
the gutter (`scrollbar-gutter: stable`), which breaks the feedback path; it is inert where
scrollbars are overlays.
