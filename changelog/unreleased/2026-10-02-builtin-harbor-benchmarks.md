# Five built-in Benchmarks (PenguinHarness Benchmark Sec A–E), written when a Project is created

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#956](https://github.com/Prism-Shadow/penguin-harness/pull/956)

[中文版](2026-10-02-builtin-harbor-benchmarks.zh.md)

A new Project started with five built-in Benchmarks besides `example-benchmark`: PenguinHarness
Benchmark Sec A to Sec E, subsets of rag-bench-essential (Data Analysis Bench), DeepSWE v1.1,
AutomationBench, Terminal-Bench-Science 0.1 and Terminal-Bench 4.0, each chosen to run on CPU-only
Docker. Their cases ran as Harbor tasks kept in the public repository
Prism-Shadow/penguin-harness-benchmark, which also held the rules for running them; the product
stored only text, and the Evaluation Center's Evaluate flow ran them through the
`agent-evaluation` Skill. The example and the five were written once, when the Project was
created.

## Details

- **What a Project starts with.** The server wrote the example and the five when it created a
  Project: a Project created through the API, a new user's own default Project, and
  `default_project` at a fresh install's first start. Each was written into a temporary directory
  under `benchmarks/.seeding/` and renamed into place; a write that failed failed the Project's
  creation, which was rolled back. An id whose directory already existed was skipped, never
  written into. Nothing wrote them again afterwards: initializing or loading `default_agent` no
  longer touched `benchmarks/`, so a deleted one stayed deleted, and the example was no longer
  written back on every load. No marker file recorded any of it.
- **The five.** Their ids were `penguinharness-benchmark-sec-a` to `-sec-e` and their titles
  PenguinHarness Benchmark Sec A to Sec E; each description opened with the original benchmark
  ("Sec A is rag-bench-essential (Data Analysis Bench): …"). Each was written with `runs = 1`,
  `status = "published"`, no evaluations and ten cases: the final 50 tasks of the benchmark
  repository's `selection.json` files. The sets were calibrated on the measured model: Sec A–C
  swapped the tasks it passed in every attempt for harder ones, and Sec D was chosen anew, with
  caps of 40 minutes and 320 turns and a launch that told the agent its time budget in one
  sentence before the task's instruction. The definitions were data in
  `packages/core/src/state/builtin-benchmarks-data.ts`, where a case's number followed its row. A
  case directory was `CASE-NNN-<Harbor task>`. Its statement gave a short description, the task
  folder's link in the repository at a pinned commit, the provenance and the container's
  resources, and a `## How this case is run` section: a link to the repository's rules for
  running a task (its README section "Running a task (for agents)"), the exact `harbor run`
  launch with the per-trial caps, and the prerequisites. Its rubric was the verifier's reward ×
  100. Statements linked the repository's measured results (`results/v0.2.13/README.md`) rather
  than repeating them. A test marked as expected to fail held every link to a 40-character commit
  until the results commit is pinned.
- **Format.** A built-in's `benchmark_config.toml` held `title`, `description`, `runs` and
  `status`, like any Benchmark's: no field marked how its cases run.
- **API.** No new fields: `GET …/benchmarks` listed the five as plain published Benchmarks.
- **Web App.** The built-ins showed like any other Benchmark. A run recorded as
  `harbor:<trial>`, which is no Session the app can open, showed a button in the evaluation
  dialog that copies the trial's name.
- **The model under test.** The Evaluate prompt, the same for every Benchmark, stopped pointing at
  a model the Test Agent "is configured with": it named the evaluation conversation's own model,
  which the evaluator agent read once from the `Provider` and `Model ID` lines of its Environment
  and sent in every cell's request, at the Test Agent's configured thinking level. The prompt
  named no model itself, so a model changed in the composer before sending was the one tested;
  the dialog's model hint said so. `agent-evaluation` gave every caller the same rule (its own
  instructions' pair, else its Session's; stop and ask the user when neither is complete), and
  caller and worker alike a rule never to read the server's `api-token`, a Project's
  `.project_config.toml` or the server's `web.db`, nor to call the server API with a token read
  from disk.
- **Skill.** `agent-evaluation` (agent-tuning `2026.10.04.2`) recognized a case run through
  Harbor from its statement — a `## How this case is run` section naming Harbor, a repository at
  a 40-character commit and the `harbor run` launch — and followed the repository's run rules for
  fetching it, the launch, concurrency and Docker networks, retries and reading `result.json`. A
  statement that linked a branch or a tag was `benchmark_invalid`. The new `reference/harbor.md`
  kept the product-side contract: the caller built a checkout named by the commit under
  `benchmarks/.harbor/`, published in one rename and never changed afterwards; each cell ran one
  Harbor trial with the repository's PenguinHarness adapter, which carried the tested agent's
  Agent State (without its vault, memory and schedules) and its Project's saved model entry into
  the task container, and the repository's helper named the host a no-network task allows. The
  score was the reward × 100, the cost the trial's `agent_result.cost_usd`, the duration the agent
  phase, and the Session id `harbor:<trial>`; the trial's files stayed under the Benchmark's
  `.jobs/`. There was no Vault step. A caller ran at most four cells at a time; trials whose
  statement carried the shared-network line joined one Docker network, `penguin-bench`; a cell
  whose trial Docker could give no network was run once more at lower concurrency and never
  counted as a 0. `benchmark-design` left these Benchmarks alone, and `agent-optimization` used
  them like any published Benchmark without reading the tasks' tests or the verifier's output.
- **Docs.** The Evaluation Center page gained a "Built-in Benchmarks" section listing the five
  with their original benchmarks, and it and the Self-Improvement page described when a Project
  is given the example and the built-ins, and the model an evaluation from the Evaluate tab runs
  on.

## Existing Projects

A Project from an earlier release was left as it was: it was not given the five, an
`example-benchmark` it had stayed, and one its user had deleted was not written back (earlier
releases wrote the example again on every load of `default_agent`). New Projects, and
`default_project` of a fresh install, started with all six.
