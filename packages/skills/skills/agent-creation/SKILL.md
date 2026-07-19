---
name: agent-creation
description: Turn a user requirement into a concrete agent — write the target agent's AGENTS.md and install the skills it needs.
short_description: Turn a requirement into a working agent.
short_description_zh: 把需求变成可用的 Agent。
version: 1
updated: 2026-07-17T00:00:00Z
---

# Agent Creation

This skill turns a user requirement into a working agent configuration — plain files in the target agent's directory.

## Before you start

If the user's message only invokes this skill (e.g. "use agent-creation skill") without a concrete requirement, ask the user what agent they want and what it should do. Do not start until the requirement is clear.

## Locate the target agent

All agents of this project live side by side in the project directory:

```bash
PROJECT_DIR="<project_dir>"        # the Project Dir value from your Environment section
ls "$PROJECT_DIR/agents"          # existing agents (each is a folder here)
TARGET="$PROJECT_DIR/agents/<agent_id>"   # the agent to configure
```

An agent directory contains `agent_state/` (`system_config.yaml`, `AGENTS.md`, `skills/`, `memory/`, `tools/`) plus `scratchpad/` — and `traces/`, which appears once the agent has run at least once.

## Write AGENTS.md

`agent_state/AGENTS.md` is injected into the agent's system prompt — it is where the user requirement becomes behavior. Keep `system_config.yaml`'s `system_prompt` untouched (that is the stable system layer); put everything requirement-specific in AGENTS.md:

- Role — what the agent is for, in one or two sentences.
- Domain guidance — the concrete rules, steps and constraints derived from the user requirement.

Be concise: AGENTS.md is prompt context, not documentation.

## Install skills

A skill is a directory `agent_state/skills/<skill_name>/` containing a `SKILL.md`:

```md
---
name: <skill_name>
description: <skill_description>
version: 1
updated: <ISO 8601 timestamp>
---

<skill_instructions>
```

The frontmatter may also carry optional `short_description` and `short_description_zh` lines (a short UI blurb and its Chinese variant) — the UI prefers them for display, while prompt injection always uses the English `description`.

Installing is all it takes: the frontmatter metadata of every `SKILL.md` under `skills/` is injected into the target agent's system prompt automatically — do not register skills in AGENTS.md.

Write skills yourself, or fetch existing ones from the internet with shell commands (`curl`, `git clone`) and place them under `skills/`. Anything fetched from the internet must be read in full and reviewed before installing — a skill becomes durable instructions the target agent will follow in every future session; never install one you have not read, and tell the user what it does.

## Set name and description

In the target's `agent_state/system_config.yaml`, set the top-level `name:` and `description:` fields so the agent is recognizable in lists. Edit only these two fields.

## Creating a brand-new agent

Prefer configuring an agent the user already created. If you must create one from scratch: pick a short id (letters, digits, `_`, `-`), copy the default agent's `system_config.yaml` as the base, and create the layout described above:

```bash
mkdir -p "$TARGET/agent_state/skills" "$TARGET/agent_state/memory" "$TARGET/agent_state/tools" "$TARGET/scratchpad"
cp "$PROJECT_DIR/agents/default_agent/agent_state/system_config.yaml" "$TARGET/agent_state/"
```

A new agent starts with no skills — install only what it needs. Then write its AGENTS.md, name and description as above.
