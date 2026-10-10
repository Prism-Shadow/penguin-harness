# 代码插件可以把它随包携带的 Skill 贡献出来

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `server`, `plugins`

[English](2026-10-09-skills-via-contributes.md)

带代码的插件此前没有办法把 Skill 交给 Agent：README 里自己承认了这一点，Skill 只能靠手工装到 Agent 上。

## 改动

- 模块把它随包携带的技能目录声明在新的 `PluginSkillsProvider.skills` 槽位上：`{ id, path }`，path 相对包根且不得出包。声明是清单数据——不运行包就能列出并做类型检查——逐条互不牵连：出包的路径、没有可读 SKILL.md 的目录、不合名字模式的技能名、背后没有包的模块，各自记下原因后跳过，其余照常可装。
- 包处于启用状态（某个 Project 的 `[plugins]` 列了它）时，其技能经插件安装路由按包名装到 Agent 上——与插件库同一条路由、同一个写入器、同样的运行时失效。库不认识的名字会接着问启用中的代码插件；两边都不认识的名单是 404，一个也不装。没有 Project 列名的包不贡献任何东西：名字不再应答，Agent 上已装的副本保留。
- 进程正在运行的插件，其 installed-plugins 行把可装的技能按元数据列出。
- 示例音乐插件把它的 `send-music` 技能声明在槽位上，README 改为经路由安装，不再手工搬运。
