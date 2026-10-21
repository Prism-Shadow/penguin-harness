---
title: "Personal agents need an agent-native cloud computer"
date: 2026-10-19
category: perspectives
excerpt: "We split personal agents into three stacked parts: model, runtime, and host computer. The runtime loop is settled; progress needs a purpose-built agent-native cloud computer."
---

Meta launched Muse on 2026-09-08.[^1] OpenAI launched dots three weeks later, on 2026-09-29.[^2] Both give each agent its own dedicated cloud computer.[^1][^3] We split personal agents into three stacked parts: Stronger model, Agent Runtime, Agent-native Cloud Computer.

We think the runtime loop's core shape is settled. Near-term change will come from model post-training and upgrades to the agent's working environment. The diagram below lays out this split.

<figure class="post-figure" data-figure="personal-agent-three-parts"> <svg class="fig-svg" viewBox="0 0 560 211" role="img" aria-labelledby="personal-agents-need-a-computer-personal-agent-three-parts-en-title"> <title id="personal-agents-need-a-computer-personal-agent-three-parts-en-title">Three side-by-side columns for the components of a personal agent, with the settled runtime loop drawn in the middle column.</title> <defs><marker id="personal-agents-need-a-computer-personal-agent-three-parts-en-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line1" d="M65 21H865"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line2" d="M65 38H865"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line3" d="M-331 71H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line4" d="M-331 86H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line5" d="M-331 101H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line6" d="M174.75 117H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line7" d="M174.75 134H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line8" d="M174.75 151H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line9" d="M174.75 168H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line10" d="M395 156H1195"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line11" d="M395 172H1195"/></defs> <rect x="370.5" y="0.5" width="189" height="209.5" rx="8" class="fig-s2"/> <text x="69" y="30" class="fig-title" text-anchor="middle">Stronger model</text> <path d="M0 50H138" class="fig-axis"/> <text x="254" y="30" class="fig-title" text-anchor="middle">Agent Runtime</text> <path d="M152 50H356" class="fig-axis"/> <text class="fig-title" text-anchor="middle"><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line1" startOffset="50%">Agent-native</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line2" startOffset="50%">Cloud Computer</textPath></text> <path d="M382 50H548" class="fig-axis"/> <text class="fig-note" text-anchor="middle"><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line3" startOffset="50%">Changes: vendor</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line4" startOffset="50%">post-training on</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line5" startOffset="50%">agent environments</textPath></text> <text x="254" y="71" class="fig-note" text-anchor="middle">Core shape settled</text> <text x="465" y="71" class="fig-note" text-anchor="middle">Requires new work</text> <rect x="152.75" y="86" width="202.5" height="124" rx="8" class="fig-terminal"/> <rect x="160.75" y="94" width="186.5" height="88" rx="2" class="fig-box"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line6">Assemble context →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line7">Call model →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line8">Run tool calls →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line9">Append to trace</textPath></text> <path d="M317.25 164H333.25V113H315.25" class="fig-edge" marker-end="url(#personal-agents-need-a-computer-personal-agent-three-parts-en-arrow)"/> <text x="254" y="201" text-anchor="middle">Safety/permission guards</text> <rect x="384" y="99" width="4" height="4" class="fig-marker"/> <text x="395" y="106">Durable &amp; always-on</text> <rect x="384" y="124" width="4" height="4" class="fig-marker"/> <text x="395" y="131">Agent-adapted software</text> <rect x="384" y="149" width="4" height="4" class="fig-marker"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line10">Owns app connections</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line11">as a unified entry</textPath></text> </svg> <ol class="fig-steps"> <li>Stronger model</li> <li>Changes: vendor post-training on agent environments</li> <li>Agent Runtime</li> <li>Core shape settled</li> <li>Assemble context → Call model → Run tool calls → Append to trace</li> <li>Safety/permission guards</li> <li>Agent-native Cloud Computer</li> <li>Requires new work</li> <li>Durable &amp; always-on</li> <li>Agent-adapted software</li> <li>Owns app connections as a unified entry</li> </ol> <figcaption>We see personal agents splitting into three discrete parts; we think the runtime loop is the stable middle, while model training and the host computer are the sources of near-term change.</figcaption> </figure>

## Runtime and model gains follow a known path

PenguinHarness's engine, run loop and append-only Trace follow this settled shape.[^4][^5][^6]

Fortune reports GPT-6 Astra scored 66% on ARC-AGI-3 with the standard harness, 99.9% with a souped-up harness.[^7] Meta runs a separate Sentinel permission guard on each Muse VM; we expect such guard layers to keep growing.[^8]

OpenAI credits pretraining plus reinforcement learning for model gains.[^9][^10] DeepSeek trained on 1,800+ agent environments.[^11] Anthropic notes flawed RL environments cause misaligned behavior.[^12] Our bet is RL on agent environments is the largest near-term driver.

The agent's working environment remains the underdeveloped piece of the stack.

## Per-task sandboxes lack durable state

