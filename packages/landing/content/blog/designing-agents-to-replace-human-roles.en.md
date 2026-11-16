---
title: "Designing Agents Is Thinking About How to Absorb the Human Role"
date: 2026-11-09
category: perspectives
author: 南冥有一鱼 (PrismShadow AI)
excerpt: "What DeepSeek's Super-agent architecture reveals about where agent systems are heading: event-driven triggers, a two-tier Router/Worker architecture, and an external Watchdog Agent take over the human runtime work of triage, session routing, and babysitting, while PenguinHarness pushes the same principle into evaluation and tuning for agent self-evolution."
---

The DeepSeek team recently shared their internal exploration of a **Super-agent** architecture. Many teams building agents have experimented with similar individual pieces, yet seeing the full design assembled in one place makes the broader trajectory of agent systems unmistakable.

Single-task coding agents are already strong enough today: writing code and running tests has become increasingly autonomous, without needing a human watching every step. What bottlenecks running many agents in parallel is no longer the model's execution ability, but **human attention** — one person can stay focused on at most three to five agents at a time, and cannot keep switching across a dozen chat windows to issue prompts.

So when we design agent systems today, there are broadly two directions: **one direction is to make human-agent interaction more efficient; the other is to progressively absorb the parts of the workflow still handled by humans.**

The first direction builds intuitive dashboards or visual plugins around agent runs and outputs — such as PenguinHarness's **Agent Workbenches** (like data dashboards and ticket boards) and **A2UI visual blocks**, turning walls of chat text into at-a-glance charts and status panels to reduce the attention a person spends on any single task.

Super-agent takes the second direction: **it adds a system layer directly above the working agents**, taking over information intake, task routing, and anomaly recovery that people previously did by hand. Specifically, three parts of its design stand out:

<figure class="post-figure" data-widget="super-agent-architecture"><ol class="fig-steps"><li>Event-Driven: listens to group chat and GitHub streams with a two-tier filter (code rules + LLM), silently reproducing bugs in the background and opening PRs when a fix works</li><li>Two-Tier Architecture: an always-on upper Router maintains global context and dispatches tasks to isolated lower-layer Workers running concurrently</li><li>Watchdog Loop: an external timer-driven Watchdog Agent inspects each Worker's semantic progress, detects dead loops or goal drift, and steps in to recover</li></ol><figcaption>The three core mechanisms of Super-agent: event-driven triggers, a two-tier Router/Worker architecture, and an external Watchdog take over the human runtime loop.</figcaption></figure>

## 1. Event-Driven Triggers: Replacing Manual Triage by PMs and QA

Traditional agents are human-driven: a person sends a task prompt, the agent executes it, and if nobody sends a prompt, the agent simply waits.

Think about how software iteration used to work: a user posts a suggestion or bug report in a group chat -> a product manager or QA engineer spots it -> filters out the surrounding chatter -> tries to reproduce the issue -> files a ticket for a developer once confirmed -> and the developer finally opens an agent window to fix the code. Across that chain, PMs, QA, and developers act as the filter and trigger driving the agent.

Super-agent's first move is to take over this entire intake step through **event-driven execution**. It stays resident in work chats and GitHub, listening to every message event (Trigger), and applies two practical engineering choices:

1. **A two-tier filter combining code rules and models**: Most messages in a work group are everyday chatter. Calling a large model on every single message to decide whether to act would blow up both compute cost and latency. Instead, a fast path of deterministic code rules (allowlists, keywords, and event filters) screens out most irrelevant noise first, passing only candidate messages to the LLM for semantic judgment.
2. **Proactive reproduction and silent attempts**: When someone reports a bug in a group chat — while people are still debating how to fix it, and **even when nobody `@`-mentions the agent** — Super-agent has already spun up a background task to reproduce the bug and draft a fix on its own.
   - If it fails to reproduce the issue or finds the fix too complex, it quietly discards the attempt in the background without interrupting the group;
   - Once it reproduces the bug and verifies a working fix, it posts the ready-made Pull Request straight back to the chat.

