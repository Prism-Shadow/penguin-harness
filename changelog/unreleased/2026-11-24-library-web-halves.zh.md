# 各域 web 功能迁入所属 library 包

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `web`

[English](2026-11-24-library-web-halves.md)

agents、projects、traces、models 四个域的 web 功能（agents 页、projects 页、traces 页、模型页与模型选择器）从 Web App 迁入各自域包：每个包经 `./web` 入口提供自己的 web 半，Web App 直接编译这批 TypeScript 源码并把各域模块作为自有 children 挂载。这些功能消费的宿主共享件经 Web App 的 internal 面统一再导出。行为无变化。
