# 热推送带上它构建时所用的插件库

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `core`, `server`, `deploy`

[English](2026-09-19-pushed-plugin-library.md)

core 通过 Node 从一个「宿主包」读取 Skill 与 hook 插件库——即 `dependencies` 里点名 `@penguinharness/*` 各包的那个包。热推送来的平台位于数据根的 store 里，它上方没有任何包，于是回落到「启动它的那个程序」旁边安装的库。因此，某个插件出现之前安装的机器永远不会提供该插件，无论它的平台多新：创建组织要给 CEO 安装 `agent-company`，在早于公司模式的程序上每次创建都得到「该插件不在插件库中」。同一个缺口也使更新过的 Skill 始终到不了被推送实例的库里。

`scripts/deploy.mjs` 现在把 core 声明的库——13 个插件、约 0.4 MB，与其他资产一样按内容寻址——打成 `archives/library.tgz`，布局即一个宿主包（`library/package.json` 点名各包，`library/node_modules/@penguinharness/<name>/…`）。平台启动时让 core 指向它（`usePushedPluginLibrary`），core 先在那里找，再看自己模块的上方与正在运行的程序的上方。不带该归档的推送、以及根本不是推送来的平台，仍在原来的位置读取库。

Agent 已安装的 Skill 仍是副本：更新的库表现为 Agent 上该插件的「更新」按钮，不会改写已安装的内容。
