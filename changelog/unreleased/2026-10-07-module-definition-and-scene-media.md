# Module Definition edits definition.json, and media on a scene is refused

- **Date:** 2026-10-07
- **Type:** fix
- **Scope:** `web`, `server`, `activities`

Module Definition is now the module's `definition.json`, as Loom showed it. The editor works like Configuration Data's: the edit is kept in the draft and used by the preview and every assembly until **Discard edit**. Every ref of a product shares one module, so only the canonical ref edits it, and other refs read it. A save is refused unless the definition is one an assembly accepts: engine `html`, schema version `2.0.0`, entry `entry.js`. Version compares show it as its own tab.

What used to be stacked under Module Definition moved to the right rail, where Loom keeps it:

- **Stages:** the Build checklist, the book reading mode and **Assemble WAF module**, under the stages.
- **Player:** **Open WAF preview** and **Reload preview**, under the player. The player already shows the module build.
- **Tests:** test results and **Run tests**. This tab is new.
- **Quality:** the quality checks and **Check quality**. This tab is new.

A specification whose scene lists `tracks`, `images`, `video`, `videos` or `animations` directly is now refused, with the place they belong (`audio.tracks`, `media.images` and so on). Before, the media plan read nothing from such a scene, so its narration and videos silently disappeared. The specification prompt now spells out that nesting.
