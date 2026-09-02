# 公司模式：由日程、工单看板与群聊驱动的 Agent 组织

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `core`, `skills`, `docs`
- **PR:** [#587](https://github.com/Prism-Shadow/penguin-harness/pull/587)

[English](2026-09-02-company-mode.md)

Web App 新增第二种工作模式。公司模式下，一个 Project 的 Agent 组成一个**组织**：以 CEO 为根的汇报树，每位员工一个常设的**工位会话**，作为唯一周期性驱动的**日程**，承载工作的五列**工单看板**，只有 `@` 才会打扰到人的**群聊**，以及按员工设定、80% 告警、100% 暂停该员工日程的月度**预算**。创建组织只需一句话使命，且只生成 CEO；CEO 在工位上的初始化会话里招募人事、财务与其余角色，划分公共工作区，为大家安排日程，开出首批工单。

组织的每一部分都是 `<project>/organizations/<org_id>/` 下的文件：`org_config.toml`、`org_chart.yaml`（员工树，含各员工的预算、工作区与 Model）、`desks.toml`（服务端写入的工位台账）、`calendar/<agent_id>/<event>.toml`（去掉目标字段的定时任务格式）、`tickets/<yyyy-mm>/<列>/<yyyy-mm-dd>-<slug>.md`（取法 Agent Notes 的头部——Status、Initiator、Owner、Parent、Notify、Priority、Due、Blocked、Blocked-by、Sessions——以及 Goal、Acceptance criteria、Progress、Result 四节）、`chat/<yyyy-mm-dd>.jsonl` 与组织手册 `README.md`。SQLite 只保存每轮对账都从这些文件重建的缓存（工位与工单会话的归属、日程运行状态、上次已通知的工单状态、群聊扫描游标、预算标记）以及每个用户的群聊已读游标。

## 细节

- 服务端：与定时任务调度器同构的组织调度器每 30 秒、以及每次 API 写入后立即对账每个组织——把台账与工单投影到缓存，为工作区被重新划分的员工换工位，把到期的日程项发往工位（工位忙则排队，组织或员工暂停时搁置，绝不补发），对工单变化只通知一次（指派、阻塞、阻塞解除、完成、拒绝——员工收到发往工位的通知，人收到群聊系统消息），按组织的连锁上限投递群聊 @ 提及，并重算预算。每次触发都是一条以 `[org_trigger]` 块开头的用户输入；工单会话是员工 Agent 的普通会话，会话 id 追加到工单头部的 `Sessions` 字段。支出按会话归属：员工成本 = 本人会话加全部下属，工单成本 = 其贡献会话在所服务工单之间均分后的份额，沿 `Parent` 上卷。
- API：`/api/projects/:projectId/organizations` 及其子路由——员工树、员工、工位、手册、日程、工单（移列、阻塞、解除、进展、发起、挂接）、群聊（含已读游标）、财务与组织会话列表；用户级事件 `org_run`、`org_chat`、`org_ticket`、`org_budget`。Project 成员可读写，仅 owner 可删除。迁移 4 新增七张缓存表。
- 开关：管理员总开关（服务器设置的 `companyMode`，缺省开；关闭即停止调度器、组织路由回 404、隐藏模式切换，并由 `GET /api/me` 报告）、`ui_prefs` 里的个人开关，以及组织自己的 `status: paused`。
- 控制环境：工位与工单会话的命令子进程额外获得 `PENGUIN_ORG_ID`，在会话内 `penguin org` 不必再传 `--org-id`。
- Core：标记清单新增 `[org_trigger]`（与 `[scheduled_task]` 同属标题噪声），并提供 `buildOrgTriggerMessage` / `parseOrgTriggerMessage`。
- CLI：`penguin org` 命令族——`ls`、`create`、`show`、`chart`、`hire`、`employee set`、`leave`、`desk show|renew`、`calendar ls|add|update|rm`、`ticket ls|show|create|move|assign|block|unblock|progress|start|attach`、`chat tail|send`、`finance`——作为 API 的瘦客户端，处处支持 `--json`。
- Web：Project 切换器上方的「开发 | 公司」模式切换、带新建与设置的组织切换器、六个页面（概览、组织图、日历、工单、财务、群聊）、按组织分组并带工位 / 工单子夹的会话列表、开发模式下的「组织」自动子夹、对话中的 `[org_trigger]` 横幅，以及设置页上的两个开关。
- 创建选项：新建组织时可指定 **Model**（已配置的成对引用，员工条目未指定时工位与工单会话都用它）与**公司工作区**（一个已存在的绝对目录，替代组织目录内的 `workspace/` 作为公共工作区）；二者都是 `org_config.toml` 的字段，可在组织设置里修改，也可经 `penguin org create --workspace … --model-id … --provider …` 指定。
- 决策关口：CEO 只提案、董事会拍板——初始化会话先发一份完整提案（使命理解、首批工单、招募角色及预算与 Model、工作区划分）并结束本轮；招募、预算、拒绝他人的工单、跳过审核关闭 P0/P1 工单、任何触及组织之外的动作以及结构变更都要等创建者在群聊里确认。员工把这类事项上报给 CEO。写进 `company-ceo` / `company-employee` Skill、初始化会话与组织手册。
- 排班规则：CEO / 人事 Skill、初始化会话与组织手册把日程当作排班表——按角色定节奏（CEO 每日、人事每三天、财务每周）、每位员工各占一个时刻、每人只有一条常设日程项、绝不 `--start-at now`。
- 插件：新增独立分类（Agent Company / Agent 公司）下的 `agent-company` 插件（`preinstall: false`），携带 `company-employee`、`company-ceo`、`company-hr`、`company-finance` 四个 Skill；CEO 与每位招募的 Agent 都会连同 `agent-development` 一起安装它。
- 文档：新增「公司模式」指南（含 Marketplace 案例走读）、`penguin org` 参考，以及服务端 API 参考里的组织路由。
