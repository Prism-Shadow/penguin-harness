# Penguin Go：在模型库页授权密钥的内置模型分组

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `model-catalog`, `server`, `web`, `desktop`, `docs`
- **PR:** [#716](https://github.com/Prism-Shadow/penguin-harness/pull/716)

[English](2026-09-16-penguin-go.md)

模型目录新增 **Penguin Go** 分组（`penguin-go`），即 `https://token.penguin.ooo/api` 中转，排在 TokenDance 之后。组头提供与 TokenDance 相同的「授权密钥」操作，背后走平台自己的设备授权流程；另有「同步」操作，用已存的 key 按平台目录刷新该分组。

## 细节

- 分组预置 Gemini 3.8 / 3.7 / 3.6 / 3.5 Flash、3.5 Flash-Lite、3.1 Flash-Lite 与 3.1 Pro（Preview），走 Google 协议；以及 `deepseek-flash`（**DeepSeek V4.1 Flash**）与 `deepseek-v4-pro`（**DeepSeek V4 Pro 0813**），走 DeepSeek 客户端。预置行存牌价，平台的促销随授权与同步下发（见[促销存到 Project 文件之外](2026-09-16-model-promotions-in-database.zh.md)）。
- **授权密钥**由服务端代办：`POST /api/projects/:projectId/platform-auth/start` 向平台登记设备密钥，返回本地流程 id 与授权地址；`GET …/:flowId/status` 轮询一次性投递；`…/retry` 与 `…/cancel` 分别重试失败的写入、放弃流程。仅 owner 可用。设备密钥与签发的 key 只留在服务端进程内，流程十分钟内过期。成功后 key 写进该分组全部模型，并按平台目录补齐缺失模型。
- **同步**（`POST /api/projects/:projectId/platform-auth/sync`，仅 owner）用已存的 key 拉取平台目录：补齐缺失模型，刷新牌价、协议与促销，从不删除本地行；结果与「同步预置」同一口径报「新增 N、更新 M」或「已是最新」；key 被平台拒绝时引导回授权。
- 平台响应在写入前逐项校验（大小、client id、key 长度、模型 id、路由、端点、上下文与输出上限、视觉标志、美元定价及折扣一致性）。平台返回 429 时，服务端以 HTTP 429 加 `Retry-After` 透出。
- 该分组两种协议的凭据都从 `PENGUIN_GO_API_KEY` / `PENGUIN_GO_BASE_URL` 解析，绝不借用 Google 或 DeepSeek 的变量，连通性、视觉与协议探测同样如此。手动加入该分组的模型必须填中转的 base URL。
- 平台地址是服务端配置 `PENGUIN_GO_ORIGIN`（缺省 `https://token.penguin.ooo`）：只接受 HTTPS，仅环回地址的集成环境允许明文 HTTP。
- 桌面端改为在系统浏览器中打开授权页，Windows 不再为 `about:blank` 弹出协议选择框。
