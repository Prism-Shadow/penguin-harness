# 主题包导入与导出：服务端存储、校验器与路由

- **Date:** 2026-11-10
- **Type:** feature
- **Scope:** `server`, `theme-pack`, `ui`, `web`, `ui-gallery`
- **PR:** [#1529](https://github.com/Prism-Shadow/penguin-harness/pull/1529)

[English](2026-11-10-theme-packs-server.md)

管理员可以以 zip 导入主题包，之后这台服务器上的每个账户都能选用它。任何主题包，内置的或导入的，都导出成同一形状的 zip。导出白领、改名、改几个值、再导入：新主题包就从这里开始。

## 校验器

- `packages/theme-pack`（`@prismshadow/penguin-theme-pack`，私有）包含：
  - 清单格式，字段封闭，不认识的字段一律拒绝；
  - 主题包可写的 CSS 语法，以白名单列出；
  - 字体与插画的检查；
  - zip 的读写；
  - 内置包的导出形状。
- 服务端在导入时运行它。共享 UI 包的测试用同一个校验器检查每个内置包的导出形状。
- 每份样式表用 css-tree 解析，存下的是解析器重新生成的文本，从不是上传的原文。解析器读不懂的文本、检查没有列出的节点类型、白名单外的函数、伪类、属性或 at 规则，都会被拒绝，并给出文件、行、列与原因。例如对输入框取值的前缀匹配，或指向主题包之外的 `url()`。
- 语法即 PRFC-0026 所列，另加内置包用到的四项：
  - `*`；
  - 取语言标签的 `:lang()`；
  - 只用于 `role` 的 `^=`；
  - 除 `<id>-…` 外也可命名为 `ui-…` 的 `@keyframes`。
- 导入的包还要过「干净的底线」的静态规则（R1、R2、R5–R11），一处命中即拒绝，并写明规则与命中的内容。规则取自共享 UI 包自己的那张表，即其去 AI 味测试检查内置包的同一张，两边不会走样。服务端经新增的子路径 `@prismshadow/penguin-ui/pack-rules` 引用它。规则表原先从去 AI 味模块读取的那条正则移到了单独的模块里，规则表因此不带进其他代码。
- 字体只收 WOFF2，并读取文件头与表目录。插画沿用插件图标的检查。
- 上限：200 个文件、zip 16 MiB、解压后 24 MiB、样式表合计 512 KiB、字体合计 12 MiB、解析 2 秒。

## 存储与路由

- 主题包存在数据根的 `themes/<id>/`，每个包含：
  - 规范化的 `pack.json`；
  - 重新生成的样式表；
  - 合成的 `index.css`：样式表放进 `ui-theme` 与 `ui-accent` 层，包内 `url()` 改写为 `/api/themes/<id>/files/<path>?v=<v>`。它不含任何属于提供它的构建的内容。提供时在前面加上 App 样式表的完整层序（Tailwind 的各层在前，然后是主题的四层），每个构建从 `index.html` 所链接的样式表读一次。重新加载后首帧脚本先挂主题包的链接，这条声明让两种先后顺序下的层序相同。列表与提供时用的 `v` 把这一次序合进内容摘要，构建改变了次序，每个包的地址都随之改变；
  - 字体与插画；
  - `installed.json`，对外只提供其 `files` 所列的文件。
- 每次上传的原 zip 留在 `themes/archives/<id>-<version>-<sha8>.zip`。
- `v` 是主题包内容的摘要，因此导出后再导入，存下的文件逐字节相同。
- `GET /api/themes`、`GET /api/themes/:id/files/<path>`、`POST /api/themes[?replace=1]`（管理员，zip 原文）、`DELETE /api/themes/:id`（管理员）与 `GET /api/themes/:id/export` 的说明见服务端 API 文档。
- 每次写操作都向每个登录用户的事件流发送 `themes_changed`。
- 共享 UI 包的 Vite 插件把每个内置包的源文件写进构建产物的 `themes/<id>/`，另有 `fonts.json`，把包自带的字体映射到产物里已带的哈希字体。服务器据此从它所提供的构建导出内置包，离线可用。导出时白领的规则限定到它自己的 id，字体全是应用共用字体的包导出时不带 `fonts.css`。白领导出时不带 `recipes.css`，附带的 README 写明 `base: "modern"` 的包从基准沿用这些配方，因此导出的白领只改 id 即可导入。

## Web App 契约

- API 类型新增 `ThemePackDto`、`ThemePacksResponse`、`ThemePackImportResponse`、主题包错误码与 `ThemeInvalidDetails`。
- Web App 新增五个封装：`listThemePacks`、`importThemePack`、`deleteThemePack`、`themePackExportUrl` 与 `themePackFileUrl`。
- 组件画廊的模拟服务器以一个示例主题包应答它们。
