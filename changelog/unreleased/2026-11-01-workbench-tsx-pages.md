# Workbench pages can be written in TSX

- **Date:** 2026-11-01
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1416](https://github.com/Prism-Shadow/penguin-harness/pull/1416)

[中文版](2026-11-01-workbench-tsx-pages.zh.md)

A workbench page can be a `.tsx` file that imports React and the app's own components (`@prismshadow/penguin-ui`). When a workbench's `ui/` holds a `.tsx`, every load type-checks each `.ts` and `.tsx` under `ui/` together with the handler, against the page runtime the answering server carries in its Web App files (`workbench-runtime/`), and emits them into `.build/<revision>/ui/`. A workbench without `.tsx` loads and is served exactly as before.

## Details

- A page loads its compiled code by the `.js` name (`<script type="module" src="app.js">`): `GET …/workbenches/:id/ui/<file>` serves the file on disk first, otherwise the `.js` the serving instance emitted. The HTML of a compiled workbench is served with the runtime's stylesheet (`link[data-penguin-ui]`) and an import map first in its `<head>`, both relative to the page, so a workbench on a machine runs that machine's runtime.
- `GET …/workbenches/:id/sdk/ui/*` serves the runtime's files, revalidated by ETag; its manifest and declarations are not served.
- A page imports only `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@prismshadow/penguin-ui` and files under `ui/`. Any other package, a code file outside `ui/`, a CSS import, and a `.ts`/`.tsx` beside a `.js` of the same path each fail the load, named as `ui/<file>:<line>:<col>`; type errors read like the handler's (`ui/app.tsx:7:18 TS2322 …`), in the same `error` and `.build/status.json`. A failed load, even of the revision already serving, leaves the serving pages in place.
- The runtime's declarations are copied into `.harness/ui/` whenever they differ, after the handler's types. `.harness/README.md` gained a "Pages in TSX" section: what a page may import, and where each component's props are.
- On a server without the runtime, a TSX workbench fails with an error naming where it looked; workbenches without `.tsx` are unaffected.
- The TypeScript compiler is taken only with `lib.dom.d.ts` and `lib.dom.iterable.d.ts` beside it.
- The Web App's frame leaves its base stylesheet (`/workbench-ui.css`) out of a page that carries the components' stylesheet, and still applies the theme, the tokens and the fonts.
