# PR：专家团后台化与审改闭环（2026-10-12）

> 以 PR 格式写的评审包：本仓库及上一层 penguin 目录都没有 git（无分支、无远端），
> 开不出真正的 PR。这份文档 = PR 正文，文件清单哈希 = 改动快照，评审人按
> 「评审清单」逐项确认即等价合入。基线：2026-10-12 08:30 之后本批次改动。

## 背景

Octop 专家团思想落地（`docs/专家团框架设计.md`）。用户 2026-10-12 定方向：
专家团不做前端展示，只做后台能力，由标书上传流水线自动调用（审改闭环）。

## 改动清单（11 文件，业务代码约 +2500 行）

| 文件 | 性质 | 说明 | sha12 |
|---|---|---|---|
| `app/expert_team.py` | 新建→扩展，1238 行 | 专家/团 CRUD、同步问、并行派工×3、失败回叫、停止语义、嵌套≤2 层+判环/判深、`@`指派、附件透传、落盘、归档、估时、预置模板 | `b6bf208b5fc8` |
| `app/expert_autoreview.py` | 新建，325 行 | 审改闭环：常驻评审团、缺口契约、定性对账、缺条目追加、两轮封顶、总开关 | `f6d54a9d3de3` |
| `app/api/expert_team_api.py` | 新建→扩展，282 行 | `/api/expert/*`：专家/团 CRUD、开团/重派/同步问、历史/档案/估时/模板、自动开关、手动触发 | `254193589cce` |
| `app/api/experience_api.py` | 修改 4 处 | `_upload_work` 加 `user` 参数并透传两处调用点；收尾 ⑧ 审改钩子（try 包住） | `5e2683374a9d` |
| `app/database.py` | 修改 2 处 | SCHEMA 加 4 表（`expert_agents/teams/jobs/archive`）；`_migrate` 容忍 `params=None`（全新 sqlite 库必 crash，老 bug） | `d8301af3a121` |
| `app/ai_helper.py` | 修改 1 处 | `chat_complete_any` 加可选 `prefer_slot`（只重排，不改池子） | `8738f6874329` |
| `app/main.py` | 修改 1 处 | 仅注册 `expert_team_api` 路由（`/expertteams` 页面路由加过又删，已确认无残留） | `4878645f9d61` |
| `scripts/verify_expert_team.py` | 新建→扩展，582 行 | 106 项验证，临时库+全 mock/演练，不碰生产 | `186a709b6b26` |
| `docs/专家团框架设计.md` | 新建→更新 | 思想来源、落地方向、接口清单 | `b6700c5366bf` |
| `web/frontend/src/App.vue` | 净零改动 | 侧栏入口加过又删，grep 确认无 `expertteams` 残留 | `22d1d924810c` |
| `web/frontend/src/main.js` | 净零改动 | 路由加过又删，同上确认 | `7a8b3c83c9b4` |
| `web/static/dist/*` | 构建产物 | 随删页面重构建（含 `/expertteams` 移除） | — |

范围外说明：今日同目录还有 `bid_docgen.py`、`demo_agent.py`、`ph_bridge.py` 等被**其他并发会话**改动（本仓库无 git、多会话同改），不在本次 PR 内，评审时勿混入。

## 验证证据

- `TRACKER_DB=sqlite python3 scripts/verify_expert_team.py` → **通过 106 / 失败 0**（门禁/嵌套环深/附件/归档/估时/模板/历史/开关/钩子存在性全覆盖）。
- `python3 -m py_compile` 相关 5 文件全过；新 DDL 过 `dbcompat.convert_ddl`（PG 可执行）。
- 生产服务已重启：`/health` 正常、日志 0 报错、PG 四表齐、`/expertteams` 404（页面已拆）、`/api/expert/*` 鉴权正常。

## 行为变化（评审重点）

1. 上传招标文件收尾**默认多起一个后台任务**（`expert_autoreview`）：评审+自动改清单，两轮封顶。老 7 步不变，钩子失败只记日志。
2. 新表 4 张随服务启动自动建（`IF NOT EXISTS`，老库无痛）。
3. 默认无前端入口；自动开关默认开，`GET/PUT /api/expert/auto_review` 可关。

## 回滚

- 关自动化：`PUT /api/expert/auto_review {"on": 0}`（或 settings 表置 `expert_auto_review=0`），秒级生效，不需重启。
- 退代码：恢复上表 6 个业务文件（`App.vue`/`main.js` 本来就没动），删 4 表可留（空表无影响）或手动 `DROP TABLE expert_agents, expert_teams, expert_jobs, expert_run_archive`。

## 评审清单

- [ ] `experience_api.py` 钩子 try 范围是否盖住全部失败路径（上传任务不受牵连）
- [ ] `apply_fixes` 只增不改（`add_item` 去重追加，不动已有条目与抽取结果）
- [ ] 嵌套 `TEAM_CYCLE` 是否先于 `TEAM_NEST_TOO_DEEP`（顺序反了环就不可达）
- [ ] 归档没写共享 `bid_experience`（跨公司泄漏红线）
- [ ] `106/106` 在评审机上重跑一次
