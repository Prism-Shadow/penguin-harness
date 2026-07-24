---
title: Web App 指南
description: 按页面组织的 Web App 使用指南：登录、Chat、Agent 管理、模型、用量与 Trace。
---

PenguinHarness 自带一个开箱即用的 Web App：多用户登录、流式对话、Agent 配置、模型与用量管理都在浏览器中完成。本文按页面组织，逐一介绍各页面的功能与操作。安装与首次启动见[快速开始](/quickstart)。

## 目录结构

```text
packages/web/src
├── api/          # fetch 封装 · 每个 API 一个函数(DTO type-only 来自 @prismshadow/penguin-server/api)· SSE 封装
├── state/        # auth / project / sessions / theme / locale 五个 context
├── lib/omni/     # OmniMessage 流 → 渲染视图模型 reducer;连接先行 + 去重的流控制器
├── components/   # ui 原语(modal / drawer / select …)与应用布局
└── features/     # chat / agents / skills / models / usage / traces / benchmark / admin 各页面
```

## 启动与登录

```bash
penguin web
# 打开 http://127.0.0.1:7364
```

初始账号为 `admin` / `penguin-2026`。系统不开放自助注册：账号由管理员在用户管理页创建；每个新用户会自动获得一个独立的初始 Project，命名为 `<userId>-default_project`。仍在使用初始密码时，页面会以横幅提示尽快修改。

登录状态保持 7 天（滑动续期）；管理员重置密码会使该用户的全部登录会话失效。

界面语言（中文 / English / 跟随系统）与主题（浅色 / 深色 / 跟随系统）可随时切换。

## Chat 页面（/chat）

### 新建会话

新会话从草稿开始：先选择 Agent、Workspace（服务器端目录浏览器选取）、审批模式、模型与思考等级，再发送第一条消息。Session 在首次发送时才真正创建，此后该会话的模型与 Workspace 即被锁定。切换思考等级或模型时，切换后的值即成为新的默认：思考等级立即写回所选 Agent 的 `model.thinking_level`，所选模型则作为下一个新会话的默认延续；进行中的会话沿用创建时的档位与模型（输入区只读展示）。

审批模式共四种：`allow-all`（全部放行）、`deny-all`（全部拒绝）、`read-only`（仅放行只读工具）、`always-ask`（每次询问），详见[工具与审批](/tools)。

### 流式渲染

- 模型文本逐 Token 渲染，思考块可折叠；
- 工具卡片可展开查看参数与输出，执行中显示实时计时；
- 子 Agent 以嵌套卡片呈现；上下文压缩以横幅提示；
- 每个 Task 结束后显示统计行：Token 用量、TPS、耗时与费用。

### 输入与快捷操作

- Enter 发送，Shift+Enter 换行，支持粘贴图片；
- 输入 `/` 打开快捷菜单：触发上下文压缩（`/compact`），或勾选已安装的 Skill——所选 Skill 会以 `<use_skills>` 块随消息发送；
- 输入 `@` 提及其他 Agent，将会话交接给它；
- 需要人工审批时，工具调用在消息流中内联显示“允许 / 拒绝”按钮；审批模式在会话中途可随时调整。

### 文件面板

文件面板可浏览 Workspace 目录树、预览文件（Markdown / HTML 渲染显示）、上传文件（单个 ≤ 14MB）与下载文件。

## Agent 管理（/agents）

列表页支持创建与删除 Agent；点击进入 `/agents/:agentId` 设置页，按标签页组织：

| 标签页 | 内容 |
| --- | --- |
| Overview | 基本信息，以及 Agent State 快照的导出 / 导入 |
| Prompt | AGENTS.md 与 system_prompt |
| Runtime | max_turns、model.*、compaction.* 等运行参数 |
| Tools | 内置工具表格、调用描述开关与 MCP Server 的 JSON 配置 |
| Vault | 环境变量条目，值以掩码显示 |
| Schedule | 定时任务（TOML 定义）：创建、编辑、启停、删除 |

定时任务按固定周期触发（最短 5 分钟），且仅在服务运行期间执行。

## Skill 库（/skills）

按分组浏览 Skill 库，可将 Skill 安装到指定 Agent，或一键带入 Chat 草稿快速调用。

## 模型配置（/models）

按 Provider 分组展示当前 Project 的模型表格。支持添加与编辑模型：以 `(provider, model_id)` 为唯一标识，凭据以掩码显示，可配置上下文窗口、最大输出长度（按模型的输出上限，覆盖 Agent 的 `model.max_tokens`——小上下文模型建议调低）、定价与视觉（vision）标记；可设置默认模型与视觉模型（在会话模型不支持图片输入时代为读图），并对任一模型做连通性测试。仅 Project Owner 可编辑，概念说明见[模型与 Provider](/models)。

## 用量统计（/usage）

- 筛选条件：Agent、模型、日期范围；
- 概览卡片：今日 / 近 7 天 / 累计用量；
- 图表：各 Agent 占比、各模型成功率、每日 Token 与费用趋势；
- 服务端错误面板：汇总最近的服务端错误记录。

## Trace 浏览（/traces）

按 Agent → 日期 → Session → Trace 文件逐级下钻。每回合卡片展示上下文占用环形图与缓存构成，并提供泳道式执行时间线与完整事件列表。Trace 的存储模型见 [Session 与 Trace](/sessions-and-traces)。

## Benchmark（/benchmark）

只读展示各 Benchmark 的评分板，可切换指标（得分 / 费用 / 耗时），下钻查看每个 Case 的多次运行结果，并跳转到关联的 Session 与 Trace。配合[自我进化](/self-improvement)工作流使用。

## 用户管理（/admin/users）

仅管理员可见：列出与创建用户、重置密码、删除用户（内置 admin 不可删除）。

## Project 与成员

侧边栏提供 Project 切换器，并支持创建新 Project。成员分为 Owner 与 Member 两种角色：Owner 负责成员管理，并独占模型、Vault、Schedule 的编辑以及各类删除操作。

## 生产部署

服务端自身托管构建好的 SPA（同源、SPA fallback），生产环境只需运行 `penguin web` 或 `penguin server` 一个进程。npm 安装包已内置前端产物；如需自定义静态目录，可用 `PENGUIN_WEB_DIST` 覆盖，见[配置参考](/configuration)。
