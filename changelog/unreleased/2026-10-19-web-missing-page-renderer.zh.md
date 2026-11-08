# 显式报告贡献页面渲染器缺失

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `web`

[English](2026-10-19-web-missing-page-renderer.md)

贡献页面在 builtin 组件缺失时改为抛出显式错误，不再静默跳转到 chat。诊断信息包含渲染器名称、页面 key 和路径。已注册 builtin 组件与 iframe 页面的渲染行为保持不变。
