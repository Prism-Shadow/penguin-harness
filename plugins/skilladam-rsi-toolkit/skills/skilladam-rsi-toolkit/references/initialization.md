# Prepare the experiment

Resolve the Project from the current Penguin Environment's App Data Dir. Use the host and output directory named by the user; otherwise use this Session's workspace or scratchpad. Record the selected packages, task sources, runtime, one training run per training unit, test repetitions (default: three), learning parameters, comparison versions and resource limits in a short experiment record.

Use the user's experiment/report version when supplied; otherwise assign a stable version before launch and include it in every progress and final report. Resolve component versions with the same priority: user-specified versions first, otherwise compatible versions selected from the environment and benchmark instructions. Record the Harness and runner versions, benchmark package version and resolved source revision, provider/model identifier and thinking level, and toolkit version. Record a concrete model revision when exposed by the provider; otherwise retain the actual model identifier. Keep this configuration fixed throughout the experiment and add each Skill/Agent State version and digest when it is frozen.

## Runtime and directories

Read the selected Case statements and benchmark instructions. They specify Docker, Harbor or another runner, its adapter, model configuration, task paths and artifact collection. Reuse the current CLI and configured model connection. Follow the benchmark's installation procedure for the Target; use the same prepared source build throughout when the experiment requests one. The adapter copies credentials privately; keep them out of prompts and experiment records.

Use a separate directory for each benchmark or independent training unit, with one set of frozen State archives and learning records. Give test outputs distinct paths by State, repetition and case. Keep a launch index so the controller can resume collection after context compaction. Keep task source and grading implementation unchanged during the experiment. Fetch benchmark source once at the requested version, or resolve the installed package's link when no version was requested; an existing unrelated checkout is not an input.

Before starting training, verify that a training attempt can obtain the evaluator feedback required by SkillAdam. A reachable business service alone does not confirm that training feedback is available.

Inspect active runs without changing ownership or permissions on their mounted log directories. Organize a completed trial's artifacts after its runner exits, so collection does not interrupt another trial's logging.

## The common base State

Use the requested base Agent, or create a fresh Agent through the CLI. It is separate from the experiment controller. A new Agent can be created with:

```bash
penguin agent create --agent-id <unused-id> --project-id <project-id> --json
```

Use the same base for all comparisons, without a learned business Skill unless one was requested as the baseline. Set the requested thinking level in `system_config.yaml`. Disable persistent memory and state-mutating hooks in these experiment States. Align the State's turn limits, including `compaction.max_session_turns`, and the runner's limits with the benchmark. These settings do not clear the continuing training conversation.

Snapshot this base before adding learning instructions. Pass the selected provider, model and thinking level explicitly to every launch, including delegated task-solving calls.

## The training State

Copy the base, then install:

| Toolkit file | Destination relative to the training Agent State |
| --- | --- |
| `references/training.md` | `skills/skilladam-training/SKILL.md` |

Add `training-request.json` at the State root. It contains this run's benchmark, training unit and cases, sampling seed when applicable, batch rule, finite proposal iteration count, optimizer parameters, acceptance rule, runtime and export locations. Test repetition indices belong to the controller's test schedule and do not create additional training requests.

Write `skills/skilladam-training/benchmark-training.md` from the selected benchmark's learner-facing instructions: where training inputs and tools are, how to request feedback, what the score means, and where to export answers, the final Skill and learning records. Include the selected training material; held-out questions and repository grader files do not belong in this brief.

Add a short reader instruction to the training State's `AGENTS.md`:

```text
For a whole training run, read training-request.json beside this file and
skills/skilladam-training/SKILL.md, then complete the learning process in
this continuing Session and environment. For a delegated rollout or single
task, follow only that solving request; do not start an optimization loop.
```

The training Target receives learner instructions, not the outer experiment-controller Skill.

## The test States

After training, identify the last accepted Skill from the learning records and preserve its complete folder. Prepare two test States: the pre-training base, without a learned Skill unless the user supplied one, and the same base with the final Skill. Test States receive neither training method instructions nor optimizer history, training answers or conversations.

Use the same reader instruction in all test States:

```text
Complete the supplied benchmark task. If a learned task-solving Skill is
installed in your Agent State, read its SKILL.md and relevant supporting
files before substantive task actions, and apply it to this task.
```

Keep each State frozen during measurement and record its version and digest. Reuse the same archive for all three test repetitions of that State, restoring it into a fresh environment and conversation for each case. Test outputs stay outside the frozen archive. Preserve existing snapshots; distinct States of the same Agent use distinct versions.

## State handoff

Follow the runner's current State-import contract. For the Penguin Harbor adapter, `agent_state_tar` takes an archive whose root contains the State files, not an enclosing `agent_state/` directory:

```bash
tar --exclude=./.vault.toml --exclude=./memory --exclude=./schedule \
  -czf "$STATE_TAR" -C "$STATE_DIR" .
```

The executable installation and the Agent State are separate inputs. Pass the frozen archive to the adapter using the argument documented by the benchmark. Verify that each requested learned Skill reaches its corresponding test State before launching tests.

## Source-built runtime when requested

Method instructions and learned Skills travel in State archives. Use the Benchmark's normal executable installation unless a source build is requested. Prefer a prepared bundle; otherwise follow the current adapter's installation-bundle contract and stage the CLI with its production dependencies, plugin resources, Benchmark packages and compatible runtime. Keep credentials and State separate. Record the source commit and bundle digest, and reuse that executable for all trials; candidate Skill edits only change the State.
