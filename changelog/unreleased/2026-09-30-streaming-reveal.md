# Streaming replies come in the way the theme reveals them

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`

[中文版](2026-09-30-streaming-reveal.zh.md)

An assistant reply that is still streaming now appears the way the active theme reveals text: Frost fades new text in from a soft glow, Console types it out, and Primer shows each piece the moment it arrives, as before.

## How each theme reveals a reply

- **Frost** lets the reply in word by word, at about 220 characters a second. Its last lines rise out of a soft glow tinted with the accent, which fades once the reply is complete. There is no cursor.
- **Console** types the reply out character by character, at about 90 characters a second, behind a solid block cursor.
- **Primer** is unchanged: text shows as it lands, followed by the pulsing bar.
- With reduced motion on (the system setting, or the gallery's switch), every theme shows text as it arrives, with no glow and no blinking.

## Pacing in Frost and Console

- When the model streams faster than the theme's pace, the reveal speeds up and never falls more than about 1.5 seconds behind. When the stream ends, the rest comes in at the same pace, not all at once.
- Half-typed Markdown does not flicker: a list mark, a heading mark, a code fence or a table rule appears together with the first text after it, so a paragraph never flashes as a heading and a code block opens on its first line. Code highlighting and formulas are applied once the reply is fully shown.
- A reply's stop reason, and a subagent reply's file list, appear once the reply is fully shown.

## Gallery

- Foundations gained a **Streaming** page: a scripted reply plays in bursty chunks under the chosen theme, with a Replay button. A **Chat · streaming** surface keeps a reply streaming in the real app, on a loop.
