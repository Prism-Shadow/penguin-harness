# 随 CLI 发布的插件可以携带在 CLI 里运行的命令

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `cli`, `server`, `core`, `library`
- **PR:** [#1645](https://github.com/Prism-Shadow/penguin-harness/pull/1645)

[English](2026-11-19-shipped-cli-modules.md)

CLI 所依赖的插件可以携带在 CLI 自己进程里运行的命令，与 CLI 自有命令并列。插件包导出 `./cli` CLI 模块（`@prismshadow/penguin-core/cli` 的 `CliModule`），内含命令类、它的构建为这些类生成的表，以及命令的消息组。`penguin browser` 成为第一个这样的模块，此时它仍在 server 包里。用户输入与看到的一切都没有变化：命令、参数、输出、退出码、帮助与语言都与原来相同。

## 细节

- CLI 的构建把所有导出 `./cli` 的插件依赖（`@penguinharness/*`）列进生成的 `cli-modules.gen.ts`，并把这些模块打包进去，每个模块轮到它时才 import。启动时每个模块各在一棵树里、对照自己的表 boot，其命令排在 CLI 自有命令与 server 包的命令之后。
- 随包发布的模块做什么都拦不住 CLI。求值时抛错或类 boot 不起来的模块被略过，并有一条点名其包的警告；key 不合文法、与本模块的 key 重复、或名称与别名已在程序上的命令同样被略过；register 抛错的命令又从程序上撤下。CLI 其余部分照常运行，`penguin server` 也不例外。
- 模块的命令收到 CLI 的消息包，外加该模块在本次调用语言下的消息组；与 CLI 自有消息组同名的组沿用 CLI 的，并给出警告。CLI 的消息表不再携带浏览器的消息组。
- server 连接、API 客户端及其错误、终端输入、`cutText` 与 `renderTable` 连同 `server.lock` 与 `cli-session.json` 的读取，移进新的私有库包 `@prismshadow/penguin-library-cli`。CLI 模块的代码改用这个包，不再用 server 包。server 的 `cli` 与 `lock` 子路径以原名重新导出全部内容。
- `scripts/check-publishable.mjs` 也读取 `library/` 下的包，发布包若把其中之一列为运行时依赖，检查即不通过。
- 设计见 PRFC-0024 v1.2.0，在单独的 pull request [#1649](https://github.com/Prism-Shadow/penguin-harness/pull/1649) 中修订。
