# 评估中心的分数曲线跨过其他 Agent 连成一线，成员看不到仅 owner 可用的创建入口，英文标签不再被截断

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `web`

[English](2026-09-17-evaluation-center-lines-owner-actions-labels.md)

Benchmark 分数曲线上的一个系列此前只在时间轴上相邻的槽位之间连线，
于是两个点之间只要夹着另一个 Agent 的评估，线就断开；两个 Agent 交替评估时，图上一条线都画不出来。
现在每个系列都是穿过自身各点的一条线。两个仅 owner 可用的操作不再提供给 Project 成员，
英文界面里被截断的标签也都能完整显示。

## 分数曲线

- 每个系列按记分板顺序，穿过自身带有限 Score 的各条评估，从其他系列占据的槽位上方直接连过去；
  每个点仍停在它在时间轴上的槽位。系列中没有有限 Score 的评估不画点，也不断线：
  它两侧的 Score 直接相连，卡片上的分数变化比较的正是这两个 Score。
- `benchmark-metrics.ts` 中的 `seriesPoints` 负责生成一个系列的点，由 `segmentPath` 连线。
  它取代了 `seriesValues`；`lineSegments` 会在系列不占据的每个槽位处把线切开，
  已连同其测试从 `chart-geom.ts` 中移除。

## 仅 owner 可用的操作

- 评估中心的「手动创建」只提供给 Project 的 owner，页头与空态同样如此。
  成员仍有「用 AI 创建」，第一张步骤卡也不再向成员提及手动路径。
  服务端对成员的 `POST /api/projects/:projectId/benchmarks` 返回 403；
  删除 Benchmark 在页面上本就只对 owner 显示。
- 「系统设置」›「通用」中的「导入 Trace」一行只列出当前用户是 owner 的 Project，
  当前打开的 Project 属于其名下时默认选中它；名下没有任何 Project 的用户看不到这一行。
  导入接口 `POST /api/projects/:projectId/agents/:agentId/traces/import` 只允许 owner 调用。

## 英文标签

- Benchmark 卡片的分数列在最小宽度之外随标签变宽，「first evaluation」不再被截断，
  「Not evaluated yet」也保持在一行。中文卡片的布局不变。
- 题目详情弹窗里的文件树从 240px 起随最宽的一行变宽，最宽到 360px，
  于是「Scoring rubric」能与旁边的「Hidden from Target Agent」徽标一起完整显示。
  为此 `FileBrowser` 新增可选的 `treeMaxWidth`；插件详情的文件树仍是固定宽度。
- 组织图上，CEO 徽标从名称行移到了头衔行，
  CEO 的名称（创建时为 `<组织名> CEO`）因此与其他员工一样占满整行。
  名称长到固定尺寸的卡片仍放不下时，卡片的悬停提示给出全文。
