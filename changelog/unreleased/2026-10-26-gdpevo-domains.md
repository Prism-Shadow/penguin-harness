# GDPEVO loads as Train/Test pairs for six domains

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `web`, `ui-gallery`, `landing`, `tooling`, `agent-evaluation`
- **PR:** [#1341](https://github.com/Prism-Shadow/penguin-harness/pull/1341)

[中文版](2026-10-26-gdpevo-domains.zh.md)

New Projects receive separate Train and Test Benchmarks for each of GDPEVO-CRM, GDPEVO-ERP, GDPEVO-Finance, GDPEVO-Healthcare, GDPEVO-Legal and GDPEVO-DataAnalysis. Each Train Benchmark has one continuous Case containing five training questions in one Agent Session and business container, with a six-hour solving limit and a Skill export. Each Test Benchmark has five independent Cases, each with a four-hour solving limit. Both use unlimited turns. The exported Skill is frozen before testing, and Train/Test scores are reported separately.

The twelve GDPEVO entries reuse the existing Benchmark structures, provisioning, Harbor launch template and package exporter. Test tasks use domain names such as `crm-test-001` directly under `tasks/`; training selects `train_tasks` in that same directory. English and Chinese descriptions explain each domain and split. The gallery, landing catalogue and import examples use the matching Train/Test IDs. Existing Project benchmarks are preserved, and the new GDPEVO entries start without evaluation records.

All built-in Case definitions drop `summary`, `category`, `cpus` and `memoryMb`, along with their statement-rendering branches. Case statements retain the task title, source links, network and verifier information, and launch and scoring instructions. Docker resource limits remain in the Benchmark repository's task files. Benchmark-level fields keep their original required or optional status except for the removed `ref`; source links and checkout instructions use the Benchmark repository's `main` branch. Agent Evaluation accepts branch, tag and commit links, resolving the source once per evaluation so every cell uses the same checkout.
