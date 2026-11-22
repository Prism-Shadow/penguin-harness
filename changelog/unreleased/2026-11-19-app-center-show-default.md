# The App Center shows every workbench unless it opts out

- **Date:** 2026-11-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1655](https://github.com/Prism-Shadow/penguin-harness/pull/1655)

[中文版](2026-11-19-app-center-show-default.zh.md)

A workbench now has a tile in the App Center unless its `package.json` sets `penguin.appCenter.show` to `false`. A workbench that declares no `appCenter`, or an `appCenter` without `show`, is shown, so an app an Agent wrote without the key still has a tile.

## Details

- **Existing workbenches.** Workbenches written before this change that never declared `penguin.appCenter` appear in the App Center after the upgrade. The **Show in the App Center** switch on a workbench's row turns one off, as before, by writing `show: false`.
- **The row's switch.** `WorkbenchInfo.appCenter` reports the value in effect, so the switch of a workbench that declares nothing reads on.
- **Unchanged.** A declaration that does not hold up, such as a `show` that is not a boolean, still gives the workbench no tile, and its load hints still name the fix. A workbench that is turned off has no tile.
- **Empty App Center.** The page's explanation no longer asks you to turn the switch on.
