---
title: "The Easiest Way to Build AI Agents in 2026"
date: 2026-07-22
category: perspectives
excerpt: Writing an agent takes ten lines now. The cost has moved somewhere else — into the stack you must assemble around it, where building, observability and evaluation are three separate products from two or three vendors. This is a comparison of what that actually costs to learn, and the case for automating it away instead.
---

Ask "what is the easiest way to build an AI agent" and you will get answers about lines of code. Those answers are now mostly obsolete: the leading toolkits all reach a working agent in four to fifteen lines.

The cost did not disappear. It moved. It now sits in everything *around* the agent — the orchestration layer, the observability platform, the evaluation harness — each a separate product, with separate concepts, separate documentation, and often a separate vendor. Writing the agent is an afternoon. Learning the stack is a quarter.

This post is about that cost, and about removing it rather than paying it.

## 1. What "building an agent with LangChain" actually costs

LangChain is the reasonable default and the most-used option in the space, so it makes the fairest example. To take an agent from prototype to something you would run in production, here is what you assemble:

| Layer | What you use | Who makes it | What you have to learn |
| --- | --- | --- | --- |
| Build | **LangChain** | LangChain Inc. | Tools, models, `create_agent` |
| Orchestrate | **LangGraph** | LangChain Inc. | Nodes, edges, state, checkpoints, interrupts |
| Observe | **LangSmith** or **Langfuse** | LangChain Inc. / Langfuse | SDK wiring and a hosted platform — or OpenTelemetry plus self-hosting |
| Evaluate | LangSmith evals or Langfuse evals | same | Datasets, judges, experiment configuration |
| Deploy | **LangGraph Platform** | LangChain Inc. | Yet another deployment model |

Every one of these is a good product. That is not the problem. The problem is that they are five products.

The observability row is where it bites hardest, because it is a fork in the road rather than a step. LangSmith is LangChain's own commercial platform with native integration — easiest if you are already on the stack, and a managed SaaS you are now dependent on. [Langfuse](https://github.com/langfuse/langfuse) is the open-source alternative: MIT-licensed apart from its enterprise folders, framework-agnostic, self-hostable via Docker or Kubernetes, and maintained by a team that joined ClickHouse in January 2026. It is genuinely excellent. It is also a second vendor, a second data model, and a service you now operate.

So before your agent does anything useful in production, someone on your team has learned two libraries, wired a tracing SDK, stood up or subscribed to an observability platform, and built an evaluation dataset by hand. Then, when the agent underperforms, that same person reads the traces and tunes the prompts — because there is nothing in this stack that does that part for you.

**That is the real answer to "how hard is it to build an agent in 2026." Not the ten lines. The quarter.**

## 2. The field, as of July 2026

Five representative options, spanning the design space. All figures checked 2026-07-22.

| Tool | License | ★ | Min. code | UI / CLI / server | Observability | Evaluation |
| --- | --- | ---: | --- | --- | --- | --- |
| LangChain + LangGraph | MIT | 142k / 38k | ~15 lines | — / — / Platform | LangSmith (SaaS) or Langfuse | LangSmith or Langfuse |
| CrewAI | MIT | 56k | ~55 lines, 5 files | — / scaffold / — | `verbose` logging | — |
| OpenAI Agents SDK | MIT | 28k | ~27 lines | — / — / — | OpenAI Dashboard | — |
| Google ADK | Apache-2.0 | 21k | ~8 lines | `adk web` / `adk run` / `adk api_server` | — | Built in, and deep |
| Dify | Modified Apache-2.0 | 150k | **0** | Yes / Yes / REST | — | — |
| **PenguinHarness** | Apache-2.0 | — | **0** | **Yes / Yes / Yes** | **Built in (Trace)** | **Built in** |

Line counts come from each project's official quickstart and are not perfectly comparable. Blank cells mean *not documented in the sources we checked*, not *impossible*.

One licensing note, since "open source" is doing heavy lifting in this market: Dify ships under a **modified** Apache 2.0 that forbids multi-tenant SaaS resale and forbids removing its branding. n8n, the most-starred project in the space at 197k, uses the Sustainable Use License and is not open source at all. PenguinHarness is plain Apache-2.0.

## 3. The field already agrees that thin won

The strongest arguments against heavy agent frameworks now come from the vendors themselves.

Anthropic's engineering guidance, still their canonical reference:

> "the most successful implementations weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns."

Microsoft's own Agent Framework documentation opens with a line most vendors would not print:

