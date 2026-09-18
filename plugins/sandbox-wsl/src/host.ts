/**
 * The Windows side: running wsl.exe, what it says about this machine, and the file this backend
 * keeps about the distro it set up.
 *
 * wsl.exe speaks UTF-16 by default; `WSL_UTF8=1` makes it write UTF-8, which is what every call
 * here sets. Its notices (a localhost proxy it cannot mirror into NAT mode) arrive on stderr on
 * every call and are dropped before anything reads the output.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isWslNotice } from "./profile.js";

/** wsl.exe by its full path: a server started with a trimmed PATH still finds it. */
export function wslExe(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe");
}

/** Where this backend keeps its state, its downloads and the distro's disk. */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const local =
    env.LOCALAPPDATA ??
    path.win32.join(env.USERPROFILE ?? "C:\\Users\\Default", "AppData", "Local");
  return path.win32.join(local, "penguin", "sandbox-wsl");
}

/** What a finished wsl.exe call said. */
export interface WslResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Drops WSL's own notices, and the NULs a UTF-16 answer leaves when read as UTF-8. */
export function cleanOutput(text: string): string {
  return text
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .filter((line) => !isWslNotice(line))
    .join("\n")
    .trim();
}

/** Runs wsl.exe to completion. `input` is written to its stdin; `onLine` sees stdout as it comes. */
export function runWsl(
  args: readonly string[],
  opts: { timeoutMs?: number; input?: string; onLine?: (line: string) => void } = {},
): Promise<WslResult> {
  return new Promise((resolve) => {
    const child = spawn(wslExe(), args, {
      windowsHide: true,
      env: { ...process.env, WSL_UTF8: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let partial = "";
    const timer =
      opts.timeoutMs !== undefined ? setTimeout(() => child.kill(), opts.timeoutMs) : undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (opts.onLine === undefined) return;
      partial += chunk;
      const lines = partial.split(/\r?\n|\r/);
      partial = lines.pop() ?? "";
      for (const line of lines) if (line.trim() !== "") opts.onLine(line.replace(/\0/g, ""));
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout: "", stderr: err.message });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: cleanOutput(stdout), stderr: cleanOutput(stderr) });
    });
    child.stdin.end(opts.input ?? "");
  });
}

/** What this machine has, as far as this backend is concerned. */
export interface HostFacts {
  /** `missing`: no working WSL (not installed, or installed and waiting for a restart). */
  wsl: "missing" | "installed";
  /** The version line wsl.exe reports, when it answers. */
  version?: string;
  /** What wsl.exe said when it did not work, for the card. */
  problem?: string;
  distros: string[];
}

/** The version number out of `wsl --version`'s first line, whatever language labels it. */
export function versionOf(output: string): string {
  const first = output.split("\n")[0]?.trim() ?? "";
  return first.replace(/^[^:：]*[:：]\s*/, "");
}

/** Reads WSL's presence, its version and the distros it has. Never throws. */
export async function readHost(): Promise<HostFacts> {
  if (!fs.existsSync(wslExe())) {
    return { wsl: "missing", problem: `${wslExe()} does not exist`, distros: [] };
  }
  const version = await runWsl(["--version"], { timeoutMs: 20_000 });
  if (version.code !== 0) {
    return {
      wsl: "missing",
      problem: (version.stdout || version.stderr).split("\n")[0] ?? "",
      distros: [],
    };
  }
  const list = await runWsl(["--list", "--quiet"], { timeoutMs: 20_000 });
  const distros =
    list.code === 0
      ? list.stdout
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l !== "")
      : [];
  return {
    wsl: "installed",
    version: versionOf(version.stdout),
    distros,
  };
}

/** What Initialize leaves behind: the distro it made and what it put in it. */
export interface WslState {
  distro: string;
  user: string;
  /** The Linux it was built from ("ubuntu" | "alpine"), and that image's version. */
  base: string;
  version: string;
  packages: string[];
  initializedAt: string;
}

export function stateFile(): string {
  return path.win32.join(stateDir(), "state.json");
}

export function readState(): WslState | null {
  try {
    const doc = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as Partial<WslState>;
    if (typeof doc.distro !== "string" || typeof doc.user !== "string") return null;
    return {
      distro: doc.distro,
      user: doc.user,
      base: typeof doc.base === "string" ? doc.base : "alpine",
      version: typeof doc.version === "string" ? doc.version : "",
      packages: Array.isArray(doc.packages) ? doc.packages.map(String) : [],
      initializedAt: typeof doc.initializedAt === "string" ? doc.initializedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeState(state: WslState): void {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(stateFile(), `${JSON.stringify(state, null, 2)}\n`);
}

export function removeState(): void {
  fs.rmSync(stateFile(), { force: true });
}

/** The drive letters present on this machine, lowercase. */
export function localDrives(exists: (p: string) => boolean = fs.existsSync): string[] {
  const drives: string[] = [];
  for (let c = 0x61; c <= 0x7a; c++) {
    const letter = String.fromCharCode(c);
    if (exists(`${letter}:\\`)) drives.push(letter);
  }
  return drives;
}

/** Whether a Windows path is a directory, a file, or nothing. */
export function pathKind(p: string): "dir" | "file" | null {
  try {
    return fs.statSync(p).isDirectory() ? "dir" : "file";
  } catch {
    return null;
  }
}
