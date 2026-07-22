---
title: "The Easiest Way to Build AI Agents in 2026"
date: 2026-07-22
category: practice
excerpt: The agent framework field has quietly converged — AutoGen is in maintenance mode, LangChain moved its legacy abstractions out of core, and the fastest-moving toolkits now reach a working agent in four to ten lines. We compare five of the most used options on facts you can check, then make the case for the axis nobody else is competing on: not writing the agent at all.
---

Two years ago, "how do I build an agent?" meant "which framework do I learn?" In 2026 that question has largely answered itself, and the answer is unflattering to frameworks: **the winners got thin**.

This post does three things. It lays out where the five most-used options actually stand today, with versions and numbers you can verify. It shows what the field has converged on — including several vendors publishing arguments against their own category. And it makes the case for the axis we think is now the interesting one.

Every figure below was checked on **2026-07-22** against GitHub, PyPI, and official documentation. Where something is approximate, it says so.

## 1. Three ways to build an agent

Strip away branding and there are only three postures.

**Write the loop yourself.** Call the model API, parse tool calls, execute them, append results, repeat. Full control, no abstraction tax, and you own every edge case — including the ones you have not met yet.

**Assemble a framework.** Adopt someone's abstractions — graphs, crews, workflows, steps — and get orchestration, integrations, and a support ecosystem. You pay in indirection.

**Describe what you want.** Do not write the agent. State the job in a sentence and let an agent produce the configuration, prompts, and skills. This is the newest posture and the one the field has barely started competing on.

Almost everything in the market is option one or two. PenguinHarness is built for option three.

## 2. The field, as of July 2026

Five representative options, chosen to span the design space — a graph framework, a role-playing framework, a vendor SDK, an enterprise toolkit, and a visual builder.

| Tool | Owner | License | ★ (2026-07-22) | Latest release | How you build |
| --- | --- | --- | ---: | --- | --- |
| **LangChain + LangGraph** | LangChain Inc. | MIT | 142k / 38k | langchain 1.3.14 (Jul 16) | Prebuilt agent compiled to a state graph |
| **CrewAI** | CrewAI Inc. | MIT | 56k | 1.15.5 (Jul 20) | Role-playing crew of agents + tasks |
| **OpenAI Agents SDK** | OpenAI | MIT | 28k | 0.18.3 (Jul 17) | Agent loop primitives + handoffs |
| **Google ADK** | Google | Apache-2.0 | 21k | 2.0 GA, py 2.5.0 (Jul 16) | Declarative agent + edge-list workflows |
| **Dify** | LangGenius | Modified Apache-2.0 | 150k | 1.16.0 (Jul 17) | Visual canvas, no code |
| **PenguinHarness** | Prism Shadow | Apache-2.0 | — | 0.1.0 | Describe it; an agent builds it |

And what you actually get in the box:

| Tool | Min. code for a tool-using agent | End-user UI | CLI | Headless server | Tool approval | First-party eval |
| --- | --- | --- | --- | --- | --- | --- |
| LangChain + LangGraph | ~15 lines | LangSmith (SaaS) | — | LangGraph Platform | Graph interrupts | LangSmith |
| CrewAI | ~55 lines across 5 files | — | scaffolding | — | via Flows | — |
| OpenAI Agents SDK | ~27 lines | Dashboard traces | — | — | Guardrails | — |
| Google ADK | ~8 lines | `adk web` + Visual Builder | `adk run` | `adk api_server` | — | Yes, and deep |
| Dify | **0** | Yes | Yes | REST API | — | — |
| **PenguinHarness** | **0** (CLI or Web) · ~10 via SDK | Yes | Yes | Yes | **4 modes, audited** | **Yes, built-in** |

Line counts come from each project's official quickstart and are not perfectly comparable — they differ in whether imports, config files, and environment setup are counted. Treat them as orders of magnitude, not a leaderboard. Blank cells mean *not documented in the sources we checked*, not *impossible*.

