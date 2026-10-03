---
name: benchmark-reproduction
description: Reproduce an existing benchmark from a GitHub URL, name, or local checkout as runnable Penguin Benchmarks, verify smoke runs, then ask before running the full evaluation.
---

# Benchmark Reproduction

This Skill defines general inputs, construction choices, Penguin output formats
and verification. Benchmark-specific recipes live in references. Fetch datasets
and generate any needed adapters only when requested, inside the destination
Project; do not bundle them into Penguin or make them default benchmarks.

## Before you start

Resolve the source URL/name/local checkout, destination Project and Test Agent
for smoke runs. Use `agent-initialization` if a new experimental Agent was requested.
Resolve a complete Target Agent provider/model pair and configured thinking, with the
same inheritance rules as Agent Tuning. Ask only for required missing information.
Before dispatch, parse the Target Agent config with duplicate-key rejection and verify
the requested identity/runtime. Initialization defects are not Target Agent scores.

Choose the recipe:

1. Use the user's custom construction prompt when supplied. If they reject both
   a reference and the generic method without giving an alternative, ask exactly
   **“你想怎么构造？”** and wait. Do not ask again when the prompt is already clear.
2. Match the canonical repository/name below and read its reference. Ignore case,
   `.git`, trailing `/` and `tree/<ref>` when matching; retain the requested ref
   for checkout. Verify compatibility for a fork or a newer revision.
3. Otherwise follow the generic construction rules in this Skill.

Available benchmark recipes are indexed below; unknown sources use the generic
rules that follow.

| Repository / names | Recipe |
| --- | --- |
| `Prism-Shadow/GDPevo`, `GDPevo`, `GDP EVO` | [GDPevo](references/gdpevo.md) |

Resolve an ambiguous name to a repository before proceeding. A custom recipe can
change the construction choices but must still produce valid Penguin formats
and accurately report what was run. Add future benchmark recipes as references;
do not add a dedicated plugin or a platform switch for each benchmark.

## Fetch and choose the split

Clone into a dedicated local preparation directory or use a supplied checkout
without changing it. Pin the actual commit. Read the source license, instructions,
task manifests, environment and graders before running code. Record dependencies
and any adaptations; inaccessible source or required credentials are blockers.

- **Official train/test:** create `<name>_train` and `<name>_test` preserving source
  membership. Map source IDs to `CASE-*`. If validation exists, retain its distinct
  role and optionally create `<name>_validation`; never call it final testing.
- **Long-running task/trial stream:** create two benchmarks with identical task
  definitions, inputs, case IDs, environment recipe and scoring. Their phase
  records and scoreboards differ. Predeclare a trial/time boundary, such as the
  first 30 trials or three hours for training and the rest for testing. These are
  examples, not universal defaults. Use the source protocol or ask for the cutoff
  and total budget when unspecified; define time accounting and crossing trials.
- **Finite tasks without a split:** propose a deterministic 80/20 task split with
  a recorded seed, grouping related customers/templates/repositories to prevent
  leakage. Mark it as an adaptation and keep both sets nonempty. If no meaningful
  task or temporal split exists, ask how the user wants to construct it.

For a continuous task, save its boundary environment and required observation
history; testing resumes from that state with the Target Agent harness frozen. For
independent trials, reset as the source does. An external controller manages the
handoff; Target Agents never update their own persistent harness. Base/final testing
uses the same boundary snapshot and budget. Record this as temporal continuation,
not independent held-out-task generalization. Future observations, Optimizer analysis
and test answers cannot leak into training. A short smoke probe uses disposable
state, not a replacement for the declared full temporal window.

## Output format

Resolve `PROJECT = <Environment App Data Dir>`. Create new IDs below
`PROJECT/benchmarks/`; do not overwrite existing benchmarks or scores. Explicit
resume requires matching source, recipe and file hashes.

```text
benchmarks/<name>_train/          # companion: <name>_test/
  benchmark_config.toml
  scoreboard.yaml
  reproduction.yaml
  runtime/                       # optional benchmark-local resources
  CASE-<source-id>/
    statement/
      README.md
      input/...                  # preserve relative payload paths
    rubric/
      README.md
      source/...                 # original grader/gold dependencies
```

Config fields are `title`, `description`, `runs = 1`, `status = "draft"`.
Initialize scoreboard with `evaluations: []`. Both material directories need
README.md. Case IDs must start with `CASE-` for the case-list API to find them;
the Statement's first heading is its displayed title.

Retain task objectives, inputs and output schemas. Record transport edits such as
URL substitution or an `answer.json` delivery line. Keep gold, graders, solution
notes and manifests containing private criteria out of Statement. Preserve shared
grader dependencies and directory depth. A preparer may read both splits to
package them but must not later become the training Optimizer or pass it test data.

