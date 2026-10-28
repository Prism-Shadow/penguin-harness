# Portable skills and usage evidence

Read this when drafting skills, checking the final library or auditing Target usage.

## Skill content

Each planned skill keeps its stable name and the id `<construction_case_id>/<skill_name>`.
Its YAML frontmatter version must use `YYYY.MM.DD.N` (for example `2026.10.19.1`),
not a hyphenated date. The name must match the planned skill directory exactly.
The id identifies an artifact; it must not become a hidden task-id routing rule. Describe
public applicability, inputs, parameter binding, executable steps, outputs, checks and known
limitations in `SKILL.md`. Abstract instance-specific names, dates and paths into parameters;
retain domain constants and rules when their independent sources justify them.

Put `contract.json` beside it:

```json
{
  "id": "CASE-001/calculate-totals",
  "applies_when": "The task asks for totals from numeric input rows",
  "parameters": { "input_file": "Task-provided path to the rows" },
  "outputs": ["A total in the requested units, rounded only for final presentation"],
  "checks": ["Cross-check with an independently computed small input"],
  "limitations": [],
  "resources": ["scripts/total.py", "references/arithmetic.md"]
}
```

The contract is descriptive and contains no expected answer, virtual score or test suite.
List every supporting file under `scripts/`, `references/` or `assets/` in `resources`.
Resolve those paths relative to the nested skill, regardless of the caller's working
directory. Python scripts can use `Path(__file__).resolve().parent` for their own resources;
task input/output locations are explicit arguments. Do not embed practice mount roots,
scratch directories or construction Case answers. Disable bytecode generation during
practice or remove caches before registering the revision.

During authoring, before the executor freezes skills for practice, run a deployment-layout check: copy
the current skills to another temporary root and exercise documented entry points with
small allowed inputs and explicit input/output paths. Record commands, outcomes and resource
versions outside the library, in author scratch. The controller can inspect those records;
they do not transfer to official practice and must never be dependencies of skill application.
The creator's conversation persists across the transition, but author scratch does not.
During official practice, read `inputs/practice-context.json` for the transferred files and
required outputs. The executor checks skill/input hashes before and after practice; do not
read or recreate an author deployment report to perform that check. This checks packaging,
not target correctness; it must not
call a Benchmark grader, expand the refinement budget or consume test-set inputs. Do it
within the existing practice/time budget. Any repair remains a recorded creator revision.

The controller can validate the assembled library separately:

```bash
python3 "<skill_dir>/scripts/artifacts.py" check "<OUT/library>" "<plan.json>" --forbid-prefix "<practice mount root>"
```

`plan.json` maps construction Case ids to their fixed lists of skill names. The freeze event
performs the same checks plus comparison with the last registered revisions. The validator
rejects symlinks, missing/unlisted resources, known practice paths and plan mismatches. It
does not prove arbitrary code portability, task correctness or absence of embedded answers;
review those against public inputs and recorded research before freezing.

## Target usage

The fixed library reader asks the Target to write `openskill-usage.json` in its Session
scratchpad, outside Agent State and the requested deliverable. The record is:

```json
{
  "skills": [
    { "id": "CASE-001/calculate-totals", "status": "applied", "evidence": ["Ran scripts/total.py with the task input"] }
  ],
  "reason": ""
}
```

For each selected skill, report the furthest observed stage: `selected`, `read`, or `applied`.
Reading or application needs a concrete file/command/action description. If none applies,
write an empty list and its reason. Do not claim use merely because the skill is installed.
Missing records remain missing; do not rerun a Target to manufacture better usage coverage.

After formal evaluation, an auditor outside all construction contexts checks the Target's
trace. Preserve the raw self-report; make a separate copy bound to the evaluated library
using `library_sha256` from the frozen manifest, and attach trace file/line references to
its evidence. Validate its structure with:

```bash
python3 "<skill_dir>/scripts/artifacts.py" usage "<frozen library>" "<bound usage record.json>"
```

The helper labels accepted records `self_report_only`: it checks identity and evidence
fields, not trace semantics. The auditor separately records `read_confirmed`,
`application_supported`, `not_observed` or `unavailable` with citations to actual tool calls
and outputs. A file read is not proof of application; application is not proof of a gain.
Use runtime evidence rather than the Target's narrative. If record and trace disagree,
report both. No usage audit, target score or target trace re-enters construction.

Report usage coverage alongside scores, execution termination (including timeouts), and
costs for construction and evaluation separately. Distinguish an absent observation from
a demonstrated failure to use a skill. This adds observability; it does not force loading.
