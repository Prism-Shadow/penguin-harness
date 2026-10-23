---
title: "Personal agents need an agent-native cloud computer"
date: 2026-10-19
category: perspectives
excerpt: "September 2026 personal agent launches from Meta and OpenAI show a personal agent needs a model, runtime, and agent-native cloud computer; the missing computer holds app connections as one entry point."
---

> Written for PenguinHarness 0.2.16. Later releases may differ in some details.

September 2026 brought two personal agent launches: Meta Muse on September 8, OpenAI dots three weeks later at DevDay. Both give each user a dedicated cloud computer instead of confining work to a chat window[^1].

A personal agent has three parts: a stronger model, a settled Agent Runtime loop, and an agent-native cloud computer. The runtime is stable; **the cloud computer is the missing piece, holding app connections as the one entry point**.

**TL;DR**
- The core agent runtime loop is settled, with near-term gains from model training.
- Ephemeral sandboxes, even persistent ones, cannot be a personal agent's long-term home.
- The missing cloud computer holds app connections as a single entry point.

## The runtime loop follows a known path

**The middle of a personal agent's three parts, the Agent Runtime layer, has a core loop with a settled shape**. In PenguinHarness, that loop runs four steps: assemble context, call the model, run approved tool calls, append every event to an append-only Trace.

