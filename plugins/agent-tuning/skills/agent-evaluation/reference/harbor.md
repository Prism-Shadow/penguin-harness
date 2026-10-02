# Harbor-backed Cases

A Benchmark whose `benchmark_config.toml` says `kind = "harbor"` keeps its tasks in a repository, not in its Case directories. Each Case directory is `CASE-NNN-<task>`, where `<task>` is a [Harbor](https://github.com/harbor-framework/harbor) task directory in that repository; the Case's `statement/README.md` describes the task and how it is launched, and its `rubric/README.md` scores the verifier's reward out of 100. One evaluation cell is one Harbor trial: Harbor starts the task's container in Docker, the PenguinHarness adapter installs the PenguinHarness CLI inside it and runs the Test Agent there, and the task's own verifier grades what the agent left.

This file replaces the Workspace launch, the Trace binding and the Rubric judgement of `SKILL.md` for such a Case. The Contract, the visibility rules, the failure codes and the Return format stay as `SKILL.md` states them.

The `[harbor]` table of `benchmark_config.toml` names everything below:

| Key | Meaning |
| --- | --- |
| `repo`, `ref` | The repository and the commit or branch to run |
| `path` | The folder of the task directories inside the repository |
| `agent` | The adapter's import path inside the repository's `agents/` |
| `harbor_version` | The Harbor release to run |
| `run_timeout`, `max_turns` | The per-trial soft timeout and turn cap |
| `allow_agent_hosts` | Hosts a task without network still has to reach, besides the model provider |
| `setup` | Optional: a command to run once in a fresh checkout, before any trial |

## A. Shared setup: once per evaluation, by the caller

The agent that fans out the cells performs this once, before its first `run_subagent` for the Benchmark. A worker that finds the ready marker missing performs it itself, under the same lock. Every step is safe to repeat.

```bash
PROJECT_DIR="<app_data_dir>"
CHECKOUT_ROOT="$PROJECT_DIR/benchmarks/.harbor"
CHECKOUT="$CHECKOUT_ROOT/<last path segment of repo>-<ref>"   # e.g. penguin-harness-benchmark-main
```

1. **Tools.** Require `docker info` to reach a daemon as the current user, `docker compose version` to report v2, `uv --version` (it provides `uvx`), `tar`, `python3`, and `curl` or `git`. When one is missing the evaluation cannot run on this machine: a caller says which tool is missing and stops; a worker returns `evaluation_failed`.
2. **Lock.** `mkdir -p "$CHECKOUT_ROOT"`, then `mkdir "$CHECKOUT.lock"`: it succeeds for exactly one process. Any other waits, checking every 10 seconds, until `$CHECKOUT/.penguin-ready` exists or the lock is gone. A lock older than 60 minutes with no ready marker is stale: remove it and take it.
3. **Fetch,** when `$CHECKOUT/.penguin-ready` is missing. A `ref` that is not a 40-character commit id names a branch that moves, so for one the caller deletes the ready marker at the start of every evaluation and fetches again. Download into a fresh directory beside the checkout and move it into place:

   ```bash
   TMP="$(mktemp -d "$CHECKOUT_ROOT/.fetch-XXXXXX")"
   # A GitHub repository: the archive of the ref.
   curl -fsSL "https://codeload.github.com/<owner>/<repo>/tar.gz/<ref>" | tar -xz -C "$TMP" --strip-components=1
   rm -rf "$CHECKOUT" && mv "$TMP" "$CHECKOUT"
   ```

   For another host, or when the archive fails, start again from a fresh empty `$TMP` and use git: `git clone -q --depth 1 --branch "<ref>" "<repo>" "$TMP"` for a branch or tag, or `git -C "$TMP" init -q && git -C "$TMP" fetch -q --depth 1 "<repo>" "<ref>" && git -C "$TMP" checkout -q FETCH_HEAD` for a commit id; then move it into place the same way.

4. **Harbor.** `cd "$CHECKOUT" && uvx --from harbor==<harbor_version> harbor --version` downloads and caches the pinned release; nothing is installed globally. Run Harbor and its Python only from inside `$CHECKOUT`, never from the home directory, where a stray Python file can shadow the standard library.
5. **Setup.** When `[harbor].setup` is present, run it once from `$CHECKOUT`. rag-bench-essential uses it to download its pinned upstream commit and generate its task directories.
6. **Images,** optional. Terminal-Bench and DeepSWE tasks run prebuilt images, and DeepSWE's are several GB each; pulling them once here keeps parallel trials from pulling the same image at the same time: `cd "$CHECKOUT" && uvx --from harbor==<harbor_version> python tools/select_tasks.py images <benchmark_id> | xargs -n1 -P4 docker pull`.
7. **Ready.** `printf '%s\n' "<ref>" > "$CHECKOUT/.penguin-ready"`, then `rmdir "$CHECKOUT.lock"`.

## B. One cell: one Harbor trial

Prepare as `SKILL.md` says — the request, the required files, `status`, the version check, the configured `thinking_level`, the Statement and Rubric snapshots, the Rubric total — but create no Workspace and copy nothing. Resolve `PROJECT_DIR`, `PROJECT_ID` and `PENGUIN_HOME` exactly as `SKILL.md`'s Run step does, and `CHECKOUT` as §A does; require `$CHECKOUT/.penguin-ready`, performing §A first when it is missing. Then:

1. **The task.** `TASK` is the Case id without its `CASE-NNN-` prefix. Require `$CHECKOUT/<path>/$TASK/task.toml`, and require the Case's statement to launch that same task (`-i <TASK>`); otherwise return `benchmark_invalid`.
2. **The thinking level.** The adapter takes `low`, `medium`, `high`, `xhigh` or `max`. A Test Agent configured with any other level cannot be evaluated here: return `evaluation_failed`.
3. **The network.** Read `network_mode` from the `[agent]` table of the task's `task.toml`. When it is `no-network`, the agent reaches its model only through Harbor's allowlist: add `--allow-agent-host <host>`, where `<host>` is the host of the `base_url` on the requested model's row of `penguin config model list --root "$PENGUIN_HOME" --project-id "$PROJECT_ID"` (for DeepSeek's own endpoint, `api.deepseek.com`). Read that field and nothing else; the key column is masked and is never copied anywhere. Add one `--allow-agent-host` for each entry of `[harbor].allow_agent_hosts` as well.
4. **The Test Agent's State,** packed without its vault, so the container runs the requested Agent rather than a stock one:

   ```bash
   JOBS_DIR="$PROJECT_DIR/benchmarks/<benchmark_id>/.jobs"
   JOB_NAME="<case_id>-run<run>-$(date -u +%Y%m%dT%H%M%SZ)"
   STATE_TAR="$JOBS_DIR/$JOB_NAME.agent-state.tar.gz"
   mkdir -p "$JOBS_DIR"
   tar --exclude=./.vault.toml -czf "$STATE_TAR" -C "$PROJECT_DIR/agents/<test_agent_id>/agent_state" .
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
2. **The reward.** Read `verifier_result.rewards.reward`: a finite number from 0 to 1. Return `evaluation_failed` when it is missing (the verifier did not run or wrote none), and when the Test Agent never reached its model, so that nothing it did was measured: `agent_result.metadata.status` is `server_failed`, or `agent_result.metadata.requests` is 0. An `exception_info` beside a reward — the agent timed out, or `penguin run` exited with an error — is scored behavior: the verifier graded what the agent left.
3. **The runtime.** Read the model the Test Agent actually ran on from `agent_result.model_usage`, whose keys are `<provider>/<model_id>`; when it is absent, from the `session_meta` record of the Test Session's Trace under the trial's `agent/penguin/traces/`. It must be exactly the request's pair; return `evaluation_failed` when it differs or neither source exists. Return that pair as `provider` and `model_id`, and the configured value as `thinking_level`.
4. **The result.** `score` is `100 × reward` rounded to two decimal places. `cost` is `agent_result.cost_usd` at its recorded precision, or `null` when it is null or absent; never price the usage yourself. `duration_ms` is `agent_execution.finished_at − agent_execution.started_at` in whole milliseconds. `session_id` is `harbor:<trial directory name>`.
5. **The checks after the run** stay as `SKILL.md` says: the State version, the configured `thinking_level` and the Statement and Rubric snapshots must be unchanged.

The trial's `verifier/` output and the task's `tests/` and `solution/` folders are scoring material, private like a Rubric: read them only to score, and quote none of them.

## D. Afterwards

Harbor removes the trial's containers itself. Keep `$JOBS_DIR/$JOB_NAME/`: the Test Agent's Traces (`agent/penguin/traces/`) and the verifier's output stay there for whoever later explains the score. Remove only the State archive.
