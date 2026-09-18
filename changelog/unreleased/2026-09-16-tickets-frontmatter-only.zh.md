# 工单只按 frontmatter 格式读取

- **Date:** 2026-09-16
- **Type:** refactor
- **Scope:** `server`, `skills`
- **PR:** [#754](https://github.com/Prism-Shadow/penguin-harness/pull/754)
- **Breaking:** yes — 仍是 `# Ticket:` 表头格式的工单文件会被报告为无效，不再被读取

[English](2026-09-16-tickets-frontmatter-only.md)

公司模式的工单在磁盘上只有一种格式：YAML frontmatter 加正文各节。此前的格式——一行
`# Ticket: <标题>` 加若干 `Key: value` 表头——其读取器按
[向后兼容](../0.2.13/2026-09-09-backward-compatibility.zh.md) 中约定的时间表删除。不以 `---`
开头的工单文件现在解析失败，错误为 ``the file must start with `---` (YAML frontmatter)``。

## 细节

- 从 `packages/server/src/organization/` 删除了 `parseLegacyTicket`、它的表头与进展行辅助函数、它在
  `Parent` 与 `Blocked-by` 中接受的旧版工单 id 模式，以及只有它在用的服务端 `splitPrincipalList`。
- `company-employee` Skill 不再提旧表头：`penguin org ticket block` 改述为写入 `blocked` /
  `blocked_by`；该 Skill 与新建组织生成的手册把「工单头部」改称「工单字段」。`agent-company` 插件版本升至
  `2026.09.17.1`。

## 兼容性

受影响的是 0.2.13 之前的构建以表头格式写下、此后再未被写入的工单——0.2.13 会在工单第一次被写入时把它改写为
frontmatter 格式。这样的文件原样留在磁盘上，按任何一个解析失败的工单文件处理：

- 看板只在「无法解析的工单文件」下列出它的路径与错误；`penguin org ticket ls` 把它打印为一行
  `invalid`（`--json` 下在 `invalidFiles` 中），reconcile 过程记录一条 `org_ticket_invalid` 错误。
- 打开它返回 404 `ticket_not_found`；对它的任何写入都被拒绝，返回 409 `ticket_invalid`（其 slug
  仍含数字或因其他原因不是纯字母时，读取与写入一律返回 400 `bad_request`），因此不会有任何操作转换或覆盖它。新建工单若会占用它的
  id，则取下一个后缀。
- 修复之前，只由它记录的会话不计入任何工单，也不计入任何员工的花费；`parent` 指向它的工单会被标为父工单不存在。

恢复 slug 为纯字母的工单时，可以用 0.2.13 对它写入一次（追加一条进展或移动一次即完成转换），也可以按下面的对应关系手工转换。这条写入路径对其他工单无效（0.2.13 的路由对其他 id 已经返回 400），这类工单只能手工恢复，分三步：

1. 在文件所在目录内把它改名为 slug 为纯字母的 id：保留 `<yyyy-mm-dd>-` 前缀，slug 写成以连字符连接的小写英文单词；该 id 已被占用时加字母后缀（`-b`、`-c`……）。
2. 按下面的对应关系，把标题行与表头替换为 frontmatter 块。
3. 其他工单的 `parent` 或 `blocked_by` 指向旧 id 的（仍是表头格式的文件里为 `Parent` 或 `Blocked-by`），一律改写为新 id。

表头与 frontmatter 的对应关系：

- `# Ticket: <标题>` → `title`；`Status` → `status`（须与所在列目录一致）。
- `Owner` → `owner`；`Owner` 为空时取 `Initiator` 的值。
- `Initiator` → `history` 的第一条：`{at: <第一条进展行的时间>, by: <initiator>, action: created}`。
- `Notify: a, b` 与 `Sessions: a, b` → 列表 `notify: [a, b]` 与 `sessions: [a, b]`。
- `Parent`、`Priority`、`Due`、`Blocked` → `parent`、`priority`、`due`、`blocked`；`Blocked-by` →
  `blocked_by`。其中的工单 id 须使用纯字母 slug，改过名的工单写它的新 id。
- 其余 `Key: value` 表头 → 同名字段。
- `## Progress` 中每一行 `- <时间> <principal> <文本> session:<id>` → `- <文本>`，并追加一条 `history`
  条目 `{at: <时间>, by: <principal>, action: progress, note: <文本>}`。
