# Markdown、代码与文字角色迁入共享 UI 包

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[English](2026-09-30-ui-migration-w5.md)

UI 包迁移的 W5 把 Web App 的内容渲染搬进 `@prismshadow/penguin-ui`：Markdown、代码块及其高亮，并新增文字角色组件与差异视图。

## 迁入的内容

- **Markdown**：`Md`（属性与名称不变）与新增的阅读容器 `Prose`（`body`、`compact`、`flush` 三种密度），连同共享的插件管线（`REMARK_PLUGINS`、`REHYPE_PLUGINS`、`NO_REHYPE_PLUGINS`）及其自动链接与公式处理。`.md-body`、`.md-compact`、`.code-*`、Shiki 与 KaTeX 的样式从应用样式表移入包内的 `prose.css`，改以令牌书写；KaTeX 样式表也改由包加载。
- **链接**：Markdown 链接默认在新标签页打开，由 `ProseLinksProvider` 决定例外；应用的 `WorkspaceLinksProvider`（对话里指向 Workspace 文件的链接）建立在它之上。
- **代码**：`CodeBlock`（代码的 `ui-frame` 宿主）与 `CodeSurface`，连同语言表。组件自身从不运行 Shiki，而是调用经属性或 `CodeHighlighterProvider` 传入的 `CodeHighlighter`；引擎单独发布为子路径 `@prismshadow/penguin-ui/highlighter`，Web App 仍在 Worker 中运行它。
- **Workspace 的 Markdown 预览** 改经 `Prose` 渲染，不再保留第二套管线。
- **新增**：`Heading`（主题的 h1–h6 字阶，`display` 用于页面唯一的展示标题）、`Text`（正文、小字、说明、分组标签、等宽与字段标签六种角色）、`InlineCode`，以及 `DiffViewer`（合并或并排视图，接受两段文本或补丁，标出改动的词并高亮两侧代码）。

## 细节

- 包自带的无障碍兜底文案新增「复制代码」，由 Web App 按界面语言提供。
- `Md` 可在共享管线之上追加 remark 插件与元素覆盖；公司频道的提及标签与工单的路径胶囊经由它们渲染。
- 画廊的组件库新增「内容」页。
- KaTeX、Shiki 与 remark / rehype 插件改由包依赖；Web App 只保留 `react-markdown`。

## 通用主题下可见的变化

- Markdown 中的行内代码与尚未高亮的代码改用正文墨色：浅色下深一档，深色下浅一档。
- Markdown 引用块的文字在浅色下浅一档。
- Markdown 链接的下划线改为其自身墨色的淡色；深色下悬停不再变深。
- KaTeX 无法解析的公式，其虚线下划线在深色下浅一档。
- 消息代码块中的代码跟随文字大小设置（默认大小下仍为 13 px）。
- 文件面板 Markdown 预览中的代码块加上代码块外框，带语言标签与复制按钮。
