# 减少接口生成的编译工作

- **Date:** 2026-11-13
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `cli`, `tooling`

[English](2026-11-13-interface-build-pipeline.md)

接口生成改为每个目标使用一张编译图，包构建与部署共用源码映射和生产源码范围。再导出的接口和槽代码引用的类型保留在生成表中；输入别名指向冲突时，在写入表之前报错。

运行时接口检查为生成声明所用的 TypeScript 标准库名称与辅助类型名称预留标识符。Core 构建通过 `PENGUIN_BUILD_JS_ONLY` 支持开发与测试时跳过声明生成；完整构建继续产出 SDK 的公开声明。
