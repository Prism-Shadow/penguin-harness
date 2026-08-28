# TokenDance 排在模型页首位，促销条目显示实际价格

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `web`, `cli`, `docs`

[English](2026-08-28-catalog-tokendance-discounts.md)

腾讯 Hy4 preview 经两个卖家一并收录进目录；六个 TokenDance 条目声明了折扣，模型页据此展示、
成本中心据此计价；TokenDance 成为官方推荐分组并默认排在首位；中文界面重命名了三个价格档位。

## 模型目录

- OpenRouter 分组新增 `tencent/hy4-preview`：1,048,576 Token 上下文，纯文本，每百万 Token
  $0.834 输入 / $2.501 输出 / $0.042 缓存命中。
- TokenDance 分组新增 `hy4-preview`：同一个上游模型经第二个卖家提供，按该网关自己的 CNY
  6 / 18 / 0.3（输入 / 输出 / 缓存命中）计价，上下文 1,024,000 Token。每条记录各自卖家的
  收费，因此这一对与两条 `qwen3.8-flash` 一样必须保持分开。
- 目录条目新增 `discount` 字段：卖家在牌价基础上正在执行的折扣率。无论促销是否进行，
  `pricing` 始终是牌价，由新增的 `effectivePricing()` 应用折扣。六个 TokenDance 条目声明了
  折扣——`deepseek-v4-flash-0731`、`deepseek-v4-pro-0813` 与 `glm-5.3-flash` 五折，
  `kimi-k3` 八折，`glm-5.3` 与 `qwen3.8-max` 九折。
- 修正 TokenDance 分组中 `deepseek-v4-flash-0731` 与 `deepseek-v4-pro-0813` 的牌价——此前把
  促销价当作了牌价：两者各翻一倍，改为 CNY 0.1 / 3 / 9 与 CNY 0.3 / 9 / 27
  （缓存命中 / 输入 / 输出），使五折后正好等于 TokenDance 的实际收费。
- `presetModelEntries()` 现在向 Project 写入折后价而非牌价，促销条目因此按实际计费价核算成本。

## 模型页

- TokenDance 被标记为官方推荐分组：默认排在分组顺序首位，其上方显示「官方推荐」字样，
  并且是首次访问时默认展开的分组。
- 折扣中的模型卡片显示折后价，旁边划掉牌价，并以徽标标出折扣率。价格已被改成与目录不同的
  条目则两者都不显示。

## 中文价格标签

中文界面中三个价格档位显示为 `缓存命中` / `缓存未命中` / `输出`——包括模型页的价格字段、
成本中心的 Token 档位与图例，以及 CLI `penguin config model add` 的价格选项。英文标签不变，
字段名、类型名与协议键名同样不变。

## 存量 Project

预置模型在 Project 创建时复制进 `.project_config.toml`，此后不会被改写，因此上述价格改动
不会自行到达存量 Project，只能通过模型页的**同步预置**获得：同步会把六个促销中的
TokenDance 条目下调到实际计费价；修正后的 DeepSeek 牌价同样只有在同步后才会到达存量
Project。默认分组顺序与首次访问展开的分组都只是默认值：拖动过分组标题、或展开/折叠过分组的
Project 保持自己的排列不变。
