# The UI package publishes to npm, and builds the Workbench runtime

- **Date:** 2026-10-28
- **Type:** feature
- **Scope:** `ui`, `web`, `ci`, `tooling`
- **PR:** [#1417](https://github.com/Prism-Shadow/penguin-harness/pull/1417)

[中文版](2026-10-28-penguin-ui-on-npm.zh.md)

`@prismshadow/penguin-ui` stopped being private. Each release publishes it at the release's version, after `@prismshadow/penguin-core` and before `@prismshadow/penguin-server`. Inside the repository the package is still read as source; a new build, `pnpm --filter @prismshadow/penguin-ui build`, writes what the tarball and the Web App take from it.

## The published package

- `publishConfig` gave the tarball four entry points: `.`, `./highlighter`, `./styles.css` and `./fonts.css`. Only `pnpm pack` and `pnpm publish` apply it.
- `dist/index.js` and `dist/highlighter.js` are ES modules with React as a peer dependency and the other npm dependencies left as imports. They import no CSS. Each entry has one rolled-up declaration file, with the a2ui types inlined, so the package no longer depends on `@prismshadow/penguin-core`.
- `dist/styles.css` is compiled with the Web App's pipeline (Vite and `@tailwindcss/vite`): Tailwind's base reset, the token bridge, the three themes, the utilities the components use, the components' CSS and KaTeX's with its woff2 fonts.
- `dist/fonts.css` and `dist/fonts/` carry the interface typefaces as an opt-in, with their licence texts.
- The animations and the `no-scrollbar` rule the components name moved from the Web App's stylesheet into the package (`src/animations.css`, imported by `theme.css`): `anim-pop`, `anim-fade`, `anim-msg`, the toast, drawer and launcher-fan classes, and their keyframes. The Web App gets the same rules through `theme.css`; `styles.css` and the runtime now animate dialogs, menus, toasts and drawers as the app does, and both stop them under reduced motion.
- A README for the npm page covers installing, the stylesheet, the root element's theme attributes, `UiStringsProvider`, the highlighter and the versioning.

## The Workbench runtime

- The build also writes `dist/workbench/`: the components for a browser with every dependency but React bundled in, ES module wrappers of React's production builds, the stylesheet, a `manifest.json` naming them, and the declarations a page is type-checked against: the package's own, React's, and those its props reach in react-markdown, zustand and the unified packages behind them.
- `penguinUi({ workbenchRuntime: true })` in the Web App's Vite config copies it into the Web App's dist as `workbench-runtime/`, and fails the build when it is missing. `scripts/deploy.mjs`, the `Dockerfile`, CI's packed-app job and the browser extension's e2e script build the UI package before the Web App.

## Release and CI

- `scripts/release-npm.sh` stamps the UI package's version; `release.yml` copies LICENSE into it and publishes it.
- CI's npm packaging job runs the new `scripts/check-ui-package.mjs` on the tarball `pnpm pack` makes and on the runtime. It installs the tarball into a project, type-checks a valid and a wrong prop, and checks that the classes rendered components use are in `styles.css`.
- Test and typecheck builds skip the UI package unless they also build the Web App's bundle.