Many agent sandboxes are built for one task or session. They spin up fresh, then discard installed tools, running processes and in-machine state when work ends. This holds for Manus's standard sandbox, Claude Cowork and Managed Agents sandboxes, Windows 365 for Agents, and OpenAI's code interpreter.[^13][^14][^15]

We see this as a sound choice for isolation and reproducibility. Anthropic and Microsoft design for it explicitly. Anthropic keeps context in session logs; Microsoft resets Cloud PCs for isolation, auditability and reuse.[^16][^17]

Persistence options exist. Vercel snapshots filesystems by default, E2B saves paused sandbox state indefinitely, and Manus sells a persistent Ubuntu-based Manus Cloud Computer.[^13][^18][^19] These still leave two gaps: pre-adapted software and a unified home for connections.

## The agent-native cloud computer adds adapted software and owned connections

An agent's software stack has three layers: base sandbox image, GUI-only desktop apps, apps with agent-adapted interfaces.

<figure class="post-figure" data-figure="personal-agent-software-stack"> <svg class="fig-svg" viewBox="0 0 560 266" role="img" aria-labelledby="personal-agents-need-a-computer-personal-agent-software-stack-en-title"> <title id="personal-agents-need-a-computer-personal-agent-software-stack-en-title">Stacked possible layers of software access available to an agent, ordered from base image up to adapted interfaces, with performance callouts for GUI and adapted interface modes.</title> <defs><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line1" d="M28 52H828"/><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line2" d="M28 68H828"/><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line3" d="M28 98H828"/><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line4" d="M28 114H828"/><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line5" d="M28 188H828"/><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line6" d="M28 204H828"/></defs> <rect x="1" y="1" width="558" height="128" rx="6" class="fig-box"/> <text x="16" y="25" class="fig-label">Apps with agent-adapted interfaces (CLI/API/MCP)</text> <path d="M17 39V75" class="fig-axis"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line1">65–70% less task completion time vs GUI</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line2" class="fig-note">(AXIS, Microsoft researchers)</textPath></text> <path d="M17 85V121" class="fig-axis"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line3">58.5% fewer steps for o1 when adding API actions to GUI</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line4" class="fig-note">(UFO2, Microsoft)</textPath></text> <rect x="1" y="137" width="558" height="82" rx="6" class="fig-box"/> <text x="16" y="161" class="fig-label">GUI-only desktop apps</text> <path d="M17 175V211" class="fig-axis"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line5">20.6% binary success, top OSWorld 2.0 entry</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line6" class="fig-note">(Claude Opus 4.8, 500-step budget)</textPath></text> <rect x="1" y="227" width="558" height="38" rx="6" class="fig-box"/> <text x="16" y="251" class="fig-label">Base sandbox image (Linux + dev tools)</text> </svg> <ol class="fig-steps"> <li>Base sandbox image (Linux + dev tools)</li> <li>GUI-only desktop apps</li> <li>20.6% binary success, top OSWorld 2.0 entry (Claude Opus 4.8, 500-step budget)</li> <li>Apps with agent-adapted interfaces (CLI/API/MCP)</li> <li>65–70% less task completion time vs GUI (AXIS, Microsoft researchers)</li> <li>58.5% fewer steps for o1 when adding API actions to GUI (UFO2, Microsoft)</li> </ol> <figcaption>Many default sandbox images stop at developer tooling; measured comparisons show API routes cut task completion time by 65–70% versus GUI operation, and adding API actions to GUI cuts o1's average step count by 58.5%.</figcaption> </figure>

Default sandboxes ship only developer toolchains; some add office software needing wrapper fixes, so agents need preinstalled software adapted for CLI, API or MCP access.[^20][^21][^22]

Two Microsoft studies compared API routes to GUI use: AXIS found faster task times; UFO2 found fewer steps with added API actions.[^23][^24]

We treat GUI computer use as a fallback; even the top OSWorld 2.0 entry has low success rates.[^25]

The second property is unified connections: the machine holds connectors, sign-ins and credentials set once, with secrets the agent cannot read.

Meta stores Muse credentials on its dedicated VM, with Sentinel swapping real tokens so the agent sees only surrogates.[^1][^8] OpenAI keeps dot sign-ins in its cloud browser, separating messaging channels from app connections.[^3] No product delivers all three: durability, adapted software, unified connections.

## Where PenguinHarness stands today

PenguinHarness ships the settled Agent Runtime. It separates the engine from a swappable Environment boundary; only the local process implementation exists.[^4][^26]

Machines installs the server on an existing SSH-reachable Linux or macOS host.[^27] The machine's own server runs conversations; the controller keeps connections alive without the page open, reconnecting after drops or restarts.[^27] Rebooted remotes read as not running until restarted.[^28][^29]

The Machines page lists these connected hosts.

![The PenguinHarness Machines page showing two connected hosts, one local server and one reached over SSH.](/blog-assets/machines-page-en.png)
_The Machines page shows connected hosts PenguinHarness can run conversations on; we do not create or host these machines, or preinstall agent-adapted software on them._

