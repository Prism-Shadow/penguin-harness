# A folder of the user's own saved prompts on the draft screen

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#401](https://github.com/Prism-Shadow/penguin-harness/pull/401)

[中文版](2026-08-21-draft-custom-shortcuts.zh.md)

Added a last folder to the draft screen's examples block, holding shortcuts the user saved themselves. **New shortcut** opens an editor already carrying whatever is in the composer, with its first line suggested as the name; saving files it under the folder, and clicking a row fills the composer with that prompt and sends nothing, exactly like a built-in example. Rows carry edit and delete, and the list is stored per user on the server (`ui_prefs.draftShortcuts`), so it follows the account to another browser or machine.

## Details

- A shortcut is a name and a prompt, and pins no Skills: a saved prompt is not authored against the Skill catalog the product ships, and the Agent it runs under is picked after the click. The fill therefore leaves the composer's Skill selection exactly as the user set it.
- `PUT /api/me/prefs` validates and normalizes the key on the way in — at most 20 shortcuts, a name of at most 40 characters, a prompt of at most 4000, unique ids, no extra keys stored — and answers `invalid_draft_shortcuts` (400) without writing anything. The Web App carries the same numbers for its counters and disabled states.
- The examples block still does not change height as folders are switched: the built-in folders stay within a row of each other's length, and the user's folder, whose length is not the registry's, is pinned to the tallest built-in folder's height and scrolls inside it. The registry docstring and the block's comments were rewritten to state that rule, and `EXAMPLE_FOLDER_ROWS` derives the height from `EXAMPLE_FOLDERS` rather than repeating a number.
- An empty folder shows just the **New shortcut** row, which is the only way in.
- The folder header row moved into a shared `ExampleFolderRow` component, rendered by both the built-in folders and this one.
