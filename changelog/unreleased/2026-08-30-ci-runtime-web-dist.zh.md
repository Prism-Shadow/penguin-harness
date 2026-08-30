# 未打包的 runtime artifact 带上 Web App,缺少它时打包直接失败

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `ci`, `desktop`, `tooling`

[English](2026-08-30-ci-runtime-web-dist.md)

CI 的 `penguin-runtime-*` artifact——为热更新用途构建的未打包桌面树——自该 job 引入起就没有 `web-dist`:它的构建 filter 只包含 desktop 包及其依赖,而 web 包不在其中(应用是靠 electron-builder 的文件映射带上 web 构建的,不是 import),electron-builder 又会静默跳过不存在的 `from:` 源。跑这份树的机器,除非数据根里有可还原的热推 web 版本,否则每个页面都答 404。GitHub Release 安装包先构建整个 workspace,从未受影响。

## 细节

- `runtime` job 在构建 desktop 包的同时构建 `@prismshadow/penguin-web`。
- 桌面的 `pack*` 脚本、`runtime` job 和发布矩阵都在 electron-builder 之前运行 `scripts/preflight.mjs`,没有 web 构建就打包会直接失败并给出修法。
- CI 检查打包树的 `verify-packed-cli.mjs` 同样要求 `web-dist/index.html`。
