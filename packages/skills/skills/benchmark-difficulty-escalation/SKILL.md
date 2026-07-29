---
name: benchmark-difficulty-escalation
description: Automatically upgrade Benchmark Case difficulty over multiple rounds when the Test Agent hits the scoring ceiling, using an orchestrator-workers pattern with structured output protocols.
short_description: Auto-escalate Benchmark difficulty when the Test Agent hits the ceiling.
short_description_zh: 当 Test Agent 触及 Benchmark 分数天花板时，自动爬升 Case 难度。
version: 1
updated: 2026-07-29T00:00:00Z
---

<!-- Author: ZhiJin Nan <cinderelladoyle@icloud.com> | SPDX-License-Identifier: Apache-2.0 -->

# Benchmark Difficulty Escalation

Orchestrate a multi-round difficulty-escalation loop for a Benchmark whose Cases show a ceiling effect. Delegate all analysis to Worker Skills, all evaluation to `agent-evaluation`, and act purely as a data transporter and flow controller.

## Before you start

Require a Test Agent id, a Benchmark directory, and a positive integer `max_rounds` (default 1). The caller may override. Require a top-level Session with `run_subagent`. Require these Skills to be installed on the current Agent: `benchmark-ceiling-check`, `benchmark-trace-diagnosis`, `benchmark-case-upgrade`, and `agent-evaluation`. If any is missing, stop and ask the user to install it.

## Resolve paths

```text
PROJECT_DIR = <app_data_dir>
PROJECT_ID = <basename_of_project_dir>
PENGUIN_HOME = <parent_of_project_dir>
BENCHMARK_DIR = <app_data_dir>/agents/<test_agent_id>/benchmarks/<benchmark_id>
SCRATCHPAD = <app_data_dir>/agents/<current_agent_id>/scratchpad/<current_session_id>
```

## Phase 0 — Pre-flight

1. Read `benchmark_config.toml` — record `runs` and the Case list.
2. Read every Case's `statement/` and `rubric/` tree. Store the exact bytes of every file for rollback, keyed by Case id.
3. Confirm `agent-evaluation` is installed on the current Agent.

## Main loop

For `round` from 1 to `max_rounds`:

### Phase A — Analyze

1. **Ceiling scan**: `run_subagent` → `benchmark-ceiling-check` with `benchmark_dir`. Parse the report. Collect every Case whose `category` ends in "Ceiling" (Absolute / Stable / Probable) as `target_cases[]`. If none, exit the loop — all Cases are healthy.

2. **Trace diagnosis** (per target Case): For each `target_case`, `run_subagent` → `benchmark-trace-diagnosis` with the Case id and its `session_id` list (from the latest scoreboard evaluation). Parse the returned `diagnosis_result` YAML. Collect all results.

### Phase B — Upgrade

For each `target_case` whose `diagnosis_result.recommended_techniques` contains `C1`:

- **Phase B-special (C1 — new Case)**: Verify `root_cause = case_weak`, `confidence = high`, and that S5, S6, and F2 have all been attempted in previous rounds (check the escalation log). If all three conditions hold, `run_subagent` → `benchmark-design` to design a single new Case for the same capability with a distinct failure mode. After the new Case is created, run **max-score redistribution**: the new Case keeps its suggested `case_max`; existing Cases' `case_max` values are proportionally scaled so the total remains ~100 (±5). Use `round()` with tie-breaking on the largest Case.

For all other `target_cases`:

- `run_subagent` → `benchmark-case-upgrade` with `{case_path, root_cause, recommended_techniques, original_file_bytes}`. Parse the returned `upgrade_result` YAML.

### Phase C — Re-evaluate

1. **Clear the Scoreboard**: Set `evaluations: []` in `scoreboard.yaml`. A material change to any Case invalidates all prior results per `benchmark-design`.
2. **Run the full N × R matrix**: Spawn one `run_subagent` per Case × run cell, all in the same parallel group before awaiting results. Each prompt:
   ```
   Caller agent: <current_agent_id>
   Use the `agent-evaluation` Skill. Return only its terminal protocol YAML.
   protocol_version: 1
   case_id: <case_id>
   run: <1_based_run_index>
   expected_version: <test_agent_state_version>
   test_agent_id: <test_agent_id>
   benchmark_dir: <absolute_benchmark_dir>
   provider: <provider>
   model_id: <model_id>
   ```
   Parse each child's terminal protocol YAML. Keep every `status: ok`. Retry invalid cells once (all retries together). If any cell remains invalid, abort this round and roll back.

### Phase D — Check

1. **Re-run ceiling check**: `run_subagent` → `benchmark-ceiling-check` with the updated `benchmark_dir`. Extract each target Case's new `utilization`.
2. **Decide per Case**:
   - `new_utilization < 0.80` → `verdict: resolved`
   - `new_utilization >= 0.85` → `verdict: continuing` (next round, different technique)
   - `new_utilization >= utilization_before` (score went up or flat) → `verdict: rolled_back` — restore Phase 0 file backups for this Case. Skip this technique in future rounds.
3. **Append to escalation log** at `SCRATCHPAD/escalation-log.yaml`. Each entry:
   ```yaml
   - round: <N>
     case_id: <case_id>
     root_cause: <from diagnosis_result>
     confidence: <from diagnosis_result>
     technique: <from upgrade_result>
     files_changed: <from upgrade_result>
     guardrails_passed: <from upgrade_result>
     utilization_before: <from Phase A>
     utilization_after: <from Phase D>
     verdict: resolved | continuing | rolled_back
     timestamp: "<ISO 8601>"
   ```
   Escalation produces zero analysis — every field is sourced from Worker outputs or the deterministic ceiling-check.

## Stop conditions

Stop the loop when any of these fires:

- All Cases have `utilization < 80%` (success).
- The same Case shows `< 5%` utilization change for two consecutive rounds (technique exhaustion). If `root_cause = case_weak` and C1 has not been tried, recommend C1 before giving up. Otherwise report `calibration_failed` for that Case.
- `max_rounds` reached.
- Two consecutive evaluation matrix failures.

## Final output

Read `SCRATCHPAD/escalation-log.yaml`. Format it as a table:

```
## Benchmark Difficulty Escalation: <benchmark_title> — <N> rounds

| Round | Case | Root Cause | Technique | Utilization | Result |
|-------|------|------------|-----------|-------------|--------|
| 1 | CASE-001 | agent_strong | S1 | 93% → 78% | resolved |
| 1 | CASE-002 | rubric_loose | R1 | 88% → 81% | continuing |
| 2 | CASE-002 | rubric_loose | R2 | 81% → 74% | resolved |

Summary: 2 rounds, 2/2 Cases resolved. The Benchmark is ready for a new optimization cycle.
```

All fields come from Worker outputs. Never reveal Rubric content, scoring items, or golden answers.

## Boundaries

- Escalation is a pure data transporter — it delegates all analysis to Workers and all evaluation to `agent-evaluation`.
- Never modify the Test Agent State. Edit only Benchmark Case files.
- Never write the Scoreboard directly. Clear it per `benchmark-design` rules, then let `agent-evaluation` write the new baseline.
- Per-round rollback only — restore the files changed in the current round, not all rounds.
- Never inspect another Agent's traces or Project configuration.
