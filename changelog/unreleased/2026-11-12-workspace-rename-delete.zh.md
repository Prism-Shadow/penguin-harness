# 每个 Workspace 分组都可以重命名和删除

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#1542](https://github.com/Prism-Shadow/penguin-harness/pull/1542)

[English](2026-11-12-workspace-rename-delete.md)

侧栏按 Workspace 分组时，凡是指向单一目录的分组，「更多」菜单中都有「重命名工作区」与「删除工作区」，不论它是手动添加的还是因其中有对话而出现的，在本服务端还是在机器上。「临时工作区」合并组两项都没有。

## 细节

- 为从未手动添加的分组重命名，会把它连同所在机器以该名称登记；此后即使没有活跃对话，它也留在列表中。名称留空即恢复显示目录名。
- 「删除工作区」先确认。确认框写明将被归档的活跃对话数、磁盘上的文件不受影响，以及取消归档其中任一对话后该工作区会重新出现。
- 确认后，由持有这些对话的服务端在一次请求中归档本组的全部活跃对话，侧栏尚未加载的也包括在内。运行中的对话照常归档并继续运行。分组连同显示名随即从侧栏消失，顶部浮层报出归档条数；当前打开的对话在其中时跳到新建对话。
- 没有活跃对话的分组直接移除，不向服务端发请求。请求失败时确认框保持打开、什么也不改变；机器上的 PenguinHarness 早于此接口时，提示该机器版本较旧、还不能删除工作区。
- 取消归档其中任一对话后，该分组以目录名重新出现，其置顶、折叠与手工顺序照旧生效。
- 新增 `POST /api/projects/:projectId/sessions/archive`，请求体为 `{workspaceGroup}`（路径，或 `temp`），返回 `{done}`。它归档本 Project 各 Agent 中、Session 列表以 `category=active&excludeOrg=1&workspaceGroup=…` 列出的那些行，逐个同 `PATCH archived: true`，每个 Session 发一条 `session_archived`。`workspaceGroup` 缺失或为空即返回 400。
- 另一个标签页归档了本页未持有的行时，本页的列表会重新加载，在别处删除的工作区不会作为空分组留在这里。
- 英文标签改为 Delete workspace（原为 Remove workspace）。
