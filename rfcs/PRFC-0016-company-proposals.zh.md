# PRFC-0016 公司模式的提案：人读一份，Agent 同时做一份

[English](PRFC-0016-company-proposals.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0016-company-proposals.md`——草案，见设计 PR [#210](https://github.com/Prism-Shadow/penguin-harness-design/pull/210)（draft）；open 设计 PR [#233](https://github.com/Prism-Shadow/penguin-harness-design/pull/233) 对这份草案的未合并修订已并入本文件。
> **修订**：v1.0.0（迁入主仓，取草案当前版本）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `company_proposals`
- Start Date: 2026-09-21
- PRFC PR: [Prism-Shadow/penguin-harness-design#210](https://github.com/Prism-Shadow/penguin-harness-design/pull/210)
- Implementation PR: [Prism-Shadow/penguin-harness#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)（草稿，挂在 PR 链顶 #818 之上）

## Summary
[summary]: #summary

给公司模式加一个**提案（Proposal）**：人把一件改动委托给一名员工，或员工自己提出（CEO 向董事会提计划就是最常见的一种）；作者写一份短小、抽象、可选段评论的提案，**同时开始实施**——缺省由作者自己做，也可以交给同事——实施以一个 GitHub PR 为关联材料，两边互不阻塞。它是一种任务机制，不是岗位：不为它招任何人。提案员工按实施反馈修订，人在页面上看到修订与「已就绪」；人选中一段文字评论、攒成一批发回整改；认可后请求合并。合并之后的运行时问题以工单给出，合并之前的以整改给出——由测试团队分批测试 dev 分支得来。

它以**插件**的形式交付，**缺省不启用**：一个代码插件（服务端模块、路由、页面投稿）与一个内容插件（三段协议，作为三份 Skill）；内容插件由代码插件在有人写或做提案时自动装到该员工上。插件只提供提案的**账本与界面**——编号、段落、评论、事件、未读、关联材料——提案正文来自哪里（GitHub issue、仓库里的一份 RFC）由公司自己决定，员工经 `penguin org proposal` 把它送进账本；原型不设扩展点，只把这一种形态做完整。

## Motivation
[motivation]: #motivation

公司模式今天的「提案」只是一句约定：CEO 在全员频道 @董事会写一段话然后停下（05「组织手册」「决策属于董事会」）。没有任何东西记录一份提案是开着的、被答复的还是被改过的；人要看的是频道里的一条长消息，回复也是一条消息，第二轮修改从头再写一条。工单承载的是**做什么**，不是**为什么这样改、改了哪些接口**——审阅一份改动需要的是后者。

真正的阻塞在人这一边：人读得慢。今天员工要么等人批完再动手（人成为吞吐瓶颈），要么直接做完再说（人拿到的是既成事实）。这份提案要的是第三种：**人读的时候 Agent 已经在做**，做的结果反过来把提案改准；人认可时实施已经在 PR 里等着合并；即使人一直没读，实施也已经并入 dev 分支接受测试团队的检验，不会因为等人而烂掉。

场景：

- **委托一次重构。** 人在提案页点「新建提案」，选员工 `acme_dev` 写下一句委托：「把组织调度器的 ticket 通知改成按员工批量送达」。`acme_dev` 写出提案 #12：拟改的接口、改法、目的、一个测试例；同时请 `acme_impl` 开工。人第二天打开提案页，看到 #12 已就绪、两次修订、PR 在关联材料里。
- **选段评论。** 人在「改动」一节选中「`reconcileCalendar` 在日程触发前 `takeDeskNotices`」这几个词写「没说被谁调用」，在「测试」一节选中测试例名写「应覆盖重启后不重复」，点「请求整改」——两条评论成一批，`acme_dev` 收到一次：正文里被评论的文字包着 `⟦c1⟧…⟦/c1⟧`，改一次、回一次。
- **实施反过来改提案。** `acme_impl` 发现改法碰到了一个提案没列的文件，用 `feedback` 说明；`acme_dev` 把范围加进去并出第三次修订，人看到「已修订」的未读事件。
- **认可与合并。** 人点「认可并请求合并」；`acme_impl` 把 PR 合进主干，报告 `merged`。
- **测试团队。** 每周一次，`acme_qa` 拉 dev 分支跑一遍：#12 已合并、有回归——开一张修复工单挂到 #12；#13 还没被认可、有崩溃——向 #13 的作者与实施者发一条运行时反馈，两人联合整改。
- **链接。** 频道消息或对话里出现 `proposal:12`，渲染为「#12 批量送达工单通知 · 2」的胶囊——标题与未读数——点开即到提案页。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 名词

- **提案（Proposal）**：一份可审阅的改动说明，属于一个组织，按组织内递增编号（`#12`）。它有一名**作者**（写它的员工：点名的那位，否则是发起它的员工）、可选的一名**实施者**（做它的员工，缺省是作者自己）、一名**发起者**（`delegatedBy`：发起它的人或员工，记为主体 `user:<id>` / `agent:<id>`）。
- **范围（scope）**：拟改的文件与接口——`<类型, 文件, 可选的名称模式>` 的列表，模式是带捕获组的正则。类型说明文件的去向：`edit`（已存在、要改）、`new`（改动新建）、`delete`（改动删除）、`rename`（改名：`from` 是现在的路径，`file` 是新路径）。路径都相对于提案的**根目录**（`root`：仓库在共享工作区中的目录，缺省为共享工作区本身）。范围是改动的**子集**，实施应尽量不超出它；超出了就由实施者反馈、作者补进范围。**文件路径只出现在范围与测试里。**
- **测试（tests）**：证明这项改动的测试——`<文件, 可选的名称模式, 类型, 分组, 说明>` 的列表，放在 frontmatter 最后（可能很长）。文件相对于 `root`；名称模式与范围的一样，是对该文件里测试名的正则；类型是 `existing`（已有，缺省：改动须保持它通过，或改它）、`new`（拟增）或 `delete`（改动删掉它；带名称模式时只删匹配的用例，说明写为什么删）；分组缺省 `unit`，**只能取插件配置里声明过的分组**（见下「测试分组」）；**说明必填**：这个测试测的是什么。既列出已有的相关测试，也列出拟增与要删的测试。
- **正文（sections）**：固定三节——**改动**（改了什么，只以接口说话，不写文件路径）、**目的**、**测试**（怎样证明改动成立的文字说明；具体的测试文件列在「测试」列表里）；作者可追加节。正文里**任何一段文字**都可以被选中评论。
- **关联材料（materials）**：实施的证据——通常是一个 GitHub PR；也可以是 issue、分支、文档、任意 URL。材料带链接，正文不带。`pr` 材料若指向 GitHub 的 pull request，读提案时向 GitHub 问一次它的状态——草稿 / 待合并 / 已合并 / 已关闭——按 URL 缓存一分钟、失败即不显示，**不写进账本**；服务端存有 GitHub token 时带上它。
- **修订（revision）**：作者每 `publish` 一次，修订号加一；段落按内容对应，没变的段落保留其 id 与评论。
- **评论（comment）**：人对某一段文字写的一条话。锚点是该节 Markdown 源码（各段以空行相连）的一个**区间**——存偏移量 `[start, end)` 与所引文字 `quote`；每次修订按 `quote` 重新定位（先精确、再折叠空白），找不到的评论留在它最后所在的修订上（「第 N 修订的文字」）。给 Agent 看时**不给偏移量**：正文里被评论的文字包在 `⟦<id>⟧…⟦/<id>⟧` 里，评论按同一个 id 列在下面，`resolve` 也用它。评论先是**待发**的，人多次评论后点一次「请求整改」，待发的评论合成**一批**发给作者；作者逐条**解决**。待发的评论是写它的人自己的：可随时修改或撤回；发出（请求整改）之后固定，作者读到的就是最终文字。
- **事件（event）**：提案上发生的每件事的一条记录（创建、修订、就绪、请求整改、实施开始、材料、反馈、认可、合并、拒绝）。每个人对每份提案有一个已读位置，其后的事件即**未读**。
- **状态**：`drafting`（作者在写或在改）→ `ready`（作者说可以读了）→ `approved`（人认可并请求合并）→ `merged`（报告已合并：实施者或人凭自己的话，组织内其他员工凭 impl PR 在 GitHub 上已合入默认分支的事实）；任一时刻可 `rejected`。请求整改把 `ready` 退回 `drafting`。

### 人怎么用

侧栏公司模式的导航里多一行**提案**（Proposals），角标是全部提案的未读事件之和。提案有两页：**队列**是整宽的列表——每份一行（编号、标题即链接、状态胶囊、作者、未读数、最近更新），按未读优先、再按编号倒序，「新建提案」在页头。队列上方是一个 GitHub 式的搜索框：缺省 `is:open`（进行中：drafting / ready / approved），已合并与已拒绝的缺省不显示；语法为空白分隔的词——`is:<open|drafting|ready|approved|merged|rejected|closed>`（`status:` 同义）、`author:<id>`、`implementer:<id>`、`by:<发起者>`、`unread:yes|no`、`no:implementer`、`-` 否定、`"…"` 短语，其余是对编号与标题的自由文本；同一键之间为或、不同键之间为与。查询写在 `?q=`（等于缺省时省略），可链接、刷新不丢。框下是一排快捷胶囊：进行中 / 就绪 / 已认可 / 已合并 / 已拒绝 / 全部（替换 `is:` 词），以及单独的「有未读」开关，各带计数；点标题进入**提案页**——独立一页，不占侧栏：面包屑回队列、页头（标题、编号、状态、作者与实施者、发起者、修订号）、关联材料（一行一条：种类、标题即链接、PR 的状态胶囊、地址）、范围（一行一个文件，名称模式换行在其下）、正文、事件时间线，底部是动作条：**请求整改（N）**（N 是待发评论数）、**认可并请求合并**、**拒绝**。评论有两种落法：鼠标悬停在一段上，该段浅色高亮并在右缘出现「评论这一段」按钮，点击即以整段为所引文字（不必瞄准）；或在正文里选中一段文字，浮出「评论所选文字」。写下即记为待发；已有评论以标记盖在所引文字上（待发 attention 色、已发中性、已解决淡化），点标记在该节下展开评论。

正文里只有接口名，没有文件链接——读提案是读「改了什么、为什么」，不是读 diff；diff 在关联材料的 PR 里。

任何 Markdown 表面（频道消息、对话、提案正文）里的 `proposal:12` 都渲染为胶囊：`#12 <标题> · <未读数>`。可选的片段 `proposal:12#<模式>` 以正则匹配节标题与段落首行，第一个捕获组作胶囊文字，点击滚到匹配处。这是提案对外**唯一稳定的链接形态**。

### 员工怎么用

内容插件 `agent-company-proposals` 装着三段协议（三份 Skill），**不是三个岗位**：代码插件在创建时装到作者、在 `implement` 时装到实施者（已装则不动），没有人需要手装，也不为它招人。员工自己发起提案用 `penguin org proposal create --brief …`（作者缺省是自己；`--author <同事>` 才是交给别人）。

- **`proposal-author`**：收到委托（工位上的 `[proposal #<n>]` 一行，或人直接对话）→ 读手册与相关代码 → `penguin org proposal publish <n> --file <md>`（正文格式见下）→ `penguin org proposal implement <n>` 开自己的实施会话（`--agent <同事>` 才是交给同事）→ `ready` → 之后工位上的每一行（一批评论、一条反馈）都是一次修订：`comments --pending` 读一批、改稿、逐条 `resolve`、`publish`、再 `ready`（顺序不对服务端会拒绝 `ready`，见「状态机」）。规则：范围只写子集；测试列出相关的已有测试与拟增的测试，每条说明测什么；正文只写接口不写路径；三节尽量各一段。
- **`proposal-implementer`**（实施会话——作者自己的，或同事的）：`implement` 开出的实施会话以提案全文开始 → 在共享工作区的仓库里开 `proposal/<n>-<slug>` 分支 → 实施、开 PR（目标 dev 分支）→ `material <n> add pr=<url>` → 实施结果与提案不符处用 `feedback <n> -m` 说明 → 实施可用即合入 dev（不等人认可）→ 收到「认可」后合入主干、`merged <n>`。
- **`proposal-tester`**（谁有这条日程谁做）：按日程分批：以各提案的测试列表为本批的计划（拟增而 dev 上还没有的测试本身就是问题），拉 dev 分支、先跑计划里的测试、再跑其余测试与运行时检查 → 每个问题定位到提案：已 `merged` 的开修复工单（`penguin org ticket create … --notify` 作者，材料上挂 `ticket=<id>`）；未 `approved` 的发 `feedback <n> --runtime -m`，作者与实施者联合整改。

提案正文的文件形态（`publish --file`）：

```markdown
---
title: 工单通知按员工批量送达
root: penguin-harness
scope:
  - kind: edit
    file: packages/server/src/runtime/organization/reconcile.ts
    name: "notifyTicket|reconcileCalendar"
  - kind: new
    file: packages/server/src/runtime/organization/digest.ts
tests:
  - kind: existing
    group: unit
    file: packages/server/test/organization/reconcile.test.ts
    name: "^reconcile (fires|skips)"
    description: 日程巡检照旧触发与跳过
  - kind: new
    group: integration
    file: packages/server/test/organization/desk-digest.test.ts
    description: 阻塞的工单在下一次巡检时送达负责人，且只送一次
---

## 改动

`notifyTicket` 不再逐条向工位发消息，改为写入 `org_desk_notices`；`reconcileCalendar` 在日程触发前 `takeDeskNotices` 并把 `deskDigest` 附在正文末尾。

## 目的

工单的每次状态变化都唤醒工位，一天里同一员工被叫醒十几次，每次只做一件小事；批量送达让一次巡检处理全部变化。

## 测试

`reconcile.test.ts`「a blocked ticket reaches its owner at the next sweep, once」：阻塞一张工单，跑两次 reconcile，断言第一次日程正文含该行、第二次不含。
```

插件告知员工的每一件事——委托、请求整改、反馈、认可、拒绝——都以一行 `[proposal #<n>] …` 直接送到该员工的工位，不经任何频道、不以任何人的名义（见「驱动」）。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 交付形态

| 包 | 目录 | 形态 | 缺省 |
| --- | --- | --- | --- |
| `@prismshadow/penguin-plugin-company-proposals` | `plugins/company-proposals` | 代码插件（PRFC-0003）：一个模块，投稿路由组、页面、配置组 | 不在任何 Project 的 `[plugins]` 表里 |
| `@penguinharness/agent-company-proposals` | `plugins/agent-company-proposals` | 内容插件：`proposal-author` / `proposal-implementer` / `proposal-tester` 三份 Skill，`category: agent-company`，`preinstall: false` | 不装在任何 Agent 上 |

与 `claude-code` / `use-claude-code` 同一对偶：代码插件今天不能携带 Skill。装了代码插件而没装 Skill，页面与 API 都在、员工不知道协议；装了 Skill 而没装代码插件，CLI 得到 404 并说明「组织未启用提案插件」。

### 账本

一个组织一个账本：`<orgDir>/proposals.jsonl`，append-only 事件日志，启动或热更新后整份重放成内存态；服务端是唯一写者（同 `desks.toml` 的口径：事实文件，员工不编辑）。不建目录、不建表：账本是插件自己的东西，与工单的「一文件一工单」不同——正文的**来源**是公司的事（GitHub issue、`rfcs/` 里的一份 RFC），账本记的是**送进来的那份**。

每个人的已读位置存在 `server_settings`：键 `company-proposals:reads:<projectId>/<orgId>/<userId>`，值为 `{ [number]: lastSeq }`。

账本里的记录（每行一条，`seq` 递增）：

```ts
type LedgerLine =
  | { seq; at; kind: "created"; number; title; author; delegatedBy; brief }
  | { seq; at; kind: "revised"; number; revision; title; root?; scope; tests?; sections; by }  // root 缺省 ""；tests 缺省 []
  | { seq; at; kind: "status"; number; status; by; reason? }
  | { seq; at; kind: "implementation"; number; implementer; sessionId; by }
  | { seq; at; kind: "material"; number; material: { kind; label; url }; by }
  | { seq; at; kind: "feedback"; number; text; runtime: boolean; by }
  | { seq; at; kind: "comment"; number; id; sectionId; start; end; quote; revision; text; by }  // 待发
  | { seq; at; kind: "comment_edited"; number; commentId; text; by }      // 改写待发评论（不是事件）
  | { seq; at; kind: "comment_deleted"; number; commentId; by }            // 撤回待发评论（不是事件）
  | { seq; at; kind: "batch"; number; id; commentIds; revision?; by }       // 请求整改；revision 缺省按折叠到它时的当前修订
  | { seq; at; kind: "resolved"; number; commentId; text; by }
  | { seq; at; kind: "notify_failed"; number; text; by };                 // 工位没送到：原因
```

折叠出的 `Proposal`：`number`、`title`、`status`、`revision`、`author`、`implementer | null`、`delegatedBy`、`brief`、`root`、`scope: { kind; file; from?; name? }[]`、`tests: { kind; file; name?; group; description }[]`、`sections: { id; heading; paragraphs: { id; text }[] }[]`、`materials`、`sessions`、`comments: { id; sectionId; range: { start; end }; quote; paragraphId?; revision; text; by; at; batchId | null; resolved? }[]`（`paragraphId` 由 `start` 推得；折叠时每条 `revised` 行都按 `quote` 重新定位，第一版按段写下的评论锚到整段）、`events`（除 `comment` 外的每一行都是一条事件，待发评论对作者不可见）、`unread`（按调用者算）。读取时（`GET /:number` 与各写入的应答）另附 `base`（`root` 在服务端解析出的绝对目录）与每条范围的 `state`：`edit` 存在为 `exists`、否则 `missing`；`new` 存在为 `exists`、否则 `new`；`delete` 存在为 `exists`、否则 `deleted`；`rename` 目标存在为 `exists`、只有源存在为 `renamed`、都不在为 `missing`；每条测试也带 `state`：文件存在为 `exists`，否则 `existing` / `delete` 为 `missing`、`new` 为 `new`。状态每次读取现算，不入账本。

**旧账本。** 类型出现之前写下的账本，范围条目只有 `file` 与 `name`。插件加载账本时在内存里把这类条目读作 `kind: "edit"`，**不改写磁盘上的文件**；此后发布的修订都带明确的 kind 写入。测试出现之前写下的修订没有 `tests`，读作空列表，同样不改写文件。

**段落对应。** `publish` 把 Markdown 按标题分节、按空行分段（代码块与列表整块算一段）；每段的 id 取上一修订中**同文本**段落的 id，没有则新分配 `p<n>`。评论锚在段落 id 上；段落在新修订里消失，评论仍列在该节末尾并标「见第 N 修订」。

**校验。** `title` 非空；`root` 是共享工作区内的相对路径；`scope` 的 `file` 是相对路径、`name` 是合法正则，每条带类型，`rename` 必须带 `from`、其余类型不得带，同一文件不得重复；`tests` 每条的 `file` 是相对路径、`name` 是合法正则、`kind` 是 `existing` / `new` / `delete`、`group` 合乎 `[a-z0-9_-]{1,32}`、`description` 非空，否则 `400 tests_invalid`；`group` 不在已声明的分组里则 `400 tests_group_undeclared`，错误信息列出已声明的分组及其说明（账本里已有修订用到的未声明分组不改写，只在下一次发布时拒绝）；正文至少含「改动」「目的」「测试」三节（中英标题都认）；正文里出现指向文件的链接（`](` 后是路径或 `file:`）拒绝，`400 proposal_body_links_files`——正文只以接口说话。

**测试分组。** 分组是**插件配置**：插件以 `PluginConfigProvider.groups` 声明一个「公司提案」设置组，其 `testGroups` 是一个列表字段，每行 `id: 说明`（`id` 合乎 `[a-z0-9_-]{1,32}`，行格式由字段的 `pattern` 在保存时校验），行序即展示顺序；缺省为 `unit`、`integration`、`e2e`、`bench` 四行。管理员在「设置 → 插件」中编辑；它随平台插件配置对**整台服务器**生效，不分组织。插件每次使用时经 `PluginConfig.get` 读取，保存后下一次发布与读取即按新值，无需重启。`GET …/proposals/test-groups` 返回 `{ groups: { id; description }[] }`，读取提案时也以 `testGroups` 带回；CLI `penguin org proposal groups` 打印它们，作者写测试前先查。

**范围对照工作区。** 插件跑在持有组织的服务上，共享工作区是本地目录，`publish` 据此检查：`root` 不是目录，或 `edit` / `delete` 的文件、`rename` 的源在 `root` 下不存在，都拒绝该修订（`400 proposal_scope`），逐条列出缺失的路径并给出可能的路径——去掉一段 `legacy` 后存在的路径，或有界的广度优先搜索（跳过隐藏目录与依赖、构建目录，限深度与条目数）找到的同名文件，至多两条——并提示新建的文件写作 `kind: new`。`new` 的文件已存在、`rename` 的目标已存在不拒绝，随应答附 `hints`。测试同样对照：`existing` 或 `delete` 测试的文件在 `root` 下不存在即拒绝（`400 tests_missing`，同样给出可能的路径，并提示拟增的测试写作 `kind: new`）；`new` 测试的文件已存在不拒绝，附 `hints`（拟增的测试写进这个文件）。已合并的提案不再检查：它的文件早已变了。

### 状态机

```text
created ──publish──► drafting ──ready──► ready ──approve──► approved ──merged──► merged
                        ▲                  │  ▲                │
                        └───request changes┘  └────publish─────┘        任一状态 ──reject──► rejected
```

- `publish` 在 `ready` / `approved` / `merged` 之上也允许；只有 `rejected` 拒绝修订。**认可只覆盖一个修订**：`approved` 之上的 `publish` 把提案退回 `ready`（账本上是 `revised` 行之后紧跟一条带理由的 `status ready` 行），实施者不能拿旧认可去合并；`approvedRevision` 留着记认可落在哪个修订上，页面据此显示自认可以来的差异，人再认可一次即可。`approved` 行自带 `revision`；没有该字段的旧行按折叠到它时的当前修订解读。每个修订的全文都留在账本里，可按号读回。
- **作者的 `ready` 须先答复整改。** 自上次 `ready` 以来有过请求整改时，作者（员工）的 `ready` 只在两条都满足时才接受：已在最近一批之后发布过修订（`revision` 大于该批记下的修订），且这些批次里的评论全部 `resolve`；否则 `409 changes_pending`，信息列出未 resolve 的评论 id，并以 `penguin org proposal comments <n> --pending` 结尾。人标记 `ready` 不受此限。
- `approve` 只有人能做，且不必等作者标 `ready`（人读完 `drafting` 的稿子就认可，是人的自由）；`reject` 人能做；`merged` 实施者或人随时能报，组织内其他员工须以事实为据：提案登记的 impl PR（`penguin org proposal impl`）当场向 GitHub 读取（不走页面的缓存），已合入其仓库的默认分支才接受——没有 impl PR 为 `409 impl_pr_missing`，未合并、合进别的分支或读不到为 `409 impl_pr_not_merged`，并说明是哪一种；状态检查在身份之前（非 `approved` 一律 `409 proposal_status`）；`ready` 只有作者或人能做。
- 谁是谁：与工单路由同一套——请求来自会话时以 `sessionId` / `agentId` 归到员工，否则是登录用户（05「工单与工单会话」「操作人」）。

### 驱动：直接送到工位

插件**不使用任何频道**，也**不新增触发种类**（`OrgTriggerKind` 属于 core，公司模式的规则是不触及 core）。它向员工说话的方式只有一种：经网关的 `deliverToDesk` 往员工的**工位**送一行文字，作为工位的下一条用户输入（sender `server`，与日程触发同源），工位正忙则排在进行中的 Task 之后。这行文字**不以任何人的名义**发出：以 `[proposal #<n>] ` 开头，接着是发生了什么、谁做的、下一步要跑的命令。员工不会被告知它自己做的事（行事者就是收件人时跳过）。六处：

| 时机 | 送给 | 文字 |
| --- | --- | --- |
| 创建（作者不是发起者本人） | 作者 | `[proposal #<n>] <发起者> asks you to write it: <brief>` + `publish` / `ready` 命令 |
| 请求整改 | 作者 | `[proposal #<n>] <人> requested changes: a batch of <k> comments` + `comments <n> --pending` / `resolve` |
| 反馈 | 作者（运行时反馈另加实施者） | `[proposal #<n>] feedback from <谁>: …` / `runtime feedback from <谁>: …` |
| 认可 | 实施者（没有则作者） | 有实施者：`[proposal #<n>] approved by <人> — merge the PR and run penguin org proposal merged <n>`；没有：先给 `implement` 的命令，再说 impl PR（或如何登记）合入默认分支之后跑 `merged <n>` |
| 认可后修订 | 实施者 | `[proposal #<n>] revised after approval (revision M → N) — wait for a new approval before merging.` |
| 拒绝 | 作者与实施者 | `[proposal #<n>] rejected by <人>: <理由> — stop work on it, and close its PR if one is open.` |

`implement` 不另送一行：实施会话的首条输入已经把提案送到了实施者手里。组织暂停、员工（或其上级）的预算暂停时，网关拒绝送达并说明原因（`org_paused` / `employee_paused`）；没有工位时为 `desk_unavailable`。送不到不回滚账本的写入：它记成一条 `notify_failed` 行（成为事件），并以 `hints` 随这次写入的应答返回——页面以提示条显示，CLI 打印出来——同时仍记日志。

`implement` 开的**实施会话**与工单会话同构：以实施者的 Agent 新建 `client: "org"` 的会话（Workspace 缺省为共享工作区、可 `--workspace`），首条输入是前言 + 提案全文 + 附言，会话 id 记入账本的 `sessions`。这一步经服务端向插件开放的组织网关（见「平台改动」），不复制工单会话的代码。

### API

路由组 `company-proposals.routes`，前缀 `/api/projects/:projectId/organizations/:orgId/proposals`，`auth: user`，顺序在 `OrgRoutes.routes`（145）之前；公司模式总开关关闭时一律 404，与组织路由一致；读写权限是 Project 成员。

```text
GET    /                         列表（含每份的 unread）
POST   /                         { title?, brief, author? }           → 创建（作者缺省为发起的员工；人须点名）+ 告知作者的工位（作者非本人时）
GET    /:number                  详情（折叠态；待发评论只对委托人 / 评论者本人可见；含 approvedRevision）
PUT    /:number                  { markdown }                         → publish（修订；在 approved 之上退回 ready）
GET    /:number/revisions        各修订的 { revision, by, at }
GET    /:number/revisions/:rev   某修订发布时的标题、范围与各节（404 revision_not_found）
GET    /:number/file?path=       `base` 下的一个文件，只读：{ path, size, binary, truncated, content, extension }——绝对路径或含 `..` 400 bad_path，经符号链接等解析后出了 `base` 403 path_outside，不是普通文件 404 file_not_found；至多读 512 KB，前 8 KB 有 NUL 即二进制（content 为 null）
POST   /:number/ready | /approve | /reject { reason } | /merged
POST   /:number/implement        { agentId?, message?, workspace? }   → 实施会话（缺省作者自己的）
POST   /:number/materials        { kind, label?, url }
POST   /:number/feedback         { text, runtime? }
GET    /:number/comments[?pending=1]  评论（pending：已发未解决的），附 text：正文里被评论的文字包成 ⟦<id>⟧…⟦/<id>⟧、评论按 id 列出——给 Agent 读的形态
POST   /:number/comments         { sectionId, start, end, quote, text } → 待发（quote 须等于该区间的源码，否则 400 comment_range）
POST   /:number/comments/request                                      → 攒成一批 + 告知作者的工位
PATCH  /:number/comments/:id     { text }                             → 改写待发评论（只限写它的人）
DELETE /:number/comments/:id                                          → 撤回待发评论（只限写它的人）
POST   /:number/comments/:id/resolve { text? }
POST   /:number/read             { upTo: seq }
```

每次写入后向 Project 推送用户级事件 `{ type: "plugin", plugin: "company-proposals", data: { projectId, orgId, number, seq } }`；页面与侧栏角标据此刷新。

CLI：`penguin org proposal ls | show <n> | create --author <id> --brief <s> [--title] | publish <n> --file <md> | ready <n> | implement <n> --agent <id> [-m] [--workspace] | material <n> add <kind>=<url> [--label] | feedback <n> -m <s> [--runtime] | comments <n> [--pending] | resolve <n> <commentId> [-m] | merged <n> | approve <n> | reject <n> --reason <s> | groups`。`groups` 打印已声明的测试分组。`show` 在各节之后按分组（依声明顺序，未声明的分组标出）打印测试：`<kind> <file> [<name>] — <description> (<state>)`。与 `penguin org ticket` 同一薄客户端契约：API 错误原样透出，身份来自会话控制环境。它落在平台 CLI（见 Unresolved）。

### 页面

由代码插件投稿 `WebModule.pages`：`{ key: "org-proposals", path: "proposals/:number?", nav: "org", renderer: { builtin: "OrgProposalsPage" } }`。渲染器随 Web 构建携带（平台规则：契约只传数据，不传代码）——插件不在时投稿不存在，路由与导航行都不出现。

- 两页一条路由（`proposals/:number?`）：不带编号是队列——整宽列表，一行一份（`#n`、标题即链接、状态胶囊、作者、未读数、最近更新；未读优先、再按编号倒序）；带编号是提案页，独立一页，没有侧栏队列。
- 提案页：面包屑、页头、认可后又有修订时页头下**只有一行**（「自认可的第 M 修订以来已修订（→ 第 N 修订）」、谁在何时认可、「改动 | 最新」二选一，缺省「改动」；这一行从不列出改动，手机上至多折成两行），「改动」时**一切改动都就地标出**：标题在页头里标出增删的词；范围与测试的每一行——新增的 success 底色加左缘细条，删去的以 danger 色划线、留在原来的位置（在它最近的存留前驱之后）、不是链接，改过的（范围的类型 / `from` / 名称模式，测试的类型 / 分组 / 说明）把旧值划线、新值着色并排；委托（brief）不属于修订，不标。正文：各节按标题对齐，节内按段落做最长公共子序列——未改的段照常渲染（评论标记与悬停评论不变）；新增的段 success 底色加左缘细条；删去的段以纯文本划线、danger 色，不可评论；一删一增且词重合度 ≥ 0.5 的一对合成一段，就地标出增删的词（CJK 按字切分）；整节新增的标「新增」，整节删去的划线标「已删去」，留在它原来的位置。「最新」即是当前提案的原样，不带任何标记。材料列表（一行一条：种类图标与字样、标题即链接、`pr` 的状态胶囊——草稿灰、待合并 brand、已合并 success、已关闭 danger——与灰色地址）、范围列表（列表上方一行写根目录；一行一个文件，前面是类型标签（`rename` 写作「源 → 新路径」），后面是状态标签，名称模式以等宽、可换行的第二行写在其下——过长的模式不再把表格挤成一列；只有状态为 `exists` 的文件是链接：点击在提案**右侧的文件面板**里只读打开它，页面不跳转——宽屏时与提案并排（约占 45%、不窄于 360 px，中间一条可拖动的分隔），窄屏时是覆盖整页的面板；文件由插件从组织所在的服务器读出（`GET …/:number/file`，限于 `base` 之内），带行号与语法高亮，行有名称模式时标出匹配的行与首个捕获组、滚到第一处，没有匹配则在代码上方说一行；打开的文件写在 `?file=`（及 `name=`）里，刷新不丢，后退即关闭，Esc 也关闭；`missing` 的行以悬停提示说明它在根目录下不存在；不在浏览器里打开文件）、正文（各段按 Markdown 渲染；评论作为 `<mark>` 盖在所引文字上——渲染后按 `quote` 在该节的文本节点里找到并包起来，待发 attention 色、已发中性、已解决淡化；点标记在该节下展开评论）、每段悬停时浅色高亮并在右缘出现「评论这一段」（整段即所引文字，区间就是该段在节源码里的跨度）、选中一段文字出现「评论所选文字」浮标——所选文字先在该节源码的「纯文本投影」（去掉反引号、强调、标题与列表标记、链接目标）里匹配得到源码区间，再退到直接匹配源码，再退到所在段整段——写下即 `POST comments`；旧修订上的评论列在正文之后。测试列表（正文之后、事件时间线之前）：按分组，依声明的顺序，每组小标题下一行灰字写该组的说明；修订里用到、但已不再声明的分组按字母序放在最后，归在「未声明的分组」小标题下，附一行说明下次发布须移走；每组一个带计数的小标题，可折叠，缺省展开，超过 12 行的组先显示前 12 行并给出「再显示 N 条」；每行是类型标签（`existing` 中性、`new` success、`delete` danger）、文件（与范围同一种链接，只有存在时可点；`existing` / `delete` 而文件缺失标 danger）、名称模式（等宽、灰色、可换行）、说明。事件时间线（相对时间、主体显示名、一句话）、动作条（底部粘住）。
- 交互沿用 06「公司模式原型」：页内不切页；标题即链接；状态用文字胶囊不用圆点；「认可」「拒绝」走统一确认框。
- 阅读即已读：详情打开后把已读位置推到当前最大 `seq`（`POST …/read`），侧栏角标同步减少。
- 胶囊：一个 remark 通道把文本节点里的 `proposal:<n>[#<模式>]`（裸写或 `[…](proposal:…)`）切成 `<data value="proposal:12#…">` 节点，与频道的 @ 胶囊同一手法；组件从公司态里的提案索引取标题与未读数，索引在页面投稿存在时按组织懒加载；插件不在时该节点按原文显示。共享的 `MdLink` 不动。

### 平台改动（实现 PR 里属于平台的部分）

1. `WebShellSlots.pages.nav` 增加 `"org"`：路径相对 `/org/:projectId/:orgId/`，挂在 `OrgLayout` 之下，导航行接在六个内置入口之后；标签与图标随内置渲染器登记（`OrgProposalsPage` 登记 `S.nav.org.proposals` 与其图标）。
2. 服务端向插件开放一个组织网关 `OrgGateway`（`mechanisms/organization.ts`，由 `OrganizationModule` 提供、`CompanyModule` 导出，类型经 `@prismshadow/penguin-server/plugin` 导出）：`companyModeEnabled()`、`organization(projectId, orgId)`（`OrgView`：名称、状态、语言、共享工作区、员工（id、显示名、头衔、上级）、Project 的人）、`principalOf(projectId, orgId, actor)`（同工单路由的操作人判定）、`deliverToDesk(projectId, orgId, agentId, text)`（确保工位后以 `server` 身份发起一个 Task，忙则排队，返回 `{ sessionId, queued }`；组织或员工暂停时拒绝）、`openEmployeeSession(...)`（工单会话的那一套减去工单：新建 `client: "org"` 会话、设标题、发起首个 Task）、`notifyProject(event)`。除 `deliverToDesk` 复用工位的既有送达路径（`ensureDesk` + `startTask(..., { queueIfBusy: true })`）外，这些只是把 `OrganizationService` 已有的方法收成一个接口。
3. `ServerEvent` 增加通用的 `{ type: "plugin"; plugin: string; data: unknown }`，插件用它推送用户级事件；Web 按 `plugin` 分发。
4. CLI 增加 `penguin org proposal …`。

### 测试

- 插件单元测试：账本重放、段落对应（同文本保 id）、状态机的每条边与拒绝、校验（三节、文件链接）、待发评论对作者不可见、未读计数。
- `packages/plugin-test` 端到端：真实 server 装上插件——创建提案后作者的工位收到一行 `[proposal #1]`、组织里没有提案频道、`publish` 两次后段落 id 稳定、`implement` 开出一个 `client: "org"` 的会话、`GET /api/contributions` 含页面投稿。
- Web：胶囊的 remark 通道（裸写、链接形、代码块内不动）、队列排序、`nav: "org"` 的路由挂载。
- CLI：子命令的参数与错误透出。

### 已落地（实现 PR）

服务端的四项平台改动、代码插件 `plugins/company-proposals`（账本、文档解析、状态机、路由、页面投稿；单元与端到端测试）、Web 的提案页 / 胶囊 / 公司导航里的投稿页 / 公司态里的插件事件、`penguin org proposal`、内容插件 `plugins/agent-company-proposals` 的三份 Skill、文档与 changelog。与本文的出入已回写到上文：`publish` 只在 `rejected` 上拒绝；`approve` 不要求先 `ready`；`implement` 不发消息。用户试用后的三条修正也已回写：员工可以自己发起提案（原稿只允许人委托，实测 403）；不设岗位——作者缺省自己实施，内容插件自动安装；认可、拒绝、评论仍只属于人。页面的两条调整也已回写：评论按所选文字的 Markdown 区间存储、给 Agent 时只给 `⟦<id>⟧` 标记；提案是独立一页而不是侧栏式的两栏。在真实组织上发现的三处问题也已回写：范围带根目录与四种类型、发布时对照工作区检查（原稿的范围路径多数跳转不到）；作者须答复整改才能再标 `ready`；归档的提案频道使每条通知静默失败，送不到的消息现记为 `notify_failed` 事件。其后用户不要提案频道——它以人的名义发消息、归档后又被重新打开——插件改为直接往工位送 `[proposal #<n>]` 一行，不再使用任何频道（网关的 `ensureChannel` / `sendChannelMessage` 随之删去，换成 `deliverToDesk`）。

## Drawbacks
[drawbacks]: #drawbacks

- 又一套「人审阅 Agent 产出」的对象，与工单的 `review` 列部分重叠。区别在粒度：工单审的是结果，提案审的是改法；但两者并存要在手册里讲清楚何时用哪个。
- 账本是插件私有格式，不像工单可以用文件工具读改；员工只能经 CLI。
- 员工之间就提案的往来只经 `feedback`，没有可读的对话记录；人从事件时间线看到反馈，看不到员工之间的讨论。
- CLI 子命令住在平台里，插件不装时它是一个只会 404 的入口。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **账本在插件手里、来源在公司手里。** 用户明确不要「一个 proposals 文件夹」：提案的家可以是 issue 也可以是 RFC 文件；插件要的只是把它渲染成可评论、可计未读的东西。账本因此只记「送进来的那份」，来源以材料链接挂在旁边。备选是直接以 GitHub issue 为真相（评论走 issue）——把功能押在 GitHub API 与 token 上，离线与私有仓库都不成立；或以 `rfcs/` 文件为真相——评论与未读仍需自己的存储，等于账本外再加一层解析。
- **直接送到工位，不用频道，也不加触发种类。** 频道消息总有一个发言者：以人的名义发，人会看到「自己」在频道里说话（用户明确不要）；以员工的名义发，又要求员工在频道里、频道开着。工位送达没有发言者，只是工位的下一条输入，与日程触发同一条路。加一种触发种类要动 core 的 `OrgTriggerKind`，而一行带前缀的纯文字已足够让员工知道该做什么。
- **正文不带文件链接。** 提案是给人读的抽象层；路径一进来读者就去翻 diff，抽象层立刻失效。范围表承担「碰哪些文件」的事实，正文只讲接口。
- **评论攒批。** 逐条评论逐条唤醒作者，一次审阅变成十次修订；一批一次修订，作者也能在整体上做取舍。
- **实施先并入 dev。** 人读得慢不该拖住实施接受测试；dev 分支的健康由测试团队分批维护，问题按提案是否已合并分流成修复工单或整改。
- **渲染器在 Web 构建里。** 平台的契约是投稿只传数据；页面要的胶囊、侧栏角标、公司态都在 Web 里，iframe 做不到。插件在时页面出现、不在时消失，仍成立。
- **`merged` 凭事实开放，不自动转换。** 身份检查（「实施者或人」）让没有实施者的提案——例如先有 PR、后补提案的那一批——只能等人记得去点；而「PR 已合入默认分支」是 GitHub 能证实的事实，拿它替换身份，员工就能在合并后自己报。备选是插件在读 PR 状态时见到已合并就自动写 `merged`：那是一次由读触发的写，要么以谁的名义落账说不清，要么每次打开页面都可能改账本；本设计先给员工一条可走的路，自动化留待需要时再加。
- 什么都不做：继续用频道消息当提案，没有编号、没有修订、没有选段评论、没有未读。

## Prior art
[prior-art]: #prior-art

- GitHub PR review：逐行评论、「Start a review」攒批、「Request changes」一次发出——本提案把锚点从行换成段落，把对象从 diff 换成改法说明。
- Rust RFC：一个编号、一份文档、实施 PR 挂在旁边、正文讲动机与设计不讲 diff；本仓库的 PRFC 本身即此形态。
- 本仓库：工单的 `history` 事实日志与 `org_desk_notices` 队列（记录而不唤醒）、频道消息的 jsonl 与已读游标、频道 @ 胶囊的 remark 通道、`pages` 投稿与内置渲染器登记。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **CLI 的归属。** 插件今天没有向 CLI 投稿的机制；`penguin org proposal` 只能住在平台 CLI 里。是接受这一点，还是先做一个通用的 `penguin api <method> <path>` 让 Skill 直接调 API？本文取前者，因为 Skill 里的命令要好读。
- **提案页放在导航还是侧栏列表。** 本文放导航（第七个入口）。队列已在页内，侧栏只需角标。
- **实施会话的 Workspace。** 缺省共享工作区根；多个提案并行时各自的分支在同一检出里互相踩。是否每个提案一个 worktree（`workspace/proposals/<n>/`），交给 `proposal-implementer` Skill 的规则而非服务端。
- **specs 的落地。** `02-TAXONOMY`（提案词条）、`05-ARCHITECTURE`（公司模式一节的机制）与 `06-PROTOTYPE`（提案页）留给实现合并后的 specs PR，同 PRFC-0014 的做法。

## Future possibilities
[future-possibilities]: #future-possibilities

- 来源适配：让账本从 GitHub issue / `rfcs/` 文件**双向**同步，评论回写到 issue。
- 员工之间就一份提案的讨论记录（按提案的线程），让人也能读到。
- 提案模板由手册定义（节的名称与数目）。
- 与工单的联动：一份提案自动带一张父工单，修复工单挂在其下，财务按提案上卷成本。
- 人的评论也可以来自消息渠道（飞书 / Telegram）。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。
