# Activity Script editor with scenes and a diff

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `web`

The Activity Script section replaced its plain description box with an editor modelled on
Loom's script editor, built on CodeMirror 6 (`@codemirror/state`, `view`, `commands`,
`language`, `merge` and `search` were added to the web package).

## Details

- Scene headings (`Scene 3:`, `Scene 3.`, `Scene 3 –`, also behind `#` or `**`) fold to their
  heading, one at a time from the gutter or all at once with **Scenes**. `Scene 8a` stays
  inside scene 8, and `Activity End` closes the last scene, as in Loom.
- `<audio>`, `<video>`, `<image>` and `<animation>` tags, with or without attributes, are set
  apart from the prose around them.
- A **Diff** select compares the script against **Since last save** or **Agent proposal**.
  Loom's HEAD and previous-commit bases were left out because a draft keeps no history.
  Changes are drawn in place with `+N −M`, chips for the scenes they touch, and a minimap
  that jumps to each change. Against the last save, each change can be reverted where it
  stands.
- When the activity's conversation has proposed a new script, the headings of the scenes it
  changes read "proposed, not applied". **Agent proposal** shows the proposed script
  read-only against the author's current text, with **Accept the proposed script**, which
  saves through the same route as the author's own save. Meanwhile the author's own editor,
  undo history included, is set aside unchanged.
- The page now reads the conversation's proposal once and shares it between the
  conversation panel and the editor, so the editor sees it with the panel closed.
- The spec-generation and assembly controls moved into a strip under the editor.
