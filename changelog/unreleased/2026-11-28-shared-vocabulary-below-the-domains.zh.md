# 工作台操作与管理员用户区下沉到域之下，合并后的节点不再闭出新环

- **Date:** 2026-11-28
- **Type:** fix
- **Scope:** `web`, `library/workbench`, `library/organization`, `plugins/browser-automation`

[English](2026-11-28-shared-vocabulary-below-the-domains.md)

共享的工作台词汇与管理员用户区搬到两侧都能抵达的层，模块边界图里 web 半合并时闭出的六个环随之消失。managed-browser 的标签页在标题完整可见时也能看到完整 URL 提示。

## 细节

- 工作台源码/版本/删除操作（`useWorkbenchActions`、`useWorkbenchPaletteActions`、`LoadFailedActions`）与加载失败报告（`workbenchLoadFailure`、`WorkbenchLoadError`、`FailedWorkbench`）从 workbench web 半搬进 Web App 的 `lib/`，位于各域之下：Agent 设置与侧边栏直接读取，web 半经宿主接缝读回。workbench 包删掉指向被搬文件的深导出。
- 管理员用户区回到 Web App 自己的 features（`features/admin`），重新成为独立入口：organization web 半只剩 company mode，导入这一区不再把 company mode——连同它引到的 chat、plugins——拖进 settings 模块的 import。
- 模块边界 baseline 删掉这些边闭出的六条 cycle 记录；清单仍然只缩不涨。
- managed-browser 标签页的提示在 URL 与可见标题不同时自标为「携带屏幕上没有的内容」（`data-tooltip-extra`），标题放得下时完整 URL 仍然可达。
