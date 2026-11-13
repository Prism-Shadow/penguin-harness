# 专家团框架设计（对标 Octop Expert Teams，第一版 MVP）

> 参考对象：https://github.com/TencentCloud/Octop （`docs/expert-teams.md`、`docs/agent-interop-mailbox.md`、`docs/agent-call-agent.md`、`docs/agent-delegation.md`、`docs/architecture.md`）
> 本设计只借 Octop 的思想，不照搬它的 LangGraph/harness 栈；执行层复用本仓库已有的 `ai_helper + ph_bridge + tasks.Progress`。
> 注：本仓库已有 `team_members`（人员花名册，真人），为避免混淆，本文统一用**专家（expert）/ 专家团（expert_team，主持人+成员）**，代码名前缀一律 `expert_`。
>
> 方向（用户 2026-10-12 定）：专家团**不做前端展示**（`/expertteams` 页面与侧栏入口已拆除），
> 只做后台能力由后续功能自动调用；开关与触发只走接口。
> 首个自动调用方——**审改闭环**（`app/expert_autoreview.py`）：标书上传流水线收尾自动开
> bid-review 评审团（按公司常驻、首次自动按预置建），缺口自动改（无清单→rules 生成、
> 缺条目→`add_item` 去重追加、字段空白→记 leftover 不动抽取），两轮封顶；
> 总开关 `expert_auto_review`（默认开，`GET/PUT /api/expert/auto_review`），
> 手动补跑 `POST /api/expert/autoreview/term/{id}`；失败绝不掐断上传任务。
> 验证 106 项（`scripts/verify_expert_team.py`）。

## 0. 一句话思想（从 Octop 抄什么）

1. **专家是可复用的配置**：一行 DB 记录 + 一个工作区目录（`SOUL.md` 人格 + `AGENTS.md` 准则 + `manifest.json` 清单），能力靠拼装（提示词/技能/知识/模型），不靠写新类。
2. **团队不是新实体**：团队 = 一个 `kind=team` 的特殊专家（主持人），只调度不干活；成员仍是独立专家，可进多个团。
3. **协作只收敛到两种**：同步问（`@` / sync，阻塞等结果）+ 异步派工（background，进 inbox，主持人继续说话，做完回叫）。不做 DAG 工作流引擎。
4. **结果不入库、上下文靠回写**：子专家结果由主持人改写后写回父 thread（本仓库即 `tasks.Progress.think/log + task_steps`），inbox 只记状态。

## 1. 现状盘点（为什么能薄做）

| Octop 的东西 | 本仓库已有的对应物 | 结论 |
|---|---|---|
| 模型路由/多通道 | `app/ai_helper.py`（32 通道、`ai_slot_order`、401/429 换槽、`chat_complete_any`）| 直接用，不新增 |
| Agent 执行（带工具、可读文件） | `app/ph_bridge.py`（每步一个独立 Harness 会话、`run_session`、失败 10 次切模型、`note_session` 落库）| 成员派工 = 调一次 `run_session`，不新增执行器 |
| 进度/转播/断点续跑 | `app/tasks.py`（`Progress.stage/item/think/log`、`task_steps` 落库、`phase_hook`、`session_of` 接管）| 群聊上墙 = 主持人任务的 think 流，不新增推送通道 |
| 确定性工具（模板/矢量图/截图/组包） | `app/agent_pipeline.py` 六步分工（Agent 只做清单+起草+出件，其余确定性 CLI）| 专家只做判断，脏活继续调现有函数，不重写 |
| 共享 skill/知识 | `bid-response-doc` skill（`ph_bridge.bid_skill_block`）、公司资料库、经验库 | 专家装配时拼进去即可 |
| 人员花名册 | `app/team_members.py` + `app/api/team_api.py` | 与专家团无关，保持不动 |

所以第一版**不引入新队列、不引入新模型网关、不引入 LangGraph**，只新增：2 张表 + 1 个调度模块 + 1 组 API + 主持人提示词模板。

## 2. 身份模型

