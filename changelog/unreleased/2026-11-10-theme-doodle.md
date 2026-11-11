# A fourth theme, Doodle (卡通): Frost, hand-written

- **Date:** 2026-11-10
- **Type:** feat
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1531](https://github.com/Prism-Shadow/penguin-harness/pull/1531)

[中文版](2026-11-10-theme-doodle.zh.md)

Settings → Appearance offers a fourth theme, Doodle (卡通, `doodle`), after Frost, Console and Primer. It is the first pack built on Frost: the page keeps Frost's layout, spacing, motion, lineless activity rows and banded settings rows, and Doodle changes the paper, the hand and the pen.

## The look

- **Paper and ink.** A warm paper palette — paper `#f6f1e7`, the slip laid on it `#fcf9f2`, the pad a step darker; dark paper `#1c1a17` under a chalk ink — with a warm gray ramp, so the app's palette classes land on paper too. The theme's own accent is the ink; the ballpoint blue is kept for links, the focus ring and the selection. Five accent presets: marker, ballpoint, grass, crayon and grape.
- **The hand.** Shantell Sans for chrome and reading, LXGW WenKai GB Screen for Han, JetBrains Mono for code; a 14px body at the 16px root and bold titles.
- **The pen line, only where a hand goes.** A boxed button, a text field, a select trigger, a checkbox, a radio, a switch's track, the start page's Agent and Workspace pickers and the person's own message bubble are edged with one seeded pen line, their fill clipped to it. A focused field is redrawn in the ballpoint blue; a focused button shows the ring outside its line. What floats — a dialog, a menu, a popover, a tooltip, the composer and a toast — is a paper slip, its line and soft shadow in one image. Cards, tool cards, code blocks, tiles, notices, widgets and tables keep Frost's hairline or none.
- **Two drawings.** The spinner is a pencil scribble, and a page's empty state shows a small doodle above its title.
- In forced colours the pen goes and every host's own border, fill and focus ring return.

## The pack

- `packages/ui/src/themes/doodle/`: `pack.json` (`base: "modern"`), `tokens.css` with the groups Doodle changes (palette, type, shape, elevation, the shell's colours, the icon hues, the focus ring), `recipes.css`, `accents.css`, `fonts.css` and `index.css`. The registry, the three entry sheets, `fonts/index.css` and the Web App's dictionaries list it; the gallery's pack switcher and its Foundations pack table read its manifest.
- `scripts/draw-doodle-edges.mjs` draws the pen line from fixed seeds — the control, the bubble, the pill, the box and the ball, as `border-image` strokes and matching `clip-path: shape()` clips, and the slips' glass images — into the generated block of `recipes.css` (`--check` reports a stale block). `scripts/raster-strokes.mjs` renders the shapes a page shows by the dozen as small PNGs.

## Hooks

- `ui-edge`: the edge of what a person presses, types into or wrote. Hosts: `Button` (not ghost or link), `Input`, `Textarea`, `Select`, `OptionMenu`, `SearchInput`, `FormPickerTrigger`, `Checkbox`, `CheckboxBox`, `Radio`, `RadioDisc`, `Switch`, `MessageBubble`, `AgentSelect` and `WorkspaceSelect`.
- Five section hooks, theme-neutral anatomy no built-in pack styles yet but for Doodle's empty-state art: `ui-start` (the start page), `ui-library` (the model library), `ui-ledger` (the usage summary cards, `StatTile`, a Benchmark card's score), `ui-empty` (`EmptyState`, with an art slot drawn in the line set and as a doodle) and `ui-run` (the chat toolbar's run indicator, now `RunStatus`).
- The spinner draws an arc and a scribble, and theme.css shows the arc until a pack says otherwise. A filled chart mark carries its paint as `--_paint`, a swatch is a `swatch` part, and a Token kind's mark names its series. The open conversation's sidebar row says `aria-current="page"`.

## Faces

Shantell Sans arrives through `@fontsource-variable/shantell-sans` and is declared with the app's shared faces in `fonts/shantell-sans.css`. LXGW WenKai GB Screen 1.530 is vendored as the 48 slices of its web release that hold the GB2312 grid (2.8 MB) into the pack's `fonts/`, their faces as the pack's `fonts.css`, by `scripts/vendor-wenkai.mjs`, which pins the tarball's integrity; `vendored-fonts.json` lists it. So Doodle exports as a pack an import accepts: its `fonts.css` names only its own `fonts/*.woff2`. Both licences ship in `fonts/LICENSES/` and on the Credits page.

## Guards

- The cleanliness rules read a recipe's private custom properties through, so an image or a shape laid by `var(--_…)` is judged as written out; the control edge, a toast, the start page's brand block and an empty state's art slot joined R1's homes, and the control edge joined R8's boxed hosts. Doodle holds no hits.
- The contract suite reads a pack built on Frost through Frost's values, a Doodle suite holds its recipes to the drawings it declares in both modes, to `forced-colors: none` and to no filter, and the hooks guard knows the six new hooks.
