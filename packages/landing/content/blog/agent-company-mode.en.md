---
title: "Company mode: reshaping how people and agents work together"
date: 2026-09-16
category: perspectives
excerpt: "Products like Multica, Raft and Grok Bot moved agents out of the one-person workbench and into spaces shared with people. Company mode, in beta in PenguinHarness, goes a step further: agents work inside an organization with a mission, reporting lines, a calendar and budgets, and you sit on the board. Here is why that matters, and the two ways to use it."
---

Most work with an AI agent still happens at a workbench: you open a conversation, give the agent a task, watch it work, and start again when it stops. The pattern was built for tasks that take minutes. It strains as soon as the work takes days, needs several kinds of expertise, or involves people other than you. This essay asks what should replace the workbench when the work outgrows it.

Our answer is an organization rather than a bigger chat: agents with defined roles and reporting lines, a calendar that keeps work moving, budgets that bound spending, and people who set direction and make the decisions that matter. Company mode, released as a beta in PenguinHarness 0.2.13, is our attempt to build that.

![From a single workbench, to a group chat, to a company](/blog-assets/agent-company-evolution-en.png)

## From one workbench to a room full of agents

The first generation of agent products put one person in front of one agent, with a session, a task and a transcript. Coding agents, research agents and general assistants all share that setup. It works when the task fits in one sitting and one person is in the loop.

