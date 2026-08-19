# 自定义模型：按 base URL 检测协议

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `model-catalog`
- **PR:** [#324](https://github.com/Prism-Shadow/penguin-harness/pull/324)

[English](2026-08-18-custom-model-protocol-detect.md)

Custom 与自建分组不再被钉死在单一协议上：新建自定义模型默认不选择协议，Web 对话框新增「检测协议」操作，探测某个自定义 base URL 实际提供的是 AgentHub 0.4.2 中的哪一个通用协议客户端，并把结果写入该条目的 `client_type`。探测顺序固定为先 `openai-responses`（OpenAI Responses API）、再 `ant-messages`（Anthropic Messages API）、最后 `openai-chat`（Chat Completions；裸写的 `openai` 仍是它的别名），命中第一个即止。

## Server

- 新增 `POST /api/projects/:id/models/detect`（仅 owner）：按上述顺序依次探测 base URL——所用路径与鉴权头，与 AgentHub 各客户端实际构造的完全一致（`POST {base}/responses` 和 `POST {base}/chat/completions` 带 `Authorization: Bearer`；`POST {base}/v1/messages` 带 `x-api-key` + `Authorization: Bearer` + `anthropic-version`）——在端点真正提供的第一个协议处停下，并逐条返回每次探测的结果以便排查。
- 探测发出的是最小化的非法请求（`{}` 请求体，每次 5s 超时，响应体最多读取 64 KiB，遇到疯狂输出的端点直接放弃而不是全部缓冲下来）：不产生任何 Token 计费，不需要 model id，没有 key 也能探——协议自身错误形态的 401/403 就足以证明该路由存在。分类区分四种情形：路由存在（结构化的 API 错误，兼容 OpenAI / Anthropic / vLLM / FastAPI 各家方言）、路由不存在（仅凭 404/405 状态码判定）、网关杂讯（HTML / 非 JSON / 无结构的响应体，以及一律返回 200 的兜底）、以及 5xx（对路径本身什么都证明不了）。与连通性测试一样，可选地附上 `(provider, modelId)` 这对模型引用，就能让已存的密钥为探测提供鉴权；密钥不会出现在 URL、结果或日志中。凭据按三层解析：请求里带的 key，其次配对引用指向的已存密钥，最后是**当前这个探测**所用协议对应的环境变量——`ant-messages` 读 `ANTHROPIC_API_KEY`，两个 OpenAI 协议读 `OPENAI_API_KEY`，走的是保存后模型读取时的同一套 `resolveModelEnv` 映射。之所以逐个探测分别解析，正是因为协议本身还没确定。环境变量只在服务端读取，不会回传浏览器、响应或日志。

## Web App

- 「检测协议」按钮位于 base URL 输入框右上角、与其标签同一行——与 API Key 字段「获取 API key」链接的摆放方式一致——并且始终可点击：不需要填 API Key，探测凭据由服务端自行解析（见下）。检测从此只有两个入口：用户主动点这个按钮，以及下面保存时的兜底。此前 base URL 失焦时的隐式触发已移除——反馈改走 toast 之后，被动触发要么在用户填表途中冒出提示，要么失败了也说不清原因。
- **保存前先检测。** 确认对话框时若协议仍为空，会先跑一次检测，再带着结果继续保存；这段往返期间确认按钮锁定并显示「检测中…」。若探测一无所获，则中止保存，对话框保持打开、由 toast 说明原因，可手动选协议或修正 URL，绝不静默保存。这一步是关键：AgentHub 对无法匹配的 client type 是抛错而非回退默认值，协议为空的条目就是一个起不来的模型。对于不做探测的路径（设为默认 / 设为视觉代理 / 删除），`rowToEntry` 同样保证不会写入空协议；预置与厂商分组条目则仍然保持为空，交给 AgentHub 按 model id 推断。
- **成功与失败都用 toast 提示**——与本对话框里连通性测试用的是同一套非阻塞通道（Toaster 以 `z-[100]` 挂到 `document.body`，高于 Modal 的 `z-50`，因此在对话框内触发的 toast 会显示在它上方）。成功时说明应用了哪种协议；所有失败情形——连不上、超时、网关杂讯、三条路径都没提供、URL 不可用——统一显示同一条简短提示，只讲用户能动手改的两件事：API Key 与 base URL。不再罗列协议名，也不再描述端点做了什么：「端点有响应，但……」会被读成成功。逐个协议的探测结果仍保留在检测接口的响应里，便于排查。成功 toast 只属于手动点击「检测协议」；保存路径上检测成功则静默继续，因为它服务的那次保存会直接进行下去。表单里完全不渲染检测结论：此前 base URL 字段下方那一行已删除，空闲状态与检测之后的布局完全一致。
- **界面上确实没有预选协议，而不只是数据层为空。** 在手动选择或检测生效之前，后缀显示「选择协议」占位文案而非某条路径，菜单中也没有任何一项被勾选（`protocolSelectorValue` 现在对未设置的协议返回 null，而不再映射为 `openai-chat`——此前那样会把 `/chat/completions` 渲染成用户从未做过的选择）。输入框预留的内边距按显示宽度计算，本地化占位文案不会被少留一半。
- 对话框此前就在 base URL 输入框右端内嵌显示协议路径（`/responses`、`/v1/messages`、`/chat/completions`），这次它成了手动协议选择器：原先被动的灰色文字变成输入框内的无边框触发器，列出三种协议及各自追加的路径，并在当前项上打勾，协议选择因此没有占用新的表单行。手动选择不需要 API Key，无需鉴权的端点仍可完全手工配好。
- 后缀实时跟随当前选择，也反映正在进行的检测（转圈；三种协议都没匹配或探测失败时转为琥珀色），且宽度保持不变，输入框为它预留的内边距不会跟着位移。检测结论（「已检测到 OpenAI Responses，已应用」，或未能匹配的原因）只在真正跑过一次之后，才显示在该字段自己的提示行里。
- 此前创建的条目保留已存的值：`openai` 显示为 Chat Completions，在用户手动选择或某次检测生效之前不会被改写；通用家族之外、锁定到特定厂商的 client_type 仍保留只读提示。把模型移动到 Custom 分组现在会保留通用协议客户端类型，而不再像[此前那次分组修复](2026-08-14-model-group-protocol.zh.md)那样强制写成 `openai-chat`。

## Core

- `resolveModelEnv` 把 `ant-messages` 路由到 `ANTHROPIC_*` 这对环境变量（`openai-responses` / `openai-chat` 本就解析到 `OPENAI_*`），于是对话框的环境变量兜底提示会跟随检测到的协议，符合 PRN-021。

文档：models 页（en/zh）新增「自定义模型的协议检测」一节；configuration 与 server-api 参考补上了新的 client type 与新端点。
