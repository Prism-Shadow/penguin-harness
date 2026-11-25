# 听写未识别到语音时保留草稿

- **Date:** 2026-11-22
- **Type:** fix
- **Scope:** `web`, `multimodal-tools`
- **PR:** [#1717](https://github.com/Prism-Shadow/penguin-harness/pull/1717)

[English](2026-11-22-silent-dictation.md)

录音只有静音采样时，听写会跳过语音识别。转写结果为空时会提示未识别到语音，并保留原有草稿和附件。识别请求失败时仍会显示相应错误。
