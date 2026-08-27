# 纯 HTTP 源下复制可用，对勾代表复制真的发生了

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `web`
- **Issue:** [#468](https://github.com/Prism-Shadow/penguin-harness/issues/468)

[English](2026-08-27-copy-on-plain-http.md)

Web App 里的每一个复制控件——回复、用户消息、代码块、Session id、Agent State 路径、终端选区——都只走异步 Clipboard API，而浏览器仅在安全上下文中提供它。在非 localhost 的纯 HTTP 源上（也就是把 `HOST` 绑到非回环地址后所提供的形态），写入是一次空操作，按钮却照样闪出对勾、并向屏幕阅读器播报已复制：文本哪儿也没去，控件却说它到位了。这次为写入补上了经隐藏 textarea 与文档自带复制命令的回退路径，对勾也改为等写入报告成功之后才出现。

## 细节

- 回退被放进一个模块，所有复制控件和终端都调用它，因此新的复制入口无法再各自去碰 `navigator.clipboard` 而重新引入这次的静默空操作——一个测试断言 `packages/web/src` 下再无其他模块向它写入。
- 回退借用的 textarea 采用 fixed 定位加透明，而不是挪到屏幕外：`select()` 会把目标滚动进视野，放在首屏之下的 textarea 会让每次复制都跳动一次页面。
- API 缺失这条路径不经挂起、就在点击自身的任务内到达文档的复制命令，因为该命令只在用户手势进行中才被接受。
- 浏览器彻底拒绝的复制——在确实提供 Clipboard API 的源上被拒权限——让控件停在空闲态而不显示对勾，于是可以重试，而不是被报告为已完成。
- 终端粘贴维持原样：`Ctrl+V`、`Ctrl+Shift+V` 与 `Shift+Insert` 走浏览器原生 paste 事件，不涉及剪贴板权限。
