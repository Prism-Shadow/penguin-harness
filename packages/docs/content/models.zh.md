---
title: 模型与供应商
description: 为 Project 添加模型，设置 API key 和默认模型，选择思考等级和快速模式。
---

每个 Project 都有一张自己的模型表：里面是它的对话可以使用的模型，按供应商分组，并附有凭证、限制和价格。你在**模型库**页面管理这张表。Agent 不会绑定到任何模型；对话开始时才选定模型。

- 要了解页面布局，见[模型库页面](#模型库页面)。
- 要添加模型，见[新增模型分组](#新增模型分组)、[添加模型](#添加模型)或[用 AI 创建模型分组](#用-ai-创建模型分组)。
- 要为模型提供凭证，见[设置 API key](#设置-api-key)。
- 要选择新对话使用的模型，见[设置默认模型](#设置默认模型)。
- 要调整请求，见[思考等级](#思考等级)和[快速模式](#快速模式)。
- 内置供应商的完整列表和文件格式，见[内置供应商分组](#内置供应商分组)和 [Project 模型表](#project-模型表)。

## 模型库页面

在侧边栏选择**模型库**。模型按分组列出，每个供应商一个分组。

- **分组**：内置分组按[内置供应商分组](#内置供应商分组)里的顺序排列；你创建的分组排在后面，按名称排序。没有模型的内置分组会隐藏；**Custom** 始终显示。**TokenDance** 分组带有**官方推荐**标签。
- **展开和收起分组**：点击分组标题即可展开或收起。首次访问时只有 TokenDance 分组是展开的。浏览器会记住你展开过哪些分组，按 Project 分别记录。
- **调整分组顺序**：拖动分组标题即可移动分组。顺序保存在当前浏览器里，按 Project 分别记录；对话中的模型选择器也用同样的顺序。触摸屏上或搜索时不能拖动。
- **搜索**：在**搜索模型：id / 名称 / 厂商**里输入，就只显示匹配的模型。搜索期间，所有包含匹配模型的分组都会展开。

每张模型卡片显示模型的显示名、标签、上下文窗口、价格、密钥状态，以及模型至今已使用的 Token 量。

| 标签 | 含义 |
| --- | --- |
| **默认** | Project 的默认模型 |
| **视觉** | 模型可以接收图片 |
| **视觉代理** | 模型代替不支持视觉的模型读取图片 |
| **快速** | 已开启快速模式 |
| **免费** | 三项价格都是 0 |
| **省 N%** | 当前有促销价或空闲时段价生效；见[价格与促销](#价格与促销) |

价格按每百万 Token 显示，顺序为缓存命中 / 缓存未命中 / 输出。币种在设置里**币种**下选择：**美元 $** 或 **人民币 ¥**，按固定汇率 7 换算。

点击卡片即可打开**模型配置**。分组旁边的链接会打开供应商的密钥控制台（**前往密钥管理**）。模型弹窗里还有两个链接，分别打开供应商的模型列表（**获取模型 id**）和模型的主页（**模型主页**）。

只有 Project owner 能修改模型和凭证。成员可以搜索、展开和收起分组，在自己浏览器里调整顺序，也能以只读方式打开**模型配置**。

## 新增模型分组

你创建的分组和 **Custom** 分组一样：里面的模型使用某种通用协议，每个模型各带一个 base URL。

1. 在**模型库**页面，点击**手动创建**，或者点击最后一个分组下方的**新增分组**（＋）。**新增分组**弹窗会打开。
2. 在**分组名**里输入名称。名称要求：
   - 以小写字母或数字开头；
   - 只包含小写字母、数字、`-` 和 `_`；
   - 长度最多 32 个字符；
   - 不能与内置分组或已有分组重名。
3. 选择**仅新增分组**或**导入模型**，然后按下面与你选择对应的小节操作。

### 创建空分组

1. 点击**仅新增分组**，再点击**确认**。这时会为新分组打开**添加模型**弹窗。
2. 添加第一个模型，见[添加模型](#添加模型)。

保存第一个模型后，分组才会出现在列表里。

### 从端点导入模型

**导入模型**会把一个 OpenAI 兼容或 Anthropic 兼容端点列出的所有模型填进新分组。

1. 点击**导入模型**。
2. 在 **API key** 里输入密钥。留空则使用协议的 `OPENAI_*` 或 `ANTHROPIC_*` 环境变量。
3. 在**自定义 base URL** 里输入端点的 base URL。
4. 点击字段右上角的**检测协议**，或者在字段最右侧的菜单里选择协议。见[检测自定义模型的协议](#检测自定义模型的协议)。
5. 点击**批量导入模型**。PenguinHarness 会向端点请求模型列表，然后按端点返回的顺序把所有模型保存到新分组。

每个导入的模型都会带上你填写的 base URL、协议和密钥。端点只提供模型 id：价格、上下文窗口和显示名都留空，视觉保持关闭，直到你检测或手动开启。这和手动添加的模型起点相同。

有些 id 不会导入，结果里会说明跳过的数量：「已导入 {added} 个模型，跳过 {skipped} 个条目」。跳过的情形包括：id 为空、超过 200 个字符、包含控制字符，或者已被占用。

如果协议无法列出模型（「该协议不支持列出模型，请手动添加」），或者列表为空，什么都不会保存，弹窗保持打开。检测失败只会把协议后缀变成琥珀色；你仍然可以手动选择协议，或者改回**仅新增分组**。

列出模型走的是 `POST /api/projects/:id/models/list`（仅 owner 可用），它会以 20 秒为限，在该协议对应的客户端上调用 AgentHub 的 `listModels()`。

### 删除分组

1. 在你创建的分组标题上，点击**删除分组**。
2. 确认删除。

分组里的所有模型和对应的 API key 都会一并删除。内置分组无法删除。

## 添加模型

1. 在分组标题上，点击**添加模型**。
2. 在**模型 ID** 里输入模型 id，必须与供应商 API 要求的完全一致，例如 `gpt-5.5`。**获取模型 id** 会打开供应商的模型列表。
3. 可选：在**模型名称**里输入显示名。显示名为空时直接显示模型 id。
4. 填写凭证和端点：
   - **API key**：留空则使用供应商的环境变量。如果服务端设置了这个变量，输入框会显示变量名。
   - **自定义 base URL**：在 **Custom** 分组和你创建的分组里必填。网关分组会自动填好。
5. 可选：填写限制和价格：
   - **上下文窗口**：模型的上下文窗口大小，单位是 Token。模型不在内置模型目录里时，留空会保存为 1000000。
   - **最大输出长度**：每次请求最多输出的 Token 数。留空则使用 Agent 的设置；上下文较小的模型建议调低这个值。
   - **缓存命中价格**、**缓存未命中价格**和**输出价格**：按每百万 Token 填写，用页面上显示的币种；存储时统一换算成美元。三项要么全填，要么全不填。
6. 可选：如果模型能接收图片，打开**支持视觉**，或者点击**检测**；见[检测视觉支持](#检测视觉支持)。在 **Custom** 分组和你创建的分组里，新添加的模型默认关闭视觉；加到其他分组的模型默认开启视觉。
7. 可选：打开**快速模式**；见[快速模式](#快速模式)。
8. 点击**确认**。

新模型使用哪种协议，取决于所在的分组：

- **厂商分组**（DeepSeek、Google Gemini、OpenAI、Anthropic、Z.AI、Moonshot、MiniMax）只支持厂商自己的 API。如果模型 id 无法按这种方式路由，弹窗会警告你，并提供**转为自定义模型**。OpenAI 兼容的端点请放进 **Custom** 分组。
- **OpenRouter** 总是使用 `openai-responses`，**vLLM** 总是使用 `openai-chat-vllm-adapter`。
- **OpenAI 兼容网关分组**使用 OpenAI Chat Completions，但聚合分组的预置条目可以逐条固定模型专属协议。
- **Custom** 和你创建的分组：在 base URL 字段里选择协议，或者检测协议。见[检测自定义模型的协议](#检测自定义模型的协议)。

### 编辑或删除模型

点击模型卡片，打开**模型配置**。修改字段，点击**确认**，再确认保存。在同一个弹窗里，你还可以**测试连通性**、**设为默认模型**、**设为视觉代理模型**或**删除模型**。

修改**模型 ID** 或**分组**会重命名这条记录；凭证以及默认模型、视觉代理的角色都会跟着迁移。**删除模型**会删除模型的配置和 API key。

## 用 AI 创建模型分组

**用 AI 创建**用来处理导入读不了的情况：模型列表页面不是 OpenAI 兼容的 `/models` 端点、只有文字描述的服务，或者要把厂商模型加进已有分组。

> [!TIP]
> 如果 OpenAI 兼容端点能自己列出模型，**新增分组**弹窗里的**导入模型**更快。

1. 在**模型库**页面，点击**用 AI 创建**。**让 AI 添加模型分组**弹窗会打开。
2. 粘贴模型列表页面的地址，或者用文字描述这个服务，也可以在**试试这些示例**里挑一个示例。
3. 点击**在新对话中编辑**。会打开一个新对话，使用 Project 的默认 Agent，并已填好 Prompt。
4. 发送 Prompt。

固定指令会让 Agent 使用 `penguin-config` Skill，并执行以下操作：

- 每个模型运行一次 `penguin config model add --provider <group> --model-id <upstream id> --project-id <project> --root <data root>`；如果是 OpenAI 兼容端点，再加 `--client-type openai --base-url <endpoint>`。之所以要写明 data root，是因为命令的运行环境里不带这个信息；
- 来源是网页时，先抓取网页，然后添加你点名的模型，或者最流行的模型，最多十个左右；
- 缺少 API key 时只询问一次，或者留空，让你稍后在**模型库**页面填写；
- 绝不读取或编辑 `.project_config.toml`；
- 最后运行 `penguin config model list`。

**模型库**页面每次打开都会重新加载模型表，所以从对话回来时，新分组已经在页面上了。

## 检测自定义模型的协议

**Custom** 分组和你自己创建的分组里的模型，使用的都是 AgentHub 的某一种通用协议，弹窗可以检测出一个 base URL 到底支持哪一种。新建的自定义模型一开始没有选择协议：base URL 输入框右端的后缀显示为**选择协议**。

要检测协议，点击 base URL 输入框右上角的**检测协议**。这个按钮始终可用，也不需要 API key。服务端会按下面的顺序向 URL 发出三个轻量请求，并采用端点支持的第一个协议：

1. `openai-responses`：`POST {base}/responses`（OpenAI Responses API）
2. `ant-messages`：`POST {base}/v1/messages`（Anthropic Messages API）
3. `openai-chat`：`POST {base}/chat/completions`

检测到协议时会出现一条消息，例如「检测到 {name} 协议，已应用」。检测结果只体现在后缀里，后缀显示的就是协议路径。

检测能容忍常见的 base URL 错误：

- 多写了一个 `/v1`（`https://host/v1/v1`）；
- 少写了一个 `/v1`（API 实际在 `https://host/v1` 下，却只填了 `https://host`）；
- 直接粘贴了供应商文档里的完整端点 URL（`/chat/completions`、`/responses`、`/messages`）。

检测会先探测清理后的 base，再探测它的相邻形式：URL 末尾有 `/v1` 就去掉，没有就加上。每种形式依次尝试三种协议，最多发出六个短探测。base URL 输入框随后会改写为应答的那个形式，并提示「已检测为 {protocol}，base URL 已整理为 {url}」。

要手动设置协议，点击这个后缀。菜单里列出 **OpenAI Responses**（`/responses`）、**Anthropic Messages**（`/v1/messages`）和 **OpenAI Chat Completions**（`/chat/completions`），每一项都标注了客户端会追加到你 URL 末尾的路径。手动选择的协议优先于检测，已经知道端点协议时，根本不必探测。

如果检测不出结果，后缀会变成琥珀色，并提示「无法检测接口协议，请检查 API Key 与 base URL。」原因可能是端点不可访问、请求超时、返回的内容不是 API，或者三个路径都不支持。端点仍会报告每次探测的结果，方便调试。

检测从不阻塞保存。协议还没确定时就点击**确认**，会先执行检测，按钮显示**检测中…**。检测到协议就直接保存，不再提示。检测不到时模型照样保存，协议定为 OpenAI Chat Completions，并提示「未检测到协议，已按 OpenAI Chat Completions 保存」。

### 探测原理

- 探测请求是请求体为 `{}` 的最小无效请求，不消耗 Token，也不需要有效的模型 id：返回的错误若符合协议自身的格式，就证明路由存在；返回 `404` 或 `405`，说明路径没有提供服务；HTML 或网关杂讯一律不算数。
- 探测用的 URL 和认证头，与保存后 AgentHub 客户端实际使用的完全一致：OpenAI 系协议用 `Authorization: Bearer`，`ant-messages` 用 `x-api-key` 加 `Authorization: Bearer` 和 `anthropic-version`。所以检测出的协议一定真实可用。
- 服务端按三步选取探测凭据：优先用弹窗里填写的 API key，其次用这个条目已保存的 key，最后用探测目标协议对应的环境变量（`ant-messages` 用 `ANTHROPIC_API_KEY`，两个 OpenAI 协议用 `OPENAI_API_KEY`）。每发一次探测都会重新选择，因为此刻要确定的就是协议。这些值不会传到浏览器，也不会出现在响应里。
- 完全没有凭据也能检测，因为协议格式的 `401` 同样能识别路由。不过相比匿名请求经常得到的笼统 `401` 或网关 HTML，带凭据的探测得到这个明确答案的可能性大得多。
- 在这些分组里，不会从模型 id 推断任何东西。在自定义分组里输入 `claude-sonnet-5`，不会因此选用 Anthropic 客户端或它的 `ANTHROPIC_*` key：自定义分组一律回退到 `openai-chat`，API key 提示也照此显示。供应商分组和网关分组不受影响；模型目录认识它们的 id，所以按 id 或按分组的预置来路由。
- 在检测功能出现之前创建的条目，保留 `client_type = "openai"`，它至今仍是 `openai-chat` 的别名。只有手动选择协议、或某次检测生效时，才会改写这个值。旧的非标准协议值以只读方式显示：「协议：{t}（沿用原配置，不可修改）」。
- 检测也可以通过 `POST /api/projects/:id/models/detect` 调用（仅 owner 可用），参见 [Server API](/server-api)。

## 检测视觉支持

**支持视觉**开关可以一直关着，等你需要时再去问模型。点击开关旁的**检测**：PenguinHarness 会向模型发送一张 1x1 的 PNG，配一句只有一个词的提示。

- 模型能回答，开关就打开：提示「该模型接受图片输入，已开启视觉」。
- 模型表示自己不接受图片，开关就关闭。这是真实的回答，不是错误。
- 探测因认证或网络问题失败时，开关保持原样，提示会请你检查 API key 和 base URL。

> [!NOTE]
> 和协议检测不同，这一探测是真实、计费的请求：图片请求无法像协议探测那样做到免费。它只在你点击**检测**时执行，绝不会自动运行，也不会在保存时运行。

凭据来源和连通性测试是同一条链路：先用弹窗里填写的 key，其次用已保存的 key，最后用协议对应的环境变量，全部在服务端解析。**支持视觉**只对不在内置模型目录里的模型显示；目录里的模型本身就声明了是否接受图片。

## 设置 API key

每个模型都可以配自己的 API key，也可以不配。

- **单个模型。** 在**模型配置**里，把 key 填入 **API key**。保存后 key 会打码显示；输入框留空即保留原 key，点击**清除已存 API key** 可删除它。
- **整个分组。** 在分组标题栏上点击**手动设置密钥**并输入 key，组内所有模型都会使用它。
- **不配 key。** 没配 key 的模型使用服务端上供应商的环境变量；参见[内置供应商分组](#内置供应商分组)。key 来自环境变量时，卡片和弹窗都会显示这一点。

你填写的 key 存在 Project 的隐藏配置文件里，文件权限为 0600。Web App 里它始终打码显示。

### 授权获取新 API key

支持自动授权取 key 的供应商，会在分组标题栏上加上**自动获取密钥**。内置分组里有三个提供了这个流程：TokenDance、Penguin Go 和 ModelScope。取得的 key 会写入分组里的每个模型，替换它们现在使用的 key。

1. 在分组的标题栏上，点击**自动获取密钥**。
2. 点击**打开授权页**。供应商的授权页会在新标签页中打开。
3. 在授权页完成授权。弹窗显示「等待在新标签页中完成授权…」，并自动报告结果。

TokenDance 会为你的账号创建一把**新** key，不会读取你已有的 key。供应商会把浏览器带回 PenguinHarness，由 PenguinHarness 用一次性授权码换取并保存 key。如果授权页跳不回来，比如浏览器无法访问重定向给出的服务器地址，点击**授权页跳不回来？改为手动填写授权码**。授权页随后不再重定向，改为直接显示一次性授权码。

1. 把授权码粘贴进**授权码**输入框。
2. 点击**提交授权码**。

Penguin Go 有四处不同：

- 结果由服务端向 Penguin Go 轮询获取，因此这个分组没有手动填写授权码的方式。
- 分组有 key 之后，标题栏上**添加模型**之前会出现**同步**，用它再次读取平台的模型目录，见 [Penguin Go 分组](#penguin-go-分组)。**自动获取密钥**依然保留，可以换成另一个平台账号的 key。
- 平台报告 key 失效或被吊销时，**模型库**页面会重新打开授权。
- 取到的 key 写入本地失败时，服务端会把这一次交付短暂保留，可以直接重试写入，不必再次授权。

ModelScope 有三处不同：

- 授权不经过魔搭自己的页面，而是经过一台**授权中转层**。中转层持有魔搭的 client secret，代 PenguinHarness 走完 OAuth，再把一把可直接调用 api-inference 的 access token 交回来。中转层的地址来自服务端环境变量 `MODELSCOPE_BRIDGE_URL`，见[环境变量](/configuration#环境变量)。
- 授权页的地址由中转层给出，PenguinHarness 原样打开，不像 Penguin Go 那样自己拼。同样没有手动填写授权码的方式。
- 拿到的 access token 是**会过期**的；PenguinHarness 会在服务端保存刷新凭据，并在模型请求前静默续期。刷新凭据失效或缺失时，才需要重新点一次**自动获取密钥**。

注意事项：

- 只有 Project owner 能发起授权。TokenDance 还要求由他本人已登录的会话完成授权，实际上就是打开着弹窗的那个标签页。重定向本身不要求会话就能接收，因为供应商带回的浏览器未必是你发起授权时用的那个；但它只交回授权码：在弹窗来取结果之前，不会发生任何换取，也不会保存任何 key。
- 整个换取过程都在服务端完成。TokenDance 的 PKCE verifier、Penguin Go 的设备密钥、以及 ModelScope 的授权码和设备密钥都不会进入浏览器；新 key 直接写入模型表，同样不经过浏览器。ModelScope 的 client secret 从头到尾都不在 PenguinHarness 里，只有中转层持有。
- 一次授权流程最多等待十分钟。ModelScope 交付的是一组 access token / refresh token：access token 写入模型表，refresh token 只保存在服务端 DB，不返回给前端，也不写入 Project 配置。
- 交付回来的 key 只交一次。Penguin Go 和 ModelScope 都会在本地保存失败时短暂保留这一次交付，因此可以直接重试写入，不必再次授权。ModelScope 下无需去魔搭控制台清理——它交回的是你自己账号的 token，不是新造的 key。
- TokenDance 的 key 携带[应用归因](#应用归因)表中 PenguinHarness 的应用 URL，所以即使用其他工具发起调用，用量也仍会归到 PenguinHarness 名下。

## 设置默认模型

新对话使用 Project 的默认模型，除非你选了别的。新建 Project 的默认模型是 `deepseek-flash`（DeepSeek V4.1 Flash），它自己就能读图。

1. 点击模型的卡片，打开**模型配置**。
2. 点击**设为默认模型**并确认。

模型表还没有默认模型时，第一个添加进来的模型会自动成为默认模型。设置默认模型的同时，也会保存弹窗里未保存的修改。

### 设置视觉代理模型

没有视觉的模型看不到图片。它用 `read_file` 读图时，由视觉代理模型替它描述图片。默认没有视觉代理模型。

1. 找一个开启**支持视觉**的模型，打开它的**模型配置**。
2. 点击**设为视觉代理模型**并确认。

删除这个模型或关闭它的视觉后，视觉代理角色随之取消。对于 `vision = false` 的模型，比如 DeepSeek 分组里纯文本的 `deepseek-v4-pro`，对话中的图片会存到 Session 暂存区，并在文本里以文件路径的形式交给模型。`read_file` 读到图片时，会把图片交给视觉代理模型描述，而不是直接返回。参见[工具与审批](/tools)。

## 测试连通性

在**模型配置**里点击**测试连通性**（仅 owner 可用）。测试用的是弹窗里当前的内容，包括你填写的 key、base URL、协议和**快速模式**开关，所以保存之前就能发现问题。结果显示为「连通正常（{ms} ms）」或「连通失败：{msg}」。

### 测速

要比较一个分组里的模型：

1. 在分组标题栏上点击**测速**。
2. 点击**开始测速**。

PenguinHarness 依次向每个模型发送一个真实请求，这会消耗少量 API 配额，然后在每张卡片上显示：

- 首个 Token 的延迟，单位毫秒：低于 1000 显示绿色，1000 到 3000 显示黄色，3000 以上显示红色；
- 输出速率，单位 Token/秒：40 及以上显示绿色，15 及以上显示黄色，15 以下显示红色。

结果只留在当前页面，刷新后就消失。

## 同步预置模型

PenguinHarness 升级可能改变内置的预置模型目录。一旦发生，Project owner 会看到：

- 侧边栏**模型库**上出现红点；
- 页面上出现通知「检测到变更：{added} 个新增，{updated} 个可升级」，附带**现在升级**和**忽略**按钮；
- 页头出现**同步预置**按钮。

**现在升级**会列出将要改动的模型，再用**同步预置**确认。页头的**同步预置**按钮则立即同步，不显示列表。

同步时会：

- 添加 Project 还没有的目录模型，退役条目除外：Project 已有的退役条目照常更新，没有它的 Project 则不会被补上（见[预置模型](#预置模型)）；
- 把已有目录模型的视觉标记、上下文窗口、协议、价格和 base URL 重置为目录里的值；
- 模型名称为空时自动补全，但绝不覆盖已有名称；
- 绝不动 API key、**最大输出长度**、快速模式，以及你自己添加的模型和分组。

点击**忽略**后，通知会隐藏，直到目录再次变化才重新出现。

## 思考等级

思考等级决定模型在回答前思考多少。共有六级：`none | low | medium | high | xhigh | max`。每个 Agent 都有默认等级，即 `system_config.yaml` 里的 `model.thinking_level`（参见 [Agent 配置](/configuration#agent-配置)）。新建 Agent 的默认等级是 `medium`。

等级选择器只提供 `low` 及以上。很多模型无法关闭思考，但已保存的 `none` 依然有效，也依然会显示。每个等级都标注它实际发送的值，标签上写的就是请求里发的内容。

- `max` 是最深的档位。各客户端会把它映射到供应商支持的最深推理档位，没有这个档位时静默回退，所以选它不会失败。在 Gemini 和 MiniMax M3 上，它的档位和 `xhigh` 相同。
- 对 MiniMax M3，`none` 直接映射为 `reasoning.effort = "none"`。
- DeepSeek V4 接受 `low`、`high` 和 `max`，`medium` 和 `xhigh` 会在它那边归并为 `high`。要 DeepSeek 最深的推理，请选 `max`。

### 在新对话中

模型选择器旁边的等级选择器，会立即修改所选 Agent 的默认等级，从它的下一个对话开始生效。

### 在对话中

选择器显示当前对话使用的等级，初始值是 Agent 的默认等级。

- 你选的等级会保存在这个对话上，从模型的下一次请求开始生效，从不改动 Agent 的默认等级。
- 对话中途改等级，会让模型的缓存上下文失效，成本随之升高。
- 如果对话已有历史记录，会弹出**切换思考等级**弹窗，提供**压缩后切换**（更便宜）或**仍要切换**两个选项。对话还在运行时，无法先压缩。

要在 Agent 设置里修改默认等级，参见[运行参数标签页](/agents#运行参数标签页)。

## 快速模式

快速模式会把模型的对话请求发往供应商更快速的服务层级，并按溢价计费。默认关闭，已有配置不受影响。

有三种方式可以按模型开关快速模式：

- 模型弹窗里的**快速模式**开关
- `penguin config model add` 的 `--fast-mode` / `--no-fast-mode` 参数
- 条目里的 `fast_mode = true`

开启前会先要求确认，因为这会改变模型的成本。开启快速模式的模型会显示**快速**标签。

开启快速模式后，对话请求会带上 AgentHub 的 `fast_mode` 标志：

- OpenAI 协议客户端发送 `service_tier: "priority"`。
- Anthropic 协议客户端发送 `speed: "fast"`，并附带 fast-mode beta 请求头。

快速层级按供应商的溢价价格计费：MiniMax 收标准费率的 1.5 倍，OpenAI 和 Anthropic 则各自公布单独的溢价费率。

> [!WARNING]
> 记录的每 Token 价格不会随之改变，所以除非你调高条目里的价格，快速模式用量显示的成本会偏低。

### 哪些模型支持快速模式

存不存在快速层级，取决于模型路由到的 AgentHub 客户端，而不是模型条目。只有客户端确实会发送这个参数时，开关才会出现：

| 路由到的客户端 | 快速模式 |
| --- | --- |
| OpenAI 协议（`openai_chat`、`openai_responses`、`gpt6`、`minimax_m3`） | 以 `service_tier: "priority"` 发送 |
| Anthropic 协议（`ant_messages`、`claude5`） | 以 `speed: "fast"` 发送，外加 beta 请求头 |
| Gemini、GLM、Kimi、DeepSeek、OpenAI embeddings | 拒绝，不显示开关 |
| Bedrock 上的 Claude，或 Claude 4.6 id | 拒绝，不显示开关 |

路由跟随条目的 `client_type`；没有设置时，按 `model_id` 判断，所以同一个上游 id 可能落到不同的客户端。添加在网关分组下的 Kimi 模型（`client_type = "openai"`）可以使用快速模式，同一个 id 路由到 Kimi 自己的客户端就不行。你自己 base URL 背后的 custom 模型会保留开关：它走 OpenAI 协议，背后很可能就是 OpenAI，但第三方服务器完全可以接受这个参数，然后照常按标准层级提供服务。

开关无法替你确认两件事：

- Anthropic 的快速模式目前是限量研究预览。在你的组织获得访问权限之前，请求会返回 429 限流错误。对 Anthropic 协议的模型，确认提示里会说明这一点。
- 服务端环境变量里的 `CLIENT_TYPE` 和 `ANTHROPIC_BASE_URL` 会覆盖条目设置，可能把模型路由到开关没有预料到的地方。

> [!NOTE]
> 如果请求仍然落到拒绝 `fast_mode` 的客户端，AgentHub 会在发出任何网络请求之前直接拒绝。这一轮对话会立即结束，并给出供应商的消息和指向设置的提示。必定重复出现的拒绝不会重试。

如果条目在不支持快速模式的模型上保存了 `fast_mode = true`，弹窗里的开关仍然保留，并标记为不支持，你随时可以关掉它。

连通性测试会带上弹窗当前的快速模式状态，所以在保存之前，**测试连通性**就能显示快速模式的拒绝结果。后台请求（例如 Session 标题生成、`read_file` 的视觉代理读取）从不使用快速模式，只有对话本身的请求才会用。

## 连接本地或自托管端点

本地推理服务器可以通过两种方式加入 Project。

### 把模型添加到 vLLM 分组

把模型添加到 **vLLM** 分组。协议固定为 `openai-chat-vllm-adapter`，分组没有预置 base URL，所以要把**自定义 base URL** 设置为你的服务器地址。

分组自带八个预置模型，价格均为 0：

- `Qwen/Qwen3.8-Flash-Next`
- `Qwen/Qwen3.8-27B`
- `Qwen/Qwen3.6-35B-A3B`
- `Qwen/Qwen3.5-0.8B`
- `Qwen/Qwen3.5-9B`
- `deepseek-ai/DeepSeek-V4-Pro`
- `deepseek-ai/DeepSeek-V4-Flash`
- `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp`

上下文窗口均为各模型的原生长度：Qwen 系列为 262,144，DeepSeek V4 系列为 1,000,000。

### 添加 custom 条目

添加一个 `custom` 模型，并设置：

- `client_type = "openai-chat"`
- `base_url` 指向服务器，例如 `http://127.0.0.1:8000/v1`
- `model_id` 填服务器实际提供的模型名称

对这类服务器，协议检测会判定为 `openai-chat`；也可以通过 base URL 字段的后缀菜单手动选定。

### 让本地服务器顺畅运行

无论用哪种方式添加模型，都要检查两项设置：

- **在服务器上启用工具调用。** 对 vLLM，启动服务器时加上 `--enable-auto-tool-choice`，以及你的模型对应的 `--tool-call-parser`，例如 Qwen 用 `hermes`，Llama 3.x 用 `llama3_json`。缺少这些参数时，工具调用会以纯文本形式到达，Agent 循环无法执行任何操作。
- **把条目的 `context_window` 设为服务器的真实窗口。** 对 vLLM 来说就是 `--max-model-len` 的值，例如 `32768`。

单次请求的输出上限和压缩阈值都跟随这个窗口。请求会把 `max_tokens` 限制在窗口剩余空间内，压缩也会在窗口溢出之前运行，所以你不需要手动调整 `max_tokens`。

> [!NOTE]
> 如果这个字段留空，单次请求的输出上限不会生效，压缩会按 128000 的窗口计算，真实窗口更小的服务器会拒绝请求。

## 内置供应商分组

下表列出了各个内置分组，以及条目没有 key 时模型回退使用的环境变量。模型目录的源码位于 `packages/core/src/state/model-catalog.ts`。每个分组还有一个 `_BASE_URL` 变体，例如 `ANTHROPIC_BASE_URL`。**模型库**页面按这个顺序列出分组，你创建的分组排在后面。

| 供应商 | API key 环境变量 | 说明 |
| --- | --- | --- |
| tokendance | `OPENAI_API_KEY` | 推荐分组。OpenAI 兼容网关，预置 base URL `https://tokendance.space/gateway/v1`；模型 id 为裸名称，不带供应商前缀（如 `glm-5.3`、`kimi-k3`）；价格采用网关自己的人民币费率，目前有几项在打折 |
| penguin-go | `PENGUIN_GO_API_KEY` | 预置的中转分组，固定 base URL `https://token.penguin.ooo/api`；分组标题栏可以为你自动授权一把 key，也可以手动设置。见 [Penguin Go 分组](#penguin-go-分组) |
| deepseek | `DEEPSEEK_API_KEY` | 默认模型所在的分组 |
| openrouter | `OPENAI_API_KEY` | OpenAI 兼容网关，预置 base URL `https://openrouter.ai/api/v1` |
| fireworks | `OPENAI_API_KEY` | Fireworks AI（OpenAI 兼容），预置 base URL `https://api.fireworks.ai/inference/v1`；API 模型 id 形如 `accounts/fireworks/models/<slug>` |
| google | `GEMINI_API_KEY` | |
| openai | `OPENAI_API_KEY` | |
| anthropic | `ANTHROPIC_API_KEY` | |
| siliconflow | `OPENAI_API_KEY` | OpenAI 兼容网关，预置 base URL `https://api.siliconflow.cn/v1` |
| zhipu | `ZAI_API_KEY` | |
| moonshot | `MOONSHOT_API_KEY` | |
| minimax | `MINIMAX_API_KEY` | 直连 MiniMax M3 的 Responses 客户端（`client_type = "minimax-m3"`）：`MiniMax-M3`，上下文窗口 1,000,000 Token，支持视觉；预置 base URL `https://api.minimax.io/v1`；接受 Token Plan 订阅密钥或按量付费 API key |
| qwen-pay-as-you-go | `OPENAI_API_KEY` | Qwen 按量付费（DashScope 的 OpenAI 兼容端点），预置 base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`；转售的第三方模型保留供应商前缀 id（如 `kimi/kimi-k3`） |
| qwen-token-plan | `OPENAI_API_KEY` | Qwen Token Plan 订阅网关，预置 base URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；价格取自各模型页面的官方牌价（预览模型只有配额倍率优惠，没有牌价） |
| modelscope | `OPENAI_API_KEY` | 魔搭的 OpenAI 兼容 api-inference 网关，预置 base URL `https://api-inference.modelscope.cn/v1`；id 就是上游仓库名（如 `deepseek-ai/DeepSeek-V4.1-Flash`、`Qwen/Qwen3.8-27B`）；分组标题栏可以经授权中转层为你自动授权一把 token，也可以手动设置。见 [ModelScope 分组](#modelscope-分组) |
| vllm | `OPENAI_API_KEY` | 自托管 vLLM 服务器：协议固定为 `openai-chat-vllm-adapter`，无预置 base URL，八个预置模型价格均为 0（见[连接本地或自托管端点](#连接本地或自托管端点)） |
| custom | `OPENAI_API_KEY` | 任意 OpenAI 协议端点；自带一个预置模型 Atria Dawn Preview（Anthropic Messages API，地址 `api.atria-asi.ai`，条目没有凭据时使用 `ANTHROPIC_API_KEY`，上下文窗口 256K，供应商公布价格之前定价 $0） |

OpenAI 兼容网关分组（openrouter / fireworks / siliconflow / tokendance / qwen-pay-as-you-go / qwen-token-plan）走的是 AgentHub 通用的 OpenAI 协议客户端，凭据留空时读取 `OPENAI_API_KEY`，而不是某个网关专属的变量。ModelScope 也使用 `OPENAI_*` 凭据变量，因为它的凭据是 api-inference token，但它的预置条目可以逐条固定模型专属协议。

- OpenRouter 分组的预置模型，以及你添加到该分组的任何模型，都使用 Responses 客户端（`client_type = "openai-responses"`），因为 OpenRouter 在同一个 base URL 上为它转售的每一个模型提供 Responses API。
- 其他网关的预置模型使用 Chat Completions 客户端（`client_type = "openai-chat"`）。
- ModelScope 像 Penguin Go 一样是聚合网关：Qwen 预置使用 `openai-chat-vllm-adapter`，在 Chat Completions 上按 Qwen 模板传递思考参数；DeepSeek 预置固定为 `deepseek-v4`，运行时走 AgentHub Responses client。
- 这些网关客户端读取相同的 `OPENAI_*` 变量，所以无论哪种方式，凭据规则完全一致。

直连 MiniMax M3 的客户端读取 `MINIMAX_API_KEY`。内置的 MiniMax 预置模型使用 `https://api.minimax.io/v1`。只有条目没有自己的 `base_url` 时，才会读取 `MINIMAX_BASE_URL`。

### Penguin Go 分组

`penguin-go` 和 TokenDance 一样是内置分组：一个中转服务，base URL 固定为 `https://token.penguin.ooo/api`。新建的 Project 立即带上这个分组的目录模型；在该分组之前创建的 Project，用**同步预置**把它们补上。

分组的 key 从标题栏取得，见[授权获取新 API key](#授权获取新-api-key)。授权以及随后的**同步**还会读取平台自己的模型目录：

- 平台提供而 Project 没有的模型会被添加进来，连同协议、端点、显示名、上下文窗口、视觉能力和牌价。纯向量（embedding）模型不收录。
- Project 已有的模型保留自己的端点和你配置过的其他内容。只刷新三项价格和客户端协议，`max_tokens` 保持未设置，沿用 Agent 的设定；任何模型都不会被删除。
- 平台的促销会替换这个分组已存的促销。和其他分组一样，`.project_config.toml` 里存的是牌价，促销存在服务端的数据库里；**同步预置**从不设置促销，每次授权或**同步**都会整体替换它们。这条记录丢失后，用量按牌价计价，直到下一次授权或同步把它写回来。

平台报的是高峰档费率，单位是每百万 Token 多少美元。分组里的 DeepSeek 条目跟随 DeepSeek 当前的模型阵容，只有 `deepseek-flash` 和 `deepseek-v4-pro`，并声明与直连 DeepSeek 分组相同的空闲时段，因此在北京时间工作日 9:00–12:00、14:00–18:00 之外，卡片和成本记录都按半价计算。

### ModelScope 分组

`modelscope` 是聚合网关分组：同一个魔搭 api-inference 端点，预置 base URL `https://api-inference.modelscope.cn/v1`，每条预置各自写明 AgentHub 应该为这个上游模型使用的协议。模型 id 就是上游仓库名，因此保留供应商前缀（`deepseek-ai/DeepSeek-V4.1-Flash`、`Qwen/Qwen3.8-27B`）。Qwen 条目使用 `openai-chat-vllm-adapter`，在线路仍为 Chat Completions 的同时正确控制 Qwen 模板的思考参数；DeepSeek 条目固定为 `deepseek-v4`，与直连 DeepSeek 和 Penguin Go 的 DeepSeek V4 条目保持一致。新建的 Project 立即带上这些预置；更早创建的 Project 用**同步预置**补上。

分组的 key 从标题栏取得，见[授权获取新 API key](#授权获取新-api-key)。授权走一台授权中转层，由中转层持有魔搭的 client secret 并交回一组 api-inference access token / refresh token，而不是经过魔搭自己的页面。除此之外这个分组没有特别之处：推理请求直接发给 `https://api-inference.modelscope.cn/v1`，从不经过中转层；access token 和其他分组的 key 一样写进 `.project_config.toml`，refresh token 只保存在服务端 DB。access token 会过期，PenguinHarness 会在模型请求前静默续期；refresh token 缺失或失效时，才需要从标题栏重新授权一次。

预置条目不带价格。魔搭的 api-inference 是计费的，但它的模型页面读不到费率，所以这些条目按未定价处理：模型页在它们上面不显示价格徽标，成本中心把它们的用量报为未计价。这是目录记录「没人查过这个价格」的方式，见[价格与促销](#价格与促销)。

### 预置模型

预置模型目录包含以下模型：

- `deepseek-flash` / `deepseek-v4-pro`
- `MiniMax-M3`
- `gemini-3.8-flash`
- `claude-opus-5` / `claude-opus-4-8` / `claude-sonnet-5`
- `gpt-6-astra` / `gpt-5.6` / `gpt-5.5`
- `glm-5.3` / `glm-5.3-flash`
- `kimi-k3`
- `qwen3.8-max` / `qwen3.8-flash`
- `seed-2.1-pro` / `seed-2.1-turbo` / `seed-evolving`
- `dots-3-note-preview`（TokenDance 上免费，512K 上下文）
- `deepseek-ai/DeepSeek-V4.1-Flash`、`Qwen/Qwen3.8-27B`、`Qwen/Qwen3.8-Flash-Next`（ModelScope 的 api-inference，没有价格的预置条目）

列表并未穷尽所有模型。

- **DeepSeek 图像能力。** `deepseek-flash` 就是 V4.1 Flash，支持读图；`deepseek-v4-pro` 是 V4 Pro 0813 版本，仅支持文本。要发送图像，请使用 `deepseek-flash`。
- **退役条目。** DeepSeek 仍然接受 `deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp`，并都由 V4.1 Flash 承接。它们不再是预置条目，但目录把它们连同 TokenDance 的 `deepseek-v4-flash-vision-exp` 作为退役条目保留：仍带着其中某条的 Project 照旧显示它的名称，**同步预置**也会继续更新它的价格。退役条目不会被补进没有它的 Project，新建的 Project 也不会拿到。
- **OpenAI 出现两次。** OpenAI 全系模型出现了两遍：一次直连（用你自己的 OpenAI key，官方牌价），一次在 OpenRouter 上以 `openai/<id>` 形式（网关费率，随其当前促销活动浮动）。
- **GLM-5.3 Flash 出现五次。** 分别是直连的 `glm-5.3-flash`、TokenDance 上的同名条目，以及 OpenRouter 的 `z-ai/glm-5.3-flash`、Fireworks AI 的 `accounts/fireworks/models/glm-5p3-flash` 和 Qwen 按量付费的 `ZHIPU/GLM-5.3-Flash`。每一条都接受图像：AgentHub 的 GLM 客户端只对这一个 GLM id 转发图像内容，其他所有 GLM id 都拒收图像；各网关条目走通用的 OpenAI 兼容客户端，对任何 id 都会携带图像。各条不一致的是价格：每条记录的都是自己卖家收取的价格，所以促销期间彼此不同。
- **OpenRouter 免费档。** 目录收录了 `:free` 变体 `nvidia/nemotron-3-ultra-550b-a55b:free`，以及 `openrouter/free` 这个统一的免费模型路由（Free Models Router）。它们不花钱，但 OpenRouter 免费档的限流和数据政策仍然适用。

### 价格与促销

- **三类价格。** 每个模型都记录 `cache_read`、`cache_write` 和 `output` 三项价格，单位是每百万 Token 多少美元。成本中心按这些价格结算用量。
- **没有价格的条目。** 价格字段可以整体缺席，含义是「没人查过这家的价格」，而不是免费：这类条目在**模型库**页面不显示价格徽标，成本中心把它的用量报为未计价。目录里目前只有 ModelScope 的预置条目是这样——魔搭的 api-inference 是计费的，但它的模型页面是客户端渲染的，读不到费率。写成三个 0 反而更糟：那会被当作免费档，给一个计费网关打上「Free」徽标。
- **仅记录基础档。** 供应商的价格随输入规模上调时，目录只记录基础档。MiniMax M3 记录的是 MiniMax 标准按量付费档在 512K 输入 Token 及以下的价格；超过后每项费率翻倍，priority 档为 1.5 倍，所以长上下文和 priority 用量的成本估算会偏低。OpenAI（272K 以上）和 Gemini 3.1 Pro（200K 以上）遵循同样的约定。
- **DeepSeek 空闲时段。** 直连 DeepSeek 的条目记录官方高峰价格，并声明 DeepSeek 的空闲时段规则：工作日北京时间 9:00–12:00 和 14:00–18:00 以外的时段，三项价格全部减半。**模型库**页面在这些时段显示 `省 50%` 标签，成本中心也按这个费率计费。
  - 四条转售条目遵循同样的时段，因为各自的卖家沿用了 DeepSeek 的时间窗口：TokenDance 的 `deepseek-v4.1-flash`、OpenRouter 的 `deepseek/deepseek-v4.1-flash`，以及 Penguin Go 的 `deepseek-flash` 和 `deepseek-v4-pro`。
  - Qwen 转售的 DeepSeek 模型按它自己的时段计费：北京时间每天 22:00 至次日 8:00 半价。两个 Qwen 分组的 `deepseek-v4.1-flash` 和 Token Plan 的 `deepseek-v4-pro-0813` 声明的是这一套，折扣标签的悬停说明写的也是该条目所遵循时段的窗口。
  - 存储的价格始终是高峰价格，所以磁盘上的数值与 Project 创建或同步的时间无关。
- **固定折扣。** 目前有九个 TokenDance 模型在打折：
  - `kimi-k3` 打 6 折
  - `deepseek-v4-flash-0731`、`deepseek-v4-pro-0813`、`glm-5.3`、`glm-5.3-flash` 和 `qwen3.8-max` 打 9 折
  - 三条 Doubao Seed 条目（`seed-2.1-pro`、`seed-2.1-turbo`、`seed-evolving`）打 5 折

  Gemini 3.8 Flash、3.7 Flash 和 3.6 Flash 也打 5 折，google 分组和 OpenRouter 上（`google/gemini-3.8-flash`、`google/gemini-3.7-flash`、`google/gemini-3.6-flash`）都是如此，因为 Google 在 2026-12-31 之前对它们一律减半。Project 预置的是**牌价**：折扣率由服务端另行保存，存在它自己的数据库里，而不写入 `.project_config.toml`，计算成本时再从牌价中扣除，因此成本中心按卖家实际收取的价格计费。模型卡片用标签标出当前实际计费的费率，模型弹窗则写明**此处为牌价，当前促销在此基础上省 N%；修改价格会取消促销**。
- **你自己的价格。** 修改条目的价格会取消它的促销，卡片上的折扣标签也随之消失：此后这个数字由你自己定，不再代表卖家。

## Project 模型表

每个 Project 的模型都记录在隐藏文件 `.project_config.toml` 里。通过**模型库**页面或 CLI（`penguin config model add / default / list`，参见 [CLI 参考](/cli)）维护这个文件。

> [!WARNING]
> 不要手动编辑 `.project_config.toml`。

每个 `ModelEntry` 包含以下字段：

| 字段 | 含义 |
| --- | --- |
| `provider` | 配置分组名；与 `model_id` 一起构成唯一键 |
| `model_id` | 上游请求 id |
| `context_window` | 上下文窗口（Token）。不只是展示，而是实际参与运算：每个请求的有效输出上限和压缩阈值都由它推导，因此请求要求的输出永远不会超过窗口的剩余空间。未设置（或数值小得不合理，低于 4096）时，输出限制关闭，压缩按假定的 128000 计算；窗口较小的模型请填写真实值。在 Web 弹窗中，模型不在模型目录里且这个字段留空时，会写入 1,000,000（手动添加的条目按已知模型处理，而不是当作窗口未知）；如果端点实际支持的窗口更小，就把它调小。`penguin config model add` 省略 `--context-window` 时不写任何默认值 |
| `max_tokens` | 可选的单模型输出上限（每次请求最多输出的 Token 数）。设置后会覆盖 Agent 的 `model.max_tokens`；未设置就继承这个值。这个上限只是封顶值，不是实际发出的数值：每个请求实际发送 `min(max_tokens, context_window − estimated input − safety margin)`，所以小窗口模型不用手动调整也能正常工作。在 Web 端整表保存时省略这个字段会把它清空 |
| `client_type` | 协议提示（`openai-chat` 对应 Chat Completions，`openai-responses` 对应 Responses API，`ant-messages` 对应 Anthropic Messages 等）；省略时由 AgentHub 根据模型 id 推断。自定义端点使用这三种通用协议客户端之一，Web 弹窗可以检测一个 base URL 对应哪一种。`openai` 是 0.4.2 之前的旧写法，已弃用，读取配置时会归一化为 `openai-chat` |
| `display_name` | 展示名称 |
| `vision` | 是否支持图像输入，默认 true |
| `fast_mode` | 可选的快速模式（默认关闭）：开启后，这个模型的 Session 请求会改走供应商更快的服务层级，价格更高。持久化保存的值只有 `true`；在 Web 端整表保存时省略这个字段会把它清空。没有快速层级的模型会拒绝携带这个设置的请求（参见[快速模式](#快速模式)） |
| `pricing` | 三档价格（单位 `usd_per_mtok`，即每百万 Token 的美元价格）：`cache_read` / `cache_write` / `output` |
| `api_key` / `base_url` | 内联的凭证，两项都可选；留空时 AgentHub 回退到环境变量 |

文件里还保存着 `default_model`，以及可选的 `vision_model`，也就是视觉代理模型。文件结构（示例）：

```toml
default_model = { provider = "deepseek", model_id = "deepseek-flash" }
vision_model = { provider = "google", model_id = "gemini-3.1-pro-preview" }

[[models]]
provider = "deepseek"
model_id = "deepseek-flash"
context_window = 1000000
client_type = "deepseek-v4"
base_url = "https://api.deepseek.com"

[[models]]
provider = "custom"
model_id = "my-model"
client_type = "openai-chat"
base_url = "https://llm.example.com/v1"
api_key = "sk-..."
```

## 应用归因

有些网关会读取一个请求头，把调用记到发起调用的应用名下，用于自己的应用排行、用量报告或路由。

模型目录按**端点主机**决定这些请求头，而不是按条目所属的供应商分组。归在 custom 下的条目，只要 base URL 指向这类网关，就会带上同样的请求头。只看条目自己的 `base_url`：通过 `OPENAI_BASE_URL` 提供的端点在 AgentHub 内部解析，条目这一侧看不到，因此不会归因。

| 端点 | 请求头 | 值 |
| --- | --- | --- |
| `openrouter.ai` | `HTTP-Referer` | `https://penguin.ooo/` |
| `openrouter.ai` | `X-OpenRouter-Title` | `PenguinHarness` |
| `openrouter.ai` | `X-OpenRouter-Categories` | `cli-agent,personal-agent` |
| `tokendance.space` | `X-App-URL` | `https://penguin.ooo/` |
| `opencode.ai` | `x-opencode-session` | Session id，仅在已知 Session id 时发送 |

其他端点，包括所有直连厂商和不读取这类请求头的网关，都不会收到额外的请求头。OpenRouter 和 TokenDance 的请求头只表明应用身份。OpenCode 的请求头标明对话，因为那个网关靠它来路由每段对话；没有任何请求头携带用户或 Agent 的信息。

## 工作原理

### 统一网关

所有模型访问都走同一个网关库：`@prismshadow/agenthub`（AutoLLMClient）。核心只定义了一个轻量的 `LLMInterface`（参见[接口契约](/interfaces)）。按供应商做协议适配的工作放在 AgentHub 内部完成，因此 1000 多个在线和本地模型都能接入，包括任何 OpenAI 兼容端点。协议转换的代码在 `packages/core/src/llm/generative-model.ts`。

### 模型标识

模型的标识永远是 `(provider, model_id)` 这一对。`provider` 是配置分组名，`model_id` 是上游请求 id，原样发给 AgentHub。两者是独立的字段，流水线中的任何环节都禁止把它们拼成一个字符串。

凡是要指定模型的接口，都要求给出完整的一对值：CLI、HTTP API 和 SDK 遇到只写一半的引用会直接拒绝，而不是替你补全。供应商不会从模型 id 推断，也没有默认值，因为网关会按上游 id 转售厂商模型；一旦猜错分组，条目的凭证就可能发给一个没人指定的厂商。

在模型引用可选的地方（`penguin run` / `chat`、创建 Session、定时任务），选择只有两种：给完整的两个字段，或者都不给。两个字段都省略时，使用 Project 的默认模型。

### 模型与 Agent

Agent 从不绑定模型。模型在创建 Session 时确定，之后在整个 Session 期间保持不变，所以同一个 Agent 可以用不同模型运行不同的 Session。

Session 内的 `/model` 命令通过交接来切换模型：

1. 为同一个 Agent 在新模型上新建一个 Session，仍在当前 Workspace 里。
2. 新 Session 的第一条消息会带一个 `[model_switch_from]` 块，包含源 Session 的 id 和它的 Trace 文件路径。

历史不会注入新的上下文。有些模型在重放历史时需要 thinking 载荷和 `fidelity`，而这些内容无法跨模型使用。模型需要时会自己去读 Trace 文件，源 Session 保持不变。
