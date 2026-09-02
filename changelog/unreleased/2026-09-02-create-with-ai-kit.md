# A shared "Create with AI" kit for the Web App

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#583](https://github.com/Prism-Shadow/penguin-harness/pull/583)

[中文版](2026-09-02-create-with-ai-kit.zh.md)

Every object the Web App creates from a form is getting a second path: describe it to an agent. This change added the reusable kit behind that path — the split "Create" button with its magic-wand entry, the prompt panel with clickable examples and a folded full-prompt preview, the dialog that sends the prompt to the Project's default agent in a new conversation (or opens that conversation with the prompt prefilled), and the draft page's ability to submit a prefilled draft on arrival. The creation surfaces wire it up in their own changes.

## Details

- `features/ai-create` exports the bridge hook (`useAiBridge`), the pure draft builder, the default-agent pick (`default_agent`, else the first agent), the prompt composer, `AiCreatePanel`, `AiCreateModal` and `CreateMenuButton` / `AiWandButton` / `AiCreateButton`; the `MAGIC_WAND_ICON` glyph joined `components/ui/icons.tsx`.
- The Skills tab's import-via-chat and the Memory tab's add / edit-via-chat jumps go through the same bridge; the Memory tab's jump now also parks typed-but-unsent draft text instead of overwriting it.
- The draft page honors `autoSend` in its route state: once the requested agent is selected, a model is known and the agent's skills are loaded, the composer submits through the Send button's own path, exactly once per history entry (a reload does not resend). A Project with no model leaves the prefilled draft in place.
- The composer's control handle gained `submit()`.
- The Web App docs describe the pattern in both languages.
