# Consequential actions ask first

- **Date:** 2026-10-01
- **Type:** feature
- **Scope:** `web`

[中文版](2026-10-01-consequential-confirms.zh.md)

An audit of every destructive or hard-to-undo action in the Web App. The ones that ran on a single click now open the app's confirm dialog.

## Changes

- **New confirmations:**
  - removing a Project member
  - stopping a running background process
  - force-reinstalling a machine, stopping the use of machines, and updating every outdated machine
  - turning company mode off (the switch stays on until you confirm)
  - restoring a workflow revision
  - running a plugin's admin action
  - restoring the default avatar
  - clearing an organization draft
  - restoring the default command policy
  - importing an Agent State snapshot, which now always asks, even when the snapshot is newer
- **Unsaved edits:** the app asks before throwing them away. This covers switching tabs or going back in Agent settings, cancelling or switching documents while editing the handbook, and closing a messaging binding dialog with changes on any channel.
- **Typed text:** picking an example task or a saved shortcut asks before it replaces text you typed in the composer.
- **Every Sync presets entry** on the Models page asks the same question. So does Reset all shortcuts, even with one override.
- **Tone:**
  - Removing a module plugin now shows the danger mark.
  - Skill and hook upload overwrites and the snapshot-import conflict prompt use the neutral pencil that saves and overwrites use.
- **Wording:** destructive confirms say the action on their button (删除 / Delete, 卸载 / Uninstall, 离任 / Dismiss) instead of a generic Confirm.
