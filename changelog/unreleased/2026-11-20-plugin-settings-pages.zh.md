# 插件在设置里有了自己的分组，插件的选项按状态页呈现

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `web`, `ui`, `server`, `core`, `plugins`, `ui-gallery`
- **PR:** [#1670](https://github.com/Prism-Shadow/penguin-harness/pull/1670)

[English](2026-11-20-plugin-settings-pages.md)

设置弹窗的子导航最下方新增 **插件** 分组，凡与插件有关的设置都在这里，「服务器」组不再有插件页。组内先是宿主自己的三页（仅管理员）：**插件源**（npm registry、插件索引与镜像）、**模块请求**（成员请求运行插件的服务端模块；[#1638](https://github.com/Prism-Shadow/penguin-harness/pull/1638) 原先把它放在插件页里，现在自成一页，子导航上的这一行标出本服务端待处理的请求数，插件库页的提示也打开这一页）与 **Agent 运行沙箱**（沙箱开关与预设，每个沙箱后端各占一行并链接到它的页面）。其后每个有选项的插件各占一页，以插件的图标与版本标示，包含插件的个人选项（所有登录用户可见）与服务器选项（仅管理员可见），各为一个带分隔线的分区。页面只因插件自己的贡献而存在：浏览器原来的「浏览器」与「Chrome 扩展」两页成为「浏览器自动化」页的两个分区，四个沙箱后端（bubblewrap、Seatbelt、WSL、DSH）各有自己的页面，带各自的图标与版本，不再画在沙箱卡片里。只有某台已连接机器装了的插件，在那台机器答复后同样有自己的页面，并直接打开在那台机器上。

插件库页「只显示不兼容的插件」的筛选从设置移到了页面本身：搜索框旁的 **只看不兼容** 筛选，仍按浏览器记住。

插件的服务器选项按状态页排布：状态行显示插件随附安装的程序的版本（名称、版本、平台与状态，含进度、失败原因与「重试」）、汇总胶囊与插件的主要操作；其下是一张检查清单，整块只有一个 **重新检查**，需要动手的行带各自的按钮，第三方工具的原话折叠在行下；再下是选项，安全设置单列一个分区。

## 细节

- 插件设置条目带上声明它的服务端模块所属的 npm 包（`plugin`）；状态贡献者可回答 `report()`——`summary`、`version`、`checks[]` 与 `recheck`——随条目以 `report` 下发。设置字段可设 `security: true`。只报告提示与操作的插件显示不变。
- Web 半的设置页可设 `group: "plugin"` 与 `plugin: <包名>`，并入该插件的页面；原来的键仍可打开它。`plugin:<包名>` 打开插件页，`plugins` 打开插件源，`sandbox` 打开 Agent 运行沙箱；`plugins` 带沙箱焦点（输入框旧的链接）打开 Agent 运行沙箱。
- 条目另带声明它的插件的卡片标题（`pluginTitle`、`pluginTitleZh`）、版本（`pluginVersion`）与图标（`pluginIcon`，由 `GET /api/admin/plugin-config/icon` 提供），为插件库不列出的插件的页面命名并画出图标。检查项可链接到另一个设置页（`page`），在行尾画作「查看」。
- 打开沙箱而本平台没有后端时提议安装的默认后端，改由服务端内置的插件索引给出：每个后端包在它的 `SandboxModule.providers` 投稿上声明自己是哪些平台的默认后端（`defaultFor`），索引条目照抄（`sandboxDefaultFor`）。宿主不再点名任何后端；默认后端本身不变（Linux：bubblewrap 与 DSH；macOS：Seatbelt；Windows：WSL）。
- 沙箱后端插件各自声明设置组（不再带 `parent`），并以 `report()` 报告状态：版本元素是它运行的程序，检查是它的加载检查，在其他平台上显示不适用；保存后端的页面或「重新检查」会重新加载未通过检查的后端。DSH 后端声明一个空设置组来承载状态。
- 按其他版本契约编写的插件发来的报告会降级而不会出错：本构建不认识的状态读作未知，格式不对的字段丢弃；状态代码抛错只影响它自己的设置组，该组显示状态读取失败。
- 共享 UI：`InstalledVersion`、`Checklist` / `ChecklistRow` 与 `StatusStrip`，组件库新增 **状态页** 演示。`HelpFold` 导出其触发按钮 `HelpFoldToggle`（可传入完整的无障碍名称 `name`）。`PagedDialog` 的条目可带 `heading`，以及 `badge`（子导航行尾的计数）与该行的 `ariaLabel`。
