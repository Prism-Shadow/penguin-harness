# 插件向 CLI 贡献命令：贡献给 server 的模块树，经 server 运行

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `core`, `server`, `cli`

[English](2026-10-10-cli-command-contributions.md)

`penguin` CLI 成为一个命令贡献的程序。CLI 自有的二十条命令各是一个 `@Component` 类，其 `contributes["CliCommandsModule.commands"]` 条目是命令的数据半——一个 `key`（命令路径，`a.b.c` 等价于 `penguin a b c ARGS`）与每种语言一行 summary——其 `@Bind(entry.id)` 字段是代码半，与沙箱后端同一个类形状。一次 `CliCommandsModule` 的静态启动收集它们：宿主把每个 key 变成程序上的命令节点、以 summary 作节点描述，再调用绑定的 register。register 从不写自己的路径；契约类型放在 core SDK 的 CLI 命令契约出口（`@prismshadow/penguin-core/cli`）里，贡献者不依赖任何 CLI 包。serve 组——`server`、`web`、`server status`、`server stop` 与 `server reset-admin-password`——仍是一组 CLI 命令，且由 CLI 包携带：启动 server 的代码就是 CLI，因此它收集到的命令由构建固定，在 CLI 进程与 server 进程里一致。

## 插件向 server 贡献命令

插件与其他贡献一样地贡献命令：一个类，其 `contributes["PluginCliCommandsProvider.commands"]` 条目是数据半，其 `@Bind(entry.id)` 字段是代码半。命令与插件的其他部分一起住在 server 的模块树里，因此知道它们的是 server——运行它们的也是 server。无法运行的贡献随一条警告落下：背后没有已加载插件包的模块、不是命令路径的 key、以及一个包贡献了两次的 key（两条都落下，让该包的命令保持无歧义）。

server 以两条路由提供这些命令。`GET /api/cli/commands` 列出每条插件命令连同所属包，对任何已登录用户开放——与 web 应用从 `GET /api/contributions` 读它的槽同一方式。`POST /api/cli/commands/run` 仅管理员，将一个 argv 对一个包的命令、在一个新建程序上解析，应答它们打印的内容与退出码：无参数时打印该包的帮助，用法错误按 commander 的原样，命令自身失败以退出码 1 落在 stderr——一次运行不会波及 server。输出是缓冲的，不作流式传输；它在运行结束时随应答一次到达。

## 分派、歧义、`penguin exec`

不属于 CLI 自有命令的首个词，在 CLI 报未知命令之前先到插件里查证：列表与之比对，恰有一个包命中即运行，运行打印的内容与退出码就是调用者的。查询只问已在运行的 server——不会为一个未证实的词去启动一个未运行的 server，无人应答时命令行交回 CLI 自己的解析，它照旧报出未知命令。两个及以上包命中同样的词即歧义：报告逐包列出一行可直接复制执行的 `penguin exec <包>:<id> …`——id 取该包命令中应答 argv 的最长 key，argv 余下的部分跟在后面，每个词按 POSIX shell 可读回的方式转义——并以退出码 2 结束，什么都不运行。

**`penguin exec <id> [args…]`** 按点分 id 直接点名插件命令——`sandbox.wsl.restart`，至少两段——对列表精确解析：无前缀、后缀或短名匹配，id 之后的每个选项（`--help` 在内）都属于插件命令。两个插件贡献同一个 id 时，用 npm 全名点名：`penguin exec <包>:<id>`，scope 不可省。`penguin exec ls [包]` 列出插件贡献的 id 与 summary。与裸查询不同，`penguin exec` 会启动一个未运行的 server，与任何需要 server 的命令一样。

**兼容性。** 入口契约保持：导出 `cli(argv)` 且返回退出码、`--version` 由宿主应答。对包一起交付的安装，CLI 的命令面不变；变的是命令的收集方式，以及插件的命令从哪里来。
