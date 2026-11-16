# Web App 的库不再 import 模块，由一道棘轮测试守住边界

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[English](2026-10-03-web-module-boundaries.md)

新增单元测试 `packages/web/test/module-boundaries.test.ts`，对 `packages/web/src` 下的每条静态 import 检查三条规则：库（`features/` 之外的一切）不 import `features/` 下的任何文件；一个 feature 只经对方的 `index.ts` 引用另一个 feature；feature 目录之间不成环。已有的越界记入 `module-boundaries.baseline.txt`，一行一条；基线之外的越界使测试失败，基线里已不再出现的行同样失败，因此这份清单只会减少。

## 细节

- 代码高亮器（`code-highlight.ts`、`highlighter.ts`、`highlighter.worker.ts`）从 `features/chat/` 搬到 `lib/highlight/`；`app.tsx` 与组件库画廊改从这里 import。
- `lib/work-mode.ts` 搬进 `features/company/`。
- 可消除的角标——`use-update-badges.ts`、`todo-badges.ts`、`use-project-todos.ts`，以及只为它们服务的 `todo-dismissals.ts`、`bulk-update.ts`——从 `lib/` 搬到新目录 `features/todos/`，页面与布局改从其 `index.ts` import。
- `PeakWindows` 类型从 `features/models/model-grouping.ts` 下沉到 `lib/peak-windows.ts`，词典不再 import feature。
- 用户可见的行为没有变化。
