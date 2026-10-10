# 远程控制的启用开关置灰时，点击会说明先做什么

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#1029](https://github.com/Prism-Shadow/penguin-harness/pull/1029)

[English](2026-10-10-messaging-enable-hint.md)

对话的远程控制编辑器里，前序步骤未完成时**启用连接**开关仍呈置灰样式，但点击它不再没有反应。点击不会向服务器发出请求：它把提示行的原因弹为提示消息，短暂强调该行，并把焦点移到要补的地方。微信和 QQ 移到扫码区，飞书和 Telegram 移到第一个未填写的凭证字段，表单有未保存的修改时移到**保存**按钮。另一个渠道已启用时，提示会点名该渠道，焦点保持不动。

缺少凭证时的提示按渠道措辞：微信为扫码，QQ 为扫码或填写并保存 App ID 与 App Secret，飞书为填写并保存 App ID 与 App Secret，Telegram 为填写并保存 Bot Token。远程控制文档补充了这一行为。
