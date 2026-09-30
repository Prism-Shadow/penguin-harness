# The chat transcript and the composer move into the shared UI package

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-09-30-ui-migration-w6.zh.md)

W6 of the UI-package migration lifts the conversation into `@prismshadow/penguin-ui`: the package draws the transcript and the composer, and the Web App keeps the Session state, sending and the model catalog.

## What moved

- **Transcript:**
  - `MessageBubble`, `MessageMeta` and `MessageImage`.
  - `AssistantText` and `StreamingCaret`, the streamed reply; the streaming reveal's pacing moves with them.
  - `ChangesCard`, now drawing both the message files card and the memory changes card.
- **Agent work:** `WorkGroup`, `ThinkingBlock`, `StepBanner`, `ToolCallCard`, `ApprovalButtons` and `ApprovalBlock`, and `SubagentChip`. The web keeps thin Session containers for each.
- **Composer:**
  - `ComposerCard`, `ChipRow`, `ToolbarTrigger`, `SendButton`, `SlashMenu` and `SlashPicker`.
  - `TagInput` and `Chip`, and `MenuSelect` for the composer's selects.
  - `ContextRing`, and `ModelSelect` / `ModelMenuList`. The web's catalog-bound picker is `ModelCatalogSelect`.
- **Company channel:** `ChannelRun` and `ChannelBubble`.

## Details

- A new token, `--ui-fill-neutral`, is the neutral fill that message bubbles and chips sit on. In every theme it takes the bubble grey used before this change, so Console keeps its filled bubbles.
- The composer keeps its neutral focus ring in every theme.
- The Trace and transcript tool rows no longer pulse their placeholder, and the stop button is a neutral square with a red glyph.

## Visible changes in the default theme (Primer)

- **Text and ink:**
  - Transcript and composer inks are one step darker in light mode (gray-800 → gray-900) and one step lighter in dark mode.
  - 10–11 px captions become 12 px: message times, the stats footer, subagent ids and the attachment size.
- **Step banner:** its title is 12 px sentence case instead of 11 px uppercase.
- **Composer:**
  - The send button takes the accent fill.
  - The stop button changes from a red tint to a neutral fill with a red glyph.
  - Toolbar hover fills are lighter.
  - Reference chips are 24 px tall like the other chips.
- **Chat header:** the Session title in the header is 14 px, the nearest heading size (was 15 px).
- **Company channel:** your own bubble is a light wash of the link colour, and names and times are 12 px.
