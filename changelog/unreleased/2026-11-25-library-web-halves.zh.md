# workbench 与 organization 域的 web 页面并入各自 library 包

- **Date:** 2026-11-25
- **Type:** refactor
- **Scope:** `web`, `library/workbench`, `library/organization`, `ui-gallery`

[English](2026-11-25-library-web-halves.md)

workbench、app center、company 与 admin 页面从 Web App 搬进拥有各自领域的 library 包：`@prismshadow/penguin-library-workbench` 收下 workbench 与 app-center 页面，`@prismshadow/penguin-library-organization` 收下 company 与 admin 页面。每个包通过新的 `./web` 导出提供这些页面，Web App 的渲染与之前完全一致。

## 细节

- `./web` 导出指向页面的 TypeScript 源码。每个包的 face 索引按名导出自己的 module 类，web-root 的引导方式与页面还住在 Web App 时相同。
- Web App 不把 library 包列为依赖。face 经 tsconfig、vite 与 vitest 共享的路径别名解析，构建与测试直接消费工作区源码。
- 搬走的页面经 `@prismshadow/penguin-web/internal` 读取 Web App 的 state、api、components 与 rescue；留下的页面经 `@prismshadow/penguin-web/features/<name>` 互相引用。禁止 library 包 import Web App feature 的边界测试继续成立。
- library 的 web 半不依赖 server 包：api 类型全部为 type-only，唯一的运行时值——ticket 的 slug 模式——经 internal 具名转出口取得。
- ui gallery 引导同一个 web-root，经同样的别名解析这些 face。