```
专家 expert：{ id, name, role, model_slot?, system_prompt, persona, skills[], knowledge[], owner_group, is_shared }
专家团 team：{ id, name, host_expert_id(kind=team), member_ids[>=2], rules, owner_group }
```

- `kind` 只有两种：`expert`（干活）/ `team`（主持人）。主持人是一行独立的 expert，`kind=team` 只做列表索引，编制写 `expert_teams.members`（JSON 数组），不建成员关系表（抄 Octop：编制只在清单里）。
- 成员准入：自己的专家 + 分享给自己的专家（`is_shared=1` 且同 deployment）；分享来的能派工、产出进任务，**不能改对方配置**。
- 第一版不做：团队分享、嵌套团队（成员不能是 team）、自动拉起停用成员。
- 主持人能力阉割（抄 Octop §主持人装配）：主持人会话**不挂**文件写、浏览器、MCP、插件；只给 `列成员 + 派工 + 读任务上下文`。主持人正文只允许：寒暄/派工说明/收工总结，专业工作一律派工。
- 防递归：成员被派工时，`allow_dispatch=False`，只能同步问同事（调一次 `ai_helper`），不能再异步拉人进群。

## 3. 数据模型（SQLite，两张表，复用 task_runs 记在途）

```sql
-- 专家定义（含主持人 kind='team'）
CREATE TABLE IF NOT EXISTS expert_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'expert',  -- expert|team
  role TEXT DEFAULT '', persona TEXT DEFAULT '',            -- 人格：先只存一段中文描述，不做16型
  system_prompt TEXT DEFAULT '', skills TEXT DEFAULT '[]',  -- JSON 数组：skill 名
  knowledge TEXT DEFAULT '[]',                              -- JSON 数组：知识库/公司资料范围
  model_slot INTEGER,                                       -- NULL=走默认顺序；有值=优先该槽位
  owner_group INTEGER NOT NULL DEFAULT 0, is_shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
-- 团编制（主持人是 expert_agents 里 kind=team 的一行）
CREATE TABLE IF NOT EXISTS expert_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, host_id INTEGER NOT NULL REFERENCES expert_agents(id),
  member_ids TEXT NOT NULL DEFAULT '[]',                    -- JSON 数组，>=2
  rules TEXT DEFAULT '',                                    -- 团队准则（派工时注入）
  owner_group INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
```

- 在途派工**不建表**：进程内 `dict[job_id -> {team_task, member, status}]` + 复用 `tasks.note_session` 把成员 Harness `session_id` 落进主持人任务的 meta（重启后能接管展示，执行不恢复——抄 Octop“重启丢在途”，第一版接受）。
- 历史归属：成员输出以 `think(kind='peer', label='<成员名>', text)` 写进主持人任务，不污染成员自己的任务流；成员侧（可选）只记一条“来自团队 X”的任务摘要。
- 与 `team_members` 零耦合：两套表、两套 API，名字不许复用 `team_` 前缀，统一 `expert_`。

## 4. 运行时（两种协作，都落在现有原语上）

### 4.1 同步问（@ / sync）

```
用户在团任务里 @成员 → 主持人逻辑（本地函数 apply_mentions）→ 对该成员调一次 ai_helper.chat_complete_any（带该成员 system_prompt+技能块+任务上下文）→ 结果以前置块注入主持人下一轮输入
```

- 同步只用于短问（出主意、给口径），超时按 `ai_timeout` 走，不开 Harness 会话。

### 4.2 异步派工（主路径，抄 inbox 四步）

```
主持人 dispatch(member, task_text)
 → inbox.enqueue -> job_id（立即返回，主持人继续跑）
 → worker（按成员串行、跨成员并行，上限 3 并发，抄 demo-gen-empty-reply 拥塞教训）：
    ① member.call = ph_bridge.run_session(改写后的任务书, workspace=任务包目录, on_step→主持人任务 think)
    ② compose_followup(原问题, member结果) → 主持人 synthesizer（一律用 ai_helper 跑一次短合成，不开新 Harness 会话）
    ③ 写回主持人 Progress（think 上墙 + log 收口），job=done/failed
    ④ on_reply：任务面板推“<成员> 已回复，主持人总结 …”（走现有任务中心轮询，不新增 WS）
```

