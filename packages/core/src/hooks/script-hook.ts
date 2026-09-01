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
 *         JSON string).
 * stdout: empty = no opinion; otherwise the point's result as JSON — a StopHookResult
 *         (`decision` continue/stop, `input`, `reason`, `output`, `subagent`) or a
 *         PreToolUseHookResult (`decision` allow/deny, `reason`, `output`).
 * exit:   non-zero = failure (stderr's tail becomes the reason).
 *
 * `runHookScript` is the generic runner — the server uses it for a hook package's other
 * scripts too (the goal plugin's start script) — and `scriptStopHook` /
 * `scriptPreToolUseHook` adapt one installed command into the in-process interfaces.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import type { StopHook, StopHookInput, StopHookResult } from "./stop-hook.js";
import type { PreToolUseHook, PreToolUseHookInput, PreToolUseHookResult } from "./tool-hook.js";

/** Seconds a script may run before it is killed, when its manifest names none. */
export const DEFAULT_HOOK_TIMEOUT_S = 60;

/** Longest stderr tail kept in a failure reason. */
const STDERR_TAIL = 400;

export interface RunHookScriptOptions {
  /** Working directory of the script (defaults to its own directory). */
  cwd?: string;
  timeoutS?: number;
  signal?: AbortSignal;
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
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: opts.cwd ?? path.dirname(script),
      stdio: ["pipe", "pipe", "pipe"],
      // In the desktop app process.execPath is the Electron binary: without this flag the
      // spawn boots a whole Electron app (GPU process and all) instead of running the
      // script, and dies on machines where that fails. A plain Node execPath ignores it.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
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

const DECISIONS = new Set(["continue", "stop"]);

/**
 * Narrows a script's answer to a StopHookResult: unknown fields are dropped, wrong-typed
 * ones ignored, `output` kept to scalars, `subagent.agent_id` mapped to `agentId`. A
 * non-object answer reads as no opinion.
 */
export function parseStopHookResult(value: unknown): StopHookResult | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const result: StopHookResult = {};
  if (typeof v.decision === "string" && DECISIONS.has(v.decision)) {
    result.decision = v.decision as "continue" | "stop";
  }
  if (typeof v.input === "string") result.input = v.input;
  if (typeof v.reason === "string") result.reason = v.reason;
  if (v.output !== null && typeof v.output === "object" && !Array.isArray(v.output)) {
    const output: Record<string, string | number | boolean> = {};
    for (const [k, val] of Object.entries(v.output as Record<string, unknown>)) {
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        output[k] = val;
      }
    }
    result.output = output;
  }
  if (v.subagent !== null && typeof v.subagent === "object") {
    const s = v.subagent as Record<string, unknown>;
    if (typeof s.prompt === "string" && s.prompt.trim()) {
      result.subagent = {
        prompt: s.prompt,
        ...(typeof s.agent_id === "string" ? { agentId: s.agent_id } : {}),
      };
    }
  }
  return result;
}

/** Narrows a script's parsed stdout to a PreToolUseHookResult: unknown decisions and non-scalar output values are dropped, an unusable value reads as no opinion. */
export function parsePreToolUseResult(value: unknown): PreToolUseHookResult | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const result: PreToolUseHookResult = {};
  if (v.decision === "allow" || v.decision === "deny") result.decision = v.decision;
  if (typeof v.reason === "string") result.reason = v.reason;
  if (v.output !== null && typeof v.output === "object" && !Array.isArray(v.output)) {
    const output: Record<string, string | number | boolean> = {};
    for (const [k, val] of Object.entries(v.output as Record<string, unknown>)) {
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        output[k] = val;
      }
    }
    result.output = output;
  }
  return result;
}

/** One installed pre-tool-use command as a PreToolUseHook: `command` relative to `dir`, the hook package's directory. */
export function scriptPreToolUseHook(
  name: string,
  dir: string,
  command: string,
  timeoutS?: number,
): PreToolUseHook {
  const script = path.resolve(dir, command);
  return {
    name,
    async run(input: PreToolUseHookInput): Promise<PreToolUseHookResult | void> {
      const answer = await runHookScript(
        script,
        {
          hook: "pre_tool_use",
          session_id: input.sessionId,
          ...(input.tracePath !== undefined ? { trace_path: input.tracePath } : {}),
          tool_name: input.toolName,
          tool_call_id: input.toolCallId,
          arguments: input.argumentsJson,
        },
        {
          cwd: dir,
          ...(timeoutS !== undefined ? { timeoutS } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
      return parsePreToolUseResult(answer);
    },
  };
}

/** One installed stop-hook command as a StopHook: `command` relative to `dir`, the hook package's directory. */
export function scriptStopHook(
  name: string,
  dir: string,
  command: string,
  timeoutS?: number,
): StopHook {
  const script = path.resolve(dir, command);
  return {
    name,
    async run(input: StopHookInput): Promise<StopHookResult | void> {
      const answer = await runHookScript(
        script,
        {
          hook: "stop",
          session_id: input.sessionId,
          ...(input.tracePath !== undefined ? { trace_path: input.tracePath } : {}),
        },
        {
          cwd: dir,
          ...(timeoutS !== undefined ? { timeoutS } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
      return parseStopHookResult(answer);
    },
  };
}
