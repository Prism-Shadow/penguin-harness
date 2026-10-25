# 文档、Agent API 教程与 penguin-sdk 技能对齐 0.2.17

- **Date:** 2026-10-26
- **Type:** process
- **Scope:** `docs`, `landing`, `skills`, `tooling`
- **PR:** [#1323](https://github.com/Prism-Shadow/penguin-harness/pull/1323)

[English](2026-10-26-docs-corrections-0-2-17.md)

- **反向代理。** 配置参考、Docker 与安全模型三页写明：在终结 TLS 的反向代理之后，服务器需要 `PENGUIN_TRUST_PROXY=1`，代理必须原样保留外部的 `Host` 并把 `x-forwarded-proto` 覆盖为 `https`，否则 Web App 的每个写请求都会被 `403` `cross_origin_write` 拒绝。安全模型页把来源检查列为防跨站请求伪造的第三层，并写明带请求体却没有 `Content-Type` 的写请求返回 `415`，以及不受来源检查约束的两种写请求。`docker/compose.yaml` 中注释掉的 `PENGUIN_TRUST_PROXY` 一行同步改写。
- **会话 Cookie 名。** Server API 页写明浏览器的会话 Cookie 名为 `penguin_session_<port>`，以及何时仍用 `penguin_session`。
- **Agent API 教程。** 《通过统一 API 将 Agent 接入任意外部应用》改为展示 0.2.17 的流（`ping` 与 `[DONE]` 之间、从 `session_meta` 到 `task_end` 的记录），从 `session_meta` 取 Session id，`ask.mjs` 改为读取记录，配图换成本版的「试一试」截图。前置条件改为 0.2.17，并改用 API 标签页现在的「审批模式」与「运行设置 › 最大并发数」。
- **penguin-sdk 技能。** 失败的 `request_end` 把明细放在 `error_message`、原因放在 `error_code`（如 `auth`），而不是 `message`。技能版本 `2026.10.25.1`。
