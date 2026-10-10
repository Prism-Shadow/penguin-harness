# 本地插件目录经 link 启用

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`

[English](2026-10-10-link-local-plugin.md)

盘上的一个插件目录此前没有入口：示例包是私有包、不随内置插件分发，启用它意味着手工把一份副本 stage 进捆绑前缀——副本会与源漂移，没有记录，撤销也只是再改一次。

## 改动

- 「启用本地插件」（admin 操作）点名一个已构建的插件目录；服务器把它 link 进宿主的插件前缀，并把包名列进 Project——一步成立，没有手工编辑的文件。路由是 `POST /api/projects/:projectId/plugins/installed/local`，请求体 `{ "path": … }`。不是绝对路径、不存在、不是包、没构建（入口文件缺失）的目录，各自带着原因被拒，一个字节都不写。
- link 有记录——目录在哪、何时、由谁——每个包名一行，机器级。前缀每次装配都重建，记录才是 link 的载体：每次装配都按记录把名字重新链上；sweep 只删整代，永远碰不到数据根之外的源目录。
- 经 link 的插件没有 integrity。它在 generation 里的条目以本地路径与装配时从其 package.json 现读的版本为键；版本仍须满足 Project 表对名字的要求，对 link 名的 integrity pin 被拒——本地目录承诺不了校验和。
- 经 link 插件的 installed-plugins 行显示其来源，行上的「Unlink」一步撤销整个操作：名字离开每个 Project 的表，记录删除。Agent 上已从它装走的副本保留。
- Web 的插件页对 admin 提供「Enable a local plugin」入口、在行上显示来源、unlink 前先确认。在另一台机器上看到的 link 行给出受阻原因，而不是 Remove。
- 三个示例插件的 README 改教这条路——先构建包，再 link——不再教手工 stage 前缀。web e2e 套件照旧在自己的临时数据根上 stage 示例：那种数据根里没有东西该比一次运行活得久，更不该有一条 link 的记录。
