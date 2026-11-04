# PRFC-0019 RSI Toolkits

[中文版](PRFC-0019-rsi-toolkits.zh.md)

> **Source**: `rfcs/PRFC-0019-rsi-toolkits.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — landed (default branch `main`, commit [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)).
> **Rev**: v1.0.0 (migrated into the main repository); the conventions for this surface are in [README.md](README.md), and changes from version to version are recorded in `## Changes` at the end.

- Feature Name: `rsi_toolkits`
- Start Date: 2026-10-10
- PRFC PR: [Prism-Shadow/penguin-harness-design#293](https://github.com/Prism-Shadow/penguin-harness-design/pull/293)
- Implementation PR: [Prism-Shadow/penguin-harness#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030) (replaces [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985))
- Related: 02 "TAX-020", 04 "MVP-005", 05 "Plugin library", "Benchmark evaluation and optimization"

## Summary
[summary]: #summary

PenguinHarness is positioned as a **Unified and Stable RSI Framework** (Recursive Self-Improvement Harness): automatic model optimization × Agent Harness — the model is fixed, what evolves is the Harness. Each self-improvement algorithm is distributed as an **RSI Toolkit** plugin: a new `rsi` category is added to the plugin library (Agent Self-Evolution), and toolkit names end with `-rsi-toolkit`; the original `agent-tuning` is split into three, with Skill names unchanged: `default-rsi-toolkit` (Default RSI Toolkit) contains only `agent-optimization`, carrying the default loop "try → reflect → improve"; question generation and evaluation (`benchmark-design`, `agent-evaluation`) become the `agent-evaluation` plugin (Agent Evaluation) in the AI Application Development category, and the default loop is measured through it; `agent-initialization` is moved into `agent-development`, which further splits the Workflow documentation (now called Agent Workbench, see [PRFC-0020](PRFC-0020-agent-workbench.md)) from `penguin-sdk` into a new Skill `penguin-plugin`; OPRO, APE, ACE, and AWM each become a plugin (`opro-rsi-toolkit` / `ape-rsi-toolkit` / `ace-rsi-toolkit` / `awm-rsi-toolkit`), each with a Skill bearing the plugin's name, running according to the original paper's procedure. Toolkits do not depend on each other: the evaluation protocol and `scoreboard.yaml` format are platform contracts, each algorithm toolkit carries an evaluation reference identical word-for-word, locked by core's tests. Benchmark reproductions do not belong to any plugin or Skill; they are unified in `Prism-Shadow/penguin-harness-benchmark`; packages imported there are a branch of `benchmark-design`. The web draft page — the startup dashboard for new conversations — lists three counts in a small panel on the right of the branding area, where "self-improvement algorithms" derives its count from the `rsi` category in the plugin library; the Evaluation Center gains a "method" choice in "Use → Optimize"… [line continues].

## Motivation
[motivation]: #motivation

The product positioning shifts to prioritize recursive self-improvement first, and one-sentence app generation second: with the same model, the Harness (prompts, Skills, tools, and hooks in Agent State) continuously improves. Previously, the platform had only one self-improvement algorithm — a default loop composed of `benchmark-design`, `agent-evaluation`, and `agent-optimization` (05 "Benchmark Evaluation and Optimization"), located in the `agent-tuning` plugin under the "AI Application Development" category. The literature contains far more algorithms, each with its own experimental protocol: OPRO proposes new instructions from scored historical instructions, APE infers instructions from input/output examples, ACE folds lessons from training trajectories into a rule handbook, and AWM infers workflow memory from successful trajectories. The framework's responsibility is to let each one **run according to the original paper's method** on the same set of Benchmarks, scoring, and snapshots, so results are comparable.

One algorithm per plugin, for three reasons:

- **Counts must be real.** "N self-improvement algorithms are now supported" can only be a derived value: count the plugins in the plugin library's `rsi` category. Hard-coded numbers drift with the code.
- **Installation and updates proceed per algorithm.** Users can install only the algorithms they need; each toolkit's Skill has its own date-based version; updating one algorithm does not make others appear updatable.
- **The default loop stays lean.** Making all algorithms into reference files in a single plugin ([#985](https://github.com/Prism-Shadow/penguin-harness/pull/985)'s approach), the default loop's several Skills must branch by method, and the text and its reference indices expand unbounded as algorithms grow.

Toolkits cannot depend on each other: the plugin library has no dependency mechanism, installation is per-plugin, and an Agent can install any subset. An algorithm toolkit requiring `agent-evaluation` fails at runtime on an Agent without the `agent-evaluation` plugin, and uninstalling that plugin silently breaks other toolkits. The default loop is the only exception: it is already composed of three steps — question generation, evaluation, and optimization — and question generation and evaluation are shared capabilities used by the Evaluation Center's "Evaluation" tab and Benchmark import, belonging to AI Application Development; so `default-rsi-toolkit` keeps only the optimization step, measured via the `agent-evaluation` plugin.

Benchmark reproductions also should not go into a plugin. A reproduced Benchmark is data plus a special running procedure (Harbor tasks in Docker, one business service per question set, varying scoring fields); writing it into a Skill binds each Benchmark's special case to the plugin's release cadence, and each new Benchmark reproduction requires changing the Skill once. The existing approach already points to a better place: built-in Benchmarks Sec A–E write their running method in each question's "How to run this question" section and the benchmark repository's README; `agent-evaluation` handles only the product side.

Concrete scenarios:

- A user says "reproduce APE" in one sentence; the platform creates an under-test Agent and Benchmark on the `ape-rsi-toolkit`'s built-in demo task, and after running, the Evaluation Center shows the score curve before and after optimization (03 "SCN-007").
- A user with an existing Benchmark and baseline switches the method from Default to OPRO in "Use → Optimize", leaving other fields unchanged.
- A new user opens the draft page and sees what algorithms this version supports, which Benchmarks it has reproduced, and the numbers do not go stale.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

**Plugin library.** The first category is "Agent Self-Evolution", listing `default-rsi-toolkit` and each algorithm toolkit, with the card's short description noting which toolkit it is ("Default RSI Toolkit: try, reflect, improve." "OPRO RSI Toolkit: optimize instructions by score."). They are pre-installed by default on `default_agent`; other Agents install via the plugin library or select during creation (the default loop must install together with the `agent-evaluation` plugin that measures it):

```bash
penguin agent create --agent-id writer --plugins default-rsi-toolkit,agent-evaluation,ape-rsi-toolkit
```

**Reproduce in one sentence.** The quick start for each algorithm toolkit is one line you can run directly. `ape-rsi-toolkit` and `opro-rsi-toolkit` come with a demo task (the Benchmark and question content complete in `references/demo-task.md`, not generated at runtime), so one sentence "reproduce APE on the `ape-rsi-toolkit` built-in demo task" suffices to create an under-test Agent, create a set of published Benchmarks, test the baseline, run the method, and report the score before and after. `ace-rsi-toolkit` and `awm-rsi-toolkit` have no demo task; they first ask the user for an under-test Agent and a published Benchmark.

**Evaluation Center.** The first item in "Use → Optimize" is "Method": one item for each toolkit in the plugin library's `rsi` category, Default listed first, name and description taken from the plugin manifest — once an administrator installs a toolkit from the plugin marketplace, it appears in the list next time the dialog opens. When Default is selected, the form and prompt are as before; when another method is selected, "Max rounds" and "Target score" are hidden — these methods use the paper's own budget, defaulting to smoke test — and the prompt is handed to that toolkit's Skill. When the Agent running optimization lacks that Skill, a dialog notes which plugin to install. Each complete evaluation is recorded in `scoreboard.yaml` with the tag "`<agent_id>` · `<model_id>` · `<thinking_level>`", and curves and details do not distinguish methods.

**Draft page.** The startup dashboard for a new conversation (06 "Conversation Page"), fitting on one screen: the branding area has two lines (product name and version, subtitle "The most comprehensive Agent self-improvement platform"), and a small stats panel on the far right of the same line, showing only three totals — the count of agents in this Project, count of self-improvement algorithms (toolkits in the plugin library's `rsi` category, from `GET /api/plugins`), and count of benchmark sets in this Project — click to open the corresponding page, showing "—" when unavailable, each time the draft page is entered the counts are re-read, and after installing a plugin or importing a Benchmark, returning to the draft page shows updated numbers; below the input card are examples and quick commands, each item led by its own icon.

**Official website.** The hero: "Unified, Stable Agent Self-Improvement Framework / Full Automation × Agent Harness", followed by the original four stat cards unchanged (1000+ models, cross-platform deployment, 100% open source, first self-improvement Harness, small text above, large text below), then three lists with external links — supported models (vendor homepage), self-improvement algorithms (papers; Default has no link), benchmark sets (built-in Benchmarks list only category, linking to upstream benchmark sets; several from the same upstream merge into one item, like GDPevo's train and test halves), algorithm and benchmark entries are plain text links without capsule styling, external link clicks go through a confirmation dialog first. Two examples side by side: one sentence generates an AI app that can think and runs; one sentence launches Agent self-improvement (i.e., the `ape-rsi-toolkit` demo task).

**Reproducing a new Benchmark.** Do not write a Skill: add a Benchmark package in `Prism-Shadow/penguin-harness-benchmark` under `packages/<id>/`, write its special running method in each question's "How to run this question" and the repository README, then import it into the Project. Import proceeds via `benchmark-design`'s import flow (paired train/test packages import together, validation after import, optional smoke test prompts first).

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Categories and plugins

Core's category list adds `{ id: "rsi", title: "Agent Self-Evolution", titleZh: "Agent Self-Evolution" }` at the first position. All plugins are in `plugins/<name>/` at the repo root, npm package name `@penguinharness/<name>`, `category = "rsi"`, and `preinstall` takes the default true:

| Plugin | Skill | Built-in reference |
| --- | --- | --- |
| `default-rsi-toolkit` | `agent-optimization` | The same-named Skill from the original `agent-tuning`, unchanged word-for-word |
| `agent-evaluation` (AI Application Development category, not a toolkit) | `benchmark-design`, `agent-evaluation` | Skills and reference files from the original `agent-tuning` (including `reference/harbor.md`), unchanged word-for-word except for the new import branch in `benchmark-design` |
| `agent-development` (AI Application Development category, not a toolkit) | New `agent-initialization`, `penguin-plugin` | `agent-initialization` comes with `reference/hooks.md`, the "How the program connects" and Agent API owner step change to point to `penguin-sdk`; `penguin-plugin` is the original `penguin-sdk` Workflow section |
| `opro-rsi-toolkit`, `ape-rsi-toolkit` | Same name as plugin | `references/initialization.md`, `references/evaluation.md`, `references/demo-task.md` |
| `ace-rsi-toolkit`, `awm-rsi-toolkit` | Same name as plugin | `references/initialization.md`, `references/evaluation.md` |

Algorithm toolkit Skills mention no other plugins or Skills; they can be read standalone once installed. The body follows: method source (paper, authors and year, official repository, verified source commit); "Before you start" (`test_agent_id` — existing Agent, or write `create: <id>` if the user needs a new one; `benchmark_id`, must be published, `opro-rsi-toolkit` / `ape-rsi-toolkit` can use the demo task instead; `runs`; the paper's default values for method parameters and smoke test profile); paths and recording; initialization; measurement; method loop; freezing and reporting. Each experiment's record is written under the scratchpad of this Session at `<skill>/<experiment_id>/` (directory name is the Skill name, e.g., `opro-rsi-toolkit`): `experiment.yaml` (method, paper and source commit origin, parameters, question set, Runtime, State hash, and Awesome-RSI classification dimensions), proposal log (each prompt and raw response), measurement and failure for each candidate. The method loop is rewritten from #985's recipe: retaining meta-prompt structure, history handling, deduplication and syntax checking, tie and selection rules, budget formula, and "do not implicitly launch the paper's full budget"; removing companion supervision and all references to the default loop.

### Learning slots

Initialization establishes the learning slot for that method only in the under-test Agent: an Agent's own Skill — `opro-instruction`, `ape-instruction`, `ace-playbook` (learning file `rules.yaml`), `awm-workflows` (learning file `workflows.md`) — whose fixed `SKILL.md` body requires the Agent to fully read the learning file and follow it; then append a fixed line to the under-test Agent's `AGENTS.md` end, requiring it to be read before any substantive operation begins. The method loop only changes the learning file. The learning Skill's frontmatter carries a date-based version (same convention as installed Skills); the Agent State's `version` increments once per candidate measured, and rejected or unselected version numbers are not reused. Before each change to the under-test Agent, first confirm that the current version's snapshot `snapshots/v<version>.tar.gz` already exists (no `.vault.toml`, never overwritten, stop if it cannot be generated). At the end, restore the winning snapshot, keeping the version number it had when measured, and retain all other snapshots and records.

### Evaluation contract

`references/evaluation.md` is identical word-for-word in each algorithm toolkit. The toolkit's Skill is the controller: it accepts only published Benchmarks; each experiment fixes one Runtime — the model pair the user names, otherwise taken from this Skill's own Environment Provider and Model ID, never reading the under-test Agent's files, Project defaults, or the server, stopping if either is missing; thinking level is taken from the under-test Agent's `model.thinking_level`. For each cell in the Case × runs matrix, call `run_subagent` once (omit `agent_id`, the worker is this Agent and thus reads this reference), with the delegation prompt first pointing to the "The worker" section of this reference, followed by the same request fields as `agent-evaluation`:

```text
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <agent_state_version>
test_agent_id: <test_agent_id>
benchmark_id: <benchmark_id>
provider: <provider>
model_id: <model_id>
```

The worker evaluates only one cell, returning only a bare YAML with no fence: `status: ok` with identity fields, `score` (0–100), `cost` (numeric or null), `duration_ms`, and the under-test `session_id`; `status: failed` with `failure_code` (`invalid_request` / `benchmark_invalid` / `version_changed` / `evaluation_failed`), no score or private information. The under-test Agent runs in an isolated Workspace via `penguin run`, seeing only the question; the question's "How to run this question" section specifies questions running via Harbor (like built-in Benchmarks), and the worker instead runs a trial on a fixed commit checkout following that section and the repository README (passing along any install packages named in the README with the checkout), the controller dispatches cells in the background up to its limit (default 4 cells, user-provided limit otherwise, max 8), one cell returned immediately dispatches the next, no batch wait, cells where Docker yields no network reduce concurrency and retry once, not counted. The controller first verifies the result is exactly bare YAML (else requests the same worker to resend, not retrying the under-test Agent for format), then verifies the identity fields match the fixed Runtime (else the matrix is invalid, stop); a matrix with missing cells has no score, and never averages over incomplete matrices. Each complete matrix appends an evaluation to `scoreboard.yaml` (the scoring structure from 05 "Benchmark Evaluation and Optimization"; evaluation-level `score`, `cost`, `duration_ms` average per question, same convention as the current `agent-evaluation` Skill), and re-parses to verify after appending; only complete measurements of States still retaining snapshots are recorded, algorithm-internal candidate history stays in the experiment directory. Both controller and worker never read credentials or `web.db`, nor use disk tokens to call server APIs.

Core's plugin tests, for each plugin in the `rsi` category other than `default-rsi-toolkit`, read the `references/evaluation.md` under its Skill, asserting each is non-empty and identical word-for-word.

### Source of self-improvement algorithms

The Web App does not hard-code the list of toolkits and Benchmarks. The draft page's "Self-improvement algorithms" count and the "Method" dropdown both read the plugin library's `rsi` category (`GET /api/plugins`), and the "Benchmark sets" count reads this Project's Benchmark list; each time mounted (entering draft page, opening the "Use" dialog), the counts are re-read, showing the previous result on this page before reading, preserving the previous result on read failure; when never read, the count displays "—" and the dropdown is disabled. The official website's two lists of self-improvement algorithms and benchmark sets are taken from constants in the landing page package, pinned by tests to plugins in `plugins/*/package.json` with `penguin.category` of `rsi` and core's built-in Benchmark list.

### "Method" choice

The "Method" dropdown is generated when the "Use" dialog opens, from the plugin library's `rsi` category, one item per plugin: the name is taken from the manifest's `title` / `title_zh` (defaulting to package name), the description from `short_description(_zh)` (defaulting to `description(_zh)`). The five built-in toolkits do not write `title`, and the dropdown displays package names like the plugin marketplace. `default-rsi-toolkit` is identified by package name as the default loop: listed first, form and footer are as before, pre-selects `agent-optimization` and `agent-evaluation`. Each other plugin runs per the original paper's procedure, using the Skill that is: first, the Skill named after the plugin, second, the first and plugin-provided in quick start pre-selection, third, the plugin's only Skill; if none settle, the plugin does not enter the dropdown. When the plugin library has not yet been read, reading fails, or the category is empty, the dropdown is disabled with a reason stated, the form treats Default, and the "Evaluation" tab is unaffected. When a non-Default method is selected, the footer fixedly briefs that Skill on test_agent_id, benchmark_id, and runs, requiring it to run per the original paper's procedure, measured via its own evaluation reference, recording each complete evaluation with the same label, not mentioning `agent-evaluation`, `run_subagent`, or round limits; pre-selected Skill is only that Skill. Tests verify only this mapping rule (ordering, Skill selection, taking names and descriptions by language, fallback on read failure), and run once across the toolkits actually bundled in the repo, guaranteeing each maps to one item.

### Benchmark reproduction

Reproduced Benchmarks are Benchmark packages under `packages/<id>/` in `Prism-Shadow/penguin-harness-benchmark`, imported into the Project per 05 "Benchmark Evaluation and Optimization"'s package format; their running method is written in each question's "How to run this question" and the repository README, never into a plugin or Skill. The GDPevo subset (one Harbor task per question, one business service per question set, unified scoring per set) is packaged in that repository as train and test packages, and supplied as built-in Benchmarks **GDPevo Train / GDPevo Test** with each new Project: the product carries only the two packages' question text and scoring details (byte-identical to the same-version package in the repository), while task directories, business environments, and all large files remain only in that repository.

### Compatibility

Installed Skill copies match by Skill name, not plugin name: existing Agents work normally, update checks work normally, the original `agent-tuning`'s four Skills each record in the plugin name that now carries them. Installing by old name (e.g., `--plugins agent-tuning` in scripts) returns 404 `unknown_plugin`; `@penguinharness/agent-tuning` on npm no longer publishes new versions. Pre-installation happens only at creation; existing Agents do not automatically get new toolkits — the "Method" choice's missing Skill prompt names the plugin to install. The scoring structure is unchanged, old readers normally parse records written by algorithm toolkits.

## Drawbacks
[drawbacks]: #drawbacks

- **Evaluation reference copies.** Each algorithm toolkit has one; changing one requires changing all in the same revision; tests only guarantee copies are consistent with each other, not semantically with `agent-evaluation` — the same protocol has two written forms.
- **First npm package release.** Each new plugin is a new npm package, requiring manual first release and trusted publisher setup before launch.
- **Renaming.** `agent-tuning` in scripts, documentation, and blogs becomes invalid (blogs preserve the original as history); the old npm package stays at the last version.
- **Prompt overhead.** When all are pre-installed, `default_agent`'s Skill index gains one line per toolkit.
- **Default loop depends on another plugin.** `default-rsi-toolkit` relies on the `agent-evaluation` plugin for measurement, yet the plugin library has no dependency mechanism: an Agent with only the former discovers the missing evaluation only at optimization time. Mitigation: both are pre-installed, and the Evaluation Center prompts to install the `agent-evaluation` plugin when the evaluator lacks it.
- **List depends on plugin manifest.** Names are taken from the plugin manifest; toolkits not writing `title` (including the five built-in ones) display package names in the dropdown; plugins whose Skill cannot be determined do not enter the dropdown, yet still count in the draft page's "Self-improvement algorithms" number.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Algorithm toolkit depends on `default-rsi-toolkit`'s `agent-evaluation`.** The protocol has only one implementation, no copies. Not chosen: the plugin library has no dependency mechanism, coupling can only fall on install order, and failure only surfaces at runtime.
- **All algorithms as reference files in one plugin (#985).** One plugin cannot compute "N algorithms"; algorithms cannot install and update independently, the default loop's Skills must branch per method, and text and reference indices grow unbounded. Not chosen.
- **Frontend maintains method list, tests pin to `plugins/`.** This proposal's original approach: new toolkits require adding a line to the frontend, administrator-installed toolkits never make it to the dropdown, and counts update only after page refresh. Not chosen.
- **Server-side evaluation executor.** The platform executes each cell, the contract becomes code, copies vanish. The cost is a new subsystem, and execution logic leaves Agent-editable files (PRN-001). Deferred; see Future possibilities.
- **Naming.** Long names ending in `-rsi-toolkit` (`default-rsi-toolkit`, `opro-rsi-toolkit`): names self-explain, an algorithm toolkit's unique Skill shares the plugin name; the family lives in the plugin library grouped by `rsi` category, not by name sort. Short names `rsi-*` once appeared in early versions of this proposal, never shipped.
- **Do nothing.** The default loop remains the only algorithm, the "RSI Framework" positioning has nothing behind it, and counting is moot.

## Prior art
[prior-art]: #prior-art

- [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985) (Junhao Hu) first ported OPRO, APE, ACE, and AWM as reference files in `agent-tuning`, verified each method's source commits, provided smoke test profiles and learning slot layout; it also proposed companion supervision (`agent-supervision`) and Benchmark reproduction (`benchmark-reproduction`, including GDPevo recipe). This proposal reuses its method recipe and initialization layout, rewrites as self-contained toolkits, and supersedes that PR. Three items not merged: companion supervision doubles session count per delegation and effect unverified (see Unresolved questions); Benchmark reproduction reasoning in Motivation; its rewrites to the default loop's few Skills were also not adopted — these Skills have been independently hardened on main.
- Awesome-RSI's classification dimensions (artifact / source / feedback / updater / frequency / topology / selection / mode / scope) record in each experiment's `experiment.yaml`, enabling comparison across algorithms.
- Papers and official implementations: OPRO, Yang et al., 2023, [Large Language Models as Optimizers](https://arxiv.org/abs/2309.03409) ([google-deepmind/opro](https://github.com/google-deepmind/opro)); APE, Zhou et al., 2022, [Large Language Models are Human-Level Prompt Engineers](https://arxiv.org/abs/2211.01910) ([keirp/automatic_prompt_engineer](https://github.com/keirp/automatic_prompt_engineer)); ACE, Zhang et al., 2025, [Agentic Context Engineering](https://arxiv.org/abs/2510.04618) ([ace-agent/ace](https://github.com/ace-agent/ace)); AWM, Wang et al., 2024, [Agent Workflow Memory](https://arxiv.org/abs/2409.07429) ([zorazrw/agent-workflow-memory](https://github.com/zorazrw/agent-workflow-memory)).
- Built-in Benchmarks Sec A–E exemplify "writing running method in question text and repository README, not into Skills": `agent-evaluation`'s `reference/harbor.md` specifies only the product side.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **Renaming compatibility strategy.** Clear incompatibility (changelog Breaking, deprecate old npm package), leave an `agent-tuning → default-rsi-toolkit` alias table in core until 0.3, or only change description not name. Lean toward the first.
- **Pre-install scope.** All toolkits pre-installed, or only `default-rsi-toolkit` pre-installed with others manual. Lean toward all pre-installed; examples and quick start work out of the box.
- **Evaluation contract landing place.** Self-contained copies, or declare depend on `default-rsi-toolkit`'s `agent-evaluation`. Lean toward self-contained copies.
- **Companion supervision.** Not merged this round; if later, as an optional Skill to `default-rsi-toolkit`, not referenced by algorithm toolkits.
- **#985 design document.** Whether candidate algorithm list and literature review sign on and enter the implementation repository's `packages/docs/decisions/`; FDE scenario document decision already superseded by this proposal, lean toward not merging.
- **Official website second example materials.** First occupy with Evaluation Center screenshot, after one real run swap for score curve screenshot, video, and cost.
- **Evaluation Runtime.** Default optimization reuses the Runtime from the baseline record; algorithm toolkits take the optimization session's own model. When they differ, curves for the same under-test Agent split into two series. Should algorithm toolkits also reuse the baseline record?
- **Evaluation-level score convention.** 05's scoring structure writes evaluation-level as sum of per-question averages, max score stipulated by scoring rules; current Skill and this proposal's evaluation reference take per-question average, fixed 0–100. Need to settle which is authoritative and sync 05.

## Future possibilities
[future-possibilities]: #future-possibilities

- Add more toolkits from #985's candidate list: one plugin per algorithm, after installing into the plugin library the "Method" dropdown and count automatically track.
- Companion supervision as an optional Skill to `default-rsi-toolkit`.
- evaluation records gain a `method` field (old readers ignore), curves and details can distinguish points from different methods in the same series.
- Server-side evaluation executor replaces reference copies in each toolkit.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the landed version from the design repository's default branch, identical to the source file.
