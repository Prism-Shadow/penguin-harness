# Initialize the ACE playbook

Prepare the Target before H1 is measured: one target-owned Skill holding an empty playbook, and one fixed line in the Target's `AGENTS.md`. Run no execution here. The model settings, tools, hooks, memory and every other Skill stay as they are. `STATE`, `PLAYBOOK` and `OUT` are the paths of the Skill's "Paths and records".

1. **Learned state.** If `PLAYBOOK` exists already, stop. It is either an experiment to resume, which needs the matching `OUT/experiment.yaml`, or learning that must not be lost: ask the user, and never empty a learned `rules.yaml`.
2. **Version.** A Target created for this experiment is initialized in place, at `version` 1. For an existing agent, make sure the snapshot of its current version exists (the Skill's snapshot rule); the initialized State then takes that version + 1 as `version` in `STATE/system_config.yaml`.
3. **The Skill.** Write `PLAYBOOK/SKILL.md`, with today's date version (`YYYY.MM.DD.1`) in place of the placeholder, exactly:

```markdown
---
name: ace-playbook
description: Playbook of rules learned from earlier tasks - read it in full before your first substantive action on a task.
version: <YYYY.MM.DD.1>
---

# Playbook

`rules.yaml` beside this file holds rules learned from earlier tasks. Each entry has an `id`, a `section`, the rule's `content`, and `helpful` / `harmful` counts of how often it helped or hurt before. Read the whole file before your first substantive action. Apply the entries that fit the current task, weigh them by their counts, and check them against the task's own evidence; where none fits, solve the task as you normally would. Keep the output the task asks for.

Before you finish, write the ids of the entries you applied, comma-separated, or `none`, as the only line of `ace-rules-used.txt` in this Session's scratchpad. Never change this Skill, `rules.yaml` or anything else in your Agent State.
```

4. **The playbook.** Write `PLAYBOOK/rules.yaml` as `entries: []`. Every entry the Curator adds later has this form, and only its two counters ever change:

```yaml
entries:
  - id: r-0001 # fresh, never reused
    section: common_mistakes # the Curator's section
    content: <the Curator's rule, verbatim>
    helpful: 0
    harmful: 0
```

5. **The reader.** Append this line to `STATE/AGENTS.md`, after a blank line when the file is not empty, exactly:

```text
Before your first substantive action on any task, read `skills/ace-playbook/SKILL.md` and `skills/ace-playbook/rules.yaml` in your Agent State in full, and follow that Skill.
```

6. **Verify.** Parse `STATE/system_config.yaml` (the expected `version`, no duplicate key), the frontmatter of `PLAYBOOK/SKILL.md` (`name: ace-playbook`, matching its directory) and `PLAYBOOK/rules.yaml` (`entries: []`), and check that the reader line appears exactly once in `STATE/AGENTS.md`. Record the SHA-256 of these four files in `OUT/experiment.yaml`.

The Skill body and the reader line stay unchanged through H1, training and the final measurement: only `rules.yaml` learns, and only through the Skill's Publish step.
