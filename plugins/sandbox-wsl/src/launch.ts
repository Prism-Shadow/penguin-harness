/**
 * The launcher: one confined command, run inside the sandbox distro under bubblewrap.
 *
 * The provider could hand the harness a `wsl.exe …` argv directly, but two things need a
 * process of their own. The command's working directory is only known at spawn, and it has to
 * become a Linux path bwrap can `--chdir` into. And wsl.exe prints its own warnings on stderr
 * before the command runs (a localhost proxy it cannot mirror, on every single call), which an
 * agent would otherwise read as the command's output. So the harness runs
 * `node launch.js <job>`, and this program runs wsl.exe with the same stdin and stdout, filters
 * those lines out of the start of stderr, and exits with the command's code.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { isWslNotice, toLinuxPath, within } from "./profile.js";

/** What the provider hands the launcher. */
export interface LaunchJob {
  wsl: string;
  distro: string;
  user: string;
  /** The bwrap profile (see profile.ts). */
  bwrap: string[];
  /** Where a `--chdir` may point. */
  chdirRoots: string[];
  /** The command, already in its Linux spelling. */
  command: string[];
}

/** The wsl.exe arguments for a job started in `cwd`. */
export function wslArgs(job: LaunchJob, cwd: string): string[] {
  const linuxCwd = toLinuxPath(cwd, job.distro);
  const chdir =
    linuxCwd !== null && within(linuxCwd, job.chdirRoots)
      ? ["--chdir", linuxCwd]
      : job.chdirRoots.length > 0 && job.chdirRoots[0] !== "/"
        ? ["--chdir", job.chdirRoots[0]!]
        : [];
  return [
    "-d",
    job.distro,
    "-u",
    job.user,
    // wsl.exe would otherwise translate this process's cwd itself, and warn when it cannot.
    "--cd",
    "/",
    "--exec",
    "/usr/bin/bwrap",
    ...job.bwrap,
    ...chdir,
    "--",
    ...job.command,
  ];
}

/**
 * Copies a stream to stderr, dropping WSL's own notices from its first lines. Only the start is
 * inspected: wsl.exe prints them before the command runs, and holding back a command's partial
 * line (a progress bar) for longer would delay what it writes.
 */
export function noticeFilter(write: (chunk: string) => void): {
  push(chunk: string): void;
  end(): void;
} {
  let pending = "";
  let passthrough = false;
  let lines = 0;
  return {
    push(chunk) {
      if (passthrough) {
        write(chunk);
        return;
      }
      pending += chunk;
      let newline = pending.indexOf("\n");
      while (newline !== -1 && !passthrough) {
        const line = pending.slice(0, newline + 1);
        pending = pending.slice(newline + 1);
        if (!isWslNotice(line.replace(/\r?\n$/, ""))) {
          write(line);
          lines++;
        }
        if (lines > 0 || pending.length > 4096) passthrough = true;
        newline = pending.indexOf("\n");
      }
      if (passthrough && pending !== "") {
        write(pending);
        pending = "";
      }
    },
    end() {
      if (pending !== "" && !isWslNotice(pending)) write(pending);
      pending = "";
    },
  };
}

function main(): void {
  const encoded = process.argv[2];
  if (encoded === undefined) {
    process.stderr.write("penguin-wsl: the launcher was started without a job\n");
    process.exit(126);
  }
  const job = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as LaunchJob;
  const child = spawn(job.wsl, wslArgs(job, process.cwd()), {
    stdio: ["inherit", "inherit", "pipe"],
    windowsHide: true,
    env: { ...process.env, WSL_UTF8: "1" },
  });
  const filter = noticeFilter((chunk) => process.stderr.write(chunk));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => filter.push(chunk));
  child.stderr.on("end", () => filter.end());
  child.on("error", (err) => {
    process.stderr.write(`penguin-wsl: could not start ${job.wsl}: ${err.message}\n`);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal !== null ? 128 : 1);
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(signal, () => child.kill());
  }
}

// Run only as the launcher, not when a test imports the helpers above.
if (process.argv[1] !== undefined && path.basename(process.argv[1]).startsWith("launch")) main();
