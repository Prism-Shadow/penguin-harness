# Web App：离开运行中的对话时不再出现幻影列表重载

- **Date:** 2026-08-11
- **Type:** fix
- **Scope:** `web`
- **PR:** [#242](https://github.com/Prism-Shadow/penguin-harness/pull/242)

[English](2026-08-11-chat-phantom-idle-reload.md)

聊天页会在一个 Task 结束时重新加载会话与 Agent 列表（某一轮可能派生了子会话或自动创建了 Agent）。而那个触发条件只盯着流的任务状态——但流在脱离（detach）时也会重置为「idle」，因此**在 Task 仍在运行时切换对话或点击「新建对话」**就会触发同一对重载。两个侧边栏上下文都会重新拉取，整个应用在点击之后立刻重新渲染，偶尔表现为进入草稿页时一次不受控的闪烁（[#242](https://github.com/Prism-Shadow/penguin-harness/pull/242)）。

该触发条件现在由会话标识守卫：只有在**同一个**会话上观察到的 running→idle 转变才算作一次完成。切换时跟踪器从 idle 重新开始——在与 id 变化同一次提交中看到的状态仍属于此前那个流。而在另一个对话打开期间完成的运行，仍会经会话事件通道抵达侧边栏。
