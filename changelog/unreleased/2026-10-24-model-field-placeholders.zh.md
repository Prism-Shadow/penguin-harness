# base URL 留空时提示「留空使用默认 base URL」

- **Date:** 2026-10-24
- **Type:** fix
- **Scope:** `web`, `model-catalog`, `docs`
- **PR:** [#1316](https://github.com/Prism-Shadow/penguin-harness/pull/1316)

[English](2026-10-24-model-field-placeholders.md)

模型弹窗和分组设置里，空着的 base URL 字段不再在占位文字里写出端点。分组设置没有填上时，占位文字改为「留空使用默认 base URL」（英文 "Leave blank to use the default base URL"），原先是「未设置：默认发往 https://api.deepseek.com」或「未设置：使用客户端默认端点」。

## 细节

- 必填的 base URL 字段不再显示占位文字。包括：组内有模型没有自己 base URL 的 Custom 或你创建的分组的分组设置，以及所在分组没有 base URL 的模型的模型弹窗。输入框显示已存的值，留空不能保存：「保存」保持禁用，输入框下方显示「必须填写 base URL」。此前模型弹窗在必填且留空时显示 `https://…`，分组设置显示「未设置」的文字。
- API key 的占位文字不变，包括写出留空时所用环境变量的那一条。
- 删除了目录的 `providerDefaultBaseUrl`。它是为旧的占位文字加的，见 [vLLM 改读自己的变量](2026-10-22-vllm-local-default.zh.md)。
- 模型文档页引用的是新的措辞。
