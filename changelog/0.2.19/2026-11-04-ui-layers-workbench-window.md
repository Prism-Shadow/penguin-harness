# A workbench tab is a window beside Chat, see-through, on one layer scale

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `ui`, `web`, `ui-gallery`, `skills`, `docs`
- **PR:** [#1472](https://github.com/Prism-Shadow/penguin-harness/pull/1472)

[中文版](2026-11-04-ui-layers-workbench-window.zh.md)

The chat page's tab strip now switches between two sibling windows in the area below it: Chat (the toolbar, the transcript, the composer and the docks) and the workbench tab's page. Nothing of Chat can show over a workbench any more, the page can be transparent, and every z-index in the Web App, the UI package and the gallery is a named layer of one scale.

## Windows

- The docks belong to the Chat window. While a workbench tab is shown, Chat stays mounted and laid out but is neither drawn nor reachable by pointer, keyboard focus or assistive technology, and coming back to Chat finds its docks, sizes, scroll and typed text as they were. The page takes the whole area below the strip, also when the strip carries a workbench's notice.
- The built-in browser's page, laid over its dock slot from outside the window, now leaves the slot while a workbench tab is shown, and is cut where a dock lifted to fullscreen covers it.
- A dock shortcut pressed on a workbench tab (the right or bottom dock's toggle, the terminal's toggle, a new terminal) switches to Chat first, then does what it does there.
- Find in page no longer searches a conversation hidden under a workbench tab or inside a closed dock.
- The toolbar's details card and conversation index open on top of a dock lifted to fullscreen; they used to open under it. The details card closes when its Stop asks for confirmation.

## The page shows the app's surface

- A workbench page that paints no background of its own is transparent: the theme's page colour, the Frost sheet or the user's wallpaper shows through it as it does under the conversation. The frame takes the app's light or dark color scheme, so the browser paints no opaque canvas behind it.
- A page that sets its own background keeps it. `--wb-canvas`, a new name in `/workbench-ui.css`, is the app's opaque page colour for a page that wants a solid sheet (`body { background: var(--wb-canvas); }`); a TSX page uses `var(--ui-canvas)`.
- The full-page workbench paints the theme's canvas instead of a fixed white or black.
- The `penguin-plugin` Skill (2026.11.04.1) and the docs' workbench section say so.

## One layer scale

- `packages/ui/src/layers.css` declares the layers in paint order: `behind`, `sticky`, `sticky-head`, `raised`, `handle`, `window-overlay`, `dock`, `dock-handle`, `menu`, `modal`, `popover`, `toast`, `tooltip`, `drag-preview`, as `--layer-*` properties and `z-<layer>` utilities; `layer("<name>")` names one in an inline style.
- Every window (Chat, a Workbench window, the full-page workbench) is its own stacking context, and every overlay is portaled to `document.body` above them.
- Every z-index in `packages/web/src`, `packages/ui/src` and the gallery's chrome names a layer, and the UI package's `layer-scale` test fails on a raw value or an undeclared name.
