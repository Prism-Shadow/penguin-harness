# 向后兼容

- **Date:** 2026-09-16
- **Type:** process
- **Scope:** `model-catalog`
- **PR:** [#749](https://github.com/Prism-Shadow/penguin-harness/pull/749)

[English](2026-09-16-backward-compatibility.md)

[模型目录刷新](2026-09-16-model-catalog-refresh.zh.md)不再提供三条既有 Project 仍带着的条目：`deepseek/deepseek-v4-flash`（0.2.0 到 0.2.8 新建 Project 的默认模型）、`deepseek/deepseek-v4-flash-vision-exp`（0.2.9 的默认模型）与 `tokendance/deepseek-v4-flash-vision-exp`。**同步预置**从不删除条目，所以这些 Project 会一直留着它们。

## 直接删除会坏在哪里

成本在读取时计算，条目的空闲时段档位来自它在目录里的条目。直接删掉这三条，会让它们上面每一条空闲时段的用量记录（包括过去的记录）都按高峰价计价（最多是 DeepSeek 实收的两倍），空闲时段徽标消失，名称处显示成原始模型 id。

## 做了什么

三条条目留在目录中并标记为 `retired`。退役条目不是预置条目：新建 Project 不会带上，**同步预置**既不补也不更新。按键查询仍能查到，所以带着它的 Project 照旧显示名称、视觉标注，并按空闲时段计价。磁盘上的数据没有任何改动。

## 用户需要做什么

什么都不用做。只要 DeepSeek 仍接受这些旧 id，Project 就可以继续使用；也可以换成 `deepseek-flash`（DeepSeek V4.1 Flash）并删掉旧条目。

## 何时可以移除

退役条目只有在卖家不再接受该 id 之后才能删除，并且必须在发布说明里写明：从此以后，记在它上面的用量不再按空闲时段档位计价。由发现该 id 已被拒绝的那次目录刷新决定。
