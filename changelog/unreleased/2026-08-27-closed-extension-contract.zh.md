# 扩展契约改为封闭，并纳入沙箱词汇

- **Date:** 2026-08-27
- **Type:** refactor
- **Scope:** `core`, `server`
- **PR:** [#354](https://github.com/Prism-Shadow/penguin-harness/pull/354)

[English](2026-08-27-closed-extension-contract.md)

`PenguinContext` 与 `PenguinInterface` 过去是开放的：harness 通过 `declare module` 增广 `@prismshadow/penguin-core/extension` 来挂上自己的成员。于是一个对着契约做类型检查的扩展，实际编译against 的是只有某一个宿主才提供的成员，而 core 这一层无从分辨哪些是哪些。现在它们把每个成员都写明，并且不再被重新打开。

## 详情

- 沙箱词汇移入契约，落在 `@prismshadow/penguin-core/extension`：`SandboxPolicy`、`SandboxProvider`、`ConfinedArgv`、模式与维度联合类型，以及注册与控制面。后端正是针对这些名字编写、除此之外别无所需，因此它们属于契约，而不属于路由它们的那个 harness。`PenguinContext.sandbox` 与 `PenguinInterface.sandbox` 现在被直接声明。
- 只有词汇搬了。`SANDBOX_DIMENSIONS`、`providerDimensions` 与 `requestedDimensions` 读取这些形状，属于宿主，因此仍留在 server 包里——这也让两个扩展子路径继续只输出类型（core 的 `extension/index.js` 依旧是 33 字节），扩展包对二者都没有运行时依赖。
- harness 在契约之外提供的东西，改为声明在一个继承契约的接口上——`HarnessContext`，携带 `terminals`。该类型的值仍然满足契约，接缝没有变化；想要 `terminals` 的扩展需写 `ctx as HarnessContext`，从而在使用处明确表态：它依赖运行在这个 harness 之内。

## 兼容性

线上格式与磁盘格式都不变，这是编译期表面的变化。此前直接从裸契约上读 `context.terminals` 的扩展现在需要那次类型转换——而这正是目的：那个成员从来不属于契约，只属于这个宿主。
