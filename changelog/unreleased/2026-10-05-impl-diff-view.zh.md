# 提案的改动可以在提案页上逐文件查看

- **Date:** 2026-10-05
- **Type:** feature
- **Scope:** `company-proposals`, `server`, `web`

[English](2026-10-05-impl-diff-view.md)

提案页对 impl branch 只给出 `+N/−M`，审阅的人要看改了什么，只能自己去 GitHub 上比较分支。

## 改动

- `GET …/proposals/:number/impl/changes[?w=1]` 逐文件给出 impl branch 的 diff（base 与 head 的 merge-base 到 head）：每个文件的路径（改名时带原路径）、状态、增删行数、二进制标记与 hunk。`w=1` 忽略空白。只读，按 head 与 base 的提交缓存。
- diff 从交付仓库的 blobless 镜像读取。镜像仍不主动保存文件内容：一次 diff 只按对象 id 取它改动的路径用到的 blob，在一次有上限的 fetch 里取完，不写任何 ref。超过 512 KiB 的文件只给增删数、不给 hunk（`tooLarge`）；补丁文本到 4 MiB 后，其余文件只给增删数（`diffLimit`）。
- 镜像答不出（尚未建好、fetch 失败）时，改为解析 GitHub 比较给的补丁，标 `source: "github"` 并给出原因；这一来源最多列 300 个文件，二进制或过大的文件没有补丁（`noPatch`），也不能忽略空白。
- 提案页在 `+N/−M` 旁新增「查看 diff」，展开 diff 视图：按目录分组的改动文件（带状态与增删数，点击跳到该文件）、可逐个折叠的文件 diff、按浏览器记住的统一／并排排版，以及忽略空白的开关。二进制、过大、超出上限的文件以及来自 GitHub 比较的 diff 各有说明；加载、空与出错状态齐全，需要时可重试。
