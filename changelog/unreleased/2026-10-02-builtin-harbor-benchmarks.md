# Five built-in Harbor Benchmarks, and Benchmarks given once per Project

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#956](https://github.com/Prism-Shadow/penguin-harness/pull/956)

[中文版](2026-10-02-builtin-harbor-benchmarks.zh.md)

Every Project gained five built-in Benchmarks taken from public evaluation sets: `terminal-bench`
(Terminal-Bench 4.0), `terminal-bench-science` (Terminal-Bench-Science 0.1), `deep-swe` (DeepSWE
v1.1), `automation-bench` (AutomationBench) and `rag-bench-essential` (Data Analysis Bench), each
a subset that runs on CPU-only Docker. Their cases run as Harbor tasks. The task files stayed out
of this repository, in the public repository Prism-Shadow/penguin-harness-benchmark, and the
Evaluation Center's Evaluate flow runs them through the `agent-evaluation` Skill. A Project is now
given these and `example-benchmark` once each, so a deleted one stays deleted.

## Details

- **Given once.** default_agent's initialization and every later load gave the Project each
  Benchmark it had not been given yet and recorded it in `benchmarks/.seeded.json`; a deleted
  one was not written back, and a later release that adds a built-in gives just that one. Each
  Benchmark was written into `benchmarks/.seeding/` and renamed into place before it was
  recorded, so a crash left no half-written Benchmark and no record of one that was never
  written. A directory of the user's own under a built-in Harbor id was never written into, and
  that built-in was given once the directory was gone. Removing an id from the marker gave that
  Benchmark again. `example-benchmark` moved onto the same rule with its content unchanged; it
  had been written again on every load after a deletion. Two processes on one data root (the
  server and a CLI) could provision at the same time: every write of the marker read it again
  and wrote the union, a Benchmark the other process placed first counted as given, and only
  staging entries an hour old were cleared. An unreadable marker gave nothing and was reported
  once per process on stderr.
- **The five.** Each shipped with `runs = 1`, `status = "published"`, no evaluations and ten
  cases: the final 50 tasks of the benchmark repository's `selection.json` files. The definitions
  were data in `packages/core/src/state/builtin-benchmarks-data.ts`, where a case's number
  followed its row. Statements and the docs linked the repository's measured results
  (`results/v0.2.13/README.md`) rather than repeating them.
- **Format.** `benchmark_config.toml` carried `kind = "harbor"` and a `[harbor]` table: `repo`,
  `ref`, `path`, `agent`, `harbor_version`, `run_timeout`, `max_turns`, `allow_agent_hosts` and,
  for rag-bench-essential, `setup`. A case directory was `CASE-NNN-<Harbor task>`. Its statement
  gave a short description, the task folder's link at `ref`, the provenance, the container's
  resources and the `harbor run` command; its rubric was the verifier's reward × 100. A test
  marked as expected to fail held `ref` to a 40-character commit until the results commit is
  pinned.
- **API.** `GET …/benchmarks` reported `kind: "harbor"` and `harbor: { repo, ref, path }` for such
  a Benchmark. A `kind` without a usable `[harbor]` table, or any other value, read as a plain
  Benchmark, and the manual create route still wrote plain ones only.
- **Web App.** A Harbor Benchmark's card and page title carried a neutral **Harbor** tag, and its
  page linked the repository at `ref` under **Task files**. The Evaluate tab added one line on what
  the run needs: Docker and uv where the evaluator agent runs, and a saved API key for the model
  the evaluation runs on. A run recorded as `harbor:<trial>` showed a button that copies the
  trial's name.
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
- **Skill.** `agent-evaluation` (agent-tuning `2026.10.03.1`) gained `reference/harbor.md`. The
  caller resolved `ref` to a commit and built a checkout named by it under `benchmarks/.harbor/`,
  published in one rename and never changed afterwards. Each cell ran one Harbor trial with the
  repository's PenguinHarness adapter, which carried the tested agent's Agent State (without its
  vault, memory and schedules) and its Project's saved model entry into the task container; the
  repository's helper named the host a no-network task allows. The score was the reward × 100,
  the cost the trial's `agent_result.cost_usd`, the duration the agent phase, and the Session id
  `harbor:<trial>`; the trial's files stayed under the Benchmark's `.jobs/`. There was no Vault
  step. A caller ran at most four cells at a time. Terminal-Bench and Terminal-Bench-Science
  trials joined one shared Docker network, `penguin-bench`, through the repository's
  `tools/docker/shared-network.yaml`, and DeepSWE's never did. A cell whose trial Docker could
  give no network was run once more at lower concurrency and never counted as a 0.
  `benchmark-design` left Harbor Benchmarks alone, and `agent-optimization` used them like any
  published Benchmark without reading the tasks' tests or the verifier's output.
- **Docs.** The Evaluation Center page gained a "Built-in Harbor Benchmarks" section, and both
  it and the Self-Improvement page described the once-per-Project rule and the model an
  evaluation from the Evaluate tab runs on.

## Existing Projects

A Project from an earlier release was given the five on its default_agent's next load. An
`example-benchmark` it already had was recorded as given and kept as it was; one its user had
deleted was written once more, when the marker was first written, and never again.
