# 沙盒设置

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#673](https://github.com/Prism-Shadow/penguin-harness/pull/673)

[English](2026-09-10-sandbox-settings.md)

沙盒——Agent 每次执行命令时的封禁策略——原本只能靠编辑寄存文档来配置。现在有了界面。

设置里新增 **沙盒** 页（管理员）：封禁模式（关闭 / 仅工作区可写 / 只读）、是否断开网络、以及对被封禁命令屏蔽的路径。`GET|PUT /api/admin/sandbox`；改动对下一次命令启动生效，无需重启，且设置随平台寄存，热更新后依然有效。

真正实施封禁的是插件提供的后端（bwrap、Seatbelt、MXC、DSH）。页面会列出已挂载的后端及各自实现的隔离维度；一个都没有时会明说——没有后端时选择模式不会产生任何约束，而一个让人误以为有保护的安全控件，比没有这个控件更糟。