> "If you can write a function to handle the task, do that instead of using an AI agent."

And AutoGen — still the highest-starred multi-agent framework at 60k — now begins its README with:

> "AutoGen is now in maintenance mode. It will not receive new features or enhancements and is community managed going forward."

LangChain itself moved its legacy chains, retrievers and hub module into a separate `langchain-classic` package to keep the core "lean and focused." Meanwhile "harness" became the industry's word: within roughly two months, AWS renamed its agent repo to `harness-sdk`, Microsoft shipped a Harness tier in Agent Framework, and Anthropic published *"A harness for every task."*

The category is not dying. It is admitting the abstractions were never the valuable part — which makes the assembly cost in section 1 even harder to justify.

## 4. PenguinHarness: one install, and nothing to learn

Our answer is not a thinner framework. It is removing the assembly step and then automating the tuning loop.

### 4.1 The layers are already one product

One install gives you all five rows of that first table, sharing one data directory and one message protocol:

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # http://127.0.0.1:7364 — first login: admin / penguin-2026
```

Multi-session chat, agent and skill management, model configuration, usage and cost statistics, **Trace observability**, and an **evaluation center** — in the box, wired together, nothing to subscribe to and nothing to self-host separately. Every request, tool call and approval decision is already recorded; a session restores completely from its trace. There is no tracing SDK to install because there is no seam to instrument across.

### 4.2 Zero lines, not fewer lines

```bash
penguin run -m "Analyze data.csv and summarize quarterly sales"
```

No project, no imports, no framework. The same engine drives the REPL (`penguin chat`), a headless server (`penguin server`) and the Web App.

### 4.3 An agent builds your agent

You describe what you want; an agent writes its `AGENTS.md`, installs the skills it needs, and hands you something that runs. One sentence produced a complete RAG application — ingestion, retrieval, cited sources, web UI — for **$0.02** of tokens on DeepSeek V4 Pro. The [runnable example](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent) is an 82-line script that builds a new agent from a plain-language requirement and then runs it.

This works because **agents are editable data, not hardcoded constants** — prompts, skills and configuration are plain files on disk.

### 4.4 The tuning loop is automated too

This is the part that answers section 1's last paragraph. Built-in skills for benchmark design, evaluation and optimization let the agent score its own output, locate where it lost points, and ship version N+1 — with a snapshot before every round and every request replayable in the trace view.

On other stacks, *you* are the optimizer: you read the traces, you tune the prompts, you rerun the evals. Here that loop is the agent's job. **You do not have to learn to be good at it.**

### 4.5 The controls are still there

Every tool call gets exactly one approval decision in one of four modes — allow-all, deny-all, read-only, always-ask — and each decision is audited to the trace. It runs fully locally on as little as a single CPU, and reaches 1000+ models through any OpenAI-protocol endpoint.

## 5. When not to use PenguinHarness

A comparison where one option wins every row is an advertisement, not an analysis. Two cases where you should pick something else:

- **Python shops.** Our SDK is TypeScript. The CLI and server are language-agnostic, but if your team works in Python and wants to subclass and extend these classes, most of the options above will fit better.
- **Deep cloud integration.** If you are already all-in on Azure, Microsoft Agent Framework is the path of least resistance; on Vertex, ADK is.

## 6. The short version

Building an agent stopped being the hard part. Assembling and learning the stack around it did not — and on the most popular option that means two libraries, an observability platform from a first or third party, an evaluation harness, and a human who becomes the optimization loop.

PenguinHarness collapses those into one install, then hands the optimization loop to the agent.

Not the smallest framework — **no framework, an agent to write the agent, and nothing left for you to learn.**

---

- **Docs**: [Quickstart](https://penguin.ooo/docs/quickstart) · [Skills](https://penguin.ooo/docs/skills) · [Sessions & Traces](https://penguin.ooo/docs/sessions-and-traces)
- **Community**: [GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**Sources** — figures checked 2026-07-22: [LangChain v1 release notes](https://docs.langchain.com/oss/python/releases/langchain-v1) · [Langfuse](https://github.com/langfuse/langfuse) · [AutoGen README](https://github.com/microsoft/autogen) · [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/) · [Google ADK](https://adk.dev/) · [CrewAI](https://docs.crewai.com/en/quickstart) · [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/quickstart/) · [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE) · [n8n LICENSE](https://github.com/n8n-io/n8n/blob/master/LICENSE.md) · [Anthropic, Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)
