# Gallery: the site's navbar, with the gallery's own bar under it

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `ui-gallery`
- **PR:** [#1101](https://github.com/Prism-Shadow/penguin-harness/pull/1101)

[中文版](2026-10-13-gallery-site-nav.zh.md)

The gallery now opens under the same navbar as the landing page and the docs: Home, Blog, Download, Docs and Gallery, the language and light/dark toggles, and GitHub. Its own pages and view controls move to a second bar beneath it.

## Details

- The navbar is the landing page's, link for link, and looks the same whatever theme, text size or font the gallery is showing. On the gallery, Gallery is the current page; the other links lead to the site the gallery is published in, or to the public site when the gallery runs on its own.
- The gallery's bar holds Overview (formerly Home), Surfaces, Foundations and Fonts on the left, the current one underlined, and the theme under test and View settings (accent, size, fonts, viewport, the fonts in use) on the right. Both bars stay at the top as the page scrolls.
- Light/dark and the language now belong to the site. The gallery's own switches for them are gone; the navbar's toggles change both for all three sites at once. A visit whose address does not name them opens in the site's choice, which follows the system until set, and an address that names them still opens as named. See [backward compatibility](2026-10-13-backward-compatibility-gallery-prefs.md).
- On a phone the gallery's pages scroll sideways, the theme moves into View settings, and the navbar's menu button opens the site's links and the section's list.
- The live frames on the landing page are unchanged.
