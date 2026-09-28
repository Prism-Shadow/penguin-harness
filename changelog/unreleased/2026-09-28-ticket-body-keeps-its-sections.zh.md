# 公司模式：用整份正文创建的工单保留验收标准

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `server`, `cli`, `docs`

[English](2026-09-28-ticket-body-keeps-its-sections.md)

`penguin org ticket create --body-file <path>`（即 `POST /:orgId/tickets` 的 `body`）把整个文件都放进了目标（goal），验收标准则留空。一个以 `## Goal` 开头、带 `## Acceptance criteria` 的文件落盘后这两个标题各出现两次，验收标准挂在目标内部的第二份标题下，`ticket show` 显示没有验收标准。现在正文里的各节就是工单的各节。

## Details

- 服务端用读取已存工单文件的同一个解析器读取 `body`：`## Goal`、`## Acceptance criteria`、`## Progress`、`## Result` 填入对应字段，其余 `##` 小节原样保留。
- 第一个 `##` 标题之前有文字（例如一个 `# H1` 标题）时返回 400，并引用该行，不写入工单。
- 完全没有 `##` 标题的正文视为纯文本，仍整体作为目标，与之前一致。
- `--body-file` 的帮助文本（中英文）、CLI 参考与服务端 API 参考写明了上述规则。
- 盘上已有的工单不会被改动。按旧方式创建的工单仍带着重复的标题；手工编辑其文件、每个标题只留一份，验收标准即可重新读出。
