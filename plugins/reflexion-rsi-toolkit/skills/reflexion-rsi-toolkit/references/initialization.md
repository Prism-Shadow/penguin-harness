# Initialize the reflection slot

Prepare the Target for Reflexion before H1 is measured: one Target-owned Skill holds the episodic buffer, one fixed line makes the Target read it, and nothing else changes. Run no trial here.

## The Target

**`create: <id>`.** Confirm `PROJECT_DIR/agents/<id>` does not exist, then create the Agent through the server, so that it is registered and appears in the Web App, with no plugins (an empty skill set). An Agent id is a lowercase letter followed by 1 to 63 lowercase letters, digits or `_`.

```bash
PROJECT_DIR="<app_data_dir>"
PROJECT_ID="$(basename "$PROJECT_DIR")"
PENGUIN_HOME="$(dirname "$PROJECT_DIR")"
export PENGUIN_HOME
penguin agent create --agent-id "<id>" --project-id "$PROJECT_ID" --json
```

Then set `memory.enabled: false` in its `system_config.yaml`, replacing the field rather than adding a duplicate key: the paper's trials answer every problem independently, and a memory saved in one run would reach the next outside the buffer. A new Target keeps its first `version`.

**An existing Target.** Never the Agent running this Skill, and never one that already has `skills/reflexion-memory/`: a slot is reused only to resume the same experiment with matching hashes; otherwise ask for another Target or `create: <id>`, and never empty or overwrite a learned buffer. Leave its other settings alone, make sure `STATE/memory/user/MEMORY.md` exists (the harness creates it at a Session's start otherwise, which would change the State between hashes), snapshot its current version, and give the initialized State a new version (SKILL.md, "Paths and records").

## The slot

Create `STATE/skills/reflexion-memory/SKILL.md`, with today's date in the version:

```markdown
---
name: reflexion-memory
description: The written reflection buffer this agent applies to every task. Read reflections.md in full before acting on a task.
version: YYYY.MM.DD.1
---

Read `reflections.md` in this directory in full before any substantive action on a task, and apply that guidance to the task within the task's own access and output requirements. The buffer lives only in that file.
```

Create `STATE/skills/reflexion-memory/reflections.md` beside it with exactly this seed content:

```markdown
# Reflexion buffer

No trials have been reflected on yet.
```

Append this line, unchanged, to `STATE/AGENTS.md` (create the file when it is absent):

```text
Before any substantive action on a task, read skills/reflexion-memory/SKILL.md and skills/reflexion-memory/reflections.md in your Agent State in full, and follow them.
```

The Skill body and that line stay identical for H1, every trial and any later test; during the experiment only `reflections.md` and the Skill's `version` change. Reflector prompts, score matrices and answers never enter the Target outside the buffer.

## Verify and hand off

Parse `system_config.yaml` and confirm a positive integer `version` and the expected `model.thinking_level`; confirm the Skill's `name` matches its directory and the reader line appears in `AGENTS.md` exactly once. Return to `experiment.yaml` the initial version, the SHA-256 of `reflections.md`, of the slot's `SKILL.md` and of the reader line, that the seed buffer was used, and whether the Target was created or extended. No other Agent changes.
