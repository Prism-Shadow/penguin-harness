# 每套主题都是白领之上的主题包，三套主题改为主题包目录

- **Date:** 2026-11-10
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1527](https://github.com/Prism-Shadow/penguin-harness/pull/1527)
- **Breaking:** yes — `@prismshadow/penguin-ui`：白领的外观需要在 `data-theme` 旁写 `data-theme-base="modern"`，不带 `data-theme` 的根元素呈现白领而非朴素，`DEFAULT_THEME_ID` 移除

[English](2026-11-10-theme-packs-base.md)

白领（Frost，`modern`）成为每套主题的基准，朴素、极客与白领成为最先的三个主题包。三套主题在两种明暗、两种语言下画面都没有变化。

## 基准

- 白领的令牌取值移到裸 `:root` / `:root.dark` 上，钩子配方改以 `:root[data-theme-base="modern"]` 为键。两者都在新的级联层 `ui-base`，位于其余主题包的 `ui-theme` 之下：主题包的声明按层取胜，主题包没写的令牌显示白领的取值。
- `theme.css` 在一切导入之前声明四个层——`ui-base, ui-theme, ui-accent, ui-font`。基础层的缺省（眉题与展示标题、通知的色调墨色、树的层级刻度、缺省图标集、流式蒙版）由 `ui-theme` 移到 `ui-base`，自定义背景上色调条的规则也一并移入，离开了 `wallpaper.css`。
- `data-theme` 恒写，朴素也写；沿用白领的主题包同时写 `data-theme-base="modern"`。`DEFAULT_THEME_ID` 并入 `INITIAL_THEME_ID`，后者既是浏览器首次打开的主题，也是基准。`applyThemeAttributes` 按 id 写出这两个属性；Workbench 应用框也复制 `data-theme-base`。

## 主题包目录

- 每套主题是一个目录 `packages/ui/src/themes/<id>/`：`pack.json`（主题 API、id、名称、版本、base、明暗、色样、自身强调色与预设、字体）、`tokens.css`、`recipes.css`（朴素没有）、`accents.css`、`fonts.css`，以及把各文件按层导入的 `index.css`；各文件自身不写 `@layer`。朴素与极客为 `base: "foundation"`，白领为 `base: "modern"`。
- 主题的字体表移进各自的包，改名 `fonts.css`；`fonts/index.css` 照旧声明全部字体，MiSans 的分片仍在 `fonts/misans/`。
- `themes/index.ts` 是注册表：`BUILTIN_PACKS`、`builtinPack`、`isThemeId` 与 `THEME_API = 1`。`THEME_IDS`、`ACCENT_PRESETS`、`THEME_ACCENT_PRESETS`、`ACCENT_PRESET_IDS`、`THEME_OWN_ACCENTS` 与 `THEME_FONTS` 改由清单读出，形状不变；强调色预设 id 的类型改为字符串。
- Web App、画廊与发布的 `styles.css` 为每个内置包导入 `themes/<id>/index.css`，白领在先。

## 首帧

首帧脚本为每套主题写出 `data-theme` 与 `data-theme-base`。存的 id 不是本构建自带的主题时，脚本在 `penguin.themePacks`（浏览器缓存的服务器导入主题包列表）里查同 id 的条目；条目通过校验——主题包 id、本构建实现的主题 API、摘要形式的版本——就在解析期间写入该包样式表的链接，并接受该包的预设。目前还没有任何代码写这个键。`readCachedThemePack` 与 `themePackHref` 让主题状态以同一方式读取。画廊的静态框内联 `STATIC_BOOT_SCRIPT`，即去掉缓存主题包分支的同一段脚本：静态站点没有可供链接主题包的服务端。

## 守卫

- 令牌契约测试逐个读主题包目录：基准与每个只建在基础层上的包两种明暗都声明全部令牌，沿用白领的包只能声明契约里的名字，每份清单都与它的 CSS 一致——预设、自身强调色、色样与字体。
- 新测试核对 `theme.css` 最先声明层序、其他样式表不打开 `ui-base` 或 `ui-theme`，以及构建出的 `dist/styles.css` 按级联顺序打开四个层。
- 干净底线的 R1、R2 与 R5–R11 逐个主题包目录检查；内置包以现有的命中数为上限，其余包为零。
- 对比度、头像、徽章、图标描边与去 AI 味各套测试改读主题包，以白领为兜底。

## 兼容性

存储的选择不受影响：`penguin.themeId` 与 `ui_prefs.themeId` 保持原值，构建不认识的 id 仍读作白领且不被改写。受影响的是单独使用发布的 `@prismshadow/penguin-ui` 样式表的页面：不带 `data-theme` 的根元素现在呈现白领的取值，白领的磨砂浮层、无线条的工作步骤与成带的设置行需要在 `data-theme="modern"` 旁写 `data-theme-base="modern"`。`applyThemeAttributes` 会写出两者；手写属性的页面补上第二个即可。`DEFAULT_THEME_ID` 不再导出，改读 `INITIAL_THEME_ID`。
