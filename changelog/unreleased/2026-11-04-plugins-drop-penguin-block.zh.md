# 内置插件不再带 penguin 块，读取或描述它的地方改为依据插件的声明

- **Date:** 2026-11-04
- **Type:** refactor
- **Scope:** `plugins`, `docs`, `landing`, `tooling`, `ci`
- **PR:** [#1479](https://github.com/Prism-Shadow/penguin-harness/pull/1479)

[English](2026-11-04-plugins-drop-penguin-block.md)

`plugins/` 下全部 29 个包的 `package.json` 删去了 `penguin` 块：它承载的内容已由各包的 `src/index.ts` 声明（penguin-harness-design [#421](https://github.com/Prism-Shadow/penguin-harness-design/pull/421)），插件库也已在 [#1477](https://github.com/Prism-Shadow/penguin-harness/pull/1477) 中停止读取它。仍经由这个块读取或描述插件的代码与文档，改为依据这些声明。

## 细节

- 官网的插件页从 `package.json` 读取插件的 npm 字段，从构建出的 `ifaces.json` 读取卡片、Skill、钩子包与 Workbench；缺 `ifaces.json` 的插件使站点构建失败，并指出该文件。官网把各插件包列为 `workspace:*` 的 devDependencies，pnpm 因此先构建它们的表；`pnpm build:site` 也先构建 core 与各插件。
- `plugin-porting` Skill 按新形态写出插件包。新增的 `write-module.mjs` 脚本把卡片、每个 Skill 与 MCP Server 声明在 `src/index.ts` 中，写出 `tsconfig.json`，并添加 `build` 脚本与构建所需的 devDependencies（与插件移植时 PenguinHarness 版本一致的 `@prismshadow/penguin-core`，以及 `typescript`）；该 Skill 随后以 `npm install` 与 `npm run build` 构建插件包，再执行 `penguin plugin install`。`port-mcp.mjs` 输出 `mcpServers` 贡献条目，每条带 `<plugin>.mcp.<name>` 形式的 id。仍为已退场形态的包，同样转成新形态。
- `scripts/check-plugin-versions.mjs` 从基线与当前提交的 `src/index.ts` 读取 hooks 贡献：改了钩子脚本或该贡献中的命令，必须递增它的 `version`；只改卡片则不必。
- 导入弹窗给 Agent 的提示词把插件包描述为 `package.json`、`src/index.ts` 以及构建写出的 `ifaces.json`。
- 「Skill 与插件」、CLI 与 Server API 文档、`plugins/README.md`、`.github/CONTRIBUTING.md` 与开发 Skill 改为描述插件的声明、构建、种类规则（只有卡片不算插件库插件）与版本规则，不再描述这个块。
- 组件库演示中的插件库按各工具包模块的声明写出卡片。删去了官网的 `rsi-stats.test.ts`：它把首屏清单钉在这个块的分类和另一仓库的目录上。
