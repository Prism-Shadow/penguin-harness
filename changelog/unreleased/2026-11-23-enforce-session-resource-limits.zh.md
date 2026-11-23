# 创建资源时执行终端和内置浏览器上限

- **Date:** 2026-11-23
- **Type:** feat
- **Scope:** server, browser automation

[English](2026-11-23-enforce-session-resource-limits.md)

同一用户并发启动多个终端时共享终端上限。内置浏览器在桌面窗口创建标签页之前预留名额，弹出页面也受同一上限约束。调低上限会保留现有资源；关闭资源、使数量降到上限以下后即可新建。
