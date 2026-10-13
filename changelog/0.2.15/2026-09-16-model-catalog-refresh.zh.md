# 模型目录刷新：DeepSeek 只留官方列出的两个模型、Qwen 自己的空闲时段规则、新增网关条目

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `docs`, `skills`
- **PR:** [#749](https://github.com/Prism-Shadow/penguin-harness/pull/749)

[English](2026-09-16-model-catalog-refresh.md)

内置模型目录于 2026-09-16 对照各供应商重新读取。直连 DeepSeek 分组精简为 DeepSeek 价格页列出的两个模型，TokenDance 的三项促销改了折扣率，OpenRouter、Fireworks AI、SiliconFlow 与两个 Qwen 分组新增条目，Qwen 转售的 DeepSeek 模型改按 Qwen 自己的高峰 / 空闲时段计价——这是目录里的第二套时段规则。下文价格均为每百万 Token，顺序为缓存命中 / 输入 / 输出。

## DeepSeek 分组

- `deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp` 不再作为预置条目。DeepSeek 仍接受这两个名称、由 V4.1 Flash 承接并按 Flash 价计费，但其价格页只列出 `deepseek-flash` 与 `deepseek-v4-pro`。两者作为退役条目留在目录中（见[向后兼容](2026-09-16-backward-compatibility.zh.md)）。
- `deepseek-v4-pro` 的显示名改为 **DeepSeek V4 Pro 0813**，即 DeepSeek 为该 id 标注的版本。高峰价仍为 CNY 0.30 / 9 / 27，沿用 DeepSeek 的空闲时段规则；DeepSeek 表示 V4 Pro 在 2026-09-14 之后继续提供，计费不变。
- `deepseek-flash` 与默认模型保持原样。

## TokenDance 分组

- `deepseek-v4-flash-vision-exp` 不再作为预置条目，与 DeepSeek 那两条一样作为退役条目留在目录中。
- 按卖家 2026-09-16 的报价调整三项促销。`deepseek-v4-flash-0731` 牌价 CNY 0.15 / 1.5 / 4.5、九折，实收 0.135 / 1.35 / 4.05。`deepseek-v4-pro-0813` 牌价 CNY 0.45 / 4.5 / 13.5、九折，实收 0.405 / 4.05 / 12.15。`kimi-k3` 牌价 CNY 1.6 / 20 / 100、六折，实收 0.96 / 12 / 60。

## OpenRouter 分组

- 新增 `qwen/qwen3.8-27b`（**Qwen 3.8 27B**），USD 0.15 / 0.214 / 2.55，上下文窗口 1,000,000 Token，支持图像输入。

## Fireworks AI 分组

- 新增 `accounts/fireworks/models/deepseek-v4p1-flash`（**DeepSeek V4.1 Flash**，支持图像输入），USD 0.007 / 0.22 / 0.66；以及 `accounts/fireworks/models/deepseek-v4-pro-0813`（**DeepSeek V4 Pro 0813**），USD 0.044 / 1.32 / 3.96。两者上下文窗口均为 1,048,576 Token。
- 新增 `accounts/fireworks/models/glm-5p3`（**GLM-5.3**），USD 0.26 / 1.4 / 4.4；以及 `accounts/fireworks/models/glm-5p3-flash`（**GLM-5.3 Flash**，支持图像输入），USD 0.03 / 0.15 / 0.5。两者上下文窗口均为 1,048,576 Token。
- 新增 `accounts/fireworks/models/qwen3p8-max`（**Qwen 3.8 Max**，支持图像输入），USD 0.25 / 2 / 6，上下文窗口 1,000,000 Token。

## SiliconFlow 分组

- 新增 `tencent/Hy4-preview`（**Hy4 preview**），CNY 0.3 / 6 / 18，上下文窗口 1,024,000 Token；以及 `zai-org/GLM-5.3`（**GLM-5.3**），CNY 2 / 8 / 28，上下文窗口 1,000,000 Token。两者均为纯文本。

## Qwen 按量付费分组

- 新增 `deepseek-v4.1-flash`（**DeepSeek V4.1 Flash**，支持图像输入），按 Qwen 的空闲时段规则计价；`kimi/kimi-k2.8-preview`（**Kimi K2.8 Preview**，支持图像输入），CNY 1.7 / 6.5 / 27，上下文窗口 1,048,576 Token；以及 `ZHIPU/GLM-5.3-Flash`（**GLM-5.3 Flash**，支持图像输入），CNY 0.23 / 0.8 / 2.8。
- 移除 `deepseek-v4-flash-0731` 与 `ZHIPU/GLM-5.2`。
- `qwen3.8-flash` 改为 Qwen 的新牌价 CNY 0.1 / 0.8 / 2.7（原为 0.1 / 1 / 3）。

## Qwen Token Plan 分组

- 新增 `deepseek-v4.1-flash`（**DeepSeek V4.1 Flash**，支持图像输入）与 `deepseek-v4-pro-0813`（**DeepSeek V4 Pro 0813**，纯文本），两者都按 Qwen 的空闲时段规则计价；`glm-5.3`（**GLM-5.3**），CNY 2 / 8 / 28，上下文窗口 1,048,576 Token；以及 `qwen3.8-flash`（**Qwen 3.8 Flash**，支持图像输入），CNY 0.1 / 0.8 / 2.7。
- 移除 `deepseek-v4-flash-0731`、`deepseek-v4-pro` 与 `glm-5.2`。

## Qwen 的空闲时段规则

- 目录新增第二套分时段规则 `QWEN_OFF_PEAK`：每周七天，北京时间 22:00 至次日 08:00 半价，取自 Qwen 各模型页的高峰价与空闲价两个标签页。采用该规则的三条条目存高峰价：两个 Qwen 分组的 `deepseek-v4.1-flash` 为 CNY 0.2 / 2 / 8（空闲时 0.1 / 1 / 4），Token Plan 分组的 `deepseek-v4-pro-0813` 为 CNY 0.9 / 9 / 27（空闲时 0.45 / 4.5 / 13.5）。成本中心按每条用量记录自己的时间戳对照这些窗口计价，与 DeepSeek 的时段规则相同。
- 模型页空闲时段折扣徽标的悬停说明，原先对所有分时段条目都写 DeepSeek 的工作日窗口。现在两套词典都按该条目自己的时段规则拼出窗口：Qwen 条目显示北京时间每天 8:00–22:00，DeepSeek 条目保留原来的工作日说明。

## 既有 Project

预置条目在创建 Project 时复制进去；模型页的**同步预置**会加入新增条目并更新价格，但从不删除：本次移除的条目会留在既有 Project 中，直到用户自己删掉。三条退役的 DeepSeek 条目在这些 Project 中照旧显示名称，**同步预置**会继续更新它们的价格、但从不把它们补进没有它们的 Project，因此行上存的是目录价时按空闲时段计价（见[向后兼容](2026-09-16-backward-compatibility.zh.md)）；被移除的 Qwen 条目保留其存储价格，显示原始模型 id。新显示名 **DeepSeek V4 Pro 0813** 无需同步即可出现在各 Project 中，除非该 Project 为 `deepseek-v4-pro` 存有自己的名称——同步从不覆盖这类名称。
