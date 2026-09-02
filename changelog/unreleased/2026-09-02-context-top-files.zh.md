# 上下文圆环的面板在工具排行旁加上文件排行

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#584](https://github.com/Prism-Shadow/penguin-harness/pull/584)

[English](2026-09-02-context-top-files.md)

上下文圆环的构成面板多了第二份 Top 5：`read_file` / `edit_file` / `write_file` 的流量在当前上下文里
占得最多的文件，与原有的工具排行并列。列表上方的「工具 / 文件」开关切换视图，面板在本页签会话内
记住上次的选择。

## 细节

- `GET /api/sessions/:sessionId/context` 新增 `topFiles`：至多五条 `{ path, tokens, ops: { read, edit, write } }`，
  按每个文件的文件工具调用与其结果所占上下文排序——与 `topTools` 用同一套字符启发式、同一套调用与结果
  的配对，因此两份排行是同一份估算的占比。调用按其 `file_path` 解析到的文件归并，解析方式与文件工具
  对 Workspace 的解析一致，所以 `a.ts`、`./a.ts` 与绝对路径写法是同一行。`file_path` 缺失或无效的调用
  不进文件排行（工具本身也会拒绝这样的调用），但仍计入工具流量。
- Session 的 Workspace 内的文件按相对路径显示；其余文件为绝对路径，home 目录缩写为 `~`。
- 文件视图每行加粗显示文件名、淡显目录、悬停给出完整路径，其后是读取、编辑、写入各自的次数，字形沿用
  文件摘要卡与记忆更新卡已有的文件、铅笔与加号页；token 与占比两列与工具视图同为占整个上下文的份额。
  工具没有碰过任何文件的上下文显示「本轮上下文没有文件读写」。
- 六个分项、`contextClosed` 与 `compactionThreshold` 不变。
