# GDPevo evaluation

Use after [Penguin evaluation](penguin.md) for a benchmark reproduced from
`Prism-Shadow/GDPevo`. Read only this cell's generated Rubric Runtime and scoring
contract. The construction source of truth is the
[GDPevo reproduction recipe](../../benchmark-reproduction/references/gdpevo.md);
read it only when diagnosing a packaging issue, not to rebuild during evaluation.

## Prepare the business environment

Use the generated benchmark-local launcher with fresh per-cell storage, database
and port. Use its pinned dependencies and declared Docker or local mode; do not
run container setup scripts with hardcoded `/app` paths on the host. If the declared
mode is unavailable, return `evaluation_failed` and let the caller arrange repair.

Keep source code, databases and grader assets private. Disable `TASK_ENV_ENABLE_JUDGE`
and verify the judge endpoint is unavailable as the Runtime specifies. Some
services require judge-related files at import time even with judging disabled;
do not delete dependencies to imitate isolation.

Bind `<TASK_ENV_BASE_URL>` only in the copied Statement. Check the Runtime's exact
health endpoint and retain the cell's process/run identity for readiness and
cleanup; do not rediscover the newest process or directory. The service must
remain alive through task execution and scoring, then stop and reap owned children.

## Public access and scoring

The generated environment-access file supplies the source business route list
and mechanical POST schema; it excludes health/reset/judge from solver access. Check actual requests against that policy, including failed probes; a
404 does not authorize an off-list path. A missing public interface or private
runtime dependency is a packaging issue, not permission for the Target to inspect
server files, databases or process metadata.

Score the explicit Target prediction path with this Case's upstream grader.
Use `python -B` or `PYTHONDONTWRITEBYTECODE=1` when executing or importing its
Python files, including authorized training diagnostics; keep other outputs in
the cell's private directory. Bytecode written beside a shared grader changes
frozen Case materials and can invalidate a concurrent replica.
Several upstream wrappers default to gold when no argument is supplied. Read the
whole documented output and preserve stdout/stderr. Score fields, scales and
accepted exits vary by case and split; use this Case's recorded mapping, never
assume `score * 100` for every group. A nonzero exit is scored behavior only when
the contract explicitly permits it and returns a valid score.

Keep raw score/scale separate from the converted `0..100` result. The source
metric protocol classifies missing or unparseable answer.json as a failed attempt,
even when an individual grader returns zero for it. Preserve both the raw grader
output and protocol failure; do not use that zero in acc@3. This benchmark-specific
rule overrides generic missing-answer scoring. Ordinary parseable wrong answers
retain their source partial score; do not mask runtime/grader failures.
If referenced controls are needed but unavailable, report that packaging gap;
do not fetch another split's verification records. Preserve artifacts and failure
evidence for the caller and leave frozen benchmark files unchanged.

Preserve the source solver prompt and staged input bytes, with only recorded
Penguin transport substitutions. Raw source scoring excludes contaminated attempts;
keep companion-instruction retries and penalty zeros in a separate recovery
condition. Do not replace an invalid original cell with a prompted recovery score
in a GDPevo acc@3 matrix. The independent Reporter follows the reproduction
reference's three-replica and population-std aggregation contract.
