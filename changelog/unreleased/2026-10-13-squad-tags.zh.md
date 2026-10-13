# 编队标签：子代理为自己所属的工作组命名

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `docs`

[English](2026-10-13-squad-tags.md)

一个把任务分派给多个 `run_subagent` 子会话的「主」会话，没有办法说明这些子会话属于同一件工作——读取 Trace 的任何人也无从分组，因为把它们联系在一起的只有那句派生它们的提示词。这里加一个标签来说清这件事。

## 标签

- **`run_subagent` 接受 `squad`**：一段简短的自由文本标签（1–64 个字符），与其他 spawn 参数在同一处校验——空值、超长或非字符串会显式失败，而不是记下一个日后需要解释的垃圾标签；JSON `null` 视同省略，与缺少该键一致。
- **标签记录在子会话的 `session_meta` 上**（`squad`），与 `source` 和模型引用并列。派生点负责透传：`SubagentSpawnOptions.squad`（core）→ `Agent.createSession` → 子会话首次运行写下的 meta。省略即无编队，此时该键根本不写。
- **不靠解析提示词去认它。** 成本归集与父子关系都读这个已记录字段，因此编队在任何只拿到 Trace 文件的读取者眼里都成立。

## 读回来

- **会话列表在 `SessionInfo` 上暴露 `parentSessionId` 与 `squad`**，直接来自索引行：`parent_session_id` 在子会话注册时写入（嵌套时取来源链的倒数第二跳，否则取驱动该次派生的会话），`squad` 取自子会话的 `session_meta`。顶层行与历史行两者皆无。
- **`cost --by squad`** 按来源子会话的标签归集用量（对 `usage_records.origin_session_id` 上的标量子查询做 `GROUP BY`，因此「主」会话自身的 token 不会落进任何编队桶）。来源无标签的行归入 `(none)`。
- 同一维度也可通过 HTTP 取得（`GET /usage?groupBy=squad`）。

## 兼容性

两列都在打开数据库时补齐（`ensureColumn`），因此已有的 `web.db` 无需迁移步骤即可获得它们，也不做回填：本次改动之前写入的行读作顶层且无标签——它们本来就是这样。
