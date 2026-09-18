# Windows 的 WSL 沙盒后端，在自己的卡片上完成安装

- **Date:** 2026-09-17
- **Type:** feat
- **Scope:** plugins, server, web
- **PR:** [#771](https://github.com/Prism-Shadow/penguin-harness/pull/771)

[English](2026-09-17-wsl-sandbox.md)

Windows 上的沙盒后端 `sandbox-wsl`：每条 Agent 命令在一个专用的 WSL2 发行版中、以非特权账户、在 bubblewrap 下执行。发行版缺省为 Ubuntu 24.04；Alpine 作为小体积选项保留，下载量约为前者的十分之一，代价是 musl 带来的兼容性限制。它实现 fs-write、network 与 mask-paths 三个维度。

- **发行版只读，Windows 磁盘不可见。** 工作区按模式以读写或只读方式挂回其 `/mnt/<盘符>/…` 路径。`network: "none"` 让命令处于空的网络命名空间。被屏蔽的目录挂 tmpfs，被屏蔽的文件挂 `/dev/null`。
- **被拒绝的写入会如实报错。** 遮盖 Windows 磁盘的挂载在工作区绑定完成后会重新挂为只读：此前它是可写的 tmpfs，`echo x > /mnt/c/Users/anything` 会「成功」，写进一个只存活于该条命令、且从未抵达 Windows 的文件。自检现在会把「报成功的拒绝」判为失败。
- **域名可以解析。** WSL 把生成的 `resolv.conf` 放在发行版根目录之外，`/etc/resolv.conf` 只是指向它的符号链接，因此遮盖 `/mnt` 与 `/run` 会导致网络可达但所有域名解析失败。两个候选路径都以只读方式挂回，自检除了建立连接外也会解析一次域名。
- **发行版内关闭 Windows interop。** 开着它时，在 bwrap 内启动的 Windows 程序就是普通的宿主进程：实测它在断网状态下仍写入了 Windows 磁盘并访问了外网。沙盒配置还隐藏了 WSL 存放 interop 套接字的 `/run`。
- **安装由几项任务完成，每项都报告当前步骤。** 安装 WSL 只弹出一次 Windows 授权，并实时跟随 `wsl --install` 的输出。初始化下载基础 rootfs（校验 sha256）、导入、用 apt 或 apk 安装 bubblewrap 与软件包列表，无需管理员权限。检查隔离效果通过沙盒执行真实命令并逐项列出结果。移除发行版会将其注销。发行版建好之前，后端拒绝加载并说明原因。
- **命令在 Linux 中执行。** Windows 工具链无法在沙盒内运行；由发行版的软件包列表提供 Linux 版本。
