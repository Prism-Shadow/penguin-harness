---
title: "The Easiest Way to Build AI Agents in 2026"
date: 2026-07-22
category: perspectives
excerpt: Writing an agent now takes about ten lines of code. The cost has moved into the stack around it, where building, observability and evaluation are separate products to learn; this essay compares that cost and argues for automating it away.
---

> Written for PenguinHarness 0.1.1. Later releases may differ in some details.

The usual way to measure how hard it is to build an AI agent is to count the lines in a quickstart. By that measure the problem is solved: the leading toolkits reach a working agent in as few as four to fifteen lines.

This essay asks what building an agent actually costs in 2026. Our answer is that the cost did not disappear; it moved into the stack around the agent. The better response is to remove that assembly cost rather than pay it. We show what the cost looks like on the most popular stack, how PenguinHarness removes it, and when you should choose something else.

The stack around the agent has distinct layers: orchestration, which manages the agent's control flow; observability, which records what the agent did; and evaluation, which scores the results. Each is a separate product, with its own concepts, its own documentation, and often its own vendor. Writing the agent takes an afternoon. Learning the stack takes a quarter.

## What a production agent stack costs

On the most popular stack, a production agent means five separate products to learn and run. LangChain is the reasonable default and the most-used option in the space, so it makes the fairest example. To take an agent from prototype to something you would run in production, you assemble the following:

| Layer | What you use | Who makes it | What you have to learn |
| --- | --- | --- | --- |
| Build | LangChain | LangChain Inc. | Tools, models, `create_agent` |
| Orchestrate | LangGraph | LangChain Inc. | Nodes, edges, state, checkpoints, interrupts |
| Observe | LangSmith or Langfuse | LangChain Inc. / Langfuse | SDK wiring and a hosted platform, or OpenTelemetry plus self-hosting |
| Evaluate | LangSmith evals or Langfuse evals | same | Datasets, judges, experiment configuration |
| Deploy | LangGraph Platform | LangChain Inc. | Yet another deployment model |

Every one of these is a good product. That is not the problem. The problem is that they are five products.

The observability row costs the most, because it is a fork in the road rather than a step. LangSmith is LangChain's own commercial platform with native integration. It is the easiest choice if you already use the stack, and it leaves you dependent on a managed SaaS. [Langfuse](https://github.com/langfuse/langfuse) is the open-source alternative: MIT-licensed apart from its enterprise folders, framework-agnostic, self-hostable with Docker or Kubernetes, and maintained by a team that joined ClickHouse in January 2026. In our judgment it is genuinely excellent. It is also a second vendor, a second data model, and a service you now operate.

So before your agent does anything useful in production, someone on your team has learned two libraries, wired up a tracing SDK, stood up or subscribed to an observability platform, and built an evaluation dataset by hand. When the agent underperforms, the same person reads the traces and tunes the prompts, because nothing in this stack does that part for you.

## The field as of July 2026

The table compares five representative options that span the design space, with PenguinHarness in the last row. All figures were checked on 2026-07-22.

| Tool | License | ★ | Min. code | UI / CLI / server | Observability | Evaluation |
| --- | --- | ---: | --- | --- | --- | --- |
| LangChain + LangGraph | MIT | 142k / 38k | ~15 lines | — / — / Platform | LangSmith (SaaS) or Langfuse | LangSmith or Langfuse |
| CrewAI | MIT | 56k | ~55 lines, 5 files | — / scaffold / — | `verbose` logging | — |
| OpenAI Agents SDK | MIT | 28k | ~27 lines | — / — / — | OpenAI Dashboard | — |
| Google ADK | Apache-2.0 | 21k | ~8 lines | `adk web` / `adk run` / `adk api_server` | — | Built in, and deep |
| Dify | Modified Apache-2.0 | 150k | 0 | Yes / Yes / REST | — | — |
| PenguinHarness | Apache-2.0 | — | 0 | Yes / Yes / Yes | Built in (Trace) | Built in |

Line counts come from each project's official quickstart and are not perfectly comparable. A dash (—) means *not documented in the sources we checked*, not *impossible*.

Licensing needs a note, because "open source" is doing heavy lifting in this market. Dify ships under a *modified* Apache 2.0 license that forbids multi-tenant SaaS resale and forbids removing its branding from the frontend. n8n, the most-starred project in the space at 197k stars, uses the Sustainable Use License and is not open source at all. PenguinHarness is plain Apache-2.0.

## The field is moving toward thin harnesses

The strongest arguments against heavy agent frameworks now come from the vendors themselves.

Anthropic's engineering guidance, still its canonical reference, says:

> "the most successful implementations weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns."

The same guide warns that frameworks often add layers of abstraction that obscure the underlying prompts and responses, which makes agents harder to debug.

Microsoft's own Agent Framework documentation opens with a line most vendors would not print:

