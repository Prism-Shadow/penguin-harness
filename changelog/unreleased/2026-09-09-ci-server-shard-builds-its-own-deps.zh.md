# server 测试分片会构建 server 自己的依赖

- **Date:** 2026-09-09
- **Type:** fix
- **Scope:** `ci`

[English](2026-09-09-ci-server-shard-builds-its-own-deps.md)

三个平台上，server 的每一个测试文件都在加载阶段失败，报 `Cannot find package '@prismshadow/penguin-hmr/manifest'`。这些分片跑的是 server 的测试，构建的却是 `@prismshadow/penguin-core...`——core 及 core 的依赖。热更新层还住在 server 包里的时候，这就是全部闭包；自从它独立成 server 所依赖的工作区包 `@prismshadow/penguin-hmr`，这些分片就再没有构建过它，测试连第一条 import 都解析不了。

server 分片（Linux 与 macOS 上的 `server`、Windows 上的 `server-1..3`）现在构建 `@prismshadow/penguin-server...`——server 及其全部依赖，这才是一个跑它测试的分片所需要的。
