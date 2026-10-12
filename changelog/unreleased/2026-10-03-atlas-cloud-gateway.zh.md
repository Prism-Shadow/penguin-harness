# 新增 Atlas Cloud 网关分组

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `model-catalog`, `ui`, `web`, `docs`, `plugins`
- **PR:** [#959](https://github.com/Prism-Shadow/penguin-harness/pull/959)

[English](2026-10-03-atlas-cloud-gateway.md)

[Atlas Cloud](https://atlascloud.ai/) 作为 OpenAI 兼容网关加入了内置分组，默认顺序排在 SiliconFlow 与 Z.AI 之间。其条目通过预置 base URL `https://api.atlascloud.ai/v1` 走 MMSP 通用的 Chat Completions 客户端，与 Fireworks AI、SiliconFlow、TokenDance 和两个 Qwen 网关分组同路，因此无需新增客户端。与 SiliconFlow 一样，该分组固定 `openai-chat` 协议并接受手动添加的模型（分组头的**添加模型**、`penguin config model add --provider atlascloud`），添加的模型跟随分组的端点与协议：该网关提供的模型远多于目录预置的条目。`penguin-config` 技能（`2026.10.11.1`）把 `atlascloud` 列入可手动添加模型的分组。与所有网关分组一样，它记录的是其客户端读取的 `OPENAI_API_KEY` / `OPENAI_BASE_URL` 这一对变量，而其中没有 key 的条目会被拒绝回退：key 要配在分组或条目上。下文价格均为每百万 Token 的美元价，顺序为缓存命中 / 输入 / 输出。

## 条目

模型 id、上下文窗口、输入模态、量化精度与价格于 2026-10-11 读自该网关的公开目录 API（`GET https://api.atlascloud.ai/v1/models`，无需凭据）。其价格以每 Token 美元计；定价页（`https://www.atlascloud.ai/pricing/models`）按每百万 Token 标出同样的价格。所选条目是其他网关分组预置的 DeepSeek 与 Qwen 模型。DeepSeek 取 TokenDance 预置的那些版本，而非不带日期的 V4 id，且只取 Atlas Cloud 以 fp8 提供的：V4.1 Flash 与 V4 Pro 0813。它的 V4 Flash 0731 与不带日期的 `deepseek-ai/deepseek-v4-flash`、`deepseek-ai/deepseek-v4-pro` 一样以 fp4 提供，三者都没有成为预置。Atlas Cloud 没有为这些条目公布缓存写入价，因此 `cache_write` 存的是输入价，与 TokenDance 和 Qwen 的条目一致。两条 DeepSeek 条目全天按同一固定价格计费，没有空闲时段折扣。模型 id 保留厂商前缀，与 SiliconFlow、ModelScope 相同。

- `deepseek-ai/deepseek-v4.1-flash`（**DeepSeek V4.1 Flash**，fp8），USD 0.03 / 0.3 / 1.2，上下文窗口 1,048,576 Token，支持图片输入。
- `deepseek-ai/deepseek-v4-pro-0813`（**DeepSeek V4 Pro 0813**，fp8），USD 0.132 / 1.32 / 3.96，上下文窗口 1,048,576 Token，纯文本。
- `qwen/qwen3.6-35b-a3b`（**Qwen 3.6 35B A3B**，fp8），牌价 USD 0.248 / 0.248 / 1.485，促销打 7.5 折，实收 0.186 / 0.186 / 1.11375；上下文窗口 262,144 Token，支持图片输入。Atlas Cloud 没有为这一条公布缓存命中价，因此缓存命中与输入两个价格桶一致。

## 既有 Project

预置条目在创建 Project 时复制进去，因此新建的 Project 立即带上该分组。既有 Project 可通过模型页的**同步新增模型**加入这些条目，同时写入该分组的端点与协议，以及 Qwen 条目的促销折扣。
