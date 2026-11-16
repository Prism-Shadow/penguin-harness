# The site bar folds AMSP and the gallery into a "More" menu, and the gallery is called Theme Packs

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `landing`, `docs`, `ui-gallery`, `ui`
- **PR:** [#1544](https://github.com/Prism-Shadow/penguin-harness/pull/1544)

[中文版](2026-11-12-site-nav-more.zh.md)

The navigation bar shared by penguin.ooo, the docs and the gallery ended its row in a "More" entry that held AMSP and the gallery, after Home, Blog, Download, Plugins, Benchmarks, Leaderboards and Docs. Wherever a visitor reads the gallery's name, it became 「主题包」 / "Theme Packs".

## Details

- Hovering "More" opened its menu until the pointer left; pressing it (a click, a tap, Enter or Space) kept the menu open until a page was chosen, Escape, a second press or a press elsewhere. Escape returned focus to "More", the arrow keys walked the pages, and moving focus out of the menu closed it. "More" read as the current page while AMSP or the gallery was.
- In the phone menu the two pages were listed as an indented group under a small "More" label, with no menu inside the fold.
- The menu and the phone group were built in the shared UI package as their own module (`SiteNavMenu`, `SiteNavGroupLinks` in `site-nav-menu.tsx`, with the link types in `site-link.tsx`), and the gallery's Public site board gained a Navigation bar group showing them.
- Renamed in both languages: the bar and footer link, the home page's 「在主题包中打开」 / "Open in Theme Packs" link on its live frames, the label over the gallery's home title, its browser tab title and its footer specimen.
