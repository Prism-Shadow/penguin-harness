# 插件包以 `penguin-gen-ifaces` 构建接口表

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `tooling`
- **PR:** [#1475](https://github.com/Prism-Shadow/penguin-harness/pull/1475)

[English](2026-11-04-gen-ifaces-bin.md)

接口生成器随 `@prismshadow/penguin-core` 以 `penguin-gen-ifaces` 命令发布，本仓库之外的插件包因此可以像内置插件一样构建自己的 `ifaces.json`：`penguin-gen-ifaces --project tsconfig.json --out ifaces.json`，并在 `devDependencies` 中列入 core 与 `typescript`。生成器还会拒绝它无法当作数据读取的 `contributes` 值。

## 细节

- 生成器从 `scripts/gen-ifaces.mjs` 移到 `packages/core/bin/gen-ifaces.mjs`，并列入 core 发布的 `files`。`scripts/gen-ifaces.mjs` 改为运行它的转发脚本，服务端与各插件包的构建命令不变，本仓库生成的每张表逐字节不变。
- 它使用被构建包自己的 `typescript`（从工作目录解析），找不到时退回 core 自身解析到的那一份。
- `@Component` 或 `@Module` 类的 `contributes` 下每个值都必须写成字面量。引用常量、展开或简写属性都会让构建失败，并逐条报出文件、行号与键，例如 `src/index.ts:12: GoalPlugin contributes["PluginLibraryModule.skills"]: 'SKILLS' is a reference`，且不写出表。此前这里出现常量会让生成器以 `Converting circular structure to JSON` 崩溃，不给出位置。
- 整个参数是常量的装饰器（`@Component(META)`）同样被拒绝。此前其中的贡献会被悄无声息地漏出表外。
