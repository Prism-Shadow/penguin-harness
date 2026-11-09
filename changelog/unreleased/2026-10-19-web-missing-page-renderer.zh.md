# 显式报告贡献页面渲染器缺失

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `web`

[English](2026-10-19-web-missing-page-renderer.md)

贡献页面在 builtin 组件缺失时改为明确报告，不再静默跳转到 chat 或静默跳过页面。渲染时缺失组件抛出显式错误；合并页面表时不可用的可选 builtin 保留跳过行为，并输出控制台警告。两种诊断均包含渲染器名称、页面 key 和路径。已注册 builtin 组件与 iframe 页面的渲染行为保持不变。
