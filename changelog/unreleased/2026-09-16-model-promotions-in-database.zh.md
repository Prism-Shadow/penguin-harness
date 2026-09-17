# Project 的模型文件只存牌价，促销由服务端存储

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `model-catalog`, `server`, `web`, `docs`
- **PR:** [#716](https://github.com/Prism-Shadow/penguin-harness/pull/716)

[English](2026-09-16-model-promotions-in-database.md)

`.project_config.toml` 中每个模型的 `pricing` 现在一律是牌价，所有分组都如此。固定促销是服务端存在 `web.db` 新表 `model_promotions` 里的一个比例，成本按「牌价 ×（1 − 折扣）」计算。此前预置与**同步预置**写进文件的是折后价。

## 细节

- 促销只由三处写入：新建 Project（目录的促销随预置模型一并存入；纳管 `default_project` 时只要写入了预置，同样存入）；**同步预置**，为每个预置行写入目录的促销或清除（Penguin Go 行保留其平台设定的促销）；以及 Penguin Go 的授权与同步，存入平台下发的促销。
- `GET /api/projects/:projectId/models` 以 `discount` 报告行上的促销。`PUT` 的每个条目可带 `discount`：0 到 1 之间的数值即存入，`null` 即清除，省略则保留已存的促销——但该条目改名或改了定价时清除。整表里不再出现的行，其促销一并删除。模型配置弹窗在价格下方注明当前促销，并说明改价会取消促销。
- 成本中心、会话成本、对话里的实时单轮估算与公司模式的预算都按促销后的价格计价。存的仍是目录高峰价时，空闲时段档位照旧在其上叠加，卡片徽标显示合计的优惠。
- core 的 `presetModelEntries()` 改为写牌价，新增 `presetPromotions()` 列出目录的固定促销。
- 数据库迁移 9 `model-promotions` 建表；可热更新（swap-safe），其 `down` 会删掉全部已存促销。

## 既有 Project

不做迁移。文件里存着此前预置或同步写入的折后价的 Project，照旧按这些数字计费、不显示促销徽标，模型库页把这些行算作可同步的预置更新；执行**同步预置**后改写为牌价并存入促销。预置不经服务端写入的 Project（由 CLI 或 SDK 创建）在同样同步之前按牌价计价。
