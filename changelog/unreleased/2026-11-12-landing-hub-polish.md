# Hub detail pages lead back to their list, and the leaderboard views hold still

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `landing`, `ui`, `ui-gallery`
- **PR:** [#1540](https://github.com/Prism-Shadow/penguin-harness/pull/1540)

[中文版](2026-11-12-landing-hub-polish.zh.md)

Gave every plugin, benchmark and leaderboard page a way back to its list, renamed the leaderboard's views after the charts they draw, stopped the results toolbar from moving when the view changes, and tidied the three list pages and three detail pages.

## Details

- A detail page opens with a link back to its list (`← Plugins`, `← Benchmarks`, `← Leaderboards`). Opened from the list, it steps back through history: the list returns with its search, facets, order and scroll as they were left, and the browser's Back button returns the scroll too. Opened from a link or an address, it opens the list. The link is drawn from the first frame, so the title does not move when the page lands.
- The leaderboard's views are named Table, Pareto and Waffle (表格, 帕累托, 华夫饼).
- The results toolbar keeps the Columns button in every view, greyed out with a hint where there is no table, so the view switch and the Filter button keep their place and the toolbar keeps its height on a phone. The toolbar's icon buttons are flat, and on a phone the toolbar takes its own row under the panel title.
- The table writes the thinking level after the model's name in the muted ink, right-aligns the release date with the cost, and says under it what the ± and the whiskers are.
- A list page has a line under its title saying what the list holds, with its source below. On a phone, a card with a long title no longer widens the Benchmarks page.
- The back link, the segmented switch, the toolbar's menu button and the data table's look became shared site components in `@prismshadow/penguin-ui/site` (`SiteBackLink`, `SiteSegmented`, `SiteMenuButton`, `site-table`), shown on the gallery's Public site board. The blog post's back link, the lists' order, the Pareto axis and a benchmark task's tabs use them too.
