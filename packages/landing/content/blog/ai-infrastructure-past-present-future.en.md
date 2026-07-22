---
title: "AI Infrastructure: Past, Present, and Future"
date: 2026-07-22
category: practice
excerpt: For thirty years we built developer infrastructure for human eyes — rendered pages, prose documentation, errors written to be read over coffee. The consumer changed. This is what the evidence shows about how docs, protocols, SDKs and error messages are being rebuilt for agents, what already failed, and the one pattern that keeps winning.
---

Every piece of infrastructure encodes an assumption about who is consuming it. Web pages assumed eyes. Documentation assumed patience and a search box. Error messages assumed someone who could go read the source. SDKs assumed a developer who would learn the object model once and amortize it across a career.

Those assumptions held for thirty years. They are now wrong a large fraction of the time, and the industry has spent the last eighteen months finding out exactly which parts break.

This post walks the shift in three movements — what we built for humans, what is actually being rebuilt right now, and what remains unsolved. Every claim is sourced, and where the evidence is thin or contested, it says so.

## Part I — The past: infrastructure that assumed a human

The clearest measurement of the mismatch is also one of the earliest. In December 2024, Vercel published a month of network data on how AI crawlers actually behave. Two findings have aged into the defining facts of this era:

> "none of the major AI crawlers currently render JavaScript"

They fetch your JavaScript bundles. They do not execute them. A decade of frontend architecture — client-side rendering, hydration, SPA routing — produces, for this consumer, a blank page.

And:

> "ChatGPT spends 34.82% of its fetches on 404 pages"

Claude's crawler was measured at 34.16%. **Roughly a third of agent fetches were pure waste** — following stale links, guessing at URL patterns, hitting redirects that a human would have visually skipped.

That is what infrastructure designed for the wrong consumer looks like: not a hard failure, just a persistent, invisible tax. The site works. It simply does not work for the reader who is actually showing up.

Some sense of scale: in June 2026, Cloudflare CEO Matthew Prince, citing Radar data, said automated requests had overtaken humans on HTML traffic for the first time — bots at 57.5%, humans at 42.5%. That figure comes from a social post rather than a Cloudflare publication, and "HTML traffic" is doing important work in it, so treat the precise number with appropriate caution. The direction, however, is not in dispute, and it arrived years ahead of the same CEO's own public prediction.

## Part II — The present: four fronts under active reconstruction

### 1. Documentation, and the instructive failure of llms.txt

The obvious move was a standard file for machines. **llms.txt** was proposed by Jeremy Howard of Answer.AI in September 2024 — a Markdown index at `/llms.txt`, deliberately echoing `robots.txt`, motivated by context-window economics.

It did not work. Ahrefs studied 137,210 domains and published the results in June 2026:

> "97% of those files received zero traffic in May 2026. Nothing fetched them at all."

> "Zero requests came from AI bots for llms.txt files that don't exist. They never go looking."

Twenty-eight percent of domains had published the file. Almost nothing read it. Of the fetches that did occur, a meaningful share came from the industry auditing itself — GEO tooling and llms.txt checkers.

The lesson is worth sitting with, because it is the opposite of the intuitive one. **Agents did not adopt a new artifact invented for them. They read the normal thing, when the normal thing was machine-shaped.**

Which is precisely what the vendors who succeeded actually shipped. Cloudflare's "Docs for agents" is the most complete published example:

- A **Copy as Markdown** button on every page
- An **`/index.md` suffix** on any URL, returning the Markdown source
- **`Accept: text/markdown`** content negotiation, with **token-count response headers**
- `/llms-full.txt` — "Full content of all documentation in a single file, for offline indexing, bulk vectorization"
- An **MCP server covering over 2,500 API endpoints**

Their stated rationale is the whole thesis in one line: Markdown "reduces wasted tokens (the units of text that AI models process) and produces better results."

Note what this is. Not a new file format — **content negotiation**, an HTTP feature from 1997, finally load-bearing. The MCP specification site goes further and simply addresses the reader directly in the response body: *"Fetch the complete documentation index at: modelcontextprotocol.io/llms.txt — Use this file to discover all available pages before exploring further."* Documentation that talks to its reader, in-band, because it knows the reader is a program.

Meanwhile the convention that did spread was the least technically ambitious one imaginable: **AGENTS.md**, a Markdown file at the repo root. It emerged across Codex, Amp, Jules, Cursor and Factory, reports adoption by **over 60,000 open-source projects**, and is now stewarded by the **Agentic AI Foundation under the Linux Foundation** — formed in December 2025 with AWS, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft and OpenAI, anchored by MCP, goose, and AGENTS.md.

A plain Markdown file in a known location beat a designed standard. That is the pattern.

### 2. The protocol layer grows up

