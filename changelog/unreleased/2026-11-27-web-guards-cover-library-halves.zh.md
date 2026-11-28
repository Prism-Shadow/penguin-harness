# web 守卫覆盖 library 的 web 半，web 半去掉反向依赖

- **Date:** 2026-11-27
- **Type:** fix
- **Scope:** `web`, `library/workbench`, `library/organization`, `ui-gallery`

[English](2026-11-27-web-guards-cover-library-halves.md)

Web App 的结构性测试现在连同 workbench 与 organization 两个 web 半一起扫描，library 包不再把 Web App 列为依赖。

## 细节

- `@prismshadow/penguin-library-workbench` 与 `@prismshadow/penguin-library-organization` 从依赖里去掉 `@prismshadow/penguin-web`。face 仍经共享的路径别名解析，不重复导入，构建顺序上也不再有环。
- 每个包的 `./web/*` 通配导出改为每个页面一条显式条目，指向它的源文件。包清单现在写明自己究竟提供哪些页面。
- organization 包去掉自己那份 canvas view 辅助函数，经 `@prismshadow/penguin-web/internal` 使用宿主的实现——与它取 state、api、components 用的是同一条接缝。它的导航模块转发宿主的具名导出，不再把整个 internal 中转口整体再导出。
- web 与 ui-gallery 的样式表为两个 web 半补上 `@source` 条目，Tailwind 继续产出搬走页面用到的类名。
- 模块边界测试解析裸的 `@prismshadow` 别名并扫描两个 web 半。它的 baseline 把搬家前的 cycle 记录保留在当初记录它们的条目名下，清单仍只缩不涨。
- 表单提交守卫、原生 title 守卫、菜单样式守卫、快捷键守卫、clipboard 测试与 highlighter worker 测试都把两个 web 半纳入扫描。web 半的页面本来就满足这些规则。
- Vitest 覆盖率统计 web 半的源码，ui-gallery 的 dev server 也监视它们：改 web 半会触发 gallery 重建，覆盖率里也看得到。
