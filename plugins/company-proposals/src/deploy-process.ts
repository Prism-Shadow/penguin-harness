/**
 * How a deploy script is started (deploy.ts): the registered argument vector as is — no
 * shell, so an argument is never re-split or expanded — with stdout and stderr merged into
 * one output, and one end: the exit code, or why it never started.
 */
import { spawn } from "node:child_process";

/** A started script: its output and its end. */
export interface DeployProcess {
  onOutput(listener: (text: string) => void): void;
  /** Once: the exit code (null when killed by a signal), or the reason it never started. */
  onExit(listener: (code: number | null, error: string | null) => void): void;
  kill(signal: NodeJS.Signals): void;
}

export type StartProcess = (
  argv: readonly string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
) => DeployProcess;

/** The spawner deploys use outside tests. */
export function startProcess(
  argv: readonly string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
): DeployProcess {
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const outputs: Array<(text: string) => void> = [];
  let exited = false;
  const exits: Array<(code: number | null, error: string | null) => void> = [];
  const finish = (code: number | null, error: string | null): void => {
    if (exited) return;
    exited = true;
    for (const l of exits) l(code, error);
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (text: string) => outputs.forEach((l) => l(text)));
  child.stderr.on("data", (text: string) => outputs.forEach((l) => l(text)));
  child.on("error", (err: NodeJS.ErrnoException) =>
    finish(null, err.code === "ENOENT" ? `${argv[0]} not found` : err.message),
  );
  child.on("close", (code, signal) => finish(code, signal === null ? null : `killed by ${signal}`));
  return {
    onOutput: (l) => outputs.push(l),
    onExit: (l) => exits.push(l),
    kill: (signal) => {
      child.kill(signal);
    },
  };
}
