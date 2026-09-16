# Windows 沙盒改为以专用账户执行命令

- **Date:** 2026-09-16
- **Type:** feat
- **Scope:** plugins, server
- **PR:** [#728](https://github.com/Prism-Shadow/penguin-harness/pull/728)

[English](2026-09-16-windows-account-sandbox.md)

Windows 上的封禁不再走容器——那里可用的容器都跑不起本平台要用的 Shell。`penguin-winuser` 改以**身份**封禁：每条 Agent 命令以一个一无所有的本地专用账户执行，它能碰到什么，取决于安装时授予了什么。

- **新后端 `sandbox-winuser`**，三个隔离维度齐备。工作区向一个本地组开放——`workspace-write` 给修改权，`read-only` 给读取与执行；`network: "none"` 选中两个账户里被三条防火墙规则挡住出站（含回环）的那个；`mask-paths` 落为显式拒绝，其优先级高于工作区自身的授权。其余部分本就够不着：一个本地用户读不了另一个用户的目录。
- **安装需要一次管理员权限，而且是由人来跑的脚本**（`setup/penguin-sandbox-setup.ps1`）——创建本地账户与防火墙规则，不该由服务端背着人做。它留下：一个组、两个随机密码的账户、三条防火墙规则，以及一个记录它们的状态文件；`-Remove` 可原样撤除。密码由该文件的权限保护：Administrators、SYSTEM，以及运行本平台的那个账户。在脚本跑过之前，后端拒绝加载，沙盒卡片直接给出该命令，而不是让第一条 Agent 命令失败。
- **账户身份绝不进入命令行。** Provider 把被封禁的命令改写为一个携带策略的启动器，密码由启动器自己从状态文件读取——机器上任何进程都能看到别的进程的参数。
