# 模型目录新增 vLLM 分组，协议由分组钉死

- **Date:** 2026-09-03
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`

[English](2026-09-03-vllm-model-group.md)

模型目录新增 **vLLM** 分组，位置紧挨在 Custom 之前，收录 AgentHub `vllm-openai-chat` 客户端为其
逐模型映射思考开关的八个模型：`Qwen/Qwen3.8-Flash-Next`、`Qwen/Qwen3.8-27B`、
`Qwen/Qwen3.6-35B-A3B`、`Qwen/Qwen3.5-0.8B`、`Qwen/Qwen3.5-9B`、`deepseek-ai/DeepSeek-V4-Pro`、
`deepseek-ai/DeepSeek-V4-Flash` 与 `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp`。

它们都是自托管模型，分组的形态由此而来。各行**不带定价**——服务由用户自己跑，既无卖家也无牌价，
因此该字段是缺省而非写 0：三桶全 0 是真正的免费档。也**不预置 base URL**：每个部署各有各的地址，
与 Custom 分组一样由用户填写。上下文窗口取 `recipes.vllm.ai` 记载的各模型原生长度（Qwen 各行
262,144，DeepSeek V4 各行 1,000,000）；以更小的 `--max-model-len` 启动的部署实际供给更少，条目的
上下文窗口可改。

## 协议是分组的属性

`ModelProviderInfo` 新增 `clientType` 字段：该分组下每个条目所用的协议，用户自行新增的模型同样适用。
目前只有 vLLM 声明它，读取一律经 `providerClientType`，使各处对「这个模型该落哪个协议」给出同一个答案：

- 在该分组新增模型预选 `vllm-openai-chat` 而非通用的 `openai-chat`，弹窗直接点名协议，不再给出选择器；
- 把既有条目移入该分组即改写为这一协议；
- 不做探测的那几条保存路径（设为默认、设为视觉代理、删除）的兜底协议就是它，协议检测整个跳过——分组已经知道答案；
- API key 的环境变量提示按它解析，因此该分组下的 `deepseek-ai/DeepSeek-V4-Pro` 报 `OPENAI_API_KEY`，
  而不是其 id 本会路由到的 DeepSeek 变量；
- `penguin config model add --provider vllm` 为新条目缺省落这一协议。

预置行同样依赖这个钉子：`Qwen/*` 匹配不上 AgentHub 的任何路由规则、会被直接拒绝，而
`deepseek-ai/DeepSeek-V4-*` 含有 `deepseek-v4`，否则会走到 DeepSeek 的一方客户端上——却指着一台
vLLM 服务。

## 需要携带该客户端的 AgentHub 版本

`vllm-openai-chat` 不在 `@prismshadow/agenthub` 0.4.9 中——本仓库依赖的正是它，也是当前最新的已发布
版本；该客户端位于 AgentHub 尚未发布的分支上（agenthub
[#197](https://github.com/Prism-Shadow/agenthub/pull/197)、
[#198](https://github.com/Prism-Shadow/agenthub/pull/198)）。在依赖升到包含它的版本（0.4.10 或更高）
之前，该分组下的模型会在发起请求时以 AgentHub 的 `"vllm-openai-chat is not supported"` 失败。
