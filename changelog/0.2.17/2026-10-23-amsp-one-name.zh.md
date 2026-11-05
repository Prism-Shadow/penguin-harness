# 记录只有一个名字：AMSP 记录

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `amsp`, `core`, `server`, `web`, `docs`
- **PR:** [#1304](https://github.com/Prism-Shadow/penguin-harness/pull/1304)
- **Breaking:** yes — `OmniMessage`、`OmniPayload` 与 `OmniMessageType` 已更名，`@prismshadow/penguin-core` 去掉了 `./omnimessage` 与 `./markers` 导出。

[English](2026-10-23-amsp-one-name.md)

OmniMessage 之名退役。Trace 的一行、SDK 的一条输出与 Session 流上一个不带名字的事件是同一样东西，类型、模块、文档、Skill 与落地页从此一律称之为 AMSP 记录。写入磁盘与线上传输的内容都没有变化。

## 细节

- `OmniMessage<P>` 改名为 `AmspRecord<P>`，`OmniPayload` 改名为 `AmspPayload`，`OmniMessageType` 改名为 `AmspRecordType`；core 的 `mergeOmniToUniMessage` 改名为 `mergeRecordsToUniMessage`。旧名不保留别名。
- 记录的构造函数、`isTaskRecord` / `isTaskBegin` / `lastNonTaskRecord` 与 `normalizeSessionSource` 从 core 移入 `@prismshadow/amsp`，与类型放在一起，Web App 读记录所需的一切因此都从该包导入。该包未发布过的 `./omnimessage` 入口改为 `./records`。
- `@prismshadow/penguin-core` 的包根再导出 `@prismshadow/amsp/records` 与 `@prismshadow/amsp/markers`，全部名称仍可从包根取得。
- 文档页移至 `/docs/amsp-records`，标题为「AMSP 记录」。旧地址 `/docs/omni-message` 不做重定向。
- Web App 的流模块从 `src/lib/omni/` 移至 `src/lib/amsp/`，流处理函数 `onOmniMessage` 改名为 `onRecord`。

## 兼容性

- 从 `@prismshadow/penguin-core/omnimessage` 或 `@prismshadow/penguin-core/markers` 导入将无法解析。改为从 `@prismshadow/amsp`（记录、判定函数与构造函数，亦可用 `@prismshadow/amsp/records`）与 `@prismshadow/amsp/markers` 导入同名的内容，或从 `@prismshadow/penguin-core` 包根导入。
- TypeScript 代码中的 `OmniMessage`、`OmniPayload` 与 `OmniMessageType` 改用 `AmspRecord`、`AmspPayload` 与 `AmspRecordType`。
- Trace、`web.db`、导出的 Agent 与 AMSP 流都不含类型名，无需任何处理。
