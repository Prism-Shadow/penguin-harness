# 连接 TokenDance 或 Penguin Go 后，询问是否把默认模型换成它的 DeepSeek V4.1 Flash

- **Date:** 2026-11-10
- **Type:** feature
- **Scope:** `server`, `model-catalog`, `web`
- **PR:** [#1507](https://github.com/Prism-Shadow/penguin-harness/pull/1507)

[English](2026-11-10-connect-offers-default-model.md)

模型库里的 TokenDance 或 Penguin Go 连上后，如果 Project 的默认模型在别的分组，或者还没有默认模型，页面会询问是否把默认模型换成该分组的 DeepSeek V4.1 Flash（`tokendance` / `deepseek-v4.1-flash`、`penguin-go` / `deepseek-flash`）。分组的第一把分组密钥经连接流程拿到，或在分组设置里保存，就算连上。询问时会写明当前的默认模型：选**更换**就改，选**保持不变**就不动。没有默认模型的 Project 会被问是否设为默认。走连接流程时，询问在关闭结果弹窗后出现。连接本身从不改默认模型。

重新连接、其他分组连接、默认模型本就是这个分组的模型、Project 里已没有这一行时，都不询问。最后一种情况下，即使 Penguin Go 的投递把这一行补回来，也不询问。

## 细节

- `PUT /api/projects/:p/models/providers/:provider`、TokenDance 授权的答复（轮询与粘贴授权码）和 Penguin Go 的完成状态都带上 `defaultOffer`：`model`，Project 有默认模型时另带 `current`。经 `PUT /models` 的 `providers` 写入密钥不会询问。
- 目录的分组描述符以 `connectDefault` 声明这个模型。
