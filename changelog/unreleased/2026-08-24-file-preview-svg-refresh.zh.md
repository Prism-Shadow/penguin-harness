# 文件面板每轮对话后自动刷新，SVG 也能渲染了

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)

[English](2026-08-24-file-preview-svg-refresh.md)

Web App 的文件面板有三处毛病：Agent 一写文件它就过期、`.svg` 出现在哪里都是一张裂图、带 SVG 的
Markdown 打开后会持续抖动。

## 一轮结束即重读列表与打开中的文件

此前面板只在挂载、目录跳转、以及从隐藏转为可见时刷新——唯独不在真正会改变 Workspace 的那个时刻：
一轮 Task 结束。现在它在该边沿重读（与刷新会话列表、Agent 列表的 active→idle 同一个转换），预览中
打开的文件同样重读：把面板放在对话旁边，为的就是看着 Agent 改文件。

重读不碰用户自己的状态——渲染/源码的选择保持不变，移动端抽屉不会跳起——重读失败（文件在这一轮里被
删掉）时保留屏幕上已有的预览，而不是把它换成「不支持的类型」。图片与 PDF 预览重新挂载以真正重新取
字节，Markdown 预览里的图片带上本次读取序号，被改写的图示因此会重绘；`/files/content` 也改为
`Cache-Control: no-store`——Workspace 的一个路径，装的就是 Agent 最后写进去的东西。

## SVG 恢复渲染

内联的 `/files/content` 出于同源 XSS 防御，把所有可执行脚本的类型降级为 `text/plain`。这对 HTML
成立，却也让每一个 `.svg`——无论作为预览还是作为 Markdown 预览里的 `<img>`——变成裂图。SVG 现在内
联保留 `image/svg+xml`：`<img>` 永远不会执行 SVG 里的脚本。真实类型重新打开的风险是**直接访问该
URL**时浏览器把它当同源文档渲染，`Content-Security-Policy: sandbox`（不给 `allow-scripts`、不给
`allow-same-origin`）堵住这一条；sandbox 指令对子资源不生效，`<img>` 这条路径不受影响。HTML 维持
纯文本降级。以同样方式浏览的 Benchmark 用例素材同步处理。

## 抖动

SVG 不带像素尺寸，渲染高度完全由宽度按比例换算——于是预览的内容高度成了「有没有滚动条」的函数。这
形成一个闭环：内容溢出 → 滚动条占去宽度 → 图片变矮 → 内容装得下 → 滚动条消失 → 再次溢出，如此往
复。预览的滚动容器现在恒定预留滚动条槽位（`scrollbar-gutter: stable`），把这条反馈路径切断；在滚
动条本就悬浮的平台上该属性不产生任何影响。
