# Isolated construction executor

New experiments use `scripts/executor.py`. It owns construction role launches, measured
practice commands, pytest execution, process shutdown and journal transitions. The Skill
remains the controller for research, diagnosis, packaging and final evaluation. Do not
dispatch construction through unrestricted `run_subagent`, SSH helpers or shared containers.

New initialization records `feedback_policy: bounded-evidence-v2` unless another supported
policy is supplied. The policy, per-revision `skill-review` event and one-per-Case
unavailable-research fallback are described in [bounded-feedback.md](bounded-feedback.md).
`next` returns `review_skills` after a revision's first valid measurement and retains
`open_skill_findings` across verifier repairs. Known defects prevent successful or
evidence-limited closure until independently resolved. Unknown rules alone need no repair.
`evidence_limited` retains unresolved requirements and is not full virtual acceptance.
Old journals keep their recorded policy. No active configuration or STOP is rewritten.

## Requirements and trust boundary

Run the executor on the Linux machine with the practice images and a local Docker daemon.
It requires Python 3.11+, Node 24+, the built Penguin core SDK and a configured Penguin Project.
Model credentials stay in that Project and are resolved by the SDK; never copy them into a
request, prompt, environment image or container. Remote experiments run the executor on the
remote machine. SSH remains a controller operation, unavailable to construction roles.

Supply a reviewed practice image pinned by local `sha256:` image id. It must contain the
public task environment, `/usr/bin/env`, a compatible shell, Python and pytest, and be able
to run the mounted host Node binary. It must contain **no graders, solutions, preinstalled
task skills, prior outputs, credentials or scoring logs**, including in its startup services.
The `sanitized_image` flag records the controller's review; it is not an automatic image audit.
An image whose startup requires an external service is unsupported until that service can
run privately inside the same container. Preflight failure must stop the operation.

Each author and each official measurement gets a fresh container with no external network,
no Docker socket, its own process namespace and bounded resources. Business APIs may run
on that container's loopback interface. Tools run as the specified non-root uid/gid, normally
the executor user's ids so output files remain readable on the host. The image entrypoint
can initialize its local service using CHOWN/SETUID/SETGID; tool processes cannot acquire
those privileges. Do not share service state or writable volumes across roles.

The trusted launcher calls the existing core SDK. It creates a dedicated empty Agent State,
disables memory/vault/skill/schedule injection and exposes only `read_file`, `write_file`,
`edit_file`, `exec_command` and `input_command`. All file and command operations use the SDK's
`confineSpawn` boundary. Fresh verifier Agent/Session identities prevent inherited creator
history. The creator resumes its recorded SDK Session. Role containers receive only their
workspace, explicit read-only input views, their own read-only SDK scratch files, and the Node
executable. The journal, other roles, SDK state and host credentials are absent.

This protects against a role browsing the host or another role. The controller, the SDK,
Docker daemon and reviewed image remain trusted. A controller can still leak forbidden
information by copying it into an approved public file or writing it in feedback. Review
input contents, research provenance, output allowlists and diagnosis text. Containers cannot
prove semantic independence, verifier correctness or that a learned skill will generalize.

## Role paths and process review

New role launches keep one SDK Workspace path throughout a creator's life. During authoring,
it contains writable skills and a read-only `inputs/` view. During official practice, the same
container path is backed by a fresh output directory, with the frozen `skills/` and `inputs/`
mounted read-only beneath it. Author scratch files are not exposed as practice inputs. The
mapping is recorded in the container receipt; no experiment parent directory is mounted.
Leave `exec_command.workdir` unset or use this Workspace. File-tool relative paths use that
same root. A truly out-of-scope working directory still fails and triggers strict stopping;
there is no automatic retry or broadened access after a refusal.

