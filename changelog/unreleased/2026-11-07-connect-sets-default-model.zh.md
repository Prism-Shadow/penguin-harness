# 连接 TokenDance 或 Penguin Go 后，默认模型改为它的 DeepSeek V4.1 Flash

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `server`, `model-catalog`, `web`, `ui`, `ui-gallery`

[English](2026-11-07-connect-sets-default-model.md)

模型库里的 TokenDance 或 Penguin Go 一旦连上，Project 的默认模型就改为该分组的 DeepSeek V4.1 Flash（`tokendance` / `deepseek-v4.1-flash`、`penguin-go` / `deepseek-flash`），原来的默认模型是什么都照改。分组的第一把分组密钥经连接流程拿到，或在分组设置里保存，就算连上。服务端在写入密钥的同一次写入里改默认模型。随后页面提示新的默认模型，并提供**撤销**，把原来的默认模型改回去。原先没有默认模型的 Project 照样收到提示，只是没有撤销。走连接流程时，提示在关闭结果弹窗后出现。

重新连接、其他分组连接、默认模型本就是它、Project 里已没有这一行时，都不改。最后一种情况下，即使 Penguin Go 的投递把这一行补回来，也不改。

## 细节

- `PUT /api/projects/:p/models/providers/:provider`、TokenDance 授权的答复（轮询与粘贴授权码）和 Penguin Go 的完成状态都带上 `defaultSwitch`：`defaultModel`，原先有默认模型时另带 `previousDefault`。经 `PUT /models` 的 `providers` 写入密钥不会改默认模型。
- 目录的分组描述符以 `connectDefault` 声明这个模型。
- 共享 UI 库的顶部提示可以带一个 `action`（一个词和按下后做的事），以方括号显示在文字之后；带它的提示停留时间与带「报告问题」的一样长。组件画廊的提示板块演示了一条。
