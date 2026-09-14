# 沙盒设置

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#674](https://github.com/Prism-Shadow/penguin-harness/pull/674)

[English](2026-09-10-sandbox-settings.md)

沙盒——Agent 每次执行命令时的封禁策略——原本只能靠编辑寄存文档来配置。现在有了界面，而且用的就是插件配置那一套，不另开页面。

- **设置 → 插件里的一张卡片**（管理员），排在最前：封禁模式（关闭 / 仅工作区可写 / 只读）、是否断开网络、以及对被封禁命令屏蔽的路径。它是沙盒贡献的一个设置分组——一份 schema，与插件的选项一样绘制、校验、存储（`plugin-config:sandbox`，经 `/api/admin/plugin-config`）——改动对下一次命令启动生效，无需重启，重启后仍然保留。
- **后端自己的选项画在卡片里。** 后端在自己的 `SandboxModule.providers` contribution 上声明 `configuration`；每个已挂载后端的选项画在沙盒卡片内、随卡片一起保存（`plugin-config:sandbox:<后端>`），后端在每次启动命令时从策略新增的 `options` 里读取。bwrap 声明了程序路径与探测超时，Seatbelt 与 MXC 声明了程序路径；换了程序会重新探测。
- **谁在实施封禁，明说。** 卡片列出已挂载的后端及各自实现的隔离维度；一个都没有时会明说——没有后端时选择模式不会产生任何约束，而一个让人误以为有保护的安全控件，比没有这个控件更糟。