At the transition, the executor writes `inputs/practice-context.json` into the read-only
practice view. It lists the current roots, transferred skill/input files and required
outputs. The creator keeps its Session history, but author reports, scratch files and
earlier outputs are absent from the new Workspace. Deployment-layout checks run during
authoring; their reports remain controller evidence and are never practice dependencies.
The executor records `integrity-before.json` and `integrity-after.json` under each practice
operation. It hashes the frozen skills and complete input view, including the context file,
before dispatch and again before importing answers. A mismatch blocks registration even
when the role exits successfully. These records are sealed with the execution evidence;
they establish unchanged files, not correct business decisions. Models still need to
follow the phase contract. Missing-file failures follow the policy fixed at initialization.

The independent verifier checks output requirements. The executor checks skill structure,
and the trusted controller reviews delivery, reusable content and construction isolation.
In v2, the separate per-revision behavior review first routes observed skill defects into
feedback. Its selected public diagnostics reach only the creator's read-only input view;
no automatic semantic reviewer is launched. Verifier repairs retain the previous sealed
plan, source seal, controller review, suite, coverage and logs so valid expectations can
be reused within the remaining budget.
Before `finish-case` can declare a deployable result, new isolated runs require a JSON
record under `tasks/<case_id>/review/`, supplied as the event's `process_review` path:

```json
{
  "skills_sha256": "<last registered revision digest>",
  "outputs_sha256": "<last registered output digest>",
  "checks": {
    "delivery": {
      "status": "passed",
      "finding": "<review of required skill entry points, resources and deliverables>",
      "evidence": ["<relative file path inside OUT>"]
    },
    "portable_content": {
      "status": "passed",
      "finding": "<review of parameter binding and absence of answers, scratch paths or test data>",
      "evidence": ["<relative file path inside OUT>"]
    },
    "construction_isolation": {
      "status": "passed",
      "finding": "<review of role mounts, source provenance and recorded tool execution>",
      "evidence": ["<relative file path inside OUT>"]
    }
  }
}
```

These are controller findings, not generated default passes or virtual assertions. Review
actual artifacts and traces; describe limitations and stop deployment if a required check
remains unresolved. The journal binds the review and evidence to the final skill/output
digests and rechecks them at freeze. It cannot prove that a controller's semantic assessment
is correct. Keep this evidence outside the deployed library and the verifier's input view.
Do not move any task-output requirement out of virtual coverage to make its rate pass.
Historical runs retain their recorded plugin and behavior; this does not migrate them.

## Initialize

### Prepare the host runtime

For an installed native run, first use the current host’s complete built
`@prismshadow/penguin-core` SDK. Resolve its package through the verified installation or
repository-local launcher; do not guess a path from an earlier server. Full `init` checks
the exports, Session lifecycle and dependency fingerprint without calling a model. No
separate clone or rebuild is needed when that SDK passes. The procedure below is only
for a missing runtime or an explicitly requested separately pinned deployment.


Use one pinned source revision for the SDK package metadata, dependencies and build outputs.
On the source checkout, create a git archive of the recorded commit. Transfer that archive
to the execution host and verify its SHA-256, then run the plugin's helper on that host:

```bash
python3 "<skill_dir>/scripts/prepare_runtime.py" "<source.tar>" "<fresh_runtime_dir>" \
  --revision "<40-character commit>" --sha256 "<archive SHA-256>" \
  --node "<absolute Node 24+ binary>" --pnpm "<absolute pnpm bin/pnpm.cjs>"
```

The helper requires the source's exact `packageManager` version, installs with its frozen
lockfile, builds core, and imports the resulting SDK. It refuses existing destinations and
archives with inherited dependencies or build outputs. Failed directories have no successful
runtime manifest; preserve their build logs and use a fresh destination after fixing the cause.
It does not install Node or pnpm. No Project credentials belong in the source archive.

Set `executor.sdk` to the resulting `source/packages/core/dist/index.js` and optionally set
`executor.runtime_manifest` to its `runtime-manifest.json` for a provenance consistency check.
Do not copy only `dist` into an older CLI installation or rely on a matching package version
number. Keep the runtime directory unchanged for the experiment. Runtime checks fingerprint
the Node binary, core dist, package metadata and direct dependency metadata; this detects
deployment changes, not arbitrary tampering with every transitive dependency file.

