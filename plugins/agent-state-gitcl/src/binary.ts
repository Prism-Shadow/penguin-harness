import { spawn } from "node:child_process";

export interface GitProgram {
  program: string;
}

export interface FoundGit {
  git: GitProgram;
  version: string;
}

let remembered: Promise<FoundGit | null> | undefined;

function runVersion(program = "git"): Promise<FoundGit> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, ["version"], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code, signal) => {
      const version = /^git version (\S+)/.exec(out)?.[1];
      if (code === 0 && version !== undefined) resolve({ git: { program }, version });
      else reject(new Error(signal !== null ? `killed by ${signal}` : `exit ${code}`));
    });
  });
}

export function probeGit(): Promise<FoundGit | null> {
  remembered ??= runVersion().catch(() => null);
  return remembered;
}
