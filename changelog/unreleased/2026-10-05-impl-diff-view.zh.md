# 提案的改动可以在提案页上逐文件查看，也可以评论

- **Date:** 2026-10-05
- **Type:** feature
- **Scope:** `company-proposals`, `server`, `web`

[English](2026-10-05-impl-diff-view.md)

提案页对 impl branch 只给出 `+N/−M`，审阅的人要看改了什么，只能自己去 GitHub 上比较分支。

## 改动

- `GET …/proposals/:number/impl/changes[?w=1]` 逐文件给出 impl branch 的 diff（base 与 head 的 merge-base 到 head）：每个文件的路径（改名时带原路径）、状态、增删行数、二进制标记与 hunk。`w=1` 忽略空白。只读，按 head 与 base 的提交缓存。
- diff 从交付仓库的 blobless 镜像读取。镜像仍不主动保存文件内容：一次 diff 只按对象 id 取它改动的路径用到的 blob，在一次有上限的 fetch 里取完，不写任何 ref。超过 512 KiB 的文件只给增删数、不给 hunk（`tooLarge`）；补丁文本到 4 MiB 后，其余文件只给增删数（`diffLimit`）。
- 镜像答不出（尚未建好、fetch 失败）时，改为解析 GitHub 比较给的补丁，标 `source: "github"` 并给出原因；这一来源最多列 300 个文件，二进制或过大的文件没有补丁（`noPatch`），也不能忽略空白。
- 提案详情直接带上 impl 的 `+N/−M`（`implStat`），无需点击：服务器在后台用同一份 diff 计算，按 head 与 base 的提交缓存，距上次读取满一分钟后再核对分支；数值变化时发布 `impl_stat` 插件事件，页面据此重读详情。尚未算出时页面显示「正在统计」，算不出时说明原因。
- 点 `+N/−M` 在与设置页同样外壳的大窗口中打开 diff 视图，关闭即回到提案页原处。视图包括：按目录分组的改动文件（带状态与增删数，点击跳到该文件）、可逐个折叠的文件 diff、按浏览器记住的统一／并排排版，以及忽略空白的开关。二进制、过大、超出上限的文件以及来自 GitHub 比较的 diff 各有说明；加载、空与出错状态齐全，需要时可重试。
- 评论除了落在正文段落上，还可以落在目标上：scope 的某一条（按文件与类型）、tests 的某一条（按文件）、改动的某个文件，或某个文件的一段行（哪一侧、起止行）。`proposal.comment` 为此新增 `target` 参数并严格校验；当前修订或当前 diff 中没有的目标以 `400 comment_target` 拒绝。落在 diff 上的评论记下写下时 head 与 base 的提交，并保存当时的那几行；分支前进后页面将其标为「过时」，仍可展开当时的行。带目标的评论照旧进入 request changes 的那一批，照旧可以改写、撤回与 resolve；Agent 读到的 `comments` 文本会写明每条评论的目标。
- 提案页上，scope 与 tests 的每一条、diff 中每个文件的标题旁都有评论按钮与评论数；在 diff 中选行（点行号再 Shift 点另一行，或拖选代码）即出现「评论这几行」，文件的行评论列在该文件下方。
- 评论表新增可空的目标列；已有的 `company.db` 在打开时补上。参见[兼容说明](2026-10-04-backward-compatibility-notify-actions.zh.md#旧形态没有目标列的-proposal_comments)。
