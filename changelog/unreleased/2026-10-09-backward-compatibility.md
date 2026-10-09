# Backward compatibility: Benchmarks from before benchmark.json

- **Date:** 2026-10-09
- **Type:** process
- **Scope:** `core`, `server`, `skills`

[中文版](2026-10-09-backward-compatibility.zh.md)

[Benchmarks became packages described by benchmark.json](2026-10-09-benchmark-package.md). Two things outlive the release: the `benchmark_config.toml` every existing Benchmark has (the example and Sec A–E of every Project, and every Benchmark a person or an agent made), and the agent-tuning copies installed in Agents, which read and write that file until they are updated.

## The old shape: a Benchmark directory with only `benchmark_config.toml`

`readBenchmarkManifest` in `packages/core/src/state/benchmark-manifest.ts`, which the server's Benchmark list reads through, adopts such a directory when it reads it. It builds the manifest from the TOML as leniently as the TOML was read before: a missing or unusable title is the directory name, a missing run count is 1 and one over 1,000 is 1,000, and only a literal `draft` or `failed` is one, anything else being published. The version is the day the TOML was last modified, `.1`; `origin.kind` is `builtin` for the six ids earlier releases seeded (`example-benchmark`, `penguinharness-benchmark-sec-a` to `-sec-e`) and `agent` for any other. It writes that as `benchmark.json` beside the TOML and leaves the TOML as it is. From then on `benchmark.json` is the one read, and a TOML beside it is ignored. Three cases differ:

- A Benchmark whose TOML says `draft` is read but not converted: the agent-tuning copy still designing it writes `published` or `failed` into the TOML when it finishes, and the next read converts it.
- A TOML that does not parse is not converted. The Benchmark is listed under its directory name, as before, until the TOML is fixed.
- A data root that cannot be written to reads the TOML again on every list.

The `agent-evaluation` and `agent-optimization` Skills read `benchmark.json`, or the TOML until it is converted, so a data root no list has touched yet still evaluates. Installed agent-tuning copies from earlier releases keep reading and writing the TOML, which stays; the plugin update the Agents page offers brings them to the new Skills.

**A user is not required to do anything.** Every existing Benchmark keeps listing, now with a version. The built-in Benchmarks of an existing Project carry the day their TOML was written as their version, not the version the newly seeded ones carry.

## When this can be removed

At the 0.3.0 release preparation, by whoever prepares that release. Before removing it, the preparer settles one question with the user: what becomes of the TOML-only Benchmarks no list has converted (a Project nobody opened in the Evaluation Center since, a draft that never finished) — a one-time conversion at startup that also deletes every leftover `benchmark_config.toml`, or leaving them as files the list no longer shows. The removal then takes out:

- in `packages/core/src/state/benchmark-manifest.ts`, the adoption (`adoptLegacyConfig`, `legacyManifest`, `LEGACY_SEEDED_IDS`), `BENCHMARK_LEGACY_CONFIG` and the `smol-toml` import, so that `readBenchmarkManifest` returns null for a directory without `benchmark.json`;
- the words "(or, until it is converted, the older `benchmark_config.toml`)" in `plugins/agent-tuning/skills/agent-evaluation/SKILL.md` and `plugins/agent-tuning/skills/agent-optimization/SKILL.md`, with the plugin's version bump;
- the `compat(0.3.0)` cases in `packages/core/test/benchmark-manifest.test.ts` and `packages/server/test/benchmarks.test.ts`;
- the paragraph on `benchmark_config.toml` in `packages/docs/content/self-improvement.{en,zh}.md` and its clause in `packages/docs/content/server-api.{en,zh}.md`.
