# @prismshadow/penguin-ui

The React components, design tokens and three themes of the
[PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) Web App, published as ES modules
with a precompiled stylesheet.

**0.x, versioned with PenguinHarness, no semver promise.** Each PenguinHarness release publishes
this package at the release's own version. Any release may change a component's props, a class it
renders or a token's value.

## Install

```sh
npm install @prismshadow/penguin-ui react react-dom
```

React 19 (`react` and `react-dom` `^19.1.0`) is a peer dependency. The package is ESM only and is
meant for a bundler (Vite, webpack, esbuild and so on). Types ship with it.

## Styles

Import the stylesheet once, before your own:

```ts
import "@prismshadow/penguin-ui/styles.css";
```

It is already compiled, so your project needs no Tailwind. It holds:

- Tailwind's base reset (preflight). It applies to the whole page, not only to the components.
- The `--ui-*` design tokens of the three themes.
- Every utility class the components use, and only those. Style your own markup with your own CSS
  that reads the `--ui-*` custom properties, for example `color: var(--ui-fg-muted)`.
- The components' own CSS, and KaTeX's styles with its woff2 fonts for math in Markdown.

## Theme and dark mode

Set the theme on the root element:

| On `<html>` | Values | When absent |
| --- | --- | --- |
| `data-theme` | `github` (Primer), `modern` (Frost), `geek` (Console) | `github` |
| `class` | `dark` for dark mode | light mode |
| `data-accent` | an accent preset the active theme lists (`ACCENT_PRESETS`) | the theme's own accent |

```html
<html data-theme="modern" class="dark"></html>
```

## Fonts (optional)

```ts
import "@prismshadow/penguin-ui/fonts.css";
```

This declares the typefaces the themes name: JetBrains Mono, IBM Plex Sans, IBM Plex Sans Condensed,
Mona Sans, Noto Sans SC and MiSans. A browser downloads a font file only when text on the page uses
it. Without `fonts.css`, the themes fall back to the platform's fonts.

The font files and their licence texts are in `dist/fonts/` and `dist/fonts/LICENSES/`. Every face
but MiSans is under the SIL Open Font License 1.1. MiSans is under Xiaomi's MiSans Font
Intellectual Property License Agreement; read it before you ship MiSans in a product of your own.

## Text the components show

A few components show words of their own, such as "Loading" or "Copy". They are English by
default. To change them, mount `UiStringsProvider` once around your tree:

```tsx
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "@prismshadow/penguin-ui";

<UiStringsProvider strings={{ ...DEFAULT_UI_STRINGS, loading: "Chargement…" }}>
  <App />
</UiStringsProvider>;
```

## Code highlighting

`CodeBlock` and Markdown code show plain text until you give them a highlighter. The Shiki-based
one is on its own subpath, so it can run in a Web Worker and stays out of your main bundle:

```tsx
import { CodeHighlighterProvider } from "@prismshadow/penguin-ui";
import { highlight } from "@prismshadow/penguin-ui/highlighter";

<CodeHighlighterProvider highlight={highlight}>
  <App />
</CodeHighlighterProvider>;
```

## Licence

Apache-2.0. The package bundles KaTeX's stylesheet and fonts (MIT) and icon outlines from Lucide
(ISC) and Octicons (MIT); their licence texts are in `dist/assets/LICENSES/`.
