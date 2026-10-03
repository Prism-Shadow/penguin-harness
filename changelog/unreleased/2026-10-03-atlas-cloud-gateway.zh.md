# 新增 Atlas Cloud 网关分组

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `model-catalog`, `ui`, `web`, `docs`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)

[English](2026-10-03-atlas-cloud-gateway.md)

[Atlas Cloud](https://atlascloud.ai/) 作为 OpenAI 兼容网关加入内置分组，默认顺序排在 SiliconFlow 与 Z.AI 之间。其条目通过预置 base URL `https://api.atlascloud.ai/v1` 走 MMSP 通用的 Chat Completions 客户端，与 Fireworks AI、SiliconFlow、TokenDance 和两个 Qwen 网关分组同路，因此无需新增客户端。与所有网关分组一样，它记录的是其客户端读取的 `OPENAI_API_KEY` / `OPENAI_BASE_URL` 这一对变量，而其中没有 key 的条目会被拒绝回退：key 要配在条目上。下文价格均为每百万 Token，顺序为缓存命中 / 输入 / 输出。

## 条目

上下文窗口与美元价格于 2026-10-03 读自该网关的公开目录 API（`GET https://api.atlascloud.ai/v1/models`，无需凭据）。Atlas Cloud 只公布一个输入价和一个更低的缓存命中价，没有单独的缓存写入费，因此 `cache_write` 存的是输入价，与 TokenDance 和 Qwen 的条目一致。模型 id 保留厂商前缀，与 SiliconFlow、ModelScope 相同。三条均为纯文本。

- `deepseek-ai/DeepSeek-V3.1-Terminus`（**DeepSeek V3.1 Terminus**），USD 0.13 / 0.3 / 0.95，上下文窗口 131,072 Token。
- `deepseek-ai/DeepSeek-V3.1`（**DeepSeek V3.1**），USD 0.13 / 0.3 / 0.95，上下文窗口 131,072 Token。
- `Qwen/Qwen3-235B-A22B-Instruct-2507`（**Qwen3-235B-A22B-Instruct-2507**），USD 0.2 / 0.2 / 0.88，上下文窗口 131,072 Token。这一条 Atlas Cloud 的缓存命中价与输入价相同，因此两个价格桶一致。

## 既有 Project

预置条目在创建 Project 时复制进去，因此新建的 Project 立即带上该分组。既有 Project 可通过模型页的**同步预置**加入这些条目。
