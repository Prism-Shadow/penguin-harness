---
title: "Connect your agent to Feishu, QQ, Telegram or WeChat, and use it from anywhere"
date: 2026-09-16
category: practice
excerpt: Bind a PenguinHarness conversation to a chat bot and talk to your agent from your phone. This tutorial starts with WeChat, the quickest channel to set up; the same dialog covers Feishu, Telegram and QQ.
---

An agent you can only reach from a browser tab is an agent you stop using the moment you leave your desk. PenguinHarness can bind any conversation to a chat bot on Feishu, Telegram, QQ or WeChat. Once the binding is on, a message you send the bot from your phone arrives in that conversation as if you had typed it in the Web App, and the agent's replies come back to the same chat.

In this tutorial you will create a conversation, open **Remote control** from its right-click menu, and bind it to WeChat. WeChat is the quickest channel to set up: you scan a QR code, and there is no developer console, no app review and no credential to copy. By the end, you will send the agent a Task from your phone and read its reply in the chat.

The last part of the tutorial covers what changes for Feishu, Telegram and QQ, and the limits and safety rules that apply once a conversation is bound.

## Prerequisites

- PenguinHarness running on a computer that stays on while you are away: the desktop app, or the server started with `penguin web`. Bot messages are delivered only while it runs.
- At least one model configured on the **Models** page, so the agent can answer.
- The owner role in the Project. Only the Project owner can save a bot's credentials and turn a connection on; other members can see a binding and run its tests.
- For WeChat: WeChat on your phone.
- For the other channels: a Feishu account that can create a self-built app, a Telegram account, or a QQ account registered as a developer on the QQ open platform.

## How binding works

A binding connects one conversation to one chat bot. You manage it in the conversation's **Remote control** dialog, which has one tab per channel, and each channel keeps its own credentials.

## Step 1: Create a conversation

A binding attaches to an existing conversation, so start one first. Messages you send the bot later arrive in this conversation.

1. In the sidebar, select **New chat**.
2. Pick the agent and the model you want to reach from your phone, and a Workspace that holds the files the agent should work with.
3. Send a first message, for example "Check logs/app.log and tell me whether anything needs attention."

The conversation exists once the first message is sent. Until then the draft has nothing to bind, and the **Remote control** panel shows **Available once the conversation starts**.

The message box's toolbar also shows the approval mode. New conversations start in **Approve everything**, so tool calls run without asking. Keep that in mind before you bind a bot: anyone who can message the bot can then have the agent run its tools. Limits and safety, near the end of this tutorial, covers the options.

![A new conversation draft: the message box, with the agent and Workspace pickers below it and the model in its toolbar](/blog-assets/remote-control-new-chat-en.png)

## Step 2: Open Remote control

The binding is set up in the **Remote control** dialog, which opens from the conversation's right-click menu.

1. In the sidebar, right-click the conversation's title.
2. In the menu, select **Remote control**.

The same menu opens with a long press on a touch screen, with **Shift+F10** on the keyboard, or from the **More** button that appears when you hover over the row.

