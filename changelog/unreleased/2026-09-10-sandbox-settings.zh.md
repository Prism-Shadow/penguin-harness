# 沙盒设置

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#674](https://github.com/Prism-Shadow/penguin-harness/pull/674)

[English](2026-09-10-sandbox-settings.md)

沙盒——Agent 每次执行命令时的封禁策略——原本只能靠编辑寄存文档来配置。现在有了界面，而且用的就是插件配置那一套，不另开页面。

- **设置 → 插件里的一张卡片**（管理员），排在最前：封禁模式（关闭 / 仅工作区可写 / 只读）、是否断开网络、系统临时目录是否可写（默认开启，两种模式都生效——bwrap 挂载私有的 `/tmp`，Seatbelt 放行临时目录，MXC 加入 `%TEMP%`/`%TMP%`；不开启时 MXC 下的 Git Bash 会以 0xC0000142 启动失败）、以及对被封禁命令屏蔽的路径。它是沙盒贡献的一个设置分组——一份 schema，与插件的选项一样绘制、校验、存储（`plugin-config:sandbox`，经 `/api/admin/plugin-config`）——改动对下一次命令启动生效，无需重启，重启后仍然保留。
- **后端自己的设置画在卡片里。** 有设置的后端在 `SandboxModule.providers` contribution 旁另声明一个 `parent: "sandbox"` 的分组，并在每次启动命令时经 `PluginConfig` 自己读取；该分组画在沙盒卡片内、随卡片一起保存。bwrap 声明了程序路径与探测超时，Seatbelt 与 MXC 声明了程序路径；换了程序会重新探测。
- **谁在实施封禁、谁没有及原因，都明说。** 卡片列出正在使用的后端及各自实现的隔离维度；其余每个后端都点名并给出原因：bwrap、Seatbelt 与 MXC 现在在加载时检查自己能否在本机工作——平台对不对、SDK 装没装、运行器能否通过探测——不能时带着原因拒绝加载，因此 Windows 主机再也不会把策略派给 bwrap，也不会有后端悄无声息地缺席。当保存的模式需要的隔离没有任何可用后端实现时，卡片警告 Agent 的每条命令都会被拒绝；一个可用后端都没有时，说明选择模式不会产生约束。
