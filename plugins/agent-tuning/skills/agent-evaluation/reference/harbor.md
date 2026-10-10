# Cases run through Harbor

A Case is run through Harbor when its `statement/README.md` has a `## How this case is run` section that names the [Harbor](https://github.com/harbor-framework/harbor) framework, links a repository at a 40-character commit and gives the `harbor run` launch. Its task is a Harbor task directory kept in that repository, not in the Case directory: the Case directory is `CASE-NNN-<task>`, the statement describes the task and how it is launched, and `rubric/README.md` scores the verifier's reward out of 100. One evaluation cell is one Harbor trial: Harbor starts the task's container in Docker, the PenguinHarness adapter installs the PenguinHarness CLI inside it and runs the Test Agent there, and the task's own verifier grades what the agent left.

The repository's README section *Running a task (for agents)*, which the statement links, is the authority on how a trial is run: fetching the repository at a commit, the launch, concurrency and Docker networks, retries, what `result.json` holds, credentials and failures. This file says only what PenguinHarness adds: where the checkout lives, what the Test Agent's State is, and how a trial becomes a protocol result. It replaces the Workspace launch, the Trace binding and the Rubric judgement of `SKILL.md` for such a Case; the Contract, the visibility rules, the failure codes and the Return format stay as `SKILL.md` states them.

**The model, and no credentials.** Every cell runs the request's `provider` / `model_id`, which the caller fixes as `SKILL.md`'s "For the caller" says: the pair its own instructions name, else its own Session's model from its Environment. When it cannot determine the model, the caller stops and asks the user. Neither the caller nor a cell ever reads the server's `api-token` file, a Project's `.project_config.toml` (it holds the model keys) or the server's auth database `web.db`, and neither calls the server's HTTP API with a token read from disk — not to find the model, and not to check its key. The adapter reads the saved model entry itself, and the repository's helper prints the one host a cell needs (§B.3).

**What the statement gives.** Nothing in `benchmark_config.toml` marks such a Benchmark or names its repository; every value below is read from the Case's statement:

| Value | In the statement |
| --- | --- |
| `REPO` | The repository: the **Task** line's link up to `/tree/` |
| `SHA` | The commit in that link, `/tree/<SHA>/`; the run-rules link and the checkout sentence name the same one |
| `TASK_PATH`, `TASK` | `-p <TASK_PATH>` and `-i <TASK>` of the launch |
| `HARBOR_VERSION` | `harbor==<HARBOR_VERSION>` of the launch |
| `AGENT` | `-a <AGENT>` of the launch: the adapter inside the repository's `agents/` |
| `RUN_TIMEOUT`, `MAX_TURNS` | `--ak run_timeout=<RUN_TIMEOUT>` and `--ak max_turns=<MAX_TURNS>` of the launch: the per-trial soft timeout and turn cap |
| The time-budget line | `--ak time_budget_note='<sentence>'`: present only where the benchmark's measured runs told the agent its time budget; the adapter puts the sentence before the task's instruction |
| The host line | `--allow-agent-host <model provider API host>`: present only for a task whose agent phase has no network (§B.3) |
| The overlay line | `--extra-docker-compose tools/docker/shared-network.yaml`: present only where the repository allows the shared network (§A.9) |

`SHA` must be 40 lowercase hexadecimal characters, and the Case id without its `CASE-NNN-` prefix must equal `TASK`; otherwise the Case is `benchmark_invalid`. So is a statement that links a branch or a tag: never resolve one to a commit. A statement with both the host line and the overlay line is `benchmark_invalid` as well: the repository never allows the shared network for a task without network.

## A. The caller: shared setup once, then the cells

The agent that fans out the cells performs steps 1–9 once, before its first `run_subagent` for the Benchmark, then runs the cells as "Running the cells" below says. A worker that finds no ready checkout does not race it: it takes the same lock, and either waits behind whoever holds it or, holding it, performs these steps itself. A checkout is named by the commit it holds and, once ready, is never changed or deleted — cells of this evaluation and of any other read it at the same time.

1. **Tools.** Require `docker info` to reach a daemon as the current user, `docker compose version` to report v2, `uv --version` (it provides `uvx`), `tar`, `python3`, and `curl` or `git`. When one is missing the evaluation cannot run on this machine: a caller says which tool is missing and stops; a worker returns `evaluation_failed`.
2. **The checkout's place,** named by the statement's commit:

   ```bash
   PROJECT_DIR="<app_data_dir>"
   CHECKOUT_ROOT="$PROJECT_DIR/benchmarks/.harbor"
   CHECKOUT="$CHECKOUT_ROOT/<last path segment of REPO>-$SHA"   # e.g. penguin-harness-benchmark-<40 hex>
   ```

3. **Ready already?** When `$CHECKOUT/.penguin-ready` exists, the checkout is complete: use it, and go to step 7. A `$CHECKOUT` without that file was not made by these steps: leave it alone; a caller tells the user, a worker returns `evaluation_failed`.
4. **Lock.** `mkdir -p "$CHECKOUT_ROOT"`, then `mkdir "$CHECKOUT.lock"`: it succeeds for exactly one process. Any other checks every 10 seconds until `$CHECKOUT/.penguin-ready` exists (then uses the checkout) or the lock is gone (then tries to take it). A lock older than 60 minutes with no ready checkout is stale: remove it and take it.
5. **Build the checkout beside it,** never in it, holding the lock. Fetch the commit as the run rules do, the archive first:

   ```bash
   TMP="$(mktemp -d "$CHECKOUT_ROOT/.fetch-XXXXXX")"
   # A GitHub repository: the archive of the commit.
   curl -fsSL "https://codeload.github.com/<owner>/<repo>/tar.gz/$SHA" | tar -xz -C "$TMP" --strip-components=1
   ```

   For another host, or when the archive fails, start again from a fresh empty `$TMP` with git: `git -C "$TMP" init -q && git -C "$TMP" fetch -q --depth 1 "<REPO>" "$SHA" && git -C "$TMP" checkout -q FETCH_HEAD`. Then, inside `$TMP`, `uvx --from harbor==<HARBOR_VERSION> harbor --version` downloads and caches the pinned Harbor (nothing is installed globally). There is no setup step: the repository commits every task directory. Run Harbor and its Python only from inside a checkout, never from the home directory, where a stray Python file can shadow the standard library.
6. **Publish,** in one rename: `touch "$TMP/.penguin-ready"`, then `[ -e "$CHECKOUT" ] || mv "$TMP" "$CHECKOUT"`, then `[ ! -e "$TMP" ] || rm -r "$TMP"` (nothing is left there unless another process published first) and `rmdir "$CHECKOUT.lock"`. When a step fails before this, remove `$TMP` and the lock: no checkout is ever seen half-made. Delete with `rm -r`, never `rm -rf`: PenguinHarness's default command policy refuses any command that holds a recursive force delete, the whole command with it.
7. **The run rules.** Read the section *Running a task (for agents)* of `$CHECKOUT/README.md`: the text the statement links, at the same commit. The steps below and §B carry it out; follow it for anything this file does not cover.
8. **Images,** optional. Pulling a benchmark's prebuilt images once here keeps parallel trials from pulling the same image at the same time (DeepSWE's are several GB each), as the README's pre-pull does: `cd "$CHECKOUT" && uvx --from harbor==<HARBOR_VERSION> python tools/select_tasks.py images <dir> | xargs -r -n1 -P4 docker pull`, where `<dir>` is the directory `TASK_PATH` names under `benchmarks/`. It prints nothing for a benchmark whose tasks build their own images.
9. **The shared network,** only when the statement's launch has the overlay line. That Compose overlay puts a trial's main container on one existing bridge network, `penguin-bench`, instead of a network of its own, so these trials stop using up the host's Docker address pools. Create the network once per host as the run rules say, unless it exists:

   ```bash
   docker network inspect penguin-bench >/dev/null 2>&1 || docker network create --subnet 10.233.0.0/16 penguin-bench
   ```

   A create that fails because the network exists by now lost a race and is fine; one that fails because the subnet overlaps another network is repeated with another free private range, such as `10.234.0.0/16`. Never add the overlay to a launch whose statement lacks it: the repository allows it only for single-container tasks whose agent phase has a public network, and on a task without network it would bypass the egress sidecar Harbor enforces that with.

