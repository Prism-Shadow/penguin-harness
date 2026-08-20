# 后台进程列表的服务链接

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`
- **PR:** [#373](https://github.com/Prism-Shadow/penguin-harness/pull/373)

[English](2026-08-20-process-service-url.md)

会话详情卡的后台进程列表现在会在存活进程的 pid 旁边,以可点击链接展示该进程宣告过的服务 URL——对话里启动的 dev server 一键即达,不必再从转录里复制粘贴。

## 细节

- URL 从页面本就持有的转录中探测:exec_command 的后台提升备注与 input_command 的 `process_id` 参数把工具输出绑定到对应进程,该输出打印的最后一个本机 URL(`localhost`、`127.0.0.1`、`[::1]`,以及监听侧通配 `0.0.0.0` / `[::]`,通配改写为 `localhost`)成为该行的链接。匹配前剥离 ANSI 颜色包裹,嵌套的 subagent 对话同样纳入扫描。
- 远程主机被忽略——日志里指向机器之外的 URL 不是进程自身的服务。
- 已退出的行不带链接:服务随进程一起结束了。链接在新标签页打开;完整 URL 放在 tooltip 里,行内展示省略协议前缀的形式。
