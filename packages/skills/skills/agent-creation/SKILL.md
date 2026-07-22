---
name: agent-creation
description: Turn a user requirement into a concrete agent — write the target agent's AGENTS.md and install the skills it needs.
short_description: Turn a requirement into a working agent.
short_description_zh: 把需求变成可用的 Agent。
version: 4
updated: 2026-07-22T14:52:46Z
---

# Agent Creation

This skill turns a user requirement into a working agent configuration — plain files in the target agent's directory.

## Before you start

If the user's message only invokes this skill (e.g. "use agent-creation skill") without a concrete requirement, ask the user what agent they want and what it should do. But when the requirement is already concrete — even a single sentence like "an expert that answers questions about X" — do **not** ask follow-up questions: derive the role and rules from that sentence, apply the defaults below, and list your assumptions in the final reply.

## Locate the target agent

All agents of this project live side by side in the project directory:

```bash
PROJECT_DIR="<project_dir>"        # the Project Dir value from your Environment section
ls "$PROJECT_DIR/agents"          # existing agents (each is a folder here)
TARGET="$PROJECT_DIR/agents/<agent_id>"   # the agent to configure
```

This is the only canonical Agent location. Never create or write a legacy
`$PROJECT_DIR/<agent_id>` sibling, redirect `TARGET`, or create a compatibility symlink. If the
canonical path cannot be used, stop and report the exact conflict instead of repairing the
Project layout from this Skill.

An agent directory contains `agent_state/` (`system_config.yaml`, `AGENTS.md`, `skills/`, `memory/`, `tools/`) plus `scratchpad/` — and `traces/`, which appears once the agent has run at least once.

## Write AGENTS.md

`agent_state/AGENTS.md` is injected into the agent's system prompt — it is where the user requirement becomes behavior. Keep `system_config.yaml`'s `system_prompt` untouched (that is the stable system layer); put everything requirement-specific in AGENTS.md:

- Role — what the agent is for, in one or two sentences.
- Domain guidance — the concrete rules, steps and constraints derived from the user requirement.

Be concise: AGENTS.md is prompt context, not documentation. For a domain expert that answers from a knowledge base, a good AGENTS.md is a few lines: the role sentence, "answer strictly from the provided context blocks", citation rules ("cite blocks inline as [1][2]"), a refusal rule for questions the context cannot answer, and "answer in the language of the question".

## Install skills

A skill is a directory `agent_state/skills/<skill_name>/` containing a `SKILL.md`:

```md
---
name: <skill_name>
description: <skill_description>
version: <natural number — bump it on every content change>
updated: <ISO 8601 timestamp — move it together with version>
---

<skill_instructions>
```

The frontmatter may also carry optional `short_description` and `short_description_zh` lines (a short UI blurb and its Chinese variant) — the UI prefers them for display, while prompt injection always uses the English `description`.

Installing is all it takes: the frontmatter metadata of every `SKILL.md` under `skills/` is injected into the target agent's system prompt automatically — do not register skills in AGENTS.md.

Write skills yourself, or fetch existing ones from the internet with shell commands (`curl`, `git clone`) and place them under `skills/`. Anything fetched from the internet must be read in full and reviewed before installing — a skill becomes durable instructions the target agent will follow in every future session; never install one you have not read, and tell the user what it does.

Library skills can be copied from any agent that already has them (e.g. `default_agent`, which ships the whole library) — copy the entire `skills/<skill_name>/` directory. Common bundles, so you don't under-equip the target:

- **App builder** (builds apps or web frontends): `penguin-sdk`, `web-design`, `agenthub-models`.
- **Knowledge expert** (answers questions over a document set): usually **no** harness agent is needed — build a RAG app with the penguin-sdk skill instead, and configure the app's embedded agent (below).
- **Evaluation loop**: `benchmark-design`, `agent-evaluation`, `agent-optimization`.

When this Agent is the Test Agent in a create → benchmark → optimize request, keep the
evaluation-loop Skills on the top-level orchestrator. Do not install them on the Test Agent
merely because the orchestrator will evaluate it; install only capabilities the Test Agent
needs while solving its own tasks.

## Composed tuning workflows

Before creating a target for a create → benchmark → optimize request, confirm that the current
top-level orchestrator has `benchmark-design`, `agent-evaluation`, and `agent-optimization`
installed and exposes `run_subagent`. If not, stop before creating a partial target and report the
missing prerequisite.

When the same top-level request also asks to benchmark and optimize the new Agent, finish its
initial State and continue in the current conversation: hand the explicit Agent id and capability
goal to `benchmark-design`, then hand its frozen baseline to `agent-optimization`. Do not open a
separate user-facing chat or ask the user to repeat information already present in the request.
Keep in the current working context whether the canonical target was absent before creation; this
fact, the explicit Agent id, and the initial State version are the bootstrap provenance consumed by
`agent-optimization`. A creation-stage progress update is fine, but do not emit a terminal success
response while a requested Benchmark or optimization stage remains.

## Set name and description

In the target's `agent_state/system_config.yaml`, set the top-level `name:` and `description:` fields so the agent is recognizable in lists. For an existing Agent, edit only these two fields. For a brand-new Agent, also set its canonical top-level `version` to `1`; do not inherit a later State version from the default Agent template.

## Creating a brand-new agent

Prefer configuring an agent the user already created. If you must create one from scratch: pick a short id (letters, digits, `_`, `-`), first verify that the canonical `TARGET` does not exist, copy the default agent's `system_config.yaml` as the base, and create the layout described above:

```bash
mkdir -p "$TARGET/agent_state/skills" "$TARGET/agent_state/memory" "$TARGET/agent_state/tools" "$TARGET/scratchpad"
cp "$PROJECT_DIR/agents/default_agent/agent_state/system_config.yaml" "$TARGET/agent_state/"
```

A new agent starts with no skills — install only what it needs. Then write its AGENTS.md, name and description as above. Before handing it to another Skill, verify that
`TARGET/agent_state/system_config.yaml` and `TARGET/agent_state/AGENTS.md` are regular files, the
State version is exactly `1`, and no legacy `$PROJECT_DIR/<agent_id>` path or compatibility
symlink was created.

## The embedded agent of an SDK app

An app built with the penguin-sdk skill carries its own agent inside the project (`createAgent({ root })` initializes `<app>/penguin_data/default_project/agents/default_agent/` on first run). That directory has exactly the layout described here, and everything in this skill applies to it: write the app's persona into its `agent_state/AGENTS.md` (the penguin-sdk recipe keeps the source of truth in the project's `persona.md` and copies it in during ingest), and set `name`/`description` in its `system_config.yaml` so the app is recognizable. This is how "the app becomes an expert on X": the persona lives in the embedded agent's AGENTS.md, not in application code.
