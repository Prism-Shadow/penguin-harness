# 频道和 desk 对话里引用的文件显示为胶囊

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `web`, `ui`
- **Issue:** [#1440](https://github.com/Prism-Shadow/penguin-harness/issues/1440)

[English](2026-11-05-cited-file-capsules.md)

员工在频道消息或组织的对话（desk 或工单会话）里引用的文件，现在显示为带文件名的胶囊，悬停显示完整路径，和工单里一样。写成 `[Weekly submissions](<app_data_dir>/…/weekly-submissions.md)` 的引用显示为 "Weekly submissions"。点击仍然复制路径。

## 细节

- CommonMark 不把 `[label](<app_data_dir>/…)` 读作链接，因为以 `<` 开头的链接目标在第一个 `>` 处结束。胶囊这一步从解析器留下的文本里读出引用。目标是 Project 数据目录下路径的 Markdown 链接，也显示为带标签的胶囊。其他链接保持原样。
- 其他对话里的路径照旧显示。
- UI 包的 `Md` 从 `MdExtensionsProvider` 取额外的 remark 步骤和元素覆盖，让页面能影响藏在包组件深处的 Markdown。
