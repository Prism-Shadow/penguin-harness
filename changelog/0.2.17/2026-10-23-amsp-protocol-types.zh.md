# 记录类型与标记迁入 `@prismshadow/amsp`

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `amsp`, `core`
- **PR:** [#1300](https://github.com/Prism-Shadow/penguin-harness/pull/1300), [#1304](https://github.com/Prism-Shadow/penguin-harness/pull/1304)

[English](2026-10-23-amsp-protocol-types.md)

Trace 里的记录就是 AMSP 流出的记录，因此它们的类型与消息标记迁入 SDK 包：该包没有依赖，可在浏览器中运行。core 原样再导出二者，写入磁盘的内容不变。

## 细节

- 记录类型与消息标记从 core 移至 `packages/amsp/src/records/` 与 `packages/amsp/src/markers/`。`@prismshadow/amsp` 经两个入口导出它们：`@prismshadow/amsp/records`（外壳、全部载荷与判定函数）与 `@prismshadow/amsp/markers`（标记的生成与解析）；包根也导出记录。
- `@prismshadow/penguin-core` 依赖 `@prismshadow/amsp`，并从包根再导出二者。`ThinkingLevelName` 随记录定义，仍从 `interfaces` 再导出。
- 工作区构建先构建 `@prismshadow/amsp` 再构建 core；发布流程本就先发布它。
- core 新增一个测试，以一个入库的 Trace 文件固定每种入库记录各一条的字节。
