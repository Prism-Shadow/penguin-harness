# Demo task: precise summary

The demo that this Skill's quick start runs. A fresh summary writer is measured on its base State, one Reflector turns the score matrix into one written reflection, and the buffered second trial tries to beat the first. The Benchmark is the same precise-summary set the other RSI toolkits' demos ship: its six cases, statements and rubric are defined byte-for-byte in the `opro-rsi-toolkit` Skill's demo (`plugins/opro-rsi-toolkit/skills/opro-rsi-toolkit/references/demo-task.md`, its "Write the Benchmark" section; read it from that installed plugin, never from the Target), and this Skill builds it from that definition unchanged. Every text below is fixed: write it exactly as given, never generate it.

## Setup

| Item | Value |
| --- | --- |
| Benchmark | `precise-summary`: the six cases defined by the `opro-rsi-toolkit` demo task's "Write the Benchmark" section, `runs = 1` |
| Target | `create: summary_writer`; when that id is taken, the next free one of `summary_writer_2`, `summary_writer_3`, … (an existing writer may hold an earlier run's buffer) |
| Slot seed | empty buffer (`No trials have been reflected on yet.`) |
| Parameters | 2 trials, buffer size 3, at most 6 bullets per reflection |
| Budget | 2 × 6 × 1 = 12 Target executions and 1 Reflector call |

If `PROJECT_DIR/benchmarks/precise-summary/` exists, reuse it unchanged when it is published and its case ids and statements match the `opro-rsi-toolkit` demo definition (the file named above), and say so; otherwise stop and ask. Name the Target you used in the report.

## Run

1. Initialize the slot (`references/initialization.md`), snapshot H1, and measure trial 1 on the six cases (`references/evaluation.md`).
2. Reflect once (`SKILL.md`, "Reflect"): the Reflector sees trial 1's score matrix, the failed cases' public statements and the seed buffer, and returns one reflection of at most 6 bullets.
3. Append the reflection to the buffer, bump the State version, snapshot, and measure trial 2.
4. Report both trials' scores, the reflection text, the best trial with its snapshot version after restoring it, and the cost.

An improvement from trial 1 to trial 2 is the demo's happy path, not its success condition: the demo checks that the loop runs end to end with every record in place. A tie or a loss is reported as it measured.
