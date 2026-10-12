# Initialize the AWM workflow memory

Prepare the Target before H1 is measured: one target-owned Skill holding an empty workflow memory, and one fixed line in the Target's `AGENTS.md`. Run no execution and induce no workflow here. The model settings, tools, hooks, the agent's own `memory/` and every other Skill stay as they are. `STATE`, `MEMORY` and `OUT` are the paths of the Skill's "Paths and records".

1. **Learned state.** If `MEMORY` exists already, stop. It is either an experiment to resume, which needs the matching `OUT/experiment.yaml`, or learning that must not be lost: ask the user, and never empty a learned `workflows.md`.
2. **Version.** A Target created for this experiment is initialized in place, at `version` 1. For an existing agent, make sure the snapshot of its current version exists (the Skill's snapshot rule); the initialized State then takes that version + 1 as `version` in `STATE/system_config.yaml`.
3. **The Skill.** Write `MEMORY/SKILL.md`, with today's date version (`YYYY.MM.DD.1`) in place of the placeholder, exactly:

```markdown
---
name: awm-workflows
description: Workflows induced from earlier successful tasks - read them in full before your first substantive action on a task.
version: <YYYY.MM.DD.1>
---

# Workflow memory

`workflows.md` beside this file holds reusable workflows induced from earlier successful tasks. Each `##` section is one workflow: when it applies, the `{parameters}` it takes, and numbered steps, each an observation, the reasoning and the action. Read the whole file before your first substantive action. When a workflow fits the task, bind its parameters to the task's actual values and carry out its steps with your ordinary tools, checking each result against what you observe; where none fits, solve the task as you normally would. Keep the output the task asks for. Never change this Skill, `workflows.md` or anything else in your Agent State.
```

4. **The memory.** Write `MEMORY/workflows.md` as the single line `# Workflows`. Every workflow the Inducer adds later is a section of this form, appended and never edited:

```markdown
## <the goal, with its {parameters}>

Applies when: <one sentence>
Parameters: `{name}` (<what it stands for>), …

1. Observation: <what the agent sees>. Reasoning: <why this step>. Action: <the tool call or command, with {parameters}>.
2. …
```

5. **The reader.** Append this line to `STATE/AGENTS.md`, after a blank line when the file is not empty, exactly:

```text
Before your first substantive action on any task, read `skills/awm-workflows/SKILL.md` and `skills/awm-workflows/workflows.md` in your Agent State in full, and follow that Skill.
```

6. **Verify.** Parse `STATE/system_config.yaml` (the expected `version`, no duplicate key) and the frontmatter of `MEMORY/SKILL.md` (`name: awm-workflows`, matching its directory), check that `MEMORY/workflows.md` holds no workflow and that the reader line appears exactly once in `STATE/AGENTS.md`. Record the SHA-256 of these four files in `OUT/experiment.yaml`.

The Skill body and the reader line stay unchanged through H1, the stream or the induction, and the final measurement: only `workflows.md` learns, and only through the Skill's Publish step.
