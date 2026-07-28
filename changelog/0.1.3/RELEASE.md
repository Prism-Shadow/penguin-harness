PenguinHarness 0.1.3 — Windows support, goal mode that loops until an objective is done, a subagents panel with a live call graph, and LLM errors that recover instead of aborting.

## Install

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

Linux, macOS and now Windows, with a bundled Node runtime. Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/penguin-cli
```

## Highlights

**Windows support.** The first release that runs on Windows: command sessions pick a real shell (Git-Bash first, then pwsh, then powershell, with a `PENGUIN_SHELL` override) and announce the choice to the model, so it writes commands in the syntax it actually has. `install.ps1` mirrors the POSIX installer — version and directory knobs, SHA256 verification, a staged swap that never touches your data — and the release ships `penguin-win32-x64.zip` with a bundled Node runtime, all verified by a new windows-latest CI job running the full test suite.

**Goal mode.** State an objective, optionally with a token budget, and the system keeps driving Tasks on the same Session until the goal is done — the objective is re-injected every round, the model reports completion through a `GOAL.yaml` protocol rather than by going quiet, and a budget that runs out triggers one wrap-up round before the goal ends. Runaway safeguards bound the loop. Available as the Web composer's "+" menu, `/goal` and `run --goal` in the CLI, and `session.run(input, { goal })` in the SDK.

**A panel for subagents.** Child conversations move out of the message stream into a docked agents panel, topped by a live call graph of the current Task — one node per agent with its run state and elapsed time, edges for who spawned whom. Click a node to watch that agent's conversation stream live, approvals included; the stream keeps a compact one-line chip per child, with an amber dot whenever an approval is pending anywhere in the subtree.

**LLM errors that recover.** A dropped connection or a provider quota rejection no longer aborts the turn: requests reconnect on an exponential ladder (up to 8 attempts, ~62s of patience) with a live countdown and Retry now / Give up controls, and the real cause — not a generic "timeout" — reaches the Cost center. Authentication failures lock the composer recoverably: fix the key on the Models page and open Sessions unlock instantly.

## Notable in this release

- **Replies survive refresh.** An in-progress reply now lives in a server-kept tail, so refreshing or reconnecting mid-Task shows the stream exactly where it was.
- **Live header statistics.** Tokens, cost and elapsed time tick live in the session header while a Task runs.
- **Trace import and export.** Trace files move in and out of the Traces page, so a session can be inspected — or reported — from another machine.
- **Version and updates, in the app.** The sidebar user menu shows the running version, checks for new releases (offline-tolerant, `PENGUIN_UPDATE_CHECK=off` to disable), links the release notes, and lets admins run the self-update.
- **One-line rows on mobile.** Running-state session rows stay one line on phones, with icon-only colored approval buttons.
- **Compaction hardening.** An empty compaction summary is a failure, not a result: the request keeps its tools byte-identical (protecting the prompt-cache prefix), rejects empty or tool-calling responses with paired repairs and retries, and resume replays the original context instead of a fabricated empty summary — and a committed mid-task attempt absorbs the turn's pending input, so nothing is ever re-sent.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64; the one-liner installs via PowerShell). The installer bundles its own Node runtime; installing from npm needs Node >= 24. All data stays under `~/.penguin/data`.

Full detail: [changelog/0.1.3/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.1.3)
