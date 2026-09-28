# The three themes look like three themes, and the gallery plays interactions on demand

- **Date:** 2026-09-19
- **Type:** process
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#795](https://github.com/Prism-Shadow/penguin-harness/pull/795)

[中文版](2026-09-19-theme-identities-live-gallery.zh.md)

Frost and Console were redesigned so that the three themes no longer share one silhouette, and the
component gallery gained live variants that play an interaction frame by frame in every theme. Primer is
unchanged pixel for pixel, and so is the Web App, which renders only Primer until the theme switcher
opens.

## Themes

- Sizes are no longer shared across themes. A new space-unit token is bridged to Tailwind's `--spacing`,
  so every spacing and size utility scales with the theme: Primer keeps the stock 0.25rem, Frost is
  roomier (0.28rem, a 15px body) and Console denser (0.225rem, a 13px body). `text-sm` and `text-xs`
  follow each theme's body and small rungs.
- Frost takes Sierra's colour field back: a warm field behind the app window, the navigation column
  on the field and the main column as a floating rounded sheet, generous box radii, pill controls and
  regular-weight large titles.
- Console becomes a monospaced interface in the manner of opencode.ai: navigation, buttons, labels,
  headings, badges and tables are set in Commit Mono, while reading surfaces (message text, answer
  Markdown, the composer's input) stay in IBM Plex Sans. Paper-white and warm near-black modes, the
  orange accent, square corners, a ruled full-bleed window with a `>` before the selected navigation
  row, and boxes whose head title sits in the top rule.
- A seventh style hook, `ui-shell`, carries the app window (`data-slot="nav"` / `"main"`); its only
  host is `AppShell`. A new `--ui-font-ui` token is the face of the chrome (`body` reads it), beside
  `--ui-font-sans` for reading.
- The token contract grew from 188 to 210 names: the shell group, `--ui-font-ui`, the space unit, and
  eleven motion tokens for entering, leaving, revealing and resizing.

## Motion

- Components declare motion with four data attributes — `data-presence` with `data-side`,
  `data-backdrop`, `data-reveal` and `data-layout-motion` — and `theme.css` animates them from the
  theme's tokens: Primer fades with a 4px slide, Frost springs in from 0.96 with a blur that clears and
  streams text in word by word, Console steps with no fade. Reduced motion shows every end state at
  once.

## Gallery

- Six modules gained a live variant: Streaming reply (conversation), Type and send (composer),
  Collapse and expand (navigation), Open and close (overlays: menu, dialog, toast), Run to finish
  (status) and Expand a folder (files). Each is a list of frames the card plays on a clock and loops.
- A card autoplays while it is on screen. Its foot carries a transport: play and pause, restart,
  previous and next frame, frame chips that jump, and 0.5× / 1× / 2×. In compare mode the three
  themes share the card's clock, so they show the same frame at the same moment.
- `/embed?module=&variant=&frame=&play=` addresses a frame. By default a live variant is paused on its
  last frame. Screenshots of a live variant are named `<module>--<variant>@<frame>.png`, one per frame
  with `--variants all`. A paused card's breadcrumb names its frame.
- The Foundations Motion board replays each motion specimen, and the Density and Shape boards show the
  space unit and the shell.

## Themes, round 2

- Three structure hooks make the themes differ in how a surface is organised, not only in colour:
  `ui-icon-decor` (an icon its label already says — Primer keeps it monochrome, Frost colours it by
  role, Console drops it, so Console shows far fewer icons), `ui-tree` (rows that nest — Primer's
  bordered box, a soft guide inside Frost's card, and in Console no box at all, just `└`/`├`
  connectors drawn in CSS) and `ui-field` (a labelled control row — Primer as today, Frost with the
  label above a full-width control, Console as a tabular row with a fixed label column). Ten hooks now.
- Each theme lists its own accent presets: Primer keeps `blue / green / violet / rose / amber` with
  today's values, Frost adds five warm muted hues and Console five terminal ones. A stored preset the
  active theme does not list paints nothing — the theme's own accent stands in — and comes back when
  the reader returns to a theme that lists it, so no stored preference is lost.
- The contract is 215 names: a structure group carries the tree ladder, its guide colour and the
  field's label column and gap.
- The themes have Chinese names: 通用 (Primer), 白领 (Frost), 极客 (Console). The ids are unchanged.

## The gallery, redesigned

- **Nothing plays until you ask.** A scene now belongs to the variant it ends in, and a card rests on
  its settled frame. Play runs it once and stops; the `live-*` variants are gone, folded into the
  static ones. Every module's default variant carries a scene.
- The page opens with a **hero** — the product line, a pitch, two buttons and a full app window in the
  current theme, which answers clicks (sessions, dock tabs, the composer) and plays its own scene. It
  lives in the UI package, so the landing page can import it.
- Four new modules: Hero, Dialogs & confirmation, Create with AI, and Empty states & onboarding —
  nineteen in all. The dialog sections moved out of Overlays.
- The rail carries the controls the app has: theme (by its Chinese name in Chinese), mode, **accent**
  (the active theme's own presets, painted in their colours), **root size** (16 / 18 / 20 px, the real
  root font size), language, viewport, compare and reduced motion. `accent=` and `view=` join the URL.
- **Phone width works twice over**: `view=phone` renders any module in a 390px frame, and the gallery
  itself folds its rail into a top-bar drawer, goes single column and never scrolls sideways.

## The gallery, at the app's size

- **App regions render at the app's width.** A module that imitates part of the app window declares
  the width it is designed at (`viewport` in `module.ts`): 1280px for a whole window (Sidebar & navigation,
  Hero), 956px for what fills its main column (Conversation, Composer, Pages, Company board, Dialogs,
  Empty states, Create with AI, Overlays, Files). The card lays the composition out at that width and
  scales the picture down to fit, so it wraps and truncates as the app does. `/embed` and the
  screenshots show it at that width unscaled; the phone view keeps its 390px frame.
- **The stand-ins follow the app.** The sidebar leads with the collapse button and the Project
  switcher, and carries the app's nav labels (新建对话, 插件市场), no counts, the Sessions header with
  its three controls, Workspace groups, the running hourglass, and the user row with the role. The
  chat header, the composer's control row (`+`, approval mode, Skills with its count, the slash hint,
  the context gauge, thinking level, model, send), the stats line and the dock's labels match the app,
  and the chat without a right dock shows the 快捷方式 launcher ball. The Pages module is the real
  Plugins page and the Agents page with its create pair; page titles, the Files panel and company copy
  use the app's words.
- A guard test pins every label the gallery shares with the app to the app's own dictionaries
  (`packages/web/src/lib/strings.ts` and `strings-en.ts`), in both languages.
- `/screens/<name>` puts its toolbar in a strip above the composite instead of floating it over the
  composer.
