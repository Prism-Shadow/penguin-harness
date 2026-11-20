# 插件在设置里有了自己的分组，插件的选项按状态页呈现

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `web`, `ui`, `server`, `ui-gallery`
- **PR:** [#1670](https://github.com/Prism-Shadow/penguin-harness/pull/1670)

[English](2026-11-20-plugin-settings-pages.md)

设置弹窗的子导航最下方新增 **插件** 分组：每个有选项的插件各占一页，以插件的图标与版本标示。一页包含插件的个人选项（所有登录用户可见）与服务器选项（仅管理员可见），各为一个带分隔线的分区。浏览器原来的「浏览器」与「Chrome 扩展」两页成为「浏览器自动化」页的两个分区。「服务器 › 插件」改名为 **插件管理**，只保留服务端全局的插件设置：插件源、镜像、沙箱，以及在这里没有单独页面的插件的选项。

插件的服务器选项按状态页排布：状态行显示插件随附安装的程序的版本（名称、版本、平台与状态，含进度、失败原因与「重试」）、汇总胶囊与插件的主要操作；其下是一张检查清单，整块只有一个 **重新检查**，需要动手的行带各自的按钮，第三方工具的原话折叠在行下；再下是选项，安全设置单列一个分区。

## 细节

- 插件设置条目带上声明它的服务端模块所属的 npm 包（`plugin`）；状态贡献者可回答 `report()`——`summary`、`version`、`checks[]` 与 `recheck`——随条目以 `report` 下发。设置字段可设 `security: true`。只报告提示与操作的插件显示不变。
- Web 半的设置页可设 `group: "plugin"` 与 `plugin: <包名>`，并入该插件的页面；原来的键仍可打开它。`plugin:<包名>` 打开插件页。
- 共享 UI：`InstalledVersion`、`DetailsFold`、`Checklist` / `ChecklistRow` 与 `StatusStrip`，组件库新增 **状态页** 演示。`PagedDialog` 的条目可带 `heading`。