![The conversation's right-click menu, with Remote control between Rename chat and Archive](/blog-assets/remote-control-menu-en.png)

You can also keep Remote control open beside the conversation: select the **Right sidebar** button at the top right of the conversation, and open the **Remote control** panel there. It holds the same settings as the dialog.

## Step 3: Bind WeChat

The WeChat bot's credential comes from scanning a QR code with your phone, so there is nothing to register or fill in.

1. At the top of the dialog, select the **WeChat** tab.
2. Select **Connect by scanning**. A QR code appears with **Waiting for the code to be scanned in WeChat…**.
3. Scan the code with WeChat on your phone.
4. If your phone shows a number, type it into **Pairing code** and select **Confirm**.
5. Confirm the authorization on your phone. The dialog shows **Saved the credential for bot … — the connection can be enabled now**.
6. Turn on **Enable connection**. **Connection status** changes to **Connected**, and the conversation's row in the sidebar shows a paper-plane mark.
7. Wait about 15 seconds, then find the bot in WeChat and send it a message.

![Scanning the WeChat authorization code in the Remote control dialog](/blog-assets/remote-control-wechat-qr-en.png)

> **Wait before the first WeChat message.** When the connection opens, PenguinHarness first clears out anything the WeChat channel queued earlier, and a message that arrives during those first seconds is cleared with it. Wait until the status has shown **Connected** for about 15 seconds before you send your first message. If no reply comes, send the message again. After that, messages arrive as soon as they are sent.

When the message arrives, the dialog shows **Last message received** with the time, and the agent starts working.

![A connected WeChat binding: the connection is enabled and a message has been received](/blog-assets/remote-control-wechat-connected-en.png)

To check the delivery path without waiting for a real reply, select **Send test message**. It becomes available after the bot has received one message, because until then it does not know which chat to write to.

## Step 4: Talk to the agent from your phone

Now drive the conversation from your phone. A message you send the bot starts a Task in the conversation exactly as if you had typed it in the Web App. If the agent is busy, the message waits in the queue and runs next. What the agent writes comes back to the chat, and the whole exchange stays in the conversation, so you can pick it up in the browser later.

![The conversation in the Web App, with a request sent from WeChat and the agent's reply](/blog-assets/remote-control-chat-en.png)

A few behaviors are worth knowing:

- **Text, images and files** travel in both directions on WeChat. A voice message arrives as WeChat's own transcription. When the agent writes a file during a run and names it in its reply, the file follows the text into the chat; a run sends at most five files, images up to 10 MB and other files up to 30 MB. A file the channel cannot take is not announced in the chat — it is recorded in the Cost Center's error records.
- **Approvals stay in the Web App.** In the default **Approve everything** mode, tool calls run without asking. If you switch the conversation to a mode that asks, such as **Approve read-only**, the chat receives a reminder whenever a tool call is waiting, and the run waits until you approve it in the browser.
- **Runs started in the Web App are mirrored** to the chat too, after the bot has received its first message.

Three switches shape the replies:

| Switch | What it does |
| --- | --- |
| **Final reply only** | Sends only the last message of a run instead of every message. |
| **One message per line** | Splits a reply into one chat message per line. |
| **Render Markdown** | On by default, turns the reply's Markdown into formatting the app can display. |

## Step 5: Bind Feishu, Telegram or QQ

Every channel follows the same pattern: select its tab, provide its credentials, select **Save**, then turn on **Enable connection**. The switch stays unavailable until the credentials are saved. Each channel's **Set up the bot** section in the dialog lists the steps, with a link to the platform.

### Feishu (and Lark)

1. In the Feishu developer console, create a self-built app.
2. Enable the bot capability for the app.
3. Subscribe to the message-receive event, with the subscription mode set to long connection.
4. Copy **App ID** and **App Secret** from the app's credentials page into the dialog. For Lark, set **API domain** to `https://open.larksuite.com`; for Feishu, keep `https://open.feishu.cn`.
5. Publish an app version and get it approved.
6. Select **Save**, turn on **Enable connection**, then message the bot once in Feishu.

Feishu works in groups too: mention the bot, and the mention is removed before the message reaches the agent. To let the agent read images and files you send, the app also needs the permission to read message resources.

![The Feishu channel in the Remote control dialog](/blog-assets/remote-control-feishu-en.png)

### Telegram

1. In Telegram, open @BotFather and send `/newbot`.
2. Name the bot as prompted, then copy the **Bot Token** @BotFather returns into the dialog.
3. Select **Save** and turn on **Enable connection**.
4. Find the bot in Telegram and send it a message.

In groups, Telegram's Group Privacy setting is on by default: a bot that is not a group administrator receives only commands addressed to it. **Test connection** tells you when Group Privacy is on for your bot.

### QQ

1. On the QQ open platform, register as a developer and create a bot.
2. In the dialog, select **Connect by QR** and scan the code with QQ on your phone. On the page that opens, pick the bot and confirm; the dialog saves its credentials for you. To enter them by hand instead, copy **App ID** and **App Secret** from the bot's development settings, set the bot's event subscription mode to WebSocket (no callback URL is needed), and select **Save**.
3. On the QQ open platform, add your own QQ account or a test group to the bot's sandbox allowlist.
4. Turn on **Enable connection**, then message the bot in QQ.

QQ lets a bot reply only to a message you have just sent. Runs you start in the Web App are therefore not mirrored to QQ, and a few minutes after your last QQ message, replies can no longer be delivered. Send the bot another message to continue. One QQ message can receive at most four replies (five in a group); when a run produces more, the last reply carries the rest.

QQ also carries text only: the bot does not read images or files you send, and the agent cannot send files to QQ.

## Limits and safety

A bound conversation comes with a few fixed rules.

| Rule | What it means |
| --- | --- |
| One channel per conversation | Only one channel's connection can be enabled on a conversation at a time. |
| One conversation per bot | A bot can be enabled on one conversation at a time. To move it, turn the connection off where it is on, then enable it on the other conversation. The credentials stay saved. |
| The bot speaks second | A bot cannot start a chat. It needs one message from you before it knows where to send replies. |
| WeChat: direct chats only | Mentioning the WeChat bot in a group does nothing. Message it directly. |
| The server must run | Messages sent while PenguinHarness is stopped are not delivered later. |

> **Anyone who can message the bot can drive the conversation.** A binding has no allowlist of senders, and a new conversation approves every tool call. Keep the bot private, do not add it to groups you do not control, and give a conversation reachable from a chat app only the Workspace and tools you are comfortable exposing. If the bot could reach other people, switch the conversation to **Approve read-only**, so that anything beyond reading waits for your approval in the browser.

## Troubleshooting

- **Enable connection is unavailable.** Save the credentials first, and turn off any other channel enabled on this conversation. Only the Project owner can turn a connection on.
- **Connection status shows an error.** Check the credentials. For Feishu, also check the **API domain** and that the event subscription uses long connection.
- **Send test message is unavailable.** Send the bot one message first.
- **The first WeChat message got no reply.** Send it again once the status has shown **Connected** for about 15 seconds. The note in Step 3 explains why.
- **The bot ignores a Telegram group.** Make the bot a group administrator, or turn off Group Privacy with @BotFather and add the bot to the group again.
- **Replies stop arriving in QQ.** More than a few minutes have passed since your last QQ message. Send the bot a new message.

## Wrap-up

You bound a conversation to WeChat, sent it a Task from your phone, and saw the reply come back to the chat and into the Web App. Feishu, Telegram and QQ use the same dialog, each with its own credentials. For every field and switch in the dialog, see the [Remote control documentation](https://penguin.ooo/docs/remote-control).
