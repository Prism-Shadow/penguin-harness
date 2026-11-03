<!-- [English](README.md) | 简体中文 -->

# 示例：专家团框架（只调度的主持人 + 自动审改闭环）

源自 Octop Expert Teams 思想、在投标跟踪系统里生产验证过的**多专家协作框架**
（验证脚本 106 项全绿）。一句话思想：**团队不是新实体，只是一个 `kind=team`
的特殊专家——只调度、不干活。**

## 怎么玩

1. **专家 = 一行可复用配置**：DB 一行 + 一个工作区（`SOUL.md` 人格 + `AGENTS.md`
   准则 + `manifest.json` 清单），能力靠拼装（提示词/技能/知识/模型槽位），不为每个专家写新类。
2. **团队 = 主持人 + ≥2 成员**：编制只是主持人身上的 JSON 数组，没有成员关系表；
   成员仍是独立专家，可进多个团。
3. **只收敛两种协作**（不做 DAG 工作流引擎）：
   - 同步问（`@成员`，阻塞等，一次模型调用，不开 Agent 会话）；
   - 异步派工（每成员一次 Harness 会话，跨成员并行≤3，同一成员串行）。
4. **主持人只调度**：把用户原话改写成独立任务书（禁止原样转发），判收工，不复述成员正文。
5. **审改闭环**（`backend/expert_autoreview.py`）：每份新标书自动开常驻 `bid-review`
   评审团；缺口只做确定性自动改（无清单→生成、缺条目→去重追加），两轮封顶；
   改不了的进 leftover 留给人，绝不死循环。

## 目录

```
examples/expert-team/
  backend/expert_team.py        # 专家/团 CRUD、同步问、并行派工、嵌套团（≤2 层，判环/判深）、
                                # @指派、派工落盘、归档、估时、预置模板
  backend/expert_autoreview.py  # 自动审改闭环 + 总开关
  api/expert_team_api.py        # FastAPI 路由（/api/expert/*）
  tests/verify_expert_team.py   # 106 项验证：临时库 + 全 mock，不碰生产
  DESIGN.zh.md                  # 完整设计（思想/取舍/门禁来历）
  PR-NOTE.zh.md                 # 生产落地时的评审与回滚记录
```

## 移植接线点（复用前先看）

代码是从 FastAPI + PostgreSQL 应用里原样抽出的，依赖本仓库 6 处基础设施，
每处都只是一个小函数，换成你自己的实现即可：

| 引用 | 作用 | 替换成 |
|---|---|---|
| `database` | sqlite3 风格连接 + 设置 KV | 你的 DB 层 + 设置 KV |
| `tenancy` | 公司/账户归属（`group_of`、`user_id_of`、`is_super_user`） | 你的鉴权上下文 |
| `tasks` | 后台任务 + `Progress`（`think/log/stage`） | 你的任务 runner + 进度落点 |
| `ph_bridge` | Harness 会话执行（`run_session`） | 你的 agent 执行入口 |
| `ai_helper` | 多通道模型池（`chat_complete_any`） | 你的模型调用 |
| `responses` / `tender_terms` | 清单与要点表（仅审改闭环用） | 你的领域存储 |

可原样搬走的纯函数（零依赖）：`filter_by_mentions`、`rewrite_for_member`、
`_clean_attachments`、`collect_gaps`、`_infer_cat`、`_team_closure`（判环）。

## 验证

在原应用里跑：`TRACKER_DB=sqlite python3 scripts/verify_expert_team.py` →
106/106。本仓库内该脚本仅供参考；接好上表 6 处后再对你自己的栈跑。
