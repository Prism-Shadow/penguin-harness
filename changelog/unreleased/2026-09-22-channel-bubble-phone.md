# A channel message on a phone gets the width it needs

- **Date:** 2026-09-22
- **Type:** fix
- **Scope:** `web`
- **PR:** [#826](https://github.com/Prism-Shadow/penguin-harness/pull/826)

[中文版](2026-09-22-channel-bubble-phone.zh.md)

On a phone, a company channel's message bubbles were narrow and the time stamp squeezed the
words: Chinese wrapped at about seven characters a line.

## Details

- A bubble may take 88% of its column on a narrow screen (75% from the `sm` breakpoint up, as
  before). The column is already the avatar gutter short of the screen; three quarters of what
  was left was not enough.
- The time no longer sits in a column of its own beside the body. It ends the bubble: beside
  the words when a message fits on one line with it, and on a line of its own — right-aligned,
  under the last line — when the words need the width.
