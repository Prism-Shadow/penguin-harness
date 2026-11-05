# 切回 Session 时恢复面板全屏

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1128](https://github.com/Prism-Shadow/penguin-harness/pull/1128)

[English](./2026-10-14-session-dock-fullscreen.md)

切换到其他 Session 后再切回来，会恢复该 Session 的面板全屏状态。每个 Session 分别记住自己的全屏状态，草稿发送第一条消息后，创建的 Session 也会继承这一状态。

侧面板宽度和底部面板高度仍在 Session 之间共用。退出全屏、隐藏面板或关闭最后一个标签页会清除对应的全屏状态。刷新页面或跨越窄屏布局断点后，面板恢复普通尺寸。
