---
title: "PenguinHarness 0.1.4: Windows support, goal mode, and the agents panel"
date: 2026-07-27
category: news
excerpt: 0.1.4 has one theme — the harness meets you where you work and keeps working when you step away. It now installs and runs on Windows with its own one-liner and CI; a new goal mode keeps driving a Session until the objective is actually done rather than merely replied to; and a new agents panel turns subagent fan-outs into a live call graph. Here is what shipped.
---

PenguinHarness 0.1.4 is out, and the release has one theme: the harness meets you where you work and keeps working when you step away. It now installs and runs on Windows; a new **goal mode** keeps driving a Session until an objective is actually done rather than merely replied to; and a new **agents panel** turns subagent fan-outs from nested cards into a live call graph you can watch and steer. Feature by feature:

## Windows is now a first-class install

One line in PowerShell:

```powershell
irm https://penguin.ooo/install.ps1 | iex
```

That fetches `penguin-win32-x64.zip` — the official Windows Node runtime bundled, so nothing needs to be preinstalled — verifies its SHA256, unpacks with a staged swap that never touches your `data\` directory, and puts `penguin` on your user PATH (reading and writing the registry value with its kind preserved, so an existing `%USERPROFILE%`-style entry survives the edit). The stable URL is a forwarder that downloads fully before executing, so a truncated stream cannot half-install. Prefer npm? `npm install -g @prismshadow/penguin-cli` works anywhere Node ≥ 24 does.

The interesting part was not packaging but the agent itself. Every `exec_command` used to die on Windows with `spawn bash ENOENT`, because the command session hardcoded bash. Command sessions now resolve their shell per platform: Git-Bash first when present (best compatibility with the POSIX-oriented skill ecosystem — and a `bash` that resolves into the Windows system directory is rejected, because that is the WSL launcher, a different filesystem view entirely), then `pwsh`, then `powershell`, with `PENGUIN_SHELL` as the override. The chosen shell is announced to the model through a `Shell:` line in the session environment, so it writes PowerShell syntax when PowerShell is what it has, instead of emitting bash into the void.

All of it is kept true by CI: a `ci-windows` job — full build, typecheck and tests, plus a PowerShell parse gate — now runs beside the required Ubuntu job, and getting it green surfaced and fixed real Windows findings, including a workspace-upload symlink guard that POSIX's `O_NOFOLLOW` had been providing silently. The remaining limits are documented rather than pretended away: the package is x64-only for now (ARM64 runs via emulation), Ctrl-C in `input_command` hard-kills the whole command tree instead of interrupting the foreground command, and upgrading means re-running the installer — in-place `penguin update` still refuses on Windows.

## Goal mode: loop until it is done

A normal Task ends when the model stops calling tools and replies. That is right for a request and wrong for an objective — "make the check suite green" is not done just because the model went quiet. Goal mode inverts the contract: you state an objective, and the system keeps driving Tasks on the same Session, re-injecting the objective every round, until the goal reaches a terminal state.

<img class="dark:hidden" src="/blog-assets/goal-mode-en-light.webp" alt="Goal mode mid-loop: round 3 of a check-suite objective, with the goal banner above the composer tracking the objective, the round count and tokens against the budget" width="1920" height="1350" />
<img class="hidden dark:block" src="/blog-assets/goal-mode-en-dark.webp" alt="Goal mode mid-loop in dark theme: round 3 of a check-suite objective, with the goal banner above the composer tracking the objective, the round count and tokens against the budget" width="1920" height="1350" />

Completion is claimed through a protocol, not inferred from silence. Each goal run creates a `GOAL.yaml` next to the session's `PLAN.md`; the model may change exactly one field, `status`, and only to `complete` or `blocked`. The rules injected with every round tell it to audit a completion claim against evidence — files, command output, test results — before writing it, never to shrink the objective to an easier subset, and to claim `blocked` only after the same blocker has held for three consecutive rounds, so a transient obstacle does not end the goal. An optional token budget (`500k`, `2m`) is checked between rounds; when it runs out, the model gets one wrap-up round to summarize progress and remaining work, and the goal ends as budget-limited instead of pretending success.

In the Web App, the composer's new "+" menu engages a goal chip with an inline budget field (`/goal` in the slash menu does the same). Every round renders as a regular user bubble with a "Goal · round N" notice beneath it, and a live banner above the composer tracks the objective, the round count and tokens against budget — the screenshot above is round 3 of a real loop, mid-verification. The CLI has the same power as `/goal[:<budget>] <objective>` in chat and `--goal` on `penguin run`, where only a completed goal exits 0 — an objective you can put in a script. The SDK keeps its one entry point: `session.run(input, { goal: { budget } })`.

## The agents panel: see the whole tree

`run_subagent` used to inline the child's entire conversation into the parent's message flow — cards nested inside cards, unreadable past the second child. 0.1.4 moves child conversations into a dedicated **agents panel** that docks on the right exactly like the Workspace files panel: toolbar toggle, drag to resize, a bottom sheet on phones. In the message flow, each child leaves a single bar row — avatar, resolved agent name, a spinner while it runs, and an amber dot whenever an approval is pending anywhere in its subtree, so a nested approval stays discoverable even with the panel closed.

<img class="dark:hidden" src="/blog-assets/agents-panel-en-light.webp" alt="The agents panel: a call graph with the main session as root and two named subagents with live elapsed times, above the selected child's streaming conversation" width="1920" height="1350" />
<img class="hidden dark:block" src="/blog-assets/agents-panel-en-dark.webp" alt="The agents panel in dark theme: a call graph with the main session as root and two named subagents with live elapsed times, above the selected child's streaming conversation" width="1920" height="1350" />

The top of the panel is a **call graph**: one node per participating agent — avatar, name, run-state dot and elapsed time, ticking while the child runs and frozen at the settled span once it is done, so a reloaded page shows the same durations as a live one. The main session is the root, and edges show who spawned whom. Click a node and the conversation below switches to that child, rendered by the same machinery as the main stream: its own user prompt is there, tool cards stream live, and approval buttons work from inside the panel. Visibility is task-scoped — every new Task starts with the panel closed, it auto-opens once when the task first spawns a subagent, and your manual open or close wins for the rest of the task. The graph follows the latest Task by default; click a bar row from an older turn and it pins that turn's historical spawn tree instead.

## Also in 0.1.4

The same release makes an in-progress reply survive a page refresh — the server keeps a live tail per running session, so after a reload the already-streamed prefix is back immediately and keeps growing. The chat header's cost and elapsed chips now tick live while a Task runs, joining the token count that already did. Trace files gained export and import, so a trajectory can move across deployments. And the app finally knows its own version: a "Check for updates" row with the running version inline, plus a one-click in-place update for admins. The full list is in the [v0.1.4 release notes](https://github.com/Prism-Shadow/penguin-harness/releases/tag/v0.1.4).

## Get it

```bash
# Linux / macOS
curl -fsSL https://penguin.ooo/install.sh | sh
```

```powershell
# Windows
irm https://penguin.ooo/install.ps1 | iex
```

Or `npm install -g @prismshadow/penguin-cli` with Node ≥ 24 — 0.1.4 is the version to install, since 0.1.3 carries the same feature set but never reached npm. Then run `penguin web`, add a model key on the Models page — and state an objective.
