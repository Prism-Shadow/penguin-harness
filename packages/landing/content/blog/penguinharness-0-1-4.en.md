---
title: "PenguinHarness 0.1.4: Windows support, goal mode, and the agents panel"
date: 2026-07-27
category: news
excerpt: 0.1.4 brings PenguinHarness to Windows with a one-line installer, adds goal mode to keep a Session working until an objective is done, and moves subagents into an agents panel with a live call graph.
---

PenguinHarness 0.1.4 is out, and it now installs and runs on Windows. A new **goal mode** keeps a Session working until an objective is actually done, not merely replied to. A new **agents panel** turns subagent runs from nested cards into a live call graph you can watch and steer.

## Windows support

Install PenguinHarness on Windows with one line in PowerShell:

```powershell
irm https://penguin.ooo/install.ps1 | iex
```

The script downloads `penguin-win32-x64.zip`, which bundles the official Windows Node runtime, so you do not need to install anything first. It verifies the archive's SHA256 checksum, installs through a staged swap that never touches your `data\` directory, and adds `penguin` to your user PATH. Existing PATH entries that use variables, such as `%USERPROFILE%`, stay intact. The script at the stable URL is a small forwarder that downloads the full installer before running it, so a truncated download cannot leave a half-finished install. If you prefer npm, `npm install -g @prismshadow/penguin-cli` works anywhere Node ≥ 24 runs.

The harder part was the agent itself. Every `exec_command` used to fail on Windows with `spawn bash ENOENT`, because command sessions always started bash. Command sessions now choose their shell per platform. On Windows they try Git-Bash first, since it works best with Skills written for POSIX shells, then `pwsh`, then `powershell`. Set `PENGUIN_SHELL` to override the choice. A `bash` that resolves into the Windows system directory is skipped, because that is the WSL launcher, which sees a different filesystem.

The model learns which shell it has from a `Shell:` line in the Session environment. When it gets PowerShell, it writes PowerShell syntax instead of bash.

CI keeps all of this working. A `ci-windows` job now runs the full build, typecheck and tests, plus a PowerShell syntax check, beside the required Ubuntu job. Getting it green surfaced and fixed real Windows bugs, including a symlink guard on Workspace uploads that POSIX's `O_NOFOLLOW` had been providing silently and that Windows lacked.

A few limits remain, and the docs state them:

- The package is x64 only for now. ARM64 machines run it through emulation.
- Ctrl-C in `input_command` kills the whole command tree instead of interrupting only the foreground command.
- To upgrade, re-run the installer. In-place `penguin update` still refuses to run on Windows.

## Goal mode

A normal Task ends when the model stops calling tools and replies. That suits a request, but not an objective: "make the check suite green" is not done just because the model went quiet. Goal mode changes the contract. You state an objective, and the system keeps running Tasks on the same Session, re-injecting the objective every round, until the goal reaches a final state.

The model has to claim completion through a protocol; silence does not count. Each goal run creates a `GOAL.yaml` file next to the Session's `PLAN.md`. The model may change only one field, `status`, and only to `complete` or `blocked`. The rules injected every round tell the model to:

- Check a completion claim against evidence, such as files, command output and test results, before writing it.
- Never shrink the objective to an easier subset.
- Claim `blocked` only after the same blocker has held for three consecutive rounds, so a temporary obstacle does not end the goal.

You can set an optional Token budget, such as `500k` or `2m`, which is checked between rounds. When the budget runs out, the model gets one wrap-up round to summarize its progress and the remaining work. The goal then ends as budget-limited instead of pretending to succeed.

In the Web App, the composer's new **+** menu adds a goal chip with an inline budget field; `/goal` in the slash menu does the same. Each round appears as a regular user message with a "Goal · round N" notice below it, and a live banner above the composer tracks the objective, the round count and tokens against the budget. The screenshot below shows round 3 of a real loop, in the middle of verification.

<img class="dark:hidden" src="/blog-assets/goal-mode-en-light.webp" alt="Goal mode mid-loop: round 3 of a check-suite objective, with the goal banner above the composer tracking the objective, the round count and tokens against the budget" width="1920" height="1350" />
<img class="hidden dark:block" src="/blog-assets/goal-mode-en-dark.webp" alt="Goal mode mid-loop in dark theme: round 3 of a check-suite objective, with the goal banner above the composer tracking the objective, the round count and tokens against the budget" width="1920" height="1350" />

The CLI offers the same loop: `/goal[:<budget>] <objective>` in chat, and `--goal` on `penguin run`, where only a completed goal exits 0. That makes an objective something you can put in a script. The SDK keeps its single entry point: `session.run(input, { goal: { budget } })`.

## The agents panel

`run_subagent` used to inline each child's entire conversation into the parent's message flow. Cards nested inside cards became unreadable after the second child. 0.1.4 moves child conversations into a dedicated agents panel that docks on the right, just like the Workspace files panel: toggle it from the toolbar and drag to resize it. On phones it opens as a bottom sheet.

In the message flow, each child leaves a single row: its avatar, its agent name, a spinner while it runs, and an amber dot whenever an approval is pending anywhere in its subtree. A nested approval stays easy to find even with the panel closed.

<img class="dark:hidden" src="/blog-assets/agents-panel-en-light.webp" alt="The agents panel: a call graph with the main session as root and two named subagents with live elapsed times, above the selected child's streaming conversation" width="1920" height="1350" />
<img class="hidden dark:block" src="/blog-assets/agents-panel-en-dark.webp" alt="The agents panel in dark theme: a call graph with the main session as root and two named subagents with live elapsed times, above the selected child's streaming conversation" width="1920" height="1350" />

The top of the panel is the **Call graph**, with one node per participating agent: avatar, name, run-state dot and elapsed time. The time ticks while a child runs and freezes at its final duration once it is done, so a reloaded page shows the same durations as a live one. The main Session is the root, and edges show which agent spawned which.

Click a node to switch the conversation below to that child. It renders the same way as the main stream: the child's own user prompt is there, tool cards stream live, and approval buttons work from inside the panel.

The panel's visibility follows the Task. Each new Task starts with the panel closed, and the panel opens once, automatically, when the Task first spawns a subagent. If you open or close it yourself, your choice holds for the rest of the Task. The graph follows the latest Task by default; click a child's row from an earlier turn to pin that turn's spawn tree instead.

## Also in 0.1.4

- An in-progress reply now survives a page refresh. After a reload, the part that has already streamed is back at once and keeps growing.
- The cost and elapsed-time chips in the chat header tick live while a Task runs, as the Token count already did.
- Trace files can be exported and imported, so a trajectory can move between deployments.
- The app knows its own version. A **Check for updates** row in the user menu shows the running version, and admins can update in place with one click.

The full list is in the [v0.1.4 release notes](https://github.com/Prism-Shadow/penguin-harness/releases/tag/v0.1.4).

## Get it

```bash
# Linux / macOS
curl -fsSL https://penguin.ooo/install.sh | sh
```

```powershell
# Windows
irm https://penguin.ooo/install.ps1 | iex
```

You can also install with `npm install -g @prismshadow/penguin-cli` on Node ≥ 24. On npm, 0.1.4 is the version to install: 0.1.3 has the same features but never reached npm.

Then run `penguin web`, add a model key on the **Models** page, and state an objective.
