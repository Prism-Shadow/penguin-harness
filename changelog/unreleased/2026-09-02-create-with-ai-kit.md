# A shared "Create with AI" kit for the Web App

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#583](https://github.com/Prism-Shadow/penguin-harness/pull/583)

[中文版](2026-09-02-create-with-ai-kit.zh.md)

Every object the Web App creates from a form is getting a second path: describe it to an agent. This change added the reusable kit behind that path — the pair of buttons that opens either path, the prompt panel with clickable examples and a folded full-prompt preview, and the dialog that hands the composed prompt to the Project's default agent as a prefilled draft in a new conversation. The creation surfaces wire it up in their own changes.

## Details

- `features/ai-create` exports the bridge hook (`useAiBridge`), the pure draft builder, the default-agent pick (`default_agent`, else the first agent), the prompt composer, `AiCreatePanel`, `AiCreateModal` and `CreateButtons`; the `MAGIC_WAND_ICON` and `HAND_ICON` glyphs joined `components/ui/icons.tsx`.
- `CreateButtons` renders two separate buttons rather than a split control or a mode switch: the accented **Create with AI** with the wand, then the plain **Create manually** with the hand. Both paths stay visible at once, and a surface that offers no manual path simply omits the second button.
- The dialog has one way out — **Edit in a new conversation** — and nothing is ever sent automatically: the composed prompt lands in the new conversation's composer, and pressing Send stays the user's own action.
- The Skills tab's import-via-chat and the Memory tab's add / edit-via-chat jumps go through the same bridge; the Memory tab's jump now also parks typed-but-unsent draft text instead of overwriting it.
- The prompt box is set in the smaller of the two control sizes, so a long draft stays readable in the dialog, and the **Full prompt** preview opens flush with the examples above it (`HelpFold` gained `flush` for a body that is a block rather than a run of prose).
- A composed prompt no longer outlives the draft it seeds. It goes into the draft cache marked as composed rather than typed: leaving the draft page without editing or sending it clears the slot (model carry-over only, as a send does), and a later jump drops it instead of parking it as a draft conversation. The first edit makes it the user's own text, cached and parked like any other draft.
- The Web App docs describe the pattern in both languages.
