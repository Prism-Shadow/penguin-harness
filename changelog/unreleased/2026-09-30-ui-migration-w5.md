# Markdown, code and the type roles move into the shared UI package

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-09-30-ui-migration-w5.zh.md)

W5 of the UI-package migration moves the Web App's content rendering into `@prismshadow/penguin-ui`: Markdown, code blocks and their highlighting, and adds the type roles and a diff viewer.

## What moved

- **Markdown:** `Md` (same props and name) and the new `Prose` reading box in three densities (`body`, `compact`, `flush`), with the shared plugin pipeline (`REMARK_PLUGINS`, `REHYPE_PLUGINS`, `NO_REHYPE_PLUGINS`) and its autolink and math passes. The `.md-body`, `.md-compact`, `.code-*`, Shiki and KaTeX rules leave the app's stylesheet for the package's `prose.css`, written in tokens. KaTeX's stylesheet now comes with the package.
- **Links:** Markdown links open in a new tab unless a `ProseLinksProvider` decides otherwise; the app's `WorkspaceLinksProvider` (a conversation's links to Workspace files) is built on it.
- **Code:** `CodeBlock` (the `ui-frame` host for code) and `CodeSurface`, with the language tables. The components never run Shiki themselves: they ask a `CodeHighlighter` handed to them by prop or by `CodeHighlighterProvider`. The engine is its own subpath, `@prismshadow/penguin-ui/highlighter`, and the Web App keeps running it on a worker.
- **The Workspace Markdown preview** renders through `Prose` instead of a second copy of the pipeline.
- **New:** `Heading` (the theme's h1–h6 rungs; `display` for a page's one display title), `Text` (body, small, caption, eyebrow, mono and label roles), `InlineCode`, and `DiffViewer` (unified or side by side, from two texts or a patch, with changed words marked and both sides highlighted).

## Details

- The package's accessibility fallbacks gain "Copy code", supplied by the Web App in the interface language.
- The gallery's component library gains a Content page.
- KaTeX, Shiki and the remark / rehype plugins become dependencies of the package; the Web App keeps only `react-markdown`.

## Visible changes in the default theme (Primer)

- Inline code in Markdown, and code shown before it is highlighted, take the body ink: one step darker in light, one step lighter in dark.
- A Markdown blockquote's text is one step lighter in light.
- A Markdown link's underline is its own ink thinned; in dark it no longer darkens on hover.
- A formula KaTeX cannot parse keeps a dotted underline one step lighter in dark.
- Code in a message's code block follows the text-size setting (13 px at the default size).
- Fenced code in the Files panel's Markdown preview gets the code-block frame, with its language and copy button.
