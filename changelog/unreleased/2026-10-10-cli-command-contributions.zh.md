# CLI 命令改为贡献制：`cli.commands` 贡献点，serve 组迁入 server 包

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `core`, `server`, `cli`

[English](2026-10-10-cli-command-contributions.md)

CLI 不再是一整块写死的注册，而是一个宿主加若干命令贡献。一个包用与其他贡献相同的两半来贡献命令：**数据半**——manifest 里 `contributes: { "cli.commands": [...] }` 的条目，每条一个 key（`a.b.c` 等价于 `penguin a b c ARGS`）与中英两种一行 summary——读取时不执行该包，帮助与补全只凭数据作答；**代码半**——包入口导出的 `registerCliCommands(program, ctx)`，只在分派命中它的某个 key 时才 import。贡献命令可触达的一切都在交给它的 `CliContext` 上：解析出的语言、本次调用的数据根、输出与表格助手、API client（连接解析与自动启动在内，鉴权归宿主）与已记住的登录会话——永远不给 token 本身。契约类型放在 core 的插件契约包（`@prismshadow/penguin-core/plugin`）里，贡献者不依赖任何 CLI 包。

## 发现、所有权、分派

宿主在每次启动时读出已解析模块集的数据半：CLI 自身的表、server 包的声明模块、数据根的插件闭包——每个插件的生成表按 server 插件宿主的同一读法读取，绝不 import 插件。帮助只凭这些就把一切列出来。

所有权规则决定一个包能注册什么。宿主为自己保留 `help`、`version`、`exec`、`update`、`auth` 与 `plugin`；他人 key 的子树归其属主，除非属主声明开放——server 包开放 `server.*`。malformed 条目与同包重复的 key 会被丢弃；无效注册被忽略——不进帮助与分派——留待审查报出。**两个包注册同一 key 不是错误**：两条都保留，调用那一刻才裁决执行哪条。

分派把 key 与 argv 比对：key 的各段是 argv 的前导段即命中。命中全部来自**一个包**就执行——commander 自己处理嵌套子命令，`server` 与 `server.status` 同包不歧义。命中来自**两个及以上包**（含前缀重叠）即歧义：宿主逐候选报出一行可直接复制执行的 `penguin exec <包> …`（原 argv 按 shell 转义），末尾一行 Note 提醒事后把实际运行的是哪个包的命令告诉用户——退出码 2，什么都不执行。

## 新的宿主命令

- **`penguin exec <包> [args…]`** 点名包执行其贡献的命令：npm 全名永远可用；短名在恰好一个贡献者携带它时可用；撞名则列出应使用的全名。其余交由该包自己的解析，exec 永无歧义。
- **`penguin plugin check`** 一份报告审查全部贡献：歧义 key（连同贡献它的每个包）、无效注册（连同渲染出的原因——保留根段、未开放的他人子树、重复、malformed）、调用了歧义命令的技能（文件与行号——技能里写下 `penguin x y` 并不能消解歧义）、以及使某个来源没进发现的故障。什么都没找到退出 0，有任何问题退出 1。

## serve 组迁入 server 包

`server`、`web`、`server status`、`server stop` 与 `server reset-admin-password`——server 包天然拥有的服务命令——从 CLI 包迁入 server 包，作为它自己的 `cli.commands` 贡献，随 server 的每次推送到达，不再等 CLI 重装。行为不变：同样的选项、同样的输出、同样的退出码、同样的 `--root` > `PENGUIN_HOME` > 缺省优先级。列表里打印的描述就是贡献自己的 summary，代码半从同一声明读回，帮助与注册的命令不会漂移。CLI 其余命令（config、run、chat、ls、input、logs、agent、project、cost、schedule、org、browser）留在 CLI 包，但改走同一套分派——数据半来自包内一张表，代码半按 key 懒加载。

**兼容性。** 对包一起交付的安装（一次发布、一次推送），用户可见行为零变化。两种混装值得点名：**server 包早于本改动**的安装（升级途中的机器）不贡献 serve 组——`penguin server` 会报未知命令，直到 server 包跟上，`penguin plugin check` 会报出这条故障；**开发检出**需先重建 server 包，CLI 的开发运行才能解析它新增的子路径导出。

**稳定面不变。** 入口契约保持：导出 `cli(argv)` 且返回退出码、`--version` 由宿主应答——桌面端启动服务（`mod.cli(["server"])`）与推送 CLI 检查都正好经过这两个面。
