# 公司模式的提案：人读一份，Agent 同时做一份

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[English](2026-09-21-company-proposals.md)

公司模式新增**提案**：一份短小、抽象、可逐段评论的改动说明，由一名员工写给人读，同时把它做出来——自己做，或交给同事做。组织里谁都可以发起：人委托，或员工自己提出。它以一对缺省不启用的插件交付——模块插件 `@prismshadow/penguin-plugin-company-proposals`（`plugins/company-proposals`：账本、路由、页面投稿）与内容插件 `@penguinharness/agent-company-proposals`（`proposal-author`、`proposal-implementer`、`proposal-tester` 三份 Skill；`preinstall: false`）。设计见 penguin-harness-design [#210](https://github.com/Prism-Shadow/penguin-harness-design/pull/210)（PRFC-0016）。

## Details

- 一份提案有组织内的编号、作者（点名的员工，否则是发起的员工）、可选的实施者（缺省为作者自己，除非点名同事）、发起它的主体（`user:<id>` 或 `agent:<id>`），一个 `root`（仓库在共享工作区中的目录）与一份由 `<类型, 文件, 可选名称模式>` 组成的 `scope`——类型是 `edit`、`new`、`delete` 或 `rename`（带 `from`）——、各节（改动 / 目的 / 测试），以及放在 frontmatter 最后的 `tests` 列表：由 `<文件, 可选名称模式, 类型, 分组, 说明>` 组成，类型是 `existing`（缺省）、`new` 或 `delete`（改动要删掉的测试），分组可以是任意小写词（缺省 `unit`；常用的是 `unit`、`integration`、`e2e`、`bench`），说明——这个测试测什么——必填（400 `tests_invalid`）。文件路径只出现在范围与测试里。评论落在一段文字上：存为该节 Markdown 源码的一个区间（偏移量加所引文字），每次修订按所引文字重新定位（文字没了的评论列在它最后所在的修订上）；Agent 永远看不到偏移量——`penguin org proposal comments` 打印正文，把每段被评论的文字包在 `⟦<id>⟧…⟦/<id>⟧` 里，再按 id 列出评论。第一版按整段写下的评论在折叠时锚到该段的区间。正文里出现文件链接即被拒绝。
- 范围在 `publish` 时对照工作区检查：`edit` / `delete` 的文件或 `rename` 的源不在 `root` 下，该修订被拒绝，并给出可能的路径（去掉 `legacy` 一段的路径，或有界搜索找到的同名文件）；`new` 的文件或 `rename` 的目标已存在时照常发布并附提示。已合并的提案不再检查。每次读取都报告各条目的状态——`exists`、`new`、`missing`、`deleted` 或 `renamed`——以及解析出的目录。类型出现之前写下的账本按 `edit` 读取，不改写文件（见 [2026-09-24-backward-compatibility.zh.md](2026-09-24-backward-compatibility.zh.md)）。测试同样检查：`existing` / `delete` 测试的文件不在 `root` 下，该修订被拒绝（400 `tests_missing`，附可能的路径）；`new` 测试所在的文件已存在时照常发布并附提示；每次读取都报告各测试的状态（`exists`、`new`、`missing`）。测试出现之前写下的修订读作没有测试。
- 状态：`drafting` → `ready` → `approved` → `merged`，或 `rejected`；请求整改把 `ready` 退回 `drafting`，此后作者的 `ready` 会被拒绝（409 `changes_pending`），直到在这批评论之后发布过修订、且其中每条评论都已 resolve——拒绝信息列出仍未处理的评论；人可以不受此限标记 ready。认可只覆盖一个修订：其后的 publish 把提案退回 `ready`，告诉实施者等新的认可，页面把自认可的修订以来的改动就地标出——标题里增删的词；范围与测试的每一行：新增的着色、删去的划线并留在原位（不是链接）、改过的把旧值划线放在新值旁边；删去的段落划线、新增的段落着色、改过的段落就地标出增删的词——其上只有一行，写明认可的修订与认可人，并带「改动 | 最新」切换（「最新」显示不加标记的当前提案）（`GET …/revisions[/:rev]` 可读回任一修订；`show` 打印 `approved: r<M>`）。
- 人的评论在点「请求整改」之前都是待发的——写它的人可随时修改或撤回，发出后固定；一批评论以一行文字直接送到作者的工位——`[proposal #<n>]`、发生了什么、要跑的命令——不以任何人的名义，也不经过任何频道。所有要告知员工的步骤都走同一条路：委托告知作者，请求整改与反馈告知作者，运行时反馈告知作者与实施者，认可告知实施者（没有则作者），认可后的修订告知实施者，拒绝告知作者与实施者；员工不会被告知它自己做的事。送不到的一行（组织或员工已暂停、没有工位）记为一条 `notify_failed` 事件，并作为提示随写入的应答返回——页面弹出提示，CLI 打印出来。
- `implement` 以工单会话的方式为同事开一个实施会话，首条输入是提案全文；做出来的 PR 以材料挂上（`pr`、`issue`、`branch`、`doc`、`ticket`、`url`）。
- 每个事件带序号记录；每个人对每份提案有一个已读位置，其后的事件即该提案的未读数。
- 账本是 `<orgDir>/proposals.jsonl`，只追加、启动时重放；已读位置存在 `server_settings`。正文来自哪里——issue、工作区里的 RFC 文件——由公司决定，账本记的是发布进来的那份。
- 页面：插件投稿的一条公司模式路由（`pages.nav: "org"`）——队列是整宽的列表（未读优先、再按编号），搜索是 GitHub 式的——缺省 `is:open`，已合并 / 已拒绝的按一下状态胶囊就出来；`is:`、`author:`、`implementer:`、`by:`、`unread:`、`no:implementer`、`-` 否定、引号短语，查询写在 `?q=` 里——提案是独立的一页（返回面包屑、页头、材料一行一条——GitHub 的 PR 带状态胶囊：草稿 / 待合并 / 已合并 / 已关闭，读提案时向 GitHub 取、不存账本——范围列在其根目录下、一行一个文件，带类型与状态，名称模式换行在其下——存在的文件是链接，在提案右侧的面板里只读打开（手机上是覆盖整页的面板；`?file=` 让刷新后仍在，后退即关闭），由插件从组织所在的服务器读出、限于提案的根目录，名称模式匹配的行标出，缺失的文件标明缺失——、正文——评论以标记盖在所引文字上，选中一段文字出现「评论所选文字」，悬停一段出现「评论这一段」——、测试——按 `unit`、`integration`、`e2e`、`bench` 再其余按字母分组，每组可折叠，超过 12 行的组先显示 12 行并给出「再显示 N 条」，每行是类型、文件（存在时是链接）、名称模式与它测什么——、时间线，以及**请求整改**、**认可并请求合并**、**拒绝**三个动作）。侧栏入口带未读总数。任何 Markdown 表面里的 `proposal:<n>[#<模式>]` 渲染为带标题与未读数的胶囊。
- CLI：`penguin org proposal ls | show | create | publish | ready | implement | material add | feedback | comments | resolve | merged | approve | reject`。`show` 打印根目录，并把每条范围打印为 `<类型> <文件>`（`rename <源> → <文件>`）及其状态，并在各节之后按分组打印测试：`<类型> <文件> [<名称模式>] — <说明> (<状态>)`；`publish` 打印服务端的提示。没有装插件的组织答一个普通的 404，CLI 据此报告插件缺失。
- 内容插件由代码插件在有人写或做提案的那一刻自动装到该员工上——不用手装，也不为它招岗位。插件不使用任何频道。
- 插件所依赖的平台接缝：向插件导出的 `OrgGateway`（读组织、归属写入、向员工的工位送一行文字（`deliverToDesk`：排在进行中的 Task 之后，组织或员工暂停时拒绝）、开员工会话、通知 Project）、通用的 `plugin` 服务端事件、投稿页面 `nav` 的 `org` 取值，以及服务端 API 类型里的提案 DTO。
