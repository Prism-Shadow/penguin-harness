# 消息软件绑定编辑器从一张注册表读取各渠道的表单

- **Date:** 2026-11-26
- **Type:** refactor
- **Scope:** `messaging`, `web`
- **PR:** [#1921](https://github.com/Prism-Shadow/penguin-harness/pull/1921)

[English](2026-11-26-messaging-channel-forms.md)

Web App 的消息软件绑定编辑器不再按渠道分支。每个渠道的那一半表单移入 `packages/web/src/features/messaging/channels/` 下各自的模块，由一张带类型的注册表统一列出，编辑器只保留外壳。编辑器的外观与行为不变：四个渠道在中英文下、以及展开常见问题折叠后的改动前后截图逐像素一致。HTTP 请求、存储数据与浏览器存储均未改动。

## 细节

- `channels/channel-form.ts` 定义 `MessagingChannelForm`，即一个渠道需要提供的内容：它的子状态（空白值、由已存绑定载入）、校验并生成 PUT 请求体、测试请求体、是否有改动与能否测试的判断、账号 id 与掩码密钥字段、保存与探测所用的接口及探测结果的提示、开关被拦下时焦点的去处、字段组件，以及字段周围的文案（Markdown 说明、「只发送最终回复」的补充段落、创建步骤与「绑定后会发生什么」的补充、常见问题条目、教程链接）。
- `channels/feishu/`、`channels/telegram/`、`channels/qq/` 与 `channels/wechat/` 各含 `form.ts`（纯逻辑）、`fields.tsx`（凭据字段、已存密钥行、扫码块及其下方的说明）与 `index.ts`（组装好的表单）。`telegramTestNotices` 移到 `channels/telegram/test-notices.ts`，`FEISHU_DEFAULT_DOMAIN` 移到 `channels/feishu/form.ts`；共用的字段组件移到 `channels/fields-kit.tsx`。
- `channels/registry.ts` 列出四个表单，并 `satisfies Record<MessagingChannel, …>`：线上词汇新增渠道却没有表单时类型检查失败。`channels/channel-ids.ts` 存放 `MESSAGING_CHANNELS`（渠道选择器的顺序），带同样的完整性检查。
- `messaging-binding-editor.tsx` 只保留外壳（绑定运行在哪里、渠道选择器、启用开关与状态行、两个探测按钮、开关的拦截提示、占用检查提示、投递选项行、常见问题框架）；`messaging-binding-form.ts` 保留原有导出函数，改为按注册表分派，`MessagingFormState` 与结果类型由注册表推导。`messaging-binding-location.ts` 的 `accountIdOf` 同样读取渠道表单。这三个文件都不再点名任何渠道。
- 编辑器载入时，遇到本构建没有表单的渠道的绑定会跳过，而不是把它当作 Telegram 绑定读入。
- ui-gallery 的 mock 由 `MESSAGING_CHANNELS` 注册逐渠道的 PUT 与测试路由。
