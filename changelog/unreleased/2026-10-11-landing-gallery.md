# The component gallery on the public site, linked after Docs

- **Date:** 2026-10-11
- **Type:** feature
- **Scope:** `landing`, `docs`, `ui-gallery`, `web`, `ci`
- **PR:** [#1044](https://github.com/Prism-Shadow/penguin-harness/pull/1044)

[中文版](2026-10-11-landing-gallery.zh.md)

The component gallery (`packages/ui-gallery`) is published on the public site at `/gallery/`: the real Web App and its components, framed against the in-browser demo API, with no server behind them. The landing page and the docs site link to it from their top navigation, right after Docs.

## Details

- `pnpm build:site` builds the gallery with `BASE_PATH=<base>gallery/` and copies it under `gallery/`, as it does the docs under `docs/`; core and amsp, which the Web App's source imports from their dist, build first. The gallery's build writes a copy of its document at every page's address (`s/<surface>/`, `c/<topic>/`, `fonts/…`), so a reload or a quoted link opens the page. The sitemap lists `/gallery/`.
- A Gallery link follows Docs in the landing nav, both the desktop row and the phone menu, in the docs nav, and in the landing footer's Resources column. Like Docs, it is a plain link to a sibling site, never marked as the current page, and it shares the sliding hover pill. It carries the language the reader has the site in (`?lang=zh` or `?lang=en`), so the gallery opens in that language rather than its own default. A missed `/gallery/…` address that falls through to the landing's 404 page goes to the gallery's home, as a missed `/docs/…` address goes to the docs'.
- On the public site the gallery's brand logo leads back to the site; the Home link beside it still opens the gallery's own home.
- The Web App names its brand logo relative to the build's base, so the gallery's copy resolves under `/gallery/`. In the app the URL is unchanged.
- The landing and docs pages name their favicon by a root-absolute URL. The copies of their document at blog-post and doc-page addresses had requested it under their own path and got a 404. The site build now fails when a site's HTML names an asset by a relative URL, or when its HTML, CSS or scripts point outside the site's base.
- `pages.yml` also deploys on pushes to main that touch the Web App or the UI package, so the public gallery follows the app. Pull requests that touch only those two are not built there, because CI's full build already compiles the gallery.
