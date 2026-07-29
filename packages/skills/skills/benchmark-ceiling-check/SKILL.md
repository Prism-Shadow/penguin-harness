---
name: benchmark-ceiling-check
description: Run a deterministic variance scan on a Benchmark scoreboard to detect ceiling effects and surface upgrade recommendations.
short_description: Detect Benchmark ceiling effects with a deterministic variance scan.
short_description_zh: 确定性方差扫描，检测 Benchmark 天花板效应。
version: 1
updated: 2026-07-29T00:00:00Z
---

<!-- Author: ZhiJin Nan <cinderelladoyle@icloud.com> | SPDX-License-Identifier: Apache-2.0 -->

# Benchmark Ceiling Check

Run a deterministic variance scan on the most recent Benchmark evaluation. Detect Cases where the Test Agent hits the scoring ceiling and recommend action. This Skill is read-only — it never modifies files or clears the Scoreboard.

## Before you start

Require a valid Benchmark directory containing `benchmark_config.toml` and `scoreboard.yaml`. If the Scoreboard has no evaluations, report that and stop.

## Gather data

Read the complete file tree under the Benchmark directory. Collect every Case's `rubric/README.md` path and the absolute path to `scoreboard.yaml`.

## Run the calculator

Invoke the deterministic Python calculator. The Skill orchestrates; the script does the math:

```bash
python3 <skill_dir>/calculate.py <scoreboard.yaml> <rubric_dir_1> [rubric_dir_2 ...]
```

`rubric_dir` arguments may be either the `rubric/` directory itself or the Case directory that contains it — the script resolves both. Pass every Case discovered in the Benchmark.

Parse the JSON output from stdout. On a non-zero exit, surface the error and stop.

## Classify and report

The script outputs per-Case `utilization`, `volatility`, and `category`, plus a Benchmark-level aggregate. Format them as a human-readable report:

```
## Ceiling Check: <benchmark_title>

| Case | Score | Max | Utilization | Volatility | Category |
|------|-------|-----|-------------|------------|----------|
| CASE-001 | 23.0 | 25 | 93.2% | 2.7% | Stable Ceiling |
| CASE-002 | 18.0 | 25 | 72.0% | 2.7% | Healthy |

**Benchmark:** 41.0 / 50.0 (82.0%) — Ceiling (1/2 cases at ceiling)
```

## Recommend

For each Case whose `category` ends in "Ceiling" (Absolute / Stable / Probable):

- **Absolute Ceiling** (≥95%, 0% vol): Strongly recommend upgrade. Every run scored at or near max.
- **Stable Ceiling** (≥85%, ≤15% vol): Recommend upgrade. Scores are consistently high with low variation.
- **Probable Ceiling** (≥85%, 15–30% vol): Suggest upgrade at lower confidence. High scores but with meaningful run-to-run variation.

For **Unstable High** (≥85%, >30% vol): Do not recommend upgrade. High scores may be noise — suggest increasing `runs` in `benchmark_config.toml` instead.

For **Approaching** (75–85%) and **Healthy** (<75%): No action needed. The Benchmark has useful headroom.

When ceiling Cases are found, end with:

> To diagnose why these Cases are at ceiling and automatically upgrade difficulty, use the `benchmark-difficulty-escalation` skill.

## Boundaries

- Read-only: never modify the Scoreboard, Rubric, Statement, or Benchmark config.
- Never launch the Test Agent or spawn evaluation subagents.
- Never reveal Rubric content in the report — surface only scores, utilization percentages, and category labels.
