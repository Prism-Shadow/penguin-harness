# `penguin chat` 显示 Session 的每一次运行，包括仍在运行的那一次

- **Date:** 2026-11-07
- **Type:** fix
- **Scope:** `cli`, `server`, `docs`
- **PR:** [#1503](https://github.com/Prism-Shadow/penguin-harness/pull/1503)

[English](2026-11-07-cli-resume-running-session.md)

对一个 Task 仍在运行的 Session 执行 `penguin chat --resume`，下一条消息不再得到 `409 task_in_progress`。例如启动 Task 的终端已经关闭时，就会出现这种情况。现在对话对其 Session 保持一条订阅，显示其上的每一次运行，不论由谁发起：恢复时先显示历史，再显示这次运行已有的内容，跟随到运行结束，然后才给出提示符；对话停在提示符时，别处发起的运行也照此显示，连同它的输入。显示运行期间，输入即插话，Ctrl-C 中断，运行等待的审批在对话里询问，`/exit` 离开对话而运行继续。

接续改由服务端完成。`GET /api/sessions/:id/messages?live=run` 返回截至当前运行之前的历史，并附上这次运行按流式发布顺序保留的记录（delta 已合并），客户端因此无需比对，每条记录只显示一次。`POST /api/sessions/:id/tasks` 接受 `steerIfBusy`：同一个请求里，空闲的 Session 发起 Task，运行中的 Task 把输入作为插话，压缩中则排队。服务端不支持这两项时，对话提示升级服务端。
