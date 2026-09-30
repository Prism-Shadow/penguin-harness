# 纯 HTTP 源下复制可用，对勾代表复制真的发生了

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `web`
- **PR:** [#523](https://github.com/Prism-Shadow/penguin-harness/pull/523)
- **Issue:** [#468](https://github.com/Prism-Shadow/penguin-harness/issues/468)

[English](2026-08-27-copy-on-plain-http.md)

Web App 里的每一个复制控件——回复、用户消息、代码块、Session id、Agent State 路径、终端选区、菜单里的复制行——都只走异步 Clipboard API，而浏览器仅在安全上下文中提供它。在非 localhost 的纯 HTTP 源上（也就是把 `HOST` 绑到非回环地址后所提供的形态），写入是一次空操作，控件却照样闪出对勾（或弹出 toast）、并向屏幕阅读器播报已复制：文本哪儿也没去，控件却说它到位了。现在写入交给 `copy-to-clipboard` 包，在 Clipboard API 缺失或被拒时退到文档自带的复制命令；对勾、tooltip、读屏播报与 toast 都改为等写入报告成功之后才出现。

## 细节

- 所有复制控件、终端的「复制所选」按键以及终端里程序自己发起的复制（OSC 52）都调用同一个模块 `packages/web/src/lib/clipboard.ts`，只有它导入该包；一个测试断言 `packages/web/src` 下再无其他模块向 `navigator.clipboard` 写入或导入该包。
- API 缺失这条路径不经挂起、就在点击自身的任务内到达文档的复制命令，因为该命令只在用户手势进行中才被接受。
- 回退借用的元素采用 fixed 定位并裁成零尺寸，选中它不会滚动页面；无论复制成败它都会被移除，页面原有的选区与获得焦点的输入框（复制终端选区时即终端自己的输入框）随后归还。
- 浏览器彻底拒绝的复制让控件停在空闲态而不显示对勾，于是可以重试，而不是被报告为已完成。该包的 `window.prompt` 兜底保持关闭。
- 终端粘贴维持原样：`Ctrl+V`、`Ctrl+Shift+V` 与 `Shift+Insert` 走浏览器原生 paste 事件，不涉及剪贴板权限。
