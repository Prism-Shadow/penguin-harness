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

The generated Statement supplies public route templates, parameters and discovery
policy. Check actual requests against that policy, including failed probes; a
404 does not authorize an off-list path. A missing public interface or private
runtime dependency is a packaging issue, not permission for the Target to inspect
server files, databases or process metadata.

Score the explicit Target prediction path with this Case's upstream grader.
Several upstream wrappers default to gold when no argument is supplied. Read the
whole documented output and preserve stdout/stderr. Score fields, scales and
accepted exits vary by case and split; use this Case's recorded mapping, never
assume `score * 100` for every group. A nonzero exit is scored behavior only when
the contract explicitly permits it and returns a valid score.

Keep raw score/scale separate from the converted `0..100` result. Apply declared
missing/malformed-submission handling without masking a runtime or grader failure.
If referenced controls are needed but unavailable, report that packaging gap;
do not fetch another split's verification records. Preserve artifacts and failure
evidence for the caller and leave frozen benchmark files unchanged.
