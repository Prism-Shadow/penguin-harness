# Benchmark Trace Diagnosis

Diagnose why a single Benchmark Case reaches the scoring ceiling. Read the Case's evaluation traces, score three groups of observable signals, run a decision tree, and return a structured `diagnosis_result`. This operation is read-only — it never modifies files.

## Before you start

Require a Benchmark directory, a target Case id, and a list of Test Session ids from that Case's scoreboard runs. If any are missing, ask the caller. Require access to the Test Agent's `traces/` tree.

## Gather traces

For each supplied Test Session id, locate the matching trace file under `<app_data_dir>/agents/<test_agent_id>/traces/`. Read the trace JSONL and extract behaviour evidence — tools called, tool-call sequences, reasoning patterns, corrections, token usage, subagent spawns. Cross-reference runs to compare consistency.

## Score the signal matrix

Score every signal in three groups. Count a signal as "hit" when the trace contains clear evidence for it.

### Group A — Agent is genuinely strong (6 signals)

| # | Signal | Strength | What to look for |
|---|--------|:---:|------|
| A1 | Self-correction loops | strong | Trace contains a correction followed by a re-attempt that changes the outcome |
| A2 | Plan-then-execute | medium | First turn explicitly lists steps before acting |
| A3 | Proactive verification | strong | Agent reads back or tests its own output without being asked |
| A4 | Multi-approach comparison | weak | Agent discusses two or more approaches before choosing |
| A5 | Edge-case handling | medium | Agent explicitly addresses empty input, boundary values, or error paths |
| A6 | Efficiency | auxiliary | Token usage is proportionate; no redundant tool calls |

### Group B — Case is too easy (6 signals)

| # | Signal | Strength | What to look for |
|---|--------|:---:|------|
| B1 | Very few turns | strong | ≤ 3 turns to completion |
| B2 | Formulaic tool sequence | strong | Tool-call order is near-identical across all runs |
| B3 | Shallow reasoning | medium | No deep analysis; agent applies a template directly |
| B4 | Zero backtracking | auxiliary | No corrections or retries across the entire trace |
| B5 | Low token usage | auxiliary | Token count significantly below typical for the task class |
| B6 | Zero sub-agents | auxiliary | Agent never spawns a subagent |

### Group C — Rubric is too loose (4 signals)

| # | Signal | Strength | What to look for |
|---|--------|:---:|------|
| C1 | Coarse-grained items | direct | Rubric has ≤ 2 scoring items for the whole Case |
| C2 | Score-quality mismatch | trace+output | Agent got full credit but the output has observable defects |
| C3 | Vague partial credit | direct | Rubric uses "partially correct = half" without specific conditions |
| C4 | Incomplete coverage | comparison | Rubric omits a requirement stated or implied in the Statement |

Read the Rubric directly from `<benchmark_dir>/<case_id>/rubric/README.md` for C1, C3, and C4. Inspect the Test Workspace artifact for C2.

## Run the decision tree

```
score_A = count(hit A1–A6)
score_B = count(hit B1–B6)
score_C = count(hit C1–C4)

root_cause:
  score_A ≥ score_B and score_A ≥ score_C  →  agent_strong
  score_B ≥ score_A and score_B ≥ score_C  →  case_weak
  otherwise                                 →  rubric_loose

confidence:
  winning margin ≥ 3 and winner count ≥ 3  →  high
  winning margin = 1 or winner count < 3   →  medium
  tie or winner count < 2                   →  low
```

## Recommend techniques

Map `root_cause` to a shortlist of upgrade techniques:

| root_cause | Primary | Secondary | Avoid |
|------|------|------|------|
| agent_strong | S1 (+constraint), S2 (+ambiguity) | S3 (+multi-file) | S4 (noise is ineffective against strong agents) |
| case_weak | S5 (-shortcut), F2 (+distraction) | S6 (+steps, companion only) | — |
| rubric_loose | R1 (finer granularity) | R2 (+coverage), R3 (+specific partial credit) | R4 (tight equivalence, weakest) |

When `confidence` is `low`, trigger an external search for additional evidence before finalising. Use the three-tier source strategy: (1) search the project's own traces for comparable Cases, (2) search public benchmark-design literature, (3) search the capability domain for standard difficulty dimensions.

## Return protocol

Output exactly one plain YAML document beginning with `diagnosis_result:` and stop. Do not use a code fence.

```yaml
diagnosis_result:
  case_id: <case_id>
  root_cause: agent_strong          # enum: agent_strong | case_weak | rubric_loose
  confidence: high                  # enum: high | medium | low
  signal_counts:
    group_a: 4
    group_b: 1
    group_c: 0
  recommended_techniques: [S1, S3]  # technique IDs, priority order
  evidence_summary: "<one-sentence behavioural summary>"
```

Never reveal Rubric content, scoring items, expected answers, or golden data in `evidence_summary`. Describe only public agent behaviour.
