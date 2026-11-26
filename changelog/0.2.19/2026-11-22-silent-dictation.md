# Keep silent dictation in the composer

- **Date:** 2026-11-22
- **Type:** fix
- **Scope:** `web`, `multimodal-tools`
- **PR:** [#1717](https://github.com/Prism-Shadow/penguin-harness/pull/1717)

[中文版](2026-11-22-silent-dictation.zh.md)

Dictation skips speech recognition for a recording with only silent samples. An empty transcript shows “No speech was recognized” and keeps the current draft and attachments. Recognition errors still show their provider message.
