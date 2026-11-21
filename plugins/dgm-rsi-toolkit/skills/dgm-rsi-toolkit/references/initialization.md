# Initialize the agent package

Prepare the Target for DGM before the archive seed is measured: one Target-owned Skill directory holds the agent's package, one marked block in `AGENTS.md` makes the Target read it, and nothing else changes. Run no search here.

## The Target

**`create: <id>`.** Confirm `PROJECT_DIR/agents/<id>` does not exist, then create the Agent through the server, so that it is registered and appears in the Web App, with no plugins (an empty skill set). An Agent id is a lowercase letter followed by 1 to 63 lowercase letters, digits or `_`.

```bash
PROJECT_DIR="<app_data_dir>"
PROJECT_ID="$(basename "$PROJECT_DIR")"
PENGUIN_HOME="$(dirname "$PROJECT_DIR")"
export PENGUIN_HOME
penguin agent create --agent-id "<id>" --project-id "$PROJECT_ID" --json
```

Then set `memory.enabled: false` in its `system_config.yaml`, replacing the field rather than adding a duplicate key: the paper evaluates every candidate independently, and a memory saved in one run would reach the next and corrupt both the score and the pass vector the archive keeps. A new Target keeps its first `version`.

**An existing Target.** Never the Agent running this Skill, and never one that already has `skills/dgm-agent/`: a package is reused only to resume the same experiment, with matching hashes and a matching `OUT/archive.yaml`; otherwise ask for another Target or `create: <id>`, and never empty or overwrite an evolved package. Leave its other settings alone, make sure `STATE/memory/user/MEMORY.md` exists (the harness creates it at a Session's start otherwise, which would change the State between hashes), snapshot its current version, and give the initialized State a new version (SKILL.md, "Paths and records").

## The package slot

Create `STATE/skills/dgm-agent/SKILL.md`, with today's date in the version:

```markdown
---
name: dgm-agent
description: The behavior package of this agent. Read every file in this directory before acting on a task.
version: YYYY.MM.DD.1
---

Read every other file in this directory, in sorted file-name order, in full before any substantive action on a task, and apply what they say within the task's own access and output requirements. The agent's behavior lives only in the files of this directory.
```

Write the seed files into the directory: the user's declared seed package; for the demo task, the two files of `references/demo-task.md` (`strategy.md`, then `examples.md`). With neither, write a single `strategy.md`:

```markdown
# Strategy

Read the task statement in the Workspace and complete it exactly as specified there. Plan before acting, verify the result before finishing, and keep the output in the form the statement asks for.
```

Record which seed was used. The seed is generation 0's package. The search may rewrite, add or delete every file in this directory — including this `SKILL.md`'s body and description, never its frontmatter `name: dgm-agent` nor its `version`, which only this experiment moves.

Append this block, unchanged, to `STATE/AGENTS.md` (create the file when it is absent):

```text
<!-- dgm-agent-package:begin -->
Before any substantive action on a task, read skills/dgm-agent/SKILL.md in your Agent State in full, then read every other file in skills/dgm-agent/ in sorted file-name order, and follow them.
<!-- dgm-agent-package:end -->
```

The two marker lines delimit the experiment's reader block: the search may rewrite the text between them, never anything outside them, and never the markers themselves. Append the block once; a second copy is a corrupted State.

## Verify and hand off

Parse `system_config.yaml` and confirm a positive integer `version`, the expected `model.thinking_level`, and `memory.enabled: false`; confirm the slot's `SKILL.md` carries `name: dgm-agent` and a version of today, that the seed files are present, and that the reader block appears in `AGENTS.md` exactly once with both markers. Return to `experiment.yaml` the initial version, the package digest (SKILL.md, "Paths and records"), the reader block's SHA-256, which seed was used, and whether the Target was created or extended. No other Agent changes.