`init` uses the configured Node to import the actual SDK and verify its required interfaces.
It creates and disposes a temporary Agent/Session with the configured construction model,
without `session.run`, model requests or task inputs. A never-run Session has no resumable
Trace; session resumption is checked separately by the real-SDK/scripted-provider integration
test. The temporary Agent is removed even on probe failure. Each role repeats the import and
fingerprint check before dispatch. Probe errors, timeouts and changed runtime bytes stop the
experiment. Configuration validation does not prove remote API reachability, quota or access.

### Configure and initialize

Use the existing configuration in `execution.md`, adding:

```json
{
  "execution_mode": "isolated-v1",
  "executor": {
    "sdk": "/path/to/penguin-harness/packages/core/dist/index.js",
    "penguin_home": "/path/to/penguin-data-root",
    "project_id": "default_project",
    "docker": "/usr/bin/docker",
    "node": "/usr/bin/node",
    "image": "sha256:<64 hexadecimal digits>",
    "sanitized_image": true,
    "uid": 1000,
    "gid": 1000,
    "memory": "4g",
    "cpus": 2
  }
}
```

Use actual paths/ids. `image` comes from `docker image inspect --format '{{.Id}}' <image>`.
Optional `case_images` maps construction Case ids to their own pinned image ids. Optional
`entrypoint` (one executable path string, such as `"/bin/sh"`) and `command` (an argv array)
replace the image startup command when needed; they are controller
configuration, never model-provided Docker arguments. Public services must start from clean
state on every invocation. File deliverables are supported; a task whose only output is a
mutated service/database must first provide an explicit public export as a deliverable.

```bash
python3 "<skill_dir>/scripts/executor.py" init "<OUT>" "<config.json>"
python3 "<skill_dir>/scripts/executor.py" event "<OUT>" "<start-case.json>"
```

`init` checks the host runtime and every declared construction Case's pinned image before creating the journal.
It makes no model requests and does not start construction clocks. All images must pass;
the first failure stops the batch, writes `preflight.json` and `STOP`, and cleans up its
container. Do not reuse that directory. Existing runs remain on their recorded Skill version.

To check environments separately, without a configured model or creating a journal, run:

```bash
python3 "<skill_dir>/scripts/executor.py" preflight "<fresh_CHECK_DIR>" "<config.json>"
```

This uses the same `execution_mode`, `case_ids` and `executor` image/runtime settings.
Use a different fresh OUT for the later `init`; it repeats the checks. SIGTERM or
`executor.py stop <CHECK_DIR>` cancels a standalone preflight and cleans up, including
when no journal has been created yet.

The standalone command reports `scope: environments`; it does not require or validate a
configured SDK/Project. Full `init` reports `scope: runtime_and_environments`. An environment-only
pass is insufficient to launch construction.

### GDPevo business services

Set `executor.startup_profile` to `gdpevo` for the reviewed GDPevo practice images. Omit
`entrypoint` and `command` with this profile. The executor mounts the plugin's
`gdpevo_start.py` read-only and records its digest. The image's service directory, command,
port and health path come from its reviewed `GDPEVO_*` configuration. No benchmark checkout
or generated Dockerfile needs editing. Images retaining the normal GDPevo entrypoint are
refused unless this profile is selected.

The trusted supervisor starts the service as `taskenv`, which opens its own private log
after changing identity. The service receives `TASK_ENV_ENABLE_JUDGE=0`; its data and API
semantics are unchanged. Startup does not restore DAC_OVERRIDE, KILL or privileged mode.
The ordinary role uid/gid must differ from `taskenv`; it must have no taskenv group access.

Before each role or official measurement, the executor checks the non-root SDK worker,
zero effective capabilities, no-new-privileges, writable outputs and read-only input mounts.
With the GDPevo profile it also waits for the health API, confirms the role cannot list the
private service directory, and requires HTTP 404 from an empty judge request. That request
contains no candidate answer. The image review is still required; these probes do not audit
all routes or replace removal of grading assets. `startup_timeout_seconds` defaults to 120,
is limited to 300, and is bounded by the active Case deadline during construction.

