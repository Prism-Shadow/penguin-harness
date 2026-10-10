# 插件的清单就是它的 package.json，Agent 可以把外部插件转成这样的包

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `skills`
- **PR:** [#1024](https://github.com/Prism-Shadow/penguin-harness/pull/1024)
- **Breaking:** yes — 不再读取 `plugin.json`；插件在自己的 `package.json` 中描述自己

[English](2026-10-10-plugin-package-json.md)

插件的 `package.json` 成为它唯一的清单：npm 的标准字段，加一个 `penguin` 块存放属于 PenguinHarness 的全部字段；除包名和版本外都可选，缺失的字段就显示为缺失。Agent 现在可以把为其他工具编写的插件——Codex 或 Claude Code 插件、Skill 仓库、GitHub 仓库中的文件夹——转成这样的包并安装到服务端，之后任何 Agent 都能通过**管理安装**装上它。插件还可以携带 MCP Server，**管理安装**会把它们加进 Agent 的配置，其中的机密从 Agent 的 Vault 读取。

## 清单

- npm 字段保持 npm 的含义：`name`（必填；去掉 scope 的部分是插件名）、`version`（必填，semver）、`description`、`keywords`（发现用的关键词是 `penguin-plugin`）、`author`、`license`、`homepage` 和 `repository`。
- `penguin` 块存放 `title` / `title_zh`（显示名）、`description_zh`、`short_description` / `short_description_zh`、`category`、`icon`（包内的 SVG 路径；不填时取根目录的 `icon.svg`）、`preinstall`、`quick_start` 和 `hooks`（钩子包，带日期 `version`）。Skill、钩子和服务端模块仍按目录找到。
- core 用同一个读取器 `parsePluginPackage` 读取每个包。没有合法包名或发行版本号的包会被拒绝；其他字段类型不对时丢弃，并给出指明字段的告警。随构建发布的包只要有告警，插件库就加载失败；管理员安装的包把告警写进服务端日志一次，并在缺少该字段的情况下照常列出。
- 缺失的字段显示为缺失：没有描述时以弱化文字显示「暂无描述」（No description），没有标题时显示插件名，没有图标时显示拼图块，没有分类时归入「其他」，没有快速开始时预选第一个 Skill。
- 图标只有在位于包内、不超过 64 KiB、且不含脚本、事件、链接和外部引用时才会内联显示，否则丢弃；管理员安装的包如此，本机上服务端模块的索引行也如此。`<svg>` 之前的 XML 声明不随图标发送，这样的图标照常显示。
- 在管理员安装的包中，没有日期版本的 Skill 按无版本处理，永远不会被提示更新；带 `hooks/` 却没有 `penguin.hooks.version` 的包只列出 Skill、不列出钩子包。名称不符合 Skill 命名规则的 Skill 目录会被略过并告警，因为任何 Agent 都装不了它。Skill 目录中不是 UTF-8 文本的文件（如图片）不再读取，而不是被安装成乱码。
- 19 个随构建发布的包把 `plugin.json` 的字段搬进 `package.json`，加上带 `penguin-plugin` 的 `keywords`，并从 `files` 中去掉 `plugin.json`。`scripts/check-plugin-versions.mjs` 从 `penguin.hooks` 读取钩子声明；基准提交仍带 `plugin.json` 时，从基准的 `plugin.json` 读取。
- 插件详情显示标题，下方是包名，另有一行作者、许可证以及主页和仓库链接，包里有才显示。搜索框也匹配标题。`PluginItem` 新增 `title`、`titleZh`、`author`、`license`、`homepage` 和 `repository`。

## 导入外部插件

- `skill-porting` 插件新增第二个 Skill `plugin-porting`：插件包格式、如何在固定的 commit 上获取来源、如何识别 Codex 或 Claude Code 插件、逐字段映射到 `package.json` 的规则（`reference/foreign-plugins.md`）、一个把每个移植的 Skill 的 frontmatter 精简为 `name`、`description` 和日期 `version` 并去掉图片和其他工具展示元数据的脚本（`scripts/normalize-skills.mjs`）、审阅职责以及安装方法。只是转向某个 Skill 的命令、子 Agent、其他工具的钩子、托管应用和图片都不带入，插件包的 README 逐项列出它们；MCP Server 则会带入，见下一节。
- `penguin plugin install <directory>` 安装本地插件包目录：CLI 先用插件库的读取器读取它（插件库会拒绝的包只报告问题，不发送任何内容），去掉 `node_modules`、`.git` 和 `.npmrc` 打成 zip，再经 zip 路由上传。`--overwrite` 替换服务端上的其他版本。
- 导入弹窗的「从链接安装」拒绝指向 GitHub 仓库中某个文件夹或文件的链接，并提供**改为让 Agent 安装**，把链接带到「让 Agent 安装」；服务端在运行 npm 之前同样拒绝这类链接。「让 Agent 安装」的 Prompt 写明插件包格式，并让还不是插件包的来源经 `plugin-porting` 转换。

## MCP Server 随插件安装

- 插件的 `package.json` 新增 `penguin.mcp_servers`：条目形态与 `system_config.yaml` 的 `tools.mcpServers` 相同，每个条目可带一个 `setup` 列表，列出连接之前须由用户设置的 Vault 键（`key`、`label`、`label_zh`、`help`）；配置引用了的键，没有 `setup` 条目也算在内。只带 MCP Server 的包同样是插件库插件，因此像 Gmail 这样只有一个远程 Server、没有 Skill 的 Codex 插件，现在可以转换并安装，不再被当作「不是插件」拒绝。
- Server 的 `config` 中任意字符串值里的 `${KEY}`，在 Server 连接时从 Agent 的 Vault 读取。配置、配置 API 和 Trace 里只有引用，Vault 的其余内容仍然不会交给 MCP Server。`${PLUGIN_ROOT}` 在把插件安装到 Agent 时替换为插件包的目录；`config.oauth` 标记用 OAuth 登录的 Server。
- 把插件安装到 Agent 时，它的 Server 追加到 Agent 的 `tools.mcpServers`，每个条目带 `plugin: <插件名>`，文件中的注释保持不变；重新安装只替换这些条目，卸载则删除它们。Agent 上已有来自别处的同名 Server 时，整次安装以 409 `mcp_server_name_taken` 拒绝，什么都不写入。插件的每个 Server 也都在 Agent 上时，插件才算已安装；MCP 条目没有版本，从不触发更新提示。还原 Agent 的默认配置会移除这些条目，**管理安装**可以把它们装回来。
- `GET /api/projects/:projectId/agents/:agentId/mcp-servers` 列出 Agent 的 Server，包括目标、来源插件、缺少的键和登录状态，从不返回请求头或 `env` 的值；`DELETE …/mcp-servers/:name` 移除其中一个（404 `unknown_mcp_server`）。安装的响应和 `GET /api/plugins` 的条目都新增了 `mcpServers`。`POST …/config/mcp-test` 先从 Vault 填入引用，缺键时直接回答「待设置」，不发起连接。
- Vault 补不全引用的 Server 按「待设置」跳过，连接结果带 `mcp_needs_setup` 和缺少的键名，从不包含值；带 `config.oauth` 而没有 `Authorization` 请求头的 Server 按「需登录」跳过（`mcp_sign_in_required`），因为 OAuth 登录尚不支持。插件详情、**管理安装**和 Agent 的**工具**标签页都用图标标出这两种状态，对话中的 MCP 连接行把这样的 Server 显示为等待而不是连接失败，Project owner 可在**管理安装**中点击**设置**，或在**密钥保险柜**标签页填写这些键。在 Agent 设置中，插件安装的 Server 带一个拼图标记，指明来源插件。
- `plugin-porting` 现在带入 MCP Server：它的 `scripts/port-mcp.mjs` 把 Codex 的 `.mcp.json` 或 Claude Code 的 `mcpServers` 映射转成 `penguin.mcp_servers`。`<GMAIL_PUBLIC_CLIENT_ID>` 这类占位符和上游转发的环境变量转成 `${KEY}` 引用并列为待设置的键，上游公开的 client secret 不带入、改为待设置的键，插件内的 stdio 命令改写为以 `${PLUGIN_ROOT}` 开头。托管应用（`.app.json`）仍不带入：它们是 ChatGPT 的连接器 id。
- 包带来的东西都会说明。导入弹窗写明插件可能携带 MCP Server，stdio Server 是 Agent 会话开启时服务器运行的命令；详情列出每个 Server 的传输方式和目标；把带 stdio Server 的插件装到 Agent 上之前会先询问，并给出该命令；`penguin plugin install <directory>` 打印每个 Server 的名称、传输方式和目标。
- 现在每个 `tools.mcpServers` 条目（包括手写的）里的 `${KEY}` 都按 Vault 引用读取，因此值里写着字面 `${…}` 的已有条目，在 Vault 有这个键之前会按「待设置」跳过。

## 兼容性

随构建发布的插件已把字段写进 `package.json`，与构建自带插件同名的包总是从构建读取，因此已发布版本装下的内容都不受影响：服务端前缀里较旧的 `@penguinharness/*` 包仍和以前一样不会列出。按此前文档中 `plugin.json` 格式编写的插件，需要把字段移进其 `package.json` 的 `penguin` 块；在此之前它按目录载入：英文描述、图标、版本和 Skill 照常显示，中文和简短描述、分类、快速开始以及钩子包则缺失。Agent 上已安装的 Skill 和钩子包不受影响。
