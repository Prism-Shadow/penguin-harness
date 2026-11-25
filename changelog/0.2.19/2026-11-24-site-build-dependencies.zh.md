# 从全新检出构建官网

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `tooling`, `landing`, `ui-gallery`
- **PR:** [#1796](https://github.com/Prism-Shadow/penguin-harness/pull/1796)

[English](2026-11-24-site-build-dependencies.md)

官网构建会先按依赖顺序构建服务端使用的工作区包，再打包组件画廊。从全新检出的代码也能将首页、文档和画廊组装在同一个部署目录中。