**MCP** was introduced by Anthropic and openly takes its architectural cue from developer tooling:

> "MCP takes some inspiration from the Language Server Protocol, which standardizes how to add support for programming languages across a whole ecosystem of development tools."

The live specification is version 2025-11-25. What is more revealing is the release candidate for 2026-07-28, published in May 2026 — because its changes read less like an AI protocol and more like an infrastructure team hardening a service for scale:

- **The session is gone.** The `initialize`/`initialized` handshake is removed; so is the `Mcp-Session-Id` header. Consequence, in the spec authors' words: *"any MCP request can land on any server instance, and the sticky routing and shared session stores that horizontal deployments needed before are no longer required at the protocol layer."*
- **Routing headers become mandatory** (`Mcp-Method`, `Mcp-Name`), so a load balancer can route without parsing bodies.
- **Caching metadata** (`ttlMs`, `cacheScope`) on list operations.
- **W3C Trace Context** propagation, so agent calls join your existing distributed tracing.
- **Full JSON Schema 2020-12** for tool schemas, and a **formal deprecation policy** with a twelve-month minimum runway.

Statelessness, cache headers, routing, tracing, deprecation guarantees. This is what it looks like when an AI protocol stops being a demo and starts being infrastructure. Alongside it, **A2A** — donated by Google to the Linux Foundation — reached v1.0 with 150+ supporting organizations at its one-year mark.

### 3. The tool interface collapses into code

This is the most important technical finding of the period, and three independent parties reached it within four months.

**Anthropic**, November 2025 — presenting MCP servers as a filesystem of code APIs, one file per tool, so agents load only what they need and filter data in the execution environment rather than through the context window. Measured on their example workflow: **150,000 tokens down to 2,000 — a 98.7% reduction.** Their framing:

> "LLMs are adept at writing code and developers should take advantage of this strength to build agents that interact with MCP servers more efficiently."

**Cloudflare**, February 2026 — the same insight at API scale:

> "agents need many tools to do useful work, yet every tool added fills the model's context window, leaving less room for the actual task."

Their answer collapses thousands of endpoints into **two tools, `search()` and `execute()`, at roughly 1,000 tokens**, with model-written code running in sandboxed isolates. Measured: **a 99.9% reduction in input tokens**, against 1.17 million tokens for the equivalent conventional MCP server.

**The MCP specification itself**, July 2026 — the stateless, code-shaped direction described above.

Put these next to the llms.txt result and the pattern is unmistakable. The interface agents converged on is not a bespoke agent format. It is **code and a filesystem** — the two interfaces that were already machine-shaped, already composable, and already in every model's training data.

We find this vindicating, because it is the bet PenguinHarness was built on: the shell is the universal interface, and skills are files.

### 4. Errors become an interface

The least glamorous front, and possibly the highest-leverage.

Anthropic's guidance on writing tools for agents is explicit that error text is now a machine interface: good errors are **"specific and actionable"** rather than **"opaque error codes or tracebacks,"** and should steer the agent toward a valid next move — suggesting filters or pagination, or supplying a correctly formatted example. The same document notes Claude Code caps tool responses at **25,000 tokens** by default, and that response verbosity is worth making a first-class option.

Stripe supplied the field evidence. Building a benchmark to test whether agents could produce real Stripe integrations, they found a failure mode that should worry anyone shipping an API:

> Agents "would pass in nonexistent Stripe data, observe 400s, and consider the task complete."

A correct HTTP 400 — perfectly adequate for a human developer, who would read it and go look — **failed to communicate failure to an agent.** The status code was right and the interface was still broken. Running the benchmark also surfaced real documentation bugs, since fixed: an agent evaluation working as a docs QA harness.

## Part III — The pattern, and what it demands

Strip the four fronts down and one rule survives:

> **Agents do not adopt infrastructure built specially for them. They adopt existing infrastructure that happens to be machine-shaped — and they punish everything that assumed a human.**

llms.txt was designed for agents and went unread. Markdown, HTTP content negotiation, the filesystem, the shell, and a file called AGENTS.md were not designed for agents at all, and won. Meanwhile SPA rendering, prose-only docs, and human-readable-only errors quietly tax every agent that touches them.

That gives four properties to design for. They are the ones we built PenguinHarness around, and they are checkable in our repo rather than asserted here.

**Interface simplicity.** Our SDK has one execution entry point — `session.run()` — that streams every step. A working agent is about ten lines. The engine exposes **six built-in tools**, and none of them are file tools: reading, writing, editing and searching all go through `exec_command`, because the shell is the interface agents already know. Every tool you add is a schema billed on every turn.

