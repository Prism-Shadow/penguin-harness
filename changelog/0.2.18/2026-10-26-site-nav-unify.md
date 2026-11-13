# The landing page, the docs and the gallery show the same navigation

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `ui`, `landing`, `docs`, `ui-gallery`
- **PR:** [#1331](https://github.com/Prism-Shadow/penguin-harness/pull/1331)

[中文版](2026-10-26-site-nav-unify.zh.md)

The three public sites built their top navigation from one page list in `@prismshadow/penguin-ui/site`, so the docs and the gallery list AMSP between Download and Docs, as the landing page already did.

## Details

- The docs' phone menu opens with the site's links above the docs sidebar, and its button reads "Open menu" / "Close menu".
- Escape closes the menu on every site.
- Download is marked as the current page when /download/ is opened directly.
- The gallery bar's bottom edge keeps the site's line colour under every theme it previews.
- Between 768 px and 881 px wide, the bar shows the logo without the "PenguinHarness" name, so the links and the controls fit. The English landing bar used to run past the right edge at the narrow end of that range.
