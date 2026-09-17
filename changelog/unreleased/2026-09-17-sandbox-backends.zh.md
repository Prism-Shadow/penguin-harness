# 沙盒后端：加载时自检、可写的临时目录，以及移除 MXC 后端

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `server`, `core`, `plugins`, `tooling`
- **PR:** [#771](https://github.com/Prism-Shadow/penguin-harness/pull/771)

[English](2026-09-17-sandbox-backends.md)

沙盒的原生后端不再在无法工作的平台上挂载，封禁模式下临时目录可写，Windows 上的 MXC 后端被移除。

## 细节

- **后端在加载时检查自己能否工作。** bwrap 与 Seatbelt 经 `loadPenguinBwrapProvider` / `loadSeatbeltProvider` 加载。不在自己的平台上时让出；在自己的平台上则以不阻塞的方式运行基础配置探测，运行器缺失或拒绝该配置时带着原因拒绝加载。此前两者在所有平台上都会构建 provider，于是 Windows 主机把 bwrap 算作覆盖全部维度的已挂载后端，把每条封禁策略都派给它。命令执行时的探测保留。
- **没有后端会悄无声息地缺席。** `SandboxService` 同时等待所有后端来源，按路由顺序记录：拒绝记为失败，null 记为让出。命令因此被拒绝时，消息把两者都点名：`backends not in use: <name> (<reason>); <name> (not for this host)`。
- **两种封禁模式下临时目录都可写。** `SandboxPolicy` 新增 `writableTemp`，沙盒服务在每条封禁策略上都设置它：bwrap 挂载私有、可写的 `/tmp`（`$TMPDIR` 在别处时一并绑定），Seatbelt 放行临时目录。此前 `read-only` 模式下临时目录只读，Shell 在执行任何指令之前就会失败。
- **移除了 MXC 后端。** `plugins/sandbox-mxc` 被删除，内置插件注册表只列出三个沙盒后端，`@microsoft/mxc-sdk` 离开了工作区。Windows 上仍有 DSH 适配器，只覆盖文件写入。
