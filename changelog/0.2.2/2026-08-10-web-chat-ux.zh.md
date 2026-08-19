# Web App：聊天体验批次——密码提示、进程列表、草稿对话、面板时序、排队发送的正确性

- **Date:** 2026-08-10
- **Type:** feature
- **Scope:** `web`, `server`, `core`, `cli`
- **PR:** [#227](https://github.com/Prism-Shadow/penguin-harness/pull/227), [#241](https://github.com/Prism-Shadow/penguin-harness/pull/241), [#246](https://github.com/Prism-Shadow/penguin-harness/pull/246)
- **Issue:** [#89](https://github.com/Prism-Shadow/penguin-harness/issues/89)

[English](2026-08-10-web-chat-ux.md)

## 启动时的初始密码提示（server + CLI）

只要预置的 admin 密码仍是初始密码，它就会被持久化在 `<root>/initial-admin-password`（0600）中。每次服务端启动都会用 ASCII 边框重新打印它并附上「请尽快修改」的提醒，而 `penguin web` 挂接到一个已在运行的实例时也会打印同样的提示（新增无副作用的子路径导出 `@prismshadow/penguin-server/initial-password`）。任何 admin 密码更新——自行修改、桌面端设置，或管理员重置——都会删除该文件；没有该文件的旧数据根目录保持静默。文档（`quickstart` / `web-app` / `server-api`、README）同步更新。

## 对话详情：合并的统计入口、进程列表、trace 文件行

Token / 成本 / 已用时间三个芯片移到工具栏最右侧，并在 `sm+` 视口下自身即是详情的触发点（`sm` 以下只显示信息图标）。当该对话有存活的后台进程时，一个绿色的运行中服务计数会挂在已用时间芯片右侧。详情卡逐行显示模型 / 工作区 / 创建时间 / 统计（Token 带输入 / 缓存 / 输出的拆分），随后是一个可交互的进程列表（命令、启动时间、pid；停止按钮会杀掉整个进程组），以及一行 trace 文件，点名实际的 `.jsonl` 路径并深链到 trace 页（取代了原先的「查看 trace」按钮）。

## 后台进程的接线与生命周期（core + server）

`ManagedSession` 保存 `cmd`/`cwd`/`startedAt` 并暴露 `pid`；注册表新增枚举与按 id 终止；core 的 `Session`/`Environment` 暴露 `listBackgroundCommands()` / `killBackgroundCommand()`；新增路由 `GET /api/sessions/:id/processes` 与 `POST /api/sessions/:id/processes/:processId/kill`（仅限活动运行时）。删除 Session/Agent/Project 现在会在其驱动结束后释放运行时——后台进程随对话一同消亡——而空闲清退会跳过仍有存活后台进程的条目（清退会让操作系统进程失去任何停止手段而被搁浅）。

## 停放的草稿对话

在输入区仍有已打出文本时点击任一新建会话入口，会把该草稿停放为侧边栏新增的「草稿」分组中的一行（按用户 × Project 存于 localStorage，最新在前，上限 50）。这些行在 `/chat/draft-<id>` 打开并还原全部选择，可编辑（自动保存）、可发送（成为真实会话，该行移除）、可删除（带确认对话框）。Skill 的快捷调用 / 导入提示现在也走停放，而不再静默覆盖已打出的文本。

## 面板与消息流打磨

在 Agent 面板打开时打开工作区面板（或反之），会先让已打开的面板完全收回，再把新的滑入，因此这次交换读起来是一次真正的收回，而不是被抹掉；移动端的 Sheet 保持即时切换。一个 ResizeObserver 会在容器或内容于流提交之外发生尺寸变化时，把消息流重新吸附到底部（仍受既有的跟随守卫约束）——初始密码横幅不再会让一个刚打开的对话停在离底部一个横幅高度的位置。基准测试的 case 浏览器默认展开两个材料分组，并把 readme 的自动预览钉在陈述分组上；点击输入区那个只读模型芯片会提示 `/model` 可切换模型。

## 排队后续消息的正确性

修复了运行中途发送路径周围的两处竞态：一次在完成边界上返回 `409 not_running` 的 `/steer`，现在会把整份草稿改道经既有的 `queueIfBusy` Task 路径，而不是走一个可能落得 `409 task_in_progress` 并丢掉草稿的裸 `POST /tasks`（[#227](https://github.com/Prism-Shadow/penguin-harness/pull/227)，关闭 [#89](https://github.com/Prism-Shadow/penguin-harness/issues/89)）；以及在输入区选定的逐轮思考等级现在也会搭乘后续队列路径——此前 `onQueueFollowUp` 只投递输入，恰恰在它被选定的那一次发送上静默丢掉了该等级（[#246](https://github.com/Prism-Shadow/penguin-harness/pull/246)）。
