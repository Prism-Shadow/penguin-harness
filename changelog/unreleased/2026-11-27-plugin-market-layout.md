# The plugin market lists plugins like an app store, with a page per plugin and installs on its button

- **Date:** 2026-11-27
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`

[中文版](2026-11-27-plugin-market-layout.zh.md)

Reworked the plugin market's layout and install flow after the app stores people already know:
compact icon-led cards, a page of its own for each plugin, the install running on the plugin's
button, and the decisions an install needs paged one at a time.

## Details

- Replaced the 16:9 cover cards with icon-led store cards: the plugin's icon, its name, two lines of
  description, a short line of facts and one install button at the foot, with wider gutters. The
  list view became one ruled row per plugin, two abreast where they fit. The cover moved to the
  plugin's page.
- Gave each plugin its own page at `/plugins/<name>` (with `?machine=<id>` for a machine's card):
  icon, name, one line, author, version and tags at the head, the install button and quick start
  at the head's end, a More menu for disabling a module, uninstalling from the server and export,
  the cover first among the pictures, and an Updated row in the facts. A compact bar with the same
  button stays at the top once the head scrolls away. The old detail address `/plugins?plugin=<name>`
  opens the page. Back returns to the market's tab, search and scroll position.
- Made the install button carry the install in place: while a server install runs it shows the
  step and a staged bar along its edge, the plugin's icon wears the install ring, and it then
  resolves to the next action (Install, Open, the Agents' count, Update or Retry). The button keeps
  one width through every state. A running install is kept for the page load, so it carries on
  across the grid, the plugin's page and an Agent's Plugins tab, where a package update shows its
  step on the row's button.
- Replaced the install sheet with install steps: a dialog of short pages — On this server, Choose
  agents, Ready — with a step indicator, Back and Next, showing only the pages this install takes.
  A member asking an admin has one page. Package updates now run on the button after their
  confirmation instead of inside it.
- On All, shelved the plugins into the grouping's sections, two rows each with See all, and added
  an Installed view (`?view=installed`, from the header's Installed button) listing plugins in use
  with updates first and Update all.
- Moved Fix with AI beside the note that says what this build cannot run of a plugin.
- Added `InstallButton`, `StepIndicator`, `StoreCard` and `StoreGrid` to the shared UI package,
  a `lead` picture slot to `ProductGallery`, and gallery specimens for each.
