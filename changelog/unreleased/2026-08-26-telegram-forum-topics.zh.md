# 回复留在被提问的那个 Telegram 话题里

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#507](https://github.com/Prism-Shadow/penguin-harness/pull/507)

[English](2026-08-26-telegram-forum-topics.md)

论坛型超级群把一个会话拆成若干话题，每条消息都带着它被写在哪个话题里。此前只有一轮运行的第一条回
复留在原处——Telegram 会从被引用的消息推断回复所属话题——其余的都走出了对话、落进 **General**：本轮
后续完成的消息、长回复第一段之后的每一段、工具审批提示，以及测试消息。答案的一半到了该到的地方，
另一半出现在别处。

## 话题搭在 chat id 上

`messaging_bindings.last_chat_id` 现在为写在话题里的消息存储 `<chat id>:<话题 id>`，其余情况仍存
裸 chat id。`MessagingInboundMessage.chatId` 本就对消息桥不透明，与 `messageId` 同理——由连接器铸
造、也由连接器在 `sendText` 中消费——因此话题能抵达每一条出站路径，而渠道中立的接口、仓储与 schema
都不必知道「论坛话题」是什么；并且它就存在本就持久化会话的那一列里，重启后依然有效。

绑定记住的是**最近一个**话题，与它对会话本身的处理一致：用户换到新话题，回复就跟到新话题。

回复引用（reply ref）也获得了同样的可选分量。回复通常会继承被引用消息的话题，但
`allow_sending_without_reply` 会在目标消失时退化为普通发送——那恰恰会在对话最不该丢失话题的时刻落
进 General。

此前写入的所有 chat id 都按其本身解析：没有分隔符即没有话题，而这也正是普通群聊与论坛 General 话
题的含义。

## 话题被删除时退化，而不是丢失回复

Bot API 没有与回复标志对应的 `allow_sending_without_thread`，因此向一个已被删除或关闭的话题发送会
直接失败。这类发送会不带话题重试一次：落在 General 比落在正确位置差，却远好过丢掉模型已经产出的答
案。重试的判据是「本次发送带了话题」，而不是 Telegram 的错误措辞；不带话题的发送绝不重试——因此真
正的失败仍会以 `messaging_send_failed` 呈现，而不会被变成第二次投递尝试。