`preflight.json` records the batch outcome. Container records under `.executor/containers/`
record readiness, the bootstrap hash and probe outcomes. Before removing a container, the
executor attempts to save its state, exit/OOM information and bounded logs under that
directory's `diagnostics/`. It saves command stderr on startup errors. Log collection is
limited to three seconds and 64 KiB per stream per command, and cannot block mandatory
cleanup on failure. These private diagnostics never enter creator/verifier views or skills.

`start-case.json` is `{"action":"start-case","case_id":"CASE-001"}`. Start the clock before
research. Then retrieve and stage public files under `OUT/tasks/CASE-001/inputs/public/`,
domain knowledge under `inputs/knowledge/` and independent anchors under `inputs/anchors/`.
These files are copied and hashed before the first role starts. The original Benchmark tree
is never mounted. Source links, clean queries and retrieval dates belong in the research files.

The executor serializes operations within OUT. Separate experiments can run concurrently.
All Cases declared in one experiment still share its final global freeze. A busy lock causes
a refusal; it does not launch a second writer. `status` and `next` remain read-only and can
be used while an operation is running.

## Creator and official practice

Prepare the initial request after reviewing its inputs and fixed deliverable allowlist:

```json
{
  "case_id": "CASE-001",
  "skills": ["calculate"],
  "hypothesis": "Aggregate all rows using the documented adjustment rule",
  "public": {
    "task.md": "tasks/CASE-001/inputs/public/task.md",
    "rows.json": "tasks/CASE-001/inputs/public/rows.json"
  },
  "knowledge": {"knowledge.md": "tasks/CASE-001/inputs/knowledge/knowledge.md"},
  "anchors": {"anchors.md": "tasks/CASE-001/inputs/anchors/anchors.md"},
  "outputs": ["total.txt"]
}
```

```bash
python3 "<skill_dir>/scripts/executor.py" creator "<OUT>" "<creator-request.json>"
```

The executor creates the persistent creator, records its actual session id before the first
model request, and supplies the portable skill contract. It stops the author container,
copies the authored skills and starts a fresh practice environment. The default
`practice_mode: agent` resumes that same creator to read and apply the frozen skills.
Author scratch is hidden; the skill snapshot and inputs are read-only, and the fresh output
directory is writable. Markdown procedures and executable resources are both supported. Model completion
alone is insufficient: the declared result files must exist and pass safe import checks.

For a task fully represented by a reusable command, set `executor.practice_mode` to
`command` before initialization and report the adaptation. Its creator also writes
`practice.json`, for example:

```json
{"argv":["python3","${SKILLS}/calculate/scripts/total.py","${INPUTS}/rows.json","${OUTPUTS}/total.txt"]}
```

The executor substitutes the three roots and runs the argv array directly in a fresh
container. At least one argument must name a real frozen skill file. This establishes a
file reference, not semantic use; inspect the trace and command to establish how it was
applied. Arguments can repeat and never undergo host shell interpolation.

Both modes import only declared output files and register actual process times, exit status,
logs and the skill hash. Agent mode retains the SDK tool stream as execution evidence; a
self-written receipt is never used. Symlinks, hardlinks, special files and traversal are
rejected at import. Executable bits on copied resources are retained without privileged bits.
The creator's private workspace persists for revisions; the business environment does not.
Learned content must be portable. Temporary execution paths must not enter deployed skills.

## Verifier, feedback and repair

```bash
python3 "<skill_dir>/scripts/executor.py" verifier-plan "<OUT>" "<case-request.json>"
```

`case-request.json` contains `{"case_id":"CASE-001"}`. The executor reserves one attempt
before staging or launching. Its fresh verifier sees public inputs, independent anchors and,
on repair, its previous verification evidence. Candidate outputs are withheld during planning.
Creator skills, history and workspace are never exposed. The verifier writes a plan:

```json
{
  "schema_version": 1,
  "requirements": [{
    "id": "total",
    "requirement": "Sum every numeric row",
    "required": true,
    "basis": "derived",
    "expectation": "Output equals the sum of all rows, including negative values",
    "reasoning": "Apply the task's stated addition rule to the supplied array",
    "sources": [{"path": "public/task.md", "quote": "Sum every numeric row"}]
  }]
}
```