Two notes on licensing, because "open source" is doing heavy lifting in this market. Dify ships under a **modified** Apache 2.0 that forbids multi-tenant SaaS resale and forbids removing its branding from the frontend. n8n — the single most-starred project in this space at 197k — uses the Sustainable Use License and is **not** open source at all. PenguinHarness is plain Apache-2.0.

## 3. What the field agrees on

Here is the part that should change how you read framework marketing: **the strongest arguments against heavy agent frameworks now come from the vendors themselves.**

Anthropic's engineering guidance has said so since 2024, and it remains their canonical reference:

> "the most successful implementations weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns."

> "they often create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug."

Microsoft's own Agent Framework documentation opens with a line most vendors would not print:

> "If you can write a function to handle the task, do that instead of using an AI agent."

LangChain's v1 release notes describe moving legacy chains, retrievers, and the hub module out of core:

> "Legacy functionality has moved to `langchain-classic` to keep the core packages lean and focused."

And AutoGen — still the highest-starred multi-agent framework at 60k — now opens its README with:

> "AutoGen is now in maintenance mode. It will not receive new features or enhancements and is community managed going forward."

The independent criticism is blunter. Gregor Zunic of browser-use, writing in January 2026:

> "Every abstraction is a liability. Every 'helper' is a failure point."

Though in fairness he also warns against naive minimalism, and he is right:

> "The naive approach - stop when the model returns no tool calls - doesn't work well. Agents prematurely finish."

Three signals point the same way:

- **Consolidation.** AutoGen is in maintenance mode, Semantic Kernel is superseded by Microsoft Agent Framework, LangChain has quarantined its legacy surface, and Coze Studio has not shipped a release since February.
- **Convergence on thin.** The fastest-moving projects now reach a working tool-using agent in single-digit lines — AWS Strands in about 4, Anthropic's Claude Agent SDK in about 6, Google ADK in about 8.
- **"Harness" became the industry's word.** Within roughly two months, AWS renamed its agent repo from `sdk-python` to **`harness-sdk`**, Microsoft shipped a **Harness** tier in Agent Framework (with context compaction and don't-ask-again tool approval), and Anthropic published *"A harness for every task."* Three vendors, independently, landed on the same noun — the one we named this project after.

The category is not dying. It is admitting that the valuable part was never the abstractions.

## 4. What nobody has solved

Follow that convergence to its end and a gap appears. If the ideal is thin, then writing four lines instead of forty is a rounding error. The real questions become:

**Why write the agent at all?** Four lines still means a repository, a language runtime, a dependency tree, and a developer. For a large class of real jobs — analyze this data, watch this repo, draft these reports — the code is incidental.

**Where are the production controls?** Thin frameworks tend to drop exactly the things that make an autonomous process safe on a real machine. Of the five above, only ADK ships an end-user UI, a CLI, and a headless server together; explicit per-call tool approval with an audit trail is rare; first-party evaluation is rarer still.

**What improves the agent after it ships?** Every option here treats the agent as a build artifact. You write it, you deploy it, and any improvement is you, editing prompts by hand.

## 5. The fourth option

PenguinHarness answers a different question. Not *how few lines does an agent take* — but *why are you writing lines at all*.

