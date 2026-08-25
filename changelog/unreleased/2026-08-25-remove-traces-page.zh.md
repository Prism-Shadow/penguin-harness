# 独立的 Trace 页已移除，轨迹在产生它的对话里阅读

- **Date:** 2026-08-25
- **Type:** change
- **Scope:** `web`, `docs`
- **PR:** [#PR](https://github.com/Prism-Shadow/penguin-harness/pull/PR)

[English](2026-08-25-remove-traces-page.md)

[会话轨迹只保留一个入口](2026-08-23-trace-one-entry-point.zh.md) 移除了应用内指向 `/traces` 的三处链接，但保留了页面本身，仍可通过 URL 进入。本次将其彻底移除：阅读轨迹只发生在对话的 Trace 面板中，这也是唯一的入口。

## 细节

- 删除 `/traces` 路由与页面，以及只有它渲染的 Trace 文件目录树（按 Agent 的惰性加载、工作区／Agent 分组开关，及其自有的分组翻页）。既有的 `/traces?sessionId=…` 链接不再可解析。
- **导入 Trace 移至「系统设置 → 通用」**，位于「显示 CLI 会话」下方——这是唯一别处没有的能力。选择接收的 Agent 并挑选 `.jsonl` 文件，挑选即确认；会话列表随之刷新，导入的 Session 出现在侧边栏中。导入接口按 Agent 划分的原因与旧对话框询问的原因一致：轨迹文件自带的 `session_meta` 无法指认本机的 Agent，其中的 `agent_state` 路径属于导出它的那台机器。
- 导出保持不变，并继续与它下载的文件待在一起：Trace 面板中针对所选文件的导出链接。
- 面板本身未作改动——同样的文件视图、性能时间线与事件列表，作用域为当前打开的对话。
- 服务端的 Trace 接口全部保持不变，按 Agent 的列表接口也在内：它是有文档的对外面，消失的只是 Web App 对它的使用。
- `Select` 现在会把 `aria-label` 透传到触发按钮，与原生 select 的行为一致——设置行中的 Agent 拾取器由此获得自己的名称，因为该行的标签命名的是动作而非控件。

## 已知欠缺

落地页的功能宫格仍展示着已移除页面的截图。文案描述的是能力，而这一能力仍由 Trace 面板提供；截图将在发布时重新采集。
