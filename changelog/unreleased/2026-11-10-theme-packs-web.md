# The Appearance page lists, imports, exports and removes theme packs, and the app loads an imported pack without a half-styled frame

- **Date:** 2026-11-10
- **Type:** feat
- **Scope:** `web`
- **PR:** [#1530](https://github.com/Prism-Shadow/penguin-harness/pull/1530)

[中文版](2026-11-10-theme-packs-web.zh.md)

The Web App picks up the theme packs an admin imported on this server: the theme picker offers them after the built-in packs, the Appearance page lists every pack with export, import and remove, and switching to an imported pack waits for its stylesheet.

## Loading a pack

- At sign-in the app reads the server's packs (`GET /api/themes`) beside the account's preferences and keeps them in `penguin.themePacks`, the cache the pre-paint script links a stored pack from. The list is read again when the Appearance page opens, when the server says it changed (`themes_changed`) and after the event stream lost events. One read is in flight at a time, an unchanged answer changes nothing on screen, and a failed read keeps the last list.
- A stored imported pack reads as itself while that cache holds it for this build's theme API, and its accent presets are kept beside it; anything else still reads as Frost, and nothing stored is rewritten.
- Switching to an imported pack adds its stylesheet link first and writes `data-theme` and `data-theme-base` only once the link has loaded. Switching away writes the attributes first and removes the link after the next paint. A link that loads after another switch began is dropped. The link the pre-paint script wrote is taken over when it holds a sheet, and asked for again when it does not.
- A pack whose stylesheet fails to load leaves the theme that was on screen (Frost when the page opened in the pack) and keeps the stored choice. The theme row says which theme shows instead and offers Retry.
- When the pack on screen is removed from the server, the app shows Frost and removes the link; listed again, the pack comes back. A replaced pack's new stylesheet loads before the old one is removed.
- A Workbench frame gets an imported pack's stylesheet link, its id and its accent as the app's root carries them. The frame re-themes once the app's root has changed rather than when the picker moved.

## The Appearance page

- The theme row lists the built-in packs, then the imported ones in install order. The built-in themes alone stay segments; once the server offers imported packs the row is a select, since a pack's name is its author's and growing segments overflow the row at phone width.
- A new 主题包 / Theme packs group at the foot of the page has one row per pack: its three colours in the current mode, its name (the id on hover), its version and what it builds on. A pack written for a newer theme API is greyed and marked as needing a newer version. Every account can export any pack, a built-in one included. An admin can remove an imported pack after a confirmation and import a `.zip` of up to 16 MB, with a confirmation before an import replaces an installed id. A member reads a line saying only an admin imports or removes. A refused import says which file, line and column the validator stopped at, and why.
- The archive download moved from `features/agents` to `lib/archive-download.ts`, so the settings pages can use it too.