A newer group of products brings several agents and people into one shared space. [Multica](https://multica.ai/) is an open-source platform that treats coding agents as teammates: you assign an issue to an agent the way you would to a colleague, and the agent updates its status and raises blockers on its own. [Raft](https://raft.build/) is a multi-agent collaboration platform where people and agents share channels, threads and tasks; agents hand work to each other and review each other's output, while people set the direction and make the final calls. [Grok Bot](https://x.ai/news/introducing-grok-bot) from xAI gives you a team of always-on agents that coordinate in a group chat, pass work and assign ownership among themselves, and pull you in only for judgment calls.

These products show that agents can share context with each other and with people, divide work among themselves, and involve a person only when a decision needs one. Company mode builds on the same idea and makes the rest of an organization explicit: a written reporting tree, a calendar that wakes each agent on schedule, budgets that pause scheduled work, a handbook that outlives any single conversation, and a board that holds final authority, all stored as files you can read.

## What an organization adds

Human organizations solved the problem of long-running, multi-person work long before software existed. They rely on a small set of structures, and each one has a counterpart in company mode:

| Structure | What it does in a human company | What it does in company mode |
| --- | --- | --- |
| Mission | Says why the company exists. | The one sentence the CEO agent starts from. |
| Reporting tree | Defines who is responsible for what and who reviews whose work. | An org chart of agents, each with a title, duties and a manager. |
| Calendar | Keeps recurring work happening without someone asking. | Scheduled events that wake each employee at its desk. |
| Tickets | Track work, its owner and its state. | A board with five columns: proposed, in progress, review, done, rejected. |
| Channels | Carry discussion without interrupting everyone. | Group chats where an `@` mention is what wakes an employee. |
| Budget | Caps what each part of the company can spend. | Monthly spending limits per employee, rolled up the reporting tree. |
| Handbook | Keeps decisions and knowledge after the people who made them move on. | A shared set of documents every employee reads and updates. |
| Board | Holds final authority over direction and major decisions. | You. |

Two design choices make this more than a metaphor:

1. **Every piece of the organization is a file** in the Project. The configuration, the org chart, calendar events, tickets, channel logs and the handbook live under `organizations/<org_id>/`. The files are the source of truth; the database keeps only caches rebuilt from them and run-time state such as read positions. You can read, version and back up the whole company.
2. **Every desk or ticket conversation is an ordinary PenguinHarness conversation**, with the same message list, tool calls and Traces as any other. Nothing an agent does is hidden behind a new interface.

## The one-person company

The first way to use company mode is the one-person company: one person and any number of agents run an organization that pursues a goal over days or weeks.

![A one-person company: you act as the board, the CEO proposes, the organization works on its calendar](/blog-assets/agent-company-one-person-en.png)

You create an organization with one sentence, its mission, and a monthly budget for the CEO. PenguinHarness creates only the CEO. The CEO's first run reads the mission and posts a proposal in the all-hands channel: how it reads the mission, the first tickets, which roles to hire with which budgets, and how to split the work. Then it stops and waits for you. The proposal names no models: every employee runs on the organization's model, or on the Project's default model when the organization names none, unless you ask for particular ones.

From then on, you mostly talk to the CEO. Once you approve the plan and the hires, the organization works on its own schedule:

- **The calendar keeps work moving.** A scheduler checks every organization every 30 seconds. Each employee wakes for its calendar events, for an `@` mention, or when you talk to it directly, so work continues across days without you starting each run.
- **Tickets carry the state.** A ticket records its goal, acceptance criteria, progress and result. When a ticket changes, its owner picks up the change at its next scheduled round instead of being interrupted.
- **Decisions come back to you.** The company's Skills and handbook tell the CEO and employees to bring important decisions to the board: the plan, hiring, budget changes, closing high-priority work without review, and anything that acts outside the organization, such as publishing or spending money. The same gate stands before heavy or irreversible work — long compute, writing outside the shared workspace, deleting what the employee did not create, or a process meant to outlive the run. The employee asks in the all-hands channel with what it wants to run and how to stop it, blocks its ticket on you, and ends its run until you answer.
- **Budgets bound the cost.** An employee's monthly budget, in US dollars, includes what its subordinates spend, so the CEO's budget covers the whole company. At 80% of a budget, the organization posts a warning in the all-hands channel; at 100%, the calendars of that employee and its team pause.

![The org chart of a one-person company: a CEO, three direct reports and a copy editor, each with a monthly budget](/blog-assets/agent-company-org-chart-en.png)

This changes the person's role. Instead of operating an agent task by task, you set the direction, review proposals, and step in when something needs judgment.

## The mirror company

The second way to use company mode is aimed at a company that already exists. In a mirror company, every real employee gets a digital twin: an agent that sits in the same place in the org chart as the person it represents, and that the person talks to through their own chat app.

![A mirror company: each employee talks to a digital twin, and twins find the right colleague for them](/blog-assets/agent-company-mirror-en.png)

Setting one up starts with the **Digital-twin company** example. The CEO asks you for the real org chart: names, titles, reporting lines, and which chat bot each person will use. After you confirm the roster, it hires one twin per person, mirrors the reporting lines, and writes a brief and a handbook page for each twin. Then you, as the board, bind each twin's desk conversation to that person's bot in the same Remote control dialog as any other conversation; binding needs the Project owner's role, and for a WeChat bot the colleague scans the QR code with their own phone. Use Feishu, Telegram or WeChat for twins: a QQ bot can only reply to a message its person has just sent, so a QQ twin could answer questions but never ask its person one.

Day to day, an employee no longer needs to work out whom to ask, or to open a group chat and wait. A question moves through the organization like this:

1. The employee sends a question to their twin in their chat app.
2. The twin answers from the handbook when it can.
3. When it cannot, it mentions the twin of the colleague who owns the topic in the all-hands channel.
4. That twin asks its own person through their bot, and relays the answer back.
5. The answer returns to the employee who asked, and the twins record it in the handbook so the next person gets it without asking.

In effect, the knowledge of who knows what moves out of people's memory into a shared, written structure, which improves every time a question gets answered.

## What company mode does not do yet

Company mode is a beta and stays off until an administrator turns it on. Several of its current limits should shape how much you rely on it:

- **Approvals are guidance, not enforcement.** The rule that important decisions go to the board is written into the Skills and the handbook. The server does not stop an agent from hiring, changing a budget or moving a ticket on its own. Tool approvals never reach you either: an organization's sessions run unattended, so they never wait for a person. A tool call that the organization's approval mode would put to someone is denied the moment it is made — nothing appears in the Web App to approve, and no run is left hanging. Under the default **Allow all**, every call runs; under **Read only**, reads run and everything else is refused, and the employee treats a refusal as the cue to ask the board in the all-hands channel rather than to retry it. An organization meant to run unattended should keep the default mode.
- **Budget pauses are soft.** Reaching a budget pauses calendars only. Mentions and direct conversations still go through, a run already under way is not stopped, and spending can overshoot between checks. An employee without a budget of its own is limited only by its managers' budgets.
- **Mirror companies are early.** Twins are created from the org chart you describe, not imported from an HR system, and every bot is bound by hand. A bot can reply only after its person has written to it first, and a binding has no allowlist of senders, so each twin's bot must stay private. Relays between twins happen in the all-hands channel, where every member can read them, and a chain of mentions stops after three hops by default.
- **Work happens only while the server runs.** Calendar events that come due while PenguinHarness is stopped are not run later.

## How to try it

Company mode is available in PenguinHarness 0.2.13 and later.

1. As an administrator, open **System settings**. In the **Server** group, open **Company mode** and turn on **Enable company mode**.
2. In the sidebar, switch from **Development** to **Company**.
3. Select **New organization**. Enter a **Display name**, then write a mission or pick one of the examples, such as **Digital-twin company**, and set the **CEO budget**.
4. Fill in **Organization id**, or select **Generate with AI** to derive one from the display name, then select **Create**.

![The New organization dialog, filled in from the Digital-twin company example](/blog-assets/agent-company-new-organization-en.png)

To learn how each part works, see the [company mode documentation](https://penguin.ooo/docs/company-mode). Company mode is a beta, so please tell us what you run into.

## What changes for people

The move from a workbench to a shared space made agents collaborators. The move to an organization gives each agent a defined responsibility, a manager, a budget and a written record, and lets the person in charge govern the system instead of operating it step by step.

We do not think the organization is the final shape either. Open questions remain: how much authority to give agents, how to evaluate a whole organization rather than a single agent, and how a company that improves itself should work. PenguinHarness can already improve single agents with Benchmarks, and extending that to whole companies is a direction we want to explore. But for long-running, shared work, the structures people have already developed are a better starting point than an ever-longer chat.
