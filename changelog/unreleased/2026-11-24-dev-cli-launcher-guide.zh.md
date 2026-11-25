# 说明开发服务器使用的 CLI

- **Date:** 2026-11-24
- **Type:** process
- **Scope:** `tooling`, `docs`
- **PR:** [#1831](https://github.com/Prism-Shadow/penguin-harness/pull/1831)

[English](2026-11-24-dev-cli-launcher-guide.md)

更正了贡献指南中关于 dev server `penguin` 启动脚本的段落：原文说它总是运行构建好的 CLI，改写后说明了经 `tsx` 从源码运行、回退到构建产物、何时运行 `gen:ifaces`，以及何时重新构建 CLI。
