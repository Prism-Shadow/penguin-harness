# 公司模式的提案：人读一份，Agent 同时做一份

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[English](2026-09-21-company-proposals.md)

公司模式新增**提案**：一份短小、抽象、可逐段评论的改动说明，由一名员工写给人读，同时把它做出来——自己做，或交给同事做。组织里谁都可以发起：人委托，或员工自己提出。它以一对缺省不启用的插件交付——模块插件 `@prismshadow/penguin-plugin-company-proposals`（`plugins/company-proposals`：账本、路由、页面投稿）与内容插件 `@penguinharness/agent-company-proposals`（`proposal-author`、`proposal-implementer`、`proposal-tester` 三份 Skill；`preinstall: false`）。设计见 penguin-harness-design [#210](https://github.com/Prism-Shadow/penguin-harness-design/pull/210)（PRFC-0016）。

## Details

- 一份提案有组织内的编号、作者（点名的员工，否则是发起的员工）、可选的实施者（缺省为作者自己，除非点名同事）、发起它的主体（`user:<id>` 或 `agent:<id>`），一份由 `<文件, 可选名称模式>` 对组成的 `scope`——文件路径只出现在这里——以及各节（改动 / 目的 / 一个测试例）。评论落在一段文字上：存为该节 Markdown 源码的一个区间（偏移量加所引文字），每次修订按所引文字重新定位（文字没了的评论列在它最后所在的修订上）；Agent 永远看不到偏移量——`penguin org proposal comments` 打印正文，把每段被评论的文字包在 `⟦<id>⟧…⟦/<id>⟧` 里，再按 id 列出评论。第一版按整段写下的评论在折叠时锚到该段的区间。正文里出现文件链接即被拒绝。
- 状态：`drafting` → `ready` → `approved` → `merged`，或 `rejected`；请求整改把 `ready` 退回 `drafting`。修订不改状态。
- 人的评论在点「请求整改」之前都是待发的——写它的人可随时修改或撤回，发出后固定；一批评论以一条 `@` 消息送达作者，落在组织的 `proposals` 频道——插件随第一份提案建立它，并把涉及的人邀请进去。实施反馈、测试团队的运行时反馈与认可都走同一条路，不新增触发种类。
- `implement` 以工单会话的方式为同事开一个实施会话，首条输入是提案全文；做出来的 PR 以材料挂上（`pr`、`issue`、`branch`、`doc`、`ticket`、`url`）。
- 每个事件带序号记录；每个人对每份提案有一个已读位置，其后的事件即该提案的未读数。
- 账本是 `<orgDir>/proposals.jsonl`，只追加、启动时重放；已读位置存在 `server_settings`。正文来自哪里——issue、工作区里的 RFC 文件——由公司决定，账本记的是发布进来的那份。
- 页面：插件投稿的一条公司模式路由（`pages.nav: "org"`）——队列是整宽的列表（未读优先、再按编号），提案是独立的一页（返回面包屑、页头、材料、范围——每个文件是链接，在持有它的会话的 Files 面板里打开——、正文——评论以标记盖在所引文字上，选中一段文字出现「评论所选文字」，悬停一段出现「评论这一段」——时间线，以及**请求整改**、**认可并请求合并**、**拒绝**三个动作）。侧栏入口带未读总数。任何 Markdown 表面里的 `proposal:<n>[#<模式>]` 渲染为带标题与未读数的胶囊。
- CLI：`penguin org proposal ls | show | create | publish | ready | implement | material add | feedback | comments | resolve | merged | approve | reject`。没有装插件的组织答一个普通的 404，CLI 据此报告插件缺失。
- 内容插件由代码插件在有人写或做提案的那一刻自动装到该员工上——不用手装，也不为它招岗位。频道消息以行事者的名义发出（员工从其会话发出，否则是人）；员工自己的提案不 @ 任何人。
- 插件所依赖的平台接缝：向插件导出的 `OrgGateway`（读组织、归属写入、确保频道并在其中发言、开员工会话、通知 Project）、通用的 `plugin` 服务端事件、投稿页面 `nav` 的 `org` 取值，以及服务端 API 类型里的提案 DTO。
