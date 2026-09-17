---
title: Key concepts
description: The terms PenguinHarness uses, grouped by topic, each with a link to the page that covers it in depth.
---

PenguinHarness uses a small set of terms with specific meanings. This page defines them, grouped by topic, and each entry links to the page that covers the term in depth.

- [How work is organized](#how-work-is-organized): Project, agent, Agent State, Workspace, data root
- [How work runs](#how-work-runs): Session, Task, Trace, OmniMessage, approval mode, subagent
- [What an agent can use](#what-an-agent-can-use): tools, Skill, plugin, hook package, MCP server, memory, Vault, scheduled task
- [How agents improve](#how-agents-improve): Benchmark, case, evaluation, optimization, version, snapshot
- [Models](#models): provider, model, thinking level, Token
- [Company mode](#company-mode): organization, employee, desk session, ticket, channel

## How work is organized

### Project

A Project is the top-level unit that groups agents. It holds the model table and credentials its agents use, and its Benchmarks. Every user starts with an initial Project and can create more, and several users can share a Project.

See [Web App](/web-app).

### Agent

An agent carries out the goals you give it. Each agent has its own Agent State and can run many times, each time in a Workspace. An agent is not tied to a model: you choose the model when you start a Session.

See [Agents](/agents).

### Agent State

Agent State is an agent's persistent directory, `agent_state/`. It holds the agent's configuration (`system_config.yaml`), its editable prompt file `AGENTS.md`, tool and MCP server settings, Skills, hook packages, memory, Vault and scheduled tasks. An agent's behavior lives entirely in these files: you can change it by editing them, and so can another agent.

See [Configuration Reference](/configuration).

### Workspace

A Workspace is the directory an agent works in during a Session: the files it reads, creates and changes. You choose the Workspace when you start a Session. If you don't, PenguinHarness creates a temporary Workspace inside the agent's directory.

See [Sessions & Traces](/sessions-and-traces#run-model).

### Data root

The data root is the directory where PenguinHarness keeps Projects, agents, model settings and Traces. It is `~/.penguin/data` by default (`%USERPROFILE%\.penguin\data` on Windows), and the desktop app, the CLI and the SDK on one machine all use it. Set `PENGUIN_HOME` to use another directory.

See [Quickstart](/quickstart).

## How work runs

### Session

A Session is one continuous conversation with an agent in one Workspace. You can send many prompts in a Session, and each prompt starts a Task. The model and the Workspace are fixed when the Session is created; in the Web App, a Session is a conversation.

See [Conversations](/chat).

### Task

A Task is the work one prompt starts. The agent calls the model one or more times, one request per call, and runs tools in between. The Task ends when the model replies without calling a tool, or when the run is cut off, for example because you stopped it.

See [The Agent Loop](/agent-loop).

### Trace

A Trace is the record of a Session: every message, tool call, approval decision and Token usage, appended in order to JSON Lines files. PenguinHarness restores a Session from its Trace, and the usage and cost figures come from the same records.

See [Sessions & Traces](/sessions-and-traces).

### OmniMessage

OmniMessage is the single message format PenguinHarness uses everywhere: the SDK streams it, the Trace stores it, and the engine works with it internally. Marketing materials also call it Penguin Message; the documentation uses OmniMessage.

See [The OmniMessage Protocol](/omni-message).

### Approval mode

Every tool call is allowed or denied before it runs, and the approval mode decides how. There are four modes: `allow-all`, `deny-all`, `read-only` (read-only tools run, the rest wait for you) and `always-ask`. You set the mode for each Session.

See [Tools & Approval](/tools#approval).

### Subagent

A subagent is a child agent that an agent starts with the `run_subagent` tool to handle a self-contained subtask in the same Workspace. It runs in a Session of its own, with its own Trace, and returns its final answer to the agent that started it.

See [Tools & Approval](/tools#subagents).

## What an agent can use

### Tools

Tools are the actions an agent can take. The built-in tools run shell commands (`exec_command`, `input_command`), read and edit files (`read_file`, `edit_file`, `write_file`), and delegate work to subagents (`run_subagent`, `input_subagent`).

See [Tools & Approval](/tools).

### Skill

A Skill is a set of reusable instructions: a directory with a `SKILL.md` file and any files it references. The system prompt lists only the name and description of each installed Skill, and the agent reads the full `SKILL.md` when a task calls for it.

See [Skills & Plugins](/skills).

### Plugin

A plugin is what the plugin library installs. It ships Skills, a hook package, or both, and installing it on an agent puts them into that agent's Agent State. A server plugin is a different kind: an npm package of server modules, such as a sandbox backend, that a Project asks the server to run.

See [Skills & Plugins](/skills).

### Hook package

A hook package is a set of scripts that PenguinHarness runs at fixed points of the agent loop: when a prompt is submitted, before each tool call is approved, and when a Task ends. A hook can, for example, deny a tool call or start another Task to keep the agent working.

See [Skills & Plugins](/skills#hook-packages).

### MCP server

An MCP server is a program or service that offers tools through the Model Context Protocol. The tools it offers join the agent's toolset and go through the same approval as the built-in tools.

See [Tools & Approval](/tools#mcp-servers).

### Memory

Memory is what an agent remembers between Sessions, such as your preferences and decisions about a project. It is kept as Markdown files in the agent's Agent State: one user scope that every Session reads, and one scope for each Workspace. Agents never share memory.

See [Configuration Reference](/configuration#memory).

### Vault

The Vault holds an agent's secrets as environment variables. The values reach only the processes the agent's tools start, never the model or the Trace; the model sees at most the key names.

See [Configuration Reference](/configuration#vault).

### Scheduled task

A scheduled task sends a prompt to an agent at set times, either into an existing Session or into a new Session each time. Scheduled tasks run only while the server is running.

See [Scheduled tasks](/schedules).

## How agents improve

### Benchmark

A Benchmark is a set of cases that measures how well an agent handles a kind of work. It belongs to the Project, not to one agent, so it can evaluate any agent in the Project.

See [Evaluation Center](/evaluation-center).

### Case

A case is one test in a Benchmark. It has a statement, which the agent under test receives, and a private rubric used for scoring, which that agent never sees. Every run of a case is scored out of 100.

See [Self-Improvement](/self-improvement#benchmark-storage).

### Evaluation

An evaluation runs an agent through every case of a Benchmark, a set number of times per case, and records the scores, cost and duration on the Benchmark's scoreboard. Scores are comparable only when the agent, the model and the thinking level are the same.

See [Evaluation Center](/evaluation-center).

### Optimization

Optimization improves an agent from its evaluation results. An optimizer agent edits the agent's `AGENTS.md`, Skills and configuration, evaluates the change, and keeps it only when the score strictly improves; otherwise it rolls the change back.

See [Self-Improvement](/self-improvement).

### Version

An agent's version is a number in its `system_config.yaml`. It increases each time an optimization is kept.

See [Self-Improvement](/self-improvement#snapshots-and-versions).

### Snapshot

A snapshot is a packed copy of one version of an agent's Agent State, saved as `snapshots/v<version>.tar.gz` without the Vault. Before optimization changes an agent, it makes sure a snapshot of the current version exists. You can export and import snapshots, and create a new agent from an exported one.

See [Self-Improvement](/self-improvement#snapshots-and-versions).

## Models

### Provider

A provider is a named group of models in the Project's model table, such as `deepseek`, `anthropic` or the `tokendance` gateway. PenguinHarness includes built-in groups, and you can add your own.

See [Models & Providers](/models).

### Model

A model is always identified by the pair `(provider, model_id)`: its provider group and its id at that provider. PenguinHarness never guesses the provider from the id. Each Project has a default model, and you pick the model when you start a Session.

See [Models & Providers](/models).

### Thinking level

The thinking level sets how much a model reasons before it answers: `none`, `low`, `medium`, `high`, `xhigh` or `max`. Each agent has a default level, `medium` unless you change it, and you can pick another level inside a Session.

See [Models & Providers](/models).

### Token

A Token is the unit a model counts text in. Usage and cost are measured in Tokens, and the Cost Center reports them by agent, model and time range.

See [Cost Center](/usage).

## Company mode

Company mode is a beta work mode of the Web App in which a Project's agents run as a company. It is off until an admin turns it on in **System settings**.

### Organization

An organization is one company: a mission, its employees, and the calendar, tickets, channels and shared workspace they work with. It belongs to a Project, and one Project can hold several organizations that cannot see each other.

See [Company Mode](/company-mode).

### Employee

An employee is an agent hired into an organization, with a title, duties and a manager it reports to. Employees form a reporting tree with the CEO at the root.

See [Company Mode](/company-mode).

### Desk session

Each employee has one desk session, a standing Session in the organization. Calendar events, @mentions in channels and messages from people reach the employee there. The desk session plans the work and starts ticket sessions to do it.

See [Company Mode](/company-mode).

### Ticket

A ticket is a unit of the organization's work, kept as a Markdown file on the board. It moves through the board's columns from proposed to done or rejected, and one or more ticket sessions work on it.

See [Company Mode](/company-mode).

### Channel

A channel is a message stream inside an organization, where people and employees talk. A message reaches an employee only when it @mentions that employee or @all. Every organization has an all-hands channel that everyone is in.

See [Company Mode](/company-mode).
