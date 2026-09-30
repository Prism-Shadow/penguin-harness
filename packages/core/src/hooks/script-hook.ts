/**
 * Script hooks: the hook packages installed into an Agent's `agent_state/hooks/<name>/`
 * are plain Node scripts, run as subprocesses the way Claude Code runs its command hooks —
 * JSON on stdin, a JSON answer on stdout. The Session never loads plugin code into its own
 * process: a script that hangs is killed at its timeout, one that crashes or prints
 * something that is not JSON is recorded as a failed hook, and neither touches the run.
 *
 * stdin:  `{ "hook": "stop", "session_id": "…", "trace_path": "/abs/…_001.jsonl" }` for a
 *         stop hook (`trace_path` absent for a Trace-less Session); a pre_tool_use hook
 *         additionally gets `tool_name`, `tool_call_id` and `arguments` (the raw argument
 *         JSON string); a user_prompt hook additionally gets `scratchpad_dir` and `prompt`,
 *         plus the host's flow extras when the host started it by name.
 * stdout: empty = no opinion; otherwise the point's result as JSON — a StopHookResult
 *         (`decision` continue/stop, `input`, `reason`, `output`, `subagent`), a
 *         PreToolUseHookResult (`decision` allow/deny, `reason`, `output`) or a
 *         UserPromptHookResult (`context`).
 * exit:   non-zero = failure (stderr's tail becomes the reason).
 *
 * Hooks run in core and nowhere else — the Session consults them at their points, and a
 * host reaches a flow of its own through a Session API (the goal start goes through
 * `Session.runUserPromptHook`), never by spawning scripts itself.
 * `runHookScript` is the generic runner behind the adapters (`scriptStopHook` /
 * `scriptPreToolUseHook` / `scriptUserPromptHook`), each turning one installed command into
 * the point's in-process interface.
 *
 * A script is spawned under the Session's sandbox exactly as a command is: the argv goes
 * through the same confiner (see `RunHookScriptOptions.confine`), and a confiner that
 * cannot enforce its policy fails the hook rather than running it unconfined.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { prependPathEnv } from "../environment/tools/command/path-prepend.js";
import type { ConfinedSpawn, SpawnConfiner } from "../interfaces/index.js";
import type { UserPromptTrigger } from "../plugins/index.js";
import type { StopHook, StopHookInput, StopHookResult } from "./stop-hook.js";
import type { PreToolUseHook, PreToolUseHookInput, PreToolUseHookResult } from "./tool-hook.js";
import type { UserPromptHook, UserPromptHookInput, UserPromptHookResult } from "./prompt-hook.js";

/** Seconds a script may run before it is killed, when its manifest names none. */
export const DEFAULT_HOOK_TIMEOUT_S = 60;

/** Longest stderr tail kept in a failure reason. */
const STDERR_TAIL = 400;

export interface RunHookScriptOptions {
  /** Working directory of the script (defaults to its own directory). */
  cwd?: string;
  timeoutS?: number;
  signal?: AbortSignal;
  /**
   * Directories put at the front of the script's PATH (see
   * {@link CreateAgentOptions.pathPrepend}), so a hook that shells out to `penguin` reaches
   * the harness running it. Only the environment is involved here: a hook is spawned as
   * `node <script>`, with no shell to re-order PATH afterwards.
   */
  pathPrepend?: readonly string[];
  /**
   * The Session's sandbox: rewrites the argv about to be spawned (`[node, script]`) into
   * the one to spawn instead, the way a command's is rewritten (see
   * {@link SpawnConfiner}). A throw is the hook's failure — the script never runs
   * unconfined. Absent = unconfined (SDK/CLI standalone use).
   */
  confine?: (argv: readonly string[]) => ConfinedSpawn;
}

/**
 * Runs `script` with Node, feeding `input` as JSON on stdin, and returns the parsed stdout
 * — `undefined` for empty stdout. Throws on a non-zero exit, a timeout, an aborted signal or
 * unparseable stdout, with a message fit for a hook event's reason.
 */