> "If you can write a function to handle the task, do that instead of using an AI agent."

AutoGen, still the most-starred multi-agent framework at 60k stars, now begins its README with:

> "AutoGen is now in maintenance mode. It will not receive new features or enhancements and is community managed going forward."

LangChain itself moved its legacy chains, retrievers, and hub module into a separate `langchain-classic` package, to keep the core "lean and focused." Meanwhile, "harness" became the industry's word. Within roughly two months, AWS renamed its agent repo to `harness-sdk`, Microsoft shipped a Harness tier in Agent Framework, and Anthropic published *"A harness for every task."*

The category is not dying. It is admitting that the abstractions were never the valuable part, which makes the assembly cost described above even harder to justify.

## What PenguinHarness removes and automates

PenguinHarness does not answer with a thinner framework. It removes the assembly step, and then it automates the tuning loop.

### One install covers the five layers

One install gives you all five rows of the first table, sharing one data directory and one message protocol:

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # http://127.0.0.1:7364 — first login: admin / penguin-2026, shown on the login page
```

The install includes chat with multiple Sessions, agent and Skill management, model configuration, usage and cost statistics, Trace observability, and an **Evaluation Center**, all wired together. There is nothing to subscribe to and nothing to self-host separately. Every request, tool call, and approval decision is already recorded, and a Session restores completely from its Trace. There is no tracing SDK to install, because there is no seam between products to instrument.

### Zero lines, not fewer lines

Running an agent needs no project, no imports, and no framework:

```bash
penguin run -m "Analyze data.csv and summarize quarterly sales"
```

The same engine drives the REPL (`penguin chat`), a headless server (`penguin server`), and the Web App.

### An agent builds the agent

You describe what you want. An agent writes the new agent's `AGENTS.md`, installs the Skills it needs, and hands you something that runs. One sentence produced a complete RAG application, with ingestion, retrieval, cited sources, and a web UI, for $0.02 of Tokens on DeepSeek V4 Pro. The [runnable example](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent) is an 82-line script that builds a new agent from a plain-language requirement and then runs it.

This works because **agents are editable data, not hardcoded constants**: prompts, Skills, and configuration are plain files on disk.

### The tuning loop is automated too

This answers the last step of the LangChain example, where a person reads the traces and tunes the prompts. Built-in Skills for Benchmark design, evaluation, and optimization let the agent score its own output, find where it lost points, and ship version N+1. No round starts until a snapshot of the current version exists, and every request can be replayed in the Trace view.

On other stacks, *you* are the optimizer: you read the traces, tune the prompts, and rerun the evals. Here that loop is the agent's job, so you do not have to learn to be good at it.

### The controls are still there

Removing the assembly step does not remove oversight. Every tool call gets exactly one approval decision, in one of four modes: `allow-all`, `deny-all`, `read-only`, or `always-ask`. Each decision is audited in the Trace. PenguinHarness runs fully locally on as little as a single CPU, and reaches 1000+ models through any OpenAI-protocol endpoint.

## When not to use PenguinHarness

A comparison in which one option wins every row is an advertisement, not an analysis. In two cases, you should pick something else:

- **Python shops.** The PenguinHarness SDK is TypeScript. The CLI and server are language-agnostic, but if your team works in Python and wants to extend agents by subclassing framework classes, most of the options above will fit better.
- **Deep cloud integration.** If you are already all-in on Azure, Microsoft Agent Framework is the path of least resistance. On Vertex, ADK is.

## Conclusion

Building an agent is no longer the hard part; assembling and learning the stack around it still is. On the most popular option, that stack means two libraries, an observability platform from a first or third party, an evaluation harness, and a person who becomes the optimization loop. When you compare toolkits, count that whole stack, not the quickstart's line count.

PenguinHarness collapses those layers into one install and hands the optimization loop to the agent. It is not a smaller framework: there is no framework to learn, and an agent writes the agent. For Python-first teams and deep cloud integrations, the alternatives above remain the better choice.

---

- **Docs**: [Quickstart](https://penguin.ooo/docs/quickstart) · [Skills & Plugins](https://penguin.ooo/docs/skills) · [Sessions & Traces](https://penguin.ooo/docs/sessions-and-traces)
- **Community**: [GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**Sources** — figures checked 2026-07-22: [LangChain v1 release notes](https://docs.langchain.com/oss/python/releases/langchain-v1) · [Langfuse](https://github.com/langfuse/langfuse) · [AutoGen README](https://github.com/microsoft/autogen) · [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/) · [Google ADK](https://adk.dev/) · [CrewAI](https://docs.crewai.com/en/quickstart) · [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/quickstart/) · [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE) · [n8n LICENSE](https://github.com/n8n-io/n8n/blob/master/LICENSE.md) · [Anthropic, Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)
