<p align="center">
  <img src="packages/landing/public/penguin-logo.svg" alt="PenguinHarness logo" width="88" />
</p>

<h1 align="center">PenguinHarness</h1>

<p align="center"><strong>Open-source, local-first multi-agent app development platform</strong><br />Fully automate <strong>building</strong> · <strong>optimizing</strong> · <strong>deploying</strong> AI applications</p>

<p align="center">
  <a href="https://penguin.ooo/download">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/readme/download-en-dark.svg" />
      <img src="assets/readme/download-en-light.svg" alt="Download App" height="44" />
    </picture>
  </a>
</p>

<p align="center">1000+ Models · Multi-Platform · Apache 2.0 · Agent Self-Evolution</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@prismshadow/penguin-core"><img src="https://img.shields.io/npm/v/@prismshadow/penguin-core" alt="npm version" /></a>
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

<p align="center">
  <a href="https://www.producthunt.com/products/penguinharness?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-penguinharness" target="_blank" rel="noopener noreferrer"><img alt="PenguinHarness - Let Agents Autonomously Build Better Agents for $0.02 | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1202577&amp;theme=light&amp;t=1784804711946" /></a>
</p>

<p align="center">English | <a href="README.zh.md">简体中文</a></p>

## Why PenguinHarness

> With LangChain, you build agents by hand — at 1× speed.<br />With PenguinHarness, agents build agents — at 100×.

PenguinHarness runs on your computer or server and automates the agent app lifecycle from creation and evaluation to optimization and deployment. Three reasons define the platform:

### 1. 🏆 Outstanding results at tens of times less cost

A deliberately minimal toolset over clean low-level interfaces: fewer tool calls, fewer tokens — deeply tuned for open models like DeepSeek. Each harness on the model it is normally paired with, same tasks, head-to-head:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/benchmark-dark.svg" />
    <img src="assets/readme/benchmark-light.svg" alt="Benchmark: PenguinHarness leads the data-analysis suite and ties OpenAI Codex on coding, at a small fraction of both rivals' cost" width="920" />
  </picture>
</p>

**Best accuracy on data analysis — at 1/70 of Claude Code's cost.**

### 2. ⚡ One sentence generates a runnable agent app

Describe what you need in one sentence. PenguinHarness builds the complete agent application — scaffold, code, and run instructions, end to end:

```text
Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG app that answers Claude Code questions as a configuration expert, citing its sources.
```

And this is the finished product — a docs expert with retrieval, cited sources that link to the original files, and example questions built in:

https://github.com/user-attachments/assets/9b7033e8-f08a-4c3f-bd33-547896664e6e

**And generating this entire RAG app burned just $0.02 (¥0.2) of tokens — on DeepSeek V4 Pro.**

### 3. 🧬 Native agent self-evolution engine

With PenguinHarness Skills, an agent evaluates and optimizes itself: run the benchmark, find the lost points, ship version N+1 — with a snapshot before every round and every request observable in the Trace view.

https://github.com/user-attachments/assets/922d13a6-5ffc-4685-9a39-352f02f9afc0

## Built-in Skills

