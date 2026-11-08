# 压缩阈值可以按模型窗口的百分比设定

- **Date:** 2026-11-08
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`

[English](2026-11-08-compaction-percent-threshold.md)

`compaction.max_context_percent` 把压缩阈值写成模型上下文窗口的百分比，于是一个 Agent 跟着 Session 实际运行的模型走，而不是带着一串只为某个模型调好的 Token 数。Agent 设置页为它新增了一个输入框。

## 细节

- 正数的 `max_context_percent`（1–100）优先于 `max_context_length`；`-1` 或留空则仍用 Token 阈值。两种形式都被「`context_window` − 2048」裁剪，因此即使填 100% 也给压缩请求本身留出空间；会四舍五入到零的占比被兜到 1 个 Token——`0` 是表示关闭压缩的配置值。
- 模型条目没有可用的 `context_window` 时，按 128000 的假定窗口取占比，与 Token 形式原本的推导假设一致。
- 引擎的压缩设置、每个检查点对 `compaction` 一节的重读，以及 `GET /api/sessions/:id/context` 回报的 `compactionThreshold` 都跟随新字段，因此输入区的上下文圆环画的正是生效中的阈值。
- `PUT /api/agents/:id/config` 接受 1–100 或 `-1` 的整数 `compaction.maxContextPercent`，Agent 配置 DTO 也会带回它。种子配置不变，因此新建 Agent 在没有人为设置之前不带占比。
- Web App 里，Agent 设了占比后上下文面板的阈值切线只作读数：在会覆盖它的百分比之下拖出的 Token 数不会生效，静默失效比不给拖更糟。面板改为注明当前占比，并指向 Agent 设置——百分比在那里修改，且对运行中的对话立即生效。
