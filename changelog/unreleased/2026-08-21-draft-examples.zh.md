# 首页示例：音游、投资 Copilot 与定时任务分类

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `web`
- **PR:** [#399](https://github.com/Prism-Shadow/penguin-harness/pull/399)

[English](2026-08-21-draft-examples.md)

首页示例目录新增五张卡片与一个分类。「搭建网页应用」新增一个喵斯快跑式的节奏跑酷游戏；「搭建和优化智能体」的第一条新增对话式投资分析助理；新分类「创建定时任务」下三条示例创建的是真实的定时任务——`agent_state/schedule/` 下的 TOML 文件，而不是臆造的 API。

## 新增示例

- **音乐节奏跑酷小游戏**（搭建网页应用，`web-design`）——单个 HTML 文件、file:// 即开即玩的双轨横版音游：普通音符 / 长按 / 障碍三种物件，Perfect / Great / Miss 判定并统计连击与准确率，两个难度，结算给评级。提示词要求用 Web Audio API 现场合成音轨（不能用 CDN，外挂音频文件在 file:// 下也读不到）、谱面与音乐共用同一份节拍网格、判定时间一律取 `AudioContext.currentTime`，并附带延迟校准页。
- **对话式投资分析助理**（搭建和优化智能体，`penguin-sdk` + `web-design`）——基于 Penguin SDK 的股市 Copilot。数据层统一封装在应用后端之后，写代码前先用 curl 验证接口；刷新周期随应用启动即开始，无人操作也持续更新首页走势，展示最近更新时间，抓取失败时标记过期而不是清空页面；每轮产出指数、板块与趋势分析；聊天界面通过 `exec_command` 工具取数而非凭记忆作答；另有查单只股票的 CLI，与 Web 端复用同一套数据与分析模块。每个结论都要带上数值、时间戳、来源 URL 与指标口径，整体定位为基于公开数据的分析，而非投资建议。
- **创建定时任务**（新分类，不固定技能）——三条示例都先确认 `{{SCHEDULES}}` 小节存在，用 `date` 读到服务器当前日期、星期与 UTC 偏移，再把 TOML 写进 `<app_data_dir>/agents/<agent_id>/agent_state/schedule/`：
  - *每天早 9 点的计划对话*——一个 `24h` 任务，`start_at` 设为下一个当地 09:00，并绑定当前会话的 `session_id`，让每天早上与进展回顾落在同一个对话里。
  - *每天汇总 GitHub 项目状态*——24 小时周期、不写 `session_id`，每天新开一个 Session；提示词用 gh CLI 收集 Issue、PR、CI 与积压项，结尾给出 P0 / P1 / P2 建议并链接到对应 Issue 或 PR。
  - *每周五晚回顾并记录 Memory*——周任务绑定当前会话，带用户过一遍这一周，按 Memory 小节规定的格式把确认的条目写进用户记忆目录，并在同一轮更新该目录的 `MEMORY.md` 索引。

## 布局与测试

- 各分类不再等长（4 / 4 / 3），打开定时任务分类时其下方内容会移动一行。注册表文档注释与首页布局注释改为陈述当前真正成立的规则——各分类长度相差不超过一行——并由 `example-tasks.test.ts` 守住。
- 该测试同时检查：每个分类与示例在两份词典里都有非空文案；三条定时任务示例写明真实机制（`agent_state/schedule/`、`enabled = true`、`start_at`，且不出现 cron 语法）；投资示例保留「不是投资建议」的定位。
