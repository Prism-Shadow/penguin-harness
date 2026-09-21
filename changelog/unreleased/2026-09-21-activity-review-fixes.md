# Activity preview and book-reader review fixes

- **Date:** 2026-09-21
- **Type:** fix
- **Scope:** `server`
- **PR:** [#25](https://github.com/nicolaepocroianu/penguin-harness/pull/25)

Two review findings on the activity work in this release batch, both confirmed real:

## Details

- A book-reader page turn no longer kills word taps on the page it brings in: the outgoing page's interactables are claimed when the turn is scheduled, not inside the animation cleanup that fires after the incoming page already registered its own words.
- The embedded module preview's scene and language selectors now take effect: `preview-redirect` forwards every non-`path` query parameter onto both the preview-origin redirect and the same-origin `files/content` fallback, instead of dropping them at the redirect.
