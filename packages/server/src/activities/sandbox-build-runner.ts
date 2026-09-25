/**
 * Running a module's own build.
 *
 * `SandboxBuilder` decides *whether* to build and makes sure only one build runs at a time.
 * This is the part it injects: the child process that actually does it.
 *
 * The module scaffold ships `webpack.config.cjs` and a `build` script, so the module's own
 * toolchain is what runs — not the harness's. A preview built by anything else would be a
 * preview of something the deployment will never produce.
 */
import { spawn } from "node:child_process";

/** Long enough for a cold webpack build, short enough that a hung one is not forever. */
export const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

/** How much build output is kept. A webpack failure is readable well within this. */
export const BUILD_LOG_MAX = 256 * 1024;

export interface BuildOutcome {
  ok: boolean;
  log: string;
}

/**
 * Keeps the *end* of the output when there is too much of it.
 *
 * The error is at the end. Truncating from the end would throw away the only part anyone
 * reads, which is what makes a log useless rather than merely long.
 */
export function clampLog(log: string, max = BUILD_LOG_MAX): string {
  if (log.length <= max) return log;
  return `… ${log.length - max} earlier characters omitted …\n${log.slice(-max)}`;
}

/**
 * Stops a build and everything it started.
 *
 * On Windows `npm` is a shell wrapper, so signalling the child kills the wrapper and leaves
 * webpack running — the process holds the workspace, `close` does not fire until the real
 * build finishes on its own, and a timeout that waits for it is not a timeout. Found by the
 * timeout test, which took the full sixty seconds it was meant to cut short.
 */
export function stopTree(child: { pid?: number; kill(signal?: NodeJS.Signals): boolean }): void {
  if (process.platform === "win32" && child.pid) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // Fall through to the signal, which at least stops the wrapper.
    }
  }
  child.kill("SIGTERM");
  // A build ignoring SIGTERM would otherwise hold the workspace forever.
  setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
}

/** How a build's child process is started. */
interface ChildSpec {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Written to the child's stdin, which is then closed. */
  stdin?: string;
  shell?: boolean;
}

/**
 * Runs one build child and reports how it went. Never throws: a build that could not start
 * is a failed build with a reason.
 */
function runBuildChild(spec: ChildSpec, options: { timeoutMs?: number }): Promise<BuildOutcome> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    let size = 0;
    const collect = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      chunks.push(text);
      size += text.length;
      // Bounded as it arrives: a build looping on an error can print gigabytes, and the
      // point of a log is the end of it.
      while (size > BUILD_LOG_MAX * 2 && chunks.length > 1) size -= chunks.shift()!.length;
    };
    const finish = (ok: boolean, trailer?: string) =>
      resolve({
        ok,
        log: clampLog(
          chunks.join("") +
            (trailer
              ? `
${trailer}`
              : ""),
        ),
      });

    let child;
    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: [spec.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        shell: spec.shell ?? false,
      });
    } catch (error) {
      finish(false, `The build could not be started: ${(error as Error).message}`);
      return;
    }

    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    if (spec.stdin !== undefined) {
      // A child that dies before reading its script closes the pipe; that failure is the
      // exit code's to report, not an unhandled stream error.
      child.stdin?.on("error", () => {});
      child.stdin?.end(spec.stdin);
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child);
    }, options.timeoutMs ?? BUILD_TIMEOUT_MS);
    timer.unref();

    child.on("error", (error: Error) => {
      clearTimeout(timer);
      finish(false, `The build could not be started: ${error.message}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) finish(false, "The build was stopped after taking too long.");
      else finish(code === 0, code === 0 ? undefined : `The build exited with code ${code}.`);
    });
  });
}

/**
 * Runs `npm run build` in a module workspace and reports how it went.
 *
 * Never throws. A build that could not start is a failed build with a reason — the author
 * asked to see their activity, and "npm is not installed" is an answer to that, while an
 * exception thrown at whoever happened to request the preview is not.
 *
 * `npm_config_ignore_scripts` is not set here: the module's `.npmrc` already sets
 * `ignore-scripts`, and the build itself is a script.
 */
export function spawnModuleBuild(
  workspace: string,
  options: { timeoutMs?: number } = {},
): Promise<BuildOutcome> {
  return runBuildChild(
    {
      command: "npm",
      args: ["run", "build"],
      cwd: workspace,
      // Windows resolves npm through its shell wrapper.
      shell: process.platform === "win32",
    },
    options,
  );
}

/**
 * Runs a build script with this process's own Node, the script arriving on stdin.
 *
 * On stdin rather than as `-e`: a script long enough to be useful is past what a Windows
 * command line holds, and nothing on stdin needs quoting.
 */
export function spawnNodeScript(
  script: string,
  input: { cwd: string; env: Record<string, string> },
  options: { timeoutMs?: number } = {},
): Promise<BuildOutcome> {
  return runBuildChild(
    {
      command: process.execPath,
      args: ["-"],
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdin: script,
    },
    options,
  );
}