Use `basis: source` for an explicit fact, `derived` for a computation from documented rules,
or `hypothesis` for an unsupported expectation. Keep missing requirements; a hypothesis may
have an empty source list. References must identify an exact excerpt in `public/`, `research/`
or `additional-research/`. The executor checks file/excerpt membership, not entailment. An enum
does not assign a permission, and a measurement does not supply a policy threshold.

The plan and input hashes are saved under `.executor/<case>/verify-N/oracle/`; `next` returns
`review_verification_plan`. Inspect the actual evidence before writing a controller record
under `tasks/<case>/review/`. Do not generate default passes from the model's basis labels:

```json
{
  "plan_sha256": "<from oracle/seal.json>",
  "inputs_sha256": "<from oracle/seal.json>",
  "reviewer": "<controller identity>",
  "scope": "independent_evidence",
  "decisions": [{"id": "total", "status": "supported", "finding": "<independent review finding>"}]
}
```

Decide every requirement as `supported` or `unverified`. Unsupported source claims can be
downgraded; a declared hypothesis cannot be promoted without a new evidence-backed plan.
Check the plan against the complete public task before approving it. The validator detects
requirements dropped from coverage, but cannot detect public requirements the plan omitted.
An incomplete plan must not proceed; stop or recover the pending attempt and follow the
recorded feedback and retry budget. Do not silently add requirements to a sealed plan.
Then continue with `{"case_id":"CASE-001","review":"tasks/CASE-001/review/attempt-1.json"}`:

```bash
python3 "<skill_dir>/scripts/executor.py" verifier "<OUT>" "<review-request.json>"
```

This resumes the same verifier, adds immutable candidate outputs and the reviewed plan,
and uses a fresh writable directory at its stable Workspace. No new attempt is reserved.
Missing/stale reviews refuse dispatch without calling the model. Once dispatched, a failed
author or measurement is collected normally; there is no retry within the attempt. Both
stages and controller review remain inside the original deadline. Research repairs still
use recorded feedback and the existing retrieval/verification budgets.

The verifier writes `suite.py` and copies `oracle/coverage-template.json` to `coverage.json`.
The host supplies the top-level array, all requirement ids/text and expectation hashes;
the model fills test ids, source notes and covered status for supported checks. It must not
wrap the array or recalculate hashes. Every template row starts unverified with no tests,
so the template alone cannot establish coverage. Reviewed `unverified` entries must remain unverified
with `tests: []`. Omissions, changed expectations or unsupported promotions are refused
before pytest. This binds declarations; it cannot prove that arbitrary Python implements
the declared expectation. Inspect test semantics when reviewing failures and results.

The executor runs pytest exactly once in a fresh measurement container. Tests use these
environment variables; each points directly to its own read-only category:

| Variable | Contents |
| --- | --- |
| `OPENSKILL_INPUTS` | Public task inputs, matching `inputs/public` during authoring |
| `OPENSKILL_RESEARCH` | Independent anchors, matching `inputs/research` |
| `OPENSKILL_ADDITIONAL_RESEARCH` | Selected retrieved evidence, matching `inputs/additional-research`; empty if none was selected |
| `OPENSKILL_OUTPUTS` | Candidate deliverables, matching `inputs/outputs` |
| `OPENSKILL_ORACLE` | Reviewed plan, seal, review and coverage template |

For a plan source `research/business/data.json`, read
`Path(os.environ["OPENSKILL_RESEARCH"]) / "business/data.json"`.
`OPENSKILL_INPUTS` retains its public-only meaning. Do not append `research/` to it or
fall back to the working directory, public inputs or an author-time absolute path.
Development replay uses the same measurement contract. JUnit ids are `suite::test_name`,
including parameter suffixes.

