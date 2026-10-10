# The Agent settings page commits like every other settings surface

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1031](https://github.com/Prism-Shadow/penguin-harness/pull/1031)

[中文版](2026-10-10-settings-interaction-agent.zh.md)

The Agent settings page, its tabs and the dialogs opened from it moved onto the settings commit model ([2026-10-10-settings-interaction.md](2026-10-10-settings-interaction.md)): a switch applies when flipped, typed fields and tables apply on Save, and leaving with unsaved edits first asks 「放弃未保存的修改？」.

## Leaving

- Every way off a tab with unsaved edits asks: another tab, Back to the Agents list, a sidebar link, the browser's back and forward buttons, a reload. The page's own discard dialog, which only covered the tab strip and Back, is gone.
- The Skills, Vault and Schedules prompts and the name typed for a new API key now count as unsaved edits; leaving used to drop them silently. Flipping one of those tabs' switches, or inserting its placeholder, no longer resets the prompt being typed.

## Save and Reset

- On Overview, System Prompt, Runtime, the built-in tools table, the Memory prompts and the Skills, Vault and Schedules prompts, Save is live only while something changed and is valid, and Reset puts the stored values back. The 「当前没有需要保存的修改」 toast no longer appears on these tabs.
- The 「保存修改」 confirmation before an ordinary Save was removed: Save writes at once. The confirmations before an overwrite or a deletion stay (importing a snapshot, the kernel update, restoring defaults, overwriting a vault key, every delete).
- Runtime checks all five numbers as they are typed: an integer > 0, or -1. A box holding anything else counts as a change, so it no longer slips past the leave question. A box cleared of a saved value is marked and holds Save, since a saved override cannot be cleared from the page; Reset brings the value back.

## The built-in tools table

- A row's `call_description` switch writes at once and alone. Timeouts and output limits typed beside it wait for Save, and Save no longer undoes a switch flipped before it. A number cell left blank drops its override.

## Dialogs

- Adding or editing an MCP server, adding a vault key, the scheduled task form (also opened from the chat's scheduled-tasks panel) and Create Agent: the footer button is live once the record is complete and changed; Esc, the ×, a press outside and Cancel ask while anything is typed; a refused save keeps the dialog open with the reason, still unsaved, and nothing closes the dialog while its save is in flight. A switch inside one of them, such as a task's Enabled box, saves with the dialog.
- Each of these dialogs opens on its record, or empty, every time.
