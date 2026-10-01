# Primer's blacks, whites and grays become pure neutral

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-09-30-primer-neutral-grays.zh.md)

In light mode, Primer (通用), the default theme, had used Tailwind's stock gray scale. That scale has a slate tint (hue about 264), which made its blacks and grays look off. Following the owner's reference, the zero-chroma grays of turborepo.dev (Vercel's Geist), Primer's blacks, whites and grays became pure neutral, with zero hue, in both modes. Every gray stayed on its step, and only the tint was removed.

## Details

- In light mode, the gray scale behind Primer's tokens and the Web App's `gray-*` classes moved to Tailwind's `neutral` scale, step for step: `gray-50` went from `#f9fafb` to `#fafafa`, `gray-200` from `#e5e7eb` to `#e5e5e5`, `gray-500` from `#6a7282` to `#737373` and `gray-900` from `#101828` to `#171717`, and the other steps followed. The sidebar fill, the lines, and the body, muted and subtle inks changed with it.
- Primer's own accent, which the "Theme's own" swatch paints, went from `#111827` to `#171717` in light mode and from `#f3f4f6` to `#f5f5f5` in dark mode. Its hover, pressed, wash and outline colours, and its label ink in dark mode, moved to the matching neutral steps.
- The focus ring and the scrollbar thumb had kept a faint blue tint. Both were made neutral in both modes.
- Dark mode's grays were already neutral, and their values and contrast stayed the same. The status tones, the chart colours and the five accent presets did not change.
