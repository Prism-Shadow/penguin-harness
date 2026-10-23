# OmniMessage 类型与标记迁入 `@prismshadow/amsp`

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `amsp`, `core`
- **PR:** [#1300](https://github.com/Prism-Shadow/penguin-harness/pull/1300)

[English](2026-10-23-amsp-protocol-types.md)

Trace 里的记录就是 AMSP 流出的记录，因此它们的类型与消息标记迁入 SDK 包：该包没有依赖，可在浏览器中运行。core 原样再导出二者，写入磁盘的内容不变。

## 细节

- `packages/core/src/omnimessage/types.ts` 与 `omnimessage/markers/*` 移至 `packages/amsp/src/omnimessage/`。`@prismshadow/amsp` 经两个新入口导出它们：`@prismshadow/amsp/omnimessage`（外壳、全部载荷与判定函数）与 `@prismshadow/amsp/markers`（标记的生成与解析）。根入口不变。
- `@prismshadow/penguin-core` 依赖 `@prismshadow/amsp`，并从原路径再导出二者：包根、`@prismshadow/penguin-core/omnimessage` 与 `@prismshadow/penguin-core/markers`。`ThinkingLevelName` 随记录定义，仍从 `interfaces` 再导出。
- 工作区构建先构建 `@prismshadow/amsp` 再构建 core；发布流程本就先发布它。
- core 新增一个测试，以一个入库的 Trace 文件固定每种入库记录各一条的字节。
