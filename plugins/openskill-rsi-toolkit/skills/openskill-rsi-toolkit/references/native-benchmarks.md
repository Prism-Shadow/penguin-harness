# Use a Project Benchmark

Start from the Benchmark already published in this Project. The user supplies a Benchmark
name or id, a Target (or requests a new one), and a model; they need not supply a task
repository or an experiment script. The Skill owns the remaining orchestration.

## Discover and bind

1. Resolve `PROJECT_DIR` from the Environment's App Data Dir. Read only the selected
   Benchmark's `benchmark_config.toml` and construction statements. To resolve a title,
   list Project Benchmark manifests, not their rubrics or scoreboards. If the title is
   ambiguous, ask which package. Never import or replace an existing package automatically.
2. Inspect it with the shipped helper:

   ```bash
   python3 "<skill_dir>/scripts/native_benchmark.py" inspect \
     "<PROJECT_DIR>" "<benchmark_id>" --runs <runs>
   ```

   Omit `--runs` for three complete test repetitions of the same frozen State. An explicit
   user count wins; the manifest's original count remains recorded separately in the binding.
   Optional `--case <case_id>` selects construction Cases; optional
   `--test-benchmark <id>` declares a separate evaluation set, with optional repeated
   `--test-case <id>` for a subset. The helper reads only that
   set's manifest and directory names, never held-out statements, inputs, rubrics or scores.
3. A Workspace Case uses its local `statement/` as public input. A Harbor Case uses the
   repository, revision, `-p` directory and `-i` task named by its statement. Do not derive
   task paths from old GDPevo names or assume a shared `benchmarks/gdpevo/tasks/` directory.
   Resolve the linked branch/tag once to a full commit; pin it for this whole experiment,
   including both post-freeze evaluations. The local installed package and its statement
   hashes are authoritative: never replace them with a newly downloaded package.
4. For Harbor, follow [harbor.md](harbor.md) §A for the shared checkout and prerequisites.
   During construction, read only its run instructions, selected `task.toml`, selected
   public instruction/input files and environment build files. Do not run Harbor, build
   the evaluator matrix, read result/selection records, or inspect `tests/` or `solution/`.
   The checkout may contain private material, but is never mounted into a construction role.
   Record repository URL, linked ref, resolved commit and actual checkout. Resolve all
   construction links consistently; differing repositories/revisions need separate bindings.
5. Stage the public input binding into a fresh directory in this controller's Session
   scratchpad, outside the future executor OUT:

   ```bash
   python3 "<skill_dir>/scripts/native_benchmark.py" stage \
     "<PROJECT_DIR>" "<benchmark_id>" \
     --checkout "<pinned_checkout>" --revision "<40_hex_commit>" \
     --out "<controller_session_scratchpad>/benchmark-inputs" --runs <runs>
   ```

   For Workspace Cases, omit `--checkout` and `--revision`. The helper refuses existing
   output directories, linked inputs, source/task mismatches and unpublished Benchmarks.
   It writes `binding.json` and a public file hash manifest for each construction Case.
   It does not prepare a reviewed image or attest isolation. For tasks whose public data
   lives only in the image, the controller must still review and explicitly stage those
   inputs; do not infer missing data from the task's scorer.
6. Copy `binding.config` into the executor config and include the full binding as
   `benchmark_binding`. Review every staged file before copying it to
   `OUT/tasks/<case_id>/inputs/public/`; derive creator `public` maps from those copies.
   Keep binding metadata, source paths and environment build recipes controller-only.
   The executor rejects mismatched Benchmark, Case, held-out set or run-count settings.
   Follow [initialization.md](initialization.md) and [executor.md](executor.md) for the
   Target snapshot, actual model pair, runtime preflight, images and construction.

Before each final matrix, run `python3 <skill_dir>/scripts/native_benchmark.py verify
<binding.json>`. It checks the same package metadata, construction statements and staged
public hashes without opening held-out statements. Initialization performs the same check.
Never rewrite a binding to hide changed source inputs.

## GDPevo domain Train/Test packages

GDPevo now publishes domain pairs, for example
`penguinharness-benchmark-gdpevo-crm-train` and
`penguinharness-benchmark-gdpevo-crm-test`. Use the installed manifests; the names below
describe a layout, not a frozen task catalog.

