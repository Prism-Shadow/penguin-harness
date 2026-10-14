# 模型库：恢复默认只保留 API key

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1093](https://github.com/Prism-Shadow/penguin-harness/pull/1093)

[English](2026-10-13-model-restore-defaults.md)

模型库页面的**恢复默认**现在把模型配置恢复成新建 Project 时的样子，只保留 API key。

## 细节

- 删除：所有非预置模型（用户在任何分组里添加的，以及旧版目录添加、后来被撤下的，含退役条目）和用户新建的分组，连同它们的设置、key 与促销折扣。
- 恢复：预置模型按目录顺序排列，删掉的补回；所有内置分组的设置，包括 Custom 和 vLLM 的 base URL；促销折扣；默认模型改为目录默认。视觉代理模型清除。
- Penguin Go 与其他分组一样恢复：平台在预置之外添加的模型和它的促销会被删除，用**同步模型**即可取回。
- 保留：内置分组和预置模型上的 key 原样不动。内置分组没有分组密钥时，被删除的模型与组内其他带 key 模型共用的 key，或它独有的 key，移到分组上。
- 现在或曾经是新建 Project 默认模型的模型，行被删除后（无论经恢复默认还是手动删除），此前的用量照旧计价：这几条目录条目（DeepSeek 的 `deepseek-flash`、`deepseek-v4-pro`，以及已退役的 `deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp`）带 `wasDefault` 标记，成本中心、会话成本和对话里单轮的成本都回退到它们的目录价。其他被删除模型的用量照旧报为未计价。
- 确认框改为一段短文，结果提示不再报条数。
