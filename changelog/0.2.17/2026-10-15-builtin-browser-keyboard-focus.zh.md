# 内置浏览器里的输入不再落进应用界面

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `desktop`, `server`, `skills`, `docs`
- **PR:** [#1150](https://github.com/Prism-Shadow/penguin-harness/pull/1150)

[English](2026-10-15-builtin-browser-keyboard-focus.md)

内置浏览器中的 `penguin browser type` 会把文字输入到应用窗口里持有键盘焦点的地方，而不是页面：
输入框持有焦点时，文字连同回车被当作一条消息发进正在运行的对话；浏览器面板的地址栏持有焦点时，
标签页会去搜索这段文字。命令却照样报告成功。

## 细节

- 桌面端转发键盘类命令（`Input.insertText`、`Input.dispatchKeyEvent`、`Input.imeSetComposition`）
  之前，先在应用窗口里聚焦该标签页的页面元素。键盘焦点随之移进页面，与 Agent 点击页面时一样；
  窗口不会被提到前台，停放在屏幕外的标签页也不会滚动。
- 标签页无法取得键盘焦点时，一个字也不会输入到任何地方：`type` 报告失败结果，原始的
  `penguin browser cdp` 键盘命令返回 409 `keyboard_focus_failed`。
- 修复位于桌面端主进程，随桌面应用更新生效，不随服务端推送更新。
- CLI 参考、内置浏览器指南与 `browser-automation` Skill 写明了新的行为与新的错误码。
- 内置浏览器的 smoke 脚本在 Electron 下检查：应用输入框持有焦点时，输入依然落进页面。
