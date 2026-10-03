# Harbor-backed Cases

A Benchmark whose `benchmark_config.toml` says `kind = "harbor"` keeps its tasks in a repository, not in its Case directories. Each Case directory is `CASE-NNN-<task>`, where `<task>` is a [Harbor](https://github.com/harbor-framework/harbor) task directory in that repository; the Case's `statement/README.md` describes the task and how it is launched, and its `rubric/README.md` scores the verifier's reward out of 100. One evaluation cell is one Harbor trial: Harbor starts the task's container in Docker, the PenguinHarness adapter installs the PenguinHarness CLI inside it and runs the Test Agent there, and the task's own verifier grades what the agent left.

This file replaces the Workspace launch, the Trace binding and the Rubric judgement of `SKILL.md` for such a Case. The Contract, the visibility rules, the failure codes and the Return format stay as `SKILL.md` states them.

**The model, and no credentials.** Every cell runs the request's `provider` / `model_id`, which the caller fixes as `SKILL.md`'s "For the caller" says: the pair its own instructions name, else its own Session's model from its Environment. When it cannot determine the model, the caller stops and asks the user. Neither the caller nor a cell ever reads the server's `api-token` file, a Project's `.project_config.toml` (it holds the model keys) or the server's auth database `web.db`, and neither calls the server's HTTP API with a token read from disk — not to find the model, and not to check its key. The adapter reads the saved model entry itself, and the repository's helper prints the one host a cell needs (§B.3).

The `[harbor]` table of `benchmark_config.toml` names everything below:

| Key | Meaning |
| --- | --- |
| `repo`, `ref` | The repository, and the commit to run (a branch is resolved to one first) |
| `path` | The folder of the task directories inside the repository |
| `agent` | The adapter's import path inside the repository's `agents/` |
| `harbor_version` | The Harbor release to run |
| `run_timeout`, `max_turns` | The per-trial soft timeout and turn cap |
| `allow_agent_hosts` | Hosts a task without network still has to reach, besides the model provider |
| `setup` | Optional: a command to run once in a fresh checkout, before any trial |

## A. Shared setup: once per evaluation, by the caller

The agent that fans out the cells performs this once, before its first `run_subagent` for the Benchmark. A worker that finds no ready checkout does not race it: it takes the same lock, and either waits behind whoever holds it or, holding it, performs these steps itself. A checkout is named by the commit it holds and, once ready, is never changed or deleted — cells of this evaluation and of any other read it at the same time.

1. **Tools.** Require `docker info` to reach a daemon as the current user, `docker compose version` to report v2, `uv --version` (it provides `uvx`), `tar`, `python3`, and `curl` or `git`. When one is missing the evaluation cannot run on this machine: a caller says which tool is missing and stops; a worker returns `evaluation_failed`.
2. **The commit.** `SHA` is the 40-character commit id `ref` names. A `ref` that is one already is used as it is; what ships names a commit. A branch or tag is resolved first — on GitHub, `curl -fsSL -H "Accept: application/vnd.github.sha" "https://api.github.com/repos/<owner>/<repo>/commits/<ref>"` prints the id; elsewhere, it is the first column of `git ls-remote "<repo>" "<ref>"` — and every cell resolves it the same way. Then:

   ```bash
   PROJECT_DIR="<app_data_dir>"
   CHECKOUT_ROOT="$PROJECT_DIR/benchmarks/.harbor"
   CHECKOUT="$CHECKOUT_ROOT/<last path segment of repo>-$SHA"   # e.g. penguin-harness-benchmark-<40 hex>
   ```

3. **Ready already?** When `$CHECKOUT/.penguin-ready` exists, the checkout is complete: use it, and go to step 7. A `$CHECKOUT` without that file was not made by these steps: leave it alone; a caller tells the user, a worker returns `evaluation_failed`.
4. **Lock.** `mkdir -p "$CHECKOUT_ROOT"`, then `mkdir "$CHECKOUT.lock"`: it succeeds for exactly one process. Any other checks every 10 seconds until `$CHECKOUT/.penguin-ready` exists (then uses the checkout) or the lock is gone (then tries to take it). A lock older than 60 minutes with no ready checkout is stale: remove it and take it.
5. **Build the checkout beside it,** never in it, holding the lock:

   ```bash
   TMP="$(mktemp -d "$CHECKOUT_ROOT/.fetch-XXXXXX")"
   # A GitHub repository: the archive of the commit.
   curl -fsSL "https://codeload.github.com/<owner>/<repo>/tar.gz/$SHA" | tar -xz -C "$TMP" --strip-components=1
   ```

   For another host, or when the archive fails, start again from a fresh empty `$TMP` with git: `git -C "$TMP" init -q && git -C "$TMP" fetch -q --depth 1 "<repo>" "$SHA" && git -C "$TMP" checkout -q FETCH_HEAD`. Then, inside `$TMP`: `uvx --from harbor==<harbor_version> harbor --version` downloads and caches the pinned Harbor (nothing is installed globally), and, when `[harbor].setup` is present, run it (rag-bench-essential downloads its pinned upstream commit and generates its task directories this way). Run Harbor and its Python only from inside a checkout, never from the home directory, where a stray Python file can shadow the standard library.
6. **Publish,** in one rename: `touch "$TMP/.penguin-ready"`, then `[ -e "$CHECKOUT" ] || mv "$TMP" "$CHECKOUT"`, then `[ ! -e "$TMP" ] || rm -r "$TMP"` (nothing is left there unless another process published first) and `rmdir "$CHECKOUT.lock"`. When a step fails before this, remove `$TMP` and the lock: no checkout is ever seen half-made. Delete with `rm -r`, never `rm -rf`: PenguinHarness's default command policy refuses any command that holds a recursive force delete, the whole command with it.
7. **Images,** optional. Terminal-Bench and DeepSWE tasks run prebuilt images, and DeepSWE's are several GB each; pulling them once here keeps parallel trials from pulling the same image at the same time: `cd "$CHECKOUT" && uvx --from harbor==<harbor_version> python tools/select_tasks.py images <benchmark_id> | xargs -n1 -P4 docker pull`.

## B. One cell: one Harbor trial

Prepare as `SKILL.md` says — the request, the required files, `status`, the version check, the configured `thinking_level`, the Statement and Rubric snapshots, the Rubric total — but create no Workspace and copy nothing. Resolve `PROJECT_DIR`, `PROJECT_ID` and `PENGUIN_HOME` exactly as `SKILL.md`'s Run step does, and `SHA` and `CHECKOUT` as §A does; when `$CHECKOUT/.penguin-ready` is missing, go through §A from its lock step. Then:

1. **The task.** `TASK` is the Case id without its `CASE-NNN-` prefix. Require `$CHECKOUT/<path>/$TASK/task.toml`, and require the Case's statement to launch that same task (`-i <TASK>`); otherwise return `benchmark_invalid`.
2. **The thinking level.** The adapter takes `low`, `medium`, `high`, `xhigh` or `max`. A Test Agent configured with any other level cannot be evaluated here: return `evaluation_failed`.
3. **The network.** Read `network_mode` from the `[agent]` table of the task's `task.toml`. When it is `no-network`, the agent reaches its model only through Harbor's allowlist: add `--allow-agent-host "$HOST"`, where `HOST` is what the repository's helper prints for the requested model — the one host that model's requests go to, read from the same Project configuration the adapter copies:

   ```bash
   HOST="$(cd "$CHECKOUT" && uvx --from harbor==<harbor_version> python tools/agent_host.py \
     --host-penguin-home "$PENGUIN_HOME" --host-project-id "$PROJECT_ID" -m "<provider>/<model_id>")"
   ```

   When it prints nothing or fails, return `evaluation_failed`. Do not read the configuration yourself, and do not take the host from `penguin config model list`: its endpoint column is empty for a model that uses its provider's default endpoint. Add one `--allow-agent-host` for each entry of `[harbor].allow_agent_hosts` as well.
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
6. **Launch,** in the foreground, from the checkout:

   ```bash
   cd "$CHECKOUT"
   export PYTHONPATH="$CHECKOUT/agents"
   uvx --from harbor==<harbor_version> harbor run \
     -p "<path>" -i "$TASK" \
     -a "<agent>" -m "<provider>/<model_id>" \
     --ak thinking=<thinking_level> --ak penguin_version="$PENGUIN_VERSION" \
     --ak run_timeout=<run_timeout> --ak max_turns=<max_turns> \
     --ak agent_state_tar="$STATE_TAR" \
     --ak host_penguin_home="$PENGUIN_HOME" --ak host_project_id="$PROJECT_ID" \
     --agent-setup-timeout-multiplier 2.5 \
     -k 1 -n 1 --job-name "$JOB_NAME" -o "$JOBS_DIR" -y
   rm -f "$STATE_TAR"
   ```

   Insert the `--allow-agent-host` flags of step 3 before `-k`. A trial takes from a few minutes to an hour — an image pull or build, the adapter's install, the run itself up to `run_timeout`, then the verifier — so wait for the command to finish.

The adapter, not you, reads the requested model's entry, its saved API key included, from `$PENGUIN_HOME/$PROJECT_ID/.project_config.toml`, and copies it into the task container alone, outside the trial directory. Never pass a key with `--ae`, in an environment variable or anywhere on the command line: Harbor writes the agent's environment into the job's `config.json`. When Harbor reports that the model is not configured or has no saved key, return `evaluation_failed`: external configuration is required, and the user saves the key for that model on the Models page.

Retry a launch only when the trial shows that the Test Agent never started: no `agent_execution.started_at` in its `result.json` (an image that could not be pulled or built, a Docker error, an install that ran out of time). Apply a specific repair first — pull the image, free disk space, raise `--agent-setup-timeout-multiplier` — and use a new job name. Once the agent phase has started, never run the cell again.

## C. Score

1. **The trial.** It is the one subdirectory of `$JOBS_DIR/$JOB_NAME/` that holds a `result.json` (the job's own `result.json` sits beside it); Harbor shortens the task name in the trial's name, so look it up rather than building it. No such file: return `evaluation_failed`.
2. **The reward.** Read `verifier_result.rewards.reward`: a finite number from 0 to 1. Return `evaluation_failed` when it is missing (the verifier did not run or wrote none), and when the Test Agent never reached its model, so that nothing it did was measured: `agent_result.metadata.status` is `server_failed` or `config_failed`, or `agent_result.metadata.requests` is 0. An `exception_info` beside a reward — the agent timed out, or `penguin run` exited with an error — is scored behavior: the verifier graded what the agent left.
3. **The runtime.** Read the model the Test Agent actually ran on from `agent_result.model_usage`, whose keys are `<provider>/<model_id>`; when it is absent, from the `session_meta` record of the Test Session's Trace under the trial's `agent/penguin/traces/`. It must be exactly the request's pair; return `evaluation_failed` when it differs or neither source exists. Return that pair as `provider` and `model_id`, and the configured value as `thinking_level`.
4. **The result.** `score` is `100 × reward` rounded to two decimal places. `cost` is `agent_result.cost_usd` at its recorded precision, or `null` when it is null or absent; never price the usage yourself. `duration_ms` is `agent_execution.finished_at − agent_execution.started_at` in whole milliseconds. `session_id` is `harbor:<trial directory name>`.
5. **The checks after the run** stay as `SKILL.md` says: the State version, the configured `thinking_level` and the Statement and Rubric snapshots must be unchanged.

The trial's `verifier/` output and the task's `tests/` and `solution/` folders are scoring material, private like a Rubric: read them only to score, and quote none of them.

## D. Afterwards

Harbor removes the trial's containers itself. Keep `$JOBS_DIR/$JOB_NAME/`: the Test Agent's Traces (`agent/penguin/traces/`) and the verifier's output stay there for whoever later explains the score. Remove only the State archive. Checkouts under `benchmarks/.harbor/` stay as well; one is removed by hand, if ever, while no evaluation runs.