Four Skill groups ship in the box ([docs](https://penguin.ooo/docs/skills)); agents can also write and optimize their own:

| Group                | Skills                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Office Productivity  | `data-analysis`, `firecrawl`, `bento-slides`, `humanizer`                                                                   |
| Software Development | `web-design`, `software-engineering`, `remote-claude-code`                                                                  |
| AI App Development   | `penguin-sdk`, `penguin-cli`, `penguin-orchestration`, `agenthub-models`, `vllm`, `ollama`, `llamafactory`, `skill-porting` |
| Agent Tuning         | `agent-initialization`, `benchmark-design`, `agent-evaluation`, `agent-optimization`                                        |

## Supported Models

| Model            | Providers                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| DeepSeek V4      | DeepSeek, OpenRouter, Fireworks AI, SiliconFlow, TokenDance, Qwen Token Plan, Qwen Pay-As-You-Go |
| Kimi K3          | Moonshot AI, OpenRouter, Fireworks AI, TokenDance, Qwen Pay-As-You-Go                            |
| GLM 5.3          | Z.AI, OpenRouter, TokenDance                                                                     |
| Hunyuan 3        | OpenRouter                                                                                       |
| Qwen 3.8 Max     | Qwen Token Plan, Qwen Pay-As-You-Go, OpenRouter, TokenDance                                      |
| GPT 5.6          | OpenAI, OpenRouter                                                                               |
| Gemini 3.7 Flash | Google Gemini, OpenRouter                                                                        |
| Claude 5         | Anthropic, OpenRouter                                                                            |
| Inkling          | OpenRouter, Fireworks AI                                                                         |

Each family's latest generation only — the app's **Models** page lists every built-in preset, and any OpenAI-protocol endpoint works too: pick a preset, or point a custom endpoint at any of the 1000+ online and local models.

## Requirements

| Requirement  | Supported                                                                  |
| ------------ | -------------------------------------------------------------------------- |
| OS           | Linux, macOS, Windows 10+                                                  |
| Architecture | x64, arm64                                                                 |
| Runtime      | bundled by the one-line installer (npm installs need Node >= 24)           |
| Model        | an API key for at least one model                                          |

## Installation

Start with the desktop app, or install the command line on a workstation or server. Both use the same `~/.penguin/data` root and can be mixed freely:

- **🖥️ Desktop app** — a double-click install: it embeds the server and opens already signed in, no terminal involved.
- **⌨️ CLI** — a one-line installer (or npm / offline package) puts the `penguin` command on the machine; `penguin web` then serves the full Web experience in your browser at `http://127.0.0.1:7364` (multi-session chat, agent / skill / model management, usage stats, Trace observability, evaluation center). The online installers bundle their own Node runtime — unpack and run; upgrades and reinstalls never touch your data.

> [!NOTE]
> On a CLI install, the server prints a first-login link as a framed notice on every start until a password is set — open it to claim the built-in `admin` account and choose one. Models are configured on the in-app **Models** page.

### 🖥️ Desktop app

The full Web experience as a standalone application: it embeds the server and opens already signed in — no terminal, no login page, no initial password to copy. It works on the same `~/.penguin/data` root as a CLI install, so the two can be used interchangeably (a data root only ever runs one server; if a CLI-started instance is already up, the app attaches to it).

Download the desktop app from the [download page](https://penguin.ooo/download). The page serves the OSS-accelerated mirror when it is reachable, and every installer is also attached to each [GitHub Release](https://github.com/Prism-Shadow/penguin-harness/releases).

| Platform    | Installers                  |
| ----------- | --------------------------- |
| macOS 11+   | dmg (Apple Silicon / Intel) |
| Windows 10+ | installer (.exe, x64)       |
| Linux (x64) | AppImage / deb              |

The macOS builds are Developer ID signed and notarized, and the Windows installers are Authenticode signed, so neither platform needs a first-launch unblock. Linux is the one exception:

<details>
<summary><b>🐧 Linux: double-clicking the AppImage does nothing</b></summary>

Browsers download AppImages without the execute permission. Grant it once and the app starts normally from then on (the deb package installs through the package manager and is not affected):

```bash
chmod +x penguin-desktop-linux-x86_64.AppImage
```

</details>

### 🐧🍎 Linux / macOS (online install)

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # start the service and open http://127.0.0.1:7364
```

### 🪟 Windows (online install, PowerShell)

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web        # start the service and open http://127.0.0.1:7364
```

### 📦 npm (any platform, Node >= 24)

```bash
npm install -g @prismshadow/penguin-cli
penguin web        # start the service and open http://127.0.0.1:7364
```

<details>
<summary><b>📴 Offline install (air-gapped machines)</b></summary>

Every <a href="https://github.com/Prism-Shadow/penguin-harness/releases">GitHub Release</a> attaches exactly one package per target — Linux and macOS in x64 / arm64, Windows in x64, plus a runtime-less universal package — and the same file serves online and offline installation. Each package seals the program payload, its SHA256 checksum and the platform's installer: download the one file on a networked machine, copy it to the target, extract once and run the bundled installer — no network, no separate checksum file to carry (the sealed SHA256 is always verified).

**Linux (on arm64, use `penguin-linux-arm64.tar.gz`):**

```bash
mkdir penguin-install
tar -xzf penguin-linux-x64.tar.gz -C penguin-install
./penguin-install/install.sh
```

**macOS (Apple silicon shown; on Intel, use `penguin-darwin-x64.tar.gz`):**

```bash
mkdir penguin-install
tar -xzf penguin-darwin-arm64.tar.gz -C penguin-install
./penguin-install/install.sh
```

**Windows (unzip, then double-click `install.cmd` — or run it in PowerShell):**

```powershell
Expand-Archive penguin-win32-x64.zip -DestinationPath penguin-install
cd penguin-install
.\install.cmd
```

</details>

### 🤖 CLI & SDK — for agents

The same engine, scriptable — made to be driven by agents (and agents building agents):

```bash
penguin config model add --provider deepseek --model-id deepseek-v4-flash --api-key sk-... --set-default
penguin run -m "Create hello.txt containing Hello, Penguin"   # one-shot task
penguin chat       # interactive REPL (/compact, /clear, /exit, Ctrl-C to interrupt)
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
- [x] Desktop app
- [x] Windows support
- [ ] Agent company and templates
- [ ] Company-level self evolving
- [ ] OpenShell integration (permission-governed shell)
- More to come…

## Development

```bash
pnpm install && pnpm build   # build first: core's exports point at dist/
pnpm dev                     # backend + web app together (prefixed logs, deps built once)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workspace guide: dev commands, quality gates, repo layout, and the changelog rule.

## Contributors

Thanks to everyone who has contributed to PenguinHarness!

<p align="center">
  <a href="https://github.com/Prism-Shadow/penguin-harness/graphs/contributors"><img src="https://contrib.rocks/image?repo=Prism-Shadow/penguin-harness" alt="PenguinHarness contributors" /></a>
</p>

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
