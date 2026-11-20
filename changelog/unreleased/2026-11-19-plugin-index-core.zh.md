# 插件索引的读取函数改由 core 导出

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `core`, `server`

[English](2026-11-19-plugin-index-core.md)

读取已发布插件索引的函数——逐行校验、一行从哪个发布渠道安装、SemVer 优先级与每个包的最新一行，以及索引地址——从服务端的注册表移到 `@prismshadow/penguin-core/plugin-index`，这个子路径不依赖 Node。服务端注册表引入它们，并以原名继续导出，调用方不变；官网构建因此可以按同一套规则读取索引，而不必伸进服务端的源码。

## 细节

- 已发布的索引改从 `https://github.com/Prism-Shadow/penguin-harness-plugins/releases/download/nightly/index.json` 读取，即仓库的现名，文档早已使用这个名字。插件设置组的默认索引地址同步改为该地址。
