# 分页查询参数拒绝尾随垃圾字符，路由注释去掉设计文档编号

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`
- **PR:** [#410](https://github.com/Prism-Shadow/penguin-harness/pull/410)

[English](2026-08-23-paging-params-reject-trailing-garbage.md)

`offset` 和 `limit` 此前用 `Number.parseInt` 解析后只做范围检查，因此只要开头是数字就会被接受：
`?limit=200abc` 按 200 分页，`?limit=1e3` 按 1 分页。两者现在都走 `positiveIntParam` 早已使用的
纯数字解析，改为返回 400。十三处引用设计会话条目编号（`FD-1`、`FD-3`、`FD-4`）的路由注释被改写为
直接陈述它们所指向的规则。

## 细节

- `paginationQuery` 和 `optionalPagingQuery` 与 `positiveIntParam` 共用同一个
  `parseNonNegativeInt`：要么是落在安全整数范围内的十进制数字串，要么返回 400。前导正负号、
  空白、小数点、十六进制和指数写法一律拒绝。
- 接受的取值范围不变——`offset` >= 0（默认 0），`limit` 1–1000（Trace 分页助手默认 200）——
  "给了 offset 就必须给 limit" 的规则和两者都缺省时返回 `null` 的行为同样不变。
- 受影响的端点：Trace 消息与事件分页、用量错误明细表，以及 Session 和 Trace 列表端点。
- 路由注释现在直接点明不变量（"id 校验发生在任何路径拼接之前：防止 agentId 路径穿越导致的
  跨 Project 提权"），而不是转而引用一个在 `HEAD` 上无从解析的编号。
