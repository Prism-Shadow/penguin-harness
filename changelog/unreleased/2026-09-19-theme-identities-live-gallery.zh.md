# 三套主题拉开差异，画廊能演示交互

- **Date:** 2026-09-19
- **Type:** process
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#795](https://github.com/Prism-Shadow/penguin-harness/pull/795)

[English](2026-09-19-theme-identities-live-gallery.md)

重新设计了 Frost 与 Console，三套主题不再共用同一副轮廓；组件画廊新增动态变体，在每套主题下逐帧演示交互。Primer
逐像素不变；Web App 在主题切换开放前只渲染 Primer，因此同样不变。

## 主题

- 尺寸不再跨主题共享。新增的间距单位令牌桥接为 Tailwind 的 `--spacing`，所有间距与尺寸工具类随主题缩放：Primer
  保持原生的 0.25rem，Frost 更宽松（0.28rem，正文 15px），Console 更紧凑（0.225rem，正文 13px）。`text-sm` 与
  `text-xs` 跟随各主题的正文与小字字阶。
- Frost 恢复 Sierra 式的色场：应用窗口后铺暖色底场，导航列落在底场上，主列是悬浮的圆角薄片；盒子圆角更大，控件为
  胶囊形，标题用常规字重的大字号。
- Console 改为 opencode.ai 式的等宽界面：导航、按钮、标签、标题、徽章与表格用 Commit Mono，阅读面（消息正文、回答
  的 Markdown、输入框）仍用 IBM Plex Sans。浅色为纸白、深色为暖近黑，保留橙色强调色与直角；窗口通栏并以细线分隔，
  选中的导航行前有 `>`，带头部的框把标题嵌在顶线里。
- 新增第七个样式钩子 `ui-shell`，挂在应用窗口上（`data-slot="nav"` / `"main"`），唯一宿主是 `AppShell`。新增令牌
  `--ui-font-ui` 作为界面字体（`body` 读它），与阅读用的 `--ui-font-sans` 分列。
- 令牌契约由 188 个增至 210 个：外壳一组、`--ui-font-ui`、间距单位，以及用于进出、显现与尺寸变化的 11 个动效令牌。

## 动效

- 组件用四个数据属性声明动效——`data-presence` 配 `data-side`、`data-backdrop`、`data-reveal` 与
  `data-layout-motion`——由 `theme.css` 按主题的令牌演绎：Primer 淡入加 4px 位移，Frost 从 0.96 弹入、模糊渐清并
  逐词显现流式文本，Console 逐格跳变、不淡入。减少动效下一律直接呈现终态。

## 画廊

- 六个模块各新增一个动态变体：流式回复（对话）、输入并发送（输入区）、收起与展开（侧栏与导航）、打开与关闭（浮层：
  菜单、对话框、通知）、运行到结束（状态）与展开目录（文件）。每个变体是一组帧，卡片按时钟逐帧播放并循环。
- 卡片在视口内时自动播放。卡片底部有走带控件：播放与暂停、重播、上一帧与下一帧、点击跳转的帧标签，以及 0.5× /
  1× / 2× 变速。比较模式下三套主题共用该卡片的时钟，同一时刻停在同一帧。
- `/embed?module=&variant=&frame=&play=` 可定位到某一帧，动态变体缺省暂停在最后一帧。动态变体的截图命名为
  `<模块>--<变体>@<帧>.png`，加 `--variants all` 时逐帧出图。卡片暂停时，路径标注当前帧。
- 「基础」的动效板可逐项重放，间距与形状板展示间距单位与外壳。
