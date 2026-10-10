# 插件的清单就是它的 package.json，Agent 可以把外部插件转成这样的包

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `skills`
- **PR:** [#1024](https://github.com/Prism-Shadow/penguin-harness/pull/1024)
- **Breaking:** yes — 不再读取 `plugin.json`；插件在自己的 `package.json` 中描述自己

[English](2026-10-10-plugin-package-json.md)

插件的 `package.json` 成为它唯一的清单：npm 的标准字段，加一个 `penguin` 块存放属于 PenguinHarness 的全部字段；除包名和版本外都可选，缺失的字段就显示为缺失。Agent 现在可以把为其他工具编写的插件——Codex 或 Claude Code 插件、Skill 仓库、GitHub 仓库中的文件夹——转成这样的包并安装到服务端，之后任何 Agent 都能通过**管理安装**装上它。

## 清单

- npm 字段保持 npm 的含义：`name`（必填；去掉 scope 的部分是插件名）、`version`（必填，semver）、`description`、`keywords`（发现用的关键词是 `penguin-plugin`）、`author`、`license`、`homepage` 和 `repository`。
- `penguin` 块存放 `title` / `title_zh`（显示名）、`description_zh`、`short_description` / `short_description_zh`、`category`、`icon`（包内的 SVG 路径；不填时取根目录的 `icon.svg`）、`preinstall`、`quick_start` 和 `hooks`（钩子包，带日期 `version`）。Skill、钩子和服务端模块仍按目录找到。
- core 用同一个读取器 `parsePluginPackage` 读取每个包。没有合法包名或发行版本号的包会被拒绝；其他字段类型不对时丢弃，并给出指明字段的告警。随构建发布的包只要有告警，插件库就加载失败；管理员安装的包把告警写进服务端日志一次，并在缺少该字段的情况下照常列出。
- 缺失的字段显示为缺失：没有描述时以弱化文字显示「暂无描述」（No description），没有标题时显示插件名，没有图标时显示拼图块，没有分类时归入「其他」，没有快速开始时预选第一个 Skill。
- 图标只有在位于包内、不超过 64 KiB、且不含脚本、事件、链接和外部引用时才会内联显示，否则丢弃；管理员安装的包如此，本机上服务端模块的索引行也如此。
- 在管理员安装的包中，没有日期版本的 Skill 按无版本处理，永远不会被提示更新；带 `hooks/` 却没有 `penguin.hooks.version` 的包只列出 Skill、不列出钩子包。Skill 目录中不是 UTF-8 文本的文件（如图片）不再读取，而不是被安装成乱码。
- 19 个随构建发布的包把 `plugin.json` 的字段搬进 `package.json`，加上带 `penguin-plugin` 的 `keywords`，并从 `files` 中去掉 `plugin.json`。`scripts/check-plugin-versions.mjs` 从 `penguin.hooks` 读取钩子声明；基准提交仍带 `plugin.json` 时，从基准的 `plugin.json` 读取。
- 插件详情显示标题，下方是包名，另有一行作者、许可证以及主页和仓库链接，包里有才显示。搜索框也匹配标题。`PluginItem` 新增 `title`、`titleZh`、`author`、`license`、`homepage` 和 `repository`。

## 导入外部插件

- `skill-porting` 插件新增第二个 Skill `plugin-porting`：插件包格式、如何在固定的 commit 上获取来源、如何识别 Codex 或 Claude Code 插件、逐字段映射到 `package.json` 的规则（`reference/foreign-plugins.md`）、一个把每个移植的 Skill 的 frontmatter 精简为 `name`、`description` 和日期 `version` 并去掉图片和其他工具展示元数据的脚本（`scripts/normalize-skills.mjs`）、审阅职责以及安装方法。只是转向某个 Skill 的命令、子 Agent、其他工具的钩子、MCP 服务器、托管应用和图片都不带入；插件包的 README 逐项列出它们，MCP 服务器附上 URL，供手动添加。
- `penguin plugin install <directory>` 安装本地插件包目录：CLI 先用插件库的读取器读取它（插件库会拒绝的包只报告问题，不发送任何内容），去掉 `node_modules`、`.git` 和 `.npmrc` 打成 zip，再经 zip 路由上传。`--overwrite` 替换服务端上的其他版本。
- 导入弹窗的「从链接安装」拒绝指向 GitHub 仓库中某个文件夹或文件的链接，并提供**改为让 Agent 安装**，把链接带到「让 Agent 安装」；服务端在运行 npm 之前同样拒绝这类链接。「让 Agent 安装」的 Prompt 写明插件包格式，并让还不是插件包的来源经 `plugin-porting` 转换。

## 兼容性

管理员从 npm 仓库装进服务端前缀的 0.2.13 及更早版本的 `@penguinharness/*` 包仍按目录载入：英文描述、图标、版本和 Skill 照常显示。只写在它们 `plugin.json` 里的内容——中文和简短描述、分类、快速开始，以及 `goal` 与 `continual-learning` 的钩子包——在管理员安装该包的新版本之前都会缺失。已经装有这些钩子的 Agent 保留自己的副本。
