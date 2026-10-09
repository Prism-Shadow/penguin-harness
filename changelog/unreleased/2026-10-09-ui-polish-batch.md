# Permission menu icons, no thinking-level footnote, and the Trace tab and file editor held to their width

- **Date:** 2026-10-09
- **Type:** fix
- **Scope:** `web`, `ui`
- **PR:** [#1007](https://github.com/Prism-Shadow/penguin-harness/pull/1007)

[中文版](2026-10-09-ui-polish-batch.zh.md)

Four Web App touches: each row of the composer's permission menu was led by its level's shield, the session thinking-level menu lost its footnote, the Trace tab stopped cutting its rounds and its summary off on the right, and pressing Edit on a file stopped rewrapping its text.

## Details

- Each row of the composer's permission menu (the presets, or the approval modes while the Sandbox switch is off) showed, before its name, the shield the permission button takes once that row is picked, in the button's tone: amber for full access and partial permission, told apart by the glyph, green for read-only and muted for off. An unavailable row dimmed its shield with it. An administrator's **More…** row took a gear, so its name lines up with the rows above it, and the menu's minimum width grew by about the shield's width, so the longest built-in row keeps its whole name beside a note such as "Admin only".
- The session composer's thinking-level menu no longer ended with "Applies right away. Changing it invalidates the model's cached context — compacting first is recommended." A mid-chat change still opens the confirm dialog that says what the switch costs and offers to compact first. The string left both dictionaries.
- The UI package's fold (`Fold`) held its body to the fold's width. Its one grid column had grown to the body's min-content width, where a row that truncates its text counts at the full text width, so an open Trace round came out far wider than its card and was clipped on the right: the timeline, the legend, the zoom bar and the event rows. The sidebar's folding groups had the same fault, and a long conversation title pushed its row's time past the edge.
- The Trace tab's overall summary set its three groups side by side only where its card is wide enough, measured on the card (a container query) rather than the viewport. In a dock beside the conversation the three columns had cut most of the values short; there the groups now stack.
- With wrapping on, the file editor's text layer and textarea took the scroll box's width. An unbreakable run, such as a long token or URL, had widened both layers to its own length, so pressing Edit rewrapped every line at that width and changed the text's height. Editing now wraps exactly where the source view does.
