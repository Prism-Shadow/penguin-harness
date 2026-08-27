# 听不到群消息的 Telegram 机器人现在会说出来

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#499](https://github.com/Prism-Shadow/penguin-harness/pull/499)

[English](2026-08-26-telegram-group-privacy.md)

在群里向已绑定的 Telegram 机器人发消息，可能得不到任何回应，也没有任何线索：没有报错、状态不变、也不
留记录。原因是 Telegram 的 **Group Privacy**——它对每个机器人都默认开启，在它生效时，Bot API 对一个不
担任该群管理员的机器人只投递：明确指向它的命令（`/command@this_bot`）、它是群里最后一个发言的机器人时
的通用命令、经由它发出的 inline 消息，以及对它自己消息的回复。一句普通的话——以及一个普通的 `@` 提及
——根本不会被投递，因此 `getUpdates` 什么也取不到，连接看上去完全正常。该设置属于机器人拥有者，在
@BotFather 中；本次改动把它报出来：在凭证测试里，也在绑定面板的常见问题折叠里。

## 凭证测试报出这项设置

`getMe` 会返回 `can_read_all_group_messages`（「True，表示该机器人的隐私模式已关闭」，仅在 `getMe` 中
返回）。Telegram 凭证测试的响应以 `groupPrivacy` 携带它；当测试成功而机器人仍开着 Group Privacy 时，
成功提示旁会另起一条——凭证确实通过了，这条提醒只关于群聊。

这条提醒说的是那项设置，而不是某个具体群里的结果。Group Privacy 按账号计，而 Telegram 会在机器人担任
管理员的群里覆盖它，因此提醒的说法是：在它不担任管理员的群里，它收不到普通消息。只有在 API 真的回答了
这个问题时才会报出该字段；响应里没有这一项时就什么也不报，而不是去猜。

## 常见问题折叠写清两条出路

绑定面板的 Telegram 常见问题折叠里，在「一个 Token 只能被一个程序使用」旁边新增了一条，完整地写着修复
办法——提示语只指向它，不再自己复述。它把不必改动群成员关系的那条放在最前：

- 把机器人设为该群的管理员，管理员始终收到全部消息；
- 或者到 @BotFather 用 `/setprivacy` 关闭 Group Privacy，然后把机器人移出该群再重新拉入——已在的群不
  会自动生效。
