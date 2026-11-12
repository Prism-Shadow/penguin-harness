# Initialize the target harness

Prepare the Target before H_0 is measured. The State-only mode edits a target-owned Skill and its
supporting files. When target source is available, source mode also edits the implementation of
the harness, using an isolated checkout and its own build. Keep the controller's installation,
policy model and Benchmark fixed. `STATE`, `SOURCE`, `SKILL_DIR` and `OUT` are the paths of the
Skill's "Paths and records".

## Source and build, when available

Use the source revision supplied by the user, or resolve the source of the target installation.
Create a separate checkout under OUT; do not edit the installation running this Skill. Record
the starting revision and any existing diff before initializing H_0. If source is unavailable,
record `harness_mode: state`; the rest of the method still operates on the declared State paths.

For source mode, record a build and launch recipe in `OUT/experiment.yaml`:

- The source root and actual editable paths for each component in K: prompts, the agent loop,
  tool registration, configuration, output handling, context, Skills, memory and delegation.
- The repository's build command, runtime dependencies, and the absolute target CLI entry or
  install-bundle path used by evaluation. For Penguin, build workspace dependencies through
  pnpm so injected package copies are updated; do not relink the controller's global CLI.
- How the Benchmark runner receives that build and the frozen State. A State archive alone
  changes the Agent's files, not its runtime implementation.

Build H_0 once and retain its result. Each later candidate starts from the incumbent's source
and State, builds in its own directory after Critic acceptance, and keeps the result with its
version. Reuse a build only when its source and build inputs are unchanged.

For a local CLI launch, use the recorded absolute entry and a separate data root/server for the
target build, populated with that version's State and the configured model connection. Each
trial starts from a fresh runtime copy. Clear inherited `PENGUIN_API_URL`, `PENGUIN_API_TOKEN`
and `PENGUIN_SESSION_ID` before launching it; those variables otherwise route CLI calls back to
the controller. Keep runtime writes within that copy and discard them
after collecting the result; they do not modify the frozen candidate or carry task data to the
next trial.

For a Harbor launch, use the Benchmark adapter's custom-build mechanism, such as `install_bundle`.
If its bundle helper installs an npm release, that helper alone does not package a modified
checkout. Stage the candidate's built CLI and runtime dependencies in the adapter's documented
bundle layout and provide that exact bundle to the trial. Match its declared Node/package
versions to the launch options. Do not fall back to the stock release for a source candidate.
Keep the Benchmark's environment, scoring and model-connection setup unchanged.

Before scoring, verify the launched entry or installed bundle against the candidate's version
record. A build failure or a launcher that cannot use the candidate is an execution failure,
not a measurement of that candidate. Freezing or restoring H_0/final restores both build and
State. No candidate source changes are pushed to a public repository during evolution.

## Agent State

1. **Learned state.** If `SLOT = STATE/skills/rrsi-harness` exists already, stop. It is either an
   experiment to resume, which needs the matching `OUT/experiment.yaml`, or learning that must
   not be lost: ask the user, and never overwrite a slot a previous run evolved.
2. **Version.** A Target created for this experiment is initialized in place, at `version` 1. For
   an existing agent, make sure the snapshot of its current version exists (the Skill's snapshot
   rule); initialize at one more than the highest version in its current State, snapshots and
   scoreboard, as the Skill's version rule requires.
3. **Declare the component set.** Write `OUT/components.yaml` with the components this run may
   edit — the K of `references/training.md` — and their State/source paths. The layout below is
   the State-only starting point; in source mode also map the actual implementation paths found
   above. Record the chosen scope, because the Pruner's B_t and the novelty term nu both read K:

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

Read `config.yaml` for procedure settings, `tools/tools.yaml` for registered helpers, and
`state/notes.yaml` for generic notes. These are instructions for this Skill, not automatic engine
configuration. A new executable helper or nested Skill must be called from the procedure that
uses it.

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
   component's file or directory (present within its declared State or isolated source scope),
   and check that the reader line
   appears exactly once in `STATE/AGENTS.md`. Record the SHA-256 of every slot file and of
   `AGENTS.md` in `OUT/experiment.yaml` as `h0`, and retain the version's State snapshot and
   source/build record. The "Measure" step checks the frozen State again after every matrix.

H_0 is the initialized State together with the starting source/build, with nothing learned yet;
that is what the baseline measures. Only accepted edits change it. If a candidate replaces a
State entry point, update its reader in the same edit so the measured mechanism is still invoked.
