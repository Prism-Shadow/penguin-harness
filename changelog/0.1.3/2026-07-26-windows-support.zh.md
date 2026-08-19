# Windows：一套像样的安装叙事——shell 选择、install.ps1，以及 win-x64 发布包

- **Date:** 2026-07-26
- **Type:** feature
- **Scope:** `core`, `cli`, `tooling`, `ci`
- **PR:** [#79](https://github.com/Prism-Shadow/penguin-harness/pull/79)

[English](2026-07-26-windows-support.md)

审计发现依赖图对 Windows 本就是干净的（`node:sqlite`、纯 JS 的 `tar`、没有原生模块），`npm install -g @prismshadow/penguin-cli` 也早已能得到一个可用的 `penguin`——但每一次 `exec_command` 都会以 `spawn bash ENOENT` 死掉，因为命令会话把 `spawn("bash", ["-lc", cmd])` 写死了。那一行就是产品层面的拦路虎；其余部分是打包与诚实。

## Agent 真的能跑了：shell 选择

命令会话现在每个进程解析一次自己的 shell：POSIX 逐位保持 `bash -lc`；在 Windows 上，解析器先在 PATH 中探测 Git-Bash（与面向 POSIX 的 Skill 生态兼容性最好；解析到 Windows 系统目录下的 `bash` 会被拒绝——那是 WSL 启动器，完全是另一套文件系统视图），然后是 `pwsh`，再是 `powershell`（`-NoLogo -NoProfile -Command`）。`PENGUIN_SHELL` 在任何平台都可覆盖，参数形态依 basename 推断。所选的 shell 会通过会话环境中新增的 `Shell:` 行告知模型，使它按自己实际拥有的语法写命令。那些 `system_config.yaml` 早于 `{{SHELL}}` 占位符的已有 Agent，通过一个窄口径的组装期回退获得同一行（仅 win32、仅在内存中、不做迁移；见向后兼容条目）——没有它，这些 Agent 的模型会永远把 bash 语法丢给 PowerShell。终止行为随平台而定：POSIX 保留进程组信号逐级升级；Windows 经 `taskkill /pid <pid> /t /f` 杀掉整棵进程树（无法向被管道连接的子进程投递控制台信号，因此 `input_command` 的 Ctrl-C 退化为硬杀——这一点如实记录，而不是假装不存在）。

## 新 CI 抓到的一个沙箱缺口

Windows 没有 `O_NOFOLLOW`，而工作区上传路径中的 `(O_NOFOLLOW ?? 0)` 在那里静默抹掉了对末段符号链接的守卫——这是一条切实可行的「预置一个符号链接，再通过上传覆盖 Workspace 之外的文件」的逃逸路径。win32 上的上传现在经 `lstat` 拒绝末段符号链接（对竞态而言是尽力而为；POSIX 仍保有打开时刻的原子性保证）。

## 安装与发布

仓库根目录的 `install.ps1` 与 `install.sh` 对应：提供 `PENGUIN_VERSION` / `PENGUIN_INSTALL_DIR` 旋钮、SHA256 校验、一次先改名后删除的分级替换（永不触碰 `data\`）、生成 `penguin.cmd` / `penguin.ps1` 两个 shim（均为 CRLF），以及一次用户 `Path` 更新——它以原始形式读写注册表值并保留其类型：朴素的 `[Environment]` API 会在读取时展开 `REG_EXPAND_SZ` 并以 `REG_SZ` 写回，从而不可逆地把用户形如 `%USERPROFILE%` 的条目固化成绝对路径。稳定 URL `https://penguin.ooo/install.ps1` 是一个转发脚本，会在执行前完整下载——被截断的流不可能装一半。发布工作流新增 `penguin-win32-x64.zip`（内置官方 Windows Node，`node.exe` 位于压缩包根目录，启动器为 CRLF）及其校验和，并与 `install.sh` 一同上传 `install.ps1`。升级方式是重新运行安装脚本；原地的 `penguin update` 在 Windows 上仍会拒绝，文档也如实说明。一行命令是 `irm https://penguin.ooo/install.ps1 | iex`，另以 `npm install -g`（Node ≥ 24）作为免脚本的替代方案；落地页展示两种安装方式，README 路线图勾掉了 Windows 支持。

## 让它保持为真：CI 与长尾

一个 `ci-windows` 任务（windows-latest，完整的构建/类型检查/测试，外加一道 PowerShell 语法解析门禁）现在与必需的 Ubuntu 任务并行运行；把它跑绿的过程暴露出四个货真价实的 Windows 问题（清理时的文件锁 `EBUSY`、一个错误的超时测试前提、上面那个符号链接缺口、对路径分隔符想当然的测试断言），均已修复。`.gitattributes` 固定 LF（`.ps1` 为 CRLF），使 Windows 检出不会挂在 Prettier 门禁上或损坏 shell 脚本。跨平台的环境变量处理以一个小型 runner 脚本取代了仅适用于 POSIX 的 `VAR=x` npm 脚本前缀，`penguin config lang` 在 win32 上干净地拒绝（并指向 `setx PENGUIN_LANG`），而安装脚本已用真实 PowerShell 针对一个本地伪造的 Release 做过功能演练：全新安装、保留 `data\` 的升级、校验和不匹配时中止，以及完整的 `irm | iex` 链路。已知并记录在案的限制：config/vault 文件没有 0600 语义（适用的是 NTFS ACL）、仅提供 x64 包（ARM64 经模拟运行）、`.ps1` shim 的执行策略说明、没有由 SIGTERM 驱动的优雅关停，以及——现已写入安装与工具文档、而不只是留在源码里——Windows 上 `input_command` 中的 Ctrl-C 会杀掉整棵命令会话树，而不是中断前台命令。让 Windows CI 保持诚实，也意味着给 win32 测试运行更长的 vitest 超时，并对一个 spawn 时序断言做平台门控；它捕获的每一次抖动都是真实的时序敏感性，而不是产品缺陷。
