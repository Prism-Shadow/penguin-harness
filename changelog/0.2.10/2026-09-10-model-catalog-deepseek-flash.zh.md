# DeepSeek V4.1 Flash 以 `deepseek-flash` 发布，并成为默认模型

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `core`, `cli`, `docs`, `skills`
- **PR:** [#662](https://github.com/Prism-Shadow/penguin-harness/pull/662)

[English](2026-09-10-model-catalog-deepseek-flash.md)

DeepSeek 已发布 V4.1 Flash，模型名定为不带版本段的 `deepseek-flash`。此前按发布公告的拼写预先登记
的 `deepseek-v4.1-flash` 条目被正式条目取代，后者现居 `deepseek` 分组首位，也是新建 Project 的起始
模型。同一次读取还带入了 TokenDance 与 OpenRouter 上转售的 V4.1 Flash 条目，以及 TokenDance 当前的
促销折扣率与 Doubao Seed 的展示名。

## DeepSeek 分组

- `deepseek-flash`（**DeepSeek V4.1 Flash**）取代预先登记的 `deepseek-v4.1-flash`：1,000,000 Token
  上下文窗口、支持图像输入，价格取 Flash 系列高峰档 CNY 0.04 / 2 / 8（缓存命中 / 缓存未命中 / 输出，
  每百万 Token），并沿用在北京时间周一至周五 9:00–12:00、14:00–18:00 之外各档减半的时段规则。
- 该条目是分组中唯一固定了 client 与 Base URL 的直连条目（`client_type = "deepseek-v4"`、
  `base_url = "https://api.deepseek.com"`）。AgentHub 0.4.11 只按原始子串 `deepseek-v4` 路由
  DeepSeek，不看别的，因此正式发布的这个裸 id 自身匹配不到任何 client。待 AgentHub 能直接路由该名称
  后，这两个字段即可移除。
- `deepseek-v4-flash` 现标记为支持图像输入。DeepSeek 已于 2026-09-10 下线该模型，并改由 V4.1 Flash
  按 Flash 价承接这个 id，因此实际应答的是一个能读图的模型。**AgentHub 0.4.11 仍然拒绝该裸 id 的图像
  部件**——其 DeepSeek 客户端带有一份写在下线之前的 text-only 拒绝名单——因此在 AgentHub 放宽该名单
  之前，发往 `deepseek-v4-flash` 的图片会被客户端拒绝，而不是被 DeepSeek 拒绝。在此期间请把图片发往
  `deepseek-flash`。
- `deepseek-v4-flash-vision-exp` 在同一份公告中下线，同样由 V4.1 Flash 承接；它的图像输入标记本就为
  真，未作改动。
- `deepseek-v4-pro` 保持 V4 Pro 牌价 CNY 0.3 / 9 / 27 与纯文本标记。自北京时间 2026-09-14 12:00 起、
  直到 V4.1 Pro 发布为止，DeepSeek 会把该 id 的请求全部路由到 V4.1 Flash 并按 V4.1 Flash 价计费；本
  条目记录的是厂商为 `deepseek-v4-pro` 自身公布的内容，因此维持原样。

## 默认模型

- 新建 Project 的 `default_model` 改为 `deepseek` / `deepseek-flash`。它的预置条目带有该目录条目固定
  的 client 与 endpoint，因此默认模型照原样即可路由。
- 文档中的首次运行命令随之调整：`README.md`、`README.zh.md`，以及中英两版的 CLI、SDK、Docker 快速
  上手都改为传入 `--model-id deepseek-flash`；配置文档与模型文档中的 `default_model` 行及其指向的
  `[[models]]` 示例同样如此。

## CLI 继承预置的固定项

`penguin config model add` 现在会按传入的 `(provider, model_id)` 精确读取内置目录条目，**新增**条目
会先继承该条目的 `client_type` 与 `base_url`，再退回分组规则。否则，向尚未持有该条目的 Project 执行
`penguin config model add --provider deepseek --model-id deepseek-flash`，写下的就是一条 AgentHub
无法路由的条目。显式的 `--client-type` 或 `--base-url` 仍然优先，已存在的条目也绝不会被改写。

## TokenDance

- `deepseek-v4.1-flash`（**DeepSeek V4.1 Flash**）加入该分组：按该网关公开的目录 API，1,000,000
  Token 上下文窗口、支持图像输入，价格 CNY 0.04 / 2 / 8。
- 这里售卖的两条 DeepSeek Flash 条目——新条目与 `deepseek-v4-flash-vision-exp`——都沿用厂商自己的峰谷
  时段规则，而不是网关的固定折扣。`vision-exp` 由固定的 CNY 0.05 / 1.5 / 4.5 改为高峰档
  CNY 0.04 / 2 / 8，并声明该时段规则。
- 截至 2026-09-10 的促销折扣率（牌价不变）：`deepseek-v4-flash-0731` 与 `deepseek-v4-pro-0813` 为八折
  （原五折），`glm-5.3-flash` 为九折（其五折已于 2026-09-09 24:00 结束）。`kimi-k3` 仍为八折，
  `glm-5.3` 与 `qwen3.8-max` 仍为九折，三条 Doubao Seed 条目仍为五折。
- 三条 Seed 条目改用卖家自己的写法展示：**Seed-2.1-Pro**、**Seed-2.1-Turbo**、**Seed-Evolving**。

## OpenRouter

`deepseek/deepseek-v4.1-flash` 加入该分组，位于 DeepSeek 一段的开头：1,048,576 Token 上下文窗口、
支持图像输入，每百万 Token USD 0.006 / 0.3 / 1.2。这个基础价就是高峰档——该条目自身的
`pricing.overrides` 会在周末以及工作日 UTC 01:00–04:00 / 06:00–10:00 之外正好按半价计费，也就是
DeepSeek 的那套北京时间窗口——因此条目落盘高峰价并声明同一套时段规则，与直连条目一致。

`deepseek/deepseek-v4-flash-vision-exp` 条目注释中「价格取空闲档」的过时说法已更正：该条目的接口列表
中并无 overrides，条目保留 API 公布的固定价格。

## 存量 Project

预置模型在 Project 创建时复制进 `.project_config.toml`，此后不会被改写，因此本次改动不会自行到达存量
Project。模型页的**同步预置**会追加 `deepseek-flash`，并更新发生变动条目中由目录掌管的字段；它不做
删除，因此在 `deepseek-v4.1-flash` 处于预先登记状态期间创建的 dev-data Project 会一直保留那条过时
条目，需手工移除；它也不触碰已存的默认模型——存量 Project 仍按原先的模型开启会话。由于价格发生变化
且新增了条目，存量 Project 都会看到预置更新角标，直到它同步或忽略为止。
