# CLI 的静态命令注册表解散，命令作为贡献回到自己的代码旁

- **Date:** 2026-11-03
- **Type:** feature
- **Scope:** `cli`, `server`

[English](2026-11-03-cli-finish.md)

CLI 的内建命令不再集中在一个注册表文件里。`commands/` 下的每个命令文件现在自带一个
`@Component` 类，与它注册的代码放在一起——类的 `contributes["CliCommandsModule.commands"]`
条目是命令的数据半（key 与一行摘要），`@Bind` 字段是代码半。这些类的清单是生成的、不再
手工维护：`gen:ifaces` 新增 `--components-out`，扫描两个包里向该槽位贡献的类并写出
`src/cli-commands.gen.ts`，所以加一条命令只需改一个文件，清单跟着源码扫描走。server 包的
资源命令（agent/project/schedule/cost/config）经同一张生成表参与，经
`@prismshadow/penguin-server/cli` 子路径引入。

与此同时，最后一条仍归 CLI 包所有的命令迁到 server：`penguin browser` 与它共享的助手进入
server 的 `src/cli`，经一个 `BrowserCommandsModule` 贡献，方式与 `org` 经 company 模块贡献
相同；CLI 在内建命令与 company 命令之后 boot 它。命令的客户端层已在 server 时，新增命令
不必再动 CLI 包。

一处可见变化：help 现在按源文件路径顺序列出内建命令，`penguin --help` 下条目的顺序因此
改变；`penguin browser` 行为不变。
