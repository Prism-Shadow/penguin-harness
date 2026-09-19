# 从模型库连接 ChatGPT 订阅

Date: 2026-09-19
Type: feature
Scope: core, server, web

[English](./2026-09-19-chatgpt-subscription.md)

在模型库添加了**连接 ChatGPT**。设备授权导入了账户可见的订阅模型，供 Penguin 的
代理循环、工具、审批和历史使用。

## 项目凭据

将订阅凭据保存在项目现有配置文件中，在过期前刷新，并防止旧模型表单保存覆盖新令牌。
断开连接清除了后续请求使用的凭据，包括现有会话的后续请求。

## 实验性传输

为未公开的 Codex 后端添加了 AgentHub 传输。独立的 Codex 委派插件仍然可用。
订阅用量不带美元价格；输出限制由后端控制，且不接受 temperature。
刷新操作在同一个服务进程内串行执行。
