# 未知的组织地址打开概览，而不是把 `/overview` 越加越长

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1267](https://github.com/Prism-Shadow/penguin-harness/pull/1267)

[English](2026-10-21-org-fallback-absolute.md)

组织下一个没有任何页面认领的地址——旧链接、书签、打错的路径——原先由一次相对跳转送往概览，于是这一段被追加到那个本就没匹配上的地址后面：`/org/<projectId>/<orgId>/notes` 变成 `/org/<projectId>/<orgId>/notes/overview`，布局随之重挂载，每过一遍再多一段 `/overview`，而页面始终不画内容。现在兜底用路由自身的 id 拼出 `/org/<projectId>/<orgId>/overview`，读者最终停在的是概览自己的地址，布局也只挂载一次。

## 细节

- 组织布局的通配兜底从路由读取 `projectId` 与 `orgId`，跳转到绝对路径 `orgPagePath(projectId, orgId, "overview")`。
- 组织布局的 index 跳转仍保持相对——索引路由本就该打开它下面的页面；应用最外层、用于应用不提供的地址的 `/chat` 兜底同样不动。
