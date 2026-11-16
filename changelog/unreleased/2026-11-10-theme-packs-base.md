# Every theme is a pack over Frost, and the three themes are pack folders

- **Date:** 2026-11-10
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1527](https://github.com/Prism-Shadow/penguin-harness/pull/1527)
- **Breaking:** yes — `@prismshadow/penguin-ui`: Frost's look needs `data-theme-base="modern"` beside `data-theme`, a root without `data-theme` paints Frost rather than Primer, and `DEFAULT_THEME_ID` is gone

[中文版](2026-11-10-theme-packs-base.zh.md)

Frost (白领, `modern`) became the base every theme builds on, and Primer, Console and Frost became the first three theme packs. Nothing on screen changed in any of the three themes, in either mode or language.

## The base

- Frost's token values moved to the bare `:root` / `:root.dark`, and its hook recipes key on `:root[data-theme-base="modern"]`. Both sit in a new cascade layer, `ui-base`, under every other pack's `ui-theme`, so a pack's declaration wins by layer and a name a pack leaves out shows Frost's.
- `theme.css` names the four layers — `ui-base, ui-theme, ui-accent, ui-font` — before anything it imports. The foundation's defaults (the eyebrow and display rules, the notice inks, the tree's depth ladder, the glyph set, the stream veil) moved from `ui-theme` to `ui-base`, and so did the tone-strip rule for a custom background, which left `wallpaper.css`.
- `data-theme` is always written, Primer's included, and `data-theme-base="modern"` goes beside it for a pack built on Frost. `DEFAULT_THEME_ID` folded into `INITIAL_THEME_ID`, which names both the theme a browser starts in and the base. `applyThemeAttributes` writes both attributes from the id; the Workbench frame copies `data-theme-base` too.

## Pack folders

- Each theme is a folder `packages/ui/src/themes/<id>/`: `pack.json` (theme API, id, names, version, base, modes, swatches, own accent and presets, fonts), `tokens.css`, `recipes.css` (Primer has none), `accents.css`, `fonts.css` and an `index.css` that serves each file in its layer. The pack files carry no `@layer` of their own. Primer and Console say `base: "foundation"`; Frost says `base: "modern"`.
- The theme font sheets moved into their packs as `fonts.css`; `fonts/index.css` still declares every face, and MiSans's slices stay under `fonts/misans/`.
- `themes/index.ts` is the registry: `BUILTIN_PACKS`, `builtinPack`, `isThemeId` and `THEME_API = 1`. `THEME_IDS`, `ACCENT_PRESETS`, `THEME_ACCENT_PRESETS`, `ACCENT_PRESET_IDS`, `THEME_OWN_ACCENTS` and `THEME_FONTS` are read from the manifests with the shapes they had; an accent preset id is now typed as a string.
- The Web App, the gallery and the published `styles.css` import `themes/<id>/index.css` for each built-in pack, Frost first.

## The first frame

The boot script writes `data-theme` and `data-theme-base` for every theme. For a stored id the build does not ship, it looks the id up in `penguin.themePacks`, the browser's copy of the server's imported packs, and when the entry checks out — a pack id, a theme API this build implements, a digest version — it writes the pack's stylesheet link during parsing and accepts the pack's presets. Nothing writes that key yet. `readCachedThemePack` and `themePackHref` give the provider the same reading. The gallery's static frames inline `STATIC_BOOT_SCRIPT`, the same script without the cached-pack branch: the static site has no theme server to link a pack from.

## Guards

- The contract test reads every pack folder: the base and every pack on the foundation alone declare every name in both modes, a pack built on Frost may declare only contract names, and each manifest agrees with its CSS — presets, own accent, swatches and faces.
- A new test checks that `theme.css` names the layers first, that no other stylesheet opens `ui-base` or `ui-theme`, and that the built `dist/styles.css` opens the four layers in cascade order.
- The cleanliness rules R1, R2 and R5–R11 run over every pack folder; the built-in packs are held to the hits they have today, and any other pack to none.
- The contrast, avatar, badge, icon-stroke and de-slop suites read the packs, with Frost as the fallback.

## Compatibility

Stored choices are untouched: `penguin.themeId` and `ui_prefs.themeId` keep their values, and an id the build does not ship still reads as Frost without being rewritten. The break is for a page that uses the published `@prismshadow/penguin-ui` stylesheet on its own: a root without `data-theme` now paints Frost's values, and Frost's frosted layers, lineless activity rows and banded settings rows need `data-theme-base="modern"` beside `data-theme="modern"`. `applyThemeAttributes` writes both; a page that sets the attributes by hand adds the second one. `DEFAULT_THEME_ID` is no longer exported; read `INITIAL_THEME_ID`.