What used to require product collection, QA reproduction, and initial developer triage is absorbed directly by the event-driven trigger layer.

## 2. Two-Tier Architecture: Replacing Manual Multi-Window Management and Task Dispatch

When developers want to move faster, the most natural habit is to **run many tasks in parallel** — opening many context windows (Sessions) at once. Because human attention is finite, opening too many windows quickly becomes unmanageable, and you lose track of which window reached which step. People end up stuffing related tasks into the same session, while deciding which task goes to which window and syncing context between group chats and GitHub remains entirely manual.

Consider a shared team chat: incoming feedback spans completely different areas — some messages are frontend polish, others are backend bugs. Running everything inside a single agent window breaks down for two reasons:

- First, a single window executes serially: while a slow task is still running, the next issue has to wait in line;
- Second, mixing unrelated domains in one context causes cross-task interference, and specialized tasks are better handled by specialized agents rather than a single generalist session.

What if **"opening windows, tracking context, and dispatching tasks"** were handed over to a dedicated **Router** as well? That is the core of Super-agent's **two-tier architecture**:

- **The upper tier is a resident Router layer**: It does not execute concrete coding tasks (and may not even be given code-execution tools), so it can run on a lighter, faster model. Its sole job is to maintain global context, interact with people, and dispatch concrete tasks downward.
- **The lower tier is an isolated Worker layer**: Whenever an independent task arrives, the Router spawns a context-isolated Worker (equipped with the strongest model and the full toolchain) to execute concurrently. Workers never talk directly to users; when finished, they report their results back to the Router, which delivers a unified reply.

With this split, users no longer juggle multiple underlying Session windows by hand — task routing and concurrency are managed entirely by the system.

## 3. Watchdog Agent: Replacing Developer Babysitting and Anomaly Recovery

Of course, any long-running agent system will eventually run into trouble, such as getting stuck.

When a traditional program fails, a process crashes or an API returns an error, and a monitoring script can simply restart it. **When an agent system gets stuck, however, the process is usually still alive — the model is trapped in a dead loop** (such as repeatedly editing the same error back and forth) or has drifted away from the original goal during execution.

Previously, catching and fixing this required a developer to inspect logs by hand, halt the run, and steer the agent back on track.

Super-agent addresses this by placing a separate **Watchdog Agent** outside the main system, driven by scheduled timer messages. Beyond handling basic infrastructure failures like API errors or failed state recovery, the Watchdog is itself an agent: **it periodically inspects the execution state of every Worker, using a model to judge whether a task is making substantive progress or drifting off course**, and intervenes automatically when it spots an anomaly. Maintainers can even ask the Watchdog in natural language why a failure happened, or have it update the main system's prompts and trigger rules online.

## 4. As Models Grow Smarter, Designing Agents Means Absorbing What Humans Still Do

In the past, designing an agent meant designing a tool to assist a human — because models were not yet capable enough, single-task runs frequently went off the rails, and a person had to stay in the middle watching every step. As model capabilities continue to rise, people can hand progressively higher-level operations over to agents.

Looking ahead, a practical mental model for designing more advanced agent systems is simple: **look at what parts of the existing workflow still require a human, and ask yourself — can the step a person still does by hand today be absorbed by adding another agent layer above it?**

<figure class="post-figure" data-widget="agent-takeover-evolution"><ol class="fig-steps"><li>Stage 1: Human-Led</li><li>Stage 2: Human-Led, Agent-Assisted</li><li>Stage 3: Agent-Led, Agent-Assisted</li></ol><figcaption>From Human-Led, to Human-Led and Agent-Assisted, to Agent-Led and Agent-Assisted.</figcaption></figure>

Take that thought one step further: Super-agent replaces the human who issues prompts, manages windows, and babysits anomalies during the **runtime phase**, yet in the **evaluation and tuning phase**, teams previously still relied on people doing the work by hand.

That is the exact layer **PenguinHarness** is built to take over: it lets agents autonomously run benchmarks, inspect execution traces to diagnose failure modes, and refine prompts and Skills on their own. When those remaining human responsibilities are handed over to agents as well, the system closes the loop on agent self-evolution.