<figure class="post-figure" data-figure="personal-agent-three-parts"> <svg class="fig-svg" viewBox="0 0 560 211" role="img" aria-labelledby="personal-agents-need-a-computer-personal-agent-three-parts-en-title"> <title id="personal-agents-need-a-computer-personal-agent-three-parts-en-title">Three side-by-side columns for the components of a personal agent, with the settled runtime loop drawn in the middle column.</title> <defs><marker id="personal-agents-need-a-computer-personal-agent-three-parts-en-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line1" d="M65 21H865"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line2" d="M65 38H865"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line3" d="M-331 71H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line4" d="M-331 86H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line5" d="M-331 101H469"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line6" d="M174.75 117H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line7" d="M174.75 134H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line8" d="M174.75 151H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line9" d="M174.75 168H974.75"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line10" d="M395 156H1195"/><path id="personal-agents-need-a-computer-personal-agent-three-parts-en-line11" d="M395 172H1195"/></defs> <rect x="370.5" y="0.5" width="189" height="209.5" rx="8" class="fig-s2"/> <text x="69" y="30" class="fig-title" text-anchor="middle">Stronger model</text> <path d="M0 50H138" class="fig-axis"/> <text x="254" y="30" class="fig-title" text-anchor="middle">Agent Runtime</text> <path d="M152 50H356" class="fig-axis"/> <text class="fig-title" text-anchor="middle"><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line1" startOffset="50%">Agent-native</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line2" startOffset="50%">Cloud Computer</textPath></text> <path d="M382 50H548" class="fig-axis"/> <text class="fig-note" text-anchor="middle"><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line3" startOffset="50%">Changes: vendor</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line4" startOffset="50%">post-training on</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line5" startOffset="50%">agent environments</textPath></text> <text x="254" y="71" class="fig-note" text-anchor="middle">Core shape settled</text> <text x="465" y="71" class="fig-note" text-anchor="middle">Requires new work</text> <rect x="152.75" y="86" width="202.5" height="124" rx="8" class="fig-terminal"/> <rect x="160.75" y="94" width="186.5" height="88" rx="2" class="fig-box"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line6">Assemble context →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line7">Call model →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line8">Run tool calls →</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line9">Append to trace</textPath></text> <path d="M317.25 164H333.25V113H315.25" class="fig-edge" marker-end="url(#personal-agents-need-a-computer-personal-agent-three-parts-en-arrow)"/> <text x="254" y="201" text-anchor="middle">Safety/permission guards</text> <rect x="384" y="99" width="4" height="4" class="fig-marker"/> <text x="395" y="106">Durable &amp; always-on</text> <rect x="384" y="124" width="4" height="4" class="fig-marker"/> <text x="395" y="131">Agent-adapted software</text> <rect x="384" y="149" width="4" height="4" class="fig-marker"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line10">Owns app connections</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-three-parts-en-line11">as a unified entry</textPath></text> </svg> <ol class="fig-steps"> <li>Stronger model</li> <li>Changes: vendor post-training on agent environments</li> <li>Agent Runtime</li> <li>Core shape settled</li> <li>Assemble context → Call model → Run tool calls → Append to trace</li> <li>Safety/permission guards</li> <li>Agent-native Cloud Computer</li> <li>Requires new work</li> <li>Durable &amp; always-on</li> <li>Agent-adapted software</li> <li>Owns app connections as a unified entry</li> </ol> <figcaption>We see personal agents splitting into three discrete parts; we think the runtime loop is the stable middle, while model training and the host computer are the sources of near-term change.</figcaption> </figure>

A stronger model does not make runtime design irrelevant. Fortune reports GPT-6 Astra scores 66% on ARC-AGI-3 with the standard harness and 99.9% with a souped-up harness, while DeepSeek-V3.2 trains across 1,800+ agent environments[^2].

This core loop shape will not shift soon, so the remaining question is what environment the loop runs in.

## Per-task sandboxes are the wrong home

The dominant agent work environment is the disposable per-task sandbox, built for isolation over long-term use. Anthropic's Managed Agents uses replaceable containers, Windows 365 for Agents resets Cloud PCs to a clean state after every session, and standard Manus chats launch in blank, short-lived sandboxes deleted on completion[^3].

Persistent sandbox options already exist: Manus sells an always-on Ubuntu Cloud Computer, and E2B can save a paused sandbox's full state indefinitely[^4].

These sandboxes are correctly engineered for isolation and reproducibility, **which makes them unsuited as a personal agent's permanent home; even generic persistent machines leave two gaps unaddressed**.

## Agents work best with interfaces built for them

The first gap is access to software built for agents, not for humans to click through. Agents work across three stacked layers: a base sandbox image, GUI-only desktop apps, and apps with agent-adapted interfaces. E2B's default sandbox image is Debian with preinstalled developer tooling and no desktop or office software.

<figure class="post-figure" data-figure="personal-agent-software-stack"> <svg class="fig-svg" viewBox="0 0 560 266" role="img" aria-labelledby="personal-agents-need-a-computer-personal-agent-software-stack-en-title"> <title id="personal-agents-need-a-computer-personal-agent-software-stack-en-title">Stacked possible layers of software access available to an agent, ordered from base image up to adapted interfaces, with performance callouts for GUI and adapted interface modes.</title> <defs><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line1" d="M28 52H828"/><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line2" d="M28 68H828"/><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line3" d="M28 98H828"/><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line4" d="M28 114H828"/><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line5" d="M28 188H828"/><path id="personal-agents-need-a-computer-personal-agent-software-stack-en-line6" d="M28 204H828"/></defs> <rect x="1" y="1" width="558" height="128" rx="6" class="fig-box"/> <text x="16" y="25" class="fig-label">Apps with agent-adapted interfaces (CLI/API/MCP)</text> <path d="M17 39V75" class="fig-axis"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line1">65–70% less task completion time vs GUI</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line2" class="fig-note">(AXIS, Microsoft researchers)</textPath></text> <path d="M17 85V121" class="fig-axis"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line3">58.5% fewer steps for o1 when adding API actions to GUI</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line4" class="fig-note">(UFO2, Microsoft)</textPath></text> <rect x="1" y="137" width="558" height="82" rx="6" class="fig-box"/> <text x="16" y="161" class="fig-label">GUI-only desktop apps</text> <path d="M17 175V211" class="fig-axis"/> <text><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line5">20.6% binary success, top OSWorld 2.0 entry</textPath><textPath href="#personal-agents-need-a-computer-personal-agent-software-stack-en-line6" class="fig-note">(Claude Opus 4.8, 500-step budget)</textPath></text> <rect x="1" y="227" width="558" height="38" rx="6" class="fig-box"/> <text x="16" y="251" class="fig-label">Base sandbox image (Linux + dev tools)</text> </svg> <ol class="fig-steps"> <li>Base sandbox image (Linux + dev tools)</li> <li>GUI-only desktop apps</li> <li>20.6% binary success, top OSWorld 2.0 entry (Claude Opus 4.8, 500-step budget)</li> <li>Apps with agent-adapted interfaces (CLI/API/MCP)</li> <li>65–70% less task completion time vs GUI (AXIS, Microsoft researchers)</li> <li>58.5% fewer steps for o1 when adding API actions to GUI (UFO2, Microsoft)</li> </ol> <figcaption>Many default sandbox images stop at developer tooling; measured comparisons show API routes cut task completion time by 65–70% versus GUI operation, and adding API actions to GUI cuts o1's average step count by 58.5%.</figcaption> </figure>

**Measurements show agents perform better through agent-adapted interfaces than through the GUI**. AXIS, an API-first agent tested on Microsoft Word tasks, reports 65%–70% less task completion time and 38%–53% less cognitive workload; in its user study it was faster than both manual GUI work and a GUI-operating UI agent[^5]. UFO2's mixed API and GUI actions cut o1's step count by 58.5% on identical tasks.

GUI computer use does not yet replace agent-adapted interfaces. The top OSWorld 2.0 entry completes just 20.6% of long-horizon GUI tasks at a 500-step budget[^6].

Adapted interfaces close this gap, leaving a second: app connection storage.

## Connections belong on the machine, not in each agent

The second gap is no durable home for app connections. Existing designs keep user credentials in one guarded place, out of the agent's direct reach.

Muse stores credentials on dedicated cloud computers; agent code sees only a surrogate token, with Sentinel swapping credentials at the network boundary[^7]. A dot's cloud browser keeps sign-ins separate from the user's local browser; connecting a messaging channel does not connect other apps, and connected apps stay within their granted permissions. Anthropic's Managed Agents routes MCP calls through a vault proxy keeping credentials out of the harness.

**The machine, not agents or conversations, should hold these connections**: sign in once, every agent uses them within permissions, access is managed in one place.

A single connection store sounds like a larger attack target. This guarded machine that holds connections keeps secrets out of agent context, instead of copying them across agents, conversations or tools.

## Where PenguinHarness stands today

**Measured against that machine that holds connections, PenguinHarness already ships the settled runtime loop, and does not yet ship the guarded machine itself**. The "Machines" page installs PenguinHarness over SSH on user-owned Linux or macOS hosts, reconnects across restarts and dropped sessions, and syncs project config to each connected host.

![The PenguinHarness Machines page showing two connected hosts, one local server and one reached over SSH.](/blog-assets/machines-page-en.png)
_The Machines page shows connected hosts PenguinHarness can run conversations on; we do not create or host these machines, or preinstall agent-adapted software on them._

We do not create, host or sell cloud computers, or preinstall software on hosts users connect.

In 0.2.16, connections sit in separate places: per-agent MCP configs and "Vault" secrets, per-conversation remote control bots, and per-browser sign-ins, with no shared connection catalogue.
This version cannot sign in to MCP servers that use OAuth.

We do not ship an agent-native cloud computer today.

The concrete implication is simple: set a connection up once on a machine, and offer it to every agent that runs there.

[^1]: [Introducing Muse: The World’s First Personal AI Agent Built for Everyone](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
[^2]: [OpenAI launches GPT-6 Astra, its most powerful model yet, and touts its ability to use your computer | Fortune](https://fortune.com/2026/09/03/openai-debuts-gpt-6-astra-computer-use-greg-brockman-says-start-of-agi/)
[^3]: [Scaling Managed Agents: Decoupling the brain from the hands \ Anthropic](https://www.anthropic.com/engineering/managed-agents)
[^4]: [Introducing Cloud Computer: Lowering the Barrier to Building](https://manus.im/blog/manus-cloud-computer)
[^5]: [AXIS: Efficient Human-Agent-Computer Interaction with API-First LLM-Based Agents](https://arxiv.org/abs/2409.17140)
[^6]: [OSWorld 2.0: Benchmarking computer-use agents on long-horizon real-world tasks](https://osworld-v2.xlang.ai/)
[^7]: [How We Built Safety Into Muse | Meta AI Research](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
