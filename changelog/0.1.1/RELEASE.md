PenguinHarness 0.1.1 — Gemini 3.6 support, a self-upgrading CLI, and the skills that let an agent serve and fine-tune its own models.

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

**Gemini 3.6.** `gemini-3.6-flash` and `gemini-3.5-flash-lite` are in the model catalog, on both the Google endpoint and OpenRouter, with the full 1,048,576-token context and vision. The rest of the catalog was rebuilt against AgentHub 0.4.1's supported-model registry and grew from 59 to 70 entries — Claude 5 on Anthropic, Kimi K3 on Moonshot, and more on OpenRouter and SiliconFlow.

**Serve and tune your own models, by asking.** Three new skills — vLLM, Ollama and LlamaFactory — teach an agent to stand up and fine-tune the models it runs on: describe what you want in plain language and it serves the model, scores itself, trains on what it got wrong, redeploys and measures again. With a local engine the data never leaves the machine.

**`penguin update`.** Upgrades an existing install through the mechanism it was installed with — the tarball installer or a global npm/pnpm/yarn/bun package — after showing exactly what it will do. `--check` reports without changing anything, and your data root is never touched.

**A sidebar that scales.** Conversations group by Workspace (or by Agent), groups can be pinned, sessions created by subagents and scheduled tasks file into their own folders, and long lists load a page at a time. Collapsed, the sidebar is now an eight-entry navigation rail with bilingual tooltips.

## Notable in this release

- **Subagents follow the parent session.** A spawned subagent inherits the parent's model and thinking level instead of falling back to the Project default, and a resumed session restores the level its Trace recorded.
- **Empty tool lists stay off the wire.** Strict OpenAI-compatible servers such as vLLM reject `tools: []`; tool-less requests (the connectivity probe, title generation, the vision describer) now omit the field entirely.
- **Two new prompt guardrails.** The agent no longer kills processes on the harness's own service ports — it picks a free port instead — and on an API key error it retries once, then stops and asks you to update the key outside the chat.
- **Per-model max output tokens.** A 32k-context model no longer 400s because the agent-level output cap does not fit its window.
- **Thinking level moved into the conversation**, next to the model picker, and writes through to the Agent's settings.

## Requirements

Linux or macOS (x64 / arm64). The installer bundles its own Node runtime; installing from npm needs Node >= 24. All data stays under `~/.penguin/data`.

Full detail: [changelog/0.1.1/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.1.1)
