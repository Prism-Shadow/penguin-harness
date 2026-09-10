# 对话停靠栏里的定时任务，以及定时任务标签页的 AI 路径

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#593](https://github.com/Prism-Shadow/penguin-harness/pull/593)

[English](2026-09-02-schedule-panel.md)

定时任务从对话本身就能触达了。对话页的停靠栏新增**定时任务**面板，列出并创建绑定到当前 Session 的任务；绑定了定时任务的对话在标题旁带一枚闹钟；Agent 设置页的定时任务标签页接入了「用 AI 创建」模式——并有一处不同：在对话内部，AI 路径把提示词预填进这段对话的输入框，而不是新开一个对话。

## 细节

- 新的停靠面板种类 `schedules`：当前 Session 的任务（取该 Agent 的任务列表、筛到本会话）、搜索框与全部 / 生效中 / 已暂停 / 已完成筛选，每行为状态字形、任务名与一行人话时间表（`describeSchedule`：「每天 08:00 · 下次 明天 08:00」「每周一 09:00」「每 30 分钟」「一次性 · 9 月 3 日 10:00」，已结束的状态放在句首），owner 另有启停开关与编辑 / 删除菜单，其下是建议列表（每日简报、每周回顾、跟进提醒、监控更新）。列表在面板到前台、窗口重获焦点、收到 `schedule_fired` / `schedule_queued` 事件、可见期间每 30 秒及每次改动后刷新；草稿页说明发送第一条消息后可用。
- 绑定到对话的定时任务在面板头部创建——组件包的 `CreateButtons` 置于标题之下另起一行，因为停靠栏宽度由用户拖动，与标题同行时窄面板会把按钮挤裁。**用 AI 创建**（魔法笔，所有成员）把请求连同面向本会话的固定尾句组装好，经对话页的 `ComposerControl` 写进本对话的输入框；不发送任何内容，按下发送仍由用户决定，之后走的就是手输文字的同一条路。对话框也可复制完整提示词。**手动创建**（手形，仅 owner）打开目标锁定为本 Session 的表单。
- 绑定了定时任务的 Session 在对话页顶部标题右侧带一枚闹钟与数量，无障碍名称为「3 个定时任务」，点击即打开面板。它与面板读同一个共享 store（`features/schedules/schedule-store.ts`，存该 Agent 的整份列表，`boundScheduleCount` 按 Session 收窄），在 Session 变化、窗口重获焦点、两个定时任务事件到达以及面板每次改动后刷新——不新增服务端字段。
- 定时任务标签页表头改为组件包的 `CreateButtons`——其 AI 路径预填一段以 Project 默认 Agent 开启的新对话，尾句点名该 Agent、`penguin schedule add` 或 TOML 文件，以及新建 Session 模式；无权写该 Agent 文件的成员只看到 AI 那一枚——列表为空时以建议代替空表。
- 创建 / 编辑表单从标签页移入 `features/schedules/schedule-form-modal.tsx`，由标签页与面板共用，并带 `lockedSessionId` 模式；闹钟字形成为 `components/ui/icons.tsx` 的 `SCHEDULE_ICON`，Agent 卡片的计数、面板与工具行标记共用一个标记；`AiCreatePanel` 接受 `byLine` 覆盖；`ComposerControl.fillExample` 更名为 `fillPrompt`，组装好的定时任务提示词与草稿页的示例卡片走的是同一条路。
- Web App 文档以双语描述了面板、它的两枚按钮与工具行的标记。
