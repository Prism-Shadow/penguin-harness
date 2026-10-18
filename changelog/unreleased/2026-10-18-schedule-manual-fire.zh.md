# 定时任务可手工触发一次

- **Date:** 2026-10-18
- **Type:** feat
- **Scope:** `server`、`cli`、`web`、`docs`
- **PR:** TBD

[English](2026-10-18-schedule-manual-fire.md)

定时任务现在可以在计划之外立即手工触发一次：`penguin schedule run <name>`、Agent 设置 Schedules
页与聊天 dock 面板行菜单里的"立即触发"按钮，底层都是 `POST .../schedules/:name/fire`。

## Details

- 手工触发是额外跑一次，不消费原时间表：只更新最近触发时间，不消费 slot，一次性任务真正到点的那次照样会跑。
- 分发与到点触发一致——绑定的会话或新建会话，目标忙则排队，返回 `{ sessionId, queued }`。
- 停用的任务照样可触发；已 settle 的（done/missed/expired）已归档，与其他列表一致报 `schedule_not_found`。
  解析失败、模型引用非法、绑定会话丢失以带码 400 失败（`schedule_invalid`、`schedule_session_missing`）。
- 触发仅 owner 可执行，与其他定时任务写操作一致。
