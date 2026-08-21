# Agent settings: a dashed empty block, and skills import under the list

- **Date:** 2026-08-21
- **Type:** refactor
- **Scope:** `web`
- **PR:** [#390](https://github.com/Prism-Shadow/penguin-harness/pull/390)

[中文版](2026-08-21-agent-settings-empty-block.zh.md)

Two layout changes on the Agent settings tabs. The "Import skill" button moved out of the
Skills tab header into the slot under the installed list, where the Vault and Schedules tabs
already keep their add button. And the four sections that can come up empty — Skills, Vault,
Schedules and the Tools tab's MCP Server list — traded their bare line of placeholder text for
one shared block: rounded, dashed-bordered, the message centered on both axes.

## Details

- The import action kept its modal untouched — the recommended chat install, the zip upload,
  the overwrite confirmation and the error toasts all behave as before. Only its position
  changed, and it stays disabled until the installed list has loaded. With the button gone from
  the header, the tab's description fold spans the full width of the panel, matching the other
  tabs.
- Added `SettingsEmpty` beside `EmptyState` in `src/components/ui/empty-state.tsx` and pointed
  all four sections at it, so they cannot drift apart. The block is 6rem tall at minimum, which
  is what gives the message something to be vertically centered in; it keeps the gray level the
  placeholder text already used and borrows the corner radius of the table or list it stands in
  for.
