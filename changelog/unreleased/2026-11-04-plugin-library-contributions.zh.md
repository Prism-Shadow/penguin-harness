# 插件库读取插件在构建出的 ifaces.json 中声明的内容，host 改为服务端

- **Date:** 2026-11-04
- **Type:** refactor
- **Scope:** `core`, `server`, `cli`, `plugins`, `ci`
- **PR:** [#1477](https://github.com/Prism-Shadow/penguin-harness/pull/1477)
- **Breaking:** yes — 不再读取插件 package.json 的 `penguin` 块，插件包必须先构建（带 `ifaces.json`），若干 SDK 导出改名或删除

[English](2026-11-04-plugin-library-contributions.md)

插件库不再读取包的 `penguin` 块与目录约定。插件的卡片、Skill、钩子包、MCP Server 与 Workbench 应用，改为读取它的 Module 向五个数据槽 `PluginLibraryModule.{cards,skills,hooks,mcpServers,workbenches}` 声明的贡献，由包的构建写进 `ifaces.json`（penguin-harness-design [#421](https://github.com/Prism-Shadow/penguin-harness-design/pull/421)）；`package.json` 只读 npm 自己的字段。安装写进 Agent State 的内容不变：对每个内置插件，插件库的读出结果与安装后的文件在改动前后哈希相同。

## 细节

- core 的读取器从 `packages/core/src/plugins/` 移到 `packages/core/src/plugin/`，按职责一个文件：契约类型（`library.ts`，以类型从 `@prismshadow/penguin-core/plugin` 导出）、npm 字段（`package-json.ts`）、表（`table.ts`）、贡献校验（`contributions.ts`）、包的种类（`kinds.ts`）、图标、日期版本、SKILL.md frontmatter、插件库所在位置（`library-host.ts`）、读取器（`library-reader.ts`）与分类。`legacy-skill-frontmatter.ts` 原样移动。
- 贡献逐条校验，不合形的条目丢弃并告警，告警写明 `<Module>.contributes["<槽>"][<i>]`。只安装声明过的内容：`skills/` 或 `workbenches/` 下没有贡献点名的目录、没有钩子贡献的 `hooks/`，都告警并略过。内置插件的任何告警照旧使加载失败。
- 包的种类由表推定。插件库插件至少贡献一个 Skill、钩子包、MCP Server 或 Workbench 应用；服务端模块有代码入口，且表中列出 Module。只有卡片的包两者都不是。已装插件路由、zip 上传、前缀自有的索引条目与 `penguin plugin install <目录>` 都按这条规则判定，不再把 `ifaces.json` 的存在当作「服务端模块」。
- 没有 `ifaces.json` 的插件 zip 在安装之前即被拒绝，并提示先构建；`penguin plugin install <目录>` 在打包之前拒绝未构建的目录。
- 25 个 `@penguinharness/*` 依赖从 `packages/core` 移到 `packages/server`。core 新增 `useLibraryHost(dir)`，指明哪个包的依赖构成插件库；服务端启动时登记自己的包。既没有登记、也没有推送、也找不到 host 时，读取插件库报错并写明查找过的位置。
- 本机上已有的包，插件索引中的名称、描述与图标改为取自它的卡片贡献；没有卡片的包保留索引条目的文字与包根目录的 `icon.svg`。
- 热推送的插件库归档改按服务端的依赖打包，打包前为每个插件构建 `ifaces.json`，并略过各插件的 `src/` 与 `tsconfig.json`。desktop 的 preflight 检查每个插件包都带 `ifaces.json`，`pnpm dev` 的前置步骤也构建内容插件的表。
- 读取内置插件库的测试与 README 目录检查从 core 移到 `packages/server/test/plugin-library.test.ts`；core 的读取器测试改用 fixture 表。CI 的 README catalog 任务改跑这组服务端测试，`plugins/` 下的改动也会选中服务端测试。

## 兼容性

- 管理员装进 `<root>/plugins`、仍带 `penguin` 块且没有 `ifaces.json` 的包不再进入插件库；服务端为每个这样的包记一条日志。各 Agent 已装的副本照常运行。要让它重新进入插件库，须重新转换为以 `src/index.ts` 声明内容的包，构建出 `ifaces.json`，再重新安装。
- SDK：删除 `parsePluginPackage`、`readPluginPackage`、`PluginPackageManifest`、`PluginPackageFields`、`PluginHooksDeclaration` 与 `declaresMcpServers`。npm 字段改用 `parsePackageJson` / `readPackageJson`（`NpmPackage`），包声明的内容改用 `readPluginTable` 加 `libraryContributions`。`libraryParts` 改为读表，并多报告 `modules`。
- SDK：创建 `default_agent` 或调用 `provisionProjectAgents` 的嵌入方，须以 `useLibraryHost(<包目录>)` 登记插件库的 host，该包的 `package.json` 依赖各 `@penguinharness/*` 包；不登记时这些调用会报错，不再按 core 自己的依赖预装。
