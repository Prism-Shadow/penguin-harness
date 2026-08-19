# 按模型设置的快速模式

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#326](https://github.com/Prism-Shadow/penguin-harness/pull/326)

[English](2026-08-18-model-fast-mode.md)

模型条目新增一项可选的快速模式设置：开启后，该模型的会话请求进入厂商更快的推理档位，按溢价计费，由 AgentHub 的 UniConfig `fast_mode` 承载（agenthub [#171](https://github.com/Prism-Shadow/agenthub/pull/171)）——OpenAI 协议 client 发送 `service_tier: "priority"`，Anthropic 协议 client 发送 `speed: "fast"` 并附带 fast-mode beta 请求头。默认关闭，且只会持久化 `true`（条目上的 `fast_mode = true`），既有配置不受影响。开关只在模型所解析出的 AgentHub client 确实能提供快速档位时才出现；打开它会先要求确认，因为快速模式按溢价计费；而模型若仍然拒绝这个参数，本次运行会立即失败并给出可操作的提示，而不是继续重试。

## Core

`fastModeProtocol(modelId, clientType?, baseUrl?)`（`state/model-catalog.ts`，与 `resolveModelEnv` 相邻）回答一个模型究竟能否携带快速模式、以及走哪种协议——发送 `service_tier` 的那些 client 返回 `"openai"`，发送 `speed` 的返回 `"anthropic"`，其余返回 `undefined`。它不是列举模型，而是照搬 AgentHub 中 `AutoLLMClient` 的分支顺序，因此日后新增的目录条目能自动得到正确答案：路由先看 `client_type`，未设置时看 model id（后者与 Provider 分组并不总是一致），claude5 的两处例外——`bedrock://` 的 base URL，以及 id 中含 `4-6`——则与 client 一样，对着原始条目判定。AgentHub 根本无法路由的 id 同样返回 `undefined`：没有 client，就没有快速档位。

`ModelEntry.fast_mode` 经 `GenerativeModelConfig.fastMode` 传入 `buildUniConfig`，只有在开启时才写入 `UniConfig.fast_mode`——否则这个字段根本不会出现在请求里。它跟随会话 LLM，压缩重建也包含在内；裸 LLM / meta LLM（标题生成）与 `describe_image` 代读则不带它，因此当注解开在一个会拒绝该参数的模型上时，这些后台请求照常工作。

没有快速档位的 AgentHub client（Gemini、GLM、Kimi、DeepSeek、`openai_embedding`，以及走 Bedrock 或 Claude 4.6 id 的 claude5）会在任何网络 I/O 之前抛出 `UnsupportedParameterError`。`GenerativeModel` 能识别这一种确定性的拒绝——限定在 `parameter === "fast_mode"`，且仅当自身配置开启了快速模式时——并以 `failed` 上报，附带新增的 `LLMOutcome.permanent: true` 标记，以及一句点明处理方式的提示（"… turn it off in the model settings …"）。引擎遇到永久性失败会立即中止本次运行，终止方式与 `auth` 相同，但不会锁住输入，也不再播报重试倒计时。其余失败仍沿用「除 auth 外一律重试」的策略。

## Server

`ModelInfo` / `ModelUpdateEntry` 新增 `fastMode`：GET 只对带有该注解的条目返回 `true`，PUT 也只持久化 `true`，因此在整表替换的语义下，省略该字段或传 `false` 即为清除注解。`POST /models/test` 接受 `fastMode` 覆盖值，未传时回退到已存的注解，于是连通性测试所走的档位与会话请求完全一致，能在保存前暴露快速模式被拒的问题。

## Web App

模型对话框新增「快速模式」开关，默认关闭，且只对路由后的 AgentHub client 能提供该档位的模型渲染——`fastModeState` 依表单的实时取值重算，因此编辑 id、协议或 base URL 时，开关会随输入即时增减。它与视觉开关采用同样的行内 switch 形态，并与之共处一行——用的就是对话框里上下文窗口与最大输出 Token 那对字段已有的两列栅格；处于开启状态时带一行提示（同时作为标签的悬停 title），说明这是以溢价换更快的输出，而条目记录的价格仍按标准档。两个开关都不是一定会出现的：预设模型的视觉标记来自内置目录，只读不可改；快速模式则在 client 不接受该参数时不予提供。因此两个都不适用时整行不渲染，只剩一个时它独占整行宽度，而不是缩在半格里（`capabilityRow`）。

**打开**它会先弹出确认（复用共享的 `ConfirmModal`，与保存、删除一样叠在对话框之上）：溢价计费——MiniMax 为标准价的 1.5 倍，OpenAI 与 Anthropic 另有溢价价目表——条目记录的按 Token 单价不会随之调整，因此成本中心会低估这部分用量；Anthropic 协议的模型还会多一条提示：那边的快速模式是限量的 research preview，在组织获得授权之前请求会返回 429。**关闭**它仍是一键完成；而已经存有 `fast_mode = true` 的条目，即便按规则本不该出现开关也会保留它，并标注为不受支持，好让运行时那句「turn it off in the model settings」始终成立。

模型列表中，开启了快速模式的模型带有角标。连通性测试发送对话框当前的开关状态；预设同步把快速模式视为用户所有，从不覆盖；相关文案中英文都已提供。

## CLI

`penguin config model add` 新增三态的 `--fast-mode` / `--no-fast-mode`：两个都不给则保持原值，`--no-fast-mode` 是清除已存的注解，而不是写入 `false`。若在一个 client 会拒绝该参数的模型上开启，命令仍会写入条目，但在 stderr 上给出警告并点名 `--no-fast-mode`——条目完全可能指向一个从配置里看不出其能力的端点。

## Docs

中英文模型页新增「快速模式」小节：语义、条目记录的按 Token 单价并不反映的溢价计费、按 client 划分的支持情况表格及其背后的路由规则、开关无法替你检查的两件事（Anthropic 的 research preview 429，以及服务端环境变量 `CLIENT_TYPE` / `ANTHROPIC_BASE_URL` 会覆盖条目配置），以及被排除在外的后台请求。configuration、CLI、web-app 与 interfaces 各页也记录了新增字段、命令行参数、开关及其确认弹窗，还有 `LLMOutcome.permanent`。

## 成本统计

用量记录里没有任何字段记下请求实际走的档位，成本仍在查询时依条目那一组三档价格计算，因此只要快速模式处于开启状态，各处成本展示——用量卡片、趋势图、对话头部的成本小标、Trace 查看器——都会低估该模型的花费。按档位定价留待后续处理；当前由确认弹窗与模型文档把这一缺口说明清楚。
