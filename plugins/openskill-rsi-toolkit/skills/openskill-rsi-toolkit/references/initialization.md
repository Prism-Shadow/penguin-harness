# Initialize and publish an OpenSkill library

The controller prepares a baseline without evaluating it. Construction happens in scratch directories; the Target receives only the frozen library. Resolve paths from SKILL.md. Preserve unrelated Target configuration and content.

For multiple selected Benchmark units, prepare separate Targets from the same clean base
configuration and record their State identities. Each unit constructs its library once.
Keep that unit's Baseline and final snapshots fixed across all three evaluation repetitions;
do not initialize another learner for repetition 2 or 3. Follow `experiment-organization.md`
for the campaign freeze barrier, shared capacity and result collection.

Before initializing the journal, set the requested experiment version, actual component
versions and public metric definition according to `result-records.md`. Preserve native
cost, timestamp and token artifacts throughout construction and evaluation. Missing model
revision or pricing data stays unknown; do not inspect credentials or private configuration.

## Prepare the Target

For `create: <id>`, require that the id does not exist. An Agent id is a lowercase letter followed by 1–63 lowercase letters, digits or `_`. Create it through the CLI so it is registered, with no plugins:

```bash
PROJECT_DIR="<app_data_dir>"
PROJECT_ID="$(basename "$PROJECT_DIR")"
PENGUIN_HOME="$(dirname "$PROJECT_DIR")"
export PENGUIN_HOME
penguin agent create --agent-id "<id>" --project-id "$PROJECT_ID" --json
```

For a new Target, set `memory.enabled: false` and `hooks.enabled: false` by parsing and updating `system_config.yaml`, without duplicate keys. Preserve its initial version. Make sure `STATE/memory/user/MEMORY.md` exists before hashing: the runtime would create it at Session start. The baseline has no learned library or reader.

For an existing Target, reject the controller's own Agent. An existing `skills/openskill-library/` is reusable only to resume this exact experiment with matching phase and hashes; never overwrite a learned library from another run. Do not read prior task memories, skills, traces or scores into construction. Existing domain skills or other task supervision make this a warm-start adaptation, not the paper's no-initial-skills condition; use a fresh Target for that condition. If its enabled memories/hooks can change State during evaluation, explain that and resolve the configuration before starting. Do not silently disable them on an existing Agent. Ensure the runtime's memory file exists before taking the baseline snapshot; record any initialization write.

Validate a positive integer State `version` (default 1) and `model.thinking_level` (default `medium`). Snapshot the baseline and hash every State file except `.vault.toml`. No baseline measurement occurs now.

## Isolate construction inputs

First resolve and stage the current package through `native-benchmarks.md`. Keep its
`binding.json` in the experiment record and pass it as `benchmark_binding` at initialization.
For grouped GDPevo training, use the helper’s individual public questions and submission
contract rather than the judge-enabled continuous-training wrapper. Do not read held-out
statements, rubrics, task-group reference answers or evaluation history.


Check `benchmark_config.toml`: `draft` and `failed` are unusable. List the declared Case ids without recursively reading the Benchmark. Copy only each Case's public statement and allowed task inputs into `OUT/tasks/<case_id>/input/`. Keep an explicit relative-path/hash manifest. Exclude rubrics, target tests, reference solutions, prior outputs, task skills, research docs and evaluation logs. Reject escaping symlinks rather than following them. If public input material itself contains target supervision, stop and identify it.

For a Harbor task, fetch the statement's pinned repository revision without searching for the task online. Stage only the selected task instruction and required `environment/` inputs. Review its Dockerfile and build context before execution: no hidden-test or solution mounts, downloads or automatic verifier commands. Do not copy the whole task checkout into the creator or verifier workspace. Never run the statement's evaluation command at this stage. Record environment/tool versions and any differences from the final environment.

Give creator and verifier roles explicit permitted paths. Separate Sessions isolate conversations, not filesystem permissions. Use configured sandbox/container isolation where available; a plain workspace with prompt-level restrictions must be recorded as that adaptation, never claimed as OS-enforced isolation. Keep benchmark identifiers out of research prompts and queries.

## Build the Target library

During construction, stage this tree in `OUT/library/`, not STATE:

