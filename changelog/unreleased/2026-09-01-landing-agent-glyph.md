# The landing page draws the same Agent the app does

- **Date:** 2026-09-01
- **Type:** fix
- **Scope:** `landing`, `web`
- **PR:** [#579](https://github.com/Prism-Shadow/penguin-harness/pull/579)

[中文版](2026-09-01-landing-agent-glyph.zh.md)

The landing page's `BotIcon` now carries the Web App's Agent glyph exactly — eyes and smile
included. The two were the same lucide robot until the app's grew a face
([#538](https://github.com/Prism-Shadow/penguin-harness/pull/538)), and the page that sells
the product should not draw its central object a second way.

## Details

- The glyph exists twice on purpose: the landing page carries no icon dependency, so there is
  no module for the two to share. It is one `<path>` on both sides now, so the two are
  literally the same string.
- `packages/landing/test/agent-glyph-sync.test.ts` reads both sources as text and fails when
  only one of them moves — this glyph had already drifted once, in a hand-copied literal on
  the new-chat page, and a copy nobody checks is what drifts next.
- Only the Agent mark differed. The landing set's history, users and clock glyphs are already
  the same drawings the app uses.
