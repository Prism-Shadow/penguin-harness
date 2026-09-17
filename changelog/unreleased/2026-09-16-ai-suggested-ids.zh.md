# Project、Agent 与 Benchmark 的 id 可由 AI 生成

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#755](https://github.com/Prism-Shadow/penguin-harness/pull/755)
- **Breaking:** yes — 移除 `POST /organizations/suggest-id`，改用 `POST /api/projects/:p/suggest-id` 并传 kind `"org"`（或 `"channel"`）

[English](2026-09-16-ai-suggested-ids.md)

新建 Project、创建 Agent 与新建 Benchmark 三个对话框改为与新建组织相同的形态：名称在前，旁边的 id 字段带「用 AI 生成」按钮，请 Project 的默认模型按该类对象自己的 id 形状给出一个英文 id。id 仍为必填、可改写，校验不变；没有模型或调用失败时退回名称的转写，无从转写的名称则填入带日期的占位 id，并在字段下方提示改成有含义的名字。

## 细节

- 新增路由 `POST /api/projects/:projectId/suggest-id`，接受 `{name, kind, taken?}`，`kind` 为 `project`、`agent`、`benchmark`、`org` 或 `channel`。各 kind 共用同一份实现，由一张类型表参数化：`project` 与 `agent` 的 id 是不带前缀的 snake_case，非 admin 用户的 Project id 为 `<用户名>-<后缀>`，Benchmark id 为 kebab-case。没有引入新的前缀。
- 路由自行避开该 kind 的创建路由会以「已占用」拒绝的全部名称——服务器上的全部 Project id 与目录、该 Project 的 Agent id 与目录、其 Benchmark 目录，列表里看不到的残留目录也算在内——撞名时加 `_2` / `-2` 后缀。只读名称，这些 id 也不会写进给模型的提示词。以数字开头或只有一个字符、因而不合该类规则的 id，前面补上类型名（如 `agent_3d_viewer`）。
- 调用权限与各自的创建路由一致：Project 与 Agent 的 id 须是该 Project 的成员，Benchmark 的 id 须是 Owner。新建 Project 对话框以打开它的那个 Project 的默认模型提问。
- `org` 与 `channel` 转交组织服务，提议、提示词与错误记录都不变。`POST /api/projects/:projectId/organizations/suggest-id` 已移除。三个新 kind 的模型调用落空记为 `id_suggest` / `id_suggest_failed` 错误。
- 共用的 id 字段及其提示从 `features/company` 移到 `features/semantic-id`，文案从 `company` 移到词典的 `semanticId` 一节，并为非 admin 用户的 Project id 增加了锁定前缀。Benchmark 对话框不再在输入标题时改写 id。
- Server API 参考新增了该路由并删去组织的 `/suggest-id` 一行，Web App 指南补充了三个对话框的 id 字段说明，中英文同步。

## 兼容性

`POST /api/projects/:projectId/organizations/suggest-id` 已不存在。调用过它的 API 客户端改为把同样的 body——`{name, kind, taken?}`，`kind` 为 `org` 或 `channel`——发给 `POST /api/projects/:projectId/suggest-id`，答复同为 `{id, source, reason?}`。Web App 与 CLI 无需任何改动：组织与频道对话框已在本次改动中改用新路由，CLI 从未调用旧路由。