**Documentation an agent can consume.** Seventeen bilingual documentation pages, and — more to the point — **Skills**: instruction packages stored as `SKILL.md` files that agents read on demand with a shell command. There is no skill tool. The system prompt carries only a name and a one-line description; the body is loaded when relevant and costs nothing when it is not. That is progressive disclosure, implemented with a filesystem. Two of the shipped skills, `penguin-sdk` and `penguin-cli`, exist specifically to teach an agent how to drive our own SDK and CLI — documentation whose intended reader is a machine.

**Error transparency.** In our engine, **tools never throw into the loop.** Failures — timeouts, non-zero exits, denied approvals — converge into tool output messages the model can read and react to, with the exit code appended *outside* the truncation window so it survives when long output is cut. The server uses a single error shape with a machine-readable `code` alongside human-facing text. This is also why a lean system prompt is safe: when the environment reports its own failures clearly, the prompt does not have to pre-describe them.

**Observability and control.** Every request, tool call, and approval decision is appended to a Trace, and a session restores fully from it. Every tool call gets exactly one approval decision in one of four modes, written to the Trace as an `approval_decision` event. Compaction rotates the trace file, so one file is always exactly one model context.

## Part IV — The future: what is genuinely unsolved

Honest reporting requires naming what does not work yet.

**Identity.** If agents are the majority of traffic, "is this a real user?" stops being answerable by CAPTCHA. **Web Bot Auth** is the live attempt — HTTP Message Signatures per RFC 9421, an IETF draft, Cloudflare's signed-agents launch in August 2025 with OpenAI's ChatGPT agent and Block's goose among the partners. It is drafts and vendor deployments, not yet a settled standard.

**Trust in tool metadata — the important one.** MCP's own specification concedes the problem rather than solving it:

> "descriptions of tool behavior such as annotations should be considered untrusted, unless obtained from a trusted server."

> "MCP itself cannot enforce these security principles at the protocol level."

Peer-reviewed work from March 2026 evaluated seven major MCP clients and identified **tool poisoning — malicious instructions embedded in tool metadata — as the most prevalent and impactful client-side vulnerability**, citing insufficient static validation and parameter visibility. A tool description is a prompt with a professional wrapper, and the ecosystem currently ships thousands of them from strangers. Defenses have been proposed; none are standardized.

This is exactly why we treat approval as load-bearing rather than optional, and why every decision lands in an audit trail.

**Long-running state.** MCP is deleting its session layer while adding a **Tasks** extension where a tool call returns a handle you poll. State is moving above the protocol — which is coherent, but means everyone has to solve durability themselves.

**Payments and agent-to-agent commerce.** AP2 has 60+ supporting organizations per the Linux Foundation. The transaction volumes circulating for agent payment rails come from vendor-adjacent sources we could not verify, so we will not repeat them.

**Governance throughput.** MCP's own 2026 roadmap names the bottleneck: every proposal requires full core-maintainer review regardless of domain. The ecosystem is now larger than its review capacity.

## Closing

The past built for eyes. The present is being rebuilt for programs, and the returns so far come not from inventing agent-native formats but from making ordinary things machine-legible: Markdown over rendered HTML, code over tool sprawl, filesystems over bespoke registries, errors that say what to do next.

The future is mostly a security and identity problem wearing an infrastructure costume.

We think the harness is where this gets decided in practice, because the harness is the last mile — the layer that actually spends the context, reads the errors, and decides what the model sees. Building it as though the consumer is a program, not a person reading a screenshot, is the whole job.

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

---

- **Docs**: [Tools & Approval](https://penguin.ooo/docs/tools) · [The Agent Loop](https://penguin.ooo/docs/agent-loop) · [Skills](https://penguin.ooo/docs/skills) · [Server API](https://penguin.ooo/docs/server-api)
- **Community**: [GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**Sources**: [Vercel, The rise of the AI crawler](https://vercel.com/blog/the-rise-of-the-ai-crawler) · [Ahrefs, llms.txt study](https://ahrefs.com/blog/llmstxt-study/) · [llmstxt.org](https://llmstxt.org/) · [Cloudflare, Docs for agents](https://developers.cloudflare.com/docs-for-agents/) · [Cloudflare, Code Mode](https://blog.cloudflare.com/code-mode-mcp/) · [Cloudflare, signed agents](https://blog.cloudflare.com/signed-agents/) · [MCP specification](https://modelcontextprotocol.io/specification/latest) · [MCP 2026-07-28 release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) · [MCP 2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) · [Linux Foundation, Agentic AI Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) · [Linux Foundation, A2A one-year](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year) · [agents.md](https://agents.md/) · [Anthropic, Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) · [Anthropic, Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Stripe, Can AI agents build real Stripe integrations?](https://stripe.com/blog/can-ai-agents-build-real-stripe-integrations) · [MCP threat modeling (arXiv)](https://arxiv.org/abs/2603.22489)
