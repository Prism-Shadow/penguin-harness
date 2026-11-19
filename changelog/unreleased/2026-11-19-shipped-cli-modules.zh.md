# 随 CLI 发布的插件可以携带在 CLI 里运行的命令

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `cli`, `server`, `core`, `library`
- **PR:** [#1645](https://github.com/Prism-Shadow/penguin-harness/pull/1645)

[English](2026-11-19-shipped-cli-modules.md)

CLI 所依赖的插件可以携带在 CLI 自己进程里运行的命令，与 CLI 自有命令并列。插件包导出 `./cli` CLI 模块（`@prismshadow/penguin-core/cli` 的 `CliModule`），内含命令类、它的构建为这些类生成的表，以及命令的消息组。`penguin browser` 成为第一个这样的模块，此时它仍在 server 包里。用户输入与看到的一切都没有变化：命令、参数、输出、退出码、帮助与语言都与原来相同。

## 细节

- CLI 的构建把所有导出 `./cli` 的插件依赖（`@penguinharness/*`）列进生成的 `cli-modules.gen.ts`，并把这些模块打包进去。启动时每个模块各在一棵树里、对照自己的表 boot，其命令排在 CLI 自有命令与 server 包的命令之后。
- boot 失败的模块被略过，并有一条点名其包的警告；key 不合文法、或首词已是 CLI 命令的命令同样被略过。CLI 其余部分照常运行。
- 模块的命令收到 CLI 的消息包，外加该模块在本次调用语言下的消息组。CLI 的消息表不再携带浏览器的消息组。
- server 连接、API 客户端及其错误、终端输入、`cutText` 与 `renderTable` 连同 `server.lock` 与 `cli-session.json` 的读取，移进新的私有库包 `@prismshadow/penguin-library-cli`。CLI 模块的代码改用这个包，不再用 server 包。server 的 `cli` 与 `lock` 子路径以原名重新导出全部内容。
- PRFC-0024 升到 v1.1.0。它写明了随 CLI 发布的 CLI 模块，不变量「插件的命令归属 server」改为「CLI 从不在运行时加载插件代码」。
