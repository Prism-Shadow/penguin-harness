---
name: agent-initialization
description: Initialize an Agent's settings from a user requirement by writing AGENTS.md, setting identity metadata, and installing only needed Skills.
short_description: Initialize an agent from a requirement.
short_description_zh: 依据需求初始化一个 Agent 的设置。
version: 8
updated: 2026-08-21T00:00:00Z
---

# Agent Initialization

This skill initializes an agent's settings from a user requirement — plain files in the target agent's directory.

## Before you start

If the user's message only invokes this skill (e.g. "use agent-initialization skill") without a concrete requirement, ask the user what agent they want and what it should do. But when the requirement is already concrete — even a single sentence like "an expert that answers questions about X" — do **not** ask follow-up questions: derive the role and rules from that sentence, apply the defaults below, and list your assumptions in the final reply.

## Resolve the inherited runtime

Treat the current Agent as the **Builder**. Resolve the runtime before creating a new Agent:

- `provider` and `model_id` are one complete pair. If the user explicitly supplies both, use that pair. If the user supplies neither, inherit the current Builder Session's `Provider` and `Model ID` from the Environment. Reject a half pair.
- `thinking_level` is independent. If the user explicitly supplies it, use that value. Otherwise read `model.thinking_level` from the Builder's own `agent_state/system_config.yaml`; when the field is absent, use the normal Agent-config default `medium`.

Write the resolved `thinking_level` into a brand-new target Agent's `model.thinking_level`, preserving all other copied `model` fields. Penguin does not persist `provider` or `model_id` in Agent State, so never add either field to `system_config.yaml`. When the same request continues into Benchmark design, carry the resolved model pair forward explicitly so evaluation uses the Builder runtime instead of a Project default. When configuring an existing Agent, change `model.thinking_level` only when the user explicitly requests that runtime change.

## Locate the target agent

All agents of this project live side by side under `agents/` in the App Data Dir:

```bash
APP_DATA_DIR="<app_data_dir>"     # the App Data Dir value from your Environment section
ls "$APP_DATA_DIR/agents"         # existing agents (each is a folder here)
TARGET="$APP_DATA_DIR/agents/<agent_id>"   # the agent to configure
```

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

When creating a Test Agent, install only the capabilities it needs to solve ordinary tasks.

## Set name and description

In the target's `agent_state/system_config.yaml`, set the top-level `name:` and `description:` fields so the agent is recognizable in lists. For an existing Agent, edit only these two fields unless the user explicitly requested a `thinking_level` change.

## Creating a brand-new agent

Prefer configuring an agent the user already created. If the user requires a new Agent, confirm that `TARGET` does not exist. If it already exists, stop and tell the user; never silently overwrite, reinitialize, or reuse an existing Agent under the same id.

After confirming that the target is absent, pick a short id using letters, digits, `_`, or `-`, copy the default Agent's `system_config.yaml` as the base, and create the layout described above:

```bash
mkdir -p "$TARGET/agent_state/skills" "$TARGET/agent_state/memory" "$TARGET/agent_state/tools" "$TARGET/scratchpad"
cp "$APP_DATA_DIR/agents/default_agent/agent_state/system_config.yaml" "$TARGET/agent_state/"
```

Then set the top-level `name`, `description`, and `version: 1`, set `model.thinking_level` to the resolved value, write `agent_state/AGENTS.md` (it lives under `agent_state/`, not at the agent directory root), and install only the Skills required by the user's requirement. Do not persist the resolved provider/model pair in the Agent State.

## Validate and report

Before finishing:

- parse `agent_state/system_config.yaml` and confirm `name`, `description`, a positive integer `version`, and the expected `model.thinking_level`;
- confirm `agent_state/AGENTS.md` exists and is non-empty;
- confirm every installed Skill has a parseable `SKILL.md`, and its `name` matches its directory;
- confirm no Agent outside `TARGET` was changed.

Report the target path, whether an existing Agent was configured or a new Agent was created, assumptions, installed Skills, the resolved runtime and whether each value was user-specified or inherited, and validation results.

## The embedded agent of an SDK app

An app built with the penguin-sdk skill carries its own agent inside the project (`createAgent({ root })` initializes `<app>/penguin_data/default_project/agents/default_agent/` on first run). That directory has exactly the layout described here, and everything in this skill applies to it: write the app's persona into its `agent_state/AGENTS.md` (the penguin-sdk recipe keeps the source of truth in the project's `persona.md` and copies it in during ingest), and set `name`/`description` in its `system_config.yaml` so the app is recognizable. This is how "the app becomes an expert on X": the persona lives in the embedded agent's AGENTS.md, not in application code.
