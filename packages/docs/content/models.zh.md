---
title: 模型与供应商
description: 为 Project 添加模型，设置 API key 和默认模型，选择思考等级和快速模式。
---

每个 Project 都有一张自己的模型表：里面是它的对话可以使用的模型，按供应商分组，并附有凭证、限制和价格。你在**模型库**页面管理这张表。Agent 不会绑定到任何模型；对话开始时才选定模型。

- 要了解页面布局，见[模型库页面](#模型库页面)。
- 要添加模型，见[新增模型分组](#新增模型分组)、[添加模型](#添加模型)或[用 AI 创建模型分组](#用-ai-创建模型分组)。
- 要为模型提供凭证，见[设置 API key](#设置-api-key)和[分组设置](#分组设置)。
- 要选择新对话使用的模型，见[设置默认模型](#设置默认模型)。
- 要调整请求，见[思考等级](#思考等级)和[快速模式](#快速模式)。
- 内置供应商的完整列表和文件格式，见[内置供应商分组](#内置供应商分组)和 [Project 模型表](#project-模型表)。

## 模型库页面

在侧边栏选择**模型库**。模型按分组列出，每个供应商一个分组。

- **分组**：内置分组按[内置供应商分组](#内置供应商分组)里的顺序排列；你创建的分组排在后面，按名称排序。没有模型的内置分组会隐藏；**Custom** 始终显示。**TokenDance** 分组带有**官方推荐**标签。
- **收藏与折叠的分组**：TokenDance、Penguin Go、DeepSeek、OpenRouter、Google Gemini、OpenAI 和 Anthropic 默认已收藏，始终显示。其余分组（包括你创建的分组）排在它们下方，收在一条通栏的折叠条里，折叠条写明其中的分组数，例如「其余 11 个分组」；点击折叠条即可展开或收起。它们默认收起，浏览器会记住你的选择。要收藏某个分组或让它可以折叠，把鼠标移到分组标题上或用键盘聚焦它，再点击名称后面的星标（**收藏**或**取消收藏**）；把分组拖到另一个区域的分组标题上，也会把它移过去。收藏保存在当前浏览器里，对所有 Project 生效。搜索期间，两个区域里匹配的分组都会显示，折叠条隐藏。
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

点击卡片即可打开**模型配置**。其中的链接分别打开供应商的模型列表（**获取模型 id**）、模型的主页（**模型主页**），以及和分组设置弹窗一样，打开供应商的密钥控制台（**前往密钥管理**）。

分组标题栏左侧是供应商 logo、分组名、模型数、随分组展开而转向的箭头，鼠标悬停或聚焦时其后还有收藏用的星标。右侧从左到右依次是：

- 分组的余额：TokenDance 和 DeepSeek 分组有 key 之后显示；点击金额打开菜单，可以置顶或更新余额，见[账户余额](#账户余额)；
- 连接状态：TokenDance、Penguin Go 和 ModelScope 未连接时为**未连接**，点击即开始连接；已连接时为一个**已连接**菜单，内含**同步模型**（仅 Penguin Go）、**重新连接**和**断开连接**，见[连接账户](#连接账户)；
- **添加模型**（加号图标）：只在 **Custom**、**vLLM**、**OpenRouter**、**TokenDance**、**SiliconFlow** 和你创建的分组，见[添加模型](#添加模型)；
- 测速与**设置**（齿轮）：每个分组（包括 **Custom**）都以这两个按钮收尾，因而在每个分组都对齐在同一条右缘上，见[测速](#测速)和[分组设置](#分组设置)。

TokenDance 分组还没有 key 时，所有分组上方会有一条横幅，推荐连接 TokenDance 钱包，这样分组里的模型不用手动配置密钥。横幅上的**连接**与分组标题栏上的是同一个流程。点击 × 可以在当前浏览器里隐藏横幅。

标题栏上没有单独填写 key 的按钮：分组密钥在[分组设置](#分组设置)里填写，或在连接分组时写入。

只有 Project owner 能修改模型和凭证。成员可以搜索、展开和收起分组，在自己浏览器里调整分组顺序和收藏，查看、置顶和更新余额，以纯文字查看连接状态，也能以只读方式打开**模型配置**。

## 新增模型分组

你创建的分组和 **Custom** 分组一样：里面的模型使用某种通用协议，并且需要一个 base URL，模型自己的或分组的（见[分组设置](#分组设置)）。

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
2. 在 **API key** 里输入该端点的密钥。端点不是厂商自己的地址时，服务端的 `OPENAI_*` / `ANTHROPIC_*` 变量不会被使用（见[设置 API key](#设置-api-key)），不填 key 的导入会被拒绝。
3. 在**自定义 base URL** 里输入端点的 base URL。
4. 点击字段右上角的**检测协议**，或者在字段最右侧的菜单里选择协议。见[检测自定义模型的协议](#检测自定义模型的协议)。
5. 点击**批量导入模型**。PenguinHarness 会向端点请求模型列表，然后按端点返回的顺序把所有模型保存到新分组。

你填写的 base URL、协议和密钥作为分组设置只保存一次；导入的模型都不带这些信息，全部跟随分组。端点只提供模型 id：价格、上下文窗口和显示名都留空，视觉保持关闭，直到你检测或手动开启。这和手动添加的模型起点相同。

有些 id 不会导入，结果里会说明跳过的数量：「已导入 {added} 个模型，跳过 {skipped} 个条目」。跳过的情形包括：id 为空、超过 200 个字符、包含控制字符，或者已被占用。

如果协议无法列出模型（「该协议不支持列出模型，请手动添加」），或者列表为空，什么都不会保存，弹窗保持打开。检测失败只会把协议后缀变成琥珀色；你仍然可以手动选择协议，或者改回**仅新增分组**。

列出模型走的是 `POST /api/projects/:id/models/list`（仅 owner 可用），它会以 20 秒为限，在该协议对应的客户端上调用 MMSP 的 `listModels()`。

### 删除分组

1. 在你创建的分组标题上，点击**删除分组**。
2. 确认删除。

分组里的所有模型、对应的 API key 和分组设置都会一并删除。内置分组无法删除。

## 添加模型

**添加模型**只在 **Custom**、**vLLM**、**OpenRouter**、**TokenDance**、**SiliconFlow** 和你创建的分组的标题栏上。其余内置分组（厂商分组与其余网关分组）只承载内置模型，见[只承载内置模型](#只承载内置模型)。

1. 在分组标题上，点击**添加模型**（加号图标）。
2. 在**模型 ID** 里输入模型 id，必须与供应商 API 要求的完全一致，例如 `qwen3-32b`。**获取模型 id** 会打开供应商的模型列表。
3. 可选：在**模型名称**里输入显示名。显示名为空时直接显示模型 id。
4. 确认**分组**：默认是你点击的那个分组标题栏所在的分组。
5. 可选：展开默认折叠的**详细配置**，填写其余各项。新模型继承分组的连接信息，其中的连接字段都是覆盖值：
   - **API key** 与**自定义 base URL**：分组设置了该字段时，占位文字为「留空继承分组设置」；留空即跟随分组，填写的值即成为该模型自己的值。模型必须有 key，自己的或分组密钥都可以：这些分组指向的都不是厂商自己的端点，这样的端点不会使用任何环境变量。在 **OpenRouter**、**TokenDance** 和 **SiliconFlow** 留空 base URL 即使用分组上的网关端点；其余分组必填，除非分组设置里已经给出。
   - 协议：在 base URL 字段的后缀里选择，或用**检测协议**探测，见[检测自定义模型的协议](#检测自定义模型的协议)。
   - **上下文窗口**：模型的上下文窗口大小，单位是 Token。模型不在内置模型目录里时，留空会保存为 1000000。
   - **最大输出长度**：每次请求最多输出的 Token 数。留空则使用 Agent 的设置；上下文较小的模型建议调低这个值。
   - **缓存命中价格**、**缓存未命中价格**和**输出价格**：按每百万 Token 填写，用页面上显示的币种；存储时统一换算成美元。三项要么全填，要么全不填。
   - **支持视觉**：模型能接收图片时打开，或者点击**检测**，见[检测视觉支持](#检测视觉支持)。在 **Custom** 分组和你创建的分组里，新添加的模型默认关闭视觉；加到 **vLLM** 分组的模型默认开启视觉。
   - **快速模式**，见[快速模式](#快速模式)。
   - **测试连通性**，见[测试连通性](#测试连通性)。
6. 点击**确认**。**详细配置**里有必填项缺失或无效时（例如 **Custom** 模型既没有自己的、也没有分组的 base URL），**确认**会展开**详细配置**并定位到该字段。

新模型使用哪种协议，取决于所在的分组：

- **vLLM** 使用 `openai-chat-vllm-adapter`，**OpenRouter** 使用 `openai-responses`，**TokenDance** 和 **SiliconFlow** 使用 `openai-chat`，即新建 Project 时写进分组设置的协议。模型本身不存协议，跟随分组。
- **Custom** 和你创建的分组：分组设置了协议时用分组的；否则在 base URL 字段里选择协议，或者检测协议。见[检测自定义模型的协议](#检测自定义模型的协议)。

### 只承载内置模型

除 **Custom**、**vLLM**、**OpenRouter**、**TokenDance** 和 **SiliconFlow** 以外，每个内置分组只承载 PenguinHarness 内置模型目录里的模型。这些分组的 key 按分组统一管理，组里有哪些模型由目录决定。

- 这些分组没有**添加模型**，**模型配置**的分组下拉里也不提供把模型移进这些分组。
- 服务端会拒绝往这些分组新增不属于该分组内置模型的条目：保存时提示「该分组只承载内置模型」。`penguin config model add` 同样拒绝。删掉的内置模型可以重新加回来，**同步新增模型**做的就是这件事。
- 这些分组里已有的模型原样保留，包括此前你在网关分组里自行添加的。它们照常可用，可以编辑、在本组内改名或删除。
- 厂商分组（DeepSeek、Google Gemini、OpenAI、Anthropic、Z.AI、Moonshot、MiniMax）只支持厂商自己的 API。如果其中某个模型的 id 无法按这种方式路由，它会带上警示，并提供**移到自定义分组**。OpenAI 兼容的端点请放进 **Custom** 分组。
- 网关分组沿用新建 Project 时为它写入的协议：OpenRouter 使用 `openai-responses`，其余 OpenAI 兼容网关使用 OpenAI Chat Completions。聚合分组 Penguin Go 与 OpenCode Go 的内置模型各自存着自己的协议。

### 编辑或删除模型

点击模型卡片，打开**模型配置**。修改字段，点击**确认**，再确认保存。在同一个弹窗里，你还可以**测试连通性**、**设为默认模型**、**设为视觉代理模型**或**删除模型**。

API key、base URL 与协议始终可见；上下文窗口、**最大输出长度**、价格、**支持视觉**和**快速模式**收在**详细配置**里，每次打开弹窗都默认折叠。模型交给分组的 API key 或 base URL，占位文字为「留空继承分组设置」，不附带分组的具体值。

修改**模型 ID** 或**分组**会重命名这条记录；凭证以及默认模型、视觉代理的角色都会跟着迁移。**删除模型**会删除模型的配置和 API key。

## 用 AI 创建模型分组

**用 AI 创建**用来处理导入读不了的情况：模型列表页面不是 OpenAI 兼容的 `/models` 端点、只有文字描述的服务，或者要把内置模型加回它所在的分组。

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

**Custom** 分组和你自己创建的分组里的模型，使用的都是 MMSP 的某一种通用协议，弹窗可以检测出一个 base URL 到底支持哪一种。新建的自定义模型一开始没有选择协议：base URL 输入框右端的后缀显示为**选择协议**。

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

检测从不阻塞保存。模型和分组都没有设置协议时点击**确认**，会先执行检测，按钮显示**检测中…**。检测到协议就直接保存，不再提示。检测不到时模型照样保存，协议定为 OpenAI Chat Completions，并提示「未检测到协议，已按 OpenAI Chat Completions 保存」。

### 探测原理

- 探测请求是请求体为 `{}` 的最小无效请求，不消耗 Token，也不需要有效的模型 id：返回的错误若符合协议自身的格式，就证明路由存在；返回 `404` 或 `405`，说明路径没有提供服务；HTML 或网关杂讯一律不算数。
- 探测用的 URL 和认证头，与保存后 MMSP 客户端实际使用的完全一致：OpenAI 系协议用 `Authorization: Bearer`，`ant-messages` 用 `x-api-key` 加 `Authorization: Bearer` 和 `anthropic-version`。所以检测出的协议一定真实可用。
- 服务端按四步选取探测凭据：优先用弹窗里填写的 API key，其次用这个条目已保存的 key，再次用分组密钥，最后用探测目标协议对应的环境变量（`ant-messages` 用 `ANTHROPIC_API_KEY`，两个 OpenAI 协议用 `OPENAI_API_KEY`）——但只在被探测的 URL 是该厂商自己的端点时才会使用。每发一次探测都会重新选择，因为此刻要确定的就是协议。这些值不会传到浏览器，也不会出现在响应里。
- 完全没有凭据也能检测，因为协议格式的 `401` 同样能识别路由。因此网关或私有服务器一律匿名探测：你的厂商 key 不会发往你输入的 URL。
- 在这些分组里，不会从模型 id 推断任何东西。在自定义分组里输入 `claude-sonnet-5`，不会因此选用 Anthropic 客户端或它的 `ANTHROPIC_*` key：自定义分组一律回退到 `openai-chat`，API key 提示也照此显示。供应商分组和网关分组不受影响：它们的模型按 id 或按分组上存的协议路由。
- 在检测功能出现之前创建的条目，保留 `client_type = "openai"`，它至今仍是 `openai-chat` 的别名。只有手动选择协议、或某次检测生效时，才会改写这个值。旧的非标准协议值以只读方式显示：「协议：{t}（沿用原配置，不可修改）」。
- 检测也可以通过 `POST /api/projects/:id/models/detect` 调用（仅 owner 可用），参见 [Server API](/server-api)。

## 检测视觉支持

**支持视觉**开关可以一直关着，等你需要时再去问模型。点击开关旁的**检测**：PenguinHarness 会向模型发送一张 1x1 的 PNG，配一句只有一个词的提示。

- 模型能回答，开关就打开：提示「该模型接受图片输入，已开启视觉」。
- 模型表示自己不接受图片，开关就关闭。这是真实的回答，不是错误。
- 探测因认证或网络问题失败时，开关保持原样，提示会请你检查 API key 和 base URL。

> [!NOTE]
> 和协议检测不同，这一探测是真实、计费的请求：图片请求无法像协议探测那样做到免费。它只在你点击**检测**时执行，绝不会自动运行，也不会在保存时运行。

凭据来源和连通性测试是同一条链路：先用弹窗里填写的 key，其次用模型已保存的 key，再次用分组密钥，最后在端点允许的范围内用环境变量（见[设置 API key](#设置-api-key)），全部在服务端解析。**支持视觉**只对不在内置模型目录里的模型显示；目录里的模型本身就声明了是否接受图片。

## 设置 API key

每个分组存一把 key，即**分组密钥**，组内没有自己 key 的模型都使用它，前提是模型访问的是分组的端点。在单个模型上设置的 key 是该模型自己的，优先于分组密钥。

- **整个分组。** 在[分组设置](#分组设置)（分组标题栏上的齿轮）里填写，或由[连接账户](#连接账户)写入。两种方式写的都是分组密钥；单个模型上设置的 key 不受影响。
- **单个模型。** 在**模型配置**里，把 key 填入 **API key**。保存后 key 会打码显示；输入框留空即保留原 key，点击**清除已存 API key** 可删除它，此后该模型重新使用分组密钥。使用分组密钥的模型同样打码显示这把 key。
- **其他端点。** key 属于签发它的端点：分组密钥只借给没有自己 base URL 的模型，或自己的 base URL 与分组 base URL 同 origin（scheme、host、port）的模型。OpenCode Go 的 Anthropic Messages 模型位于分组主机的另一条路径上，照样使用分组密钥。指向别的主机的模型取不到分组密钥，需要自己的 key，例如经代理访问的某个 OpenRouter 模型，或 **Custom** 里自带端点的预置模型 Atria Dawn Preview——**Custom** 的 key 因此不会发往它的主机。这样的模型卡片显示**未配置 key**，**模型配置**的 key 输入框会说明分组密钥不适用。
- **不配 key。** 模型自己没有 key、也没有能借到的分组密钥时，**只在请求确实发往该供应商的官方端点时**使用服务端上供应商的环境变量：模型和分组都没有设置 base URL（此时按 MMSP 自己的 `*_API_KEY` / `*_BASE_URL` 配对），或模型实际使用的 base URL 是厂商自己的端点。模型或分组的 base URL 指向别处时，一律不由环境变量覆盖，即使 `OPENAI_BASE_URL` 指向同一台服务器也不例外：在分组设置里指向代理的 DeepSeek 分组不会使用 `DEEPSEEK_API_KEY`。网关分组（TokenDance、OpenRouter、Fireworks AI、SiliconFlow、两个 Qwen 网关、ModelScope）、**Custom**、**vLLM** 和你创建的分组指向别的端点，其中的模型必须有自己的 key 或分组密钥：在这些分组里对没有 key 的模型发起会话、连通性测试或分组测速，会以「has no API key」失败，而不是借用 `OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`。Penguin Go 分组是唯一的例外，它回退到自己的 `PENGUIN_GO_API_KEY`，从不使用厂商变量。key 来自环境变量时，卡片和弹窗都会显示这一点；参见[内置供应商分组](#内置供应商分组)。

你填写的 key 存在 Project 的隐藏配置文件里，文件权限为 0600。Web App 里它始终打码显示。

### 连接账户

内置分组里有三个可以替你取得 key：TokenDance、Penguin Go 和 ModelScope。它们的标题栏上显示**未连接**，点击即开始连接。分组里存有分组密钥之后（不论这把 key 是怎么写进来的；单个模型上设置的 key 不算），它变为**已连接**，点开是一个菜单：

- **同步模型**：仅 Penguin Go，见 [Penguin Go 分组](#penguin-go-分组)；
- **重新连接**：重走连接流程，换一把新 key 或换一个账户；
- **断开连接**：确认后删除分组密钥。使用分组密钥的模型将无法调用，单独设置了 key 的模型不受影响。标题栏随即回到**未连接**，余额未置顶即随之消失。

成员看到的连接状态只是文字，不带菜单。连接取得的 key 成为分组密钥，单独设置了 key 的模型保留自己的 key。

1. 在分组的标题栏上，点击**未连接**。
2. 点击**打开授权页**。供应商的授权页会在新标签页中打开。
3. 在授权页完成授权。弹窗显示「等待在新标签页中完成授权…」，并自动报告结果。

TokenDance 会为你的账号创建一把**新** key，不会读取你已有的 key。供应商会把浏览器带回 PenguinHarness，由 PenguinHarness 用一次性授权码换取并保存 key。如果授权页跳不回来，比如浏览器无法访问重定向给出的服务器地址，点击**授权页跳不回来？改为手动填写授权码**。授权页随后不再重定向，改为直接显示一次性授权码。

1. 把授权码粘贴进**授权码**输入框。
2. 点击**提交授权码**。

Penguin Go 有四处不同：

- 结果由服务端向 Penguin Go 轮询获取，因此这个分组没有手动填写授权码的方式。
- 已连接后，**已连接**菜单里的**同步模型**再次读取平台的模型目录，见 [Penguin Go 分组](#penguin-go-分组)。**重新连接**依然保留，可以换成另一个平台账号的 key。
- 平台报告 key 失效或被吊销时，**模型库**页面会重新打开授权。
- 取到的 key 写入本地失败时，服务端会把这一次交付短暂保留，可以直接重试写入，不必再次授权。

ModelScope 有三处不同：

- 授权不经过魔搭自己的页面，而是经过一台**授权中转层**。中转层持有魔搭的 client secret，代 PenguinHarness 走完 OAuth，再把一把可直接调用 api-inference 的 access token 交回来。中转层的地址来自服务端环境变量 `MODELSCOPE_BRIDGE_URL`，见[环境变量](/configuration#环境变量)。
- 授权页的地址由中转层给出，PenguinHarness 原样打开，不像 Penguin Go 那样自己拼。同样没有手动填写授权码的方式。
- 拿到的 access token 是**会过期**的；PenguinHarness 会在服务端保存刷新凭据，并在模型请求前静默续期。刷新凭据失效或缺失时，才需要点一次**重新连接**。

注意事项：

- 只有 Project owner 能发起连接。TokenDance 还要求由他本人已登录的会话完成授权，实际上就是打开着弹窗的那个标签页。重定向本身不要求会话就能接收，因为供应商带回的浏览器未必是你发起授权时用的那个；但它只交回授权码：在弹窗来取结果之前，不会发生任何换取，也不会保存任何 key。
- 整个换取过程都在服务端完成。TokenDance 的 PKCE verifier、Penguin Go 的设备密钥、以及 ModelScope 的授权码和设备密钥都不会进入浏览器；新 key 直接写入模型表，同样不经过浏览器。ModelScope 的 client secret 从头到尾都不在 PenguinHarness 里，只有中转层持有。
- 一次授权流程最多等待十分钟。ModelScope 交付的是一组 access token / refresh token：access token 写为分组密钥，refresh token 只保存在服务端 DB，不返回给前端，也不写入 Project 配置。
- 交付回来的 key 只交一次。Penguin Go 和 ModelScope 都会在本地保存失败时短暂保留这一次交付，因此可以直接重试写入，不必再次授权。ModelScope 下无需去魔搭控制台清理——它交回的是你自己账号的 token，不是新造的 key。
- TokenDance 的 key 携带[应用归因](#应用归因)表中 PenguinHarness 的应用 URL，所以即使用其他工具发起调用，用量也仍会归到 PenguinHarness 名下。

### 账户余额

TokenDance 和 DeepSeek 可以查询 key 所属账户的余额。这两个分组有 key 之后，标题栏上会显示余额，币种跟随设置里的**币种**，与价格一样按固定汇率 7 换算。余额始终用**分组密钥**查询：单个模型上设置的 key 一概不算，组内模型的 key 各不相同也不影响余额。没有分组密钥时，DeepSeek 使用服务端的 `DEEPSEEK_API_KEY`，即它的模型本来就会使用的环境变量（见[设置 API key](#设置-api-key)），除非分组设置把它指向了别的 base URL；TokenDance 是网关，key 必须存到分组上。账户持有多种货币时显示合计：¥110 加 $5 显示为 `¥145`，或 `$20.71`。查询由服务端用已存的 key 发起，key 不会到达浏览器。

- 点击金额打开菜单，共三行：**置顶至左下角**（置顶后为**取消置顶**）；**更新余额**，重新查询余额，跳过服务端保留一分钟的缓存；以及「更新于：YYYY-MM-DD HH:mm」，即查询时间，按本地时间显示。
- 查询不到余额时显示「—」，菜单最后一行为「更新失败：」加原因。
- **置顶至左下角**把余额显示在侧边栏左下角你的名字旁边，币种相同；**取消置顶**即撤下。同一时间只能置顶一个余额，置顶另一个即替换。置顶记在你的账户上，而不是浏览器里，成员同样可以置顶。置顶的余额在应用加载时查询一次，此后每五分钟刷新一次。

余额通过 `GET /api/projects/:id/models/balance?provider=<分组>` 查询，Project 的所有成员都可以调用。

## 分组设置

每个分组的标题栏都以**设置**（齿轮）收尾，**Custom** 也不例外；只有 Project owner 能看到它。点击后打开「{分组} 分组设置」，编辑组内模型共用的连接信息：API key、base URL 和协议，存在该分组的 `[providers.<分组>]` 表里。

这些值的唯一来源是 Project 配置文件。每个字段各自解析，取第一个找到的值：先是模型自己的，其次是分组的，都没有即交给客户端缺省：缺省端点、按模型 id 路由，以及[设置 API key](#设置-api-key) 允许时的环境变量。内置模型目录只是参考，不是一层回退：新建 Project 时，目录已把各网关的端点与协议写进这里的分组设置，构建请求时从不读目录。因此模型留空的字段跟随分组，模型上设置的值只对该模型生效。分组密钥只借给访问分组端点的模型，见[设置 API key](#设置-api-key)。

各字段显示的是分组存的值：

- **API key**：即分组密钥，与连接时写入的是同一把；标题栏上没有别处可以填写它。已存的 key 打码显示，并附设置时间；留空即保留原值，勾选**清除分组密钥**可删除它。分组可以由环境变量兜底时（见[设置 API key](#设置-api-key)），占位文字会说明留空即使用该环境变量。供应商的密钥控制台链接在标签旁。
- **自定义 base URL**：占位文字为「未设置：使用客户端默认端点」。整个分组回到目录的端点请用**恢复默认**。右上角的**检测协议**用所填的 base URL（未填则用已存的），以及输入框里的 key（没有则用分组密钥）探测；两个 URL 都没有时不可用。见[检测自定义模型的协议](#检测自定义模型的协议)。
- **协议**：首项**未设置**把协议交给各模型，模型也没有时按模型 id 路由；其余选项是各通用协议。每个分组都可以设置协议，Penguin Go 和 OpenCode Go 也不例外：模型上存的协议始终优先，分组协议只作用于没有自己协议的模型。

字段下方的**前往模型列表**在新标签页中打开供应商的模型列表；**Custom** 和你创建的分组没有这个链接。

保存只提交改动过的字段，不做检测，只有一个例外：在 **Custom** 或你创建的分组里，协议为**未设置**、组内也没有模型自带协议时保存 base URL，会先检测一次。在这些分组里，只要组内有模型没有自己的 base URL，分组的 base URL 就必填。

同样的设置也可以用不带 `--model-id` 的 `penguin config model add --provider <分组>` 完成，`penguin config model list` 会列出它们（见 [CLI 参考](/cli#penguin-config)）；API 为 `PUT /api/projects/:id/models/providers/:provider`（仅 owner 可用）。

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

1. 在分组标题栏上点击测速图标（**测速**）。
2. 点击**开始测速**。

PenguinHarness 依次向每个模型发送一个真实请求，这会消耗少量 API 配额，然后在每张卡片上显示：

- 首个 Token 的延迟，单位毫秒：低于 1000 显示绿色，1000 到 3000 显示黄色，3000 以上显示红色；
- 输出速率，单位 Token/秒：40 及以上显示绿色，15 及以上显示黄色，15 以下显示红色。

测速进行中，同一个图标用来停止（**停止测速**）：正在测的那个模型测完后停止，不再发起后续请求，已有的结果保留。结果只留在当前页面，刷新后就消失。

## 同步新增模型与恢复默认

PenguinHarness 升级可能往内置目录里增加预置模型。只要目录里有 Project 缺少的预置模型，Project owner 就会看到：

- 侧边栏**模型库**上出现红点，只计新模型；
- 页面上出现通知「{n} 个新预置模型可同步」，附带**现在升级**和**忽略**按钮；
- 页头出现**同步新增模型**按钮，只在有可补入的模型时显示。

**现在升级**和页头的**同步新增模型**打开同一个确认框，列出将要补入的模型，确认后补入。点击**忽略**后，通知会隐藏，直到目录再次变化才重新出现。

同步新增模型时会：

- 补入 Project 还没有的目录预置模型，包括你删掉的，退役条目除外（见[预置模型](#预置模型)）。补入的模型带目录事实，协议与端点只在它自己的目录值与分组的目录值不同时写在条目上，与新建 Project 时一样：你把分组指向代理后，补入的模型同样走代理。分组设置缺某一项时（你清除过，或升级时无法移到分组上），补入的模型在条目上带该项的目录值，以免落到客户端缺省的端点或协议、把分组密钥带到别处；
- 只为 Project 里既无模型、也无分组设置的内置分组（例如目录新增的分组），按目录补写其分组设置；
- 为补入的模型写入促销折扣；
- 绝不改动 Project 已有的模型：它们的价格、上下文窗口、视觉标志、显示名、协议和折扣都可能是你改过的。你自己添加的模型和分组、已有的分组设置、API key，以及默认模型与视觉代理模型同样不动。

因此目录对已有模型的修正（如新的价格或上下文窗口）只能经**恢复默认**或手动编辑该模型生效。

**恢复默认**在**同步新增模型**旁边，owner 始终可见；确认（「恢复默认模型设置」）后把内置模型恢复为目录的出厂设置。此操作不可撤销。

- 内置模型（包括已退役的）的上下文窗口、价格和视觉标志回到目录值，显示名、**最大输出长度**和快速模式清除。
- 内置模型上和 **Custom** 以外的内置分组设置里的 base URL 与协议回到目录值，形态与新建 Project 时相同：目录没有值的设置项移除，缺少分组设置的内置分组补建。**Custom** 的分组设置服务于你在其中添加的模型，保留不动；**vLLM** 的 base URL 是你自己的服务器，同样保留，只有分组协议回到目录值。
- 你删掉的内置模型补回，追加在表尾。
- 促销折扣按目录重置；Penguin Go 分组的折扣归平台所有，保留不动，你自己添加的模型的折扣同样保留。
- 保留的内容：全部 API key（分组的与模型的）；你自己添加的模型与分组及其设置；默认模型与视觉代理模型——默认模型不再指向任何模型时改为目录默认，视觉代理模型不再支持图片时清除。
- 内置分组没有分组密钥、组内带 key 的模型都用同一把 key，且这把 key 放到分组上仍能借给它们全部时，它移到分组上，模型上的副本随之删除。key 只换位置，不会删除。

结果提示「已恢复默认：补回 {added}、重置 {restored}」。两个操作都在服务端执行，即 `POST /api/projects/:id/models/sync-presets`，`mode` 为 `add` 或 `restore`（仅 owner 可用）。

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

开启快速模式后，对话请求会带上 MMSP 的 `fast_mode` 标志：

- OpenAI 协议客户端（包括 MiniMax 的官方客户端）和 Gemini 的官方客户端发送 `service_tier: "priority"`。
- Anthropic 协议客户端发送 `speed: "fast"`，并附带 fast-mode beta 请求头。

快速层级按供应商的溢价价格计费：MiniMax 收标准费率的 1.5 倍，OpenAI 和 Anthropic 则各自公布单独的溢价费率。

> [!WARNING]
> 记录的每 Token 价格不会随之改变，所以除非你调高条目里的价格，快速模式用量显示的成本会偏低。

### 哪些模型支持快速模式

存不存在快速层级，取决于模型路由到的 MMSP 客户端，而不是模型条目。只有客户端确实会发送这个参数时，开关才会出现：

| 路由到的客户端 | 快速模式 |
| --- | --- |
| OpenAI 协议（`openai-official`、`openai-responses`、`openai-chat`、`openai-chat-vllm-adapter`）、`minimax-official`、`gemini-official`（Interactions API） | 以 `service_tier: "priority"` 发送 |
| Anthropic 协议（`anthropic-official`、`ant-messages`） | 以 `speed: "fast"` 发送，外加 beta 请求头 |
| `zai-official`、`moonshot-official`、`deepseek-official`、`google-genai`、OpenAI embeddings | 拒绝，不显示开关 |
| Bedrock 上的 `anthropic-official`，或 Claude 4.6、Sonnet 5.5、Haiku 5.5、Fable 5.1 的 id | 拒绝，不显示开关 |

路由跟随条目的 `client_type`；没有设置时，由 `model_id` 开头的厂商系列（`gpt-`、`text-embedding-`、`claude-`、`gemini-`、`glm-`、`kimi-`、`deepseek-`、`minimax-`）指定该厂商的官方客户端。因此同一个上游 id 可能落到不同的客户端。添加在网关分组下的 Kimi 模型（`client_type = "openai-chat"`）可以使用快速模式，同一个 id 路由到 Moonshot 的官方客户端就不行。你自己 base URL 背后的 custom 模型会保留开关：它走 OpenAI 协议，背后很可能就是 OpenAI，但第三方服务器完全可以接受这个参数，然后照常按标准层级提供服务。

开关无法替你确认两件事：

- Anthropic 的快速模式目前是限量研究预览。在你的组织获得访问权限之前，请求会返回 429 限流错误。对 Anthropic 协议的模型，确认提示里会说明这一点。
- 服务端的环境可能把模型路由到开关没有预料到的地方：`CLIENT_TYPE` 为所有没有 `client_type` 的条目指定客户端；`ANTHROPIC_BASE_URL` 为没有 base URL 的 Claude 条目提供端点（`bedrock://` 端点没有快速层级）。

> [!NOTE]
> 如果请求仍然落到拒绝 `fast_mode` 的客户端，MMSP 会在发出任何网络请求之前直接拒绝。这一轮对话会立即结束，并给出供应商的消息和指向设置的提示。必定重复出现的拒绝不会重试。

如果条目在不支持快速模式的模型上保存了 `fast_mode = true`，弹窗里的开关仍然保留，并标记为不支持，你随时可以关掉它。

连通性测试会带上弹窗当前的快速模式状态，所以在保存之前，**测试连通性**就能显示快速模式的拒绝结果。后台请求（例如 Session 标题生成、`read_file` 的视觉代理读取）从不使用快速模式，只有对话本身的请求才会用。

## 连接本地或自托管端点

本地推理服务器可以通过两种方式加入 Project。

### 把模型添加到 vLLM 分组

把模型添加到 **vLLM** 分组。分组设置里存着协议 `openai-chat-vllm-adapter`，没有 base URL，所以要设置你的服务器地址：在分组的[设置](#分组设置)里填一次，组内所有模型共用，或者填在模型上。API key 同样如此：服务器的 key，服务器不校验 key 时随便填一个占位值也行。自带 base URL 的条目不会由服务端的 `OPENAI_API_KEY` 覆盖，没有 key 的条目会被拒绝。**恢复默认**会保留分组的 base URL。

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
- `api_key`：服务器的 key，服务器不校验 key 时填任意占位值——环境里的 `OPENAI_API_KEY` 不覆盖你自己的服务器

对这类服务器，协议检测会判定为 `openai-chat`；也可以通过 base URL 字段的后缀菜单手动选定。

### 让本地服务器顺畅运行

无论用哪种方式添加模型，都要检查两项设置：

- **在服务器上启用工具调用。** 对 vLLM，启动服务器时加上 `--enable-auto-tool-choice`，以及你的模型对应的 `--tool-call-parser`，例如 Qwen 用 `hermes`，Llama 3.x 用 `llama3_json`。缺少这些参数时，工具调用会以纯文本形式到达，Agent 循环无法执行任何操作。
- **把条目的 `context_window` 设为服务器的真实窗口。** 对 vLLM 来说就是 `--max-model-len` 的值，例如 `32768`。

单次请求的输出上限和压缩阈值都跟随这个窗口。请求会把 `max_tokens` 限制在窗口剩余空间内，压缩也会在窗口溢出之前运行，所以你不需要手动调整 `max_tokens`。

> [!NOTE]
> 如果这个字段留空，单次请求的输出上限不会生效，压缩会按 128000 的窗口计算，真实窗口更小的服务器会拒绝请求。

## 内置供应商分组

下表列出了各个内置分组，以及模型和分组都没有 key 时模型回退使用的环境变量。模型目录的源码位于 `packages/core/src/state/model-catalog.ts`。每个分组还有一个 `_BASE_URL` 变体，例如 `ANTHROPIC_BASE_URL`。**模型库**页面按这个顺序列出分组，你创建的分组排在后面。网关分组的条目使用网关自己的端点，因此**从不回退**：表里的变量是它们的协议客户端读取的那一个，而正因为它存的是你的厂商 key，它不会被发往网关（见[设置 API key](#设置-api-key)）。

| 供应商 | API key 环境变量 | 说明 |
| --- | --- | --- |
| tokendance | `OPENAI_API_KEY` | 推荐分组。OpenAI 兼容网关，预置 base URL `https://tokendance.space/gateway/v1`；模型 id 为裸名称，不带供应商前缀（如 `glm-5.3`、`kimi-k3`）；价格采用网关自己的人民币费率，目前有几项在打折 |
| penguin-go | `PENGUIN_GO_API_KEY` | 预置的中转分组，base URL `https://token.penguin.ooo/api`；分组标题栏可以为你连接取得 key，也可以在分组设置里填写。见 [Penguin Go 分组](#penguin-go-分组) |
| opencode-go | `OPENAI_API_KEY` | OpenCode Go 订阅网关。每个模型各自固定协议：Chat Completions 或 Responses 走 `https://opencode.ai/zen/go/v1`，Anthropic Messages 走 `https://opencode.ai/zen/go`（该客户端的变量是 `ANTHROPIC_API_KEY`）。见 [OpenCode Go 分组](#opencode-go-分组) |
| deepseek | `DEEPSEEK_API_KEY` | 默认模型所在的分组 |
| openrouter | `OPENAI_API_KEY` | OpenAI 兼容网关，预置 base URL `https://openrouter.ai/api/v1` |
| fireworks | `OPENAI_API_KEY` | Fireworks AI（OpenAI 兼容），预置 base URL `https://api.fireworks.ai/inference/v1`；API 模型 id 形如 `accounts/fireworks/models/<slug>` |
| google | `GEMINI_API_KEY` | |
| openai | `OPENAI_API_KEY` | |
| anthropic | `ANTHROPIC_API_KEY` | |
| siliconflow | `OPENAI_API_KEY` | OpenAI 兼容网关，预置 base URL `https://api.siliconflow.cn/v1` |
| zhipu | `ZAI_API_KEY` | |
| moonshot | `MOONSHOT_API_KEY` | |
| minimax | `MINIMAX_API_KEY` | `MiniMax-M3`，上下文窗口 1,000,000 Token，支持视觉，按 id 路由到 MiniMax 官方的 Responses 客户端（`minimax-official`）；无预置 base URL，请求发往 `https://api.minimax.io/v1`，除非 `MINIMAX_BASE_URL` 另有指定；接受 Token Plan 订阅密钥或按量付费 API key |
| qwen-pay-as-you-go | `OPENAI_API_KEY` | Qwen 按量付费（DashScope 的 OpenAI 兼容端点），预置 base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`；转售的第三方模型保留供应商前缀 id（如 `kimi/kimi-k3`） |
| qwen-token-plan | `OPENAI_API_KEY` | Qwen Token Plan 订阅网关，预置 base URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；价格取自各模型页面的官方牌价（预览模型只有配额倍率优惠，没有牌价） |
| modelscope | `OPENAI_API_KEY` | 魔搭的 OpenAI 兼容 api-inference 网关，预置 base URL `https://api-inference.modelscope.cn/v1`；id 就是上游仓库名（如 `deepseek-ai/DeepSeek-V4.1-Flash`、`Qwen/Qwen3.8-27B`）；分组标题栏可以经授权中转层为你自动授权一把 token，也可以手动设置。见 [ModelScope 分组](#modelscope-分组) |
| vllm | `OPENAI_API_KEY` | 自托管 vLLM 服务器：协议固定为 `openai-chat-vllm-adapter`，无预置 base URL，八个预置模型价格均为 0（见[连接本地或自托管端点](#连接本地或自托管端点)） |
| custom | `OPENAI_API_KEY` | 任意 OpenAI 协议端点；自带一个预置模型 Atria Dawn Preview（Anthropic Messages API，地址 `api.atria-asi.ai`，需要自己的 key，上下文窗口 256K，供应商公布价格之前定价 $0） |

OpenAI 兼容网关分组（openrouter / fireworks / siliconflow / tokendance / qwen-pay-as-you-go / qwen-token-plan）走的是 MMSP 通用的 OpenAI 协议客户端，对应变量是 `OPENAI_API_KEY`；其中没有 key 的条目会被拒绝，而不是把你的 OpenAI key 发过去。custom、vLLM 和自建分组同样如此，除非条目的 base URL 就是厂商自己的端点。ModelScope 也使用 `OPENAI_*` 凭据变量，因为它的凭据是 api-inference token，三条预置都固定使用通用 Responses 协议；没有 key 的 ModelScope 条目同样会被拒绝。

- OpenRouter 分组的预置模型，以及你添加到该分组的任何模型，都使用 Responses 客户端（`client_type = "openai-responses"`），因为 OpenRouter 在同一个 base URL 上为它转售的每一个模型提供 Responses API。
- 其他网关的预置模型使用 Chat Completions 客户端（`client_type = "openai-chat"`）。
- ModelScope 像 Penguin Go 一样是聚合网关，但三条预置都使用 MMSP 通用 Responses 客户端（`client_type = "openai-responses"`）。
- 这些网关客户端读取相同的 `OPENAI_*` 变量，所以无论哪种方式，凭据规则完全一致。
- OpenCode Go 分组是例外：它的模型用到三种协议，因此每个模型各自固定协议，见 [OpenCode Go 分组](#opencode-go-分组)。

MiniMax 的官方客户端读取 `MINIMAX_API_KEY`。内置的 MiniMax 预置模型不带 `base_url`，因此设置了 `MINIMAX_BASE_URL` 时用它，否则用 `https://api.minimax.io/v1`；和其他 `*_BASE_URL` 一样，只有条目没有自己的 `base_url` 时才会读取这个变量。

### Penguin Go 分组

`penguin-go` 和 TokenDance 一样是内置分组：一个中转服务，base URL 为 `https://token.penguin.ooo/api`，新建 Project 时写进分组设置。组内模型使用两种协议，因此各自存着自己的协议。新建的 Project 立即带上这个分组的目录模型；在该分组之前创建的 Project，用**同步新增模型**把它们补上。

分组的 key 从标题栏取得，见[连接账户](#连接账户)。连接以及**已连接**菜单里的**同步模型**还会读取平台自己的模型目录：

- 平台提供而 Project 没有的模型会被添加进来，连同协议、显示名、上下文窗口、视觉能力、牌价和促销折扣。分组设置里有 base URL 时，端点只在与平台的中转地址不同时写在条目上，因此指向代理的分组会把新模型一并带过去；分组设置里没有 base URL 时，条目带上平台的完整地址。它们不带 key，使用分组密钥。纯向量（embedding）模型不收录。
- Project 已有的模型原样保留，价格、协议和折扣都不动；任何模型都不会被删除。
- 和其他分组一样，`.project_config.toml` 里存的是牌价，促销存在服务端的数据库里。**恢复默认**保留这个分组的促销，它们归平台所有。这条记录丢失后，用量按牌价计价。

平台报的是高峰档费率，单位是每百万 Token 多少美元。分组里的 DeepSeek 条目跟随 DeepSeek 当前的模型阵容，只有 `deepseek-flash` 和 `deepseek-v4-pro`，并声明与直连 DeepSeek 分组相同的空闲时段，因此在北京时间工作日 9:00–12:00、14:00–18:00 之外，卡片和成本记录都按半价计算。

### OpenCode Go 分组

`opencode-go` 收录 OpenCode 为 Go 订阅列出的 27 个模型。它们共用一把 key：在分组设置里填写一次即可。

- **协议。** OpenCode 把每个模型放在三个端点之一上。新建 Project 时，分组 base URL 写为 `https://opencode.ai/zen/go/v1`，供 Chat Completions（`openai-chat`）和 Responses（`openai-responses`）模型使用，每个模型各自存着 `client_type`；Anthropic Messages（`ant-messages`）模型另在条目上存 `https://opencode.ai/zen/go`，因为客户端会自行加上 `/v1/messages`。二者同一主机，分组密钥同样借给它们。与所有网关的条目一样，它们都不会回退到 `OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`：key 要设在分组上。
- **价格。** Go 按月订阅，用量上限是按模型计的美元额度：每月一份额度，每 5 小时最多用掉其中 20%，每周最多 50%。条目记录的是每次请求从额度中扣除的每 Token 价格，因此对这个分组而言，成本中心显示的是你用掉了多少额度，而不是一张账单。`gpt-5.6-luna`、`grok-4.6`、`qwen3.7-plus` 和 `qwen3.6-plus` 记录基础档，分别覆盖 272K、200K、256K 和 256K 输入 Token 以内。四个 DeepSeek 模型遵循 DeepSeek 的空闲时段，见[价格与促销](#价格与促销)。
- **开通与地区。** 在 key 所属的 OpenCode 工作区开通之前，有五个模型会直接报错。`muse-spark-1.3-contributor` 和 `muse-spark-1.2-contributor` 需要同意 Meta 用提示词和回复训练模型。`deepseek-v4.1-flash`、`deepseek-v4-flash` 和 `deepseek-v4-pro` 需要同意由中国境内托管的服务提供。部分模型还会拒绝来自某些地区的请求：从中国大陆访问时，`gpt-5.6-luna` 和两个 Muse Spark 模型都会报错。
- **会话请求头。** 发往该分组的请求会在 `x-opencode-session` 中标明所属对话，见[应用归因](#应用归因)。

### ModelScope 分组

`modelscope` 是聚合网关分组：三条预置共用魔搭 api-inference 端点，预置 base URL 为 `https://api-inference.modelscope.cn/v1`。模型 id 就是上游仓库名，因此保留供应商前缀（`deepseek-ai/DeepSeek-V4.1-Flash`、`Qwen/Qwen3.8-27B`）。新建 Project 时，base URL 与 MMSP 通用 Responses 客户端（`client_type = "openai-responses"`）写进分组设置，组内模型的推理请求因此发往 `{base_url}/responses`。新建的 Project 立即带上这些预置；条目上仍存着旧协议的 Project，用**恢复默认**改回目录的协议。

分组的 key 从标题栏取得，见[连接账户](#连接账户)。连接走一台授权中转层，由中转层持有魔搭的 client secret 并交回一组 api-inference access token / refresh token，而不是经过魔搭自己的页面。除此之外这个分组没有特别之处：推理请求直接发给 `https://api-inference.modelscope.cn/v1`，从不经过中转层；access token 和其他分组的 key 一样写进 `.project_config.toml`，refresh token 只保存在服务端 DB。access token 会过期，PenguinHarness 会在模型请求前静默续期；refresh token 缺失或失效时，才需要从标题栏重新连接一次。

预置条目不带价格。魔搭的 api-inference 是计费的，但它的模型页面读不到费率，所以这些条目按未定价处理：模型页在它们上面不显示价格徽标，成本中心把它们的用量报为未计价。这是目录记录「没人查过这个价格」的方式，见[价格与促销](#价格与促销)。

### 预置模型

预置模型目录包含以下模型：

- `deepseek-flash` / `deepseek-v4-pro`
- `MiniMax-M3`
- `gemini-3.8-flash`
- `claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5` / `claude-fable-5-1`
- `claude-opus-5` / `claude-opus-4-8` / `claude-sonnet-5`
- `gpt-6.1-sol` / `gpt-6-astra` / `gpt-5.6` / `gpt-5.5`
- `glm-5.3` / `glm-5.3-flash`
- `kimi-k3`
- `qwen3.8-max` / `qwen3.8-flash`
- `seed-2.1-pro` / `seed-2.1-turbo` / `seed-evolving`
- `mimo-v2.6-pro` / `mimo-v2.6-flash` / `step-5-preview` / `ling-3.1-flash`（TokenDance）
- `dots-3-note-preview`（TokenDance 上免费，512K 上下文）
- `deepseek-ai/DeepSeek-V4.1-Flash`、`Qwen/Qwen3.8-27B`、`Qwen/Qwen3.8-Flash-Next`（ModelScope 的 api-inference，没有价格的预置条目）

列表并未穷尽所有模型。

- **DeepSeek 图像能力。** `deepseek-flash` 就是 V4.1 Flash，支持读图；`deepseek-v4-pro` 是 V4 Pro 0813 版本，仅支持文本。要发送图像，请使用 `deepseek-flash`。
- **退役条目。** DeepSeek 仍然接受 `deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp`，并都由 V4.1 Flash 承接。它们不再是预置条目，但目录把它们连同 TokenDance 的 `deepseek-v4-flash-vision-exp` 作为退役条目保留：仍带着其中某条的 Project 照旧显示它的名称，**恢复默认**会把它的价格重置为目录值。退役条目不会被补进没有它的 Project，新建的 Project 也不会拿到。
- **OpenAI 出现两次。** OpenAI 全系模型出现了两遍：一次直连（用你自己的 OpenAI key，官方牌价），一次在 OpenRouter 上以 `openai/<id>` 形式（网关费率，随其当前促销活动浮动）。
- **GLM-5.3 Flash 出现七次。** 分别是直连的 `glm-5.3-flash`、TokenDance 与 OpenCode Go 上的同名条目，以及 OpenRouter 的 `z-ai/glm-5.3-flash`、Fireworks AI 的 `accounts/fireworks/models/glm-5p3-flash`、SiliconFlow 的 `zai-org/GLM-5.3-Flash` 和 Qwen 按量付费的 `ZHIPU/GLM-5.3-Flash`。每一条都接受图像：MMSP 的 Z.AI 客户端（`zai-official`）只对这一个 GLM id 转发图像内容，其他所有 GLM id 都拒收图像；各网关条目走通用的 OpenAI 兼容客户端，对任何 id 都会携带图像。各条不一致的是价格：每条记录的都是自己卖家收取的价格，所以促销期间彼此不同。
- **OpenRouter 免费档。** 目录收录了 `:free` 变体 `nvidia/nemotron-3-ultra-550b-a55b:free`，以及 `openrouter/free` 这个统一的免费模型路由（Free Models Router）。它们不花钱，但 OpenRouter 免费档的限流和数据政策仍然适用。

### 价格与促销

- **三类价格。** 每个模型都记录 `cache_read`、`cache_write` 和 `output` 三项价格，单位是每百万 Token 多少美元。成本中心按这些价格结算用量。
- **没有价格的条目。** 价格字段可以整体缺席，含义是「没人查过这家的价格」，而不是免费：这类条目在**模型库**页面不显示价格徽标，成本中心把它的用量报为未计价。目录里目前只有 ModelScope 的预置条目是这样——魔搭的 api-inference 是计费的，但它的模型页面是客户端渲染的，读不到费率。写成三个 0 反而更糟：那会被当作免费档，给一个计费网关打上「Free」徽标。
- **仅记录基础档。** 供应商的价格随输入规模上调时，目录只记录基础档。MiniMax M3 记录的是 MiniMax 标准按量付费档在 512K 输入 Token 及以下的价格；超过后每项费率翻倍，priority 档为 1.5 倍，所以长上下文和 priority 用量的成本估算会偏低。OpenAI（272K 以上）、Gemini 3.1 Pro（200K 以上）和 Claude Haiku 5.5（100K 以上，每项费率为 5 倍）遵循同样的约定。
- **DeepSeek 空闲时段。** 直连 DeepSeek 的条目记录官方高峰价格，并声明 DeepSeek 的空闲时段规则：工作日北京时间 9:00–12:00 和 14:00–18:00 以外的时段，三项价格全部减半。**模型库**页面在这些时段显示 `省 50%` 标签，成本中心也按这个费率计费。
  - 十条转售条目遵循同样的时段，因为各自的卖家沿用了 DeepSeek 的时间窗口：TokenDance 的 `deepseek-v4.1-flash`、`deepseek-v4-flash-0731` 和 `deepseek-v4-pro-0813`，OpenRouter 的 `deepseek/deepseek-v4.1-flash`，Penguin Go 的 `deepseek-flash` 和 `deepseek-v4-pro`，以及 OpenCode Go 的 `deepseek-v4.1-flash`、`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 和 `deepseek-v4-pro`。
  - TokenDance 还在高峰时段对这三条再打 8 折，`deepseek-v4.1-flash` 在空闲时段也打。条目无法在时段规则之外再声明固定折扣，所以这些时段按牌价计费，比 TokenDance 实收高 25%。
  - Qwen 转售的 DeepSeek 模型按它自己的时段计费：北京时间每天 22:00 至次日 8:00 半价。两个 Qwen 分组的 `deepseek-v4.1-flash` 和 Token Plan 的 `deepseek-v4-pro-0813` 声明的是这一套，折扣标签的悬停说明写的也是该条目所遵循时段的窗口。
  - 存储的价格始终是高峰价格，所以磁盘上的数值与 Project 创建或同步的时间无关。
- **固定折扣。** 目前有十个 TokenDance 模型在打折：
  - `ling-3.0-flash` 打 3.5 折
  - 三条 Doubao Seed 条目（`seed-2.1-pro`、`seed-2.1-turbo`、`seed-evolving`）打 5 折
  - `deepseek-v4-flash` 和 `glm-5.2` 打 8 折
  - `deepseek-v4-pro`、`glm-5.3`、`glm-5.3-flash` 和 `qwen3.8-max` 打 9 折

  Gemini 3.8 Flash 和 3.6 Flash 也打 5 折，google 分组和 OpenRouter 上（`google/gemini-3.8-flash`、`google/gemini-3.6-flash`）都是如此，因为 Google 在 2026-12-31 之前对它们一律减半。Project 预置的是**牌价**：折扣率由服务端另行保存，存在它自己的数据库里，而不写入 `.project_config.toml`，计算成本时再从牌价中扣除，因此成本中心按卖家实际收取的价格计费。模型卡片用标签标出当前实际计费的费率，模型弹窗则写明**此处为牌价，当前促销在此基础上省 N%；修改价格会取消促销**。
- **你自己的价格。** 修改条目的价格会取消它的促销，卡片上的折扣标签也随之消失：此后这个数字由你自己定，不再代表卖家。

## Project 模型表

每个 Project 的模型都记录在隐藏文件 `.project_config.toml` 里。通过**模型库**页面或 CLI（`penguin config model add / default / list / remove`，参见 [CLI 参考](/cli)）维护这个文件。

> [!WARNING]
> 不要手动编辑 `.project_config.toml`。

每个 `ModelEntry` 包含以下字段：

| 字段 | 含义 |
| --- | --- |
| `provider` | 配置分组名；与 `model_id` 一起构成唯一键 |
| `model_id` | 上游请求 id |
| `context_window` | 上下文窗口（Token）。不只是展示，而是实际参与运算：每个请求的有效输出上限和压缩阈值都由它推导，因此请求要求的输出永远不会超过窗口的剩余空间。未设置（或数值小得不合理，低于 4096）时，输出限制关闭，压缩按假定的 128000 计算；窗口较小的模型请填写真实值。在 Web 弹窗中，模型不在模型目录里且这个字段留空时，会写入 1,000,000（手动添加的条目按已知模型处理，而不是当作窗口未知）；如果端点实际支持的窗口更小，就把它调小。`penguin config model add` 省略 `--context-window` 时不写任何默认值 |
| `max_tokens` | 可选的单模型输出上限（每次请求最多输出的 Token 数）。设置后会覆盖 Agent 的 `model.max_tokens`；未设置就继承这个值。这个上限只是封顶值，不是实际发出的数值：每个请求实际发送 `min(max_tokens, context_window − estimated input − safety margin)`，所以小窗口模型不用手动调整也能正常工作。在 Web 端整表保存时省略这个字段会把它清空 |
| `client_type` | MMSP 客户端类型：通用协议客户端（`openai-chat` 对应 Chat Completions，`openai-responses` 对应 Responses API，`ant-messages` 对应 Anthropic Messages 等），或厂商的官方客户端（`deepseek-official`、`anthropic-official` 等）。省略时，模型跟随分组的协议；两者都没有时，MMSP 按模型 id 开头的厂商系列（`gpt-`、`claude-`、`gemini-`、`glm-`、`kimi-`、`deepseek-`、`minimax-`）路由。自定义端点使用这三种通用协议客户端之一，Web 弹窗可以检测一个 base URL 对应哪一种。`openai` 是 0.4.2 之前的旧写法，已弃用，读取配置时会归一化为 `openai-chat` |
| `display_name` | 展示名称 |
| `vision` | 是否支持图像输入，默认 true |
| `fast_mode` | 可选的快速模式（默认关闭）：开启后，这个模型的 Session 请求会改走供应商更快的服务层级，价格更高。持久化保存的值只有 `true`；在 Web 端整表保存时省略这个字段会把它清空。没有快速层级的模型会拒绝携带这个设置的请求（参见[快速模式](#快速模式)） |
| `pricing` | 三档价格（单位 `usd_per_mtok`，即每百万 Token 的美元价格）：`cache_read` / `cache_write` / `output` |
| `api_key` / `base_url` | 该模型自己的 key 与端点，两项都可选；留空时使用分组的值（key 仅在能借给该模型的端点时），最后回退到供应商的环境变量，其中 key 仅在[设置 API key](#设置-api-key) 允许的范围内回退 |

文件里还保存着 `default_model`、可选的 `vision_model`（即视觉代理模型），以及 `[providers.<分组>]` 里各分组的设置（见[分组设置](#分组设置)与 [Project 配置](/configuration#project-配置)）。新建 Project 的文件已带有目录给出端点或协议的每个内置分组的设置。文件结构（示例）：

```toml
default_model = { provider = "deepseek", model_id = "deepseek-flash" }
vision_model = { provider = "google", model_id = "gemini-3.1-pro-preview" }

[providers.tokendance]
base_url = "https://tokendance.space/gateway/v1"
client_type = "openai-chat"
api_key = "td-..."
created_at = "2026-10-02T08:00:00.000Z"

[[models]]
provider = "deepseek"
model_id = "deepseek-flash"
context_window = 1000000

[[models]]
provider = "custom"
model_id = "my-model"
client_type = "openai-chat"
base_url = "https://llm.example.com/v1"
api_key = "sk-..."
```

## 应用归因

有些网关会读取一个请求头，把调用记到发起调用的应用名下，用于自己的应用排行、用量报告或路由。

模型目录按**端点主机**决定这些请求头，而不是按条目所属的供应商分组。归在 custom 下的条目，只要 base URL 指向这类网关，就会带上同样的请求头。只看条目自己的 `base_url`：通过 `OPENAI_BASE_URL` 提供的端点在 MMSP 内部解析，条目这一侧看不到，因此不会归因。

| 端点 | 请求头 | 值 |
| --- | --- | --- |
| `openrouter.ai` | `HTTP-Referer` | `https://penguin.ooo/` |
| `openrouter.ai` | `X-OpenRouter-Title` | `PenguinHarness` |
| `openrouter.ai` | `X-OpenRouter-Categories` | `cli-agent,personal-agent` |
| `tokendance.space` | `X-App-URL` | `https://penguin.ooo/` |
| `opencode.ai` | `x-opencode-session` | Session id；不属于任何 Session 的请求（连通性测试、视觉探测）各自使用一个新生成的 id |

其他端点，包括所有直连厂商和不读取这类请求头的网关，都不会收到额外的请求头。OpenRouter 和 TokenDance 的请求头只表明应用身份。OpenCode 的请求头标明对话，因为那个网关靠它来路由和缓存每段对话，并拒绝没有标明对话的请求；没有任何请求头携带用户或 Agent 的信息。

## 工作原理

### 统一网关

所有模型访问都走同一个网关库：[`@prismshadow/mmsp`](https://www.npmjs.com/package/@prismshadow/mmsp)（MMSP，AutoLLMClient）。核心只定义了一个轻量的 `LLMInterface`（参见[接口契约](/interfaces)）。按供应商做协议适配的工作放在 MMSP 内部完成，因此 1000 多个在线和本地模型都能接入，包括任何 OpenAI 兼容端点。协议转换的代码在 `packages/core/src/llm/generative-model.ts`。

### 模型标识

模型的标识永远是 `(provider, model_id)` 这一对。`provider` 是配置分组名，`model_id` 是上游请求 id，原样发给 MMSP。两者是独立的字段，流水线中的任何环节都禁止把它们拼成一个字符串。

凡是要指定模型的接口，都要求给出完整的一对值：CLI、HTTP API 和 SDK 遇到只写一半的引用会直接拒绝，而不是替你补全。供应商不会从模型 id 推断，也没有默认值，因为网关会按上游 id 转售厂商模型；一旦猜错分组，条目的凭证就可能发给一个没人指定的厂商。

在模型引用可选的地方（`penguin run` / `chat`、创建 Session、定时任务），选择只有两种：给完整的两个字段，或者都不给。两个字段都省略时，使用 Project 的默认模型。

### 模型与 Agent

Agent 从不绑定模型。模型在创建 Session 时确定，所以同一个 Agent 可以用不同模型运行不同的 Session；Session 之后还能换模型：对话工具栏的模型选择器先用当前模型压缩上下文，再在新模型上继续本对话（见 [Session 与 Trace](/sessions-and-traces#会话内切换模型)）。

`/model` 命令则是通过交接在另一个模型上开新会话：

1. 为同一个 Agent 在新模型上新建一个 Session，仍在当前 Workspace 里。
2. 新 Session 的第一条消息会带一个 `[model_switch_from]` 块，包含源 Session 的 id 和它的 Trace 文件路径。

历史不会注入新的上下文。有些模型在重放历史时需要 thinking 载荷和 `fidelity`，而这些内容无法跨模型使用。模型需要时会自己去读 Trace 文件，源 Session 保持不变。