### Running the cells

Send every cell the same `provider` and `model_id` (`SKILL.md`, "For the caller"), and run **at most four cells at a time** unless the user named another limit (the README's rule): start the next only when a running one has returned (`run_subagent` with `run_in_background` keeps four going).

A cell whose trial Docker could not give a network was not measured: run it once more at lower concurrency, and never count it as a score of 0 (the README's rule). Such a cell returns `evaluation_failed`, and its trial records Docker's error in `exception_info`; this prints a file name when it does:

```bash
JOB="$(ls -dt "$PROJECT_DIR/benchmarks/<benchmark_id>/.jobs/<case_id>-run<run>-"*/ | head -n 1)"
grep -rlE --include=result.json 'non-overlapping IPv4 address pool|address pools have been fully subnetted' "$JOB"
```

Then halve the number of cells you run at once, down to one, wait until no more than that many are running, and run the failed cell again with a new `run_subagent` and the same request. When that attempt fails as well, the cell has no score: stop and tell the user which cells are missing and why instead of recording the evaluation. Any other `evaluation_failed` is handled as the caller's own instructions say.

## B. One cell: one Harbor trial

Prepare as `SKILL.md` says — the request, the required files, `status`, the version check, the configured `thinking_level`, the Statement and Rubric snapshots, the Rubric total — but create no Workspace and copy nothing. Read the statement's values as "What the statement gives" says. Resolve `PROJECT_DIR`, `PROJECT_ID` and `PENGUIN_HOME` exactly as `SKILL.md`'s Run step does, and `CHECKOUT` as §A does; when `$CHECKOUT/.penguin-ready` is missing, go through §A from its lock step. Read the run rules (§A.7) unless this Session already has. Then:

1. **The task.** Require `$CHECKOUT/$TASK_PATH/$TASK/task.toml`; otherwise return `benchmark_invalid`.
2. **The thinking level.** The adapter takes `low`, `medium`, `high`, `xhigh` or `max`. A Test Agent configured with any other level cannot be evaluated here: return `evaluation_failed`.
3. **The model's host,** only when the statement's launch has the host line. The agent of a task without network reaches its model only through Harbor's allowlist, so the line names the one host that model's requests go to. The repository's helper prints it for the requested model, from the same Project configuration the adapter copies:

   ```bash
   HOST="$(cd "$CHECKOUT" && uvx --from harbor==<HARBOR_VERSION> python tools/agent_host.py \
     --host-penguin-home "$PENGUIN_HOME" --host-project-id "$PROJECT_ID" -m "<provider>/<model_id>")"
   ```

   When it prints nothing or fails, return `evaluation_failed`. Do not read the configuration yourself, and do not take the host from `penguin config model list`: its endpoint column is empty for a model that uses its provider's default endpoint.
4. **The Test Agent's State,** packed so the container runs the requested Agent rather than a stock one. The archive carries what makes the Agent what it is — its config, `AGENTS.md`, Skills, hooks and tools — and leaves out its vault, its memory and its schedules:

   ```bash
   JOBS_DIR="$PROJECT_DIR/benchmarks/<benchmark_id>/.jobs"
   JOB_NAME="<case_id>-run<run>-$(date -u +%Y%m%dT%H%M%SZ)"
   STATE_TAR="$JOBS_DIR/$JOB_NAME.agent-state.tar.gz"
   mkdir -p "$JOBS_DIR"
   tar --exclude=./.vault.toml --exclude=./memory --exclude=./schedule \
     -czf "$STATE_TAR" -C "$PROJECT_DIR/agents/<test_agent_id>/agent_state" .
   ```

   `$JOBS_DIR/$JOB_NAME` must not exist yet: Harbor resumes an existing job directory instead of running a new trial, so pick a new timestamp when it does.
5. **The PenguinHarness version.** `PENGUIN_VERSION` is the `version` field of `penguin version --json`, the release number; the container installs `@prismshadow/penguin-cli` at that version from npm.
6. **The shared network,** only when the statement's launch has the overlay line: require `docker network inspect penguin-bench` to succeed, creating the network as §A.9 says when it does not. A launch without the line runs without it: the trial makes a network of its own.
7. **Launch** the statement's command, in the foreground, from the checkout. Fill in its placeholders — `<provider>/<model_id>` with the request's pair, `<level>` with the configured `thinking_level`, `<penguin version>` with `$PENGUIN_VERSION`, `<model provider API host>` with `$HOST`, `<job name>` with `$JOB_NAME` and `<jobs dir>` with `$JOBS_DIR` — and insert `--ak agent_state_tar="$STATE_TAR" --ak host_penguin_home="$PENGUIN_HOME" --ak host_project_id="$PROJECT_ID"` before `--agent-setup-timeout-multiplier`. Change nothing else. Without the time-budget, host and overlay lines, it reads:

   ```bash
   cd "$CHECKOUT"
   export PYTHONPATH="$PWD/agents"
   uvx --from harbor==<HARBOR_VERSION> harbor run -p <TASK_PATH> -i "$TASK" \
     -a <AGENT> -m "<provider>/<model_id>" \
     --ak thinking=<thinking_level> --ak penguin_version="$PENGUIN_VERSION" \
     --ak run_timeout=<RUN_TIMEOUT> --ak max_turns=<MAX_TURNS> \
     --ak agent_state_tar="$STATE_TAR" \
     --ak host_penguin_home="$PENGUIN_HOME" --ak host_project_id="$PROJECT_ID" \
     --agent-setup-timeout-multiplier 2.5 -k 1 -n 1 --job-name "$JOB_NAME" -o "$JOBS_DIR" -y
   rm -f "$STATE_TAR"
   ```

   When the statement has them, its `--ak time_budget_note='…' \`, `--allow-agent-host "$HOST" \` and `--extra-docker-compose tools/docker/shared-network.yaml \` lines stay where it puts them, word for word, before the inserted options. A trial takes from a few minutes to an hour — an image pull or build, the adapter's install, the run itself up to `RUN_TIMEOUT`, then the verifier — so wait for the command to finish.

The adapter, not you, reads the requested model's entry, its saved API key included, from `$PENGUIN_HOME/$PROJECT_ID/.project_config.toml`, and copies it into the task container alone, outside the trial directory. Never pass a key with `--ae`, in an environment variable or anywhere on the command line: Harbor writes the agent's environment into the job's `config.json`. When Harbor reports that the model is not configured or has no saved key, return `evaluation_failed`: external configuration is required, and the user saves the key for that model on the Models page.

Retries follow the README's rule: a trial is run again only when its Test Agent never ran — its `result.json` has no `agent_execution.started_at`, or `agent_result.metadata.status` is `server_failed` or `config_failed`, or `agent_result.metadata.requests` is 0. Then apply a specific repair first — pull the image, free disk space, raise `--agent-setup-timeout-multiplier` — and launch under a new job name; when no repair is left, or the repair is the user's (a model without a saved key), return `evaluation_failed`. A trial whose Test Agent ran is never run again, whatever it scored. A trial Docker could not give a network is not retried here: return `evaluation_failed`, and the caller retries it at lower concurrency (§A, "Running the cells").

## C. Score

1. **The trial.** It is the one subdirectory of `$JOBS_DIR/$JOB_NAME/` that holds a `result.json` (the job's own `result.json` sits beside it); Harbor shortens the task name in the trial's name, so look it up rather than building it. No such file: return `evaluation_failed`.
2. **The reward.** Read `verifier_result.rewards.reward`: a finite number from 0 to 1. Return `evaluation_failed` when it is missing (the verifier did not run or wrote none), and when the Test Agent never reached its model, so that nothing it did was measured: `agent_result.metadata.status` is `server_failed` or `config_failed`, or `agent_result.metadata.requests` is 0. An `exception_info` beside a reward — the agent timed out, or `penguin run` exited with an error — is scored behavior: the verifier graded what the agent left.
3. **The runtime.** Read the model the Test Agent actually ran on from `agent_result.model_usage`, whose keys are `<provider>/<model_id>`; when it is absent, from the `session_meta` record of the Test Session's Trace under the trial's `agent/penguin/traces/`. It must be exactly the request's pair; return `evaluation_failed` when it differs or neither source exists. Return that pair as `provider` and `model_id`, and the configured value as `thinking_level`.
4. **The result.** `score` is `100 × reward` rounded to two decimal places. `cost` is `agent_result.cost_usd` at its recorded precision, or `null` when it is null or absent; never price the usage yourself. `duration_ms` is `agent_execution.finished_at − agent_execution.started_at` in whole milliseconds. `session_id` is `harbor:<trial directory name>`.
5. **The checks after the run** stay as `SKILL.md` says: the State version, the configured `thinking_level` and the Statement and Rubric snapshots must be unchanged.

The trial's `verifier/` output and the task's `tests/` and `solution/` folders are scoring material, private like a Rubric: read them only to score, and quote none of them.

## D. Afterwards

Harbor removes the trial's containers itself. Keep `$JOBS_DIR/$JOB_NAME/`: the Test Agent's Traces (`agent/penguin/traces/`) and the verifier's output stay there for whoever later explains the score. Remove only the State archive. Checkouts under `benchmarks/.harbor/` stay as well; one is removed by hand, if ever, while no evaluation runs. So does the `penguin-bench` network: another evaluation may be using it.