```text
SKILL.md
index.md
tasks/<case_id>/<skill_name>/SKILL.md
tasks/<case_id>/<skill_name>/contract.json
tasks/<case_id>/<skill_name>/references/...
tasks/<case_id>/<skill_name>/scripts/...
```

Each task has exactly the 1–4 skills in its plan. Nested skills retain a frontmatter `name` matching their directory, a useful description and a dated version. Their content may be revised together. Follow `skill-contract.md` for stable ids, parameterized procedures and declared resources. The top-level wrapper is a Penguin routing adapter, not an extra learned skill. Its body and the reader line below use the fixed text here; the baseline has no wrapper installed.

Create the wrapper with today's date:

```markdown
---
name: openskill-library
description: Reusable procedures learned from independent research and virtual practice. Read index.md and the skills whose public task scope matches the current task.
version: YYYY.MM.DD.1
---

Read index.md in this directory. Match its applicability descriptions to the current task's public instruction, inputs and tools. Read each applicable nested SKILL.md in full, then use its procedures within the current task's requirements. Resolve references and scripts relative to that nested skill. If nothing applies, solve the task normally. Do not read another task's material just to infer an answer, and do not edit this library while executing a task.

Before finishing, write openskill-usage.json in this Session's scratchpad, outside Agent State and the task deliverable. Use {"skills": [{"id": "<id from contract.json>", "status": "selected|read|applied", "evidence": ["<actual file read or action performed>"]}], "reason": ""}. Choose one status for each entry, describing the furthest stage actually reached. An empty list needs a reason. Do not claim application from merely reading a file. Preserve the output the task requests.
```

Write `index.md` as a table of stable skill ids, public applicability descriptions and relative nested Skill paths. Use capabilities, input formats and tools as selectors, never scores, gold answers or hidden Case identifiers. Check that every construction Case is covered and that unrelated scopes do not match by a generic description. A task-specific directory name is only an internal path, not a routing signal. For overlapping scopes, clarify the index from construction inputs before freezing, and record the multi-task deployment adaptation. In held-out mode, never inspect test statements to tailor the index.

After freezing the complete library, copy it to `STATE/skills/openskill-library/` and append this line exactly once to `STATE/AGENTS.md`:

```text
Before substantive work on a task, read skills/openskill-library/SKILL.md in your Agent State and follow its instructions for selecting and reading the applicable skills.
```

Preserve all other Agent content. Publish one new numeric State version, snapshot it, and record the deployed digest. No creator or verifier writes STATE.

## Versions, snapshots and restoration

Allocate versions from the maximum of live State, snapshot filenames and versions reserved in this experiment, plus one. Never reuse an abandoned number. During construction do not read `scoreboard.yaml` to allocate a version. If snapshots are missing and the operator cannot establish that a version is unused, use a fresh Target; do not guess and collide with prior measured versions.

A snapshot is `TARGET/snapshots/v<N>.tar.gz`, rooted at `agent_state/` and excluding every `.vault.toml`. Create it before measuring a State; never overwrite an existing snapshot. Verify an existing archive's contents match the State rather than assuming its version label is sufficient. Record a canonical SHA-256 manifest of relative paths and bytes for all State files other than the vault, including the numeric version. Reject symlinks that make the snapshot or digest reach outside State.

Restore an archive to a temporary directory inside TARGET. Validate that it contains only `agent_state/` with no traversal, escaping links or vault, and that its content matches the recorded manifest. Copy the **current** vault into the staged State if present, then replace State with the staged directory. Keep the replaced directory until the version and hashes verify; on failure restore it. Never renumber a restored snapshot. A baseline evaluation must end by restoring the already frozen final snapshot, even when that evaluation fails.

Before handing off to evaluation, re-parse `system_config.yaml`, the wrapper and nested frontmatter; verify names, versions, all index paths, the single reader line and the deployed library's equality to the `library` manifest in `freeze.json`. No practice artifacts or scored outputs belong in State. Usage reports belong to Session scratchpads and must not change the frozen library.

For an explicitly requested reader control, create a separate snapshot from the untouched baseline with the same wrapper and reader line, an empty `index.md` and no learned tasks. Keep all other configuration unchanged. It is an extra post-freeze measurement described in `execution.md`, not the primary baseline or another candidate. Restore the frozen final State after all measurements.
