---
title: Remote control
description: Connect a conversation to a Feishu, Telegram, QQ or WeChat bot, and talk to its agent from that app.
---

Remote control connects one conversation to a bot on Feishu, Telegram, QQ or WeChat. Messages you send to the bot go into the conversation exactly as if you had typed them in the Web App, and the agent's replies are sent back to the chat. PenguinHarness opens the connection to the messaging platform itself, so you need no public address or callback URL.

- To connect a bot, follow the section for your app: [Connect Feishu](#connect-feishu), [Connect Telegram](#connect-telegram), [Connect QQ](#connect-qq) or [Connect WeChat](#connect-wechat).
- To learn what arrives where once a bot is connected, see [After you connect](#after-you-connect).
- Before you connect a bot that other people can message, read [Security](#security).

## Before you begin

- **The conversation has started.** Remote control belongs to a conversation, and a conversation exists only after its first message. In a new, unsent chat, the panel shows "Available once the conversation starts".
- **You are the Project owner.** Only the owner can save credentials, scan a QR code, and turn a connection on or off. Other members can open the settings, see the status, and run the tests.
- **PenguinHarness is running.** The connection lives in the PenguinHarness server or desktop app. While it is stopped, the bot does not answer.

## Open remote control

Remote control is available from the conversation's menu in the sidebar and as a side panel next to the chat. The dialog and the panel hold the same settings.

### Open the dialog

1. In the sidebar, right-click the conversation. You can also hover over it and select **More** (the "…" button), press Shift+F10, or press and hold the row on a touch screen.
2. Select **Remote control**. The **Remote control** dialog opens.

In company mode, a desk conversation's menu offers **Remote control** too.

### Open the side panel

Use any of these:

- In the top-right corner of the chat, select **Right sidebar**, then pick **Remote control**.
- In the side panel, select **Add panel** (+), then pick **Remote control**.
- Open the floating **Shortcuts** button and select the paper-plane entry, **Remote control**.

## Remote control settings

The settings run from top to bottom in this order:

| Setting | What it does |
| --- | --- |
| Channel tabs | **Feishu**, **Telegram**, **QQ** and **WeChat**, along the top of the dialog. Each channel keeps its own saved settings for this conversation. |
| **Enable connection** | Turns the connection on or off. Turning it on binds the bot to this conversation; turning it off releases the bot. Saved credentials stay either way. |
| **Connection status** | **Not connected**, **Connecting**, **Connected** or **Connection error**, plus when the last message arrived and the last connection or delivery problem. The status refreshes on its own. |
| **Test connection** | Checks that the saved or typed credentials sign in, and reports the response time. |
| **Send test message** | Sends a short test message to the chat. It works once the bot is connected and has received at least one message. |
| Channel fields | The credentials for the selected channel. See the section for your channel: [Feishu](#connect-feishu), [Telegram](#connect-telegram), [QQ](#connect-qq) or [WeChat](#connect-wechat). |
| **Final reply only** | Off by default. See [Delivery options](#delivery-options). |
| **One message per line** | Off by default. See [Delivery options](#delivery-options). |
| **Render Markdown** | On by default. See [Delivery options](#delivery-options). |
| **Save** | Saves the credentials and the delivery options. Saving does not turn the connection on or off. |

Below the form, three collapsed sections explain the selected channel: **Set up the bot** (the setup steps and an **Open tutorial** link), **What binding does**, and **Troubleshooting**.

When the **Enable connection** switch is unavailable, a line under the test buttons says why: the credentials are not saved yet, the form has unsaved changes, or another channel of this conversation is already enabled.

A saved secret is never shown again. Leave its field empty to keep it. To delete it, turn off the connection, select the clear option under the field, such as **Clear stored App Secret** or **Clear stored Bot Token**, and select **Save**.

## Connect Feishu

**Before you begin**

- A Feishu or Lark account that can create a self-built app in the developer console.

1. In the [Feishu developer console](https://open.feishu.cn/app), create a self-built app.
2. Enable the bot capability for the app.
3. Subscribe to the message-receive event, and set the subscription mode to long connection.
4. In PenguinHarness, open **Remote control** for the conversation and select the **Feishu** tab.
5. From the app's credentials page, copy the App ID and App Secret into **App ID** and **App Secret**.
6. If you use Lark, change **API domain** to `https://open.larksuite.com`. The default, `https://open.feishu.cn`, is for Feishu.
7. Select **Save**.
8. In the developer console, publish an app version and get it approved.
9. Turn on **Enable connection**, and wait for **Connected**.
10. In Feishu, send the bot a message.

The bot works in direct chats and in groups. When a message starts by mentioning the bot, the mention is removed before the text reaches the agent.

To receive images and files, the Feishu app needs the permission to read message resources in addition to receiving messages. If the permission is missing, the bot replies with the permissions to grant and a link to the developer console.

## Connect Telegram

**Before you begin**

- A Telegram account.

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot` to create a bot.
2. Name the bot as prompted, and copy the Bot Token that @BotFather returns.
3. In PenguinHarness, open **Remote control** for the conversation and select the **Telegram** tab.
4. Paste the token into **Bot Token**. A Bot Token looks like `<digits>:<secret>`.
5. Select **Save**.
6. Turn on **Enable connection**, and wait for **Connected**.
7. In Telegram, find the bot and send it a message.

**Test connection** names the bot the token signs in as. If the bot's Group Privacy setting is on, the result also warns that the bot receives no ordinary messages in groups where it is not an administrator. See [Troubleshooting](#troubleshooting).

In a forum group, replies stay in the topic the message came from. Telegram channel posts are not supported; the bot handles groups and direct chats.

A Bot Token can serve only one program at a time. Do not use the same token in another PenguinHarness server or bot script while the connection is on.

## Connect QQ

**Before you begin**

- A bot on the [QQ open platform](https://q.qq.com/qqbot/dashboard/). Register as a developer there to create one.
- In the bot's development settings, the event subscription mode is set to WebSocket, with the callback URL left empty.
- Your own QQ account, or a test group, is on the bot's sandbox allowlist.

You can give PenguinHarness the bot's credentials by scanning a QR code or by entering them by hand.

### Connect with a QR code

1. In PenguinHarness, open **Remote control** for the conversation and select the **QQ** tab.
2. Select **Connect by QR**.
3. Scan the code with QQ on your phone.
4. On the page that opens, pick the bot to authorize, and confirm. PenguinHarness saves the credentials and shows "Saved the credentials for bot {appId} — the connection can be enabled now".
5. Turn on **Enable connection**, and wait for **Connected**.
6. In QQ, find the bot and send it a message.

### Enter the credentials by hand

1. On the QQ open platform, copy the App ID and App Secret from the bot's development settings page.
2. In PenguinHarness, open **Remote control**, select the **QQ** tab, and under **Or enter them by hand**, fill in **App ID** and **App Secret**.
3. Select **Save**.
4. Turn on **Enable connection**, and wait for **Connected**.
5. In QQ, find the bot and send it a message.

> [!WARNING]
> QQ lets a bot reply only to a message you just sent it. The bot cannot start a message on its own.

This rule shapes how QQ behaves:

- A turn you start in the Web App is not sent to QQ.
- A few minutes after your last QQ message, replies can no longer be delivered. Send the bot another message in QQ to continue.
- One QQ message can receive at most 4 replies, or 5 in a group. When a run produces more messages than that, the last reply carries the rest combined.
- With **Final reply only** on, a run that takes longer than about five minutes delivers nothing.
- QQ carries text only. The bot does not read images or files you send, and the agent cannot send files to QQ.

## Connect WeChat

WeChat connects through its official bot channel. There is no console and nothing to register: you scan a QR code, and the credential is saved for you.

1. In PenguinHarness, open **Remote control** for the conversation and select the **WeChat** tab.
2. Select **Connect by scanning** to generate a QR code.
3. Scan the code with WeChat on your phone.
4. If your phone shows a number, type it into **Pairing code** and select **Confirm**.
5. Confirm the authorization on your phone. PenguinHarness saves the credential and shows "Saved the credential for bot {botId} — the connection can be enabled now".
6. Turn on **Enable connection**, and wait for **Connected**.
7. Wait about 15 seconds.
8. Find the bot in WeChat and send it a message. If you get no reply, send the message again.

> [!NOTE]
> Right after the status turns **Connected**, the connection clears messages that were waiting from before. A message that arrives in those first seconds is dropped rather than answered. This happens again each time the connection is turned on or the server restarts.

If a code expires before you scan it, a new one appears automatically. To bind a different WeChat account later, turn off the connection, then select **Scan again**.

WeChat differs from the other channels:

- The bot receives direct chats only. Mentioning it in a group does nothing.
- Text, images and files travel in both directions.
- A voice message arrives as WeChat's own transcription. A recording WeChat could not transcribe cannot be read. A video arrives as a file.

## After you connect

A connected conversation shows a paper-plane icon on its row in the sidebar. Point at the icon to see which channel is enabled, for example "Telegram connection enabled".

### Messages you send to the bot

- A message to the bot starts a Task in the conversation, just like a message typed in the Web App. The agent is not told that the message came from a chat app.
- If the agent is busy, the message waits in the queue and runs next.
- On Feishu, Telegram and WeChat, images and files you send are attached to the message. Each image can be up to 20 MB, and one connection accepts up to 40 MB of images per 10 minutes. A file can be up to 100 MB, and 120 MB per message — these are the bridge's own ceilings on what it downloads for you, not the composer's, which has none; Telegram also caps bot downloads at 20 MB.
- Stickers are not supported, and neither are voice and video messages on Feishu and Telegram. The bot replies that only text, image and file messages are supported.
- On Feishu, Telegram and WeChat, messages sent while the connection is off are not delivered later.

### Replies the bot sends

- Each assistant message is sent to the chat as soon as it is complete, unless **Final reply only** is on. Replies go to the chat that last messaged the bot, so nothing is sent before the bot has received its first message.
- Turns you start in the Web App are sent to the chat too, except on QQ.
- In a group, the first reply of a run replies to the message that started it.
- A long reply is split into several messages of up to 4000 characters.
- When a reply mentions a file that the run created or changed in the Workspace, the file follows the reply into the chat. A run sends at most 5 files, with images up to 10 MB and other files up to 30 MB. A file that could not be sent is not announced in the chat; it is recorded in the Cost Center's error records.

### Approvals

Tool approvals cannot be answered from the chat. When a tool call needs approval, the bot sends "A tool call is waiting for your approval in the PenguinHarness web UI." Approve or deny it in the Web App.

Whether a tool call needs approval depends on the conversation's [approval mode](/tools#approval). New conversations start in **Approve everything**, which asks for nothing, so read [Security](#security) before you bind a bot to one.

There are no chat commands. Text such as `/stop` goes to the agent as an ordinary message.

### Delivery options

| Option | Default | Effect |
| --- | --- | --- |
| **Final reply only** | Off | Sends only the last thing the assistant says in a run, when the run ends. The notes it writes between tool calls stay in the Web App, and the chat stays silent while a long run works. The approval reminder still arrives immediately. |
| **One message per line** | Off | Sends each non-blank line of a reply as its own message, one second apart. A reply becomes at most 20 messages (on QQ, its reply limit); the remaining lines are combined into the last one. |
| **Render Markdown** | On | Shows headings, bold text, lists, code and tables as formatting in the chat app, as far as the app supports them. If the app refuses the formatting, the reply is sent as plain text. |

Change an option, then select **Save**. Options do not apply to the test message or to notices such as the approval reminder.

How each app shows Markdown:

| Channel | What renders |
| --- | --- |
| Feishu | A card with headings, bold, italic, strikethrough, code, code blocks, lists, quotes, rules, links and tables. A table longer than five rows arrives as a code block. |
| Telegram | Bold, italic, strikethrough, links, inline code and code blocks. A heading becomes a bold line, list markers stay as text, and a table arrives as a code block. |
| QQ | Headings, bold, italic, strikethrough, lists, quotes, rules and links. Code blocks arrive as plain lines and tables as their rows. A plain-text retry uses one more of the replies QQ allows. |
| WeChat | Headings, bold, strikethrough, lists, quotes, rules, links, inline code, code blocks and tables. Headings past the fourth level, italics around Chinese text and inline images lose their formatting; images become links. |

## Limits

- **One channel per conversation.** A conversation can keep saved settings for all four channels, but only one of them can be enabled at a time.
- **One conversation per bot.** The same bot can be saved in several conversations, but its connection can be enabled in only one. To move a bot, turn its connection off in the old conversation and turn it on in the new one; you do not need to delete the credentials.
- **QQ replies only.** See [Connect QQ](#connect-qq).
- **WeChat direct chats only.** See [Connect WeChat](#connect-wechat).
- Deleting a conversation deletes its remote control settings.

## Security

> [!WARNING]
> Remote control has no sender allow-list. Anyone who can message the bot controls the conversation: they can start Tasks, and the agent runs tools on their behalf under the conversation's approval mode.

Keep the bot private. Do not add it to groups with people you do not trust, and use an approval mode that asks before risky tool calls.

Credentials are stored on the server and never sent back to the browser in full. QR scanning keeps the secret on the server as well.

## Troubleshooting

**Send test message is unavailable.** The bot must receive a message first, so it knows which chat to send to. Send it a message in the chat app, then try again.

**The status shows Connection error.** Check the credentials. For Feishu, also check **API domain** and that the event subscription uses long connection.

**Only one channel can be enabled per conversation.** Turn off the other channel's connection in this conversation first.

**This bot's connection is enabled on another conversation.** Turn off the connection in that conversation, then enable it here.

**Telegram: the bot ignores messages in a group.** Telegram's Group Privacy is on by default. Under it, a bot that is not a group administrator receives only commands addressed to it and replies to its own messages. Either make the bot an administrator of the group, or turn Group Privacy off with `/setprivacy` in @BotFather and then remove the bot from the group and add it back. A group the bot is already in does not pick up the privacy change until you do.

**Telegram: another program is polling.** A Bot Token serves one program at a time. Close the other PenguinHarness server or script that uses the token, or give this conversation its own bot. A `getUpdates` call you run by hand counts as another program too, so turn off the connection before running one.

**Telegram: the panel says no message has arrived.** That line covers only the current connection. Turning the connection off and on, or saving the credentials, starts a new one. Send a fresh message. If nothing arrives, check that the bot is still in the group and that nothing else is polling the token.

**QQ: replies stop arriving.** The reply window has closed. Send the bot another message in QQ.

**WeChat: the bot does not answer in a group.** The WeChat channel receives direct chats only. Message the bot directly.

**WeChat: the first message gets no reply.** A message sent in the first seconds after the status turns **Connected** is dropped. Wait about 15 seconds, then send the message again.
