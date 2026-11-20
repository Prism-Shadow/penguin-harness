# The system apps move into the App Center

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `ui`, `server`
- **PR:** [#PR](https://github.com/Prism-Shadow/penguin-harness/pull/PR)

[中文版](2026-11-19-system-apps.zh.md)

Models, Plugins, Machines, Cost Center and Evaluation Center are now the system Agent's **system apps**. Each one is an App Center tile instead of a nav entry. It opens the same page at the same address, and the App Center entry in the nav stays lit there (design: [PRFC-0033](https://github.com/Prism-Shadow/penguin-harness-design/pull/496)).

## Details

- **Declared as page contributions.** A page contribution with `app: { order }` is a system app: the Web App's `PageData` and the server's `WebPageData` both take the field. The tile shows the page's `title`, `titleZh` and `icon`, opens its `path`, and is shown to whoever the page's `admin` flag allows, so Machines remains for administrators only. The five keep their own feature modules, now with `nav: "none"`, so they still show in safe mode. A server-module plugin can add a system app the same way. A contributed page with `app` but no `title` is not an app, but stays reachable by its path.
- **App Center tiles.**
  - Without a personal arrangement, the system apps come first, in order. An arrangement saved before this change gets them appended at the end, like any new app.
  - Each tile draws its page's line glyph on the App Center's icon shape (`GlyphAppIcon` in the UI package), and its hint reads "<name>, system app". A click opens the page, never a window.
  - A system tile can be moved and put in folders, and the arrangement stores it as `system_agent/<page key>`. Its menu offers only Open, Move to…, Move forward and backward, and Remove from folder. There is no full screen, no agent settings and no removal.
  - Until some agent has an app here, the explanation of workbenches and the Create with AI button sit under the system apps.
  - The system apps also show when the server's App Center list cannot be read. A machine's tiles never include one.
- **Nav.** The nav and the collapsed rail lose the five entries. The App Center entry stays lit on each system app's page and on any page under one by path, such as a Benchmark's page.
- **The system Agent.** Its settings' Workbenches sub-page lists the system apps the viewer can open, each with an Open button. Its card on the Agents page shows how many there are.
