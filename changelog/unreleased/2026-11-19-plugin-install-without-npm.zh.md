# 本机没有 npm 时，没有依赖的插件也能安装与卸载

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1664](https://github.com/Prism-Shadow/penguin-harness/pull/1664)

[English](2026-11-19-plugin-install-without-npm.md)

桌面端的服务端运行在 Electron 的 utilityProcess 中，身旁没有 npm，因此在那里从插件市场安装、经发布索引的 release 渠道安装、从 zip 或包目录导入插件，以及卸载插件，全都失败。安装器现在每次操作前都查找 npm：找到时一切照旧交给 npm；找不到时，不需要 npm 的包由服务端自己安装与卸载，需要 npm 的包则拒绝并说明原因。

## 细节

- 需要 npm 的包：该版本声明了 `dependencies`、`optionalDependencies`、`bundleDependencies` 或未标为可选的 `peerDependencies`，带安装脚本（`preinstall`、`install`、`postinstall`，或 registry 文档中的 `hasInstallScript`），或带 `binding.gyp` 而没有 `gypfile: false`。`prepare` 不算：npm 只为 git 与目录来源运行它。`os`、`cpu` 或 `libc` 排除本机时同 npm 的 EBADPLATFORM 一样拒绝安装。
- 按包名安装：服务端从「插件源」设置的 registry（未设置即官方 registry）读取包的 abbreviated 文档，每个地址之后依次尝试「插件镜像」改写出的镜像地址。版本按 npm 的规则选取 dist-tag、精确版本与 `^`、`~`、x 范围；其他范围写法拒绝，并请用户给出版本。registry 没有该包或该版本时，同 npm 的 E404 与 ETARGET 一样落到发布索引的 release 渠道。
- 下载有上限（文档 32 MB、tarball 64 MB），每个地址各自限时；整个 tarball 或 release 资产先按固定的 sha512 校验，再解包。地址给出的字节不符即换下一个地址，没有固定 sha512 的版本拒绝。地址须为 https，或本机回环上的 http，按解析后的 URL 判断，每一跳重定向同样如此，不会从 https 降到 http。
- 下载之后，再按同一规则检查包自己的 package.json 与文件：registry 文档没说、tarball 里却需要 npm 的包同样拒绝。
- 解包只写普通文件：目录、符号链接、硬链接与设备文件一律跳过（同 npm 跳过链接）；任一条目为绝对路径或含 `..`、反斜杠、冒号即整包拒绝，一个文件同时是另一个文件的目录、两个名称仅大小写或 Unicode 规范化不同，也整包拒绝；扩展头、全局头与单个零块按 node-tar 的读法处理；解包后合计不超过 256 MB、2 万个文件。包自己的 package.json 须是所请求的名称与版本。每个 `bin` 目标都置为可执行。
- zip 或包目录只安装 `npm pack` 会发布的文件，规则与 npm 相同（npm-packlist）：各目录的 `.npmignore`，没有时用其 `.gitignore`，`files` 字段，npm 默认忽略的名称；package.json、README、许可证、`main`、`browser` 与每个 `bin` 目标始终在内。被 git 忽略的 `.env` 因此既不进前缀，也不进 `archives/`。这些文件由服务端打成 `npm pack` 本会写出的 `archives/` tarball。
- release 渠道校验过的资产留在 `archives/`，记为 `file:archives/<资产>`，日后运行 npm 时从磁盘安装，不再去取 release 地址。
- 文件先写入 `<prefix>/.staging/`，换入时先把已安装的目录改名移开；Windows 上改名遇到 EPERM、EACCES 或 EBUSY 时退避重试，最长一分钟，同 npm 的 graceful-fs。换入失败即把已安装的版本移回、拒绝本次安装；连移回也失败时，旧版本留在原处并标记保留，清扫不动它，拒绝消息写明它在哪里。一小时前的 staging 残留在下次安装时清掉。途中文件系统的任何失败（空间不足、名称或路径过长、前缀的 package.json 解析不了）都以拒绝的形式说明，路由回答 400。前缀的 package.json 按 npm 的写法记录（`^<所选版本>`，所请求的范围容不下它时记该范围，或 `file:archives/<tarball>`），并删除 npm 的隐藏锁文件，日后运行 npm 时从磁盘读取依赖树。
- 不经 npm 的卸载移走目录与 package.json 中的条目，并清理不再被引用的 tarball。
- 在没有 npm 的机器上安装需要 npm 的包时拒绝，消息列出它的依赖或脚本与找过 npm 的位置，并说明安装自带 npm 的 Node.js（https://nodejs.org）后重启 PenguinHarness 即可。链接（git 仓库或 https tarball）仍需要 npm。不来自 npm 的失败不再以 `npm:` 开头；不经 npm 安装后又被路由移除的包，不再被说成已运行过安装脚本。
- 一次没有找到 npm 的查找不再保留到重启，下一次操作会重新查找。
