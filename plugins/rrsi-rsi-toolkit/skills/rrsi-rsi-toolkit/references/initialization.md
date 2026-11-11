# Initialize the harness slot

Prepare the Target before `H_0` is measured: one target-owned Skill that holds the harness the
evolution edits, and one fixed line in the Target's `AGENTS.md`. Run no execution here. The model
settings, tools, hooks, memory and every other Skill stay as they are. `STATE`, `SKILL_DIR` and
`OUT` are the paths of the Skill's "Paths and records".

1. **Learned state.** If `SLOT = STATE/skills/rrsi-harness` exists already, stop. It is either an
   experiment to resume, which needs the matching `OUT/experiment.yaml`, or learning that must
   not be lost: ask the user, and never overwrite a slot a previous run evolved.
2. **Version.** A Target created for this experiment is initialized in place, at `version` 1. For
   an existing agent, make sure the snapshot of its current version exists (the Skill's snapshot
   rule); the initialized State then takes that version + 1 as `version` in
   `STATE/system_config.yaml`.
3. **Declare the component set.** Write `OUT/components.yaml` with the components this run may
   edit — the `K` of `references/training.md` — and the file each one owns inside the slot. The
   layout below is the one this toolkit ships; a run that narrows or widens it records the change
   as an adaptation, because the Pruner's `B_t` and the novelty term `nu` both read `K`:

   ```yaml
   slot: STATE/skills/rrsi-harness
   components:
     prompt:          { file: SKILL.md, region: "Procedure" }
     control_flow:    { file: SKILL.md, region: "Procedure" }
     config:          { file: config.yaml }
     output_plumbing: { file: SKILL.md, region: "Output" }
     context_mgmt:    { file: SKILL.md, region: "Context" }
     client_tool:     { file: tools/ }
     skill:           { file: skills/ }
     memory:          { file: state/ }
     subagent:        { file: SKILL.md, region: "Delegation" }
   ```
4. **The slot.** Write `SLOT/SKILL.md` with today's date version (`YYYY.MM.DD.1`) exactly:

```markdown
---
name: rrsi-harness
description: Harness of this Agent - read it in full before your first substantive action on a task.
version: <YYYY.MM.DD.1>
---

# Harness

This Skill is the harness this Agent runs by: the procedure it follows, what it keeps in context,
what it writes, when it delegates, and which tools, nested Skills and state files it uses. Read it
in full before your first substantive action on a task and follow it.

## Context

Read the task's own statement first, and nothing about how the task is graded.

## Procedure

Understand the task, plan, act, check the result against the task's own requirements, and finish.
Keep the output the task asks for.

## Delegation

Do the work yourself unless the task is large enough that a subagent saves more than it costs.

## Output

Produce exactly what the task asks for, in the form it asks for, and say when you are done.
```

5. **The mechanical parts.** Create the directories the declared components own, each with one
   file so the layout is real and the diff of a later edit is readable:

   ```bash
   mkdir -p "<SLOT>/tools" "<SLOT>/skills" "<SLOT>/state"
   printf 'tools: []\n' > "<SLOT>/tools/tools.yaml"
   printf 'entries: []\n' > "<SLOT>/state/notes.yaml"
   ```
   and `SLOT/config.yaml`:

   ```yaml
   # Numbers the harness runs by. Edit here, never in the procedure text.
   max_steps: 40
   retry_limit: 2
   context_budget_note: keep the task statement and the current plan; drop resolved exploration
   ```

   Write `SLOT/skills/README.md` saying that a nested Skill is a directory with its own
   `SKILL.md` and a `version` in its frontmatter, loaded only when its condition fires. Nothing
   nested ships in `H_0`.
6. **The reader.** Append this line to `STATE/AGENTS.md`, after a blank line when the file is not
   empty, exactly:

```text
Before your first substantive action on any task, read `skills/rrsi-harness/SKILL.md` and the files it names in your Agent State in full, and follow that Skill.
```

7. **Verify.** Parse `STATE/system_config.yaml` (the expected `version`, no duplicate key), the
   frontmatter of `SLOT/SKILL.md` (`name: rrsi-harness`, matching its directory), every declared
   component's file or directory (present, and inside the slot), and check that the reader line
   appears exactly once in `STATE/AGENTS.md`. Record the SHA-256 of every slot file and of
   `AGENTS.md` in `OUT/experiment.yaml` as `h0` — that set is what the "Measure" step hashes
   again after every matrix; it is `H_0`.

The slot's `SKILL.md` and the reader line stay part of the harness through the run: only the
declared components learn, and only through a round's accepted edit. `H_0` is the harness above
with nothing learned yet; that is what the baseline measures.
