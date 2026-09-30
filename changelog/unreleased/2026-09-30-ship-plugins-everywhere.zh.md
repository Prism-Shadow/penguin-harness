# 每个提供 Web App 的构建都带上内置插件

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `cli`, `server`, `web`, `tooling`, `ci`
- **PR:** [#913](https://github.com/Prism-Shadow/penguin-harness/pull/913)

[English](2026-09-30-ship-plugins-everywhere.md)

在 Web App 里安装模块插件，除了桌面应用之外处处失败，报错为「'@prismshadow/penguin-plugin-sandbox-wsl' does not ship with this build; only builtin plugins can be installed.」。服务端只安装内置插件前缀（`scripts/build-plugins.mjs`）列出的插件，而这个前缀此前只进了桌面安装包与热推送；npm 包、安装包、Docker 镜像与源码检出里都没有，因此在这些形态下没有任何插件可装。

## 细节

- CLI 的构建把前缀生成在 `dist/` 旁的 `packages/cli/plugins/`，包的 `files` 列入 `plugins`。npm tarball 因此带上它，安装包与 Docker 镜像也随之带上：二者的 `lib/` 就是部署出的 CLI 包（`lib/plugins/`）。前缀装齐每个目标平台的原生二进制，在 Linux 发布作业上构建的这一份同样适用于 Windows 与 macOS。
- 服务端在程序入口上一级查找前缀，查找前先解析 `process.argv[1]` 中的符号链接。npm 全局安装与 Docker 镜像放上 PATH 的 `penguin` 都是指向 `dist/penguin.js` 的符号链接，未解析的链接会让查找落到 bin 目录的上一级。
- `pnpm dev` 的预构建（`scripts/dev-prebuild.mjs`）把前缀再放一份到 `packages/server/plugins/`，开发服务端在那里找到它：`tsx` 运行的是 `packages/server/src/index.ts`。前缀按内容缓存，首次构建之后这一步只是复制。
- 插件市场页上，当前构建没有附带的可安装行不再提供**安装**：整行淡化，状态写「本构建未附带」，悬停说明原因。服务端的 `400 plugin_not_shipped` 仍作兜底。
- CI 的 npm 打包作业在 CLI tarball 缺少前缀时失败。`scripts/test-installer.sh` 断言装好的安装包在 `lib/dist` 旁保留 `lib/plugins`（经过目录被占用时的升级路径同样如此），并且能从程序入口解析出内置插件。
- 体积：`@prismshadow/penguin-cli` 的 tarball 从 0.80 MB 增至 4.19 MB（解压后从 2.97 MB 增至 14.08 MB），每个安装包约增加 2.8 MB（`penguin-universal.tar.gz`：42.8 MB 增至 45.6 MB），Docker 镜像增加前缀本身在磁盘上的 11.1 MB。
