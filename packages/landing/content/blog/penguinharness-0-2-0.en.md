---
title: "PenguinHarness 0.2.0: chat navigation, recoverable tool output, mirrored installers"
date: 2026-08-03
category: news
excerpt: 0.2.0 makes long agent runs easier to work with: input recall, sticky run headers and a minimap in the chat, recoverable tool output, and steering that survives reloads. Installers now prefer an Alibaba Cloud OSS mirror.
---

PenguinHarness 0.2.0 is out, and this release is about long-running work. Long conversations get three navigation aids, tool output that exceeds the cap can be recovered, and steering messages survive a reload. Each Release now ships one installer bundle per platform, mirrored to Alibaba Cloud OSS, and the model catalog moves to the current lineup.

## Navigate long conversations

The chat page gains three ways to move through a long Session.

### Recall earlier inputs

When the composer is empty, press ↑ to step back through what you typed in this Session, newest first, as in a shell. Press ↓ to step forward again; past the newest entry, your draft comes back. Editing a recalled entry hands the arrow keys back to the caret. In a multi-line entry, the arrows move the caret line by line first, and IME candidate navigation is unaffected.

### Sticky run headers

While a group of reasoning and tool calls is in view, its header stays pinned to the top of the stream. The thinking or tool row you are scrolled into pins directly below it, so the bar above the text is always the section you are reading. You can collapse a long tool output from anywhere inside it, one section or the whole group, and the view lands back on that section.

### A minimap for the conversation

A tick rail sits over the chat's left margin without taking any width: one tick per exchange, with your reading position highlighted. Hover over a tick to see a preview card with your question in bold above a shortened reply, and click to jump to that turn. On phones, or when a docked panel covers the margin, the same index moves to a dropdown in the top-right toolbar.

## Recover truncated tool output

In a Session run by an agent, output that exceeds the per-call cap is now saved to the Session scratchpad. The truncated result that the model, the Web App and the CLI see ends with the path to that file, and the model reads the rest from there when it needs to. No new tool or protocol change is involved, and the visible cap stays the same.

On Windows, every path the harness shows the model now uses forward slashes.

## Steering that survives reloads, and a faster session list

A steering message you send during a run now survives a page reload with its content still visible, and reaches the agent exactly once. File attachments can steer a run, just as images can.

The sidebar session list now comes straight from the database, and both the sessions in each group and the groups themselves are shown a page at a time. A Project with many agents and Workspaces stays fast and easy to scan. CLI sessions no longer appear in the list by default; the **Show CLI sessions** switch in the user menu brings them back.

## One installer per platform, mirrored to Alibaba Cloud OSS

Each Release now attaches exactly one file per platform: an installer bundle that contains the native installer, the program payload and its checksum. The same file serves online and offline installs, and checksums are always verified.

The installers now prefer a mirror on Alibaba Cloud OSS that carries the exact same bytes, and fall back to the same version on GitHub automatically. Set `PENGUIN_DOWNLOAD_SOURCE=auto|oss|github` to choose the source.

Two install fixes ship with it:

- In-place upgrades no longer fail on filesystems that lock directories in use, such as overlayfs in Docker.
- The Windows package drops its `penguin.ps1` launcher, which PowerShell's execution policy blocked. Typing `penguin` still works.

## A current model catalog

The qianwenai groups move to the current lineup: `qwen3.8-max` and `deepseek-v4-flash-0731` are added, and retired entries such as `qwen3.8-max-preview` are removed. OpenRouter adds `deepseek/deepseek-v4-flash-0731` and `openai/gpt-5.6-luna`, and every OpenRouter price has been re-read from its models API.

New Projects default to `deepseek-v4-flash`. Existing Projects keep the models and the default they already have.

## Other changes

- `read_file` and `edit_file` diagnose a missing path instead of returning a bare "File not found". They report the deepest existing ancestor, the first missing segment and the nearest matching names.
- The manual update check reports every outcome: checking, up to date, update found, or failed.
- Tool-card subtitles appear once they are complete, instead of jittering while the arguments stream in.
- In the Evaluation Center, case details show the task materials the target agent receives separately from the scoring rubrics, which stay hidden from that agent.
- The file summary in the main conversation now waits for the Task to finish: one card per completed Task.

The full list, entry by entry, is in [changelog/0.2.0](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.0).

## Install or upgrade

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

On Windows, run `irm https://penguin.ooo/install.ps1 | iex` in PowerShell. With Node >= 24, you can also install from npm: `npm install -g @prismshadow/penguin-cli`.

To upgrade, re-run the installer. On Linux and macOS, `penguin update` works too, from 0.1.3 or later.