A read-only pytest collection hook rejects more than the configured number of collected
tests before test execution, including parameter expansion. The executor collects the real
exit code and JUnit XML. Author failure is `not_started`;
interrupted pytest is `interrupted`. Neither becomes a valid measurement. A failed launch
still spends the reserved attempt. The existing parser, structure and coverage checks decide
acceptance. There is no retry hidden inside an attempt; role exploratory tool calls are not
official measurements and cannot write the final report or spend an extra official attempt.

After an unsuccessful attempt, inspect `next` and the sealed pytest evidence. Record the
complete `feedback` event through `executor.py event` using `execution.md`'s schema. The
controller diagnoses from public requirements and virtual evidence; it must not inject
target scoring data or creator implementation into verifier feedback. A subsequent creator
request needs only `case_id` and `hypothesis`; it resumes the same creator. Verifier repair
starts with a new `verifier-plan` invocation and spends another attempt without fabricating a revision.

For `NEEDS-DR`, reserve and collect searches through `executor.py event`. Save retrieval
evidence under `OUT/tasks/<case_id>/research/`. A role request may add `research_files`, a
destination-to-source map, but every source must be a hash-sealed `search-result` evidence
file in that directory with `outcome: "retrieved"`. Unavailable responses remain controller
diagnostics and are not research inputs. Arbitrary files from another role cannot be passed
through this field. Destinations are relative file paths inside `additional-research/`;
traversal, duplicate normalized names and file/directory overlaps are refused.
Initial files stay immutable; new research augments the role's next input view.

Both creator and verifier-plan requests validate this selection before staging, runtime
probes, model calls or repair/attempt reservation. A rejected selection raises a request
error with no STOP or budget deduction; correct it within the original Case deadline.
The executor rechecks selected evidence before staging. Changed sealed bytes or linked
artifacts remain integrity failures and stop the run. Once a valid request is dispatched,
execution failures still spend their reserved budget under the declared recovery policy.

All budgets and final-version rules in `execution.md` remain in force. In particular, the
third failed verification may be followed by the final skill revision, with no fourth test.
The executor refuses dispatch when `next` calls for feedback, retrieval, termination or a
different role. It does not invent a recovery decision or silently change an expected value.

## Stop, recovery and final freeze

### Graded policy for new experiments

Use the following top-level configuration for new runs. It cannot be combined with
`stop_on_recurrence: true`. With no `recovery_policy`, the recorded legacy behavior remains;
never add this configuration to an existing journal or remove its STOP fence.

```json
{
  "recovery_policy": {
    "version": 2,
    "max_tool_recoveries": 6,
    "max_same_error_recoveries": 2,
    "recovery_seconds": 180,
    "max_execution_repairs": 2,
    "max_verifier_repairs": 1
  }
}
```

All counts are per Case across revisions, recorded by the host. Counts may be zero to
disable a recovery path. The correction window is 1–600 seconds and never extends the
Case deadline. Version 2 gives up to six local practice corrections, two per tool/error
family, two additional failed-practice repairs and one verifier repair. A recognized Python
exception names the family; other ordinary command exits share `CommandExit`.
Same-family failures from a single model response share one allowance, since the model
has not yet had a chance to observe and correct them. Every failure remains in the trace.
Different families and later responses spend separate allowances.
Verifier repair also consumes the original `max_refinement_retries` allowance. A failed
practice repair adds one execution, up to the declared Case cap, beyond the ordinary
initial-plus-refinement count. Report that engineering cost separately from learned skill
revisions. Explicit version 1 and unversioned recovery configurations retain the previous
per-tool-output counting, allowlisted Python errors and immediate stop on local exhaustion.

| Observation | Executor action |
| --- | --- |
| Local practice command returns an ordinary nonzero exit, including a Python exception, invalid argument or no-match search | Preserve the raw tool output and allow correction within the remaining count and time limits. |
| Same error family recurs beyond its allowance, total tool allowance is exhausted, or correction times out | End this practice and return `repair_execution` while its separate allowance remains. Local counts never reset. Changing field names does not reset a family. |
| A traceback points into frozen skill files, or the declared command fails | Return `repair_execution`; frozen skills stay read-only. Repair authoring and execute in a fresh output directory. |
| Role finishes without every declared output, or ends with an unresolved correction | Record failed delivery; a bounded execution repair is required. Partial files are not registered. |
| Independent assertions fail or a requirement is honestly unverified | Use the usual feedback and skill/refinement protocol; never infer a target score. |
| Verifier omits a suite, produces an invalid plan/coverage record, or supplies no valid measurement | Record an unsuccessful attempt; explicit feedback may request one budgeted verifier repair. Invalid evidence cannot accept a candidate. |
| Cancellation, permission/isolation failure, changed evidence/runtime, signal-style exit, failure without a process status, or exhausted repair allowance | Stop and clean up. No automatic retry or broader permissions. |

