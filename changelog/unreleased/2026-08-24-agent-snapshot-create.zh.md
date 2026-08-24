# 新建 Agent 可从快照包直接初始化，导出的包也重新可选了

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[English](2026-08-24-agent-snapshot-create.md)

围绕 Agent State 快照搬运的两个改动。创建弹窗现在可以直接从导出的快照包初始化新
Agent，不必再「先建空 Agent、再导入覆盖」绕一圈；导入的文件选择器也不再把导出产物
置灰。

## 从快照新建

智能体页的创建弹窗新增可选的「**从快照初始化**」字段：选中导出的包
（`<agentId>-v<n>.tar.gz`），新 Agent 即以包内 Agent State 创建——版本、提示词、
工具、技能、定时任务与记忆一并到位。id 字段留空时按包文件名预填（照常可改）。

- `POST /api/projects/:projectId/agents` 接受可选 `dataBase64`（与导入端点同一份
  14MB 上限的包）。从包新建无需版本确认、也不做导入前补快照：这两道防线守的都是
  既有 State，新 Agent 没有可保护的状态。
- 显式填写的 `name` / `description` 覆盖包内值；留空则沿用包内（不再以 id 兜底
  ——包本身就是被复制进来的身份）。
- 与技能播种（`skills` / `skillsDirectory`）互斥：包自带技能，服务端对同给拒绝
  （`snapshot_with_skills`），弹窗侧选中包后隐藏技能字段。
- 包非法则创建整体失败、不留下空 Agent——该 id 可立即重试。
- 权限沿用创建（任意项目成员）：导入仅 owner 的约束守的是覆盖既有 Agent State，
  从包新建不覆盖任何人的工作。

## 导入选择器修复

设置页的导入控件此前只声明 `accept=".tar.gz,.tgz"`。macOS 系选择器（Safari 与桌面
壳的原生对话框）按 UTI 映射扩展名，双点的 `.tar.gz` 映射不到任何类型——导出的
`<agentId>-v<n>.tar.gz` 在选择器里被置灰、无法选中。两处快照选择器现在同时声明
`application/gzip` / `application/x-gzip` 与裸 `.gz`；服务端本就校验包结构，前端
放宽不会放进任何它拒绝不了的东西。
