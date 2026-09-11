# 插件库的文件浏览器改用 Workspace 的目录树

- **Date:** 2026-09-11
- **Type:** refactor
- **Scope:** `web`
- **PR:** [#685](https://github.com/Prism-Shadow/penguin-harness/pull/685)

[English](2026-09-11-shared-file-tree.md)

Workspace 面板的目录树移入 `components/ui/file-tree.tsx`，插件详情 Modal 的文件浏览器改由它绘制。
该浏览器此前的行是朴素按钮——每个分组一个文本三角、每个文件一个间隔点、行与行之间一条分隔线，嵌套
文件还把整段相对路径写进名字里；现在它们就是文件面板画的那种行：折叠箭头、文件夹或文件图形、按层级
缩进，展开与收起目录时带高度过渡。Skill 的 `reference/` 成为一个独立的目录行，不再是九个文件名里的
一条斜杠。

## 细节

- `FileTree` 负责行的标记、缩进刻度、图形、选中与 hover、focus 的表现，WAI-ARIA `tree` 语义
  （`role`、`aria-level`、`aria-posinset`、`aria-setsize`、`aria-expanded`）、轮转式 tab 落点与方向键
  行走，以及调用方用来在指针事件中定位行的 `data-tree-path` / `data-tree-kind` 属性。取数仍归调用方：
  Workspace 面板每展开一层就列一次目录，插件浏览器则对已经拿到的那份清单做分组。
- 行的形状、`subtreeEnd` 与 `treeKeyStep` 从 `lib/workspace-tree.ts` 移入 `lib/file-tree.ts`，其用例
  一并迁移。从一行向上退出时，父行改为取上方最近的更浅一层的行，而不再从路径推得，因此顶层行本身就是
  整段路径（`skills/<名称>`）的树也能落到真实存在的行上。
- `WorkspaceTreeView` 保留只属于 Workspace 的部分：行提示与名称之后的大小与修改时间、未打开任何文件
  时以上传目录代替选中项，以及行列表为空时的三种含义。
