# 插件市场统一：每个插件一张卡片、按分类分组，版本按 Skill 与钩子包分别标记

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `web`, `server`, `core`, `skills`, `ci`
- **PR:** [#1009](https://github.com/Prism-Shadow/penguin-harness/pull/1009)

[English](2026-10-09-plugin-market.md)

插件页以同一种方式展示每个插件——插件库里的 Skill 与钩子插件、沙箱后端这类服务端模块插件都一样——按分类分组，详情一律在弹窗中查看。插件的版本改为它的 npm 版本，日期版本下放到 Agent 可能在本地改动的部件：每个 Skill 与每个钩子包。

## 版本

- 插件的版本就是它的 npm 版本，即 `plugin.json` 旁 `package.json` 的 `version`。`plugin.json` 不再带 `version`；留在那里的会被忽略，为旧版框架写的插件照常加载。
- 插件库里的每个 Skill 在自己的 `SKILL.md` frontmatter 中带日期版本（`YYYY.MM.DD.N`），钩子包的版本写在 `plugin.json` 的 `hooks.version`，由安装器写进 `hooks.json`。loader 把短描述与图标盖章进可安装副本时，保留 Skill 自己的版本。
- 每个部件的初始版本取其插件原有的日期版本，早先版本安装的副本因此与库内同版，升级后不出现更新提示。
- Agent 列表的 `pluginUpdates` 把每个已装 Skill 与钩子包同库内的同名部件比较，任一部件落后即按插件报告一次；报告的 `version` 取该插件各部件中最新的日期版本。组织运行时逐员工检查插件时，也按同一套部件配对作答。
- `scripts/check-plugin-versions.mjs` 改为按部件校验：改了 `plugins/<p>/skills/<s>/` 必须递增该 Skill 的 `version`，改了钩子脚本或 `hooks` 中的命令必须递增 `hooks.version`；`package.json`、`README.md`、`icon.svg` 与 `plugin.json` 的其余字段无需递增。它还拒绝仍带顶层 `version` 的 `plugin.json`，以及初始版本低于其插件在 base 提交时版本的部件。
- skill-porting 技能为移植来的 Skill 在 frontmatter 中写日期版本，不再写自然数版本与 `updated` 时间戳。

## 插件页

- 卡片缺省按分类分组——先是插件库的各分类，然后是新增的 **Agent 运行沙箱**分类（收沙箱后端），最后是其他。标题下一行小号下拉可切换分组方式（分类、状态、包含或不分组），并按分类、包含与状态筛选，与搜索框并列，每个选项都带所属下拉名（如「状态：可安装」）；它取代了右侧筛选栏和分开的「已安装」「可安装」两张列表。浏览器会记住分组方式（`penguin.pluginsGroupBy`）与哪些分组折叠了（`penguin.pluginsGroupsFolded`）。
- 每个插件是同一种卡片：图标、名称与短描述，一行 `v<npm 版本> · <状态> · N 个 Agent 在用`，以及「内置」等标签，按其他方式分组时另标出分类。状态是带色调的图标、状态词与悬停说明：含 Skill 或钩子的插件，本 Project 有 Agent 完整装有它（或已装副本被列为落后）即已安装，有 Agent 落后即可更新，否则可安装；服务端模块插件，服务端已安装并载入即已安装，否则为待重启、加载失败、只在其他机器上运行，或可安装。
- 四个沙箱后端新增 `plugin.json`（描述、短描述与 `sandbox` 分类）和盾形 `icon.svg`，二者随包发布。内置索引的条目复写这两份内容；包在本服务器上时，列表直接取包自带的。
- 安装或移除服务端模块插件（管理员操作）时，确认弹窗点名该插件，说明它将安装到整个服务端、由所有 Project 共用；正在进行的 Agent 运行会被中止，改为下方的小字。成员看得到卡片与详情，但没有这些按钮。
- 每个插件的详情都在弹窗中打开：版本、状态与标签，「说明」一节为完整描述与包自带的 README（包不在本服务器上时提示安装后可查看），含 Skill 或钩子的插件另有文件浏览器。`/plugins/registry/*` 整页已删除。
- 更新确认为每个 Agent 列出已装版本与库内不同的 Skill 和钩子包，并标出两个版本。
- 系统设置里的沙箱卡片改名为 **Agent 运行沙箱**，提议安装后端的提示改为「安装 Agent 运行沙箱后端」，并说明后端会安装到整个服务端。

## API

- `GET /api/plugins/:plugin/readme` 返回插件库插件包根目录的 `README.md`，没有时返回 404 `readme_not_found`。
- `PluginItem.version` 为 npm 版本；`PluginItem` 新增 `source` 与 `hookVersion`，各 Skill 的 `version` 是它自己的。
- `PluginIndexEntry` 新增可选的卡片字段 `descriptionZh`、`shortDescription`、`shortDescriptionZh` 与 `icon`。`icon` 只取自内置索引与服务端上的包；远程索引的条目一律丢弃 `icon`，因为 Web App 会把 SVG 内联进页面。
