# 外部内置插件按锁定的 tarball 放进内置前缀

- **Date:** 2026-11-20
- **Type:** process
- **Scope:** `tooling`, `ci`

[English](2026-11-20-external-builtin-plugins.md)

构建可以随带从其他仓库发布的内置插件（PRFC-0036，设计 [#503](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)）。`packages/server` 中不是工作区包、锁定到一个确切版本的 `@penguinharness/*` 依赖，按 `pnpm-lock.yaml` 记下 sha512 的那个 tarball 放进内置前缀，于是热推送、发行包、桌面端、随带的镜像与 Docker 镜像都把它当作内置插件带上。目前尚未锁定任何此类插件。

## 细节

- `scripts/build-plugins.mjs` 为每个外部包取锁定的 tarball：先看 `PENGUIN_PLUGIN_TARBALLS=<dir>`，再从 npm（先查其缓存），最后从插件索引中该版本条目的 github 通道取；tarball 的 sha512 与锁不一致时构建失败。带代码入口的包解开放进前缀并记入前缀的清单；不带代码入口的只进插件库；声明了运行时依赖的令构建失败。完整性计入前缀的缓存键。
- `scripts/library-payload.mjs` 从 pnpm 安装的位置把外部包带进推送的插件库，连同它发布时自带的 `ifaces.json`；没有 `ifaces.json` 的包令载荷失败。
- `scripts/check-external-plugins.mjs` 报告 `packages/server`、`packages/cli` 与 `packages/desktop` 之间不一致的锁定版本、以范围代替版本、以及锁未解析到所锁定版本的情形；加 `--index` 时另比较锁中的 sha512 与插件索引的条目，读不到索引时改为警告。CI 的 npm 打包任务以 `--index` 运行它。
- 发布时对 `packages/server/src/plugin/builtin-index.json` 的版本戳只改本仓库 `plugins/` 包的条目。
- `plugins/README.md` 与开发技能的发布说明介绍外部内置插件及升级锁定版本的做法。
