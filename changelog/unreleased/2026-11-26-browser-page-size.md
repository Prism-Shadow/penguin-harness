# The agent browser's page size can be set, and the page really changes

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `browser-automation`, `browser-extension`, `cli`, `web`
- **PR:** [#1923](https://github.com/Prism-Shadow/penguin-harness/pull/1923)

[中文版](2026-11-26-browser-page-size.zh.md)

A tab of the agent browser can now be given a fixed page size by the user and by the Agent, and
the page is really laid out at that size instead of only being emulated for a screenshot.

## Details

- `penguin browser resize <w>x<h> [--scale <n>]` gives the tab a fixed page size from 200 to 4096 CSS
  pixels, with an optional device pixel ratio from 1 to 4. `penguin browser resize --fit` returns
  it to the Browser panel's size, and `penguin browser resize` alone prints the size the page
  reports. The command answers once the page reports the new size, so a screenshot taken right
  after is at that size. The route is `POST /api/builtin-browser/tabs/:tab/viewport`.
- In the built-in browser, the page's `<webview>` is laid out at the fixed size, both on screen
  and parked, and is scaled down to fit the Browser panel, centred and never enlarged. The pixel
  ratio is the only device-metrics override.
- The Browser panel's tool row has a page size button. Its menu offers Fit to panel, 1280 × 800,
  1440 × 900, 1920 × 1080 and Custom size…, and its tooltip gives the size and the zoom it is shown
  at. The button takes the accent colour while a fixed size is set.
- In the user's own Chrome, the extension moves the tab into a window of its own and sizes that
  window to the page size. The user's other windows are never moved or resized. When Chrome
  cannot give that size, or the extension is too old to size windows, the size is emulated while
  the Agent acts.
- The size belongs to the tab and is kept across navigations, and a popup starts at its opener's
  size. It is held in memory only, so a server restart returns the tab to fit the panel.
- The browser-automation Skill uses `resize` in place of `cdp Emulation.*`, and the `cdp` command
  remains available.
