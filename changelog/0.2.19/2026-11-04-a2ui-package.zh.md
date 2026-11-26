# A2UI 移出 core，成为独立的包

- **Date:** 2026-11-04
- **Type:** refactor
- **Scope:** `a2ui`, `core`, `ui`, `cli`, `server`
- **PR:** [#1474](https://github.com/Prism-Shadow/penguin-harness/pull/1474)
- **Breaking:** yes — 移除 `@prismshadow/penguin-core/a2ui`，改从 `@prismshadow/a2ui` 引用

[English](2026-11-04-a2ui-package.md)

A2UI 语法从 `packages/core/src/a2ui/` 移入新的工作区包 `packages/a2ui`，以 `@prismshadow/a2ui` 发布。core 不再导出 `@prismshadow/penguin-core/a2ui`，也不保留别名。设计见 [penguin-harness-design #421](https://github.com/Prism-Shadow/penguin-harness-design/pull/421)。

## 细节

- 新包没有依赖，构建一个 ESM 入口及其类型声明，可在 Node 24 与浏览器中运行。导出的名字与原 core 子路径相同。
- `packages/ui`、`packages/cli`、`packages/server`（消息桥的纯文本降级）与 `packages/ui-gallery` 引用它，core 不引用。
- `packages/ui` 以 `@prismshadow/a2ui` 取代 `@prismshadow/penguin-core` 作为 devDependency，并把它打进发布的 `dist/`，类型内联进 `index.d.ts`，UI 包的 tarball 形态不变。`scripts/check-ui-package.mjs` 发现类型声明文件引用 `@prismshadow/a2ui` 或 `@prismshadow/penguin-core` 时报错。
- 十一个 A2UI 测试文件从 `packages/core/test/` 移到 `packages/a2ui/test/`。读取 a2ui 插件在插件库中位置的那一个场景没有随之迁移：新包不依赖 core，core 的插件库测试已列出该插件。
- `plugins/` 下的改动也会运行 A2UI 测试，它检查 a2ui 技能及其打包的检查脚本。`scripts/release-npm.sh` 为新包写入版本并运行其测试，npm 发布任务在 `@prismshadow/amsp` 之后、core 之前发布它，CI 的打包任务与其他包一起打包它。站点构建与开发预构建也会构建它。

## a2ui 技能

- `scripts/check.mjs` 改从 `packages/a2ui/src/` 重新构建。文件头与每个被打包文件上方的路径注释写的是新目录，源码散列随新包模块注释的改动而变化。检查脚本的代码不变。
- `references/components.md` 写明语法位于 `@prismshadow/a2ui`。技能版本为 `2026.11.04.1`，描述不变。

## 兼容性

- 从 `@prismshadow/penguin-core/a2ui` 引用的 SDK 代码无法再解析该子路径。把引用改为 `@prismshadow/a2ui` 即可，它在同一版本发布，导出相同。
- 已安装 a2ui 技能的 Agent 会显示它有更新。应用更新后安装的是重新构建的检查脚本与参考文档中改写的那一句。
