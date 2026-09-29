# 公司路线图：确立不再归档路线图

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`, `web`
- **PR:** [Myriad-Dreamin/penguin-harness#21](https://github.com/Myriad-Dreamin/penguin-harness/pull/21)
- **Breaking:** yes — 路线图不再有 `archived` 字段，`POST …/roadmaps/:n/archive` 与 `/unarchive` 已去掉

[English](2026-09-29-roadmap-no-archive.md)

路线图只有三个状态，此外没有别的：`awaiting_room`、`discussing`、`established`。确立只把路线图标为已确立，不再同时归档它；主持人的首条输入也不再说「the roadmap is archived」。手动的搁置（archive／unarchive）一并去掉。

## 细节

- 账本里不再有 `archived`／`unarchived` 两类行，路线图也不再有 `archived` 字段；`established` 行只改状态，`reopened` 行把它改回 `discussing`。
- 转发与房间认领只看状态。房间所在的频道被归档时仍不转发——那是频道自己的归档，插件只读它。要停一间房的讨论，归档它的频道。
- App 的 sidebar 只列讨论中且有房间的路线图；App 的路线图类型去掉了 `archived` 字段。
- 插件的 README 与文件头按三个状态描述。

## 兼容性

- 旧版本写下的账本不需要改：`established` 行读作已确立，`archived` 字段直接不存在。
- 旧版本写下的 `archived`／`unarchived` 行与任何未知种类的行一样，被跳过并计数；路线图读作没有这两行时的样子。以这种方式被搁置的讨论会重新读作讨论中，房间恢复转发；要停下它，归档房间所在的频道。
- 调用 `POST …/:n/archive` 或 `/unarchive` 得 404。本仓库内没有调用方。
