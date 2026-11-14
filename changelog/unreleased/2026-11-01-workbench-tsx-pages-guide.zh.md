# penguin-plugin Skill 与文档讲解用 TSX 编写工作台页面

- **Date:** 2026-11-01
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#1415](https://github.com/Prism-Shadow/penguin-harness/pull/1415)

[English](2026-11-01-workbench-tsx-pages-guide.md)

`penguin-plugin` Skill 与文档开始讲解如何用 TSX 和 `@prismshadow/penguin-ui` 编写工作台页面，由服务端检查、编译并提供。纯 HTML 与 JavaScript 页面的写法照旧保留在文档中。

## 细节

- `penguin-plugin` 新增「Pages in TSX」一节，给出一个完整页面：`ui/index.html` 加载编译产出的 `app.js`，`ui/app.tsx` 从 `react`、`react-dom/client` 和 `@prismshadow/penguin-ui` 导入，另有一份只管页面自身元素的样式表。这一节列出页面可以导入的模块以及其余导入会引起的加载错误，说明页面的诊断写在哪里、服务端写入 `.harness/ui/` 的组件类型，以及 TSX 页面如何通过变量形式的模块说明符引入页面 SDK。
- Skill 的 Layout、「TypeScript, checked by the server」、HTTP 和 Theme 几部分补上了 `ui/` 的第二个程序、`.build/<revision>/ui/`、`sdk/ui/*` 路由，以及 TSX 页面的样式写法：组件用属性，页面自己的元素用自己的 CSS 读取 `--ui-*` 变量，自己的标记上不写 Tailwind 类，也不引入 `/workbench-ui.css`。Skill 的 `version` 改为 `2026.11.01.1`，已安装的副本因此会收到更新提示。
- 文档：「技能与插件 › Workbench 插件」新增一段说明和一个简短的 TSX 页面示例，中英文同步。
