# The shortcuts launcher is drawn larger

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `web`
- **PR:** [#732](https://github.com/Prism-Shadow/penguin-harness/pull/732)

[中文版](2026-09-15-launcher-size.zh.md)

## What changed

- The floating shortcuts launcher on the conversation's right edge is one size larger throughout: the ball is 56px (was 44), its face glyph 22px (was 18), each fan entry 46px with a 19px glyph (were 36 and 15), and the caption under the ball is 13px text (was 11). The ring's resting radius grows to 112px to keep the same air between entries, and its ceiling follows the phone-width bound. The ball's 32px inset from the edge and everything else about the launcher are unchanged.
