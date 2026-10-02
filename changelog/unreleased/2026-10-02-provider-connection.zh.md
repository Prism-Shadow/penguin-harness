# 分组连接信息：每个模型分组一份 key、base URL 与协议

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `docs`, `plugins`
- **PR:** [#948](https://github.com/Prism-Shadow/penguin-harness/pull/948)
- **Breaking:** yes — 移除 `penguin config provider`，改用不带 `--model-id` 的 `penguin config model`；`GET /models` 只报告模型自己的 `clientType` 与 `credential`，模型实际使用的值移到 `effective`（来源为 `model`、`provider`、`none`），分组的值移到 `providers`

[English](2026-10-02-provider-connection.md)

模型分组的连接信息（API key、base URL、协议）在 `[providers.<id>]` 里只存一份，组内模型逐字段跟随它，除非模型自己设置了该项。Project 配置文件成为这些值的唯一来源：内置目录只在新建 Project、**同步新增模型**与**恢复默认**时写进文件，运行时从不作回退。每个分组的标题栏加了设置齿轮，分组密钥在这里填写，连接分组时同样写入它；默认常驻集之外的分组收进一条折叠条；OpenRouter、TokenDance 与 SiliconFlow 可以手动添加模型；「同步预置」改为只补入新模型的**同步新增模型**，旁边新增**恢复默认**；`penguin config provider` 并入 `penguin config model`。既有文件会迁移一次，见[向后兼容](2026-10-02-backward-compatibility.zh.md)。

## 存储与解析

- `.project_config.toml` 新增 `[providers.<id>]`（`api_key`、`base_url`、`client_type`、`created_at`），写在顶层键之后、`[[models]]` 之前。`[[models]]` 条目上的 `api_key`、`base_url` 与 `client_type` 只作为它自己的覆盖值存储。
- 每个字段只按文件各自解析（core 的 `effectiveConnection`、`resolveEntryCredential`）：模型的值，其次分组的值，都没有即交给客户端缺省：缺省端点、MMSP 按模型 id 路由，以及 PRN-021 允许时的环境变量 key。会话、视觉代读、连通性测试与测速、视觉与协议检测以及工具性补全都按解析后的连接构建客户端，PRN-021 的环境变量兜底按解析后的端点判定：指向代理的 DeepSeek 分组不会使用 `DEEPSEEK_API_KEY`。
- key 跟随端点（`groupKeyReaches`）：分组密钥只借给没有自己 base URL 的模型，或自己的 base URL 与分组 base URL 同 origin（scheme、host、port）的模型。指向别的主机的模型需要自己的 key；**Custom** 里的 Atria Dawn Preview 自带端点，Custom 的 key 因此不会发往它的主机。
- 新建 Project 的文件把各内置分组的目录端点与协议写进 `[providers.<id>]`（`catalogGroupConnection`、`presetProviderTable`）：OpenAI 兼容网关与 ModelScope 得到 base URL 与协议，Penguin Go 与 OpenCode Go 得到 base URL，vLLM 得到协议；一方厂商分组与 **Custom** 没有。预置条目存目录事实（上下文窗口、价格、`vision = false`），协议或端点只在与分组不同时才存：Penguin Go 与 OpenCode Go 的逐条协议、OpenCode Go 的 Messages 端点，以及 Atria 的端点与协议。`ensurePresetModels` 为没有任何模型的 Project 补入预置时，为文件里缺表的内置分组写入同样的表，并像**同步新增模型**一样按文件里已有的分组表存补入的条目。
- 条目自己的协议始终优先于分组的，因此每个分组都可以设置协议，Penguin Go 与 OpenCode Go 也不例外。
- 没有 `vision` 的条目一律视为支持图片，不再查目录。预置模型的显示名仍取自目录，只作标签。

## 分组密钥

- **连接**（TokenDance、Penguin Go、ModelScope）、**分组设置**与 ModelScope 的 token 续期写入分组密钥，单个模型上设置的 key 保持不动；弹窗写明有多少模型使用分组密钥、有多少模型保留自己的 key。
- 标题栏不再有**填写密钥**：分组密钥在**分组设置**里填写。没有分组密钥的分组显示**未连接**，它本身就是开始连接的按钮，原先单独的**连接**按钮移除。已连接的分组状态显示为**已连接**，点开是一个菜单，内含**同步模型**（Penguin Go）、**重新连接**与**断开连接**——后者经危险色调的确认后删除分组密钥；成员只看到状态文字。**已连接**指分组密钥已存。
- 暂无模型使用分组密钥时（每个模型都有自己的 key，或分组里没有模型）同样写入，结果报 0。Penguin Go 与 ModelScope 的**连接**不再把这种情况报告为写入失败（`apply_failed`）。
- 账户余额只用分组密钥查询；没有分组密钥时，用分组解析后的端点所允许的环境变量（DeepSeek 的 `DEEPSEEK_API_KEY`）。点击金额打开菜单，共三行：**置顶至左下角**或**取消置顶**、**更新余额**，以及按本地时间显示的「更新于：YYYY-MM-DD HH:mm」，查询失败时为「更新失败：」加原因；原先单独的图钉与刷新图标移除。
- Penguin Go 的授权与**同步模型**只补入模型：平台提供而 Project 缺少的模型连同其价格、促销折扣与协议写入，不带自己的 key。端点按**同步新增模型**的逐字段规则：文件里的分组表有 base URL 时，条目只在与平台中转地址不同时才存端点，分组被指向代理时新模型随之走代理并用上分组密钥；分组表没有 base URL 时，条目存平台的完整地址。已存的模型及其价格、协议与折扣不再被改写，也不会被删除。

## 分组设置

- 每个分组的标题栏（包括 **Custom**）都以测速与**设置**（齿轮）收尾，二者对齐在同一右缘。「{分组} 分组设置」弹窗按文件里存的值编辑分组的 API key（打码显示，可清除）、base URL 与协议。base URL 为空时说明使用客户端缺省端点，**检测协议**用所填的 URL（未填则用已存的）探测，未填 key 时用分组密钥。协议首项**未设置**把协议交给各模型，或按模型 id 路由。弹窗不列出目录的值；目录给出模型列表地址时，提供**前往模型列表**链接。保存时只提交改动过的字段；只有 **Custom** 或自建分组在没有任何来源能决定协议时，才在保存前检测一次。该弹窗与模型弹窗加宽（`sm:max-w-3xl`），最长的内置 base URL 连同协议路径能完整显示。
- `PUT /api/projects/:projectId/models/providers/:provider`（owner）写入单个分组。`PUT /models` 接受按分组合并的 `providers`，自建分组没有模型后连同其分组表一并删除。`POST /models/detect` 接受不带 `modelId` 的 `provider`，即使用分组密钥。`GET /models` 返回 `providers`（key 打码）与每个模型的 `effective` 连接信息，并注明每个字段的来源。

## 常驻分组

- 模型库页面始终显示 TokenDance、Penguin Go、DeepSeek、OpenRouter、Google、OpenAI 与 Anthropic；其余分组排在它们下方，收在一条通栏折叠条里，折叠条写明其中的分组数（「其余 11 个分组」），默认收起。每个分组标题上有一个锁形按钮，鼠标悬停或聚焦时显示，触屏上始终显示，用于设为常驻或取消常驻（**常驻** / **取消常驻**）；把分组拖到另一个区域的分组标题上也会把它移过去。常驻设置按浏览器保存为相对默认集的差异（`penguin.modelsPinnedGroups`），折叠状态存为 `penguin.modelsGroupsFolded`，二者都属浏览器范围。搜索期间两个区域都显示，折叠条隐藏。

## 添加模型

- OpenRouter、TokenDance 与 SiliconFlow 可以手动添加模型（`ModelProviderInfo.addable`）；TokenDance 与 SiliconFlow 的目录分组协议为 `openai-chat`。**添加模型**改为只有图标，各分组的新增弹窗标题统一为**新增模型**（Add model），网关分组原有的「（OpenAI 协议）」后缀去掉。
- 新增模型与**模型配置**弹窗新增默认折叠的**详细配置**区。新增模型默认只显示模型 ID、显示名与分组；API key、base URL 与协议（连同**检测协议**）、测试连通性、上下文窗口、输出上限、价格、视觉与快速模式都收在**详细配置**里。**模型配置**保留 key、base URL 与协议可见，只折叠其余五项。保存时该区有必填项缺失或无效，即展开该区并聚焦该字段。
- 模型将从分组继承的 API key 或 base URL，占位文字只写「留空继承分组设置」，不带分组的具体值；分组密钥借不到该模型时，key 输入框会写明。
- 保存时的协议检测只在模型与分组都无法决定协议时运行。
- **导入模型**把 base URL、key 与协议写入新分组的设置一次，导入的模型不带这些信息。

## 预置模型

- 「同步预置」拆为**同步新增模型**与**恢复默认**，都在服务端执行：`POST /api/projects/:projectId/models/sync-presets`，`mode` 为 `add` 或 `restore`（owner）。页面自己的合并逻辑已移除。
- **同步新增模型**补入缺失的未退役预置模型及其促销折扣。补入的条目逐字段处理：文件的分组表有该项时，只存它与分组目录值的差异，分组被指向代理时补入的条目随之走代理；分组表缺该项时，存该项完整的目录值。只有文件里既无条目、也无分组表的内置分组才补写分组表。已有的条目、分组表、key 与折扣一概不动。页头按钮与通知的**现在升级**都先打开同一个确认框，列出将补入的模型。红点与通知只计新模型：「{n} 个新预置模型可同步」。
- **恢复默认**经危险色调的确认后，把内置条目的上下文窗口、价格与视觉标志恢复为目录值，清除其显示名、输出上限与快速模式，条目上的 base URL 与协议回到目录值（只在与分组不同时存在条目上）。**Custom** 以外的内置分组表的 base URL 与协议回到目录值，缺失的表补建，变空的表移除；**vLLM** 的目录没有端点、组内模型跑在用户自己的服务器上，因此保留其 base URL，只有协议回到目录值，而厂商分组指向代理的 base URL 会被移除。已删除的预置模型补回，促销折扣按目录重置（Penguin Go 的与用户自己添加的模型的保留）。所有 key 都保留：内置分组没有分组密钥、组内带 key 的条目共用一把且移到分组后仍能借给它们全部时，这把 key 移到分组上。确认框列出保留的内容，其中包括 vLLM 的 base URL。Custom 的分组设置、用户自己添加的模型与分组，以及仍然适用的默认模型与视觉模型引用都保留。

## CLI

- 移除 `penguin config provider`。不带 `--model-id` 的 `penguin config model add --provider <分组>` 设置或清除分组的连接信息（`--api-key` / `--clear-api-key`、`--base-url` / `--clear-base-url`、`--client-type` / `--clear-client-type`）；只描述单个模型的选项、空值、同时设置与清除同一项，以及什么都不改的调用都会被拒绝。不带 `--model-id` 的 `penguin config model remove --provider <分组>` 移除该分组的表、保留组内模型，分组没有表时拒绝。`--clear-*` 选项同样可以清除模型自己的值。
- `model add` 不写任何目录值：新条目只在显式给出时才存 `client_type` 与 `base_url`，只有分组未设协议的 custom 或自建分组条目才写入 `openai-chat`。`model list` 先列各分组存的连接信息，再列各模型解析后的值，取自分组的标 `(provider)`，来自环境变量的 key 标 `(env)`。`model remove` 删除自建分组的最后一个模型时，一并删除该分组的连接信息。

## 文档与技能

- 模型、配置与 CLI 文档（中英文）写明文件是唯一来源与 模型 → 分组 → 无 的解析顺序、新建 Project 写入的分组表、key 借用规则、常驻与折叠的分组、分组标题栏的**未连接**及其**已连接**菜单与余额菜单、弹窗的**详细配置**区与继承占位、**分组设置**、**同步新增模型** / **恢复默认**，以及合并后的 CLI。
- `penguin-config` 技能（`agent-development` 插件 `2026.10.02.2`）新增「Group connection」一节，介绍不带 `--model-id` 的 `penguin config model add --provider <group>`，可手动添加模型的分组列表加入 openrouter、tokendance 与 siliconflow。

## 兼容性

- `penguin config provider set` 与 `penguin config provider list` 已移除：改用不带 `--model-id` 的 `penguin config model add --provider <分组>`（选项相同），以及先列分组的 `penguin config model list`。解析 `model list` 输出的脚本会先读到 `Groups:` 段，再读到 `Models:` 段：其中是解析后的值，带有 `(provider)` 与 `(env)` 后缀，不含目录值。
- 从 `ModelInfo.clientType` 或 `credential` 读取模型协议、端点或 key 状态的 API 调用方改读 `effective`，其来源为 `model`、`provider` 或 `none`（key 另有 `env`）；分组自己的值读 `providers`。
- 同步到机器的模型表以 `providers` 附带分组连接信息，条目按文件里存的原样发送。仍在更早版本上的机器忽略 `providers`，并把每个条目当作完整的读：这里设置的分组密钥、base URL 与协议到不了它，跟随分组的条目到它那里就不带这些值；在 OpenRouter、TokenDance 或 SiliconFlow 里手动添加的模型对它是新条目，会被拒绝（`model_not_addable`），该 Project 的整张模型表随之被拒。同步之前请先升级该机器。
