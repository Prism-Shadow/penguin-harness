# Web App：可复制的 Session id、定时任务表单拾取器、保存提示、{{SHELL}} 占位符

- **Date:** 2026-08-11
- **Type:** feature
- **Scope:** `web`
- **PR:** [#245](https://github.com/Prism-Shadow/penguin-harness/pull/245)

[English](2026-08-11-web-session-and-schedule-forms.md)

四处聊天/设置的调整（[#245](https://github.com/Prism-Shadow/penguin-harness/pull/245)）：

- **可复制的 Session id。** 聊天详情卡在模型那一行下方新增一行 Session id；该 id 是一个点击即复制的按钮（标签翻转为「已复制」，采用乐观反馈，因此无论剪贴板权限上下文如何都能工作）。
- **定时任务表单的选择器与 Project 默认值对话框一致。** 「每次运行新建 Session」模式改用同样的 form 变体 `ModelSelect` / `WorkspaceSelect` 拾取器，而不再是原生 `<select>` 加一个裸路径输入框（保持选中 Project 默认值仍然意味着「跟随默认」）；「绑定 Session」模式则把自由文本的 Session id 输入框换成一个可搜索的下拉框，数据来自该 Agent 的会话列表，按标题或 id 匹配。
- **Project 新会话默认值的保存提示。** 保存该默认值区块会给出一个「已保存」toast——对话框保持打开，因此此前成功保存是无声的。
- **恢复 `{{SHELL}}` 占位符。** Agent 的 Prompt 标签页的占位符列表显示 12 项，而默认系统提示词用了 13 个——`{{SHELL}}` 缺失，于是从这份点击插入列表重建 Environment 区块时会静默丢掉 shell 那一行。现已按提示词中的顺序补上，并配一个单元测试，从 core 真实的 `DEFAULT_SYSTEM_PROMPT` 推导出期望的 token，使该列表不会再次漂移。
