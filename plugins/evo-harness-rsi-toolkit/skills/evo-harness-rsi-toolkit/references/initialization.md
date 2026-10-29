# Prepare the selected Benchmark

Install host Python 3.11+ and `python3 -m pip install -r scripts/requirements.txt`
for YAML task manifests. Use `scripts/resources.py` to resolve the installed name
or package path, acquire the declared source anonymously and record its commit:

```bash
python3 -B scripts/resources.py resource-request.json
```

The request contains `project` (the Environment App Data Dir), `dataset` (for
example `024`, `GDPevo DataAnalysis` or an absolute native package path), a fresh
`output` receipt path and any requested runtime/budget. Existing public
`evo-experiment.json` supplies otherwise unspecified settings. Ordinary packages
also need `test_benchmark`; continuous GDPevo manifests declare their pair.
The receipt records source commits, native task/member
paths, feedback/export interfaces, limits and missing inputs. It makes no model,
container or scoring calls. Resuming reuses the saved preparation.
Review its capability and package availability before launching. Keep budget
authorization from the actual request; a missing value is not permission to run.

Read `benchmark_config.toml`, the Case `statement/README.md` files and their
linked task manifest and runtime README. These determine the Train/Test mapping,
source revision, native task path, installation, feedback route, answer paths,
Skill export and scoring. A combined Train Case may contain several questions;
it is one learning trial, not one trial per question. Resolve aliases such as
`024` from documented IDs and descriptions; if ambiguous, report the candidates.
Do not infer a source directory from the number or hardcode a GDPevo-only path.

Follow the installed package's source links. Current built-in GDPevo statements
link the official `penguin-harness-benchmark` task/adapter resources and identify
GDPevo as upstream data. That official resource cache is still a runtime
dependency of those packages; this plugin does not require an Evo-specific
benchmark fork or modified benchmark checkout. Do not describe this as a
direct-GDPevo-only runtime. A package providing native tasks and an adapter in
Harness can use those instead without changing Evo's learning method.

A built-in package can contain run
descriptions while its data and environments live in the linked repository.
For repository-backed tasks, require the full 40-character lowercase commit named
by the statement. The Task link, run-rules link and checkout instruction must name
the same commit. Record the repository URL and commit, then fetch that checkout once;
reuse it throughout training and all baseline/final test repetitions. A requested
version selects a matching package; do not substitute a branch, tag or task revision
beneath the installed statements. Use the declared official resource cache and record it; do not introduce a
second method-specific checkout or silently substitute tasks or graders. Preserve native task
conversion, split and scoring behavior.

Use the current CLI, model connection and documented adapter. Keep credentials
inside its supported private transport. Check Docker/runner availability,
source checkout, output paths and feedback capability before training. Evo needs
the complete authorized grade delivered to the original Solver before its
Session ends, or through `input_subagent` continuing that same Session. A
post-exit-only verifier cannot replace this capability. Never self-score a
failed grader or create a new Reflector to reconstruct the conversation.

Record the experiment version, Harness/runner/toolkit versions, actual source
commit, model/thinking level, training roster/order, topic,
negative-feedback predicate, limits, budget, repetition count and output paths.
Prefer the user's specified versions; otherwise resolve the available versions once.
Record a concrete model revision when exposed, or leave it unknown alongside the
actual provider/model identifier. Keep this configuration fixed through testing.
Keep a job index with phase, benchmark, State digest, case, repetition, native
job/Session ID and completion status. Do not overwrite earlier experiment data.

## Common base and training State

Use the requested base Agent or create a separate one through the native CLI:

```bash
penguin agent create --agent-id <unused-id> --project-id <project-id> --json
```

Freeze the common base before installing learning instructions. Disable memory,
schedules and state-mutating hooks; record the effective runtime and limits.
Make an isolated training copy. Install `training.md` as its training Skill,
`roles.md` beside it and `evo.py`, `feedback.py` and `state.py` in its scripts
directory. The host-only resource resolver needs PyYAML; these container helpers
use the Python standard library.
Add `training-request.json` and `benchmark-training.md` at the training State
root. The brief contains only public training inputs, business tools, allowed
feedback route, scale/predicate and output paths. Private grader files, held-out
tasks and credentials do not belong in the brief. The request records the
frozen setup above, starting with an empty library unless a base was requested.

The training State's `AGENTS.md` tells its main Target to read those two files
and its training Skill, then coordinate exactly one batch. Delegated Solvers
follow only their task and reflection roles; they do not start another learning
controller. Use inline `prompt` with full role text, explicit provider, model_id
and thinking_level on `run_subagent`. Do not use nonstandard prompt-file,
working-directory or permission arguments. Children share the parent workspace;
give each its own output paths and serialize access to shared business state.

## Export and frozen test States

The helper's `export` command writes a fresh staging directory with a nonempty
root `SKILL.md`, `manifest.json` and one directory per independent method. Save
its stdout receipt, including all file hashes and the exact topic context. This
layout satisfies the continuous training submission contract even for an empty
learned library. In GDPevo, copy the complete staging contents into this run's
`/app/submission/skill/`, including the root Reader. A prepared submission folder
may already exist; do not weaken export's no-overwrite rule or regenerate an
already frozen package. Publish the staged bytes to that run's designated slot.

Install the receipt into a fresh copy of the common base before snapshotting:

```bash
python3 -B scripts/evo.py install --request export-receipt.json --state <native-state>
```

The installer verifies every file and reconstructs the exact topic context. It
maps the root Reader into `skills/evo-reader/` and each method into its own native
`skills/evo-method-.../` slot, then appends one delimited `AGENTS.md` block. It
preserves common instructions and configuration, rejects changed exports or
conflicting old Evo slots, and is idempotent for the same frozen package.
Copy the source receipt and frozen package to the host before installation;
update only the receipt's `directory` to that exact copied package path and
verify its recorded hashes. Baseline installs the same Reader with an empty
library. Both test States start from the common base, not from each other.

Keep automatic extra Skill discovery disabled (`skills.enabled: false`), since
the complete learned context is in the initial system prompt. Do not change
State between test cells. Verify `context_sha256` against each actual native
Session's system prompt block. Never select, clip or retrieve methods per task.

Build both test States from the same common base. They receive no training
Skill, private library, candidates, grader material, answers, conversations or
memory. Keep all independent exported methods plus Reader/manifest within the
16,000-byte limit; the helper rejects overflow without dropping methods. Keep
private general bodies only in learning artifacts. Record State versions and
archive hashes; reuse the exact frozen archive for each case/repetition.

For a Harbor State handoff, pack the State contents at the archive root, omitting
vault, memory and schedules. Supply its existing adapter arguments as the
benchmark README specifies; install bundles are needed only when that runtime
requires one. Do not put an enclosing `agent_state/` directory inside the tar.
Test States are immutable throughout measurement.

When using a source-built CLI, follow the selected adapter's `install_bundle`
contract. Stage the CLI's production dependency graph, plugin resources and
compatible Node runtime; verify the archive without host-side dependencies.
Keep credentials and State outside that executable bundle, and reuse the same
bundle/version for Train and every Test. The benchmark's published-runtime path
is sufficient when it already supports the native tools used by this method.
