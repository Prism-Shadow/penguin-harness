# Web App 共用的「让 AI 创建」组件包

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#583](https://github.com/Prism-Shadow/penguin-harness/pull/583)

[English](2026-09-02-create-with-ai-kit.md)

Web App 里凡是通过表单创建的对象，都将多出第二条路径：向 Agent 描述它。本次改动加入了这条路径背后可复用的组件包——带魔法棒入口的分体式「创建」按钮、带可点击示例与折叠完整提示词预览的提示词面板、把提示词发送给 Project 默认 Agent 开启新对话（或只预填进新对话）的弹窗，以及草稿页在到达时自动提交预填草稿的能力。各创建页面在各自的改动中接入。

## 细节

- `features/ai-create` 导出桥接 hook（`useAiBridge`）、纯函数的草稿构造、默认 Agent 的选取（`default_agent`，否则取第一个）、提示词拼接、`AiCreatePanel`、`AiCreateModal` 与 `CreateMenuButton` / `AiWandButton` / `AiCreateButton`；`MAGIC_WAND_ICON` 字形加入 `components/ui/icons.tsx`。
- 技能标签页的「经对话导入」与记忆标签页的「经对话新增 / 编辑」跳转改走同一座桥；记忆标签页的跳转现在也会先把已输入未发送的草稿文本停放起来，而不是覆盖它。
- 草稿页识别路由状态中的 `autoSend`：所选 Agent 就位、模型已知且该 Agent 的技能列表加载完成后，输入框走「发送」按钮的同一路径提交，每个历史记录只提交一次（刷新不重发）。Project 尚无模型时保留预填草稿。
- 输入框的控制句柄新增 `submit()`。
- Web App 文档以双语描述了该模式。
