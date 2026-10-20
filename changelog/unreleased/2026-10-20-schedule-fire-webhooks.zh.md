# 手工触发定时任务，以及用 webhook 触发

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `server`
- **PR:** TBD

[English version](2026-10-20-schedule-fire-webhooks.md)

定时任务现在可以在计划之外触发一次：`POST .../schedules/:name/fire` 立刻多跑一次，不消耗计划本身（一次性任务的正式触发照常发生），并返回跑进的会话。每次触发——计划内或手工——都会在新表 `schedule_firings` 里记一行，点火历史可查。在此之上，每个任务可以拥有一个 webhook 触发器：外部系统 POST 一个 bearer URL 即触发一次运行，带按约定的幂等键、HMAC-SHA256 发送方校验，以及可重放的投递审计。

## 手工触发

- `POST /api/projects/:projectId/agents/:agentId/schedules/:name/fire` 仅所有者可调，与其他写入一致。返回 `{ sessionId, queued }`：目标会话忙时 `queued`，轮到空闲再发。
- 未知任务 404（`schedule_not_found`）；无效文件与丢失的会话 400（`schedule_invalid`/`schedule_session_missing`，丢失会话同时把任务标 invalid，与计划触发一致）。
- 手工触发只推进上次触发时间；`schedule_firings` 以 `manual = 1` 记录。

## Webhook 触发器

- 一任务最多一个触发器，在 `schedules/:name/webhook` 下管理（创建/读取/更新/轮换/删除）：写操作仅所有者，读成员可读。token 只在创建与轮换时返回一次；读取时隐去，只给后四位 hint（入口路径里嵌着 token）。
- 公开入口 `POST /api/webhooks/schedules/:token`（无鉴权，token 即凭证）。两种约定：`generic`（`Idempotency-Key`）与 `github`（`X-GitHub-Delivery` + `X-Hub-Signature-256`）。配置了密钥则必验签（timing-safe 比较），失败落 `rejected` 行并回 401。
- 重复的幂等键直接回原投递（`duplicate`，带原 delivery 与 run id），不再点火；停用/终态/无效任务回 `ignored` 不点火；未知 token 404、非法 JSON 400、超 256 KiB 的包 413。
- `GET .../webhook/deliveries` 看审计；`POST .../deliveries/:id/replay` 故意把同一负载再跑一次（新无键行，headers 记来源）。
- 会话建不出来时 500，投递保持 `queued`，调用方重试还有机会。入口另有内存级按 IP 滑窗（60/分钟），超了 429。
