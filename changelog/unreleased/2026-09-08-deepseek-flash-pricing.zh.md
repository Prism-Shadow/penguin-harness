# DeepSeek V4 Flash 条目改用 2026-09-10 生效的价格

- **Date:** 2026-09-08
- **Type:** fix
- **Scope:** `core`, `docs`

[English](2026-09-08-deepseek-flash-pricing.md)

DeepSeek 调整了 V4 Flash 系列的价格，自北京时间 2026-09-10 12:00 生效。目录中两条 V4 Flash 直连
条目已于 2026-09-08 重新读取，现记录高峰档 CNY 0.04 / 2 / 8（缓存命中 / 缓存未命中 / 输出，每百万
Token）；其空闲档正好减半——0.02 / 1 / 4——由每条已声明的时段规则在读取时应用。

## 细节

- `deepseek` 分组中的 `deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp` 由 CNY 0.1 / 3 / 9
  改为 CNY 0.04 / 2 / 8。DeepSeek 对视觉版本发布的就是 V4 Flash 自身的价格，因此两条保持一致。
  按目录 7:1 的存储约定，即每百万 Token USD 0.005714 / 0.285714 / 1.142857。
- 落盘的仍是高峰价，`offPeakDiscount: DEEPSEEK_OFF_PEAK` 不变，因此在北京时间周一至周五
  9:00–12:00、14:00–18:00 之外各档价格照旧减半——减免发生在读取价格时，而不是写入时。
- `deepseek-v4-pro` 保持 CNY 0.3 / 9 / 27，本次调整只覆盖 Flash 系列。
- 转售 DeepSeek 的网关条目——OpenRouter、Fireworks AI、SiliconFlow、TokenDance 以及两个 Qwen
  分组——维持原样。每一条记录的是各自卖家的收费，而不是厂商牌价。
- 配置文档中示意用的 `[[models]]` 代码块同步改为新数字。

## 存量 Project

预置模型在 Project 创建时复制进 `.project_config.toml`，此后不会被改写，因此存量 Project 保持
自己存下的价格；新价格只能通过模型页的**同步预置**到达。在同步之前，仍持有旧高峰价的 Project 既
不会在成本中心得到峰谷拆分，也不会在模型页看到 `-50%` 标记：两者都只在存盘价等于目录当前高峰价时
生效（`packages/server/src/services/project-config-service.ts` 中的 `tieredRates`、
`packages/web/src/features/models/model-grouping.ts` 中的 `discountedPrice`）。由于价格发生了
变化，持有这两条中任意一条的 Project 会看到预置更新角标，直到它同步或忽略为止。
