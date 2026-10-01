# The Plugins page: search in the header, buttons that say what they do, and a "Settings" gear

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `web`
- **PR:** [#862](https://github.com/Prism-Shadow/penguin-harness/pull/862)

[中文版](2026-09-29-plugins-header-settings-label.zh.md)

- The search box moves from the top of the list to the right end of the page header, the Models page's shape: flexible on a narrow screen, a fixed width from `sm` up. Everyone sees it, as before; the admin's machine picker and gear follow it.
- The page's icon buttons show their words beside the icon once their row is wide enough: the header's gear, a library card's update, quick-start and install buttons, and a module plugin's Install and Remove. Their accessible names and tooltips are unchanged.
- The header's gear (admin only) is labelled "Settings" (in Chinese, "设置") instead of "Plugin settings", in its text, tooltip and accessible name. It opens the Settings dialog, whose name is "Settings"; the label now says so.
