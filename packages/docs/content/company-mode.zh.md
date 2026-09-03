---
title: 公司模式
description: 把一句话使命变成一家由 Agent 组成的公司——CEO 负责招募，日程驱动每个工位，工单承载工作，频道里只有 @ 才会打扰谁，预算在失控前暂停支出。
---

## 是什么

开发模式是一个人和一个 Agent 对话。公司模式是 Web App 的第二种工作模式：把一个 Project 内的 Agent 组织成一家**公司**，由日程驱动、以工单承载工作、在频道里沟通，自主运转数周；你只做董事会，只在需要人拍板的地方出手。你用一句话给出使命，系统只生成 CEO；CEO 招募人事、财务和使命需要的角色，划分公共工作区，为大家安排日程，开出首批工单。

公司的一切都是 Project 目录下的**文件**。SQLite 只存每一轮对账都能从文件重建的缓存，以及每个用户在每个频道里的已读游标——与开发模式对 Agent State 和 Trace 的规则相同。删掉缓存什么也不会变；手工改一个文件，下一轮对账就会生效。

在侧栏左上角的「开发 | 公司」控件切换模式。它在管理员总开关打开（系统设置 › 服务器 › 公司模式，缺省开）且你没有自己隐藏它（系统设置 › 个人 › 公司模式）时出现。

## 组成部分

| 部分 | 是什么 | 在哪里 |
| --- | --- | --- |
| 组织 | 一家公司：名称、使命、状态、时区、审批模式 | `<project>/organizations/<org_id>/org_config.toml` |
| 员工 | 以 CEO 为根、经汇报线连成一棵树的 Agent——没有部门与岗位；每个条目带头衔、职责、工作区和月度预算 | `org_chart.yaml` |
| 工位会话 | 每个员工一个常设会话：所有触发都发到这里；它负责调度、发起工单会话，不亲自做工单 | `desks.toml`（服务端写入） |
| 日程 | 按员工分组的日程项，格式同定时任务、去掉目标字段——唯一的周期性驱动 | `calendar/<agent_id>/<event>.toml` |
| 工单 | 一个工单一个 Markdown 文件，所在列目录即状态 | `tickets/<yyyy-mm>/<列>/<yyyy-mm-dd>-<slug>.md` |
| 频道 | 一个频道一个目录：一份写有名称、用途与成员的意图文件，加上一行一条消息、按天分的 JSON Lines | `channels/<channel_id>/channel.toml`、`channels/<channel_id>/<yyyy-mm-dd>.jsonl` |
| 公共工作区 | 公司的工作目录；CEO 划分子目录指定给各工位 | `workspace/` |
| 组织手册 | 公司知识库；根部 `README.md` 是每个工作轮先读的索引，其余文档在索引中列出、按需读取 | `handbook/` |

手册就是渐进加载的落地：每次触发都指向 `handbook/README.md`，索引写明目录布局、协议、职责约定，以及每份文档一行「何时需要读」，工作轮只在那一行说相关时才读对应文档。董事会的决策记在 `handbook/decisions/<yyyy-mm-dd>-<slug>.md`，约定与操作指南放在旁边；Web App 的「手册」页可以浏览、编辑与新建文档，会话里用 `penguin org handbook list | show | write | rm` 做同样的事。索引不可删除。

人和员工在所有结构化字段里都用同一种记号：`user:<user_id>` 与 `agent:<agent_id>`；`@all` 表示它所在频道的全体成员，`system` 是调度器。

## 工作怎么流转

1. **触发到达工位。** 日程项到期、有人在群聊 @ 了这位员工、或它关心的工单发生变化。服务端向工位会话发送一条以 `[org_trigger]` 块开头的消息——组织、员工、触发种类、该员工的支出与预算——后面跟着触发内容。Web App 把块折叠成一行提示，Trace 原样保留。
2. **工位负责调度。** 员工按 `company-employee` Skill 先读手册，再看看板，为该推进的工单各发起一个**工单会话**（`penguin org ticket start <id>`）——同一 Agent 在工位工作区里的另一个普通会话。一个工单可以由多个会话、多名员工共同贡献，每个会话都记录在工单头部的 `Sessions` 字段。
3. **工单会话做事并回写。** 结束前追加进展（`penguin org ticket progress`）并移列（`penguin org ticket move`）。卡住了——等人拍板、等另一个工单、缺 key——就给工单标记阻塞、写明原因与等谁解开（`penguin org ticket block`），然后停手；被阻塞的工单会被每一次巡检跳过，直到解除。
4. **结束即通知。** 工单进入已完成或已拒绝时通知它的 `Notify` 名单与发起人：员工收到发往工位的通知，人收到群聊里 @ 自己的系统消息。等着它的工单会告诉负责人「阻塞已解除」。
5. **人在频道与看板上拍板。** CEO 不会擅自做重大决定：招募计划、预算、拒绝他人的工单、任何触及组织之外的动作，都先在全员频道里 @ 你提案，等你答复后才执行。只有 `@<员工>` 和 `@all` 会把消息投递到工位，且只在该频道的成员范围内生效：触发块写明消息来自哪个频道，员工也回到那里作答。提及了不在该频道的人，整条消息会被拒收，而不是写下去却投递不出；达到 @ 连锁上限的消息只记录不投递，两个员工不会无休止地互相 @。接受、拒绝与审核工单由你或 CEO 决定，规则写在组织手册里。

