# Windows：安装包自带 bash，Agent 的 shell 不再取决于机器

- **Date:** 2026-07-27
- **Type:** feature
- **Scope:** `core`, `tooling`
- **PR:** [#95](https://github.com/Prism-Shadow/penguin-harness/pull/95)

[English](2026-07-27-windows-bundled-shell.md)

`penguin-win32-x64.zip` 现在在 `git/` 下附带 **MinGit**，当机器上没有自己的 Git for Windows 时，`exec_command` 就使用它。

## shell 此前取决于机器上装了什么

Windows 上的 shell 此前取决于机器上碰巧装了什么：用户有 Git for Windows 就是 `bash`，否则就是 PowerShell。这使得同一个 Agent 跑同一个 Skill，在两台 Windows 机器上表现不同，而且这种退化是无声的——一个为 POSIX shell 写的 Skill 在 PowerShell 下不会响亮地失败，它会以奇怪的方式失败。最尖锐的例子：`curl -fsSL <url>` 在 Windows PowerShell 5.1 下会解析到内置的 `curl` → `Invoke-WebRequest` 别名，返回一个 cmdlet 参数绑定错误，而模型从这种错误中恢复的能力，远不如从「命令未找到」中恢复。

## 附带了什么

MinGit 的 `usr/bin/sh.exe` **就是 GNU bash**——最小化的 Git for Windows 构建把 bash 装在 `sh` 这个名字下。因此这个包以压缩后 37MB（安装后约 91MB）的代价，换来一个真正的 bash、大约六十个核心工具，以及 `git.exe`；而要达到完全对等，完整的 PortableGit 需要约 350MB 的解压体积。

不涉及任何 PATH 布线。MinGit 的 `etc/profile` 默认 `MSYS2_PATH_TYPE=inherit`，因此一个登录 shell（`-lc`，未改动）会得到 `/mingw64/bin:/usr/local/bin:/usr/bin:/bin:<继承的 Windows PATH>`——自带工具与 git 在前，Windows PATH 仍排在它们之后。这正是 MinGit 不带 `curl` 或 `tar` 也无所谓的原因：System32 的 `curl.exe` 与 `tar.exe` 照常解析得到，而且在 bash 里它们是真正的二进制程序，而不是 PowerShell 别名。

## 解析顺序

`PENGUIN_SHELL` → PATH 上的 `bash` → **自带的** → `pwsh` → `powershell`。

自带的那份刻意排在 PATH 探测*之后*：用户自己的 Git for Windows 携带完整的 MSYS 用户态（curl、tar、less、perl……），而 MinGit 只带约六十个工具，因此两者都存在时，用户那份是更好的 shell。自带的是下限，而不是首选。`pwsh` / `powershell` 仍然可达，供什么都不附带的 npm 安装使用。解析出的 shell 向模型报告为 `bash`，因为它本来就是，而这也正是 Skill 生态所面向的。

安装脚本把 `git/` 当作与其他载荷目录一样对待——升级时替换，绝不触碰数据目录——而启动器 shim 把该路径以 `PENGUIN_BUNDLED_SHELL` 公布出来。

## 许可

MinGit 是 GPLv2，因此新增了根级的 `THIRD-PARTY-NOTICES.md`，记录两个被附带的组件——Node 运行时与 MinGit——包括各自的许可证文本位于包内何处，以及各自对应的源码在哪里。所采用的 Git for Windows 发布被固定到一个确切的 tag，因此该声明只需指明单一版本，而附带的字节就是未经修改的官方发布产物。

## 代价，明说

Windows 下载体积大约翻倍（约 65MB → 约 100MB），安装体积增长约 91MB；PowerShell 5.1 的 `Expand-Archive` 要多解压 368 个文件，因此全新安装会明显变慢。这个包也意味着一个**混合**环境——MSYS 核心工具与原生 node、git 并存——而不是一个 POSIX 环境，因此 MSYS 的路径转换仍是需要留意的事。`MSYS_NO_PATHCONV` / `MSYS2_ARG_CONV_EXCL` 刻意不设置：与真实 Git Bash 语义保持一致是最不令人意外的默认，而偏离它会让自带的 shell 表现得与 PATH 上那个不一样。
