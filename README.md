<p align="center">
  <img src="packages/landing/public/penguin-logo.svg" alt="PenguinHarness logo" width="88" />
</p>

<h1 align="center">PenguinHarness</h1>

<p align="center"><b>With LangChain, you build agents by hand — at 1× speed.<br />With PenguinHarness, agents build agents — at 100×.</b></p>

<p align="center">A zero-code CLI and Web UI, connected to 1000+ models.</p>

<p align="center">
  <a href="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/ci.yml"><img src="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/pages.yml"><img src="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/pages.yml/badge.svg" alt="Deploy Site" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-brightgreen" alt="Node >= 24" />
</p>

<p align="center">
  English | <a href="README.zh.md">简体中文</a> ·
  <a href="https://penguin.ooo/">Website</a> ·
  <a href="https://penguin.ooo/docs/">Docs</a> ·
  <a href="https://penguin.ooo/blog">Blog</a>
</p>

<p align="center">
  Join the community:
  <a href="https://discord.gg/eFHKqqcU3D">Discord</a> ·
  <a href="https://x.com/code_hiyouga">X (Twitter)</a> ·
  <a href="https://github.com/Prism-Shadow/penguin-harness-community/blob/main/wechat/group.jpg">WeChat</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/landing/src/assets/shots/chat-en-dark.webp" />
    <img src="packages/landing/src/assets/shots/chat-en-light.webp" alt="PenguinHarness Web App — multi-session chat with live streaming tool calls" width="920" />
  </picture>
</p>

---

## Simple and Efficient

A deliberately minimal toolset over clean low-level interfaces: fewer tool calls, fewer tokens — **better token usage, better results**. Same model, same tasks, head-to-head:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/benchmark-dark.svg" />
    <img src="assets/readme/benchmark-light.svg" alt="Benchmark: PenguinHarness matches Claude Code on accuracy at lower cost, and beats OpenAI Codex on both suites" width="920" />
  </picture>
</p>

<sub>Data analysis: 15 tasks, single run, USD pricing. Coding: 40 tasks × 2 runs averaged, official CNY pricing converted at $1 = ¥7. Full breakdown on the <a href="https://penguin.ooo/">website</a>.</sub>

## Build an Agent in One Sentence

Type one sentence, and an Agent builds the complete Agent application for you — scaffold, code, and run instructions, end to end:

```text
Build a RAG app that answers questions over the Markdown files in docs/ with citations.
```

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/rag-demo-dark.webp" />
    <img src="assets/readme/rag-demo-light.webp" alt="One sentence in, a working RAG app out: scaffold, retrieval entry with citations, and run instructions" width="920" />
  </picture>
</p>

## Self-Evolution

With PenguinHarness Skills, an Agent evaluates and optimizes itself: run the benchmark, find the lost points, ship version N+1 — with a snapshot before every round, and every request observable in the Trace view.

<!-- TODO: self-evolution demo video — coming soon. -->

## Changelog · Blog · Docs

- **Changelog** — per-release update records in [`changelog/`](changelog/README.md).
- **Blog** — release notes and deep dives at [penguin.ooo/blog](https://penguin.ooo/blog).
- **Docs** — usage and design: [Introduction](https://penguin.ooo/docs/) · [Quickstart](https://penguin.ooo/docs/quickstart) · [Architecture](https://penguin.ooo/docs/architecture) · [The OmniMessage Protocol](https://penguin.ooo/docs/omni-message) · [Core Interfaces](https://penguin.ooo/docs/interfaces) · [The Agent Loop](https://penguin.ooo/docs/agent-loop) · [CLI Reference](https://penguin.ooo/docs/cli) · [Server API](https://penguin.ooo/docs/server-api) · [Configuration](https://penguin.ooo/docs/configuration). Every doc page has a "Copy Markdown" button, so you can paste it straight into a model context.

## Supported Models

| Model            | Providers                                                                     |
| ---------------- | ------------------------------------------------------------------------------ |
| DeepSeek V4      | DeepSeek, OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan               |
| Kimi K3          | Moonshot AI, OpenRouter, Qwen Pay-As-You-Go                                    |
| GLM 5.2          | Z.AI, OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan, Qwen Pay-As-You-Go |
| Hunyuan 3        | OpenRouter                                                                     |
| Qwen 3.8 Max     | Qwen Token Plan (preview)                                                      |
| GPT 5.5          | OpenAI, OpenRouter                                                             |
| Gemini 3.5 Flash | Google Gemini                                                                  |
| Claude Opus 4.8  | Anthropic, OpenRouter                                                          |

A model is just a `(provider, model_id)` pair plus an API key: direct vendor groups (DeepSeek, Anthropic, OpenAI, Google Gemini, Z.AI, Moonshot) route automatically, five OpenAI-compatible gateways (OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan, Qwen Pay-As-You-Go) come with preset endpoints, and 1000+ more online and local models are reachable through those gateways or any custom endpoint.

## Requirements and Installation

Linux / macOS, x64 / arm64. The one-line installer bundles its own Node runtime; installing via npm requires Node >= 24. Bring an API key for at least one model.

### Web App — for humans

Install and launch the full experience (multi-session chat, Agent/skill/model management, usage stats, Trace observability, evaluation center):

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web        # start the service and open http://127.0.0.1:7364 (first login: admin / admin123)
```

Or via npm: `npm install -g @prismshadow/penguin-cli`. Configure models on the in-app Models page, then chat.

### CLI & SDK — for agents

The same engine, scriptable — made to be driven by agents (and agents building agents):

```bash
penguin config model add --model-id deepseek-v4-pro --api-key sk-... --set-default
penguin run -m "Create hello.txt containing Hello, Penguin"   # one-shot task
penguin chat       # interactive REPL (/compact, /exit, Ctrl-C to interrupt)
penguin server     # headless service (same API the Web App uses)
```

```ts
import { createAgent, isCompleteModelMessage, userText } from "@prismshadow/penguin-core";

const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Create hello.txt containing hi")], {
  approve: async () => "allow", // per-tool-call approval
})) {
  if (isCompleteModelMessage(output) && output.payload.type === "text") {
    console.log(output.payload.text);
  }
}
```

## Roadmap

- [ ] Public release of the benchmark suite
- More to come…

## Development

```bash
pnpm install && pnpm build   # build first: core's exports point at dist/
pnpm dev                     # backend + web app together (prefixed logs, deps built once)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workspace guide: dev commands, quality gates, repo layout, and the changelog rule.

## Citation

If you use PenguinHarness in your research, please cite:

```bibtex
@software{penguinharness2026,
  author  = {{PrismShadow Team}},
  title   = {PenguinHarness: Efficient Self-Improving Harness for Everyone},
  year    = {2026},
  url     = {https://github.com/Prism-Shadow/penguin-harness},
  license = {Apache-2.0}
}
```

## License

[Apache-2.0](LICENSE) © 2026 Prism Shadow

Built with ❤️ by [Yaowei Zheng](https://github.com/hiyouga) (author of LlamaFactory), the PrismShadow AI Team, and Fable 5.
