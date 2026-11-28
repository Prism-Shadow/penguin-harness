# 迁出的 web 半面恢复扫描、导出与守卫

- **Date:** 2026-11-27
- **Type:** fix
- **Scope:** `web`

[English](2026-11-27-library-web-halves-guards.md)

各域 web 功能迁入所属 library 包（见 `changelog/unreleased/2026-11-24-library-web-halves.zh.md`）的后续修复，让 Web App 保住这次搬迁悄悄丢掉的保证：

- Tailwind 样式入口重新扫描 `library/*/src/web`——迁出的页面拿回自己的工具类（被限高的滚动区、带左缩进的时间线图）。Gallery 的两个画框装载同一份样式入口，一并覆盖。
- 每个 library 包的 `./web` 导出逐条列出深层子路径实际落到的文件（含扩展名）。走包清单解析的消费方，诸如 `@prismshadow/penguin-library-agent/web/agents/agent-settings-page` 这样的子路径重新可解析。
- 模型目录只进一次 Web 构建图：宿主对 server `model-catalog` 子路径的导入改解析到 model 包的目录源码——与库内文件读的是同一个模块，而不是第二份编译副本。
- 走查 Web 源码的守卫重新覆盖 library web 半面——模块边界棘轮、表单提交模型、菜单外观、原生 `title` 与可访问名称检查、修改键扫描——Web 的覆盖率报告也重新计入这些文件。
- Gallery 开发服务器对 library web 半面新增文件重新失效样式；模型目录维护指引指向 protocol-path 文件的新家。
