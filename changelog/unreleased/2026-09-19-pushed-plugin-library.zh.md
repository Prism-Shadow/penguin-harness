# 热推送带上它构建时所用的插件库

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `core`, `server`, `deploy`
- **PR:** [#798](https://github.com/Prism-Shadow/penguin-harness/pull/798)

[English](2026-09-19-pushed-plugin-library.md)

一台机器装的是早于公司模式的程序，之后经热推送升级到带公司模式的平台，在它上面创建组织每一次都失败，报「This plugin is not in the plugin library」。创建组织要给 CEO 安装 `agent-company`，而 Agent 插件库（Skill 与钩子，即 `@penguinharness/*` 各包）用的是恰好启动平台的那个程序旁边的那一份——12 个插件，没有 `agent-company`——推送的平台再新也没用。现在热推送带上自己的库。

- 部署多产出一件按内容寻址的资产 `archives/library.tgz`：core 的包清单所声明的全部 Agent 插件，排成一个宿主包（`library/package.json` 点名各包，加 `library/node_modules/@penguinharness/<名>/…`）。core 声明了、仓库里却找不到的插件让部署失败，而不是推出一份缺插件的库。当前规模为 13 个插件、约 0.4 MB。
- core 新增 `usePushedPluginLibrary(dir)`。设置后宿主包的查找顺序为：推送来的库 → loader 自身所在的安装 → 运行中的程序所在的安装；传 `null` 回到后两处。设置即生效，下一次读库按新顺序重新查找。
- 平台由运行时以热推送方式装载时，在任何代码读插件库之前，用 `pushedLibraryDir` 在已解开的资产里找到这份库并交给 core。
- 推送里没有这件资产，或平台根本不是推送来的（普通安装、桌面应用、开发模式），行为与之前一致。推送来的库优先于程序旁那一份，即便程序比推送更新：正在运行的是被推送的平台，与它配套的库才对。查找逻辑在推送的 core 里，所以对早于本改动的运行时同样有效。
- Agent 已装的 Skill 与钩子是副本，不被改写：库变新后，Agent 上对应插件显示「更新」，由用户决定何时更新。