Local recovery is limited to `exec_command` / `input_command` results with an exit marker
from 1 through 124 and no permission/isolation fault, plus a version-2 `edit_file` text
mismatch inside the writable working directory (`edit_file:EditMismatch`). A mismatch while
editing frozen `skills/`, `/opt/openskill-skills/` or `inputs/` is a boundary fault, not a
local correction. A successful command **or file edit** from a later
model response closes the correction window; it establishes execution only. A successful
sibling command, self-report, file read or running
background process cannot close it. Independent tests and the controller's final process
review still determine whether the delivered result meets requirements. Do not patch an
answer to match an ad hoc self-check. Author exploration retains the Case wall-time budget;
the local correction allowance applies to official practice.

When `next` returns `repair_execution`, diagnose its retained failure and dispatch:

```json
{
  "case_id": "CASE-001",
  "hypothesis": "<observable change expected from the repair>",
  "execution_recovery": {
    "action": "revise_skill",
    "diagnosis": "<cause supported by the recorded execution failure>",
    "expected_change": "<what a fresh execution must do differently>"
  }
}
```

`revise_skill` resumes the same creator and must change the failed skill bytes before
freezing again. `repeat_practice` is available for invocation or delivery faults and must preserve those
bytes; it skips authoring. The executor reserves the repair before model dispatch. Old
outputs remain diagnostic and are never copied to the new practice workspace. A recovery
cannot be silently retried if its operation was interrupted. `next` reports the remaining
allowances. Execution failures and recovery receipts are sealed and checked before later
dispatch/freeze. An unresolved execution failure blocks deployment of an older revision.
Choose the action from the recorded cause: an ad hoc inspector's mistake does not require
a skill edit and must not be reported as feedback-driven skill learning. A reusable skill
defect requires an actual resource change, fresh application and independent verification.
The resumed practice reads the retained execution feedback before applying its frozen skills.

These are Penguin engineering safeguards, not paper hyperparameters. No recovery adds
target supervision, changes the fixed skill plan, permits best-of-N selection, or changes
the all-Cases freeze requirement. The controller must still reject contaminated research
and incorrect verifier expectations; text classification cannot prove semantic safety.

### Strict stopping and host interruption

When the user requests stopping the entire experiment on execution faults, set the top-level
configuration `stop_on_recurrence: true` before `init`. A failed creator operation or verifier
without a valid completed measurement, or an invalid coverage protocol, saves
`.executor/failure.json`, sets permanent `STOP`, cleans up this experiment's containers and
returns failure. This includes malformed coverage and test IDs absent from the measured
JUnit report, even if pytest passed. The actual measurement remains in the journal.
A completed pytest assertion failure or honest coverage gap follows the usual
feedback/refinement rules. Runtime failures always fence the run.
Official command practice must exit zero before outputs can be imported. During official
agent practice, a final SDK tool result marked `fatal` or `aborted` ends the role before
another model request; files left by the failed operation are retained only as diagnostics.
Author exploration is separate from official practice and keeps its normal recovery behavior.
Without this option, the existing documented verifier-repair protocol remains available.
Launcher receipts distinguish failure before handshake from an interrupted model turn and
retain the real child exit code; `result.json` identifies the failing launch stage.

```bash
python3 "<skill_dir>/scripts/executor.py" stop "<OUT>"
python3 "<skill_dir>/scripts/executor.py" recover "<OUT>"
```

