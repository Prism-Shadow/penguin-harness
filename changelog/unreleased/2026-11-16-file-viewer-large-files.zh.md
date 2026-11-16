# 文件浏览面板：打开并滚动 200 KB 的文件不再卡死窗口

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `ui`, `web`
- **Breaking:** yes — `@prismshadow/penguin-ui` 不再导出 `EditorScroll`；`WorkspaceFileEditor` 的 `initialScroll` 改为接收 `CodePlace`

[English](2026-11-16-file-viewer-large-files.md)

共享 UI 包中带行号的代码面（文件浏览面板的源码视图与编辑器，以及记忆文件的查看界面）只布局、绘制屏幕附近的行。打开大的源码文件不再让窗口卡住数秒，滚动也能跟上滚轮。全部行仍在页面中，因此页内查找、全选、复制和选区的行号范围与之前一致。

## 细节

- 行按每 100 行分块绘制，屏幕外的块由 `content-visibility: auto` 跳过。未绘制的块按预计尺寸占位：不自动换行时尺寸精确；自动换行时按各行长度与测得的列数估算，因此大文件在自动换行下的滚动条在整份文件滚过一遍之前是近似值。
- 自动换行视图中的行号不再是 `position: sticky`：这种视图不会横向滚动，而每行一个的粘性行号让每一步滚动都重绘整份文件。
- 高亮结果改为按字符串切分成行，复用差异视图的 `splitHighlightedLines`（移至 `code-block/code-lines.ts`），不再解析出第二份 DOM。
- 进入编辑时，源码视图顶部的那一行出现在编辑器顶部的同一偏移处；退出编辑时，源码视图回到编辑器所在的行。两种视图对屏幕外的行排布不同，因此位置按行传递（`readCodePlace` / `restoreCodePlace`），而非按像素偏移。
- 文件浏览面板中渲染的 Markdown 文件，不再在读者每滚过一个标题时重新解析、重新挂载其中的图片与链接。
- ui-gallery 的「代码」看板新增一个自动换行的长代码面。

## 兼容性

`@prismshadow/penguin-ui` 不再导出 `EditorScroll`。原先向 `WorkspaceFileEditor` 传 `initialScroll={{ top, left }}` 的调用方，改为传所滚动容器的 `readCodePlace(box)`。
