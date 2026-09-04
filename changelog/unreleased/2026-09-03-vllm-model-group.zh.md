# 模型目录新增 vLLM 分组，协议由分组钉死

- **Date:** 2026-09-03
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`

[English](2026-09-03-vllm-model-group.md)

模型目录新增 **vLLM** 分组，位置紧挨在 Custom 之前，收录 AgentHub `openai-chat-vllm-adapter` 客户端为其
逐模型映射思考开关的八个模型：`Qwen/Qwen3.8-Flash-Next`、`Qwen/Qwen3.8-27B`、
`Qwen/Qwen3.6-35B-A3B`、`Qwen/Qwen3.5-0.8B`、`Qwen/Qwen3.5-9B`、`deepseek-ai/DeepSeek-V4-Pro`、
`deepseek-ai/DeepSeek-V4-Flash` 与 `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp`。

它们都是自托管模型，分组的形态由此而来。各行**价格全为 0**——服务由用户自己跑，没有谁按 token 收费，
真正的开销是运维者自己的硬件，那不是任何牌价能表达的。这里的 0 是真实费率而非缺失：这些行会显示免费
徽标，并在成本中心计为 0，与既有的 `:free` 网关行同一口径。也**不预置 base URL**：每个部署各有各的地址，
与 Custom 分组一样由用户填写。上下文窗口取 `recipes.vllm.ai` 记载的各模型原生长度（Qwen 各行
262,144，DeepSeek V4 各行 1,000,000）；以更小的 `--max-model-len` 启动的部署实际供给更少，条目的
上下文窗口可改。

分组图标取 vLLM 官方标识（来自项目的 media kit），并像既有的 Qwen 渐变字标一样，把它的两种品牌色
压成 `currentColor`——各家 provider 图标是同一族单色标，一行看过去才是一套。

## 协议是分组的属性

`ModelProviderInfo` 新增 `clientType` 字段：该分组下每个条目所用的协议，用户自行新增的模型同样适用。
目前只有 vLLM 声明它，读取一律经 `providerClientType`，使各处对「这个模型该落哪个协议」给出同一个答案：

- 在该分组新增模型预选 `openai-chat-vllm-adapter` 而非通用的 `openai-chat`，弹窗直接点名协议，不再给出选择器；
- 把既有条目移入该分组即改写为这一协议；
- 不做探测的那几条保存路径（设为默认、设为视觉代理、删除）的兜底协议就是它，协议检测整个跳过——分组已经知道答案；
- API key 的环境变量提示按它解析，因此该分组下的 `deepseek-ai/DeepSeek-V4-Pro` 报 `OPENAI_API_KEY`，
  而不是其 id 本会路由到的 DeepSeek 变量；
- `penguin config model add --provider vllm` 为新条目缺省落这一协议。

预置行同样依赖这个钉子：`Qwen/*` 匹配不上 AgentHub 的任何路由规则、会被直接拒绝，而
`deepseek-ai/DeepSeek-V4-*` 含有 `deepseek-v4`，否则会走到 DeepSeek 的一方客户端上——却指着一台
vLLM 服务。

## AgentHub 依赖升至 0.4.10

`openai-chat-vllm-adapter` 首次随 `@prismshadow/agenthub` 0.4.10 发布（agenthub
[#197](https://github.com/Prism-Shadow/agenthub/pull/197)、
[#198](https://github.com/Prism-Shadow/agenthub/pull/198)），因此 `packages/core` 与
`packages/cli` 的依赖从 `^0.4.9` 升到 `^0.4.10`。在 0.4.9 上，该客户端类型并不存在，本分组下的模型
会在发起请求时以 AgentHub 的 `"openai-chat-vllm-adapter is not supported"` 失败。
`pnpm-workspace.yaml` 中的 `minimumReleaseAgeExclude` 条目按其注释的约定移到新版本。
