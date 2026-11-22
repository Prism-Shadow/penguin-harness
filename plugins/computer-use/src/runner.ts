/**
 * One agent-desktop command, one process.
 *
 * The program is started by its absolute path — no shell, no PATH lookup, no Node launcher — with
 * the environment env.ts builds, so what runs is exactly the file the installer verified. It runs
 * in the server's process tree, outside any Agent sandbox: that is what makes macOS attribute its
 * Accessibility use to PenguinHarness, and what lets a sandboxed or WSL shell use it at all.
 *
 * Every blocking agent-desktop command has its own budget and returns at it, so the kill here is a
 * backstop: SIGTERM once the command's budget plus a grace period has passed, SIGKILL a few seconds
 * later. stdout is read whole (capped) and must hold exactly one JSON envelope; `--help` and
 * `--version` print plain text instead, which the caller asks for with `plain`. stdin carries the
 * text a command reads with `--stdin`, so typed text never appears among the process's arguments.
 */
import { spawn } from "node:child_process";

/** What is started: the program, and arguments that come before the command's (a test's script). */
export interface AgentDesktopProgram {
  file: string;
  args?: readonly string[];
}

/** One agent-desktop envelope: `{version, ok, command, data}` or `{…, ok: false, error}`. */
export interface Envelope {
  version?: string;
  ok: boolean;
  command?: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
    details?: Record<string, unknown>;
    disposition?: { delivery?: string; retry?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RunInput {
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd: string;
  stdin?: Buffer | string;
  /** The command's own budget. */
  budgetMs: number;
  /** Added to the budget before SIGTERM. */
  graceMs?: number;
  /** From SIGTERM to SIGKILL. */
  killMs?: number;
}

export interface RunOutput {
  /** The exit code, or null when the process was killed or never started. */
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** The envelope stdout holds, or null when it holds none. */
  envelope: Envelope | null;
  /** Killed after its budget and grace ran out. */
  timedOut: boolean;
  /** Why it could not be started (ENOENT, EACCES …). */
  spawnError?: string;
}

/** The most stdout kept (agent-desktop caps a batch's output at 4 MiB). */
const MAX_STDOUT = 8 * 1024 * 1024;
const MAX_STDERR = 64 * 1024;

/** The one JSON envelope `stdout` holds, or null. */
export function parseEnvelope(stdout: string): Envelope | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return typeof (value as { ok?: unknown }).ok === "boolean" ? (value as Envelope) : null;
  } catch {
    return null;
  }
}

/** Runs one command and reports how it ended; never throws. */
export function runAgentDesktop(program: AgentDesktopProgram, input: RunInput): Promise<RunOutput> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(program.file, [...(program.args ?? []), ...input.argv], {
        cwd: input.cwd,
        env: input.env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        code: null,
        signal: null,
        stdout: "",
        stderr: "",
        envelope: null,
        timedOut: false,
        spawnError: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let spawnError: string | undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      if (outBytes < MAX_STDOUT) out.push(chunk);
      outBytes += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errBytes < MAX_STDERR) err.push(chunk);
      errBytes += chunk.length;
    });
    // A program that exits before reading its stdin closes the pipe under us; that is its answer.
    child.stdin.on("error", () => {});
    child.stdin.end(input.stdin ?? "");
    let killTimer: NodeJS.Timeout | undefined;
    const termTimer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), input.killMs ?? 3_000);
      },
      input.budgetMs + (input.graceMs ?? 5_000),
    );
    child.on("error", (e) => {
      spawnError = e.message;
    });
    child.on("close", (code, signal) => {
      clearTimeout(termTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      const stdout = Buffer.concat(out).toString("utf8");
      resolve({
        // A program that never started has no exit code (Node reports the errno in its place).
        code: spawnError !== undefined ? null : code,
        signal,
        stdout,
        stderr: Buffer.concat(err).toString("utf8"),
        envelope: parseEnvelope(stdout),
        timedOut,
        ...(spawnError !== undefined ? { spawnError } : {}),
      });
    });
  });
}
