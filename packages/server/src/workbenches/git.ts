import { spawn } from "node:child_process";
import path from "node:path";

/** Keep normal Git configuration and identity, while addressing only the Agent's bare repo. */
function environment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    "GIT_DIR",
    "GIT_COMMON_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_SHALLOW_FILE",
    "GIT_GRAFT_FILE",
    "GIT_QUARANTINE_PATH",
  ])
    delete env[name];
  return env;
}

/** Run Git plumbing with binary stdin/stdout. A missing Git or failed command reaches the caller. */
export async function runGit(
  gitdir: string,
  args: string[],
  opts: { input?: Uint8Array | string; env?: NodeJS.ProcessEnv; allowMissing?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "--git-dir",
        gitdir,
        "--no-replace-objects",
        // HEAD is a file, so this path can never contain executable hook programs.
        "-c",
        `core.hooksPath=${path.join(gitdir, "HEAD")}`,
        ...args,
      ],
      {
        env: { ...environment(), ...opts.env },
        windowsHide: true,
      },
    );
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    child.stdout.on("data", (data: Buffer) => stdout.push(data));
    child.stderr.on("data", (data: Buffer) => stderr.push(data));
    child.on("error", (cause: NodeJS.ErrnoException) => {
      reject(
        cause.code === "ENOENT"
          ? new Error(
              "Git is required for Agent State version history. Install Git and make it available on PATH.",
              { cause },
            )
          : cause,
      );
    });
    child.stdin.on("error", (cause: NodeJS.ErrnoException) => {
      if (cause.code !== "EPIPE") reject(cause);
    });
    child.on("close", (code) => {
      if (code === 0 || (opts.allowMissing && code === 1)) resolve(Buffer.concat(stdout));
      else
        reject(
          new Error(`git ${args[0]}: ${Buffer.concat(stderr).toString().trim() || `exit ${code}`}`),
        );
    });
    child.stdin.end(opts.input);
  });
}

/** Fill each missing identity field separately. Git retains its environment/config precedence. */
export async function commitIdentity(gitdir: string): Promise<NodeJS.ProcessEnv> {
  const values = await runGit(
    gitdir,
    ["config", "--null", "--get-regexp", "^(user|author|committer)\\.(name|email)$"],
    { allowMissing: true },
  );
  const config = new Map(
    values
      .toString()
      .split("\0")
      .filter(Boolean)
      .map((row) => {
        const i = row.indexOf("\n");
        return [row.slice(0, i), row.slice(i + 1)] as const;
      }),
  );
  const env: NodeJS.ProcessEnv = {};
  for (const role of ["author", "committer"]) {
    for (const field of ["name", "email"]) {
      const variable = `GIT_${role.toUpperCase()}_${field.toUpperCase()}`;
      if (process.env[variable]?.trim()) continue;
      env[variable] =
        config.get(`${role}.${field}`)?.trim() ||
        config.get(`user.${field}`)?.trim() ||
        (field === "email" ? process.env.EMAIL?.trim() || "penguin@localhost" : "PenguinHarness");
    }
  }
  return env;
}
