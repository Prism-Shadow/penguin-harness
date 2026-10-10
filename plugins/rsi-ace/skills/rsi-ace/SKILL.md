---
name: rsi-ace
description: Run ACE (Agentic Context Engineering, Zhang et al. 2025) on an agent the sequential offline way - a Reflector reads each training Trace, a Curator adds the lessons to a playbook of rules the agent reads before every task, and the final playbook is measured on a published Benchmark.
---

# ACE

[Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models](https://arxiv.org/abs/2510.04618), Zhang et al., 2025 ([arXiv:2510.04618v1](https://arxiv.org/abs/2510.04618v1), §3–4 and Appendix B). GitHub: [ace-agent/ace](https://github.com/ace-agent/ace). Verified implementation revision `82709de050e1db6e6ef2f07bcb0393560b94992a`, chiefly `ace/ace.py` (`_train_single_sample`, `_offline_train`), `ace/core/reflector.py`, `ace/core/curator.py`, `ace/prompts/` and `playbook_utils.py`. This Skill runs the **sequential offline** algorithm: the Target (the paper's Generator) solves one training case at a time with the current playbook, a Reflector diagnoses that execution, and a Curator adds the lessons the playbook lacks as itemized rules; the final playbook is then measured on the frozen Benchmark. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

This Skill needs `run_subagent`, so it runs in a top-level Session. If the message only names it, ask which agent to train and on which published Benchmark. Otherwise resolve the inputs below and ask only for a missing Target or Benchmark; everything else has a default.

- `test_agent_id` — the Target (the Evaluation Center's Test Agent): an existing agent of this Project, or `create: <id>` when the user wants a fresh one, created with no plugins by `penguin agent create --agent-id <id> --project-id "$PROJECT_ID" --json` (an id matches `^[a-z][a-z0-9_-]{1,63}$`). If that id exists already, stop and ask; never reinitialize an agent. The Target is never the agent you run as: training rewrites its State while you work.
- `benchmark_id` — a Benchmark of this Project whose `benchmark_config.toml` status is published (not a literal `draft` or `failed`). Its cases (every directory of it holding a `statement/README.md`) are both the training samples and the measured case set. Without one, list the published Benchmarks and ask; this Skill never builds one.
- `test_benchmark_id` (optional) — a second published Benchmark held out from training: H1 (the initialized State) and the final playbook are measured on it too, and nothing of it reaches the Reflector or the Curator.
- `runs` — runs per case in every measurement; default 1.
- The runtime — the `provider` / `model_id` pair the user names, else your Environment's, fixed for the whole experiment (`references/evaluation.md`, controller step 2). The Reflector and the Curator run on your own model; record it.
- The settings below. Use the smoke profile unless the user asks for other values. A target score or a round limit is not an ACE setting: say so and leave it out.

| Setting | Smoke profile (default) | Source |
| --- | --- | --- |
| `num_epochs` | 1 | release default 1; the paper's experiments use up to 5 |
| `max_num_rounds`: reflections per incorrect sample | 3 | release default 3; the paper's experiments use up to 5 |
| `curator_frequency`: curate after every k-th sample | 1 | batch size 1, as in the paper's experiments |
| `playbook_token_budget` | 80000 | release default |
| `use_bulletpoint_analyzer`: embedding deduplication | false | release default |
| Training order | the case ids, sorted | fixed before the first execution |

Budget, for C training cases, E epochs, M rounds, k = `curator_frequency` and R runs: at most `E × C × (2 + M)` training executions of the Target, `2 × C × R` executions for the H1 and final measurements (plus `2 × C' × R` on a test Benchmark of C' cases), at most `E × C × M` Reflector calls and `E × ⌊C / k⌋` Curator calls. Before the first execution, state the profile and these numbers. Never launch the paper's full budget (5 epochs, 5 rounds) implicitly: a profile above the smoke one runs only when the user asks for it, after you have restated its arithmetic.

## Paths and records

Resolve every path from your Environment's `App Data Dir`, as `references/evaluation.md` does; never search for the Project:

```text
PROJECT_DIR  = <app_data_dir>
PROJECT_ID   = basename of PROJECT_DIR
PENGUIN_HOME = dirname of PROJECT_DIR
TARGET       = PROJECT_DIR/agents/<test_agent_id>
STATE        = TARGET/agent_state
BENCHMARK    = PROJECT_DIR/benchmarks/<benchmark_id>
CASE         = BENCHMARK/<case_id>       # statement/README.md is public; rubric/README.md is private
SCOREBOARD   = BENCHMARK/scoreboard.yaml
SKILL_DIR    = PROJECT_DIR/agents/<your Agent ID>/agent_state/skills/rsi-ace
PLAYBOOK     = STATE/skills/ace-playbook # SKILL.md + rules.yaml, the only learned slot
OUT          = <this Session's scratchpad>/rsi-ace/<experiment_id>
```

`<experiment_id>` is `<test_agent_id>-<UTC time as YYYYMMDDTHHMMSSZ>`. Before the first execution, write `OUT/experiment.yaml`; its `dimensions` place the run in the Awesome-RSI taxonomy:

```yaml
method: ACE
paper: "Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models"
arxiv_url: https://arxiv.org/abs/2510.04618
github_url: https://github.com/ace-agent/ace
source_revision: 82709de050e1db6e6ef2f07bcb0393560b94992a
settings: { num_epochs: 1, max_num_rounds: 3, curator_frequency: 1, playbook_token_budget: 80000, use_bulletpoint_analyzer: false, correct: "score = 100" }
test_agent_id: <id>
benchmark_id: <id>
test_benchmark_id: <id or null>
training_order: [<case ids>]
runs: 1
runtime: { provider: <provider>, model_id: <model_id>, thinking_level: <level> }
roles_model: { provider: <your Provider>, model_id: <your Model ID> }
h1: { version: <n>, sha256: { <every file of STATE but .vault.toml>: <hash> } }
dimensions:
  artifact: playbook of itemized rules
  source: the Target's own training executions
  feedback: Rubric score and correctness
  updater: Reflector and Curator, merged deterministically
  frequency: every curator_frequency samples
  topology: sequential, one Target
  selection: none, the final playbook is kept
  mode: offline
  scope: the ace-playbook Skill
adaptations: []
```

Keep in OUT every role request and raw reply, every cell result, every published `rules.yaml` as `OUT/playbook/v<version>.yaml`, every failure and adaptation, and `OUT/state.yaml` (epoch, sample, phase, State version), so that a compacted or resumed Session continues the run instead of restarting it.

Only the evaluation worker reads a `rubric/`; you, the Reflector and the Curator never do. A Harbor case's session id `harbor:<trial>` names a trial directory under `BENCHMARK/.jobs/<job>/`: its Trace is under `agent/penguin/traces/`, it has no Workspace on this machine, and its `verifier/` output and the tasks' `tests/` and `solution/` are private.

Snapshots: before the first change to a measured State, make sure `TARGET/snapshots/v<version>.tar.gz` exists: an archive of `agent_state/` without `.vault.toml`, its entries rooted at `agent_state/`. Never overwrite one, and stop if it cannot be created. State versions only increase and are never reused.

## Initialize

Follow `references/initialization.md`. It creates the empty playbook Skill and one fixed reader line in the Target's `AGENTS.md`, and changes nothing else. The initialized State is H1.

## Measure

Every measurement is a full case × `runs` matrix through `references/evaluation.md`, following its controller section, and lands in that Benchmark's `SCOREBOARD`. Measure H1 first. A prior record is reusable only when its State version, case set, runtime and runs all match. Training executions are single cells and never enter a scoreboard: the per-sample trajectory runs on a playbook that changes as it goes, so it is never reported as a matrix.

## Train the playbook

Make `num_epochs` passes over the training order, one sample at a time; two training cells never run at once. Every execution of the Target is one cell through `references/evaluation.md`: the request of its controller step 3 on the current State version, with a fresh `run` label for each execution of the same case (1, 2, … across the experiment), and the result handled as its controller steps 4 and 5 say. A cell is **correct** when it scores 100, or when it meets another predicate the user set before the first execution (record it). After every cell, check that `PLAYBOOK` still matches what you last published; a Target that edits it fails the run's integrity.

For each sample:

1. **Generate.** Run one cell on the current playbook.
2. **Reflect.** Run the Reflector on the latest execution, then publish the counter updates its tags give. If the execution was correct, go to 3. Otherwise **regenerate**: run a training cell on the same case with that reflection in its Workspace (Regeneration, below). If it is correct, go to 3; if not, reflect on it and regenerate again, up to `max_num_rounds` reflections in all. Never add rounds because a score disappoints.
3. **Curate.** After every `curator_frequency`-th sample, run the Curator on the latest reflection and the current playbook, and publish its ADD operations. An empty list is a valid answer.
4. **Observe.** Run one more cell on the same case, without reflection, on the updated playbook. Record it as the post-curation observation: it gates nothing.

Then go on to the next sample with the updated playbook.

### Regeneration

A regeneration is the one cell that differs from `references/evaluation.md`: the reflection reaches the Target as a file in its Workspace. Send the worker:

```text
Read <SKILL_DIR>/references/evaluation.md and follow its "The worker" section with one training change: after copying `statement/`, write everything below the line `--- REFLECTION.md ---` into the Workspace as `REFLECTION.md`, and launch with the message "Read README.md in the current Workspace and complete the task exactly as specified there. REFLECTION.md holds feedback on an earlier attempt at this task; use it." Evaluate one cell and reply with the protocol YAML only.
<the eight request fields of controller step 3>
--- REFLECTION.md ---
<the latest reflection's error identification, root cause analysis, correct approach and key insight>
```

A Harbor case runs from its benchmark repository and has no Workspace here to carry the file: on Harbor cases, skip regeneration (one reflection per sample) and declare it.

### Reflector

Run one with `run_subagent` per reflection (omit `agent_id`), each in a fresh context:

```text
Read <SKILL_DIR>/SKILL.md, section "Reflector", and act as the ACE Reflector. Reply with the JSON only.
statement: <CASE/statement/README.md>
execution: session <session_id>, score <score>, correct <true | false>
trace: <its root Trace files, TARGET/traces/*/<session_id>_*.jsonl, or the Harbor trial's>
rules_used: <TARGET/scratchpad/<session_id>/ace-rules-used.txt>
playbook: <PLAYBOOK/rules.yaml>
```

As the Reflector, read only these inputs and the Workspace the Trace's `session_meta` names: never a `rubric/`, a gold answer, another case, another Trace or OUT. When `rules_used` is missing, take the ids from the Trace's write of that file, else treat them as none. Work from what the execution actually did and produced, not from what it said it did. Reply with one JSON object: `error_identification` (what went wrong, or `none`), `root_cause_analysis`, `correct_approach`, `key_insight` (a lesson that holds beyond this case, with no case id, instance value or answer), and `bullet_tags`, a list of `{"id": "<rule id>", "tag": "helpful" | "harmful" | "neutral"}` covering only the rules used.

### Curator

```text
Read <SKILL_DIR>/SKILL.md, section "Curator", and act as the ACE Curator. Reply with the JSON only.
playbook: <PLAYBOOK/rules.yaml>
reflection: <the OUT file of the latest reflection>
statement: <CASE/statement/README.md>
progress: sample <i> of <C>, epoch <e> of <E>; playbook token budget <playbook_token_budget>
```

As the Curator, read only these inputs. Add only what the playbook lacks: reusable insights from the reflection that no entry already covers, with no quota to fill. Reply `{"reasoning": "…", "operations": [{"type": "ADD", "section": "<snake_case section>", "content": "<one rule>"}]}`; an empty `operations` list is valid. ADD is the only operation, as in the release: never restate, edit, merge or delete an entry. Never copy a case id, an instance value or an answer, and keep the playbook within the token budget.

### Publish

Only you write `PLAYBOOK`, and only while no cell runs. Apply a change deterministically: a `helpful` or `harmful` tag adds 1 to that counter of an existing entry, and `neutral` changes nothing; an ADD appends `{id, section, content, helpful: 0, harmful: 0}` with the next fresh id (`r-0001`, `r-0002`, …, never reused) and the Curator's `content` verbatim, with no second rewrite. Drop, and record, an ADD whose content names a case id. Then bump the `ace-playbook` Skill's `version` (the next `N` when it carries today's date, else today's `.1`) and the State `version` in `STATE/system_config.yaml` by 1, replacing the field rather than adding a second one; parse both files back, and copy `rules.yaml` to `OUT/playbook/v<version>.yaml`. A change that leaves `rules.yaml` as it was publishes nothing.

Deduplication stays off, as in the release: its optional BulletpointAnalyzer needs an embedding model this toolkit does not configure, so decline a request for it rather than imitate it with a model's similarity judgement and call that the paper's grow-and-refine. If a publication would push `rules.yaml` past `playbook_token_budget` (about 4 characters per token), stop training at the last published State; never compress the playbook.

### Stops

Stop when the budget is spent, on `version_changed` or `benchmark_invalid`, on an `evaluation_failed` with no repair left, on a runtime mismatch, on a Target edit to `PLAYBOOK`, and when private scoring material enters a role's context (discard that reflection or curation as contaminated). The last published State stays; never publish a partial or contaminated change, and say what stopped the run.

## Freeze and report

After the last sample, the live State is the final playbook. ACE keeps it whatever it scores: with no validation split here, the release's best-validation selection does not apply, and a training score never selects a version. Make sure its snapshot exists, then measure it on `benchmark_id`, and on `test_benchmark_id` when given, with a `summary_title` such as `ACE · final playbook, 1 epoch, 14 rules · 71.50`. After an early stop, measure the last published State only when the user asks, and name the stop in its summary. Keep every snapshot, record and OUT file; the user can bring H1 back from its snapshot.

Report:

- the H1 and final State versions, the initial and final `rules.yaml` with their SHA-256 hashes, and the entries per section;
- the baseline and final scores per Benchmark, and per case;
- per sample, the initial, regenerated and post-curation results, kept apart from the frozen matrices; the reflections, counter events, ADD operations and empty curations; the rules the Traces show the Target applying (a read is not a use, and a use is not a gain);
- the settings and budget used against the plan, and every stop or skip;
- the cost of every role: the Target cells' costs from the worker results, and the usage the Reflector and Curator Sessions recorded;
- the source links and revision, and every adaptation: the playbook is a target-owned Skill read through a fixed `AGENTS.md` line; the Generator is a full agent run with tools that reports the rules it applied; correctness is a full Rubric score, and the Reflector sees the score but never a gold answer (the paper's setting without ground-truth labels, plus a score); the final playbook is kept without validation; training and measurement share `benchmark_id` unless `test_benchmark_id` was given; Harbor cases skip regeneration. This is not a reproduction of the paper's AppWorld or financial-analysis numbers;
- that the Evaluation Center's chart shows the curve under the label `<agent_id> · <model_id> · <thinking_level>`.
