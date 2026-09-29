# Text-size setting compatibility

- **Date:** 2026-09-29
- **Type:** process
- **Scope:** `web`, `ui`

[中文版](2026-09-29-backward-compatibility.zh.md)

The [theme switching change](2026-09-29-theme-switching.md) replaced the three-step font size, stored per browser under `penguin.fontScale`, with five text sizes stored under `penguin.textSize`.

## Existing settings

- A stored choice carries over by pixels: `sm` (16px) became M, `md` (18px) became L and `lg` (20px) became XL, so everyone who picked a size sees the same size as before.
- A browser that never picked a size gets the new default, M (16px); it used to get 18px.
- The old value is read once, before the first paint, written under the new key and removed. Nobody needs to do anything by hand.

## Removal schedule

The read of `penguin.fontScale` — in the pre-paint boot script and in `readTextSize` (`@prismshadow/penguin-ui/boot`) — can be removed in the next minor version, by the release that prepares it. A browser that has not opened the app by then starts at the default size.
