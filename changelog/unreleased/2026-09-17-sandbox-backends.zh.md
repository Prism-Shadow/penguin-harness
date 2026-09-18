# 沙盒后端：Windows 用 WSL、自带 bubblewrap、加载时自检，并移除 MXC

- **Date:** 2026-09-17
- **Type:** feat
- **Scope:** `core`, `server`, `plugins`, `build`, `tooling`
- **PR:** [#771](https://github.com/Prism-Shadow/penguin-harness/pull/771)

[English](2026-09-17-sandbox-backends.md)

Windows 有了沙盒后端：命令在 WSL2 发行版里、在 bubblewrap 下执行。Linux 上 bwrap 后端自带 bubblewrap。每个原生后端在加载时检查自己能否工作，封禁模式下临时目录可写，完全访问也能断网，MXC 后端被移除。

## Windows：WSL 后端

`sandbox-wsl` 让每条 Agent 命令在一个专用的 WSL2 发行版中、以非特权账户、在 bubblewrap 下执行。发行版缺省为 Ubuntu 24.04；Alpine 作为小体积选项保留，下载量约为前者的十分之一，代价是 musl 带来的兼容性限制。它实现 fs-write、network 与 mask-paths 三个维度。

- **发行版只读，Windows 磁盘不可见。** 工作区按模式以读写或只读方式挂回其 `/mnt/<盘符>/…` 路径。`network: "none"` 让命令处于空的网络命名空间。被屏蔽的目录挂 tmpfs，被屏蔽的文件挂 `/dev/null`。
- **被拒绝的写入会如实报错。** 遮盖 Windows 磁盘的挂载在工作区绑定完成后重新挂为只读，因此 `echo x > /mnt/c/Users/anything` 会失败，而不是「成功」写进一个随命令消失的 tmpfs。
- **域名可以解析。** WSL 把生成的 `resolv.conf` 放在发行版根目录之外，`/etc/resolv.conf` 只是指向它的符号链接。两个候选路径都以只读方式挂回，隐藏 `/mnt` 与 `/run` 不再破坏域名解析。
- **发行版内关闭 Windows interop。** 开着它时，在 bwrap 内启动的 Windows 程序就是普通的宿主进程：实测它在断网状态下仍写入了 Windows 磁盘并访问了外网。沙盒配置还隐藏了 WSL 存放 interop 套接字的 `/run`。
- **安装由几项任务完成，每项都报告当前步骤。** 安装 WSL 只弹出一次 Windows 授权，并实时跟随 `wsl --install` 的输出。初始化下载基础 rootfs（校验 sha256）、导入、用 apt 或 apk 安装 bubblewrap 与软件包列表，无需管理员权限。检查隔离效果通过沙盒执行真实命令并逐项列出结果。移除发行版会将其注销。发行版建好之前，后端拒绝加载并说明原因。
- **命令在 Linux 中执行。** Windows 工具链无法在沙盒内运行；由发行版的软件包列表提供 Linux 版本。
- **封禁接口可以携带环境变量。** 后端的 `ConfinedArgv`（以及平台的 `SpawnConfiner`）可以指定在启动时叠加到命令环境上的变量。WSL 启动器是由服务器自己的解释器运行的脚本，而桌面端的解释器是应用本身的二进制，只有在 `ELECTRON_RUN_AS_NODE` 下才会运行脚本。

## Linux 与 macOS：不再依赖主机

- **bwrap 插件自带 `bwrap`**，按架构各一份（`linux-x64`、`linux-arm64`），连同它加载的 libcap 与两份许可证。`scripts/vendor-bwrap.mjs` 在构建时从 conda-forge 取回，按确切 URL 与 sha256 钉死；哈希对不上即构建失败。该二进制通过 `$ORIGIN/../lib` 的 rpath 找到自己的库。
- **每次启动命令时的取用顺序：** 插件自带的，其次才是 PATH 上的 `bwrap`。两者皆无的主机仍然 fail closed，并提示去看 `kernel.unprivileged_userns_clone`。
- **Seatbelt 以绝对路径 `/usr/bin/sandbox-exec` 指名运行器**，PATH 里没有 `/usr/bin`、或有同名程序排在前面，都不再决定谁来封禁命令。
- bwrap 后端的实机封禁测试，在一台自身没有 bubblewrap 的主机上针对自带二进制跑通。

## 所有后端

- **后端在加载时检查自己能否工作。** bwrap 与 Seatbelt 经 `loadPenguinBwrapProvider` / `loadSeatbeltProvider` 加载。不在自己的平台上时让出；在自己的平台上则以不阻塞的方式运行基础配置探测，运行器缺失或拒绝该配置时带着原因拒绝加载。此前 Windows 主机会把 bwrap 算作覆盖全部维度的已挂载后端，把每条封禁策略都派给它。命令执行时的探测保留。
- **没有后端会悄无声息地缺席。** `SandboxService` 同时等待所有后端来源，按路由顺序记录：拒绝记为失败，null 记为让出。命令因此被拒绝时，消息把两者都点名：`backends not in use: <name> (<reason>); <name> (not for this host)`。
- **两种封禁模式下临时目录都可写。** `SandboxPolicy` 新增 `writableTemp`，沙盒服务在每条封禁策略上都设置它：bwrap 挂载私有、可写的 `/tmp`（`$TMPDIR` 在别处时一并绑定），Seatbelt 放行临时目录。此前 `read-only` 模式下临时目录只读，Shell 在执行任何指令之前就会失败。
- **完全访问也能断网。** `danger-full-access` 过去在读取网络设置之前就短路为「不封禁」。完全访问、网络放行且无屏蔽路径时仍不封禁；完全访问且断网或屏蔽路径时，会走到一个后端去执行这一维度，同时不限制文件。bwrap（在 Linux 上与在 WSL 发行版里）把根目录以读写方式绑定并仍 `--unshare-net`；Seatbelt 不拒绝任何写入但仍 `(deny network*)`。
- **移除了 MXC 后端。** `plugins/sandbox-mxc` 被删除，`@microsoft/mxc-sdk` 离开了工作区。内置插件注册表列出四个沙盒后端：bwrap、Seatbelt、WSL 与 DSH 适配器。
