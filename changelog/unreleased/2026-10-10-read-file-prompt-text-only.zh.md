# read_file 的 `prompt` 参数只提供给纯文本模型

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`, `docs`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)

[English](2026-10-10-read-file-prompt-text-only.md)

支持图片的模型不再看到 `read_file` 的 `prompt` 参数，即向 Project 的 `vision_model` 提出的问题。这类模型直接拿到图片本身，这个参数用不上。纯文本模型照旧可以使用它。

- 组装上下文时，若 Session 模型支持图片（其模型条目未设 `vision: false`），就从 `read_file` 的参数 schema 中移除 `prompt`。与 `call_description: false` 一样，移除只作用于内存中的副本，`system_config.yaml` 不会被改写。切换模型会重新组装工具集，schema 随新模型变化。
- 默认的 `read_file` 描述不再提及 `prompt`。
- 这是一次内核变更（generation `2026-10-10`，工具标签页）：工具标签页仍是内置默认值的存量 Agent 会在内核更新时拿到新描述，用户改过的则保持原样。schema 的移除对所有配置生效，与其内核版本无关。
