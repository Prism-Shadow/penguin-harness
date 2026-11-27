# 插件市场的封面重绘为同一套有光影的系列，由本仓库的生成器产出

- **Date:** 2026-11-27
- **Type:** feature
- **Scope:** `server`, `ui`, `tooling`
- **PR:** [#1929](https://github.com/Prism-Shadow/penguin-harness/pull/1929)

[English](2026-11-27-plugin-market-covers.md)

重绘了插件市场所列每个插件的封面，并替换了本构建随附的封面（`packages/server/src/plugin/market-covers/`）。现在每张封面只有一个主体，由插件所在领域的物件以白色绘成，置于插件色相的底色上，光从左上方来；整套封面的光线、投影与圆角一致。封面上没有截图，也没有产品标志，主体落在 1:1 裁切仍能保留的正方形之内。

## 细节

- `scripts/market-cover-art/`：生成器。`covers.mjs` 为每个插件指定模板或场景及其色相，`kit.mjs` 提供配色、有光的底色与带投影的物件，`scenes.mjs` 是各幅画，`build.mjs` 经仓库自带的 Playwright Chromium 写出 SVG 原稿与 WebP 文件（1280 × 720 与 640 × 360）。加上 `--community` 时，它还把每张封面及其 `tone` 写进社区仓库的检出。同目录的 README 说明了这套系统、安全区与导出规则。
- 自进化工具包的封面以 Mona Sans 大字写出方法名，压在自进化循环之上；各沙箱后端共用一枚盾形徽记，以四种深浅的石板色区分。
- 没有图片的插件，市场就地绘制的缺省封面改用同样有光的底色与带柔和投影的白色图块，在每个主题与明暗模式下都取作者封面的明度。
