# 公司模式：由日程、工单看板与频道驱动的 Agent 组织

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `core`, `skills`, `docs`
- **PR:** [#587](https://github.com/Prism-Shadow/penguin-harness/pull/587)

[English](2026-09-02-company-mode.md)

Web App 新增第二种工作模式。公司模式下，一个 Project 的 Agent 组成一个**组织**：以 CEO 为根的汇报树，每位员工一个常设的**工位会话**，作为唯一周期性驱动的**日程**，承载工作的五列**工单看板**，只有 `@` 才会打扰到人的**频道**，以及按员工设定、80% 告警、100% 暂停该员工日程的月度**预算**。创建组织只需一句话使命，且只生成 CEO；CEO 在工位上的初始化会话里招募人事、财务与其余角色，划分公共工作区，为大家安排日程，开出首批工单。

组织的每一部分都是 `<project>/organizations/<org_id>/` 下的文件：`org_config.toml`、`org_chart.yaml`（员工树，含各员工的预算、工作区与 Model）、`desks.toml`（服务端写入的工位台账）、`calendar/<agent_id>/<event>.toml`（去掉目标字段的定时任务格式）、`tickets/<yyyy-mm>/<列>/<yyyy-mm-dd>-<slug>.md`（取法 Agent Notes 的头部——Status、Initiator、Owner、Parent、Notify、Priority、Due、Blocked、Blocked-by、Sessions——以及 Goal、Acceptance criteria、Progress、Result 四节）、`channels/<channel_id>/`（一个频道一个目录：写有名称、用途与成员的 `channel.toml` 意图文件，以及按天分文件的 `<yyyy-mm-dd>.jsonl` 消息）与组织手册目录 `handbook/`（公司知识库，根部 `README.md` 是每轮触发先读的索引，其余文档在索引中列出、按需读取）。SQLite 只保存每轮对账都从这些文件重建的缓存（工位与工单会话的归属、日程运行状态、上次已通知的工单状态、各频道的扫描游标、预算标记）以及每个用户在各频道的已读游标。

## 细节

- 服务端：与定时任务调度器同构的组织调度器每 30 秒、以及每次 API 写入后立即对账每个组织——把台账与工单投影到缓存，为工作区被重新划分的员工换工位，把到期的日程项发往工位（工位忙则排队，组织或员工暂停时搁置，绝不补发），对工单变化只通知一次（指派、阻塞、阻塞解除、完成、拒绝——员工收到发往工位的通知，人收到全员频道里的系统消息），按组织的连锁上限投递频道内的 @ 提及，并重算预算。每次触发都是一条以 `[org_trigger]` 块开头的用户输入；工单会话是员工 Agent 的普通会话，会话 id 追加到工单头部的 `Sessions` 字段。支出按会话归属：员工成本 = 本人会话加全部下属，工单成本 = 其贡献会话在所服务工单之间均分后的份额，沿 `Parent` 上卷。
- API：`/api/projects/:projectId/organizations` 及其子路由——员工树、员工、工位、手册、日程、工单（移列、阻塞、解除、进展、发起、挂接）、频道（成员、消息与已读游标）、财务与组织会话列表；用户级事件 `org_run`、`org_channel`、`org_ticket`、`org_budget`。Project 成员可读写，仅 owner 可删除。迁移 5 新增七张组织表。
- 开关：管理员总开关（服务器设置的 `companyMode`，缺省开；关闭即停止调度器、组织路由回 404、隐藏模式切换，并由 `GET /api/me` 报告）、`ui_prefs` 里的个人开关，以及组织自己的 `status: paused`。
- 控制环境：工位与工单会话的命令子进程额外获得 `PENGUIN_ORG_ID`，在会话内 `penguin org` 不必再传 `--org-id`。
- Core：标记清单新增 `[org_trigger]`（与 `[scheduled_task]` 同属标题噪声），并提供 `buildOrgTriggerMessage` / `parseOrgTriggerMessage`。
- CLI：`penguin org` 命令族——`ls`、`create`、`show`、`chart`、`hire`、`employee set`、`leave`、`desk show|renew`、`calendar ls|add|update|rm`、`ticket ls|show|create|move|assign|block|unblock|progress|start|attach`、`channel ls|create|show|invite|join|leave|remove|archive|unarchive|tail|send`（`--channel` 缺省 `default_channel`）、`handbook list|show|write|rm`、`finance`——作为 API 的瘦客户端，处处支持 `--json`。
- Web：Project 切换器上方的「开发 | 公司」模式切换、带新建与设置的组织切换器、六个导航页面（概览、组织图、日历、工单、财务、手册——以文件列表加渲染正文呈现知识库，支持就地编辑、新建与删除）以及频道视图；开发模式列出会话的位置，公司模式列出「频道」（全员频道置顶、我的频道、其他频道带「加入」、已归档折叠），另有对话中的 `[org_trigger]` 横幅与设置页上的两个开关。频道列表之下是组织自身的两个分组：「工位」按组织图顺序一位员工一行，默认展开，点击打开该员工的工位会话——没有就现开一个；「工单会话」默认折叠，把挂在工单上的会话按最近活动排在前面，工单标题作为副标题。收起后的窄栏把工位画成头像，运行中的带一个圆点。工位会话与工单会话就是**普通对话**——消息列表、工具卡片、审批与输入区都与开发模式相同——外面套公司模式的侧栏，并在分组里标出当前那一行；公司模式没有自己的对话视图。这类对话打开时，侧栏显示的组织仍是当前组织，频道与工位不会在 `/chat/:sessionId` 上变空。新建组织对话框会把填过的内容按用户与 Project 存成 `localStorage` 草稿：误关、刷新或切换模式后重开即恢复，创建成功或点「清空草稿」后清除；对话框里还多了 CEO 预算字段。频道里，@到自己的消息只由提及标记标出（整行底色去掉），跳数标记从第 2 跳起才显示（第 1 跳是员工回应一次触发，说明不了什么），输入框与「发送」按钮等高同排、底边对齐，输入框变高时按钮仍贴着底边。
- 创建选项：新建组织时可指定 **Model**（已配置的成对引用，员工条目未指定时工位与工单会话都用它）与**公司工作区**（一个已存在的绝对目录，替代组织目录内的 `workspace/` 作为公共工作区）；二者都是 `org_config.toml` 的字段，可在组织设置里修改，也可经 `penguin org create --workspace … --model-id … --provider …` 指定。
- 决策关口：CEO 只提案、董事会拍板——初始化会话先发一份完整提案（使命理解、首批工单、招募角色及预算与 Model、工作区划分）并结束本轮；招募、预算、拒绝他人的工单、跳过审核关闭 P0/P1 工单、任何触及组织之外的动作以及结构变更都要等创建者在全员频道里确认。员工把这类事项上报给 CEO。写进 `company-ceo` / `company-employee` Skill、初始化会话与组织手册。
- 组织手册是一个目录 `handbook/`，也是公司知识库：根部 `README.md` 是每次触发都指向的索引（目录布局、协议、职责约定，以及一份文档清单——每份一行，写明何时需要读）；董事会决策、约定与操作指南以 Markdown 文档放在旁边、按需读取。API 可列出、读写与删除文档，会话里用 `penguin org handbook list | show | write | rm` 做同样的事，Web App 的「手册」页可浏览、编辑与新建；索引不可删除。
- 排班规则：CEO / 人事 Skill、初始化会话与组织手册把日程当作排班表——按角色定节奏（CEO 每日、人事每三天、财务每周）、每位员工各占一个时刻、每人只有一条常设日程项、绝不 `--start-at now`。
- 插件：新增独立分类（Agent Company / Agent 公司）下的 `agent-company` 插件（`preinstall: false`），携带 `company-employee`、`company-ceo`、`company-hr`、`company-finance` 四个 Skill；CEO 与每位招募的 Agent 都会连同 `agent-development` 一起安装它。
- 频道：组织的沟通是一组频道，每个频道是 `channels/` 下的一个目录，带一份 `channel.toml` 意图文件。`default_channel` 是随组织创建的全员频道，全体员工与全体 Project 成员隐式在其中，预算告警、发给人的工单通知与招募通知都落在这里。人和员工都可以再开频道；新频道只有创建者一人，员工只能由成员邀请进入，人可以自行加入任何频道并读到全部频道。投递遵循成员关系：`@agent:<id>` 只在频道成员范围内唤醒工位，`@all` 指该频道成员（不含发送者），提及非成员的消息在写入前即以 `mention_not_member` 拒收。`kind: mention` 的 `[org_trigger]` 块带一行 `channel:`，员工因此回到被 @ 的那个频道作答。归档（仅限人）使频道只读；全员频道不能归档、不能退出、成员不可编辑。扫描游标与每个人的已读游标都按频道计算——迁移 6 把两张表重建为 `org_channel_state` 与 `org_channel_reads`。CLI 侧是 `penguin org channel` 命令族；Web App 的公司模式以频道为主列表，工位会话与工单会话在其下各成一组。
- CEO 预算：创建时把 CEO 的月预算写进 `org_chart.yaml`——不另行指定即为 100 美元（创建请求的 `ceoBudget`、`penguin org create` 的 `--ceo-budget`、创建对话框里的 CEO 预算字段）。预算按累计线比较，所以这一个数字从第一分钟起就是整家公司的上限，而不是任其无限；初始化会话的触发块会带上它，CEO 据此裁剪自己的招募方案。之后在组织图上随时可调高、调低或清除。
- 引导式创建：`company-setup`——`agent-development` 插件下的一个 Skill，而 `default_agent` 本就装有该插件，于是「让通用 Agent 帮我开一家公司」成为一条创建路径。它用用户的语言一次只问一个问题，依次收集 id、名称、使命、公共工作区、Model 与 CEO 预算，给出一屏摘要，等到明确的确认后执行 `penguin org create`，再把用户交接给公司模式。它自己从不招募、不排日程、不开工单——那是 CEO 在董事会答复提案之后的事。
- 组织的会话不进开发模式：会话 DTO 新增 `orgId`——工位会话，或参与该组织某个工单的会话，所属的组织，取自组织缓存（每次列表一次查询，而不是每行一次），会话列表与 `GET /api/sessions/:sessionId` 都带上它。开发模式的会话列表与时间分组一律隐藏带有该字段的会话，原先收纳它们的「组织」子夹随之删除——公司模式的「工位」「工单会话」分组才是它们的去处。隐藏以该用户能用公司模式为前提（管理员总开关与用户自己的开关）：`orgId` 无论开关如何都会写上，公司模式关闭时没有别的地方列出这些会话。分组标题与「还有 N 个」一并减去被隐藏的部分，分组不会承诺自己画不出来的行。
- 文档：新增「公司模式」指南（含 Marketplace 案例走读）、`penguin org` 参考，以及服务端 API 参考里的组织路由。
