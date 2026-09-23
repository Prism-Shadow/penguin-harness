# 公司频道可设默认通知对象

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`, `cli`
- **PR:** [#840](https://github.com/Prism-Shadow/penguin-harness/pull/840)

[English](2026-09-23-channel-default-recipients.md)

公司模式的频道现在可以设默认通知对象：完全没有 `@` 的消息视同 @ 了名单上的成员。名单上的员工在工位会话收到这条消息，与被 @ 时一样；名单上的人会在「@我」计数与概览收件箱里看到它。点名了谁的消息只归被点名者，`system` 行从不经名单投递。

## 频道文件

- `channel.toml` 新增可选的 `notify` 列表，项为 `agent:<id>` / `user:<id>`；缺省或为空时，没有 `@` 的消息只记录在案，与此前相同。
- 名单项必须是该频道的成员（全员频道里每名员工与每位 Project 成员都是成员）。移出成员时同步从名单删去；已离职的项在投递时忽略。

## API、CLI 与 Web

- `PATCH /api/projects/:projectId/organizations/:orgId/channels/:channelId` 接受 `notify`（任一成员可设；`[]` 清空；含非成员时整条请求以 `notify_not_member` 拒绝），频道条目带 `notify`。
- `penguin org channel notify <channel_id> <principal>...` 设定名单，`--none` 清空；`penguin org channel show` 打印名单。
- 频道头右上角的成员列表每行带「总是通知」开关（未归档频道的任一成员可切换）；频道头的「?」列出当前的默认通知对象。
- 组织手册向员工说明了这份名单。
