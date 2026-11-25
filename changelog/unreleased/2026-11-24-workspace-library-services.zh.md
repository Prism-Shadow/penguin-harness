# workspace 域的会话列表、draft 与目录 Skill 服务下沉进 workspace library

- **日期：** 2026-11-24
- **类型：** refactor
- **范围：** `server`、`library/workspace`

[English](2026-11-24-workspace-library-services.md)

workspace 域剩下的服务并入 workspace library（`@prismshadow/penguin-library-workspace`）：会话列表的 workspace 组（temp 组哨兵与把系统自建目录折进该组的路径规则）、workspace 路径校验、整个 workspace 组的归档、账户的 drafts 词汇与 patch 解析、draft 界面快捷方式的上界，以及在用户选定的目录里发现的 Skill。每个迁出的模块在原 server 路径保留纯 re-export，server 的 import 路径不变；drafts 词汇（`DRAFT_KINDS`、draft 值上限、`DraftShortcut`）照旧由 server 的 `./api` 类型 re-export。

library 保持不依赖 server。归档服务讲结构化 port——它到达的 Session 索引、活跃行读取器与 Project 事件通知器——其跨域类型全部以 type-only import 到位，workspace 包的 manifest 因此不新增依赖。

## 兼容性

公开的 HTTP/SSE API 不变。面向客户端的类型入口（`@prismshadow/penguin-server/api` 与 server 其余子路径）继续导出同名类型；迁出的形状在原位置 re-export。
