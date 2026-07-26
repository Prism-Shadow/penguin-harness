PenguinHarness 0.1.2 — file tools, mid-run steering, model switching mid-conversation, and free models to try it all on.

## Install

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Linux and macOS, x64 and arm64, with a bundled Node runtime. Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/penguin-cli
```

## Highlights

**File tools.** `read_file`, `edit_file` and `write_file` join the builtin set: line-numbered reads with an offset window, exact string replacement, and whole-file writes that land atomically. Edits report back as a git-style diff, so what changed is visible without a second look, and an approval prompt shows the actual payload rather than just the path. The shell stays the general fallback for everything else.

**Talk to a running agent.** While a task runs you can keep typing: a message is delivered to the model between turns, alongside the tool results, so the agent takes it in without losing the thread. Prefer to wait? Switch the send mode to Queue and it goes out as an ordinary follow-up the moment the task ends. In the CLI, typing while a task runs steers the same way.

**Switch models mid-conversation.** `/model` opens a new session for the same agent on the model you pick, in the same Workspace, with the source conversation referenced in its first message — the new model reads the earlier trace when it needs the history. The thinking level became a per-request choice: pick one inside a session and it rides on every following task without touching the agent's settings.

**Free models.** Three zero-cost OpenRouter rows ship in the preset catalog — Ling 3.0 Flash, Laguna M.1 and the Free Models Router — marked with a Free badge in the Models page and the chat picker. Claude Opus 5 is there too, on OpenRouter, for when free isn't enough. There's [a post](https://penguin.ooo/blog/free-models-in-penguin-harness) on what they're good for and where the limits are.

**Workspace previews that actually render.** HTML opened from the Files panel now loads from the same isolated preview origin as the new-tab view, so relative images, stylesheets and scripts resolve — a multi-file page the agent wrote looks like the page it wrote.

## Notable in this release

- **Model-written call descriptions.** Command and subagent tools take a one-sentence description of each call, shown while it runs. It is required while the per-tool `call_description` switch is on, so the CLI and Web UI can settle a call's display form from the schema instead of guessing mid-stream.
- **Paired square-bracket markers.** Every system-synthesized block (`[turn_aborted]`, `[context_summary]`, `[use_skills]`, …) moved off angle brackets onto one paired form, with all producers and parsers consolidated into a single core module. Existing Traces and configs are still read in the old form.
- **Restore default configuration.** An existing agent keeps its stored `system_config.yaml` verbatim — including its old prompt and frozen tool list — so a new Overview-tab action resets it to the current defaults, preserving only the name and description.
- **The default prompt stops naming the project dir.** It exposes the same path as the **App Data Dir**, described as PenguinHarness's data root rather than the task's working folder, which models were mistaking it for.
- **A dev data root.** Running the server or CLI from source defaults to `~/.penguin/dev-data`, so hacking on the repo no longer shares agents and sessions with your installed penguin.

## Requirements

Linux or macOS (x64 / arm64). The installer bundles its own Node runtime; installing from npm needs Node >= 24. All data stays under `~/.penguin/data`.

Full detail: [changelog/0.1.2/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.1.2)
