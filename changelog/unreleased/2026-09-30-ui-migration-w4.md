# Layout, navigation, notices and data move into the shared UI package

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-09-30-ui-migration-w4.zh.md)

W4 of the UI-package migration moves the Web App's page structure into `@prismshadow/penguin-ui` and converts the pages to it: page headers, cards, tables, sections, notices, progress and stats.

## What moved

- **Moved:** `Tabs`, the group list (`GroupHeader`, `FolderSection`, `MoreRow`, and a new `Pager`), `CreateButtons`, `TodoNotice`, `BetaBadge`, `DisclosureRow`, `LiveDuration`, and `StatTile`.
- **New layout:** `PageFrame` and `PageHeader`, `Card` and `CardHeader`, `RuledSection`, `CollapsibleSection`, `EntityHeader`.
- **New data:** the `Table` family, `KeyValue`, `ListRow`, `LogView`, `StatChip`.
- **New feedback and navigation:** `Notice` (strip, callout and inline on the notice strip, with dismiss, retry and action), `ProgressBar`, `DurationSlot`, and `NavList` / `NavRow`, which now draw the settings dialog's and the Project settings' rails.

## Details

- The agents, agent settings, models, plugins, Evaluation Center, Trace, machines and schedules pages, and every company-mode page, now use these components; their de-slop allowlist entries are gone.
- Page titles keep their size in every theme.
- An indeterminate progress bar (the update dialog's install phase) pulses as a live signal in each theme's own way.
- The package's accessibility fallbacks gain expand / collapse, more / fewer, previous / next and the page position.
- The gallery gains Layout and Data pages, and its Notice, Loading and Badges pages show the new components.

## Visible changes in the default theme (Primer)

- Most 10–11 px captions, counts, tags and meta lines across these pages become 12 px, and 2 px gaps become 4 px.
- Tables share one header: medium weight instead of bold, 4 px shorter, ruled below, with a row hover and no rule under the last row.
- Page headers space their actions 16 px from the title and right-align them when they wrap on narrow screens.
- Collapsible groups (memory, plugins) have a bordered box and no hover fill on the head; the chevron sits before the actions.
- The work group's title in the transcript is no longer uppercase.
- Rails: inactive rows one step lighter; the Project settings glyphs 16 px in the subtle ink.
- Finance tables, the calendar and ticket cards take the 12 px rung, token lines and a little more padding.
- The benchmark case browser's tree is wider (380 px in English, 270 px in Chinese) so folder names fit.
