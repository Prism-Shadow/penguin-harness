# Embed the module preview and a projects landing

- **Date:** 2026-09-20
- **Type:** feature
- **Scope:** `web`, `server`

The activity editor embeds the assembled WAF module in place instead of only linking to a new tab: the preview runs in a viewport-sized frame scaled to fit the declared resolution, with reload, a start-scene selector, a language selector when the plan carries several languages, and the stale-module notice inline. The open-in-tab link remains.

The activities page opens on a projects landing in Loom's style — a searchable card grid with two-letter marks, a create dialog, and a full-width editor page behind each activity. Scene and language overrides are passed as preview URL query parameters; the assembly prompt now asks generated preview runtimes to honor them by injecting `__loomPreview.startSceneId` and the selected language, so older previews ignore the selectors while new assemblies support them.
