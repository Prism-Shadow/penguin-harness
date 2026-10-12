# RSI toolkits: `agent-tuning` became `default-rsi-toolkit`, joined by OPRO, APE, ACE and AWM

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `plugins`, `core`, `server`, `web`, `docs`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)
- **Breaking:** yes — the `agent-tuning` plugin was renamed `default-rsi-toolkit`; install requests naming `agent-tuning` are refused

[中文版](2026-10-10-rsi-toolkits.zh.md)

The plugin library gained a first category, `rsi` (Agent Self-Evolution), for the RSI toolkits: one plugin per self-evolution algorithm. `agent-tuning` was renamed `default-rsi-toolkit`, the Default RSI Toolkit, with its four Skills keeping their names, and four algorithm toolkits joined it, `opro-rsi-toolkit`, `ape-rsi-toolkit`, `ace-rsi-toolkit` and `awm-rsi-toolkit`, each running one paper's algorithm through one Skill. Toolkit names end in `-rsi-toolkit`, and an algorithm toolkit's one Skill carries the plugin's name. The Evaluation Center's Optimize tab gained a **Method** field over the five, and `GET /api/rsi` served the catalogue. The OPRO, APE, ACE and AWM recipes came from Junhao Hu's [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985), rewritten as standalone toolkits.

## Details

- **Category.** `PLUGIN_CATEGORIES` gained `rsi`, titled Agent Self-Evolution / Agent 自进化, as its first entry. `ai-app-development` kept `agent-development`, `model-development` and `skill-porting`.
- **`default-rsi-toolkit`.** `plugins/agent-tuning` moved to `plugins/default-rsi-toolkit` (`@penguinharness/default-rsi-toolkit`, category `rsi`). `agent-initialization`, `benchmark-design`, `agent-evaluation` and `agent-optimization` kept their names; all but `benchmark-design` kept their bodies and their Skill version, `2026.10.09.5`, and `benchmark-design` moved to `2026.10.11.1` (see **Benchmark import**). The `package.json` described the Default RSI Toolkit. `core`, `cli` and `desktop` depended on the five `@penguinharness/*-rsi-toolkit` packages instead of `@penguinharness/agent-tuning`. The `company-hr` Skill (`2026.10.11.1`) named the new plugin.
- **Algorithm toolkits.** `opro-rsi-toolkit` (OPRO, Yang et al., 2023), `ape-rsi-toolkit` (APE, Zhou et al., 2022), `ace-rsi-toolkit` (ACE, Zhang et al., 2025) and `awm-rsi-toolkit` (AWM, Wang et al., 2024), each preinstalled, each one Skill at `2026.10.11.1`. Each Skill ran its paper's algorithm with the paper's defaults and a smoke budget, initialized a learning slot in the Target Agent (a Skill of the Target's own and one fixed line in its `AGENTS.md`), gave every measured candidate a new, snapshotted Agent State version, and reported the baseline and final scores with the source links. `opro-rsi-toolkit` and `ape-rsi-toolkit` each shipped a demo task (`precise-summary`, `house-style-brief`) that the Skill built, together with a fresh Target Agent, when asked.
- **Evaluation contract.** No toolkit depended on another. Each algorithm toolkit carried its own `references/evaluation.md`: the one-cell protocol of `agent-evaluation` (an eight-field request to a `run_subagent` worker, a plain YAML result, four failure codes), the same `scoreboard.yaml` record, and built-in Harbor cases run by their statements. The four copies were byte-identical, and a core test pinned them together.
- **Method.** The Evaluation Center's **Use** → **Optimize** tab gained **Method**: Default, OPRO, APE, ACE or AWM. A method other than Default hid **Round limit** and **Target score**, handed its Skill the tested agent, the Benchmark and the runs, and preselected that Skill. A web test pinned the list to the library's `rsi` plugins.
- **Benchmark import.** `benchmark-design` gained the import procedure as a branch of its own: `reference/package.md` resolves a source (one folder, a folder of packages, a name), pins the commit, imports a companion train/test pair together, verifies the written copy and offers a one-case smoke probe that never starts on its own. The Evaluation Center's import prompt leads with that Skill and preselects it.
- **Catalogue.** `GET /api/rsi` (any logged-in user) returned the `rsi` toolkits, each with its Skills and preinstall flag, and the built-in Benchmarks; the start page's metric tiles read it (see [the repositioning](2026-10-10-rsi-positioning.md)).
- **Docs.** Skills & Plugins listed the new category and toolkits, Self-Improvement gained the **RSI toolkits** and **Reproduced Benchmarks** sections, and Evaluation Center described the **Method** field.
- From [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985), the rewrites of the four `agent-tuning` Skills, `agent-supervision`, and `benchmark-reproduction` with its GDPevo recipe were not ported: reproduced Benchmarks live in penguin-harness-benchmark, not in a plugin.

## Compatibility

- `agent-tuning` is no longer in the library: `penguin agent create --plugins agent-tuning` and any other install request naming it fail with `404 unknown_plugin` and create nothing. Name `default-rsi-toolkit` instead.
- An agent keeps the four Skills it has. They are matched to the library by Skill name, so the **Plugins** page lists them under `default-rsi-toolkit`; three compare equal to the library's copies, and `benchmark-design` `2026.10.11.1` is offered as an update.
- Agents created before this release do not get the four algorithm toolkits. Install `opro-rsi-toolkit`, `ape-rsi-toolkit`, `ace-rsi-toolkit` or `awm-rsi-toolkit` on an agent from the **Plugins** page before choosing that method in the Optimize tab.
- `@penguinharness/agent-tuning` on npm receives no further versions; depend on `@penguinharness/default-rsi-toolkit` instead.
