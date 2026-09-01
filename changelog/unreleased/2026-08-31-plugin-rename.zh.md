# 扩展改称插件

- **Date:** 2026-08-31
- **Type:** refactor
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#354](https://github.com/Prism-Shadow/penguin-harness/pull/354)
- **Breaking:** yes — `extensions.json` 不再被读取，配置文件改为 `plugins.json`；两个 SDK 子路径由 `/extension` 改为 `/plugin`

[English](2026-08-31-plugin-rename.md)

让部署装上 harness 本身不发布的能力的那套机制，现在统一称为**插件**（plugin）机制。配置文件、两个 SDK 子路径、契约的类型名、后端包名以及它们所在的目录，全部用同一个词，读者在概念出现的任何地方遇到的都是同一个称呼。

## 细节

- **配置文件是 `<root>/plugins.json`**，其唯一的键为 `plugins`。其余形状不变：一组包 specifier，按安装位置解析，文件缺失即表示没有插件。
- **SDK 子路径是 `@prismshadow/penguin-core/plugin` 与 `@prismshadow/penguin-server/plugin`。** 两者仍然只输出类型。
- **契约中的名字带上了这个词：** `Extension` → `Plugin`、`ExtensionContext` → `PluginContext`、`ExtensionEvents` → `PluginEvents`，宿主侧 `ExtensionHost` → `PluginHost`。`PenguinContext`、`PenguinInterface`、`HarnessContext` 以及整套沙箱词汇均未改动。
- **四个沙箱后端改名为 `@prismshadow/penguin-plugin-sandbox-{dsh,bwrap,seatbelt,mxc}`**，并集中放在 `packages/plugins/` 一个目录下。它们依然不属于本仓库构建与发布的内容：`packages/` 下没有别的东西依赖它们，platform bundle 也不含任何一个，workspace glob 单独列出它们。
- **`plugin` 不是 cordis 的 `plugin`。** DSH 适配器通过 cordis 自己的 `Context.plugin` 挂载 DSH 的链路；两套词汇除了这个词之外毫无关系，适配器也据此重命名了它持有的 cordis context。

## 兼容性

磁盘上已有的 `extensions.json` **不会被读取**，也不会被迁移。用旧名字配置了插件的部署仍能运行，但其中的插件一个也不会加载，对应能力静默失效——对沙箱后端而言，这意味着命令将在无约束状态下 spawn。请把该文件改名为 `plugins.json`，并把其中的 `"extensions"` 键改为 `"plugins"`；里面的 specifier 只在点名本仓库的沙箱后端时需要改动，那几个包现在叫 `@prismshadow/penguin-plugin-sandbox-*`。

针对 `@prismshadow/penguin-core/extension` 或 `@prismshadow/penguin-server/extension` 编译的包将无法解析。把 import 指向 `/plugin`，并改用新的三个类型名即可。

线上格式、数据库以及其他任何磁盘文档均无变化。