`stop` sets a permanent fence and removes only this experiment's labelled containers. The
creation transaction shares a lock with stop, so no container can start after stop returns.
`next` reports `stopped`, and further role dispatch is refused before even probing the SDK.
The running launcher aborts its model stream and disposes command sessions. Deadline expiry
and SIGTERM also stop workers. A cleanup that cannot be confirmed leaves a STOP fence and
cannot seal a verification as completed. Check the command's exit code; a requested stop
is not proof of shutdown when Docker itself is unavailable.

After a host crash, use `recover` once the old executor process has exited. It obtains the
writer lock, stops owned containers, preserves partial artifacts and closes pending attempts
as interrupted. It never reruns a command or reconstructs a successful measurement from a
leftover XML. Uncollected creator work stays available for inspection, but is not silently
registered or retried. Record its evidenced failure/interruption; do not remove operation
directories, clear STOP or replace a missing creator to continue that run.

### Controlled delivery continuation

A fenced practice is normally immutable. One narrow exception exists for a practice that was
stopped **after** it had already written every declared deliverable and whose remaining defect
is a controller-owned delivery fault, such as a diagnostic probe the role was still correcting.
The controller may register those exact bytes as a continuation revision without pretending the
role completed. The original STOP file, failure directory and journal history stay in place.

```bash
python3 "<skill_dir>/scripts/executor.py" resume-delivery "<OUT>" '<request.json>'
python3 "<skill_dir>/scripts/executor.py" resume-verifier "<OUT>" '<request.json>'
```

`resume-delivery` requires a `STOP`, no earlier continuation and no active verification. It
checks the source attempt's `execution/result.json` (completed false, with an allowed error
code), its `integrity-before.json` against the current frozen skills and practice input view,
the practice skills under the same digest as `root/skills`, and the declared output tree. It
copies answers and work into a new boundary that still carries the original STOP digest, so
removing or rewriting that STOP invalidates the operation; it applies only the declared repair
source to its declared relative paths and then runs the required probes. It refuses the
registration unless every answer hash is unchanged, the probe schema and count match, all
required probes pass and `status_counts.fail == 0`. The continuation record must state the
fenced role's `completed=false`, `role_success_claimed=false`, the controller as repair owner,
the preserved answer files, the original skill/input/output hashes and the probe results.
The resulting revision carries `delivery_kind="continuation"` and is recorded as a delivery
failure recovery, not as a successful role or a new practice attempt. When the fenced practice
already had a changed skill set, the live tree must still match the last registered revision;
the continuation imports the practice's skills as a recorded `revise_skill` with both the
previous and imported digests. It does not reset local
recovery counts, spend a practice or verification allowance, or extend the deadline, and only
one such continuation is accepted per Case. If a hash differs, isolation is breached, a
required probe still fails or a byte of an answer changes, stop and report; never edit the
answer, weaken a valid assertion or clear the fence.

`resume-verifier` replays an independent check of a registered continuation revision. It
reuses the source attempt's sealed plan, seal, controller review, coverage template and suite,
then executes that suite in a fresh boundary and writes a separate attempt directory. It is
recorded as one separate re-verification, spends the next verification attempt rather than
refunding the original, and cannot accept an unverified requirement. Later
`skill-review`, `feedback`, `finish-case`, `freeze` and the two evaluation journal events
remain available only while the original STOP is present; the record must show the
continuation and every Case must be finished and deployable before a global freeze or an
evaluation transition may retain such a STOP. That retained fence is
reported as a recovery deviation, never silently deleted.

Use `executor.py event` for `finish-case`, `freeze` and evaluation journal events. Packaging
and deployment follow `initialization.md`; scored workers still follow the unchanged
`evaluation.md` only after the global freeze. Direct `experiment.py event` mutations are
refused for isolated journals. Old journals remain unchanged and use their recorded helper
version; this executor refuses to adopt them.

Audit `OUT/.executor/` for input manifests, role launch contracts, streamed messages, actual
process receipts and container ownership records. `OUT/tasks/` contains registered practice,
verification and journal evidence. None of the private runtime records enters the library.
The new mechanism does not repair or validate previous benchmark results retroactively.
