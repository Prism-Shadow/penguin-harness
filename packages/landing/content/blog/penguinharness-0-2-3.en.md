---
title: "PenguinHarness 0.2.3: live Session status and a readable compaction record"
date: 2026-08-19
category: news
excerpt: "Every sidebar row now shows live Session status, context compaction is a record you can open and read, any completed reply can fork into a new Session, and a queued message can be pulled back and edited."
---

PenguinHarness 0.2.3 is out. This release makes an agent's work easier to follow and removes several points of friction. Session status in the sidebar is now live, context compaction is a record you can open and read, any completed reply can fork into a new Session, and a queued message can be pulled back into the composer and edited before it goes out.

## The sidebar shows which Session is running

Until now, only the conversation you had open showed its real status. Every other row showed whatever the last list fetch returned. A Session you left while it was running kept showing as running, and a Session started in the background never changed at all.

Session status is now live in every row. A turning hourglass means the Session is running. A green dot means it finished and you have not looked at it yet. No marker means you have.

![Sidebar with three Session rows: a green unread dot, no marker, and a running hourglass](/blog-assets/penguinharness-0-2-3-sidebar-status-en.png)

First runs are covered too. When a Session's first Task finishes, its row settles on the green dot like any other, instead of going blank.

## Compaction is a record you can open

Context compaction used to be a blank stretch in the conversation. You could tell it had happened, but not what it kept. It is now a row you can open, collapsed by default, the same way thinking is collapsed inside a Task group.

![A compaction row in the conversation, collapsed by default](/blog-assets/penguinharness-0-2-3-compaction-collapsed-en.png)

The summary streams in as it is written, so you can expand the row and read exactly what the agent decided to keep.

![The expanded compaction summary, with task, confirmed findings, next steps and caveats](/blog-assets/penguinharness-0-2-3-compaction-expanded-en.png)

The timing changed as well. When compaction triggers after the model has produced a tool call, it now waits for the tools to finish and compacts with their results in hand, instead of folding an unfinished exchange into the request. If you quit the client mid-compaction, that round is marked failed, and its half-written content is discarded on load. A round that clears the context instead of summarizing it is no longer called compaction. It is labeled Clear.

One recurring complaint is fixed. After a client restart, a conversation full of history used to refuse to compact, reporting that there was nothing to compact. It now compacts as expected. The server's three reasons for refusing a compaction also have their own error codes now, so the Chinese UI shows a Chinese message instead of English text.

## Any reply can fork into a new Session

When a conversation went sideways, you used to have two options: live with it or start over. Every completed reply now carries a fork control, next to copy.

![A completed reply's action row, with the fork control next to copy](/blog-assets/penguinharness-0-2-3-session-fork-actions-en.png)

Forking asks first. When you confirm, the conversation up to that reply is copied into a new Session, and the original is left alone.

![The confirmation dialog shown before forking](/blog-assets/penguinharness-0-2-3-session-fork-confirm-en.png)

## A queued message can be pulled back

Steering you typed mid-run and follow-ups waiting their turn used to be out of reach the moment you sent them. Each now carries a curved-back arrow. Click it, and the message returns to the composer, where you can edit it and send it again.

A message is never both delivered and recalled. If the engine takes it in the same instant you click, you get a clear message saying so, rather than a silent disappearance or a double send.

## Thinking levels

AgentHub 0.4.4 added a `max` tier, so the ladder is now low, medium, high, xhigh, max. In the Chinese UI, the button shows only the Chinese name, and the menu adds the English value.

![The thinking-level dropdown](/blog-assets/penguinharness-0-2-3-thinking-level-menu-en.png)

Changing the level mid-conversation now asks first. Some providers implement thinking levels by putting a different prompt prefix at the very front of the request. Switching part-way through then invalidates the prefix cache for the whole history, and the next request bills all of it again at the uncached rate. The dialog offers three ways out: compact first and then switch, switch anyway, or cancel.

![The confirmation shown when switching the thinking level mid-conversation](/blog-assets/penguinharness-0-2-3-thinking-level-switch-guard-en.png)

The level you pick is stored on the Session, so it survives a refresh and shows up in a second tab.

## Adding a custom model no longer means guessing the protocol

Since 0.4.2, AgentHub has carried three generic protocol clients: OpenAI Responses, Anthropic Messages and OpenAI Chat Completions. You no longer have to work out which one your endpoint speaks. The detect action probes them in that order, takes the first that answers in its expected shape, and fills in the protocol picker for you. With no key typed, it falls back to the environment variable. When nothing matches, you get one short message asking you to check the API key and the base URL.

![The detect action at the top right of the base URL field, and the in-field picker listing the three protocols with the path each appends](/blog-assets/penguinharness-0-2-3-model-add-protocol-en.png)

Vision support can be detected the same way. The probe sends a 1×1 image. A normal answer turns the setting on, an explicit image-related rejection turns it off, and anything else leaves your setting alone. The probe costs a real API call, so it runs only when you ask for it, never on save.

Models that can serve fast mode gained a toggle, off by default. Models that cannot do not show the toggle at all, so you cannot turn on a switch that would fail every turn. Turning it on tells you plainly that fast mode bills at premium rates.

## Also in this release

- The hover actions on a sidebar row are back to archive and delete. The full set is in the right-click menu.
- You can drag attachments and images onto the chat area to upload them. A file attachment can now be 100MB instead of 10MB, and an admin can change that limit from the user menu.
- Inline images have their own 20MB cap. Their bytes enter the conversation and the Trace, which is re-read whole on every history page. A file attachment is opened by path, so its size never reaches the context.
- The CLI gained `/thinking` and `--thinking`. Long tool output now collapses to its first and last lines, and `/verbose` shows all of it. The model and the Trace always receive the full text either way.
- The model catalog was refreshed with Gemini 3.7, GLM-5.3 and the GPT-5.6 family, plus their OpenRouter counterparts. The nine `openai/*` rows are pinned to the Responses protocol. DeepSeek pricing follows the current official rates, and the delisted `ling-3.0-flash` row is gone.
- A long generation through a gateway such as one-api or OpenRouter no longer reconnects until it gives up. These gateways inject heartbeat events into a streaming response. The events used to kill the stream, the harness retried, and the retry hit the next heartbeat. Every streaming client in AgentHub 0.4.3 and later skips them.

## Install and upgrade

Desktop builds for every platform are on the site. Windows builds are signed as of this release, and macOS builds have been signed and notarized since 0.2.2.

On Linux and macOS, install from the command line:

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

On Windows, use PowerShell:

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

The full record of what changed is in [changelog/0.2.3/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.3).
