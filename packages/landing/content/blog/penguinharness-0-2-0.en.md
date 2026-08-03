---
title: "PenguinHarness 0.2.0: navigable chats, recoverable output, installs from anywhere"
date: 2026-08-03
category: news
excerpt: 0.2.0 makes long agent runs livable. The chat gains shell-style input recall, stacked sticky run headers and a minimap tick rail; tool output that blows past the cap is saved and recoverable instead of gone; steering survives reloads and carries files; the session list scales to many agents; each Release ships one sealed installer bundle per platform, now mirrored to Alibaba Cloud OSS; and the model catalog moves to the current qianwenai lineup. Here is what shipped.
---

PenguinHarness 0.2.0 is out. The theme is long-running work: conversations you can move through instead of scrolling past, tool output that cannot be lost to a cap, and a distribution pipe that reaches machines GitHub does not. Feature by feature:

## Navigate long conversations

Three navigation aids land on the chat page together.

**↑ recalls your previous inputs, shell-style.** With an empty composer, ↑ steps back through everything you typed into this session, newest first; ↓ walks forward again and restores whatever draft you had. Editing a recalled entry hands the arrows back to the caret, multi-line entries move the caret line by line first, and IME candidate navigation is untouched.

**Sticky run headers, stacked by level.** The "Reasoning & Tools" header pins to the top of the stream while its run is in view, and the thinking or tool row you are actually scrolled inside pins right below it — the bar above the content is always the section being read, never a skipped level. A twenty-screen tool dump collapses from anywhere inside it, per section or as a whole, and collapsing lands you back on the section instead of somewhere unrelated.

**A minimap for the whole conversation.** A zero-width tick rail overlays the left gutter — one tick per exchange, the reading position emphasized. Hovering a tick pops a preview card (your question in bold over a truncated reply), clicking jumps straight to the turn. On phones, or whenever a docked panel eats the gutter, the same index moves to a top-right toolbar dropdown, so navigation stays reachable in every layout.

## Tool output that survives truncation

Output exceeding the per-call cap in an Agent Session is written to the Session scratchpad, and the recovery path is appended to the same truncated result the model and both frontends see. The model reads the rest by path when it matters — no new tool, no protocol change, and the visible cap stays. Alongside it, every model-visible path core composes now shares one forward-slash spelling on Windows.

## Steering and a session list built for scale

Mid-run steering messages now survive reloads with their content visible and land exactly once — and file attachments steer just like images do. Tool-card subtitles render once fully formed instead of jittering while arguments stream. The sidebar session list is served straight from the database by default (CLI sessions become an opt-in toggle), and both the per-group lists and the groups themselves page, so a Project with many agents and workspaces stays fast and scannable.

## One installer artifact per platform — mirrored

Each Release attaches exactly one file per target: a flat installer bundle sealing the native installer, the program payload and its checksum. The same file serves online and offline installs, with checksums verified unconditionally at both layers. New in the pipe: the exact same bytes are mirrored to Alibaba Cloud OSS, and the installers prefer the mirror with an automatic same-version GitHub fallback (`PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`). In-place upgrades also survive filesystems that pin in-use directories, and the Windows payload drops its policy-blocked `penguin.ps1` launcher — typing `penguin` is unaffected.

## A current model catalog

The qianwenai groups move to the current lineup — qwen3.8-max and deepseek-v4-flash-0731 in, the retired previews out — OpenRouter gains deepseek/deepseek-v4-flash-0731 and openai/gpt-5.6-luna, every gateway row's prices are re-read from the models API, and new Projects default to deepseek-v4-flash. Existing Projects keep their stored models and default.

## And the rest

`read_file` / `edit_file` diagnose a missing path (deepest existing ancestor, first missing segment, nearest names) instead of a bare "File not found". The manual update check reports every outcome — busy, up to date, update found, failed. Evaluation Center case details separate the target agent's task materials from reviewer-facing rubrics. File summaries move to the Task boundary, one card per completed Task. The full list, entry by entry: [changelog/0.2.0](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.0).

## Install or upgrade

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell): `irm https://penguin.ooo/install.ps1 | iex` — or `npm install -g @prismshadow/penguin-cli` with Node >= 24. Upgrading is re-running the installer, or `penguin update` from 0.1.3+.
