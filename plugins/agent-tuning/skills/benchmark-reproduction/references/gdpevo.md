# GDPevo reproduction recipe

Matches `Prism-Shadow/GDPevo`, `GDPevo` and `GDP EVO`.
Source: https://github.com/Prism-Shadow/GDPevo.

The verified source revision is
`56d60ae4ae5e067d1ec0ee1f850622e69f422179`: 24 task groups, each with 5 training
and 5 testing cases. Use the requested source revision and recheck these facts
when it differs. Prefer a supplied checkout; otherwise clone on demand. Do not
ship the dataset, graders or databases as Penguin/plugin assets.

## Construct

Create `gdpevo_train` and `gdpevo_test`, preserving `train_tasks`/`test_tasks`.
For the full verified release each has 120 cases. Map `task_group_011/train_tasks/001`
to `gdpevo_train/CASE-011-001`, and its test counterpart to
`gdpevo_test/CASE-011-001`. A requested subset must name its groups and coverage;
use different IDs if a full benchmark already exists.

Read group metadata privately to preserve business scope and score weights. For
an initial smoke selection, bank credit group `011` and court operations `018`
are useful distinct environments. Selecting a subset does not authorize altering
case membership or inventing another split.

Copy `input/` under `statement/input/`, keeping `input/payloads/` references.
Create the Statement README from `input/prompt.txt`, retaining the objective and
output schema. Add one uniform `answer.json` delivery instruction if needed.
Bind `<TASK_ENV_BASE_URL>` only in the execution's copied Statement after its
business service is ready; never mutate the published benchmark per run.

Document public route templates, supported query parameters and pagination limits
from the pinned service. State whether unknown-route discovery is allowed before
freezing; a list declared exhaustive makes off-list probes a protocol violation
even when they return 404. Do not broaden permissions afterward to validate a run.

Keep gold, `eval/`, `notes/` and full `task_group.yaml` private. The group manifest
contains test criteria too and must not be passed whole to a training Optimizer.
Keep shared grader helpers in their original relative layout, or make a documented
adapter that preserves all observable grading behavior. Retain the upstream license.

## Environment lessons from local verification

- The source includes Dockerfiles. Check daemon access; a Docker command existing
  does not imply permission to use `/var/run/docker.sock`. Earlier verification
  used local Python processes and a virtual environment, not Docker. Report which
  mode this reproduction actually runs.
- Local execution of the verified groups needs Python 3.10+, Bash, and Flask
  3.0.3 for groups `010`, `017`, `018`, `019`, `020`. Follow source dependencies
  for other revisions. Build dependencies in preparation, not halfway through a
  Target Agent execution. Some `setup.sh` files hardcode `/app`; do not run them blindly
  outside their container. Generate a scoped local launcher if needed.
- Generate or copy the environment into a new per-execution directory. Group
  `022` is mutable: restore its baseline database for every independent case/run;
  never share its runtime DB between concurrent Target Agents or train/test runs.
- Large databases can be recreated by the pinned `generate_data.py`; record the
  source seed and verify the generated environment. Do not omit associated
  manifests or construction data needed internally by the service.
- Bind local services to a free port on `127.0.0.1` when execution is local. At the
  verified revision, health is `/api/health` for `004`, `005`, `008`, `010`, `011`,
  and `/health` for the others. Groups `001`, `002`, `006` parse the route into
  components, so naive source-string matching once chose the wrong path.
- Set `TASK_ENV_ENABLE_JUDGE=0` and verify `/api/judge` is unavailable to Target Agents.
  Preserve documented synthetic business-API authentication, but do not expose
  admin/reset credentials. Source endpoints use different auth headers or JSON
  token fields; read the actual service and task instructions.
- Check import-time dependencies before removing judge assets. Group `023` loads
  `judge_specs.json` and validates evaluator files while importing its business
  service, even with judging disabled. Retain required assets in the private
  runtime directory, keep the judge endpoint disabled, and expose only the
  business API to the Target Agent; do not copy that directory into Statement.
- Readiness, lifetime limits and cleanup belong in the generated Rubric Runtime
  section. Stop only owned processes/containers. Leaving a background service
  running after smoke does not make the benchmark reproducible from a new session.

## Scoring lessons

- Always supply the absolute Target Agent prediction path to the upstream scorer.
  Several scripts default to the gold answer when no argument is provided.
- Do not assume `score` means a normalized fraction. Fields include `score`,
  `total_score`, `normalized_score`, `score_fraction` and raw weighted points.
  Some outputs have a normalized `score` and a raw `max_score`; dividing the two
  would be wrong. Read each implementation and verify the conversion with gold
  and a negative control before freezing it.
- Record score extraction per case and split. Within group `002`, graders use
  different fields and scales: `percentage` can be a fraction, while another
  case needs `score / max_score`. A mapping inferred from the group's first
  case does not cover the others.
- Group `009` resolves `eval_common.py` three levels above its per-case `eval/`
  directory. Package this shared helper and preserve group/split/case depth.
- Group `021` test graders infer the task ID from `test_tasks/<id>` in the gold
  path. Flattening it to an arbitrary `case/` directory produces “unknown test
  task”. Its training wrapper also calls another script before whole-point grading.
- Group `012` returns exit code 1 for a valid but non-perfect answer. Parse its
  legitimate score as scored behavior; distinguish it from interpreter failures
  or invalid grader output. An `evaluator_error` is not a Target Agent zero.
- An empty object earns partial credit in at least one verified case. Preserve
  that behavior. Missing/malformed predictions need an explicit policy consistent
  with the task contract; do not make every nonzero process exit a score zero.
- Run shell wrappers with their required interpreter; Bash syntax may fail under
  `sh`. Check all needed files remain available after copying, not just in the
  original checkout.

## Verify and hand off

Use the Skill’s general smoke budget, plus targeted checks for any selected special grader
or environment above. Gold/control checks verify the adapter; complete Target Agent
sessions verify reproduction. Include score, trace binding, actual service mode,
database reset and cleanup evidence. Compare original and reproduced scoring on
the same saved predictions where possible.

The earlier 24-environment and 240-grader checks are historical evidence, not a
substitute for this reproduction's smoke runs or proof of RSI gains. Do not
automatically rerun all cases or start optimization. Publish only after the smoke
and Evaluation Center checks, then ask whether to run the full benchmark.
