# 电脑操作有了自己的版本号，为 npm 与 GitHub Release 只打一次包

- **Date:** 2026-11-21
- **Type:** process
- **Scope:** `plugins`, `ci`, `tooling`, `docs`

[English](2026-11-21-computer-use-own-version.md)

`@penguinharness/computer-use` 不再跟随 harness 的版本号。它的版本从 0.2.18 改为 0.1.0，服务端内嵌的插件索引与构建携带的离线包（`penguinharness-computer-use-0.1.0.tgz`）都用这个版本，此后只在插件本身改动时递增。自带版本号的插件列在新增的 `scripts/lib/own-version-plugins.mjs` 中。

## 发布

- `scripts/release-npm.sh stamp` 不再改写名单上插件的版本（`package.json` 与内嵌索引都不改），内嵌索引的条目与包本身的版本不一致时直接失败。
- release 作业用新增的 `scripts/pack-own-plugins.mjs` 为名单上的每个插件打包：打两次，字节相同，并与内置前缀携带的离线包比对，然后把这个 tarball 附到 GitHub Release 上。
- 新增的 `publish-own-plugins` 作业把附上的 tarball 原样发布到 npm（带 provenance），npm 上已有的版本跳过；仅在仓库变量 `NPM_TRUSTED_PUBLISHING` 为 `true` 时运行。npm 发布链（`publish-npm`）及其预检（`check-publishable.mjs --strict`）不再包含名单上的插件。

## 检查

- `scripts/check-plugin-versions.mjs` 要求：名单上的插件，凡是构建或打包所用的文件有改动（除 `test/`、`scripts/` 与 `vitest.config.ts` 之外的一切），`package.json` 的版本必须递增。
- CI 的 npm 打包作业在写入版本号之后的检出上为名单上的插件构建并打包两次；npm 上已有同一版本而字节不同时给出警告。

## 插件包

- 它对工作区包的 devDependencies 改写为范围（`workspace:>=0.2.0`），`pnpm pack` 因此不再把 harness 的版本号写进 tarball。
- 包内加入仓库 `LICENSE` 的副本，每个渠道的 tarball 都带着它。
