# Linux 沙盒在默认的 Ubuntu 上通过 Landlock 工作

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`, `core`, `docs`

[English](2026-10-03-sandbox-landlock-floor.md)

此前在 Linux 上打开沙盒只会提示安装 `@penguinharness/sandbox-bwrap`。Ubuntu 23.10 及以后的版本只把非特权 user namespace 交给带有 AppArmor profile 的程序，除桌面 `.deb` 外的每种安装上 bubblewrap 都被拒绝，于是在有人完成 root 操作之前，每种封禁模式都会拒绝每条命令。现在卡片会在它旁边一并安装 `@penguinharness/sandbox-dsh`。bubblewrap 被拒绝时，DSH 适配器通过 Landlock 约束文件写入，既不需要 namespace，也不需要 root；内置预设都不限制网络，因此无需任何主机操作，全部可以实施。

## 路由

- 在覆盖某条策略的已挂载后端中，实现维度最多的那个负责，注册顺序只用于打破平局。bubblewrap 与 DSH 适配器都加载时，每条策略都由 bubblewrap 负责，与插件列表里的先后顺序无关。
- 只挂载了适配器时，需要网络隔离或屏蔽路径的策略仍按 fail-closed 拒绝，并写明适配器覆盖什么、bubblewrap 为何未启用。

## 沙盒卡片

- 沙盒条目的 `backend.recommended` 改为列表：Linux 上是 `@penguinharness/sandbox-bwrap` 与 `@penguinharness/sandbox-dsh`，macOS 与 Windows 各一个包。没有安装后端时打开开关，会提示安装整个列表，并依次安装。
- 卡片的「Backends:」一行改为写明本机实施什么、由什么实施，例如 `本机实施：文件写入，由 Landlock (dsh-local) 实施。本机不实施：网络隔离、仅本机网络、屏蔽路径。`每个已安装但未启用的后端移到这一行下方折叠的**更多信息**里，附原因，并说明保存卡片会重新检查。设置提示为此可以带 `details` / `detailsZh`。
- 有后端在用、但没有后端能隔离网络时，预设表里的「无网络」显示为灰色并写明在用的后端，保存时选择它会被拒绝，与「仅本机」一致。
- 「已保存的策略无法实施」的警告也覆盖断开网络或带屏蔽路径的完全访问（在预设之前保存的设置）。
- 沙盒后端可以声明 `mechanism`（core 的 `SandboxProvider`）：bubblewrap 声明 `bubblewrap`，DSH 适配器声明其链条选中的一级（`Landlock`、`bubblewrap`、`Seatbelt` 或 Windows ACL 运行器，部分实施时带 `(partial)`）。

## 后端

- DSH 适配器在加载时运行其链条的探测，因此在没有任何一级可用的主机上，加载会带着 DSH 的原因失败，而不是挂载一个拒绝每条命令的后端。
- bubblewrap 的拒绝原因带上 bwrap 的输出（`setting up uid map: Permission denied`，或启动错误），并说明 Ubuntu 上的 root 操作是可选的，只增加网络隔离与屏蔽路径。

## 输入框

- 会话的沙盒视图报告 `maskPathsSupported`，策略带屏蔽路径时还报告 `masksPaths`。没有后端能屏蔽路径时，每个预设都显示为灰色，说明屏蔽路径会让每条命令被拒绝。
- 「无网络」的原因改为说明本机的沙盒只封禁文件。

## 文档

- CLI 快速开始的「Ubuntu 上的沙盒」一节、设置与 Server API 页面，以及两个后端的 README 都改为描述默认情形：无需任何操作即可工作，通过 Landlock 只约束文件写入，root 操作只增加网络隔离与屏蔽路径。AppArmor profile 的路径按插件仓的布局改正为 `plugin-store/packages/@penguinharness/sa/nd/sandbox-bwrap/…`。