```text
PROJECT/benchmarks/<domain-train>/CASE-001-train_tasks/statement/README.md
PROJECT/benchmarks/<domain-test>/CASE-001-<domain>-test-001/statement/README.md

CHECKOUT/benchmarks/<domain>/tasks/
  env/                          shared business service source
  train_tasks/
    task.toml
    environment/
      Dockerfile
      workspace/train_tasks/train_001/{instruction.md,input/...}
      workspace/train_tasks/train_002/{instruction.md,input/...}
  <domain>-test-001/             held out until freeze
```

The Train package has one composite Case containing several public questions. Keep that
published Case as one construction task with one persistent creator and one fixed plan of
1–4 reusable skills. The staged `task.md` lists each question and its final answer path;
the creator request declares **all** those paths. Report both the number of Cases and the
number of questions. Do not invent five scoreboard Cases or silently treat one group as
five independent experimental repeats. This composite-task setting and deployment of a
shared library across held-out questions are Penguin adaptations.

For a grouped Train package, the helper selects the installed same-domain `-test` package
unless the user supplied an explicit held-out Benchmark. If it is absent, explain what is
missing; never fall back to training scores. A request that names only a GDPevo Test package
does not authorize learning from it: use the paired Train package for construction, with
the requested Test as `--test-benchmark`, or evaluate an explicitly supplied frozen library.
Never read Test task contents to tailor the skills or the routing index.

The native continuous-training wrapper permits `POST /api/judge`. That is a **real target
score**, not an OpenSkill virtual test. Do not give that wrapper or its feedback instructions
to construction roles. The helper stages individual public questions and an OpenSkill
submission contract instead. Remove judge assets from practice images, use the trusted
`startup_profile: gdpevo` (which sets `TASK_ENV_ENABLE_JUDGE=0`), and require its readiness
probe to confirm that the judge returns 404. Independent source-backed virtual tests remain
the only feedback channel. Use fresh practice environments between revisions as the executor
requires; do not adopt the wrapper's judge-driven continuous-training loop.

Build a **separate** practice context in scratch space. Take the selected task's
`environment/` plus the adjacent shared `tasks/env/` referenced by its Compose build context;
never use the old `task_group_*/tgNNN-train` layout. Review the Dockerfile and start script.
Exclude `judge_train_eval/`, `judge_evaluators/`, training-score files, hidden tests,
solutions and old skills from both contexts. When the business service imports `judge_api`,
provide an inert API shim that returns disabled/404 and cannot evaluate answers; do not copy
the original grading implementation. Remove build/start instructions that require those
excluded assets. Keep the business service, data generation, user ownership, ports and
public API behavior intact. Add Python/pytest for virtual tests, pin the built image id and
record these changes. The original checkout and official evaluation images stay unchanged.
An image that cannot satisfy these conditions must fail preflight, not run with the judge
enabled. The supervisor's environment variable alone is not a substitute for removing graders.

After all construction Cases finish, freeze the last skill revisions and the library once.
Run Baseline and OpenSkill on the paired **Test** package with exactly the same runtime,
Case set and run count, three repetitions per frozen State by default. Construct the library
once, and keep fresh environments and conversations across test cells. Follow
`experiment-organization.md` for scheduling and sample standard deviations. Record those complete matrices in that Test package's
`scoreboard.yaml`. Train has virtual-test evidence and final saved answers, not an official
continuous-training score from this procedure. Do not call the native training judge later
and mix that extra experiment into the original results.

## Evaluation Center wording and resume

The Evaluation Center's generic launch tail may say to measure “baseline and every
candidate.” For this Skill, candidates are virtual skill revisions: measure them only with
the independent virtual verifier. The score-bearing published States are the untouched
Baseline and the one final frozen library (plus an explicitly requested reader control).
Explain this timing in one sentence and proceed with OpenSkill. An explicit user request
to train on real benchmark scores changes the method and requires clarification; do not
silently relabel supervised optimization as OpenSkill.

Resume the recorded OUT using `status` and `next`. Keep completed construction and valid
evaluation cells; repair only the unresolved operation when the executor permits it. A
formatting repair resends the existing worker result. A stopped run stays stopped, and a
new run must not pretend to inherit its budgets. Source refs are never re-resolved between
Baseline and OpenSkill. Record invalid/missing cells as failures, never as zero or a partial
mean. The final report links the native Session, binding, freeze and actual evaluation traces.