### Zero lines to a working agent

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin run -m "Analyze data.csv and summarize quarterly sales"
```

No project, no imports, no framework. The same engine drives a REPL (`penguin chat`), a headless server (`penguin server`), and a full Web App (`penguin web`) with multi-session chat, agent and skill management, usage stats, trace observability, and an evaluation center. One install, four surfaces, one data directory.

### One sentence, and an agent builds your agent

This is the part that has no real equivalent in the table above. You describe the agent you want; an agent writes its `AGENTS.md`, installs the skills it needs, and hands you something that runs:

```text
Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG app
that answers Claude Code questions as a configuration expert, citing its sources.
```

That prompt produces a complete working RAG application — ingestion, retrieval, cited sources, and a web UI. On DeepSeek V4 Pro it cost **$0.02** in tokens. The [runnable version](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent) is an 82-line SDK script that builds a brand-new agent from a plain-language requirement and then runs it to prove the generated configuration actually shapes its behavior.

The reason this works is architectural: **agents are editable data, not hardcoded constants**. Prompts, skills, and configuration are plain files on disk. What you can see, an agent can rewrite — which is also what makes the next part possible.

### It improves itself

Built-in skills for benchmark design, evaluation, and optimization let an agent score its own output, find where it lost points, and ship version N+1 — with a snapshot before every round and every request replayable in the trace view. That is the difference between an agent as a build artifact and an agent as a process.

### And it keeps the controls

Minimalism at the context layer, rigor at the runtime layer:

- **Every tool call gets exactly one approval decision**, in one of four modes — allow-all, deny-all, read-only, always-ask. The SDK denies by default when no approver is supplied.
- **Every decision is audited** to the trace as an `approval_decision` event.
- **Fully local.** Your data never leaves the machine, and it runs on as little as a single CPU.
- **1000+ models.** Any OpenAI-protocol endpoint works — cloud or local — and an agent never binds to a model; you pick one per session.

If you do want the SDK, it is about ten lines and one entry point:

```ts
import { createAgent, isCompleteModelMessage, userText } from "@prismshadow/penguin-core";

const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Create hello.txt containing hi")], {
  approve: async () => "allow",
})) {
  if (isCompleteModelMessage(output) && output.payload.type === "text") {
    console.log(output.payload.text);
  }
}
```

## 6. When not to use PenguinHarness

A comparison where one option wins every row is an advertisement, not an analysis. Ours loses several.

**Embedding an agent inside an existing application.** If you need an agent inside a Django service or a Next.js route, use a library built for that — Pydantic AI and the Vercel AI SDK are excellent, and LangChain's ecosystem breadth is genuinely hard to match.

**Python shops.** Our SDK is TypeScript. The CLI and server are language-agnostic, but if your team writes Python and wants to subclass things, most of the table above will fit better.

**Complex multi-agent topologies.** If your problem genuinely is a directed graph with conditional routing and checkpointed state, LangGraph and ADK model that explicitly. We give you subagents — deliberately capped at depth 1 — because most delegation does not need a graph.

**Deep vendor integration.** On Azure, Microsoft Agent Framework is the path of least resistance. On Vertex, ADK is.

Use PenguinHarness when you want an agent to *do a job* rather than to be a component — and when you want it to get better at that job over time.

## 7. Where this leaves you

The field spent two years proving that heavy abstractions were the wrong bet, and it has now largely admitted it. Thin won. But thin only moves the question: once the loop is four lines, the loop is not the hard part.

The hard parts are the ones the table is mostly blank on — a UI humans can actually use, approval you can audit, evaluation that runs, and some mechanism by which the agent is better next month than it is today.

That is what we built. Not the smallest framework — **no framework**, and an agent to write the agent.

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # http://127.0.0.1:7364 — first login: admin / penguin-2026
```

---

- **Docs**: [Quickstart](https://penguin.ooo/docs/quickstart) · [Core Interfaces](https://penguin.ooo/docs/interfaces) · [Skills](https://penguin.ooo/docs/skills)
- **Community**: [GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**Sources** — all figures checked 2026-07-22: [LangChain v1 release notes](https://docs.langchain.com/oss/python/releases/langchain-v1) · [AutoGen README](https://github.com/microsoft/autogen) · [Microsoft Agent Framework docs](https://learn.microsoft.com/en-us/agent-framework/overview/) · [Google ADK](https://adk.dev/) · [CrewAI quickstart](https://docs.crewai.com/en/quickstart) · [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/quickstart/) · [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE) · [n8n LICENSE](https://github.com/n8n-io/n8n/blob/master/LICENSE.md) · [Anthropic, Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents) · [Anthropic, A harness for every task](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code) · [Gregor Zunic, The Bitter Lesson of Agent Frameworks](https://browser-use.com/posts/bitter-lesson-agent-frameworks)
