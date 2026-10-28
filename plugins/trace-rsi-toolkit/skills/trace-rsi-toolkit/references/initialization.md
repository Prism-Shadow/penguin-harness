# Prepare the experiment

Resolve the Project from the Penguin Environment's App Data Dir. Use the requested output location; for repository-backed experiments default to `<benchmark-repository>/jobs/<experiment-id>/`, otherwise the session workspace or scratchpad. Organizer-created configurations, staging copies, archives and reports belong there. Runtime-managed Agent files and Harbor trials keep their normal locations.

Assign a stable experiment/report version. Record the actual Harness, toolkit, runner and benchmark package versions, resolved source commit, local source changes, provider/model/thinking per role, budgets, cases, public types, ordering, limits and selection rule. Record a concrete model revision when exposed; otherwise retain the actual model identifier. Add State versions/digests as they are frozen.

Use one subdirectory per independent training unit and distinct test paths by condition, repetition and case. Keep a launch index in `state.yaml` for recovery after compaction. Task and grader sources stay fixed.

## Common base and Actor State

Use the supplied base Agent or create a fresh identity through the CLI:

```bash
penguin agent create --agent-id <unused-id> --project-id <project-id> --json
```

The measured base is separate from the Organizer. Preserve a supplied Agent's unrelated State and snapshots. Make experiment-specific copies without learned business Skills, old answers or experiment history; disable persistent memory and state-mutating hooks in these copies. Align State turn limits, including `compaction.max_session_turns`, and runner limits with the benchmark. Keep tools and runtime fixed.

Use this solving instruction in both the Actor template and test States:

```text
Complete the supplied benchmark task. If skills/trace-bank/SKILL.md is
installed, read it and follow its selection procedure throughout this task.
Follow the supplied task's input and output contract.
```

The no-Skill baseline has no installed Skills. The Actor template additionally receives the empty H1 bank below; install each frozen training bank into that same template between batches. Actor and selected-bank test States differ only by runtime-managed attempt artifacts and the specified bank, not their solving capabilities.

## Empty H1 bank and fixed reader

Create `skills/trace-bank/catalog.yaml` with `skills: []` and an empty `entries/` directory. Do not seed it with domain knowledge or answers. Create `skills/trace-bank/SKILL.md` with frontmatter `name: trace-bank`, a selection-oriented description, a dated version and this fixed body:

```markdown
# TRACE bank

Read catalog.yaml beside this file at task start. Before each substantive decision, select the ordered skill ids relevant to current observations and unresolved constraints, or an empty list. Read their entries relative to this bank; reuse unchanged text already in context, reconsidering applicability as observations change.

Before acting, append decision, ordered unique skills, and an observable basis to trace-selections.jsonl in this session's scratchpad. Record empty selections. If logging fails, retain the error; never invent missing records.

Bind skill parameters to observed inputs, check prerequisites and available tools, and follow the current task's explicit contract. A skill grants no extra capability. Keep this bank fixed during execution; do not read private scoring files or experiment records.
```

Keep this reader body fixed. Catalog entries contain `id`, `description` and `path: entries/<id>/SKILL.md`. Each entry has matching `name`, routing `description`, dated `version` and a self-contained operation body. Validate metadata and paths, then record the empty bank's digest. H1 includes an empty reader; it is not the no-Skill held-out baseline.

## Curator training State

Copy the base into a separate Curator State. Install only the inner training instructions and required assets:

| Source | Destination relative to Curator State |
| --- | --- |
| Toolkit `references/training.md` | `skills/trace-training/SKILL.md` |
| Prepared Actor State, including empty bank | `skills/trace-training/assets/actor-state/` |
| Public benchmark training brief | `skills/trace-training/benchmark-training.md` |
| Resolved run configuration | `training-request.json` |

The brief gives public task/input paths, API/tool access, permitted feedback calls, score interpretation, state reset semantics and answer/Skill/record export paths. Derive these from the selected benchmark, not old hard-coded task-group paths. Confirm permitted training feedback is enabled; a reachable business API alone is insufficient.

The request contains benchmark/unit and ordered task ids, public task types (one type if absent), A, R, selection rule and tie-break, Actor identity/project and provider/model/thinking, runtime limits, Actor template location, bank/record working directories and export locations. Paths must resolve inside the container. Test repetitions belong to the Organizer's schedule, not this request. Include no held-out material.

Add to the Curator's `AGENTS.md`:

```text
For this whole training run, read training-request.json beside this file,
skills/trace-training/SKILL.md and its benchmark-training.md. Complete TRACE
as the main Curator in this continuing session and business environment.
Create the supplied Actor identity from the Actor template and use fresh
run_subagent sessions with that identity for the individual task attempts.
```

Use the in-container CLI to create the Actor identity and install the template in its State. Every child call explicitly binds the Actor identity and runtime, so it receives solving instructions rather than Curator instructions. The Curator creates and freezes each bank; Actors return candidates and action/selection records.

## Test States and archives

After complete training, prepare two States from the same base: no Skills, and only the exact selected `trace-bank` folder plus its common solving instruction. Training instructions, Actor templates, answers, records and conversation do not enter test States. Snapshot versions and digests; reuse each frozen archive for every repetition, restoring it into a fresh environment/session per case.

Follow the adapter's current State-import contract. For Penguin's Harbor adapter the archive root contains State files directly:

```bash
tar --exclude=./.vault.toml --exclude=./memory --exclude=./schedule \
  -czf "$STATE_TAR" -C "$STATE_DIR" .
```

Bind `agent_state_tar`, agent/project identity, runtime and model configuration explicitly using the adapter's documented arguments. Credentials travel through its private configuration mechanism, not prompts or archives. Executable installation and Agent State are separate inputs; see [source-bundle.md](source-bundle.md) only when a source runtime is requested.
