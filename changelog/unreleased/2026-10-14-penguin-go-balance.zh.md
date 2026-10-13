# Penguin Go 账户余额

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `model-catalog`, `server`, `web`, `docs`
- **PR:** [#1086](https://github.com/Prism-Shadow/penguin-harness/pull/1086)

[English](2026-10-14-penguin-go-balance.md)

在模型分组标题栏中加入了 Penguin Go 账户余额，支持手动刷新和侧栏置顶。置顶余额在应用打开期间每五分钟刷新一次。

## 细节

- 读取 CNY 账本的整数单位，在换算为用户选择的显示币种之前保留完整精度。
- 使用已存的分组密钥，仅以 `PENGUIN_GO_API_KEY` 作为回退。余额查询不使用单个模型的密钥或其他供应商的环境变量密钥。
- 向授权所用的可信 `PENGUIN_GO_ORIGIN` 发起余额查询。授权和余额查询默认使用 `https://go.penguin.ooo`，并保留了显式配置 `https://token.penguin.ooo` 的支持。
- 复用了现有余额缓存和并发请求处理，按 Project、供应商、端点和密钥分别保存结果。手动刷新跳过缓存。
