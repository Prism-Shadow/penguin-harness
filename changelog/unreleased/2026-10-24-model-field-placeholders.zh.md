# API key 与 base URL 留空时提示「留空使用默认」

- **Date:** 2026-10-24
- **Type:** fix
- **Scope:** `web`, `model-catalog`, `docs`
- **PR:** [#1316](https://github.com/Prism-Shadow/penguin-harness/pull/1316)

[English](2026-10-24-model-field-placeholders.md)

模型弹窗和分组设置里，空着的字段不再在占位文字里写出端点或环境变量名。分组设置没有填上的空 base URL，占位文字改为「留空使用默认 base URL」（英文 "Leave blank to use the default base URL"），原先是「未设置：默认发往 https://api.deepseek.com」或「未设置：使用客户端默认端点」。检测到的环境变量能补上的 API key，占位文字改为「留空使用默认 API key」（英文 "Leave blank to use the default API key"），原先会写出变量名。

## 细节

- Custom 或你创建的分组必须填写 base URL 时，分组设置里的这个字段显示 `https://…`，与模型弹窗原有的做法一致。
- 以下文字不变：「留空继承分组设置」、「留空保留现有 key」、分组密钥不适用于该模型时的说明、key 字段下写明请求发往哪里的说明，以及打码显示的环境变量 key。
- 删除了目录的 `providerDefaultBaseUrl`。它是为旧的占位文字加的，见 [vLLM 改读自己的变量](2026-10-22-vllm-local-default.zh.md)。
- 模型文档页引用的是新的措辞。
