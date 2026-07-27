# Unreleased

Changes since v0.1.2. The version number is assigned at release, when this folder is renamed.

- [2026-07-27] Core and Web App: transport drops (`UND_ERR_SOCKET`-class) and provider quota errors (`insufficient_user_quota`) now reconnect on an exponential ladder (up to 8 attempts ≈62s) with a live countdown plus Retry-now/Give-up controls, real failure details reach the Cost center, and authentication failures lock the composer recoverably — updating the key on the Models page invalidates cached runtimes and unlocks open Sessions instantly. ([details](2026-07-27-llm-request-errors.md))

- [2026-07-26] Web App: subagent conversations move into a docked agents panel with a live call graph of the latest Task (compact chips remain in the stream), an in-progress reply now survives refresh/reconnect via a server-kept live tail, the header statistics (Tokens/cost/elapsed) tick live while a Task runs, running-state rows stay one line on mobile with icon-only colored approval buttons, Trace files can be exported and imported from the Traces page, and the sidebar user menu shows the running version with an update reminder and an admin-run self-update. ([details](2026-07-26-web-app.md))

- [2026-07-26] Windows: the command session picks a real shell (Git-Bash → pwsh → powershell, `PENGUIN_SHELL` override, the choice announced to the model), a win32 symlink-upload sandbox gap is closed, and the release ships `install.ps1` (`irm https://penguin.ooo/install.ps1 | iex`) plus a `penguin-win32-x64.zip` package with a bundled Node runtime, verified by a new windows-latest CI job running the full test suite. ([details](2026-07-26-windows-support.md))

- [2026-07-26] Core: resuming a session now ignores a legacy Trace's recorded `thinking_level`; an empty compaction summary is no longer a success — compaction keeps its tools byte-identical (protecting the prompt-cache prefix), rejects empty or tool-calling responses with paired repair outputs and up to 5 retries, and resume replays the original context instead of a fabricated empty summary; and a committed mid-task compaction attempt now absorbs the turn's pending input, so retries and follow-ups never re-send what AgentHub already holds. ([details](2026-07-26-core.md))

- [2026-07-27] Tooling: Windows CI hardening — retrying test cleanups, evidence-sized deadlines, and same-hour fixes for two cross-PR combination breaks. ([details](2026-07-27-tooling.md))

- [2026-07-27] Backward compatibility: the batch's compat decisions in one place — legacy `thinking_level` ignored on resume (owner-directed, nothing retained), the win32 assembly-time `Shell:` line fallback for pre-`{{SHELL}}` Agent configs (with its removal condition), and the additive-only protocol fields. ([details](2026-07-27-backward-compatibility.md))

- [2026-07-26] Goal mode: state an objective with an optional token budget and the system loops Tasks on one Session via `session.run(input, { goal })` — a `[goal]` round protocol embedding GOAL.yaml, budget wrap-up round, runaway safeguards (a cut-off round is terminal; 100-round backstop) — surfaced as the CLI's `/goal` and `run --goal`, a `goal` field on the tasks API, and the Web composer's new "+" menu. ([details](2026-07-26-goal-mode.md))