- 任务书改写是硬要求：主持人必须先消化用户原话再改写成“给成员的独立任务书”（背景+输入路径+输出 JSON 格式+禁令），**禁止原样转发**。
- 对方 Harness 会话没跑起来 = 派工失败，主持人走失败回叫（“请 X 重做/换人”），不自动重试超过 1 次。
- 停止只停主持人本轮；成员会话继续跑完再回叫（调 `tasks.cancel` 只取消主持人 task，成员 session 不杀）。

### 4.3 并发与模型池

- 同一成员串行（防同一专家被两个任务书互撞），不同成员并行，并发上限 3（Harness 池拥塞时空回复的教训）。
- 模型选择：成员有 `model_slot` 则优先该槽，失败回退全局 `call_order()`；沿用“失败 10 次切模型”和“上次成功优先”（`ai_helper` 已有，不重写）。

## 5. 主持人装配（提示词模板，存代码不存库）

`app/expert_team.py:HOST_SYSTEM`（节选，创建主持人时与 `rules` 拼接后作为其 system）：

```
你是{team}的主持人，只调度不亲自动手。
- 成员：{members}。专业工作必须 dispatch 给成员，你只做改写任务书、并行派工、收工判定。
- 派工前先消化用户原话，改写成独立任务书（含背景/输入/输出格式/禁令），禁止原样转发。
- 一轮可并行派多人；@只代表优先级，不强制指派。
- 成员结果上墙后，你做收工判定：够了就总结（不复述成员正文），不够就追派并说明缺什么。
- 用户新消息永远优先处理，即使成员还没回完。
```

成员任务书模板 `MEMBER_TASK`：背景 + 输入文件绝对路径 + 输出 JSON Schema + “只输出 JSON，不要写磁盘”禁令（抄 `agent_pipeline.LIST_PROMPT` 体例）。

## 6. 接口与界面（第一版最小）

```
GET  /api/expert/agents          列表（含 kind, member_ids）
POST /api/expert/agents          新建专家/主持人
PATCH/DELETE /api/expert/agents/{id}
GET/POST /api/expert/teams       列表/创建（members>=2 校验）
PATCH /api/expert/teams/{id}     改名/改成员（有在途 job 的成员拒绝移出：TEAM_MEMBER_BUSY）
POST /api/expert/teams/{id}/run  开团任务（进 tasks 中心，kind='expert_team'）
GET  /api/expert/teams/{id}/jobs 在途派工（内存 inbox 快照）
```

- 前端：专家页加“专家团”Tab（创建只收名称/成员/准则），任务中心复用现有 `GenProgress`（成员输出走 think 上墙，主持人总结走 done）。不做独立群聊页。
- 错误码抄 Octop：`TEAM_MEMBERS_TOO_FEW / TEAM_MEMBER_INVALID / TEAM_MEMBER_BUSY`。

## 7. 分期（每期可验）

- P0 骨架：两表 + `app/expert_team.py`（装配+改写+dispatch 串行版）+ 4 个接口 + 1 个验证脚本。验收：建 1 团 2 成员，跑通“派工→成员 session→回叫上墙”。
- P1 并行与门禁：在途保护（ busy 成员不可踢）、并发 3、失败回叫、停止只停主持人。
- P2 分享与复用：`is_shared` 跨组可见、skill/知识拼装、主持人准则注入。
- 非目标（第一版不做）：嵌套团、inbox 落盘、多团共享工作区、独立群聊 UI、16 型人格。

## 8. 风险（Octop 已踩过的）

1. Harness 池拥塞时空回复 → 先查会话消息流定性，ETIMEDOUT/429 直接重发，派工并发卡 3。
2. 同名“team”撞车（人员花名册）→ 代码/API/表名一律 `expert_`，界面叫“专家团”。
3. 进度权重失守 → 成员子项必须从主持人 `_own` 里扣份（走 `stage/item` 原语），不另起进度条。
4. 长任务死在服务进程里 → 团任务一律走 `tasks.start/attach` 后台进程，不打断重启。
