# A local component gallery renders the shared UI package in every theme

- **Date:** 2026-09-16
- **Type:** process
- **Scope:** `ui-gallery`, `ui`, `tooling`, `ci`
- **PR:** [#764](https://github.com/Prism-Shadow/penguin-harness/pull/764)

[中文版](2026-09-16-theme-gallery.zh.md)

A new private package, `@prismshadow/penguin-ui-gallery`, is a Vite + React app that shows the shared UI
package in each of the three themes (Primer, Frost, Console), light and dark, at the 16 / 18 / 20 px root
sizes and in English and Chinese. It is a local dev tool started with `pnpm dev:gallery` on port 7372 and
never ships with the product. Nothing in the Web App changed.

## The gallery

- One long page of fifteen modules — Foundations, Conversation, Composer, Sidebar & navigation, Buttons &
  actions, Status & feedback, Forms, Overlays, Tables & lists, Stats & charts, Markdown & code, Files &
  trees, Pages & sections, Company board, Screens. Each module is one realistic composition built from the
  shared fixtures (a docs-expert Session, English and Chinese) with three to five variants; its header
  carries the title and a sentence, and its card carries the variant pills and a quotable breadcrumb such
  as `Frost › Conversation › Approval · dark · zh`.
- A sticky rail switches theme, mode, root size and language, toggles compare and reduced motion, and
  lists the modules. Compare shows the three themes at once: side by side for a narrow module, stacked at
  full width for a wide one. `compare=<module>` compares a single module while the rest of the page stays
  single.
- Every view is addressable. The URL carries the theme, mode, size, language and each module's variant
  pick; `/embed?module=<id>&variant=<key>` renders one composition alone, and `/embed?demo=<part-id>`
  still renders one part.
- Each module has three drawers: its parts (the component demos that exist, and one line per planned
  component with its wave and the web code it replaces), the tokens the composition actually reads
  (resolved in the active theme and mode, with their WCAG ratios), and the module's own source.
- Foundations is a module as well: the palette, the type scale in English and Chinese, shape and depth,
  the rhythm steps, the icon registry at the theme's stroke, motion, focus and selection, and the six
  style hooks on the markup their recipes select on.
- `/screens/<name>` shows the full-page composites from `packages/ui/src/screens`, and `/fonts` lists each
  theme's families, every declared face grouped per family and weight with its slice count and load
  status, and the licence texts.
- Chrome copy is in English and Chinese, local to the gallery. The chrome styles only itself: its
  rules are scoped to `.g-chrome`, so a preview's inline code and text selection are the theme's,
  on the page, in the compare frames and in every screenshot alike. The preview frame reads the
  contract tokens with no fallback, so a dropped token looks broken where the themes are judged.
- The tokens drawer says what it measured: a composition that never mounted and rules it could not
  read are both named, rather than reading as a thrifty composition or as "still resolving".

## Package additions

- `packages/ui/src/module.ts` defines the module contract (`defineModule`, `MODULE_IDS`), and
  `packages/ui/src/modules/*.module.tsx` holds the thirteen compositions the package owns — the gallery
  owns Foundations and Screens, which are made of its own machinery. `packages/ui/src/catalog.ts` files
  every component section under its module, and `packages/ui/src/demo.ts` defines the demo contract
  (`defineDemo`).
- The compositions carry no data of their own: every word and number comes from
  `packages/ui/src/fixtures/`, which gains what they need beyond the sets the screens already use —
  the citation test failing, the Task's to-do list, the slash menu, a docs answer, the plugin
  library's totals, the group chat, the dock's panel menu, the dialog form's search and choice
  groups, and the chrome copy of the pages they imitate.

## Tooling

- `pnpm --filter @prismshadow/penguin-ui-gallery shots` photographs modules × variants × themes × modes ×
  languages through `/embed`, with `--parts` for the atomic demos. It fails the run when a family the
  theme names has no loaded face, and `shots.mjs diff <before> <after>` compares two runs pixel by pixel.
- The root `pnpm dev:gallery` script starts the gallery; the manual-test skill lists it; CI runs the
  gallery's unit tests in the `rest` shard, and `pnpm -r build` builds it.
- `shots.mjs` validates every axis it is given against the values `/embed` understands, and fails
  the run — rather than writing a convincing set under the wrong name — on an unknown theme, mode,
  language or tier, and on a module that does not render.

## Guards

- `packages/ui/test/app-source-scope.test.ts` holds the Web App's Tailwind sources to the package:
  every directory under `packages/ui/src` is either shipped with the app or excluded from its
  scan, so a new gallery-only directory cannot slip its class names into the app's stylesheet.
- The gallery's own suites gained the walk behind the tokens drawer, the accent presets the Colour
  board reads out of `theme.css`, the axis value that would collide with the matrix's key, and a
  render of every module variant — the last one fails if two variants ever draw the same thing.
