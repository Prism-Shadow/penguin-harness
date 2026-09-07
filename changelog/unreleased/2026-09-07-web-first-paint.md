# The Web App paints its frame at once and reaches the sidebar in one round trip

- **Date:** 2026-09-07
- **Type:** fix
- **Scope:** `web`
- **PR:** [#640](https://github.com/Prism-Shadow/penguin-harness/pull/640)

[中文版](2026-09-07-web-first-paint.zh.md)

A cold load of the Web App on a phone used to show a blank page until the whole entry bundle had been fetched and parsed, then kept it blank while four dependent requests ran one after another — `/api/me`, the Project list, that Project's Agents, and only then the sidebar's Sessions — with KaTeX, the largest single dependency, parsed on every load whether or not a formula was ever shown. This change shortens each of those stages.

## Details

- `index.html` now carries the empty frame of the app — the sidebar on wide screens, the top bar on narrow ones, in the persisted theme and sidebar width — as static markup with inline CSS, so the first paint has the app's shape before the bundle arrives. The route guard renders the same frame (`BootSkeleton`) while `/api/me` is in flight instead of nothing.
- The first round trip leaves before React mounts: `lib/boot-prefetch.ts` asks for the user, the Project list and the remembered Project's Agents in the same instant as the install-scope probe, and the auth and Project providers take those in-flight answers once instead of issuing their own. A later reload goes to the network as before.
- KaTeX moved out of the entry into a chunk of its own (`lib/markdown-katex.ts`, stylesheet included), loaded by `import()` the first time a settled body contains a math delimiter. Until it lands, once per page, a formula shows its own TeX source — exactly what a streaming body shows already — and typesets on the re-render the load triggers. Every Markdown surface now renders through one `<Markdown>` component, which is where that decision is made.
- Every page but the chat is a lazy route chunk: agents, agent settings, plugins, models, usage, benchmark and the terminal are fetched the first time they are opened.

Measured on this change's own build, before and after: the entry script went from 1,662 kB (499 kB gzip) to 1,176 kB (363 kB gzip), the entry stylesheet from 123 kB (24 kB gzip) to 96 kB (17 kB gzip); KaTeX is a 270 kB (81 kB gzip) chunk that a page without math never requests.
