# RSI toolkits: `agent-tuning` became `rsi-default`, joined by OPRO, APE, ACE and AWM

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `plugins`, `core`, `server`, `web`, `docs`
- **PR:** [#NNNN](https://github.com/Prism-Shadow/penguin-harness/pull/NNNN)
- **Breaking:** yes — the `agent-tuning` plugin was renamed `rsi-default`; install requests naming `agent-tuning` are refused

[中文版](2026-10-10-rsi-toolkits.zh.md)

The plugin library gained a first category, `rsi` (Agent Self-Evolution), for the RSI toolkits: one plugin per self-evolution algorithm. `agent-tuning` was renamed `rsi-default`, the Default RSI Toolkit, with its four Skills unchanged, and four algorithm toolkits joined it, `rsi-opro`, `rsi-ape`, `rsi-ace` and `rsi-awm`, each running one paper's algorithm through one Skill of the same name. The Evaluation Center's Optimize tab gained a **Method** field over the five, and `GET /api/rsi` served the catalogue. The OPRO, APE, ACE and AWM recipes came from Junhao Hu's [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985), rewritten as standalone toolkits.

## Details

- **Category.** `PLUGIN_CATEGORIES` gained `rsi`, titled Agent Self-Evolution / Agent 自进化, as its first entry. `ai-app-development` kept `agent-development`, `model-development` and `skill-porting`.
- **`rsi-default`.** `plugins/agent-tuning` moved to `plugins/rsi-default` (`@penguinharness/rsi-default`, `2026.10.10.1`, category `rsi`). `agent-initialization`, `benchmark-design`, `agent-evaluation` and `agent-optimization` kept their names and bodies; the manifest described the Default RSI Toolkit. `core`, `cli` and `desktop` depended on the five `@penguinharness/rsi-*` packages instead of `@penguinharness/agent-tuning`. The `company-hr` Skill (`agent-company` `2026.10.10.2`) named the new plugin.
- **Algorithm toolkits.** `rsi-opro` (OPRO, Yang et al., 2023), `rsi-ape` (APE, Zhou et al., 2022), `rsi-ace` (ACE, Zhang et al., 2025) and `rsi-awm` (AWM, Wang et al., 2024), each at `2026.10.10.1` and preinstalled. Each Skill ran its paper's algorithm with the paper's defaults and a smoke budget, initialized a learning slot in the Target Agent (a Skill of the Target's own and one fixed line in its `AGENTS.md`), gave every measured candidate a new, snapshotted Agent State version, and reported the baseline and final scores with the source links. `rsi-opro` and `rsi-ape` each shipped a demo task (`precise-summary`, `house-style-brief`) that the Skill built, together with a fresh Target Agent, when asked.
- **Evaluation contract.** No toolkit depended on another. Each algorithm toolkit carried its own `references/evaluation.md`: the one-cell protocol of `agent-evaluation` (an eight-field request to a `run_subagent` worker, a plain YAML result, four failure codes), the same `scoreboard.yaml` record, and built-in Harbor cases run by their statements. The four copies were byte-identical, and a core test pinned them together.
- **Method.** The Evaluation Center's **Use** → **Optimize** tab gained **Method**: Default, OPRO, APE, ACE or AWM. A method other than Default hid **Round limit** and **Target score**, handed its Skill the tested agent, the Benchmark and the runs, and preselected that Skill. A web test pinned the list to the library's `rsi` plugins.
- **Catalogue.** `GET /api/rsi` (any logged-in user) returned the `rsi` toolkits, each with its Skills and preinstall flag, and the built-in Benchmarks; the draft screen's counts read it (see [the repositioning](2026-10-10-rsi-positioning.md)).
- **Docs.** Skills & Plugins listed the new category and toolkits, Self-Improvement gained the **RSI toolkits** and **Reproduced Benchmarks** sections, and Evaluation Center described the **Method** field.
- From [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985), the rewrites of the four `agent-tuning` Skills, `agent-supervision`, and `benchmark-reproduction` with its GDPevo recipe were not ported: reproduced Benchmarks live in penguin-harness-benchmark, not in a plugin.

## Compatibility

- `agent-tuning` is no longer in the library: `penguin agent create --plugins agent-tuning` and any other install request naming it fail with `404 unknown_plugin` and create nothing. Name `rsi-default` instead.
- An agent keeps the four Skills it has. They are matched to the library by Skill name, so the **Plugins** page lists them under `rsi-default` and offers its `2026.10.10.1` as an update.
- Agents created before this release do not get the four algorithm toolkits. Install `rsi-opro`, `rsi-ape`, `rsi-ace` or `rsi-awm` on an agent from the **Plugins** page before choosing that method in the Optimize tab.
- `@penguinharness/agent-tuning` on npm receives no further versions; depend on `@penguinharness/rsi-default` instead.
