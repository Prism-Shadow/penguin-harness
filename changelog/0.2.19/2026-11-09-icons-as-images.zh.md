# 图标是图片，从不以标记进入页面，除 SVG 外也可以是 PNG、JPEG、WebP、GIF 或 AVIF

- **Date:** 2026-11-09
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `ui`, `landing`
- **PR:** [#1514](https://github.com/Prism-Shadow/penguin-harness/pull/1514)

[English](2026-11-09-icons-as-images.md)

插件的图标，以及它装进每个 Skill 与钩子包旁的副本，此前以 SVG 文本送到 Web App，由页面作为标记内联。挡在这段文本与应用源上运行的脚本之间的只有一份拒绝清单，而在桌面端，这样的脚本能够到宿主的命令接口。现在任何图标都不再以标记进入页面：服务端把每个图标作为图片按 URL 提供，页面用 `<img>` 或 CSS 遮罩绘制。

## 格式

图标可以是 SVG、PNG、JPEG、WebP、GIF 或 AVIF，单个不超过 256 KB。格式按文件头字节识别，且须与文件名一致；SVG 以 `<svg` 根元素识别，其前只许 BOM、XML 声明与注释，并且仍要通过拒绝清单（脚本、动画、事件、链接与外部引用一律拒绝）。包用卡片的 `icon` 字段指明图标，或在根目录放一个 `icon.<扩展名>`。建议方形；图标在图块内按比例完整绘制。

## 绘制

单色 SVG，即所有着色都是 `currentColor` 或 `none` 的，标为 `tint`，以文字色作遮罩绘制，内置的线性图标因此观感不变；其余图标照原样绘制。图片加载失败时回退该类事物的统一图形：Skill 是书本，钩子包是钩子，插件是拼图块。

## 提供

列表带 `icon: { url, tint }`。URL 带图片的内容修订（`?rev=`），永久缓存。路由为 `GET /api/plugins/:plugin/icon`、`GET /api/plugins/registry/icon?name=…`、`GET …/agents/:a/skills/:name/icon`、`GET …/agents/:a/hooks/:name/icon` 与 `GET /api/projects/:p/dir-skills/icon?path=…&name=…`。响应一律按字节判定的类型，附 `X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` 与 `Cross-Origin-Resource-Policy: same-origin`；Skill 与钩子包的图标只对 Project 成员提供。机器上 Agent 的图标经机器代理显示。

## 安装

安装时按图标格式写成 `icon.<扩展名>`，目录里不留其他格式的图标。读取方接受目录里任一 `icon.*`，此前安装写下的 `icon.svg`、自建 Skill 自带的 `icon.svg` 照旧读取。

## 其他界面

官网的插件页按同一规则读取图标，用同一个组件绘制。`plugin-porting` Skill 在上游没有 SVG 图标时改为带入其 PNG 标志。
