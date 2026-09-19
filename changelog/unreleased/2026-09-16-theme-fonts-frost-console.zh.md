# 共享 UI 包打包字体，并定义 Frost 与 Console 两套主题

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `ui`, `web`
- **PR:** [#761](https://github.com/Prism-Shadow/penguin-harness/pull/761)

[English](2026-09-16-theme-fonts-frost-console.md)

`@prismshadow/penguin-ui` 加入了三套主题的字体、两套新主题的令牌取值：Frost（`modern`，参照 sierra.ai）
与 Console（`geek`，参照 e2b.dev），以及各主题为之编写样式的封闭样式钩子清单。Web App 中尚无任何地方引用
新主题，除账户菜单底部多出一行字体致谢外，应用外观与此前一致。

## 字体

- 六个 fontsource 包，全部为 SIL Open Font License 1.1：Mona Sans 与 JetBrains Mono（为后续的 Primer 打磨
  预先声明；Frost 已用 JetBrains Mono 排代码）、Console 的 IBM Plex Sans、IBM Plex Sans Condensed（仅 600）
  与 Commit Mono，以及 Console 的中文字体 Noto Sans SC（Primer 自 W1a 起也用它）。
- Frost 的拉丁文与中文统一使用小米的 MiSans，字重 400 与 500。MiSans 没有官方 npm 包，因此由
  `scripts/build-misans.py` 从小米官方字体包中截取 MiSans Regular 与 Medium，按 Noto Sans SC 的分片划分，
  各切成 99 个 `unicode-range` WOFF2 分片放入 `fonts/misans/`，并逐个回读分片，确认其中的字形、OpenType
  特性与名称记录均与原字体一致。该划分之外的生僻汉字不随包分发。Frost 关闭了字重合成，粗体请求以 Medium
  呈现。
- 页面只下载当前主题引用的字体文件，以及文字实际用到的分片：在样例页面上，Frost 的英文页加载 93 KB 字体，
  中文页加载 627 KB；Primer 目前不引用任何随包字族，不下载字体文件。`@font-face` 声明则不同：三套主题的声明都
  在应用的主样式表里，每个用户都要下载，约占其压缩后 122 KB 中的 94 KB；这一开销已被接受，没有改为按主题按需
  加载字体样式表。构建时不把字体内联进该样式表。构建产物共含 9.1 MB 字体：MiSans 4.26 MB、Noto Sans SC
  4.52 MB、拉丁字形 0.32 MB。
- `scripts/sync-font-licenses.mjs` 把各 fontsource 包的许可文本镜像到 `fonts/LICENSES/`。《MiSans 字体知识产权
  许可协议》依小米发布的 PDF 转录到同一目录，并登记在 `fonts/vendored-fonts.json` 中。`penguinUi()` Vite 插件
  把所有许可文本以 `fonts-licenses/<名称>.txt` 输出到每个构建产物中；`fonts/README.md` 记录各字族、许可、
  字节数与更新方法。
- Web App 的账户菜单末尾按 MiSans 许可协议的要求加入一行致谢，中英文各一。

## 令牌与钩子

- 令牌契约共 188 个名称：新增 `--ui-radius-control`（可按压控件的形状，桥接为 `rounded-control`；Primer
  0.375rem、Frost 胶囊形、Console 为 0）、`--ui-stack-0` 与 `--ui-stack-4`，删除 `--ui-glass-highlight`。
  `themes/github.css` 以应用当前的取值声明了这三个新名称。
- `hooks.ts` 列出六个样式钩子：`ui-glass`、`ui-eyebrow`、`ui-display`、`ui-live`、`ui-frame` 与
  `ui-underline-nav`，并写明每个样式依赖的标记结构。
- `theme.css` 为按钮、链接与标签页设定默认的过渡属性列表（文字颜色、背景与边框颜色、不透明度和阴影），
  任何 `transition-*` 工具类都会将其替换；组件不设时长就没有过渡。

## 主题

- `themes/modern.css` 与 `themes/geek.css` 定义全部令牌，并重新指向灰阶与白色，让应用现有的调色板类落到
  各主题自己的中性色上。与 `themes/github.css` 相同，基础规则以浅色取值定义全部令牌，深色规则只写深色下
  变化的取值。
- Frost：暖米白画布配白色卡片，控件为胶囊形，容器圆角取 4–20 px 刻度，单一绿色强调色，标题用常规字重，阴影
  不带色调且收得很紧；磨砂玻璃（16 px 模糊）只用于菜单、弹出层、模态卡片、悬浮输入框与吸顶页头。sierra.ai
  没有暗色模式，Frost 的暗色是自拟的暖调近黑配色。
- Console：黑色（或白色）画布、1 px 线条、处处零圆角、单一橙色强调色；只有 h1 用窄体大写，其下的 Plex Sans
  标题用常规大小写；分组标签大写，进行中信号为步进动画，等宽字体只用于代码与数据，层次靠线条表达：模态卡片
  以较深的 `line-emphasis` 线条描边，不投阴影。
- 两套主题共用一套字号阶梯：标题逐级放大 1.25 倍，最小不低于 .75rem；状态过渡时长为 120–200 ms；控件
  （0.25、0.375 与 0.625rem）、列表行（0.375rem）与菜单行（0.5rem）的纵向内边距与 Primer 相同，切换主题
  不改变这些高度。两套主题
  都包含 `done` 与 `info` 色调，每个色调在自身底色上作为文字对比度达 4.5:1，在所有表面上作为标记对比度达
  3:1。
