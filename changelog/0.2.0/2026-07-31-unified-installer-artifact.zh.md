# 工具链：每个目标一个规范安装包，在线与离线通用

- **Date:** 2026-07-31
- **Type:** feature
- **Scope:** `tooling`, `ci`
- **PR:** [#142](https://github.com/Prism-Shadow/penguin-harness/pull/142)

[English](2026-07-31-unified-installer-artifact.md)

每次 Release 现在为每个目标恰好附加一个产物：`penguin-{linux,darwin}-{x64,arm64}.tar.gz`、`penguin-universal.tar.gz` 与 `penguin-win32-x64.zip` 都是扁平的安装包，各自封装了原生安装脚本、程序载荷（`payload.tar.gz` / `payload.zip`）以及该载荷的 SHA256 校验和。原始程序压缩包与 0.1.5 引入的五个 `*-offline` 外包装不再发布；`SHA256SUMS` 恰好覆盖这六个安装包。

两种安装方式消费的是同一个文件。在线时，`install.sh` / `install.ps1` 下载该安装包，对照其公布的 `.sha256` 校验——校验和现在一律强制；在线情况下「警告并跳过」的回退已经取消——然后打开扁平的外层，在暂存之前校验封装在内的载荷校验和。离线时，用户传送那一个文件、解压一次，运行其中自带的 `./install.sh`（或双击 `install.cmd`）；安装脚本自行找到同级的载荷，并在无网络访问的情况下校验同一份封装校验和，因此不需要另外携带校验和文件。

压缩包形态是按内容而非文件名探测的：顶层存在 `payload.*` 即为安装包，否则按顶层含 `penguin/` 的程序压缩包处理。这一次探测取代了此前的在线/离线分流，并使被固定的 0.1.6 之前版本与旧的本地压缩包仍可安装（见本批次的[向后兼容说明](2026-07-31-backward-compatibility.zh.md)）。在 Windows 上，扁平的外层意味着首次解压绝不会产生深层路径——PowerShell 5.1 的 260 字符限制从下载目录出发已不再可能触及——而 zip 形态探测读取条目列表却不解压；只有安装脚本才展开载荷，且直接展开进它那个路径很短的暂存目录。

规范的安装脚本以逐字节一致的形式随包同行——生成式的 POSIX 外包装入口（`penguin-installer.sh` 加上桩 `install.sh`）已经取消，取而代之的是那一个真正安装脚本中的同级载荷检测。该检测经过加固以保住 0.1.5 那条「绝不信任临时脚本旁边的压缩包」的性质：它只对一个真正名为 `install.sh` 的实体文件生效，而 penguin.ooo 的转发脚本现在把下载暂存在一个私有的 `mktemp -d` 目录中，而不是共享 `/tmp` 里的一个裸文件。Windows 转发脚本本就把安装脚本作为内存中的脚本块运行，其同级检测也仅限离线。

原地升级不再在那些会钉住使用中目录的文件系统上失败。`penguin update` 会在 CLI 进程仍从 `lib/` 中执行时重新运行安装脚本；在 Docker 下的 overlayfs 上，朴素的 `mv lib .old.<pid>/lib` 会以 `Device or resource busy` 失败并回滚。目录移动现在经三种策略逐级降级——整目录改名、逐条目改名到新建或已存在的目标、再到逐条目复制并清空源（POSIX 保证已 unlink 但仍打开的文件对使用它的进程依然有效）——并保留一个被钉住的空目录外壳供后续移入复用，回滚遵循同样的规则，失败信息则明说要先停止正在运行的 penguin 进程。一个封闭式测试把 `mv`/`rmdir` 打桩为拒绝任何触及已安装 `lib/` 的目录改名，并验证升级仍能干净完成。

两处 Windows 上的小刺从根上解决。载荷不再提供 `penguin.ps1` 启动器：PowerShell 在 PATH 上优先选 `.ps1` 而非 `.cmd`，而客户端 Windows 默认使用 Restricted 执行策略，于是全新安装后朴素的 `penguin` 命令会以「running scripts is disabled」失败；批处理文件豁免于该策略，PowerShell 与 cmd.exe 都会解析到 `penguin.cmd`，而由于升级会整体替换 `bin\`，重新运行安装脚本也就顺带移除了旧的 shim（见本批次的[向后兼容说明](2026-07-31-backward-compatibility.zh.md)）。另外，在向用户 Path 注册表值追加之后，安装脚本现在会广播 `WM_SETTINGCHANGE`——仅做一次原始注册表写入，会让资源管理器以及由它启动的每一个终端在下次登录之前都停留在陈旧的 Path 上，这正是一个全新的 PowerShell 窗口仍然找不到 `penguin` 的原因；完成提示现在说的是「打开一个新的终端窗口」，而不是新开一个标签页。

`scripts/package-release-bundles.sh` 取代 `package-offline-bundles.sh`，而发布工作流现在把载荷作为中间产物构建、打包这六个安装包，并在上传之前校验真实产出：外层校验和、精确的扁平成员集合、逐字节一致的安装脚本与载荷，以及一次通过的封装校验和。`scripts/test-installer.sh` 与 `scripts/test-installer.ps1` 取代了仅覆盖离线的测试脚本，以封闭方式覆盖安装包布局、把网络访问打桩为失败的离线安装、载荷被损坏时的拒绝、升级回滚、两层校验和、无回退的下载失败，以及被固定的旧版本，并接入既有的 Linux 与 Windows CI 任务。README、文档的安装页与落地页的安装文案都描述这条单产物流程。
