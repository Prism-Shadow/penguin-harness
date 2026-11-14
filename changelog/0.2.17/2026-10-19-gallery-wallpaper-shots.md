# The UI gallery screenshots and checks the app on a custom background

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `ui-gallery`
- **PR:** [#1230](https://github.com/Prism-Shadow/penguin-harness/pull/1230)

[中文版](2026-10-19-gallery-wallpaper-shots.zh.md)

The UI gallery's framed app can boot with a custom background and with a conversation's notices
raised. The screenshot script and a new browser spec use both to cover the message fills on a
custom background ([#1220](https://github.com/Prism-Shadow/penguin-harness/pull/1220)) and the
accent tint ([#1223](https://github.com/Prism-Shadow/penguin-harness/pull/1223)).

## Details

- The framed app (`app.html`) took two optional URL params. `wallpaper=<data URL>`, optionally
  with `wallpaperSettings=<JSON>`, seeds the custom background's storage keys before the app
  boots, as a browser that saved a background holds them. `notices=1` raises the initial-password
  banner and the context-window notice in the demo store. The gallery's own pages set neither, so
  their frames were unchanged.
- `scripts/shots.mjs` gained `--accents <list>` (in place of `--accent`, which still works),
  `--wallpaper off|on|both`, `--transparency` (default 25) and `--notices on|off`. With
  `--accents` or `--wallpaper`, each accent and background state is written to its own folder,
  `<theme>/<mode>/<lang>/<accent>/wallpaper-<off|on>/`; without them the flat layout is kept. The
  background is a small generated JPEG of strong, light and dark diagonal bands.
- A new browser spec, `e2e/wallpaper-fills.spec.mjs`, checks computed styles in eight cases: the
  translucent user bubble on a background in every theme, the notices and the approval band in
  each theme, the opaque tint without a background, a preset accent's hue in the wash, reduced
  transparency, and a toast in Frost that stays opaque.