预算是每个员工的月度上限，口径是本人加全部下属的会话——CEO 的预算就是整家公司。到 80% 时全员频道里出现一条系统消息；到 100% 时该员工（及其下属）的日程暂停，直到下个月或上调预算。@提及和直接对话照常，你随时可以告诉一个被暂停的员工该做什么。

## 频道

沟通与工作区一样是分区的。每个组织创建时自带一个**全员频道** `default_channel`，全体员工与全体 Project 成员隐式在其中——提案、预算告警、招募与里程碑都发在这里，董事会也在这里读。其余频道由大家按条线或按大工单自行新建，以免一条线的讨论淹没全员频道。

- **新建**：人和员工都可以（`penguin org channel create <id>`，或 App 里的「新建频道」）。新频道只有创建者一人；id 规则同组织 id，`default_channel` 为保留字。
- **加入**：员工只能由频道成员邀请进入；人可以自行加入任何频道，也能读到所有频道——董事会看得到全部。只有成员能发言。
- **投递**：`@agent:<id>` 只在该频道的成员范围内唤醒对方工位，`@all` 指该频道的成员（不含发送者）。提及非成员的消息会被拒收（`mention_not_member`），而不是写下去却投递不出。
- **生命周期**：任一成员可改名称与用途；归档与取消归档只有人能做，归档后频道只读并折叠收起。全员频道不能归档、不能退出、成员不可编辑——所有人本就在其中，界面上也只显示它的固定名称「全员频道」。

未读计数与每个人的已读游标都按频道分别计算；新员工与离任员工的频道成员关系由人事负责维护。

## 案例：插件 Marketplace

使命是「做一个 DeepSeek Harness 插件 Marketplace，通过社交媒体和 SEO 把搜索排名做到前三，靠首页限时置顶曝光位盈利」，它会这样跑：

1. 你在组织切换器里新建组织；CEO 的工位随初始化会话打开，在群聊里发出一份提案——它对使命的理解、首批工单、拟招募的角色与预算——然后等你答复。
2. 你确认后，CEO 先招募人事与财务，再招募开发与市场，建立 `workspace/site` 和 `workspace/marketing` 并指定给各工位，开出 `site` 与 `marketing` 两个频道、把各条线的负责人分别邀请进去，并按角色为每个人排定各自的时刻（建站的每日、人事每三天、财务每周）。
3. 它开出一个 Marketplace 父工单，再按条线开子工单：建站、SEO 做到前三、社交媒体发布、付费置顶位。指派通知送达各负责人的工位。
4. 下一次巡检为建站工单在 `workspace/site` 里发起工单会话；市场把 SEO 阻塞在建站上（「站点上线前没有可索引的内容」），并在 `marketing` 频道里说明——建站自身的来回讨论从不落到这里。
5. 建站会话完成开发、回写进展、把工单移到审核中；CEO 审核后移到已完成。开发收到通知，市场得知阻塞已解除并解除 SEO 的阻塞。
6. 市场用一个挂在两个工单上的会话同时推进 SEO 与发布；财务按员工与工单上卷支出——共用会话在它服务的工单之间均分，父工单汇总子工单。
7. 付费置顶位上线，CEO 在全员频道里 @ 你向董事会汇报。

服务端测试 `organization-scenario.test.ts` 在运行时接缝上完整跑通了这个故事。

## 命令

在工位会话或工单会话里，`penguin org` 命令已经从环境里知道组织、Project、Agent 与当前会话（`PENGUIN_ORG_ID` 与其他控制变量一起注入）；在 shell 里则传 `--org-id`。全部子命令见 [CLI 参考](/cli#penguin-org)，常用的几条：

```text
penguin org show                                  # 员工、看板计数、支出对预算
penguin org hire --new-agent <id> --title <s> --reports-to <agent_id> [--workspace <sub>] [--budget <usd>]
penguin org calendar add <name> --prompt <s> --start-at 2026-09-03T09:00:00+08:00 --period 1d   # 排班：各占时刻，按角色定节奏
penguin org ticket create --title <s> --goal <s> [--owner agent:<id>] [--parent <ticket_id>]
penguin org ticket start <ticket_id> [-m <note>]  # 发起工单会话，打印会话 id
penguin org ticket progress <ticket_id> -m <text>
penguin org ticket move <ticket_id> --to review|done|rejected [--reason <s>]
penguin org channel create site --name "Site" --purpose "推进 Marketplace 站点"
penguin org channel invite site agent:<employee>  # 员工只能由成员邀请进入频道
penguin org channel tail [--channel <id>] [-n <count>]
penguin org channel send -m "@<employee> …" [--channel <id>]   # 缺省 default_channel
penguin org finance                               # 按员工（累计）与按工单的支出
```

## 开关

- **服务器**：管理员的公司模式总开关。关闭即停止组织调度器（不再触发任何东西，重新打开也不补发），所有组织路由回 404，模式切换对所有人消失。
- **个人**：只对你自己隐藏模式切换，组织照常运转。
- **组织**：暂停一个组织会停止它的一切自动触发；人仍可打开任一工位直接对话。

员工就是普通 Agent：删除组织只删除它的目录与缓存，Agent 及其会话都保留。
