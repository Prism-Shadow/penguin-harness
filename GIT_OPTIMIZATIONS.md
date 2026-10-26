# 本地优化说明（经创贺联 fork）

本文件记录 `pg-migration` 分支相对上游 `Prism-Shadow/penguin-harness@main` 的所有本地改动，作为提交 README 之外的详细台账。

## 总览

| 指标 | 数值 |
| --- | --- |
| 上游基线 | `origin/main` v0.2.17（`0195c73b`） |
| 本地分支 | `pg-migration` |
| 合并方式 | merge（不 rebase，可长期跟随上游） |
| 领先提交数 | 34（含 1 次上游合并提交） |
| 文件改动 | 111 个 |
| 新增文件 | 32 个 |
| 代码行（相对 merge-base） | **+11,741 / −505** |
| 净增代码 | ≈ 11,236 行 |

## 提交分布

### 1. 数据库 PostgreSQL 后端（3 commits）

- `feat(db): PG backend shim (PENGUIN_DB=pg) on v0.2.16 tag`
- `feat(db): PG backend shim v2 — deployed-source sync, FTS5 tsvector translation, GROUP BY fix, CJS worker (21/21 green)`
- `fix(db/pg): translate scalar max/GREATEST, DO UPDATE SET column qualification, repeated named-param reuse`

把原本 SQLite-only 的存储层抽象成 `dbcompat` 兼容层；线上数据可整体迁到 PostgreSQL（本实例已迁到 PG18），同时保留 SQLite 回退路径。

### 2. Web 工单看板（9 commits）

- 分组（项目 / 模块 / 招标项目）、审批队列、批量操作
- 工具栏、列排序、横向滚动列
- 卡片优先级色条、拖拽防误选、屏蔽卡片单卡解禁
- 修复：select-mode onClick 覆盖拖拽 opener 的回归、house style、批量条高度、下拉最小宽度、工具栏换行

### 3. Web 定时任务（7 commits）

- 项目级定时任务页 + 一级导航入口
- 手动触发按钮、auto-paused 状态渲染与"继续运行"
- webhook 触发段
- inbox 行已读标记 / 归档
- 失效文件（invalidFiles）旁挂提示

### 4. Web 公司 / 组织（8 commits）

- 通知中心 + 财务用量下钻
- 按员工指定模型（desk 行/图表卡片菜单）
- 按分组推送开关
- 频道 @ 菜单加 squad 条目
- @提及 markdown 精确语法 + chip 渲染修复
- 看板偏好 / inbox 过滤按组织持久化（localStorage）

### 5. Web 会话归档（4 commits）

- 一级导航"已归档对话"页
- 归档回执条（撤销 / 查看 / 深链）+ live region 朗读
- 归档行链接标题（可直接点回原对话）
- 来源 Pill（program / user）

### 6. Web 杂项（3 commits）

- 员工机器 pin 选择器（单机切片，local only）
- 消息流 message-stream 修复
- ticket-dialog 守卫 + 测试

### 7. Core 引擎（2 commits）

- 上下文引擎 / omnimessage 优化
- abort 事件加 `error_message`（对齐上游 0.2.17 的 AmspRecord）
- **429 rate-limit 自动降级**：`pendingFailover` 队列 + `afterRun` 在 Task 边界换模型重发 turn（上游原本只判 fatal 不自动切换）

## 同步策略

- 永远 `git merge origin/main`，不 rebase。rebase 会让 34 个提交的 hash 全变，难以向追溯。
- 冲突集中在 amsp（上游把 `omnimessage` 改名 `records`）、schedule-store（machineId 跨机）、ticket 卡片（select/drag），已经收敛。
- 每轮合并后跑 `pnpm -r typecheck && pnpm -r test` 验证。
