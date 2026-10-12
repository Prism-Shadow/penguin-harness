# 子会话带 squad 标签；列表暴露父子关系；成本可按 squad 分组

- **Date:** 2026-10-12
- **Type:** feat
- **Scope:** `core`、`server`、`cli`、`docs`
- **PR:** TBD

[English](2026-10-12-squad-tags.md)

`run_subagent` 新增可选 `squad` 标签（1–64 字符），记在子 Session 的
`session_meta` 里，分组不再依赖解析 prompt。

## Details

- 会话列表在每个派生行上透出 `parentSessionId`（直接派生者，读索引行）与
  `squad`；顶层与老行没有这两项。
- `cost --by squad` 按来源子 Session 的标签分组用量。没有标签的来源行进入
  `(none)`，leader 自己的 Token 不会混进任何 squad 桶。
- 非法 `squad` 参数在工具调用当场大声失败，不会记下垃圾标签。
- 新增索引列（`sessions.parent_session_id`、`sessions.squad`）走常规 open-time
  升级，老库重启即补。
