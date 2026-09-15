# 工作区检出直接从仓库的 plugins/ 目录加载插件，CI 要求版本号随内容变化

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `core`, `ci`
- **PR:** [#725](https://github.com/Prism-Shadow/penguin-harness/pull/725)

[English](2026-09-14-plugins-from-workspace.md)

## 变更内容

- 在工作区检出里，core 的插件 loader 改为直接读取仓库的 `plugins/<name>/` 目录，而不是 pnpm 注入到 `node_modules` 下的副本。那份副本是安装时的快照，只在包的 `build` 脚本跑过之后才会重新同步——插件没有 build 脚本——因此上次安装之后新增的技能、改过的 `plugin.json` 版本号都到不了正在运行的 `pnpm dev`，也到不了服务端自己的测试：插件库一直显示旧版本，已安装的 Agent 也永远看不到可更新。这条重定向只在 `pnpm-workspace.yaml` 之下生效；npm 安装与打包的桌面应用仍解析自己的副本。
- CI 新增「plugin versions」任务：改动了 `plugins/<name>/` 下文件的 PR 必须同时改动该插件 `plugin.json` 的版本号（`YYYY.MM.DD.N`），因为已安装副本正是靠这个版本号得知自己落后于插件库。`scripts/check-plugin-versions.mjs` 与 base 提交比对，无可比对时直接通过。
