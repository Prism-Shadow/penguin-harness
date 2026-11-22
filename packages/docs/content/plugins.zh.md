---
title: 插件
description: PenguinHarness 的插件是什么、插件包遵循的格式与校验方式、插件从哪里来，以及如何分享——经插件索引、npm 或本机链接。
---

插件是一组 penguin modules——harness 自身就是用它组装的单位（机制面见[服务端启动](/server-boot#插件是什么)与设计文档 PRFC-0001「Module」、PRFC-0003「Plugin」，仓库收录在 `rfcs/` 下）。插件是一个 npm 包。装上它，它的模块进入服务端的模块树，它的 Skill、钩子包、MCP Server 和 Workbench 进入 Agent 的 Agent State——围绕这些的操作见 [Skill 与插件](/skills#工作原理)。这一页讲包本身：它的格式、插件从哪里来、以及如何分享——经插件索引、npm 或本机链接。

## 格式

插件包是一个 npm 包，`package.json` 只带 npm 自己的字段。插件携带的内容在它的入口源码里声明：一个空类，其 `@Component` 装饰器把插件的卡片、Skill、钩子包、MCP Server 和 Workbench 作为贡献投给服务端的 `PluginLibraryModule`；默认导出 `{ modules, replaces }` 是它添加的服务端模块。包的构建对自己的 tsconfig 跑 `penguin-gen-ifaces`，把这份声明写进 `package.json` 旁边的 `ifaces.json`；服务端读取的就是这张表，从不运行包本身。逐字段的表格、目录布局与完整示例见[工作原理](/skills#插件文件格式)。

这些都是插件，同一份格式覆盖所有情况。不同的是包的内容装上后落在哪里：它投给 `PluginLibraryModule` 的贡献——Skill、钩子、MCP Server、Workbench、卡片——装上后进 Agent 的 Agent State，只带这些的包不需要代码入口（`goal` 插件是完整示例）；默认导出里列出的服务端模块——例如沙盒后端——装上后进服务端的模块树。一个包可以两者都有。内置插件还可以带上 Web App 与 CLI 在构建时编入的两半——`./web` 与 `./cli` 两个入口。`browser-automation` 全都带上了：Agent 浏览器的服务端模块、它的面板与设置页、`penguin browser` 命令，以及它的 Skill。

服务端模块需要的平台，至少要和它投稿的槽一样新。槽是具名的贡献点，例如路由组所在的 `HttpModule.routes`。每个槽、槽数据的每个字段，都随某个发行版本出现。较旧的平台不认识较新的槽，也不认识较新的字段（如路由组的 `origin`）。它的校验于是丢弃该模块投给这个槽的全部贡献：插件缺了这一部分照常运行，**插件**页上它那一行说明原因。内置插件随它运行的服务端一同发布。发布到 npm 的包在 README 里写明它需要的最低版本。

## 校验格式

没有哪一步靠「跑一遍插件包」来判断它是什么：表说了算。两处检查读这张表和它周围的包，读到的是同一份生成的文件，所以结论一致：

- **索引仓 CI**检查提交的包：清单可解析、路径拼出它的名字、版本与内容哈希；元数据与 npm 所服务的相符；按 lock 安装得到的正是哈希指向的内容；包是可装载的 ESM 且带 `activate` 导出；许可证在允许清单。这些是提交协议的规则，[CONTRIBUTING](https://github.com/Prism-Shadow/penguin-harness-plugins/blob/main/CONTRIBUTING.md)（插件索引仓库）是它们的权威。
- **本地**，构建包（`penguin-gen-ifaces` 重新生成 `ifaces.json`，过期的表会被具名拒绝），再按服务端的方式装载一次——在部署上走 Project 的 `[plugins]` 表，或走测试所驱动的装载器。声明与表对不上、或表不是构建写出来的包，会被跳过并报告原因。

## 插件从哪里来

四个来源，四条规则：

1. **harness 自己的模块**不是插件作者要列出或提交的东西：它们多数住在主包里，能独立出来的功能会移进 `plugins/` 下的内置插件——Agent 浏览器是第一个，即 `browser-automation`——但无论在哪里，它们都是 PenguinHarness 的组成部分，不是别人的包。今天的包布局见[架构](/architecture)。
2. **builtin plugins**随仓库 `plugins/` 目录发货——一个插件一个 npm 包，按分类列在[内置插件库](/skills#内置插件库)。安装它从 npm 或它的仓库取包，桌面应用把自己的一组插件直接打进安装包。围绕他人产品打造的插件带 `use-` 前缀（`use-firecrawl`），自进化工具包的名字以 `-rsi-toolkit` 结尾。
3. **third-party plugins**收录进[插件索引](https://github.com/Prism-Shadow/penguin-harness-plugins)——一条 PR 一个条目，走那个仓库自己的收录协议。服务端在**插件**页把索引与内置清单合并；索引只管发现，包仍从条目指名的渠道安装。
4. **自己的或未收录的插件**不需要索引：用 `penguin plugin link` 把本机目录链接进服务端的插件前缀——目录留在原地、原位引用，与安装的插件走同一条装载路径；已发布的包也可按 npm 名直接装。

## 分享插件

插件索引仓库的 [CONTRIBUTING](https://github.com/Prism-Shadow/penguin-harness-plugins/blob/main/CONTRIBUTING.md) 是收录协议的权威；本页与 `penguin-plugin` 技能指向它、不复述它的规则——两者与它不一致时，以它为准。简述：先发布包（npm 就是渠道的全貌——条目至少要有一个 harness 能取到压缩包的来源，字节由条目的哈希钉住），让工具写条目（`pnpm new-entry <name>@<version>`），填 `categories` 与 `owners`，跑本地检查，然后开一条恰好带一个条目的 PR。CI 决定机械问题；评审是人。

`penguin-plugin` 技能把同样的步骤带进 harness 会话，并连同另外两条路——按 npm 名安装、或链接本机目录——以及分享前测试一个包的方法（用 `PENGUIN_HOME` 起独立实例、`penguin plugin link` 链进插件前缀）：它驱动协议而不复制协议，两者在同一次改动里一起更新，步骤版永不偏离它驱动的规则。