export async function runHookScript(
  script: string,
  input: unknown,
  opts: RunHookScriptOptions = {},
): Promise<unknown> {
  const timeoutMs = (opts.timeoutS ?? DEFAULT_HOOK_TIMEOUT_S) * 1000;
  // Confined before anything is spawned, so a policy nothing can enforce is the hook's
  // failure and not a script running outside the sandbox.
  const argv = [process.execPath, script];
  let confined: ConfinedSpawn;
  try {
    confined = opts.confine ? opts.confine(argv) : { argv };
  } catch (err) {
    throw new Error(`sandbox: ${err instanceof Error ? err.message : String(err)}`);
  }
  const [program, ...args] = confined.argv;
  if (program === undefined) throw new Error("sandbox: the confiner returned an empty argv");
  return new Promise<unknown>((resolve, reject) => {
    // In the desktop app process.execPath is the Electron binary: without this flag the
    // spawn boots a whole Electron app (GPU process and all) instead of running the
    // script, and dies on machines where that fails. A plain Node execPath ignores it.
    // A runner's own entries (ConfinedSpawn.env) lie over that environment.
    const env = prependPathEnv(
      { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      opts.pathPrepend ?? [],
    );
    const child = spawn(program, args, {
      cwd: opts.cwd ?? path.dirname(script),
      stdio: ["pipe", "pipe", "pipe"],
      env: confined.env === undefined ? env : { ...env, ...confined.env },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const fail = (message: string): void => finish(() => reject(new Error(message)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(`timed out after ${timeoutMs / 1000}s`);
    }, timeoutMs);
    const onAbort = (): void => {
      child.kill("SIGKILL");
      fail("aborted");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (err) => fail(err.message));
    child.on("close", (code) => {
      if (code !== 0) {
        const tail = stderr.trim().slice(-STDERR_TAIL);
        fail(`exit ${code}${tail ? `: ${tail}` : ""}`);
        return;
      }
      const text = stdout.trim();
      if (!text) {
        finish(() => resolve(undefined));
        return;
      }
      try {
        const parsed: unknown = JSON.parse(text);
        finish(() => resolve(parsed));
      } catch {
        fail(`stdout is not JSON: ${text.slice(0, 200)}`);
      }
    });
    child.stdin.on("error", () => {
      // A script that exits without reading stdin closes the pipe; the exit code says the rest.
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

/** A script's parsed stdout as an object; anything else (a scalar, an array, null) reads as no opinion. */
function objectAnswer(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A hook's `output` as the contract allows it: the scalar-valued entries of an object answer; undefined for anything else. */
function scalarRecord(value: unknown): Record<string, string | number | boolean> | undefined {
  const v = objectAnswer(value);
  if (!v) return undefined;
  const output: Record<string, string | number | boolean> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      output[k] = val;
    }
  }
  return output;
}

/**
 * Narrows a script's answer to a StopHookResult: unknown fields are dropped, wrong-typed
 * ones ignored, `output` kept to scalars, `subagent.agent_id` mapped to `agentId`.
 */
export function parseStopHookResult(value: unknown): StopHookResult | undefined {
  const v = objectAnswer(value);
  if (!v) return undefined;
  const result: StopHookResult = {};
  if (v.decision === "continue" || v.decision === "stop") result.decision = v.decision;
  if (typeof v.input === "string") result.input = v.input;
  if (typeof v.reason === "string") result.reason = v.reason;
  const output = scalarRecord(v.output);
  if (output) result.output = output;
  const subagent = objectAnswer(v.subagent);
  if (subagent && typeof subagent.prompt === "string" && subagent.prompt.trim()) {
    result.subagent = {
      prompt: subagent.prompt,
      ...(typeof subagent.agent_id === "string" ? { agentId: subagent.agent_id } : {}),
    };
  }
  return result;
}

/** Narrows a script's answer to a PreToolUseHookResult: unknown decisions and non-scalar output values are dropped. */
export function parsePreToolUseResult(value: unknown): PreToolUseHookResult | undefined {
  const v = objectAnswer(value);
  if (!v) return undefined;
  const result: PreToolUseHookResult = {};
  if (v.decision === "allow" || v.decision === "deny") result.decision = v.decision;
  if (typeof v.reason === "string") result.reason = v.reason;
  const output = scalarRecord(v.output);
  if (output) result.output = output;
  return result;
}

/** Narrows a script's answer to a UserPromptHookResult: a non-string context reads as nothing to add. */
export function parseUserPromptResult(value: unknown): UserPromptHookResult | undefined {
  const v = objectAnswer(value);
  if (!v) return undefined;
  return typeof v.context === "string" ? { context: v.context } : {};
}

/** How one installed command is run: the manifest's timeout, and the Session's host policies, each re-read per call. */
export interface ScriptHookOptions {
  timeoutS?: number;
  /** See {@link RunHookScriptOptions.pathPrepend}; a getter, re-read per call. */
  pathPrepend?: () => string[];
  /**
   * The Session's confiner (see {@link SpawnConfiner}), re-read per call like
   * `pathPrepend`; null = unconfined. Called with the package directory as `cwd` and the
   * `scope` below.
   */
  confineSpawn?: () => SpawnConfiner | null;
  /** The Session's Workspace and scratchpad, the confiner's scope; absent = the package directory stands in for the Workspace. */
  scope?: { workspaceDir: string; scratchpadDir?: string };
}

/**
 * One installed command as a runner: `command` relative to `dir` (the hook package's
 * directory, which is also the script's cwd), the manifest's timeout, and per call the
 * stdin object and the run's signal. Undefined fields of the stdin object simply do not
 * serialize, so an absent `trace_path` is left absent by JSON itself.
 */
function scriptRunner(
  dir: string,
  command: string,
  opts: ScriptHookOptions,
): (input: Record<string, unknown>, signal: AbortSignal | undefined) => Promise<unknown> {
  const script = path.resolve(dir, command);
  return (input, signal) => {
    // Re-read per call, like the command-spawn side: the host may point PATH somewhere
    // else, or change the Session's policy, without the Session being rebuilt.
    const confiner = opts.confineSpawn?.() ?? null;
    return runHookScript(script, input, {
      cwd: dir,
      ...(opts.timeoutS !== undefined ? { timeoutS: opts.timeoutS } : {}),
      ...(signal ? { signal } : {}),
      ...(opts.pathPrepend ? { pathPrepend: opts.pathPrepend() } : {}),
      ...(confiner !== null
        ? {
            confine: (argv: readonly string[]) =>
              confiner(argv, {
                cwd: dir,
                workspaceDir: opts.scope?.workspaceDir ?? dir,
                ...(opts.scope?.scratchpadDir !== undefined
                  ? { scratchpadDir: opts.scope.scratchpadDir }
                  : {}),
              }),
          }
        : {}),
    });
  };
}

/** One installed user-prompt command as a UserPromptHook; `trigger` is the command's resolved one (see plugins' userPromptTrigger). */
export function scriptUserPromptHook(
  name: string,
  dir: string,
  command: string,
  opts: ScriptHookOptions & { trigger?: UserPromptTrigger } = {},
): UserPromptHook {
  const run = scriptRunner(dir, command, opts);
  const { trigger } = opts;
  return {
    name,
    ...(trigger !== undefined ? { trigger } : {}),
    async run(input: UserPromptHookInput): Promise<UserPromptHookResult | undefined> {
      return parseUserPromptResult(
        await run(
          {
            hook: "user_prompt",
            session_id: input.sessionId,
            trace_path: input.tracePath,
            scratchpad_dir: input.scratchpadDir,
            prompt: input.prompt,
            ...input.extras,
          },
          input.signal,
        ),
      );
    },
  };
}

/** One installed pre-tool-use command as a PreToolUseHook. */
export function scriptPreToolUseHook(
  name: string,
  dir: string,
  command: string,
  opts: ScriptHookOptions = {},
): PreToolUseHook {
  const run = scriptRunner(dir, command, opts);
  return {
    name,
    async run(input: PreToolUseHookInput): Promise<PreToolUseHookResult | undefined> {
      return parsePreToolUseResult(
        await run(
          {
            hook: "pre_tool_use",
            session_id: input.sessionId,
            trace_path: input.tracePath,
            tool_name: input.toolName,
            tool_call_id: input.toolCallId,
            arguments: input.argumentsJson,
          },
          input.signal,
        ),
      );
    },
  };
}

/** One installed stop-hook command as a StopHook. */
export function scriptStopHook(
  name: string,
  dir: string,
  command: string,
  opts: ScriptHookOptions = {},
): StopHook {
  const run = scriptRunner(dir, command, opts);
  return {
    name,
    async run(input: StopHookInput): Promise<StopHookResult | undefined> {
      return parseStopHookResult(
        await run(
          { hook: "stop", session_id: input.sessionId, trace_path: input.tracePath },
          input.signal,
        ),
      );
    },
  };
}