Agents support per-agent MCP server entries you add; no built-in plugin ships one.[^30][^31][^32] The Vault keeps secrets out of prompts, but values live in process environments, and unscrubbed shell output can leak them.[^5][^30][^33]

Browser automation uses the desktop built-in browser or paired Chrome.[^34] Feishu, Telegram, QQ and WeChat channels only relay messages, with no app data access.[^35] Connections span separate scopes, with no connector catalogue, no MCP OAuth, and no edge credential broker.[^30][^36][^37]

We do not ship the agent-native cloud computer.

[^1]: [Introducing Muse: The World’s First Personal AI Agent Built for Everyone](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
[^2]: [OpenAI launches Dots, its bubbly agentic avatar | TechCrunch](https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/)
[^3]: [Meet dots | ChatGPT Learn](https://learn.chatgpt.com/docs/dots)
[^4]: [PenguinHarness docs: Architecture](https://penguin.ooo/docs/architecture)
[^5]: [PenguinHarness docs: The Agent Loop](https://penguin.ooo/docs/agent-loop)
[^6]: [PenguinHarness docs: Sessions &amp; Traces](https://penguin.ooo/docs/sessions-and-traces)
[^7]: [OpenAI launches GPT-6 Astra, its most powerful model yet, and touts its ability to use your computer | Fortune](https://fortune.com/2026/09/03/openai-debuts-gpt-6-astra-computer-use-greg-brockman-says-start-of-agi/)
[^8]: [How We Built Safety Into Muse | Meta AI Research](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
[^9]: ['Welcome to the AGI era': OpenAI launches GPT-6 Astra | VentureBeat](https://venturebeat.com/technology/welcome-to-the-agi-era-openai-launches-gpt-6-astra)
[^10]: [OpenAI Just Released Its Powerful New ChatGPT Agent | Sequoia Capital](https://sequoiacap.com/podcast/training-data-chatgpt-agent)
[^11]: [DeepSeek-V3.2 Release | DeepSeek API Docs](https://api-docs.deepseek.com/news/news251201)
[^12]: [Introducing Claude Opus 5.5 \ Anthropic](https://www.anthropic.com/news/claude-opus-5-5)
[^13]: [Introducing Cloud Computer: Lowering the Barrier to Building](https://manus.im/blog/manus-cloud-computer)
[^14]: [Claude Cowork architecture overview | Claude Help Center](https://support.claude.com/en/articles/14479288-claude-cowork-desktop-architecture-overview)
[^15]: [Cloud environment setup - Claude Platform Docs](https://platform.claude.com/docs/en/managed-agents/environments)
[^16]: [Scaling Managed Agents: Decoupling the brain from the hands \ Anthropic](https://www.anthropic.com/engineering/managed-agents)
[^17]: [Agent session lifecycle | Microsoft Learn](https://learn.microsoft.com/en-us/windows-365/agents/agent-session-lifecycle)
[^18]: [Persistence](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes)
[^19]: [Sandbox persistence - E2B Docs](https://docs.e2b.dev/sandbox/persistence)
[^20]: [Base image - E2B Docs](https://docs.e2b.dev/template/base-image)
[^21]: [e2b-dev/desktop: template/template.py](https://raw.githubusercontent.com/e2b-dev/desktop/main/template/template.py)
[^22]: [Code execution tool - Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
[^23]: [AXIS: Efficient Human-Agent-Computer Interaction with API-First LLM-Based Agents](https://arxiv.org/abs/2409.17140)
[^24]: [UFO2: The Desktop AgentOS](https://arxiv.org/html/2504.14603v2)
[^25]: [OSWorld 2.0: Benchmarking computer-use agents on long-horizon real-world tasks](https://osworld-v2.xlang.ai/)
[^26]: [packages/core/src/environment/environment.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/environment/environment.ts)
[^27]: [PenguinHarness blog: One window, agents on every machine you have](https://penguin.ooo/blog/run-agents-on-remote-machines)
[^28]: [packages/server/src/machines/server-control.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/machines/server-control.ts)
[^29]: [packages/server/src/machines/install-server.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/server/src/machines/install-server.ts)
[^30]: [PenguinHarness docs: Agents](https://penguin.ooo/docs/agents)
[^31]: [PenguinHarness docs: Skills &amp; Plugins](https://penguin.ooo/docs/skills)
[^32]: [plugins/](https://github.com/Prism-Shadow/penguin-harness/tree/v0.2.16/plugins)
[^33]: [PenguinHarness docs: Configuration Reference](https://penguin.ooo/docs/configuration)
[^34]: [PenguinHarness docs: Built-in Browser](https://penguin.ooo/docs/builtin-browser)
[^35]: [PenguinHarness docs: Remote control](https://penguin.ooo/docs/remote-control)
[^36]: [PenguinHarness docs: Tools &amp; Approval](https://penguin.ooo/docs/tools)
[^37]: [PenguinHarness docs: Settings](https://penguin.ooo/docs/settings)
