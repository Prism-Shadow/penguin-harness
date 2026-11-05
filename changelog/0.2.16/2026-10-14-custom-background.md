# Custom background images

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1126](https://github.com/Prism-Shadow/penguin-harness/pull/1126)

[中文](./2026-10-14-custom-background.zh.md)

Settings → Appearance now accepts a local background image. Choosing an image reveals a preview, transparency slider, display mode and alignment controls. Changes apply immediately and persist in this browser or desktop app.

## Controls

- Cover, fit, tile or display the image at its stored size, with nine alignment positions.
- Replace or remove the image from the same row. Removing it restores the theme's background.
- The navigation column and mobile menu bar blur the wallpaper behind a translucent surface. Reduced-transparency preferences keep these surfaces opaque.
- Chat and browser toolbars reveal the wallpaper. Cards, tables and statistics share a light surface, including the start page and machine list. Maximized panels preserve the same background.
- Running, thinking and tool-call rows have no background fill and scroll with their content when wallpaper is enabled. Timeline labels stay clear while zoomed bars are clipped before reaching the label column.
- Search fields, secondary buttons, dock tabs and segmented filters share translucent control fills and subtle hover feedback. Home-page Agent and Workspace selectors follow the same rule. Machine, Agent, model, plugin, usage and benchmark cards share the UI card surface; grouped plugin rows do not stack another fill.
- The background preview joins the surrounding settings rows without extra inner corners.
- PNG, JPEG and WebP files up to 20 MB are resized and compressed locally. Images are never uploaded; dialogs, editors and terminals retain their own surfaces.
