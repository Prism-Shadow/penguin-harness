<p align="center">
  <img src="packages/landing/public/penguin-logo.svg" alt="PenguinHarness logo" width="88" />
</p>

<h1 align="center">PenguinHarness</h1>

<p align="center"><b>With LangChain, you build agents by hand — at 1× speed.<br />With PenguinHarness, agents build agents — at 100×.</b></p>

<p align="center">A zero-code Harness CLI and Web UI, connected to 1000+ models.</p>

<p align="center">
  <a href="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/ci.yml"><img src="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/pages.yml"><img src="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/pages.yml/badge.svg" alt="Deploy Site" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-brightgreen" alt="Node >= 24" />
</p>

<p align="center">
  <a href="https://penguin.ooo/"><img src="https://img.shields.io/badge/Website-penguin.ooo-1f6feb?logo=googlechrome&logoColor=white" alt="Website" /></a>
  <a href="https://penguin.ooo/docs/"><img src="https://img.shields.io/badge/Docs-penguin.ooo%2Fdocs-1f6feb?logo=readthedocs&logoColor=white" alt="Docs" /></a>
  <a href="https://penguin.ooo/blog"><img src="https://img.shields.io/badge/Blog-penguin.ooo%2Fblog-1f6feb?logo=rss&logoColor=white" alt="Blog" /></a>
</p>

<p align="center">
  <a href="https://discord.gg/eFHKqqcU3D"><img src="https://img.shields.io/badge/Discord-join%20chat-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://x.com/code_hiyouga"><img src="https://img.shields.io/badge/X-code%5Fhiyouga-000000?logo=x&logoColor=white" alt="X (Twitter)" /></a>
  <a href="https://github.com/Prism-Shadow/penguin-harness-community/blob/main/wechat/group.jpg"><img src="https://img.shields.io/badge/WeChat-user%20group-07C160?logo=wechat&logoColor=white" alt="WeChat" /></a>
</p>

<p align="center">English | <a href="README.zh.md">简体中文</a></p>

## Why PenguinHarness

Three reasons, in deliberate order — from task quality, to how agents get built, to how they keep improving.

### 1. 🏆 Better on complex tasks, at lower cost

A deliberately minimal toolset over clean low-level interfaces: fewer tool calls, fewer tokens — better results at lower cost, deeply tuned for open models like DeepSeek. Same model, same tasks, head-to-head:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/benchmark-dark.svg" />
    <img src="assets/readme/benchmark-light.svg" alt="Benchmark: PenguinHarness matches Claude Code on accuracy at lower cost, and beats OpenAI Codex on both suites" width="920" />
  </picture>
</p>

<sub>Data analysis: 15 tasks, single run, USD pricing. Coding: 40 tasks × 2 runs averaged, official CNY pricing converted at $1 = ¥7. Full breakdown on the <a href="https://penguin.ooo/">website</a>.</sub>

### 2. ⚡ One sentence, and an Agent builds your Agent app

Type one sentence, and an Agent builds the complete Agent application for you — scaffold, code, and run instructions, end to end:

```text
Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG app that answers Claude Code questions as a configuration expert, citing its sources.
```

And this is the finished product — a docs expert with retrieval, cited sources that link to the original files, and example questions built in:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/rag-app-en-dark.webp" />
    <img src="assets/readme/rag-app-en-light.webp" alt="The generated RAG app: a Claude Code docs expert answering with cited, clickable sources and example questions" width="920" />
  </picture>
</p>

**And generating this entire RAG app burned just $0.02 (¥0.2) of tokens — on DeepSeek V4 Pro.**

### 3. 🧬 Self-evolution: it gets stronger with use

With PenguinHarness Skills, an Agent evaluates and optimizes itself: run the benchmark, find the lost points, ship version N+1 — with a snapshot before every round, and every request observable in the Trace view.

<!-- TODO: self-evolution demo video — coming soon. -->

## Supported Models

| Model            | Providers                                                                        |
| ---------------- | -------------------------------------------------------------------------------- |
| DeepSeek V4      | DeepSeek, OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan                 |
| Kimi K3          | Moonshot AI, OpenRouter, Qwen Pay-As-You-Go                                      |
| GLM 5.2          | Z.AI, OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan, Qwen Pay-As-You-Go |
| Hunyuan 3        | OpenRouter                                                                       |
| Qwen 3.8 Max     | Qwen Token Plan (preview)                                                        |
| GPT 5.5          | OpenAI, OpenRouter                                                               |
| Gemini 3.5 Flash | Google Gemini, OpenRouter                                                        |
| Claude Opus 4.8  | Anthropic, OpenRouter                                                            |

Any OpenAI-protocol endpoint is supported: pick a preset above, or point a custom endpoint at any of the 1000+ online and local models.

## Requirements

| Requirement  | Supported                                                                  |
| ------------ | -------------------------------------------------------------------------- |
| OS           | Linux, macOS                                                               |
| Architecture | x64, arm64                                                                 |
| Runtime      | bundled by the one-line installer (npm installs need Node >= 24)           |
| Model        | an API key for at least one model                                          |

## Installation

### 🌐 Web App — for humans

🚀 Install and launch the full experience (multi-session chat, Agent/skill/model management, usage stats, Trace observability, evaluation center):

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # start the service and open http://127.0.0.1:7364 (first login: admin / penguin-2026)
```

📦 Or via npm: `npm install -g @prismshadow/penguin-cli`. Configure models on the in-app Models page, then chat.

### 🤖 CLI & SDK — for agents

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
- [ ] Desktop app
- [ ] Windows support
- [ ] Agent company and templates
- [ ] Company-level self evolving
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

Built with ❤️ by [Yaowei Zheng](https://github.com/hiyouga) (author of [LlamaFactory](https://github.com/hiyouga/LlamaFactory)), the [PrismShadow AI Team](https://github.com/Prism-Shadow), and [Fable 5](https://www.anthropic.com/news/claude-fable-5-mythos-5).