In `reproduction.yaml`, record source URL/commit, chosen reference/custom prompt,
source-to-case mapping, split/cutoff, runtime mode/dependencies, score conversion,
source/adaptation hashes and smoke session references. This is local provenance,
not a new server schema. Do not store credentials or depend on preparation-only
absolute paths. Use the existing Agent Tuning scoreboard shape for complete
measurements; method-specific provenance belongs outside that scoreboard.

## Make the next evaluation runnable

Reuse upstream runners. Generate a small benchmark-local helper only when needed
for a repeatable handoff. Each Rubric's `## Runtime` section must give the evaluator:

- Prerequisite checks and exact setup commands; fresh private run storage outside
  the Target Agent workspace, readiness evidence, and public runtime bindings.
- Per-run reset or temporal-restore instructions, without changing frozen benchmark
  files. Bind URLs only in the copied Statement.
- An explicit Target Agent artifact argument to the original scoring command, accepted
  exit codes, score field/scale, partial-credit and malformed-answer rules.
- Cleanup of owned resources after scoring or failure, with lifetime bounds where
  needed. A server left running after reproduction is not a repeatable setup.

Give each concurrent cell its own saved workspace/run paths. Reuse those exact
paths; never rediscover the newest workspace or use a shared temporary filename.
Keep the service alive across tool calls using a managed background process or
supervisor with redirected input/output. Check readiness after the launch tool
returns and again before scoring; a bare shell `&` may die with its parent shell.

`agent-evaluation` reads these instructions; there is no benchmark-specific branch
in Penguin source. Express rubric weights as exact fractions totalling 100 and
map the original score to `0..100`. Read the scorer instead of guessing by a
field's name. Missing dependencies, invalid grader output and unavailable services
are infrastructure failures, not Target Agent zeros. Preserve legitimate partial credit.

Use Docker when required and usable; check its daemon. If local execution is
allowed, use isolated dependencies, fresh workspaces, owned processes and free
ports, and report the actual mode. If the Target Agent runs elsewhere, verify its
endpoint reachability; evaluator-local `localhost` is insufficient. State the
actual file/network isolation level. Never substitute mocks and call them the
original environment. Prepare dependencies before evaluation, not inside the
Target Agent's task. Do not modify the Test Agent's persistent harness to host adapters.

## Smoke, publish, ask

Default to two representative cases per split, one run each, or one short
lifecycle probe per split for a long-running task. Honor a smaller user budget;
count every started Target Agent. Cover distinct selected environment/scorer types.

First check representative official gold/oracle output and a negative control.
Then delegate complete fresh Target Agent executions through `agent-evaluation`, with
runtime setup, source grading and cleanup. Its request fields remain
`protocol_version: 1`, `case_id`, `run`, `expected_version`, `test_agent_id`,
`benchmark_id`, `provider`, `model_id`. Freeze Target Agent State/runtime; explicitly
pass its configured thinking at launch. For stored `none`, omit that unsupported
CLI flag and clear only `PENGUIN_SESSION_ID` for the Target Agent command, preserving
explicit identity/model/workspace flags and connection/auth configuration.

Keep actual scores, artifacts, bound session IDs, costs and setup/cleanup evidence.
Wrong answers are valid scored executions; do not rerun them to improve smoke
results. Environment, protocol or grading failure blocks publication. Fix real
adapter defects and rerun only affected coverage with a new attempt record.
Grader-only checks do not establish that the Agent execution path works.

Use an independent smoke Agent/Reporter and keep test probes from the future
Optimizer. Record smoke as development coverage, not a complete Formal Baseline or
an RSI result. Leave scoreboard empty until a complete evaluation of the declared
case set exists; never insert partial/oracle matrices as full evaluations.

Once construction, smoke and cleanup pass, set `status = "published"`. Reproduction
preserves existing tasks, so Benchmark Design's below-85 calibration gate does
not apply. Leave a blocked build draft; mark an abandoned invalid build failed.

Check the existing `/api/projects/<project>/benchmarks` list, then each
`/<benchmark>/cases` and case `files`/`rubric/files` endpoint. Confirm expected IDs,
counts and readable materials. If only filesystem checks were possible, report
Evaluation Center visibility as unverified rather than claiming completion.

Report benchmark IDs/paths, pinned source, recipe, split/cutoff, runtime mode,
smoke cases/sessions, cost, limitations and how to run again. Then ask
**“冒烟测试已完成，要不要跑全量测试？”** with proposed case/run counts and any
available cost estimate; wait for the answer. Prior explicit full-run authorization
still applies within its budget. Do not begin RSI optimization as part of reproduction.
