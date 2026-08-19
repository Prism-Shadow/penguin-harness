---
title: "PenguinHarness 0.2.3: a better experience, and an agent you can watch work"
date: 2026-08-19
category: news
excerpt: This release does two things — it makes what the agent is doing visible, and it files down the parts that were awkward to use. The sidebar now shows which conversation is running, context compaction went from a silent gap to a record you can open and read, any completed reply can fork into a new Session, and a queued message can be pulled back into the composer and edited before it goes out.
---

PenguinHarness 0.2.3 is out. It does two things. It makes what the agent is doing visible, and it files down the parts that were awkward to use.

## The sidebar shows which conversation is running

Until now exactly one row in the sidebar was telling the truth, and that was the conversation you had open. Every other row showed whatever the last list fetch returned. Leave a running conversation and it kept claiming to run; start one in the background and its row never changed at all.

Session status now rides the user-level event stream, so every row is live. A turning hourglass means running. A green dot means it finished and you have not looked at it since. Nothing at all means you have.

![Three sidebar rows showing an unread green dot, no marker, and a running hourglass](/blog-assets/penguinharness-0-2-3-sidebar-status-en.png)

There was a trap hiding under that. Whether a Session has ever run is a field on the server's list row, and the event only updated the status, not that field. So a Session running its very first task went blank the moment the hourglass stopped. The field now travels with the status, and a first run settles onto the dot like any other.

## Compaction is no longer a gap

Context compaction used to be a blank stretch in the conversation. You knew it had happened. Now it is a row you can open, collapsed by default, the same way thinking is collapsed inside a task group.

![A settled compaction row, collapsed](/blog-assets/penguinharness-0-2-3-compaction-collapsed-en.png)

The summary streams in as it is written, so you can expand it and read exactly what the agent decided to keep.

![The expanded compaction summary, with task, confirmed findings, next steps and caveats](/blog-assets/penguinharness-0-2-3-compaction-expanded-en.png)

The timing changed too. When compaction triggers after the model has produced a tool call, it now waits for the tools to finish and compacts with their results in hand, instead of folding an unfinished exchange into the request. Quit the client mid-compaction and that round is marked failed, with its half-written content discarded on load. A round that clears the context rather than summarizing it no longer calls itself compaction; it says Clear.

One recurring complaint is fixed as well. After restarting the client, a conversation full of history would still refuse to compact, reporting that there was nothing to compact. The engine object is built lazily, and while resumption did replay the turn count into the initial state, that value only takes effect in the engine's constructor, which had not run yet. The server's three different 409 reasons also became three distinct error codes, so a Chinese UI now shows a Chinese message instead of falling back to the English prose.

## Any reply can fork into a new Session

When a conversation goes sideways you used to have two options, live with it or start over. Every completed reply now carries a fork control, sitting next to copy.

![The reply action row, with fork beside copy](/blog-assets/penguinharness-0-2-3-session-fork-actions-en.png)

It asks first. On confirm it copies the conversation up to that reply into a new Session and leaves the original alone.

![The confirmation dialog shown before forking](/blog-assets/penguinharness-0-2-3-session-fork-confirm-en.png)

## A queued message can be pulled back

Steering typed mid-run, and follow-ups waiting their turn, used to be gone the moment you sent them. Each now carries a curved-back arrow. Click it and the message returns to the composer, where you can edit it and send it again.

Recall and the engine's own dequeue are mutually exclusive, so a message is never both delivered and withdrawn. If the engine takes it in the same instant you click, you get a clear message saying so rather than a silent disappearance or a double send.

## Thinking levels

AgentHub 0.4.4 added a `max` tier, so the ladder is now low, medium, high, xhigh, max.

![The thinking-level dropdown](/blog-assets/penguinharness-0-2-3-thinking-level-menu-en.png)

Changing the level mid-conversation now asks first. Some providers implement thinking levels by injecting a different prompt prefix at the very front of the request, so switching part-way through invalidates the prefix cache over the whole history and the next request re-bills all of it at the uncached rate. The dialog offers three ways out: compact first and then switch, switch anyway, or cancel.

![The confirmation shown when switching thinking level mid-conversation](/blog-assets/penguinharness-0-2-3-thinking-level-switch-guard-en.png)

The level you pick is stored on the Session, so it survives a refresh and shows up in a second tab.

## Adding a custom model no longer means guessing the protocol

Since 0.4.2 AgentHub has carried three generic protocol clients — OpenAI Responses, Anthropic Messages, and OpenAI Chat Completions. You no longer have to work out which one your endpoint speaks. The detect action probes them in that order and takes the first that answers in its shape, then fills the protocol picker in for you. With no key typed it falls back to the environment variable, and when nothing matches you get one short message telling you to check the API key and the base URL.

![The detect action at the top right of the base URL field, and the in-field picker listing the three protocols with the path each appends](/blog-assets/penguinharness-0-2-3-model-add-protocol-en.png)

Vision support can be detected the same way. It sends a 1×1 image; a normal answer turns the setting on, an explicit image-related rejection turns it off, and anything else leaves your setting alone. That probe costs a real API call, so it only runs when you ask for it and never on save.

Models that can serve fast mode gained a toggle, default off. Models that cannot do not show the toggle at all, so you cannot arm a switch that would fail every turn. Turning it on says plainly that fast mode bills at premium rates.

## Also in this release

The sidebar row's hover actions went back to archive and delete, with the full set moved to the right-click menu. Attachments and images can be dragged onto the chat area to upload, and a file attachment can now be 100MB rather than 10MB, with an admin able to change that from the user menu. Inline images keep a separate 20MB cap, because their bytes enter the conversation and the Trace, which is re-read whole on every history page; a file attachment is opened by path, so its size never reaches the context. The CLI gained `/thinking` and `--thinking`, and long tool output now collapses to its first and last lines with `/verbose` to see all of it — the model and the Trace always received the full text either way.

The model catalog was refreshed: Gemini 3.7, GLM-5.3 and the GPT-5.6 family, plus their OpenRouter counterparts, with the nine `openai/*` rows pinned to the Responses protocol. DeepSeek pricing follows the current official rates, and the delisted `ling-3.0-flash` row is gone.

One fix underneath is worth calling out. Gateways such as one-api and OpenRouter inject heartbeat events into a streaming response during a long generation. Those events used to reach the unknown-event guard and kill the stream, the harness classified that as a retryable failure, and the retry hit the next heartbeat — a long generation through such a gateway reconnected until it gave up. Every streaming client in AgentHub 0.4.3 and later skips them.

## From running to legible

These changes land on the same point. While an agent works you should be able to see what it is doing, what it chose to remember, and what the next step will cost. Session status, the compaction record, and the warning before a level switch all move something out of the logs and onto the screen.

## Install and upgrade

Desktop builds are on the site for every platform. Windows builds are signed as of this release; macOS has been signed and notarized since 0.2.2.

Linux and macOS install from the command line.

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows uses PowerShell.

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

The full record of what changed is in [changelog/0.2.3/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.3).
